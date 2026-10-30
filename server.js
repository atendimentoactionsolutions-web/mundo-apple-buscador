const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const ioClient = require('socket.io-client');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const auth = require('./auth');
const quotesManager = require('./quotes');
const PricingCore = require('./public/js/pricing-core.js');
const QuoteCore = require('./public/js/quote-core.js');

const localEnvFile = path.join(__dirname, '.env');
if (fs.existsSync(localEnvFile) && typeof process.loadEnvFile === 'function') process.loadEnvFile(localEnvFile);

const PXT_BASE_URL = 'https://backend-api.buscadorpxt.com.br';
const USER_EMAIL = process.env.PXT_EMAIL || 'felippemiranda1991@gmail.com';
const USER_PASS = process.env.PXT_PASSWORD || 'Finasjoias10';
const PORT = process.env.PORT || 3333;
const PAUSE_PXT_UPSTREAM = process.env.PAUSE_PXT_UPSTREAM === 'true'; // Padrão falso = TEMPO REAL ATIVO!

// Proteção Anti-Crash Global: Impede que qualquer erro não tratado derrube a aplicação
process.on('uncaughtException', (err) => {
  console.error('[Proteção Global] 🛡️ Uncaught Exception capturada:', err.message);
});

process.on('unhandledRejection', (reason) => {
  console.error('[Proteção Global] 🛡️ Unhandled Rejection capturado:', reason?.message || reason);
});

const ANDROID_CATEGORIES = new Set(['MI', 'NOTE', 'PAD', 'POCO', 'RDM', 'REAL']);
const APPLE_CATEGORIES = new Set(['IPH', 'MCB', 'IPAD', 'IPD', 'RLG', 'PODS', 'ACSS', 'IMAC', 'MNTR']);

const app = express();
const asyncHandler = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const server = http.createServer(app);
const localIo = new Server(server, {
  cors: { origin: '*' }
});

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

