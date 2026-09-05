const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const ioClient = require('socket.io-client');
const axios = require('axios');
const cors = require('cors');
const path = require('path');

const PXT_BASE_URL = 'https://backend-api.buscadorpxt.com.br';
const USER_EMAIL = 'felippemiranda1991@gmail.com';
const USER_PASS = 'Finasjoias10';
const PORT = process.env.PORT || 3333;

const ANDROID_CATEGORIES = new Set(['MI', 'NOTE', 'PAD', 'POCO', 'RDM', 'REAL']);
const APPLE_CATEGORIES = new Set(['IPH', 'MCB', 'IPAD', 'IPD', 'RLG', 'PODS', 'ACSS', 'IMAC', 'MNTR']);

const app = express();
const server = http.createServer(app);
const localIo = new Server(server, {
  cors: { origin: '*' }
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

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

    for (const item of created) {
      if (isAppleNovo(item)) {
        productsMap.set(String(item.id), item);
        localIo.emit('product_created', item);
      }
    }
    for (const item of updated) {
      if (isAppleNovo(item)) {
        productsMap.set(String(item.id), item);
        localIo.emit('product_updated', item);
      }
    }
    for (const id of deleted) {
      const sId = String(typeof id === 'object' ? id.id : id);
      if (productsMap.has(sId)) {
        productsMap.delete(sId);
        localIo.emit('product_deleted', { id: sId });
      }
    }
    console.log(`[Tempo Real] Delta processado: +${created.length}, ~${updated.length}, -${deleted.length}`);
  });

  // Event: Supplier status changed
  pxtSocket.on('supplier_status_changed', (statusData) => {
    if (!statusData) return;
    localIo.emit('supplier_status_changed', statusData);
  });
}

// 4. REST Endpoints for Frontend
app.get('/api/products', (req, res) => {
  const products = Array.from(productsMap.values());
  res.json({
    success: true,
    total: products.length,
    dollarRate,
    dollarVariation,
    latestDate,
    isSyncing,
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

app.post('/api/sync', async (req, res) => {
  try {
    await fetchProducts();
    res.json({ success: true, count: productsMap.size });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Local client socket connection
localIo.on('connection', (clientSocket) => {
  clientSocket.emit('init_stats', {
    total: productsMap.size,
    dollarRate,
    dollarVariation,
    latestDate
  });
});

// Start service
async function start() {
  server.listen(PORT, async () => {
    console.log(`\n======================================================`);
    console.log(`🚀 BUSCADOR APPLE PRO (TEMPO REAL) ONLINE!`);
    console.log(`👉 Acesse no navegador: http://localhost:${PORT}`);
    console.log(`======================================================\n`);

    try {
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

    } catch (err) {
      console.error('Falha na inicialização do serviço:', err.message);
    }
  });
}

start();
