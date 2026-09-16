const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const ioClient = require('socket.io-client');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const auth = require('./auth');

const PXT_BASE_URL = 'https://backend-api.buscadorpxt.com.br';
const USER_EMAIL = 'felippemiranda1991@gmail.com';
const USER_PASS = 'Finasjoias10';
const PORT = process.env.PORT || 3333;
const PAUSE_PXT_UPSTREAM = process.env.PAUSE_PXT_UPSTREAM === 'true'; // Padrão falso = TEMPO REAL ATIVO!

const ANDROID_CATEGORIES = new Set(['MI', 'NOTE', 'PAD', 'POCO', 'RDM', 'REAL']);
const APPLE_CATEGORIES = new Set(['IPH', 'MCB', 'IPAD', 'IPD', 'RLG', 'PODS', 'ACSS', 'IMAC', 'MNTR']);

const app = express();
const server = http.createServer(app);
const localIo = new Server(server, {
  cors: { origin: '*' }
});

app.use(cors());
app.use(express.json());
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

// Helper de Cookies de Sessão
function setSessionCookie(res, token) {
  const maxAge = 30 * 24 * 60 * 60; // 30 dias em segundos
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

app.get('/admin', async (req, res) => {
  const token = auth.getSessionTokenFromRequest(req);
  const user = await auth.findUserBySessionToken(token);
  if (!user) return res.redirect('/login.html?redirect=admin');
  if (user.role !== 'admin') return res.redirect('/');
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/admin.html', async (req, res) => {
  const token = auth.getSessionTokenFromRequest(req);
  const user = await auth.findUserBySessionToken(token);
  if (!user) return res.redirect('/login.html?redirect=admin');
  if (user.role !== 'admin') return res.redirect('/');
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/login', (req, res) => res.redirect('/login.html'));

app.get('/login.html', async (req, res, next) => {
  const token = auth.getSessionTokenFromRequest(req);
  const user = await auth.findUserBySessionToken(token);
  if (user) return res.redirect('/');
  next();
});

// Arquivos estáticos (CSS, JS, Imagens, login.html)
app.use(express.static(path.join(__dirname, 'public'), { index: false, etag: false, maxAge: 0 }));

// In-memory product and supplier store
let authToken = null;
let pxtSocket = null;
let productsMap = new Map(); // id -> product
let dollarRate = 5.1253;
let dollarVariation = 0.57;
let latestDate = '';
let totalSuppliers = 0;
let isSyncing = false;

// Filter to keep ONLY Apple New / Sealed products
function isAppleNovo(p) {
  if (!p) return false;
  const cat = (p.category || '').toUpperCase().trim();
  const name = (p.name || '').toLowerCase();
  const desc = (p.description || '').toLowerCase();

  // Exclude Android explicitly
  if (ANDROID_CATEGORIES.has(cat)) return false;

  // Exclude Seminovos, Usados, Vitrine, As-Is
  if (cat === 'SEMI') return false;
  if (
    name.includes('semi novo') ||
    name.includes('semi-novo') ||
    name.includes('seminovo') ||
    name.includes('usado') ||
    name.includes('vitrine') ||
    name.includes('as is') ||
    name.includes('as-is') ||
    desc.includes('semi novo') ||
    desc.includes('seminovo') ||
    desc.includes('vitrine')
  ) {
    return false;
  }

  // Must be an Apple category (or named iPhone, Mac, iPad, Apple Watch, AirPods, iMac)
  if (APPLE_CATEGORIES.has(cat)) return true;
  if (
    name.includes('iphone') ||
    name.includes('macbook') ||
    name.includes('ipad') ||
    name.includes('apple watch') ||
    name.includes('airpods') ||
    name.includes('imac')
  ) {
    return true;
  }

  return false;
}

// 1. Authenticate with Buscador PXT API
async function authenticate() {
  try {
    console.log('[Auth] Autenticando com Buscador PXT...');
    const resp = await axios.post(`${PXT_BASE_URL}/auth/login`, {
      email: USER_EMAIL,
      password: USER_PASS,
      forceLogin: true
    }, {
      headers: { 'Content-Type': 'application/json' }
    });

    authToken = resp.data.access_token;
    console.log('[Auth] Autenticação bem-sucedida! Token obtido.');
    return authToken;
  } catch (err) {
    console.error('[Auth] Erro ao autenticar:', err.response?.data || err.message);
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

    productsMap.clear();
    let appleCount = 0;
    let ignoredCount = 0;

    for (const p of rawList) {
      if (isAppleNovo(p)) {
        productsMap.set(String(p.id), p);
        appleCount++;
      } else {
        ignoredCount++;
      }
    }

    console.log(`[Catalog] Carga concluída: ${appleCount} produtos Apple Novos carregados. (${ignoredCount} Android/Seminovos ignorados)`);
    isSyncing = false;
    saveCatalogSnapshot();

    // Notify connected local clients
    localIo.emit('catalog_reloaded', {
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

let isReconnecting = false;

// Robust self-healing reconnect and sync function
async function reconnectAndSync(reason = 'watchdog') {
  if (isReconnecting) return;
  isReconnecting = true;
  console.log(`[Watchdog] 🔄 Disparando auto-reconexão e ressincronização (Motivo: ${reason})...`);
  localIo.emit('pxt_connection_status', { connected: false, status: 'reconnecting', reason });

  try {
    await authenticate();
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
    const dateQuery = latestDate || `${String(new Date().getDate()).padStart(2, '0')}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
    pxtSocket.emit('products_sync_request', { date: dateQuery });
    localIo.emit('pxt_connection_status', { connected: true, status: 'connected', date: dateQuery });
  });

  pxtSocket.on('connect_error', (err) => {
    console.warn('[WebSocket] Aviso de erro na conexão:', err.message);
    localIo.emit('pxt_connection_status', { connected: false, status: 'error', error: err.message });
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
      localIo.emit('price_changed', {
        id,
        oldPrice,
        newPrice,
        updatedAt: existing.updatedAt,
        product: existing
      });
    }
  });

  // Event: Product updated or Stock changed
  const handleUpdate = (item) => {
    if (!item || !item.id) return;
    const id = String(item.id);
    const fullItem = { ...(productsMap.get(id) || {}), ...item, ...(item.changes || {}) };

    if (!isAppleNovo(fullItem)) {
      if (productsMap.has(id)) {
        productsMap.delete(id);
        localIo.emit('product_deleted', { id });
      }
      return;
    }

    productsMap.set(id, fullItem);
    console.log(`[Tempo Real] Produto atualizado: ${fullItem.name} - R$ ${fullItem.price}`);
    localIo.emit('product_updated', fullItem);
  };

  pxtSocket.on('product_updated', handleUpdate);
  pxtSocket.on('stock_changed', handleUpdate);

  // Event: Product created
  pxtSocket.on('product_created', (item) => {
    if (!item || !item.id) return;
    const fullItem = { ...item, ...(item.changes || {}) };
    if (isAppleNovo(fullItem)) {
      productsMap.set(String(fullItem.id), fullItem);
      console.log(`[Tempo Real] Novo produto adicionado: ${fullItem.name} - R$ ${fullItem.price} [${fullItem.supplier?.name}]`);
      localIo.emit('product_created', fullItem);
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
      localIo.emit('product_deleted', { id });
    }
  });

  // Event: Delta updates
  pxtSocket.on('products_delta', (delta) => {
    if (!delta) return;
    const created = delta.created || delta.inserted || [];
    const updated = delta.updated || [];
    const deleted = delta.deleted || [];
    const isMassive = created.length > 50 || delta.snapshot === true;

    if (delta.snapshot === true) {
      productsMap.clear();
    }

    let addedApple = 0;
    for (const item of created) {
      if (isAppleNovo(item)) {
        productsMap.set(String(item.id), item);
        addedApple++;
        if (!isMassive) {
          localIo.emit('product_created', item);
        }
      }
    }
    for (const item of updated) {
      if (isAppleNovo(item)) {
        productsMap.set(String(item.id), item);
        if (!isMassive) {
          localIo.emit('product_updated', item);
        }
      }
    }
    for (const id of deleted) {
      const sId = String(typeof id === 'object' ? id.id : id);
      if (productsMap.has(sId)) {
        productsMap.delete(sId);
        if (!isMassive) {
          localIo.emit('product_deleted', { id: sId });
        }
      }
    }

    console.log(`[Tempo Real] Delta processado: +${created.length}, ~${updated.length}, -${deleted.length} (Total Apple Ativos: ${productsMap.size})`);

    if (isMassive) {
      localIo.emit('catalog_reloaded', {
        total: productsMap.size,
        dollarRate,
        dollarVariation,
        latestDate
      });
    }
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

// Middleware de Proteção de API para Usuários Autenticados
async function requireAuthApi(req, res, next) {
  const token = auth.getSessionTokenFromRequest(req);
  if (!token) {
    return res.status(401).json({ error: 'Acesso não autorizado. Faça login.', code: 'UNAUTHORIZED' });
  }
  const user = await auth.findUserBySessionToken(token);
  if (!user) {
    return res.status(401).json({ error: 'Sessão inválida ou desconectada em outro aparelho.', code: 'SESSION_EXPIRED' });
  }
  if (user.status === 'blocked') {
    return res.status(403).json({ error: 'Conta suspensa. Entre em contato com o administrador.', code: 'ACCOUNT_BLOCKED' });
  }
  req.user = user;
  next();
}

// Middleware de Proteção de API para Administrador
async function requireAdminApi(req, res, next) {
  const token = auth.getSessionTokenFromRequest(req);
  if (!token) return res.status(401).json({ error: 'Não autenticado' });
  const user = await auth.findUserBySessionToken(token);
  if (!user || user.role !== 'admin') {
    return res.status(403).json({ error: 'Acesso restrito ao administrador.' });
  }
  req.user = user;
  next();
}

// --- ROTAS DE AUTENTICAÇÃO ---
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body || {};
  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const result = await auth.loginUser(username, password, clientIp, localIo);
  if (result.success) {
    setSessionCookie(res, result.sessionToken);
    return res.json({ success: true, user: result.user });
  }
  return res.status(401).json(result);
});

app.post('/api/auth/logout', async (req, res) => {
  const token = auth.getSessionTokenFromRequest(req);
  if (token) await auth.logoutUser(token);
  clearSessionCookie(res);
  res.json({ success: true });
});

app.get('/api/auth/me', async (req, res) => {
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
    expiresAt: user.expires_at
  });
});

// --- ROTAS ADMINISTRATIVAS (GESTÃO DE LOJISTAS) ---
app.get('/api/admin/lojistas', requireAdminApi, async (req, res) => {
  const list = await auth.listLojistas();
  res.json(list);
});

app.post('/api/admin/lojistas', requireAdminApi, async (req, res) => {
  try {
    const lojista = await auth.createLojista(req.body);
    res.json({ success: true, lojista });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/admin/lojistas/:id/renew', requireAdminApi, async (req, res) => {
  try {
    const result = await auth.renewLojista(req.params.id, req.body.days || 30);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/admin/lojistas/:id/block', requireAdminApi, async (req, res) => {
  try {
    const result = await auth.toggleBlockLojista(req.params.id);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/admin/lojistas/:id/password', requireAdminApi, async (req, res) => {
  try {
    const result = await auth.updateLojistaPassword(req.params.id, req.body.newPassword);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/admin/lojistas/:id', requireAdminApi, async (req, res) => {
  try {
    const result = await auth.deleteLojista(req.params.id);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

function isCpoProduct(p) {
  if (!p) return false;
  const n = (p.name || '').toUpperCase();
  const d = (p.description || '').toUpperCase();
  const r = (p.region || '').toUpperCase();
  return n.includes('CPO') || d.includes('CPO') || r.includes('CPO');
}

// Salvamento e gestão de snapshots históricos de catálogo por data
function saveCatalogSnapshot() {
  try {
    const dataDir = path.join(__dirname, 'data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

    const todayStr = new Date().toISOString().split('T')[0];
    const todayPath = path.join(dataDir, `snapshot_${todayStr}.json`);
    const latestPath = path.join(dataDir, `snapshot_latest.json`);

    const productsList = Array.from(productsMap.values()).filter(p => !isCpoProduct(p));
    if (productsList.length > 0) {
      fs.writeFileSync(todayPath, JSON.stringify(productsList), 'utf-8');
      fs.writeFileSync(latestPath, JSON.stringify(productsList), 'utf-8');
    }
  } catch (err) {
    console.warn('[Snapshot] Erro ao salvar snapshot:', err.message);
  }
}

function getHistoricalCatalog(dateParam) {
  try {
    const dataDir = path.join(__dirname, 'data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

    const files = fs.readdirSync(dataDir).filter(f => f.startsWith('snapshot_') && f.endsWith('.json'));

    // Tenta encontrar snapshot de data específica
    if (dateParam && dateParam !== 'yesterday') {
      const match = files.find(f => f.includes(dateParam));
      if (match) {
        const content = fs.readFileSync(path.join(dataDir, match), 'utf-8');
        return JSON.parse(content);
      }
    }

    // Se for 'yesterday', busca o snapshot anterior ou snapshot_latest / cached_catalog
    const snapshotFiles = files.filter(f => f !== 'snapshot_latest.json').sort().reverse();
    if (snapshotFiles.length > 1) {
      const yesterdayContent = fs.readFileSync(path.join(dataDir, snapshotFiles[1]), 'utf-8');
      return JSON.parse(yesterdayContent);
    }
    if (snapshotFiles.length > 0) {
      const content = fs.readFileSync(path.join(dataDir, snapshotFiles[0]), 'utf-8');
      return JSON.parse(content);
    }

    const cachedPath = path.join(dataDir, 'cached_catalog.json');
    if (fs.existsSync(cachedPath)) {
      const content = fs.readFileSync(cachedPath, 'utf-8');
      return JSON.parse(content);
    }
  } catch (err) {
    console.warn('[Snapshot] Erro ao carregar snapshot histórico:', err.message);
  }

  // Fallback: se não houver arquivo antigo ainda, retorna os produtos atuais filtrados
  return Array.from(productsMap.values()).filter(p => !isCpoProduct(p));
}

// --- ROTAS E GESTÃO DE MARGENS DE LUCRO / LOJA FÍSICA ---
const MARGINS_FILE_PATH = path.join(__dirname, 'data', 'margins.json');

function getDefaultMargins() {
  return {
    categories: {
      IPH: 750,        // iPhone: +R$ 750
      MCB_AIR: 1000,   // Mac Air: +R$ 1.000
      MCB_PRO: 1300,   // Outros Modelos Mac / Pro: +R$ 1.300
      IPAD: 500,       // iPad: +R$ 500
      RLG: 500,        // Apple Watch: +R$ 500
      IMAC: 1500,      // iMac: +R$ 1.500
      PODS: 200,       // AirPods: +R$ 200
      ACSS: 100        // Acessórios: +R$ 100
    },
    products: {}  // Exceções por produto específico: { "IPHONE 17 PRO MAX": 350 }
  };
}

function loadMargins() {
  try {
    if (fs.existsSync(MARGINS_FILE_PATH)) {
      const data = JSON.parse(fs.readFileSync(MARGINS_FILE_PATH, 'utf-8'));
      return {
        categories: { ...getDefaultMargins().categories, ...(data.categories || {}) },
        products: data.products || {}
      };
    }
  } catch (err) {
    console.warn('[Margens] Erro ao carregar margens:', err.message);
  }
  return getDefaultMargins();
}

function saveMargins(marginsData) {
  try {
    const dataDir = path.join(__dirname, 'data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(MARGINS_FILE_PATH, JSON.stringify(marginsData, null, 2), 'utf-8');
    localIo.emit('margins_updated', marginsData);
    return true;
  } catch (err) {
    console.error('[Margens] Erro ao salvar margens:', err.message);
    return false;
  }
}

// Rota pública de margens ativas
app.get('/api/margins', (req, res) => {
  res.json({ success: true, margins: loadMargins() });
});

// Rotas protegidas de Admin para gerenciar margens
app.get('/api/admin/margins', async (req, res) => {
  const token = auth.getSessionTokenFromRequest(req);
  const user = await auth.findUserBySessionToken(token);
  if (!user || user.role !== 'admin') {
    return res.status(403).json({ error: 'Acesso negado' });
  }
  res.json({ success: true, margins: loadMargins() });
});

app.post('/api/admin/margins', async (req, res) => {
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
});

// --- ROTAS DE PRODUTOS (ACESSO DIRETO) ---
app.get('/api/products', (req, res) => {
  const products = Array.from(productsMap.values()).filter(p => !isCpoProduct(p));
  res.json({
    success: true,
    total: products.length,
    dollarRate,
    dollarVariation,
    latestDate,
    data: products
  });
});

app.get('/api/price-history/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const resp = await axios.get(`${PXT_BASE_URL}/products/${id}/price-history`, {
      headers: { Authorization: `Bearer ${authToken}` }
    });
    res.json(resp.data);
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: 'Falha ao buscar histórico de preço' });
  }
});

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

app.post('/api/sync', requireAdminApi, async (req, res) => {
  try {
    await fetchProducts();
    res.json({ success: true, count: productsMap.size });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Local client socket connection com Anti-Pirataria
localIo.on('connection', (clientSocket) => {
  // O cliente registra seu token de sessão para receber avisos imediatos de sessão única
  clientSocket.on('register_session', async (token) => {
    if (token) {
      const user = await auth.findUserBySessionToken(token);
      if (user) {
        clientSocket.join(`user_${user.id}`);
        clientSocket.userId = user.id;
      }
    }
  });

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
    console.log(`\n======================================================`);
    console.log(`🚀 BUSCADOR APPLE PRO ONLINE!`);
    console.log(`👉 Acesse no navegador: http://localhost:${PORT}`);
    console.log(`======================================================\n`);

    try {
      if (PAUSE_PXT_UPSTREAM) {
        console.log(`[PXT] ⏸️ CONEXÃO COM O BUSCADOR OFICIAL PAUSADA!`);
        console.log(`[PXT] 🔒 O servidor local NÃO fará login no PXT para não derrubar sua sessão original.`);
        console.log(`[PXT] 📦 Carregando catálogo em modo offline / desenvolvimento...`);
        loadOfflineCatalog();
      } else {
        await authenticate();
        await fetchProducts();
        connectPxtWebSocket();

        // WATCHDOG ATIVO: Verifica a cada 15 segundos se a conexão está 100% viva
        setInterval(() => {
          if (!pxtSocket || !pxtSocket.connected) {
            console.log('[Watchdog] ⚠️ Conexão caiu ou inativa. Iniciando auto-recuperação imediata...');
            reconnectAndSync('watchdog_heartbeat_failed');
          }
        }, 15000);

        // Ressincronização periódica de integridade (a cada 5 minutos)
        setInterval(() => {
          if (pxtSocket && pxtSocket.connected) {
            const dateQuery = latestDate || `${String(new Date().getDate()).padStart(2, '0')}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
            console.log('[Watchdog] 🔄 Disparando checagem periódica de sincronia de produtos...');
            pxtSocket.emit('products_sync_request', { date: dateQuery });
          }
        }, 5 * 60 * 1000);
      }
    } catch (err) {
      console.error('Falha na inicialização do serviço:', err.message);
    }
  });
}

start();