// Helper de Cookies de Sessão
function setSessionCookie(res, token, isAdmin = false) {
  const maxAge = isAdmin ? 365 * 24 * 60 * 60 : 30 * 24 * 60 * 60; // 1 ano para admin, 30 dias para lojistas
  res.setHeader('Set-Cookie', `fornecedor_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`);
}
function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `fornecedor_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

// Rotas Públicas do Buscador Principal (Acesso Direto Sem Login)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/index.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/catalogo', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Acesso ao Painel Admin via web desativado (gestão exclusiva centralizada via backend/assistente)
app.get(['/admin', '/admin.html', '/painel', '/painel.html'], (req, res) => {
  res.redirect('/');
});

app.get('/login', (req, res) => res.redirect('/login.html'));

app.get('/login.html', asyncHandler(async (req, res, next) => {
  const token = auth.getSessionTokenFromRequest(req);
  const user = await auth.findUserBySessionToken(token);
  if (user) return res.redirect('/');
  next();
}));

// Bloqueia qualquer acesso direto a arquivos de painel administrativo
app.use((req, res, next) => {
  if (req.path === '/admin.html' || req.path === '/painel.html') {
    return res.redirect('/');
  }
  next();
});

// Arquivos estáticos (CSS, JS, Imagens, login.html)
app.use(express.static(path.join(__dirname, 'public'), { index: false, etag: false, maxAge: 0 }));

// In-memory product and supplier store
let authToken = null;
let pxtSocket = null;
let productsMap = new Map(); // id -> product
let dollarRate = 5.3480;
let dollarVariation = -0.64;

// Busca cotação oficial do dólar comercial em tempo real com tripla redundância (HG Brasil, Frankfurter, AwesomeAPI)
async function fetchLiveDollar() {
  // Provedor 1: HG Brasil Finance (Extremamente preciso, atualizado minuto a minuto e sem rate-limit na VPS)
  try {
    const res = await axios.get('https://api.hgbrasil.com/finance?format=json', {
      timeout: 6000,
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    const usd = res.data?.results?.currencies?.USD;
    if (usd && (usd.buy || usd.sell)) {
      const rate = parseFloat(usd.buy || usd.sell);
      const varPct = parseFloat(usd.variation || 0);
      if (rate > 0) {
        dollarRate = rate;
        dollarVariation = varPct;
        invalidateProductsCache();
        localIo.emit('dollar_rate_update', { dollarRate, dollarVariation });
        return;
      }
    }
  } catch (e) {}

  // Provedor 2: Frankfurter / Banco Central Europeu
  try {
    const res = await axios.get('https://api.frankfurter.app/latest?from=USD&to=BRL', {
      timeout: 6000,
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    const rate = parseFloat(res.data?.rates?.BRL);
    if (rate > 0) {
      dollarRate = rate;
      invalidateProductsCache();
      localIo.emit('dollar_rate_update', { dollarRate, dollarVariation });
      return;
    }
  } catch (e) {}

  // Provedor 3: AwesomeAPI (Fallback)
  try {
    const res = await axios.get('https://economia.awesomeapi.com.br/last/USD-BRL', {
      timeout: 6000,
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    if (res.data?.USDBRL) {
      const bid = parseFloat(res.data.USDBRL.bid);
      const pct = parseFloat(res.data.USDBRL.pctChange);
      if (bid > 0) {
        dollarRate = bid;
        dollarVariation = pct;
        invalidateProductsCache();
        localIo.emit('dollar_rate_update', { dollarRate, dollarVariation });
      }
    }
  } catch (e) {}
}

let latestDate = '';
let totalSuppliers = 0;
let isSyncing = false;

function isAsIsProduct(p) {
  return PricingCore.isAsIsProduct(p);
}

// Modelos de seminovos não permitidos
function isDisallowedSeminovo(nameOrProduct, storage) {
  return PricingCore.isDisallowedSeminovo(nameOrProduct, storage);
}

function isDisallowedProduct(p) {
  return PricingCore.isDisallowedProduct(p);
}

// Cache de respostas HTTP de produtos para alta performance (1ms)
let cachedAuthedProductsJson = null;
let lastAuthedCacheTime = 0;
let cachedShieldedProductsJson = null;
let lastShieldedCacheTime = 0;
const PRODUCTS_CACHE_TTL_MS = 2000;

function invalidateProductsCache() {
  cachedAuthedProductsJson = null;
  cachedShieldedProductsJson = null;
  lastAuthedCacheTime = 0;
  lastShieldedCacheTime = 0;
}

// Filter & Classification for Apple Products (New and Seminovos)
function isAppleSeminovo(p) {
  if (!p) return false;
  if (isAsIsProduct(p)) return false;

  const cat = (p.category || '').toUpperCase().trim();
  const name = (p.name || '').toLowerCase();
  const desc = (p.description || '').toLowerCase();

  // Exclude Android / Non-Apple brands explicitly
  if (ANDROID_CATEGORIES.has(cat)) return false;
  if (
    name.includes('samsung') ||
    name.includes('xiaomi') ||
    name.includes('redmi') ||
    name.includes('poco') ||
    name.includes('motorola') ||
    name.includes('realme') ||
    name.includes('infinix')
  ) {
    return false;
  }

  const isSeminovoText = (
    cat === 'SEMI' ||
    name.includes('semi novo') ||
    name.includes('semi-novo') ||
    name.includes('seminovo') ||
    name.includes('usado') ||
    name.includes('vitrine') ||
    name.includes('grade a') ||
    name.includes('grade b') ||
    name.includes('recondicionado') ||
    name.includes('swp') ||
    name.includes('swap') ||
    desc.includes('semi novo') ||
    desc.includes('seminovo') ||
    desc.includes('vitrine') ||
    desc.includes('usado')
  );

  if (!isSeminovoText) return false;

  // Filtro de Seminovos: apenas do iPhone 13 para cima (exclui 13 Mini, anteriores ao 13, e 512GB/1TB no 15/16)
  if (isDisallowedSeminovo(p)) return false;

  // Must be an Apple device
  const isApple = (
    APPLE_CATEGORIES.has(cat) ||
    cat === 'SEMI' ||
    name.includes('iphone') ||
    name.includes('macbook') ||
    name.includes('ipad') ||
    name.includes('apple watch') ||
    name.includes('watch') ||
    name.includes('airpods') ||
    name.includes('imac') ||
    name.includes('apple tv')
  );

  return isApple;
}

function isAppleNovo(p) {
  if (!p) return false;
  if (isAsIsProduct(p)) return false;

  const cat = (p.category || '').toUpperCase().trim();
  const name = (p.name || '').toLowerCase();
  const desc = (p.description || '').toLowerCase();

  // Exclude Android explicitly
  if (ANDROID_CATEGORIES.has(cat)) return false;
  if (
    name.includes('samsung') ||
    name.includes('xiaomi') ||
    name.includes('redmi') ||
    name.includes('poco') ||
    name.includes('motorola') ||
    name.includes('realme') ||
    name.includes('infinix')
  ) {
    return false;
  }

  // Exclude Seminovos from Novo filter (mesmo os desconsiderados de seminovos não entram em novos)
  const isSeminovoText = (
    cat === 'SEMI' ||
    name.includes('semi novo') ||
    name.includes('semi-novo') ||
    name.includes('seminovo') ||
    name.includes('usado') ||
    name.includes('vitrine') ||
    name.includes('grade a') ||
    name.includes('grade b') ||
    name.includes('recondicionado') ||
    name.includes('swp') ||
    name.includes('swap') ||
    desc.includes('semi novo') ||
    desc.includes('seminovo') ||
    desc.includes('vitrine') ||
    desc.includes('usado')
  );
  if (isSeminovoText) return false;

  // Must be an Apple category (or named iPhone, Mac, iPad, Apple Watch, AirPods, iMac, Apple TV)
  if (APPLE_CATEGORIES.has(cat)) return true;
  if (
    name.includes('iphone') ||
    name.includes('macbook') ||
    name.includes('ipad') ||
    name.includes('apple watch') ||
    name.includes('airpods') ||
    name.includes('imac') ||
    name.includes('apple tv')
  ) {
    return true;
  }

  return false;
}

function processAppleProduct(p) {
  if (!p) return null;
  if (isDisallowedProduct(p)) return null; // Exclui modelos AS IS, CPO e seminovos bloqueados
  if (isAppleSeminovo(p)) {
    return { ...p, isSeminovo: true, condition: 'SEMINOVO' };
  }
  if (isAppleNovo(p)) {
    return { ...p, isSeminovo: false, condition: 'NOVO' };
  }
  return null;
}

// 1. Authenticate with Buscador PXT API (Suporta Token Fixo ou Login)
async function authenticate() {
  // Se houver um token configurado nas variáveis de ambiente ou salvo em arquivo
  const envToken = process.env.PXT_AUTH_TOKEN;
  const tokenFilePath = path.join(__dirname, 'data', 'pxt_token.txt');
  
  if (envToken && envToken.trim().length > 20) {
    console.log('[Auth] 🔑 Usando PXT_AUTH_TOKEN das variáveis de ambiente.');
    authToken = envToken.trim();
    return authToken;
  }

  if (fs.existsSync(tokenFilePath)) {
    try {
      const savedToken = fs.readFileSync(tokenFilePath, 'utf8').trim();
      if (savedToken && savedToken.length > 20) {
        console.log('[Auth] 🔑 Usando token persistente salvo em data/pxt_token.txt.');
        authToken = savedToken;
        return authToken;
      }
    } catch (e) {}
  }

  try {
    if (!USER_EMAIL || !USER_PASS) throw new Error('Configure PXT_EMAIL e PXT_PASSWORD ou PXT_AUTH_TOKEN para conectar ao PXT.');
    console.log('[Auth] Autenticando com Buscador PXT via credenciais...');
    const resp = await axios.post(`${PXT_BASE_URL}/auth/login`, {
      email: USER_EMAIL,
      password: USER_PASS,
      forceLogin: true
    }, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 10000
    });

    authToken = resp.data.access_token;
    console.log('[Auth] Autenticação bem-sucedida! Token obtido.');
    return authToken;
  } catch (err) {
    const errorMsg = err.response?.data?.message || err.message;
    console.error('[Auth] Erro ao autenticar:', errorMsg);
    // Se for bloqueio anti-robô, preserva o catálogo em memória / snapshot
    if (errorMsg && errorMsg.includes('anti-robô')) {
      console.warn('[Auth] ⚠️ Bloqueio Cloudflare detectado. O servidor usará o catálogo sincronizado via push ou snapshot.');
    }
    throw err;
  }
}

// 2. Fetch initial product catalog
async function fetchProducts() {
  if (!authToken) await authenticate();
  isSyncing = true;
  try {
    console.log('[Catalog] Baixando catálogo atualizado...');
    const [dateRes, prodRes] = await Promise.all([
      axios.get(`${PXT_BASE_URL}/products/latest-date`, {
        headers: { Authorization: `Bearer ${authToken}` }
      }).catch(() => ({ data: { date: '' } })),
      axios.get(`${PXT_BASE_URL}/products`, {
        headers: { Authorization: `Bearer ${authToken}` }
      })
    ]);

    latestDate = dateRes.data?.date || '';

    let payload = prodRes.data;
    if (payload && typeof payload.data === 'string') {
      if (payload.data.startsWith('U2FsdGVkX1')) {
        // Payload HTTP criptografado; a sincronização completa ocorre instantaneamente via WebSocket (products_sync_request)
        if (pxtSocket && pxtSocket.connected) {
          const todayStr = `${String(new Date().getDate()).padStart(2, '0')}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
          pxtSocket.emit('products_sync_request', { date: latestDate || todayStr });
        }
        isSyncing = false;
        return Array.from(productsMap.values());
      }
      try {
        payload = JSON.parse(payload.data);
      } catch (e) {
        console.error('[Catalog] Falha no parse da string:', e.message);
      }
    }

    const rawList = Array.isArray(payload) ? payload : (payload.data || payload.products || []);
    dollarRate = payload.dollarRate || dollarRate;
    dollarVariation = payload.dollarVariation || dollarVariation;
    totalSuppliers = payload.totalSuppliers || totalSuppliers;

    if (!rawList || rawList.length === 0) {
      console.warn('[Catalog] ⚠️ Resposta vazia recebida do PXT. Preservando catálogo em memória intacto.');
      isSyncing = false;
      return Array.from(productsMap.values());
    }

    // SWAP ATÔMICO: Monta em mapa secundário para NUNCA zerar o catálogo em memória
    const nextMap = new Map();
    let novosCount = 0;
    let seminovosCount = 0;
    let ignoredCount = 0;

    for (const p of rawList) {
      const processed = processAppleProduct(p);
      if (processed) {
        nextMap.set(String(processed.id), processed);
        if (processed.isSeminovo) seminovosCount++;
        else novosCount++;
      } else {
        ignoredCount++;
      }
    }

    if (nextMap.size > 0) {
      productsMap.clear();
      for (const [k, v] of nextMap.entries()) {
        productsMap.set(k, v);
      }
    }

    console.log(`[Catalog] Carga concluída: ${novosCount} Apple Novos + ${seminovosCount} Apple Seminovos carregados (${productsMap.size} total). (${ignoredCount} Android/Outros ignorados)`);
    isSyncing = false;
    scheduleCatalogSnapshot();

    // Notificar clientes conectados (Autenticados em tempo real, Visitantes com throttle)
    broadcastCatalogReloaded({
      total: productsMap.size,
      dollarRate,
      dollarVariation,
      latestDate
    });

    return Array.from(productsMap.values());
  } catch (err) {
    console.error('[Catalog] Erro ao buscar produtos:', err.response?.data || err.message);
    isSyncing = false;
    throw err;
  }
}

// =========================================================================
// EMISSÃO SEGURA E ROTEAMENTO DE WEBSOCKETS (ROOMS: authed_users vs public_visitors)
// =========================================================================
function broadcastProductCreated(fullItem) {
  if (!fullItem) return;
  localIo.to('authed_users').emit('product_created', fullItem);
  const shielded = formatProductForClient(fullItem, false);
  if (shielded) {
    localIo.to('public_visitors').emit('product_created', shielded);
  }
}

function broadcastProductUpdated(fullItem) {
  if (!fullItem) return;
  localIo.to('authed_users').emit('product_updated', fullItem);
  const shielded = formatProductForClient(fullItem, false);
  if (shielded) {
    localIo.to('public_visitors').emit('product_updated', shielded);
  }
}

function broadcastPriceChanged(id, oldPrice, newPrice, updatedAt, product) {
  localIo.to('authed_users').emit('price_changed', {
    id,
    oldPrice,
    newPrice,
    updatedAt,
    product
  });
  const shielded = formatProductForClient(product, false);
  if (shielded) {
    localIo.to('public_visitors').emit('price_changed', {
      id,
      oldPrice: shielded.price,
      newPrice: shielded.price,
      updatedAt,
      product: shielded
    });
  }
}

function broadcastProductDeleted(id) {
  localIo.emit('product_deleted', { id });
}

let lastPublicCatalogReloadTime = 0;
let pendingPublicCatalogReloadTimer = null;

function broadcastCatalogReloaded(stats) {
  invalidateProductsCache();
  // Usuários autenticados (lojistas/admin) recebem atualização em tempo real imediatamente
  localIo.to('authed_users').emit('catalog_reloaded', stats);

  // Visitantes da Loja Física têm broadcast limitado a 1 vez a cada 20s para impedir congelamento de tela
  const now = Date.now();
  const timeSinceLast = now - lastPublicCatalogReloadTime;
  if (timeSinceLast >= 20000) {
    lastPublicCatalogReloadTime = now;
    if (pendingPublicCatalogReloadTimer) {
      clearTimeout(pendingPublicCatalogReloadTimer);
      pendingPublicCatalogReloadTimer = null;
    }
    localIo.to('public_visitors').emit('catalog_reloaded', stats);
  } else if (!pendingPublicCatalogReloadTimer) {
    pendingPublicCatalogReloadTimer = setTimeout(() => {
      lastPublicCatalogReloadTime = Date.now();
      pendingPublicCatalogReloadTimer = null;
      localIo.to('public_visitors').emit('catalog_reloaded', {
        total: productsMap.size,
        dollarRate,
        dollarVariation,
        latestDate
      });
    }, 20000 - timeSinceLast);
  }
}

let isReconnecting = false;

// Robust self-healing reconnect and sync function
async function reconnectAndSync(reason = 'watchdog') {
  if (isReconnecting) return;
  isReconnecting = true;
  console.log(`[Watchdog] 🔄 Disparando auto-reconexão e ressincronização (Motivo: ${reason})...`);
  localIo.emit('pxt_connection_status', { connected: false, status: 'reconnecting', reason });

  try {
    await authenticate();
    await fetchProducts().catch(e => console.warn('[Watchdog] Fetch products aviso:', e.message));
    connectPxtWebSocket();
    isReconnecting = false;
  } catch (err) {
    console.error('[Watchdog] Erro ao reconectar:', err.message);
    isReconnecting = false;
  }
}

// 3. Connect to PXT Remote WebSocket Server for live events
function connectPxtWebSocket() {
  if (!authToken) return;
  if (pxtSocket) {
    try { pxtSocket.removeAllListeners(); pxtSocket.disconnect(); } catch (e) {}
  }

  console.log('[WebSocket] Conectando ao servidor em tempo real da PXT...');
  pxtSocket = ioClient(PXT_BASE_URL, {
    auth: { token: authToken, theme: 'dark' },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1500,
    reconnectionDelayMax: 5000,
    timeout: 10000,
    path: '/socket.io'
  });

  pxtSocket.on('connect', () => {
    console.log('[WebSocket] ✅ Conectado com sucesso ao servidor oficial PXT!');
    const todayStr = `${String(new Date().getDate()).padStart(2, '0')}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
    const dateQuery = latestDate || todayStr;
    pxtSocket.emit('products_sync_request', { date: dateQuery });
    localIo.emit('pxt_connection_status', { connected: true, status: 'connected', date: dateQuery });
  });

  pxtSocket.on('connect_error', (err) => {
    console.warn('[WebSocket] Aviso de erro na conexão:', err.message);
    localIo.emit('pxt_connection_status', { connected: false, status: 'error', error: err.message });
    if (err.message && (err.message.includes('Unauthorized') || err.message.includes('jwt') || err.message.includes('401') || err.message.includes('token'))) {
      setTimeout(() => reconnectAndSync('socket_auth_error'), 2000);
    }
  });

  pxtSocket.on('disconnect', (reason) => {
    console.log('[WebSocket] ⚠️ Conexão perdida com a PXT:', reason);
    localIo.emit('pxt_connection_status', { connected: false, status: 'disconnected', reason });
    // Tenta reconectar imediatamente se o servidor encerrou a sessão
    setTimeout(() => reconnectAndSync('disconnect_' + reason), 2000);
  });

  pxtSocket.on('duplicateLogin', (data) => {
    console.warn('[WebSocket] ⚠️ Aviso: login realizado em outro dispositivo/aba.');
    localIo.emit('pxt_connection_status', { connected: false, status: 'duplicate_login' });
    // Reconecta automaticamente após breve intervalo de 6 segundos
    setTimeout(() => reconnectAndSync('duplicate_login'), 6000);
  });

  // Event: Price changed
  pxtSocket.on('price_changed', (data) => {
    if (!data || !data.id) return;
    const id = String(data.id);
    const existing = productsMap.get(id);
    const newPrice = Number(data.changes?.price || data.price);

    if (existing && newPrice) {
      const oldPrice = existing.price;
      existing.price = newPrice;
      existing.updatedAt = data.updatedAt || new Date().toISOString();
      productsMap.set(id, existing);

      console.log(`[Tempo Real] Preço alterado: ${existing.name} (${existing.storage || ''}) - De R$ ${oldPrice} para R$ ${newPrice} [${existing.supplier?.name}]`);
      broadcastPriceChanged(id, oldPrice, newPrice, existing.updatedAt, existing);
    }
  });

  // Event: Product updated or Stock changed
  const handleUpdate = (item) => {
    if (!item || !item.id) return;
    const id = String(item.id);
    const rawFull = { ...(productsMap.get(id) || {}), ...item, ...(item.changes || {}) };
    const fullItem = processAppleProduct(rawFull);

    if (!fullItem) {
      if (productsMap.has(id)) {
        productsMap.delete(id);
        broadcastProductDeleted(id);
      }
      return;
    }

    productsMap.set(id, fullItem);
    console.log(`[Tempo Real] Produto atualizado (${fullItem.condition}): ${fullItem.name} - R$ ${fullItem.price}`);
    broadcastProductUpdated(fullItem);
  };

  pxtSocket.on('product_updated', handleUpdate);
  pxtSocket.on('stock_changed', handleUpdate);

  // Event: Product created
  pxtSocket.on('product_created', (item) => {
    if (!item || !item.id) return;
    const rawFull = { ...item, ...(item.changes || {}) };
    const fullItem = processAppleProduct(rawFull);
    if (fullItem) {
      productsMap.set(String(fullItem.id), fullItem);
      console.log(`[Tempo Real] Novo produto adicionado (${fullItem.condition}): ${fullItem.name} - R$ ${fullItem.price} [${fullItem.supplier?.name}]`);
      broadcastProductCreated(fullItem);
    }
  });

  // Event: Product deleted
  pxtSocket.on('product_deleted', (data) => {
    if (!data || !data.id) return;
    const id = String(data.id);
    if (productsMap.has(id)) {
      const prod = productsMap.get(id);
      productsMap.delete(id);
      console.log(`[Tempo Real] Produto removido/esgotado: ${prod?.name} (${id})`);
      broadcastProductDeleted(id);
    }
  });

  // Event: Delta updates
  pxtSocket.on('products_delta', (delta) => {
    if (!delta) return;
    const created = delta.created || delta.inserted || [];
    const updated = delta.updated || [];
    const deleted = delta.deleted || [];

    // Se veio data nova ou é snapshot, atualiza a data
    const isNewDate = delta.date && delta.date !== latestDate;
    if (isNewDate) {
      console.log(`[Tempo Real] 📅 Nova data de catálogo recebida via delta: ${latestDate} -> ${delta.date}`);
      latestDate = delta.date;
    }

    if (delta.dollarRate) dollarRate = delta.dollarRate;
    if (delta.dollarVariation) dollarVariation = delta.dollarVariation;
    if (delta.totalSuppliers) totalSuppliers = delta.totalSuppliers;

    const isMassive = created.length > 30 || delta.snapshot === true || isNewDate;

    // Se for uma virada de dia ou snapshot maciço com itens novos, prepara os itens antes de substituir
    if ((isNewDate || delta.snapshot === true) && (created.length > 50)) {
      const freshMap = new Map();
      for (const rawItem of created) {
        const item = processAppleProduct(rawItem);
        if (item) freshMap.set(String(item.id), item);
      }
      for (const rawItem of updated) {
        const item = processAppleProduct(rawItem);
        if (item) freshMap.set(String(item.id), item);
      }
      if (freshMap.size > 0) {
        productsMap.clear();
        for (const [k, v] of freshMap.entries()) {
          productsMap.set(k, v);
        }
      }
    } else {
      for (const rawItem of created) {
        const item = processAppleProduct(rawItem);
        if (item) {
          productsMap.set(String(item.id), item);
          if (!isMassive) {
            broadcastProductCreated(item);
          }
        }
      }
      for (const rawItem of updated) {
        const item = processAppleProduct(rawItem);
        if (item) {
          productsMap.set(String(item.id), item);
          if (!isMassive) {
            broadcastProductUpdated(item);
          }
        }
      }
    }

    for (const id of deleted) {
      const sId = String(typeof id === 'object' ? id.id : id);
      if (productsMap.has(sId)) {
        productsMap.delete(sId);
        if (!isMassive) {
          broadcastProductDeleted(sId);
        }
      }
    }

    scheduleCatalogSnapshot();
    console.log(`[Tempo Real] Delta processado: +${created.length}, ~${updated.length}, -${deleted.length} (Total Apple Ativos: ${productsMap.size}, Data: ${latestDate})`);

    // Notifica clientes conectados com broadcast seguro e throttled
    broadcastCatalogReloaded({
      total: productsMap.size,
      dollarRate,
      dollarVariation,
      latestDate
    });
  });

  // Event: Supplier status changed
  pxtSocket.on('supplier_status_changed', (statusData) => {
    if (!statusData) return;
    localIo.emit('supplier_status_changed', statusData);
  });
}

// =========================================================================
// 4. AUTENTICAÇÃO, ANTI-PIRATARIA & ENDPOINTS REST
// =========================================================================

// Estado compartilhado do ajuste de pre?os do admin; controle exclusivo do Cledson.
const adminPricingFile = path.join(__dirname, 'data', 'admin-pricing.json');
let adminPricing = { active: true, version: Date.now() };
if (fs.existsSync(adminPricingFile)) {
  const saved = JSON.parse(fs.readFileSync(adminPricingFile, 'utf8'));
  if (typeof saved.active !== 'boolean') throw new Error('Configura??o de pre?os inv?lida');
  adminPricing = { active: saved.active, version: Math.max(Date.now(), Number(saved.version) || 0) };
}
function userPricingState(user) {
  const username = (user.username || '').toLowerCase();
  return {
    dfuActive: username === 'admin' && adminPricing.active,
    pricingVersion: adminPricing.version,
    ...(username === 'cledson' ? { adminDfuActive: adminPricing.active } : {})
  };
}

// Endpoint leve de Health Check para UptimeRobot / Keep-Alive
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// Middleware de Proteção de API para Usuários Autenticados
const requireAuthApi = asyncHandler(async (req, res, next) => {
  const token = auth.getSessionTokenFromRequest(req);
  if (!token) {
    return res.status(401).json({ error: 'Acesso não autorizado. Faça login.', code: 'UNAUTHORIZED' });
  }
  const user = await auth.findUserBySessionToken(token);
  if (!user) {
    return res.status(401).json({ error: 'Sessão inválida ou desconectada em outro aparelho.', code: 'SESSION_EXPIRED' });
  }
  if (user.role !== 'admin' && user.status === 'blocked') {
    return res.status(403).json({ error: 'Conta suspensa. Entre em contato com o administrador.', code: 'ACCOUNT_BLOCKED' });
  }
  req.user = user;
  next();
});

// Middleware de Proteção de API para Administrador
const requireAdminApi = asyncHandler(async (req, res, next) => {
  const token = auth.getSessionTokenFromRequest(req);
  if (!token) return res.status(401).json({ error: 'Não autenticado' });
  const user = await auth.findUserBySessionToken(token);
  if (!user || user.role !== 'admin') {
    return res.status(403).json({ error: 'Acesso restrito ao administrador.' });
  }
  req.user = user;
  next();
});

// --- ROTAS DE AUTENTICAÇÃO ---

app.post('/api/auth/login', asyncHandler(async (req, res) => {
  const { username, password } = req.body || {};
  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const result = await auth.loginUser(username, password, clientIp, localIo);
  if (result.success) {
    setSessionCookie(res, result.sessionToken, result.user?.role === 'admin');
    return res.json({ success: true, user: result.user });
  }
  return res.status(401).json(result);
}));

app.post('/api/auth/logout', asyncHandler(async (req, res) => {
  const token = auth.getSessionTokenFromRequest(req);
  if (token) await auth.logoutUser(token);
  if (token) localIo.in(`session_${token}`).disconnectSockets(true);
  clearSessionCookie(res);
  res.json({ success: true });
}));

app.get('/api/auth/me', asyncHandler(async (req, res) => {
  const token = auth.getSessionTokenFromRequest(req);
  if (!token) return res.status(401).json({ error: 'Não autenticado' });
  const user = await auth.findUserBySessionToken(token);
  if (!user) return res.status(401).json({ error: 'Sessão inválida ou expirada' });
  res.json({
    id: user.id,
    storeName: user.store_name,
    ownerName: user.owner_name,
    username: user.username,
    role: user.role,
    ...userPricingState(user),
    expiresAt: user.expires_at,
    customMargins: user.custom_margins || null,
    customCardRates: user.custom_card_rates || null
  });
}));

app.post('/api/pricing/admin-dfu', requireAuthApi, (req, res) => {
  if ((req.user.username || '').toLowerCase() !== 'cledson') {
    return res.status(403).json({ error: 'Acesso n?o autorizado.' });
  }
  if (typeof req.body.active !== 'boolean') return res.status(400).json({ error: 'Estado inv?lido.' });
  if (req.body.active !== adminPricing.active) {
    const next = { active: req.body.active, version: Math.max(Date.now(), adminPricing.version + 1) };
    fs.mkdirSync(path.dirname(adminPricingFile), { recursive: true });
    fs.writeFileSync(adminPricingFile + '.tmp', JSON.stringify(next));
    fs.renameSync(adminPricingFile + '.tmp', adminPricingFile);
    adminPricing = next;
    localIo.to('pricing_admin').emit('pricing_updated', userPricingState({ username: 'admin' }));
    localIo.to('pricing_controller').emit('pricing_updated', userPricingState({ username: 'cledson' }));
  }
  res.json({ success: true, ...userPricingState(req.user) });
});

// --- ROTAS ADMINISTRATIVAS (GESTÃO DE LOJISTAS) ---
app.get('/api/admin/lojistas', requireAdminApi, asyncHandler(async (req, res) => {
  const list = await auth.listLojistas();
  res.json(list);
}));

app.post('/api/admin/lojistas', requireAdminApi, asyncHandler(async (req, res) => {
  try {
    const lojista = await auth.createLojista(req.body);
    res.json({ success: true, lojista });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}));

app.post('/api/admin/lojistas/:id/renew', requireAdminApi, asyncHandler(async (req, res) => {
  try {
    const result = await auth.renewLojista(req.params.id, req.body.days || 30);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}));

app.post('/api/admin/lojistas/:id/block', requireAdminApi, asyncHandler(async (req, res) => {
  try {
    const result = await auth.toggleBlockLojista(req.params.id);
    if (result.status === 'blocked') {
      localIo.to(`user_${req.params.id}`).emit('session_terminated', { reason: 'Sua conta foi suspensa.' });
      localIo.in(`user_${req.params.id}`).disconnectSockets(true);
    }
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}));

// =========================================================================
// MÓDULO DE ORÇAMENTOS E PROPOSTAS COMERCIAIS (MUNDO APPLE DELIVERY)
// =========================================================================

// Listar orçamentos com filtros e dashboard
function getUserCardRates(user) {
  return user?.custom_card_rates && (user.role !== 'admin' || (user.username || '').toLowerCase() === 'cledson')
    ? user.custom_card_rates : loadCardRates();
}

app.get('/api/quotes', requireAuthApi, (req, res) => {
  try {
    const filters = {
      search: req.query.search || '',
      status: req.query.status || 'ALL'
    };
    const result = quotesManager.listQuotes(filters, req.user);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao carregar orçamentos: ' + err.message });
  }
});

// Obter orçamento por ID ou Código
app.get('/api/quotes/:id', requireAuthApi, (req, res) => {
  try {
    const quote = quotesManager.getQuoteById(req.params.id, req.user);
    if (!quote) return res.status(404).json({ error: 'Orçamento não encontrado.' });
    res.json({ success: true, quote });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar orçamento: ' + err.message });
  }
});

// Criar novo orçamento
app.post('/api/quotes', requireAuthApi, (req, res) => {
  try {
    const quote = quotesManager.createQuote(req.body, req.user, getUserCardRates(req.user));
    res.json({ success: true, quote });
  } catch (err) {
    res.status(400).json({ error: 'Erro ao criar orçamento: ' + err.message });
  }
});

// Atualizar orçamento existente
app.put('/api/quotes/:id', requireAuthApi, (req, res) => {
  try {
    const updated = quotesManager.updateQuote(req.params.id, req.body, req.user, getUserCardRates(req.user));
    if (!updated) return res.status(404).json({ error: 'Orçamento não encontrado.' });
    res.json({ success: true, quote: updated });
  } catch (err) {
    res.status(400).json({ error: 'Erro ao atualizar orçamento: ' + err.message });
  }
});

// Atualizar status do orçamento (RASCUNHO, ENVIADO, APROVADO, RECUSADO, EXPIRADO)
app.patch('/api/quotes/:id/status', requireAuthApi, (req, res) => {
  try {
    const { status } = req.body || {};
    if (!status) return res.status(400).json({ error: 'Status obrigatório.' });
    const updated = quotesManager.updateQuoteStatus(req.params.id, status, req.user);
    if (!updated) return res.status(404).json({ error: 'Orçamento não encontrado.' });
    res.json({ success: true, quote: updated });
  } catch (err) {
    res.status(400).json({ error: 'Erro ao atualizar status: ' + err.message });
  }
});

// Duplicar orçamento
app.post('/api/quotes/:id/duplicate', requireAuthApi, (req, res) => {
  try {
    const duplicated = quotesManager.duplicateQuote(req.params.id, req.user, getUserCardRates(req.user));
    if (!duplicated) return res.status(404).json({ error: 'Orçamento não encontrado para duplicar.' });
    res.json({ success: true, quote: duplicated });
  } catch (err) {
    res.status(400).json({ error: 'Erro ao duplicar orçamento: ' + err.message });
  }
});

// Excluir orçamento
app.delete('/api/quotes/:id', requireAuthApi, (req, res) => {
  try {
    const ok = quotesManager.deleteQuote(req.params.id, req.user);
    if (!ok) return res.status(404).json({ error: 'Orçamento não encontrado para exclusão.' });
    res.json({ success: true, message: 'Orçamento excluído com sucesso.' });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao excluir orçamento: ' + err.message });
  }
});


app.put('/api/admin/lojistas/:id/password', requireAdminApi, asyncHandler(async (req, res) => {
  try {
    const result = await auth.updateLojistaPassword(req.params.id, req.body.newPassword);
    localIo.to(`user_${req.params.id}`).emit('session_terminated', { reason: 'Sua senha foi alterada. Faça login novamente.' });
    localIo.in(`user_${req.params.id}`).disconnectSockets(true);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}));

app.delete('/api/admin/lojistas/:id', requireAdminApi, asyncHandler(async (req, res) => {
  try {
    const result = await auth.deleteLojista(req.params.id);
    localIo.in(`user_${req.params.id}`).disconnectSockets(true);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}));

function isCpoProduct(p) {
  if (!p) return false;
  const n = (p.name || '').toUpperCase();
  const d = (p.description || '').toUpperCase();
  const r = (p.region || '').toUpperCase();
  return n.includes('CPO') || d.includes('CPO') || r.includes('CPO');
}

// Salvamento e gestão de snapshots históricos de catálogo por data (Debounced & Não-bloqueante)
let snapshotDebounceTimer = null;
let isWritingSnapshot = false;

function scheduleCatalogSnapshot() {
  if (snapshotDebounceTimer) return;
  snapshotDebounceTimer = setTimeout(async () => {
    snapshotDebounceTimer = null;
    await performCatalogSnapshotAsync();
  }, 20000); // Debounce de 20 segundos
}

async function performCatalogSnapshotAsync() {
  if (isWritingSnapshot) return;
  isWritingSnapshot = true;
  try {
    const dataDir = path.join(__dirname, 'data');
    await fs.promises.mkdir(dataDir, { recursive: true });

    const todayStr = new Date().toISOString().split('T')[0];
    const todayPath = path.join(dataDir, `snapshot_${todayStr}.json`);
    const latestPath = path.join(dataDir, `snapshot_latest.json`);
    const tempPath = path.join(dataDir, `snapshot_temp_${Date.now()}.json`);

    const productsList = Array.from(productsMap.values()).filter(p => !isDisallowedProduct(p));
    if (productsList.length > 0) {
      const jsonContent = JSON.stringify(productsList);
      await fs.promises.writeFile(tempPath, jsonContent, 'utf-8');
      await fs.promises.copyFile(tempPath, todayPath);
      await fs.promises.rename(tempPath, latestPath);
      console.log(`[Snapshot] 💾 Snapshot atualizado com sucesso (${productsList.length} itens).`);
    }
  } catch (err) {
    console.warn('[Snapshot] Erro ao salvar snapshot assíncrono:', err.message);
  } finally {
    isWritingSnapshot = false;
  }
}

function saveCatalogSnapshot(options = {}) {
  if (options && options.immediate) {
    performCatalogSnapshotAsync().catch(err => {
      console.warn('[Snapshot] Erro imediato:', err.message);
    });
  } else {
    scheduleCatalogSnapshot();
  }
}

function getHistoricalCatalog(dateParam) {
  const latest = !dateParam || dateParam === 'latest';
  try {
    const dataDir = path.join(__dirname, 'data');
    if (!fs.existsSync(dataDir)) return [];
    let target = dateParam;
    if (target === 'yesterday') {
      const date = new Date();
      date.setDate(date.getDate() - 1);
      target = date.toISOString().slice(0, 10);
    } else if (/^\d{2}-\d{2}$/.test(target || '')) {
      const [day, month] = target.split('-');
      target = `${new Date().getFullYear()}-${month}-${day}`;
    }
    const files = fs.readdirSync(dataDir).filter(name => /^snapshot_\d{4}-\d{2}-\d{2}\.json$/.test(name))
      .sort().reverse();
    const candidates = latest ? ['snapshot_latest.json', ...files, 'cached_catalog.json']
      : /^\d{4}-\d{2}-\d{2}$/.test(target || '') ? [`snapshot_${target}.json`] : [];
    for (const name of candidates) {
      const file = path.join(dataDir, name);
      if (!fs.existsSync(file)) continue;
      const products = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (Array.isArray(products)) return products.filter(product => !isDisallowedProduct(product));
    }
  } catch (error) {
    console.warn('[Snapshot]', error.message);
  }
  return latest ? Array.from(productsMap.values()).filter(product => !isDisallowedProduct(product)) : [];
}

// --- ROTAS E GESTÃO DE MARGENS DE LUCRO / LOJA FÍSICA ---
const MARGINS_FILE_PATH = path.join(__dirname, 'data', 'margins.json');

function getDefaultMargins() {
  return PricingCore.getDefaultMargins();
}

function loadMargins() {
  try {
    if (fs.existsSync(MARGINS_FILE_PATH)) {
      const data = JSON.parse(fs.readFileSync(MARGINS_FILE_PATH, 'utf-8'));
      return {
        categories: { ...PricingCore.getDefaultMargins().categories, ...(data.categories || {}) },
        products: data.products || {}
      };
    }
  } catch (err) {
    console.warn('[Margens] Erro ao carregar margens:', err.message);
  }
  return PricingCore.getDefaultMargins();
}

function saveMargins(marginsData) {
  for (const group of [marginsData.categories || {}, marginsData.products || {}]) {
    for (const value of Object.values(group)) {
      if (!Number.isFinite(Number(value)) || Number(value) < 0) {
        const error = new Error('Margem inválida.'); error.status = 400; throw error;
      }
    }
  }
  try {
    const dataDir = path.join(__dirname, 'data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    const temporary = `${MARGINS_FILE_PATH}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(marginsData, null, 2), 'utf-8');
    fs.renameSync(temporary, MARGINS_FILE_PATH);
    invalidateProductsCache();
    localIo.emit('margins_updated');
    return true;
  } catch (err) {
    console.error('[Margens] Erro ao salvar margens:', err.message);
    return false;
  }
}

// --- CONFIGURAÇÃO DE TAXAS DA MAQUININHA DE CARTÃO (LOJA FÍSICA) ---
const CARD_RATES_FILE_PATH = path.join(__dirname, 'data', 'card_rates.json');

function getDefaultCardRates() {
  return {
    baseRate: 2.69,
    calculationMode: 'factor', // 'factor' repassa a taxa para receber valor líquido: valor / (1 - taxa/100)
    installmentRates: {
      "1": 3.05,
      "2": 1.50,
      "3": 2.25,
      "4": 3.00,
      "5": 3.75,
      "6": 4.50,
      "7": 5.25,
      "8": 6.00,
      "9": 6.75,
      "10": 7.50,
      "11": 8.25,
      "12": 9.00,
      "13": 9.75,
      "14": 10.50,
      "15": 11.25,
      "16": 12.00,
      "17": 12.75,
      "18": 13.50
    }
  };
}

function loadCardRates() {
  try {
    if (fs.existsSync(CARD_RATES_FILE_PATH)) {
      const data = JSON.parse(fs.readFileSync(CARD_RATES_FILE_PATH, 'utf-8'));
      return {
        baseRate: typeof data.baseRate === 'number' ? data.baseRate : 2.69,
        calculationMode: data.calculationMode || 'factor',
        installmentRates: { ...getDefaultCardRates().installmentRates, ...(data.installmentRates || {}) }
      };
    }
  } catch (err) {
    console.warn('[Taxas Maquininha] Erro ao ler taxas:', err.message);
  }
  return getDefaultCardRates();
}

function saveCardRates(ratesData) {
  validateCardRates(ratesData);
  try {
    const dataDir = path.join(__dirname, 'data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    const temporary = `${CARD_RATES_FILE_PATH}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(ratesData, null, 2), 'utf-8');
    fs.renameSync(temporary, CARD_RATES_FILE_PATH);
    localIo.emit('card_rates_updated');
    return true;
  } catch (err) {
    console.error('[Taxas Maquininha] Erro ao salvar taxas:', err.message);
    return false;
  }
}

function validateCardRates(rates) {
  try {
    for (let count = 1; count <= 18; count++) QuoteCore.installment(100, 0, count, rates);
  } catch (error) {
    error.status = 400;
    throw error;
  }
}

// Rota de margens ativas (se logado como lojista, retorna as margens DELE; se admin, globais; se NÃO LOGADO, esconde tudo)
app.get('/api/margins', asyncHandler(async (req, res) => {
  const token = auth.getSessionTokenFromRequest(req);
  if (token) {
    const user = await auth.findUserBySessionToken(token);
    if (user && user.custom_margins && (user.role !== 'admin' || (user.username || '').toLowerCase() === 'cledson')) {
      return res.json({ success: true, margins: user.custom_margins, isLojistaCustom: true });
    }
    if (user) {
      return res.json({ success: true, margins: loadMargins(), isLojistaCustom: false });
    }
  }
  // Visitante não autenticado: esconde completamente as margens secretas
  res.json({ success: true, margins: { categories: {}, products: {} }, isShielded: true });
}));

// Endpoint para o lojista ou admin atualizar suas próprias margens (incluindo exceção por modelo)
app.post('/api/margins/custom', asyncHandler(async (req, res) => {
  const token = auth.getSessionTokenFromRequest(req);
  if (!token) return res.status(401).json({ error: 'Faça login para salvar margens.' });
  const user = await auth.findUserBySessionToken(token);
  if (!user) return res.status(401).json({ error: 'Sessão inválida.' });

  const { categories, products, singleProduct, singleMargin } = req.body || {};

  if (user.role === 'admin') {
    // Admin atualiza margens globais
    const current = loadMargins();
    let updatedProducts = products || { ...current.products };
    if (singleProduct) {
      if (singleMargin === null || singleMargin === undefined || singleMargin === '') {
        delete updatedProducts[singleProduct.toUpperCase()];
      } else {
        updatedProducts[singleProduct.toUpperCase()] = Number(singleMargin);
      }
    }

    const updated = {
      categories: categories ? { ...current.categories, ...categories } : current.categories,
      products: updatedProducts
    };

    if (saveMargins(updated)) {
      return res.json({ success: true, margins: updated });
    }
    return res.status(500).json({ error: 'Falha ao salvar margens globais' });
  }

  // Lojista atualiza SUAS margens exclusivas
  const currentCustom = user.custom_margins || {
    categories: {
      SEMINOVOS: 0, IPH18: 0, IPH: 0, MCB_AIR: 0, MCB_PRO: 0,
      IPAD: 0, RLG: 0, IMAC: 0, PODS: 0, ACSS: 0
    },
    products: {}
  };

  let updatedProducts = products ? { ...products } : { ...(currentCustom.products || {}) };
  if (singleProduct) {
    if (singleMargin === null || singleMargin === undefined || singleMargin === '') {
      delete updatedProducts[singleProduct.toUpperCase()];
    } else {
      updatedProducts[singleProduct.toUpperCase()] = Number(singleMargin);
    }
  }

  const newCustom = {
    categories: categories ? { ...(currentCustom.categories || {}), ...categories } : (currentCustom.categories || {}),
    products: updatedProducts
  };

  await auth.updateLojistaMargins(user.id, newCustom);
  res.json({ success: true, margins: newCustom });
}));

// Rotas protegidas de Admin para gerenciar margens globais
app.get('/api/admin/margins', asyncHandler(async (req, res) => {
  const token = auth.getSessionTokenFromRequest(req);
  const user = await auth.findUserBySessionToken(token);
  if (!user || user.role !== 'admin') {
    return res.status(403).json({ error: 'Acesso negado' });
  }
  res.json({ success: true, margins: loadMargins() });
}));

app.post('/api/admin/margins', asyncHandler(async (req, res) => {
  const token = auth.getSessionTokenFromRequest(req);
  const user = await auth.findUserBySessionToken(token);
  if (!user || user.role !== 'admin') {
    return res.status(403).json({ error: 'Acesso negado' });
  }

  const { categories, products } = req.body || {};
  const current = loadMargins();

  const updated = {
    categories: { ...current.categories, ...categories },
    products: products || current.products
  };

  if (saveMargins(updated)) {
    res.json({ success: true, margins: updated });
  } else {
    res.status(500).json({ error: 'Falha ao salvar margens de lucro' });
  }
}));

// Rota de taxas da maquininha ativas (se logado como lojista, retorna as taxas DELE; caso contrário, globais)
app.get('/api/card-rates', asyncHandler(async (req, res) => {
  const token = auth.getSessionTokenFromRequest(req);
  if (token) {
    const user = await auth.findUserBySessionToken(token);
    if (user && user.custom_card_rates && (user.role !== 'admin' || (user.username || '').toLowerCase() === 'cledson')) {
      return res.json({ success: true, rates: user.custom_card_rates, isLojistaCustom: true });
    }
  }
  res.json({ success: true, rates: loadCardRates(), isLojistaCustom: false });
}));

// Endpoint para lojista salvar suas próprias taxas de maquininha
app.post('/api/card-rates/custom', asyncHandler(async (req, res) => {
  const token = auth.getSessionTokenFromRequest(req);
  if (!token) return res.status(401).json({ error: 'Faça login para salvar taxas.' });
  const user = await auth.findUserBySessionToken(token);
  if (!user) return res.status(401).json({ error: 'Sessão inválida.' });

  const { baseRate, calculationMode, installmentRates } = req.body || {};

  if (user.role === 'admin') {
    const current = loadCardRates();
    const updated = {
      baseRate: baseRate === undefined ? current.baseRate : Number(baseRate),
      calculationMode: calculationMode || current.calculationMode,
      installmentRates: installmentRates ? { ...current.installmentRates, ...installmentRates } : current.installmentRates
    };
    if (saveCardRates(updated)) {
      return res.json({ success: true, rates: updated });
    }
    return res.status(500).json({ error: 'Falha ao salvar taxas' });
  }

  // Lojista salva suas taxas
  const current = user.custom_card_rates || {
    baseRate: 0,
    calculationMode: 'factor',
    installmentRates: {}
  };

  const updated = {
    baseRate: baseRate === undefined ? current.baseRate : Number(baseRate),
    calculationMode: calculationMode || 'factor',
    installmentRates: installmentRates ? { ...current.installmentRates, ...installmentRates } : current.installmentRates
  };

  await auth.updateLojistaCardRates(user.id, updated);
  res.json({ success: true, rates: updated });
}));

// Rotas de Admin para taxas da maquininha
app.get('/api/admin/card-rates', asyncHandler(async (req, res) => {
  const token = auth.getSessionTokenFromRequest(req);
  const user = await auth.findUserBySessionToken(token);
  if (!user || user.role !== 'admin') {
    return res.status(403).json({ error: 'Acesso negado' });
  }
  res.json({ success: true, rates: loadCardRates() });
}));

app.post('/api/admin/card-rates', asyncHandler(async (req, res) => {
  const token = auth.getSessionTokenFromRequest(req);
  const user = await auth.findUserBySessionToken(token);
  if (!user || user.role !== 'admin') {
    return res.status(403).json({ error: 'Acesso negado' });
  }

  const { baseRate, calculationMode, installmentRates } = req.body || {};
  const current = loadCardRates();

  const updated = {
    baseRate: baseRate === undefined ? current.baseRate : Number(baseRate),
    calculationMode: calculationMode || current.calculationMode,
    installmentRates: installmentRates ? { ...current.installmentRates, ...installmentRates } : current.installmentRates
  };

  if (saveCardRates(updated)) {
    res.json({ success: true, rates: updated });
  } else {
    res.status(500).json({ error: 'Falha ao salvar taxas da maquininha' });
  }
}));

// =========================================================================
// BLINDAGEM DE SEGURANÇA E DADOS (ANTI-INSPEÇÃO PARA VISITANTES)
// =========================================================================
const SERVER_DFU_ACTIVE = true;
const SERVER_DFU_IPHONE_VALUE = 100;
const SERVER_DFU_MAC_VALUE = 200;
const SERVER_DFU_WATCH_VALUE = 100;
const SERVER_DFU_IPAD_VALUE = 50;
const SERVER_DFU_VALUE = 100;

function applyServerDFU(cost, category, rawModel) {
  return PricingCore.applyDFU(cost, category, rawModel);
}

function getServerProductMargin(rawModel, category, isSemi, marginsData) {
  return PricingCore.getProductMargin(rawModel, category, isSemi, marginsData || loadMargins());
}

function formatProductForClient(p, isAuthed = false, marginsData = null) {
  if (!p) return null;
  if (isDisallowedProduct(p)) return null;
  const isSemi = PricingCore.isSeminovoProduct(p);
  
  if (isAuthed) {
    return {
      id: p.id,
      name: p.name,
      description: p.description,
      price: p.price,
      category: p.category,
      storage: p.storage,
      color: p.color,
      region: p.region,
      isSeminovo: isSemi,
      condition: p.condition || (isSemi ? 'SEMINOVO' : 'NOVO'),
      supplier: p.supplier ? {
        name: p.supplier.name,
        whatsappNumber: p.supplier.whatsappNumber,
        address: p.supplier.address,
        isVerified: p.supplier.isVerified,
        profileImageUrl: p.supplier.profileImageUrl
      } : null
    };
  }

  // Visitante não autenticado: TOTALMENTE BLINDADO!
  // Preço de venda final da loja com DFU e Margem de Lucro incorporados no servidor via PricingCore
  const retailPrice = PricingCore.calculateRetailPrice(p.price, p.category, p.name, isSemi, marginsData || loadMargins());

  return {
    id: p.id,
    name: p.name,
    description: p.description,
    price: retailPrice,
    category: p.category,
    storage: p.storage,
    color: p.color,
    region: p.region,
    isSeminovo: isSemi,
    condition: p.condition || (isSemi ? 'SEMINOVO' : 'NOVO'),
    supplier: null // BLINDADO: Nenhum dado de fornecedor exposto!
  };
}

// --- ROTAS DE PRODUTOS (ACESSO DIRETO) ---

app.get(['/api/products', '/api/v1/vitrine', '/api/vitrine'], asyncHandler(async (req, res) => {
  const targetDate = req.query.date;
  const token = auth.getSessionTokenFromRequest(req);
  const user = token ? await auth.findUserBySessionToken(token) : null;
  const isAuthed = !!user;

  // Se for busca de histórico por data (ex: 'yesterday' ou data específica)
  if (targetDate && targetDate !== 'today' && targetDate !== latestDate) {
    if (!isAuthed) {
      return res.status(401).json({ error: 'Acesso restrito a usuários autorizados.' });
    }
    const historical = getHistoricalCatalog(targetDate);
    const formattedHistorical = historical.map(p => formatProductForClient(p, true)).filter(Boolean);
    return res.json({
      success: true,
      total: formattedHistorical.length,
      dollarRate,
      dollarVariation,
      latestDate: targetDate,
      isHistorical: true,
      data: formattedHistorical
    });
  }

  const now = Date.now();
  if (isAuthed) {
    if (cachedAuthedProductsJson && (now - lastAuthedCacheTime < PRODUCTS_CACHE_TTL_MS)) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.send(cachedAuthedProductsJson);
    }
  } else {
    if (cachedShieldedProductsJson && (now - lastShieldedCacheTime < PRODUCTS_CACHE_TTL_MS)) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.send(cachedShieldedProductsJson);
    }
  }

  let products = Array.from(productsMap.values()).filter(p => !isDisallowedProduct(p));
  
  // Fallback de Segurança Nível Máximo: Se o servidor na nuvem acabou de subir e o mapa está zerado, carrega o snapshot em disco!
  if (products.length === 0) {
    const historical = getHistoricalCatalog('latest');
    if (historical && historical.length > 0) {
      products = historical;
      historical.forEach(p => {
        if (p && p.id) productsMap.set(String(p.id), p);
      });
      console.log(`[API Fallback] 📦 ${products.length} produtos resgatados do snapshot em disco.`);
    }
  }

  const currentMargins = loadMargins();
  const formattedProducts = products.map(p => formatProductForClient(p, isAuthed, currentMargins)).filter(Boolean);

  const payload = JSON.stringify({
    success: true,
    total: formattedProducts.length,
    dollarRate,
    dollarVariation,
    latestDate: latestDate || `${String(new Date().getDate()).padStart(2, '0')}-${String(new Date().getMonth() + 1).padStart(2, '0')}`,
    isShielded: !isAuthed,
    data: formattedProducts
  });

  if (isAuthed) {
    cachedAuthedProductsJson = payload;
    lastAuthedCacheTime = now;
  } else {
    cachedShieldedProductsJson = payload;
    lastShieldedCacheTime = now;
  }

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.send(payload);
}));

app.get('/api/price-history/:id', requireAuthApi, asyncHandler(async (req, res) => {
  const { id } = req.params;
  try {
    const resp = await axios.get(`${PXT_BASE_URL}/products/${id}/price-history`, {
      headers: { Authorization: `Bearer ${authToken}` }
    });
    res.json(resp.data);
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: 'Falha ao buscar histórico de preço' });
  }
}));

app.get('/api/stats', (req, res) => {
  const uniqueSuppliers = new Set(Array.from(productsMap.values()).map(p => p.supplier?.name).filter(Boolean)).size;
  res.json({
    totalProducts: productsMap.size,
    totalSuppliers: uniqueSuppliers,
    dollarRate,
    dollarVariation,
    latestDate,
    isSyncing
  });
});

app.post('/api/sync', requireAdminApi, asyncHandler(async (req, res) => {
  try {
    await fetchProducts();
    res.json({ success: true, count: productsMap.size });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}));

// Endpoint seguro para o sincronizador local enviar catálogo novo diretamente
app.post('/api/admin/push-catalog', asyncHandler(async (req, res) => {
  const syncSecret = process.env.SYNC_SECRET || 'apple_mundo_pxt_secret_sync_2026';
  const authHeader = req.headers['x-sync-secret'];
  
  if (authHeader !== syncSecret) {
    return res.status(403).json({ error: 'Acesso negado: segredo de sincronização inválido.' });
  }

  const { products, date, dollarRate: newDollar, dollarVariation: newVar } = req.body;
  if (!Array.isArray(products) || products.length === 0) {
    return res.status(400).json({ error: 'Lista de produtos vazia ou inválida.' });
  }

  // Atualizar mapa de produtos em memória com SWAP ATÔMICO
  const newMap = new Map();
  products.forEach(p => {
    if (isDisallowedProduct(p)) return;
    newMap.set(String(p.id), p);
  });

  if (newMap.size > 0) {
    productsMap.clear();
    for (const [k, v] of newMap.entries()) {
      productsMap.set(k, v);
    }
  }

  if (date) latestDate = date;
  if (newDollar) dollarRate = newDollar;
  if (newVar !== undefined) dollarVariation = newVar;

  // Salvar snapshot em disco de forma não-bloqueante
  scheduleCatalogSnapshot();

  // Notificar clientes conectados via WebSocket com roteamento e throttle
  broadcastCatalogReloaded({
    total: productsMap.size,
    latestDate,
    dollarRate,
    dollarVariation
  });

  console.log(`[Push Sync] ✅ Catálogo atualizado com sucesso! ${productsMap.size} produtos recebidos. Data: ${latestDate}`);
  res.json({ success: true, count: productsMap.size, date: latestDate });
}));

// Local client socket connection com Anti-Pirataria e segregação de salas
localIo.on('connection', async (clientSocket) => {
  const token = auth.getSessionTokenFromRequest({ headers: clientSocket.handshake.headers });
  async function authorizeSocket() {
    const user = token ? await auth.findUserBySessionToken(token) : null;
    if (!user) return false;
    clientSocket.leave('public_visitors');
    clientSocket.join('authed_users');
    clientSocket.join(`user_${user.id}`);
    clientSocket.join(`session_${token}`);
    const pricingUsername = (user.username || '').toLowerCase();
    if (pricingUsername === 'admin') clientSocket.join('pricing_admin');
    if (pricingUsername === 'cledson') clientSocket.join('pricing_controller');
    clientSocket.emit('pricing_updated', userPricingState(user));
    clientSocket.userId = user.id;
    clientSocket.userRole = user.role;
    return true;
  }
  try {
    if (!await authorizeSocket()) clientSocket.join('public_visitors');
  } catch (error) {
    clientSocket.join('public_visitors');
  }
  clientSocket.on('register_session', () => {
    authorizeSocket().catch(() => clientSocket.disconnect(true));
  });
  const sessionMonitor = setInterval(async () => {
    if (!clientSocket.userId) return;
    try {
      if (await auth.findUserBySessionToken(token)) return;
      clientSocket.emit('session_terminated', { reason: 'Sua sessão expirou. Faça login novamente.' });
    } catch (error) {}
    clientSocket.disconnect(true);
  }, 60000);
  clientSocket.on('disconnect', () => clearInterval(sessionMonitor));

  clientSocket.emit('init_stats', {
    total: productsMap.size,
    dollarRate,
    dollarVariation,
    latestDate
  });
});

// Carrega catálogo offline em cache para não derrubar o login do usuário no site oficial
function loadOfflineCatalog() {
  try {
    const cachePath = path.join(__dirname, 'data', 'cached_catalog.json');
    if (fs.existsSync(cachePath)) {
      const items = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
      productsMap.clear();
      items.forEach(p => productsMap.set(String(p.id), p));
      totalSuppliers = new Set(items.map(p => p.supplier?.name).filter(Boolean)).size;
      latestDate = '10-09';
      console.log(`[PXT Cache] ✅ ${items.length} produtos carregados do cache offline.`);
    }
  } catch (err) {
    console.warn('[PXT Cache] Falha ao carregar cache offline:', err.message);
  }
}

// Start service
async function start() {
  await auth.initAuth();

  server.listen(PORT, async () => {
    // Cotação do dólar ao vivo imediatamente e a cada 1 minuto
    if (process.env.DISABLE_LIVE_DOLLAR !== 'true') {
      fetchLiveDollar();
      setInterval(fetchLiveDollar, 60 * 1000);
    }

    console.log(`\n======================================================`);
    console.log(`🚀 BUSCADOR APPLE PRO ONLINE!`);
    console.log(`👉 Acesse no navegador: http://localhost:${PORT}`);
    console.log(`======================================================\n`);

    try {
      // Pré-carregamento de Snapshot de Segurança para Garantia Instantânea de Produtos na Nuvem
      const initialSnapshot = getHistoricalCatalog('latest');
      if (initialSnapshot && initialSnapshot.length > 0) {
        initialSnapshot.forEach(p => {
          if (p && p.id) {
            if (isDisallowedProduct(p)) return;
            productsMap.set(String(p.id), p);
          }
        });
        console.log(`[Startup] 📦 ${productsMap.size} produtos pré-carregados instantaneamente do snapshot.`);
      }

      if (PAUSE_PXT_UPSTREAM) {
        console.log(`[PXT] ⏸️ CONEXÃO COM O BUSCADOR OFICIAL PAUSADA!`);
        console.log(`[PXT] 🔒 O servidor local NÃO fará login no PXT para não derrubar sua sessão original.`);
        console.log(`[PXT] 📦 Carregando catálogo em modo offline / desenvolvimento...`);
        loadOfflineCatalog();
      } else {
        await authenticate();
        await fetchProducts();
        connectPxtWebSocket();

        // 1. WATCHDOG ATIVO: Verifica a cada 15 segundos se a conexão WebSocket está 100% viva
        setInterval(() => {
          if (!pxtSocket || !pxtSocket.connected) {
            console.log('[Watchdog] ⚠️ Conexão caiu ou inativa. Iniciando auto-recuperação imediata...');
            reconnectAndSync('watchdog_heartbeat_failed');
          }
        }, 15000);

        // 2. Auto-Sync Ativo & Detecção de virada de dia a cada 1 minuto (60s)
        setInterval(async () => {
          try {
            const todayStr = `${String(new Date().getDate()).padStart(2, '0')}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
            if ((latestDate && latestDate !== todayStr) || productsMap.size === 0) {
              console.log(`[Auto-Sync] 📅 Virada de dia ou catálogo zerado (${latestDate} -> ${todayStr}). Atualizando catálogo...`);
              await fetchProducts().catch(e => console.warn('[Auto-Sync] Erro no fetch:', e.message));
            }
            if (pxtSocket && pxtSocket.connected) {
              const dateQuery = latestDate || todayStr;
              pxtSocket.emit('products_sync_request', { date: dateQuery });
            }
          } catch (e) {
            console.warn('[Auto-Sync] Erro no ciclo de sync:', e.message);
          }
        }, 60 * 1000);

        // 3. Re-sincronização preventiva total a cada 10 minutos (garantia 100% à prova de falhas)
        setInterval(async () => {
          try {
            console.log('[Auto-Sync] 🔄 Sincronização periódica preventiva de integridade (10m)...');
            await fetchProducts().catch(e => console.warn('[Auto-Sync] Fetch periódico aviso:', e.message));
          } catch (e) {}
        }, 10 * 60 * 1000);
      }
    } catch (err) {
      console.error('Falha na inicialização do serviço:', err.message);
      if (!PAUSE_PXT_UPSTREAM) {
        setInterval(() => {
          if (!pxtSocket || !pxtSocket.connected) reconnectAndSync('startup_recovery');
        }, 15000);
      }
    }
  });
}

app.use((err, req, res, next) => {
  console.error('[HTTP]', err.message);
  if (res.headersSent) return next(err);
  const status = Number.isInteger(err.status) ? err.status : 500;
  res.status(status).json({ error: status === 500 ? 'Não foi possível concluir a operação. Tente novamente.' : 'Solicitação inválida.' });
});

if (require.main === module) {
  start().catch(err => {
    console.error('[Startup]', err.message);
    process.exitCode = 1;
  });
}
module.exports = { app, server, localIo, start };
