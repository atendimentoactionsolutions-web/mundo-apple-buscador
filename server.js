const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const auth = require('./auth');
const quotesManager = require('./quotes');
const PricingCore = require('./public/js/pricing-core.js');
const QuoteCore = require('./public/js/quote-core.js');
const { sanitizeCatalog } = require('./lib/catalog-sanitizer.js');
const { processDailyPricesText } = require('./lib/daily-prices-importer.js');

const localEnvFile = path.join(__dirname, '.env');
if (fs.existsSync(localEnvFile) && typeof process.loadEnvFile === 'function') process.loadEnvFile(localEnvFile);

const PORT = process.env.PORT || 3333;

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

app.get('/preco-de-custo', asyncHandler(async (req, res) => {
  const token = auth.getSessionTokenFromRequest(req);
  const user = token ? await auth.findUserBySessionToken(token) : null;
  if (!user || user.role !== 'admin') {
    return res.redirect('/login.html?next=/preco-de-custo');
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
}));

// Painel Administrativo (restrito a administradores autenticados)
app.get(['/admin', '/admin.html', '/painel', '/painel.html'], asyncHandler(async (req, res) => {
  const token = auth.getSessionTokenFromRequest(req);
  const user = token ? await auth.findUserBySessionToken(token) : null;
  if (!user || user.role !== 'admin') {
    return res.redirect('/login.html');
  }
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
}));

app.get('/login', (req, res) => res.redirect('/login.html'));

app.get('/login.html', asyncHandler(async (req, res, next) => {
  const token = auth.getSessionTokenFromRequest(req);
  const user = token ? await auth.findUserBySessionToken(token) : null;
  if (user) return res.redirect('/');
  next();
}));

// Impede que o static sirva painéis administrativos sem sessão válida
app.use(asyncHandler(async (req, res, next) => {
  if (req.path === '/admin.html' || req.path === '/painel.html') {
    const token = auth.getSessionTokenFromRequest(req);
    const user = token ? await auth.findUserBySessionToken(token) : null;
    if (!user || user.role !== 'admin') {
      return res.redirect('/login.html');
    }
  }
  next();
}));

// Arquivos estáticos (CSS, JS, Imagens, login.html)
app.use(express.static(path.join(__dirname, 'public'), { index: false, etag: false, maxAge: 0 }));

// In-memory product and supplier store
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

function isAtivadoProduct(p) {
  return PricingCore.isAtivadoProduct(p);
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
  return false; // Seminovos removidos completamente do buscador (apenas novos/lacrados)
}

function isAppleNovo(p) {
  if (!p) return false;
  if (isDisallowedProduct(p)) return false; // Bloqueia ativados, AS IS, CPO e fornecedores/regiões proibidos

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
    name.includes('apple tv') ||
    name.includes('airtag') ||
    name.includes('pencil') ||
    name.includes('magic keyboard') ||
    name.includes('magic mouse') ||
    name.includes('magic trackpad') ||
    name.includes('magic') ||
    name.includes('magsafe') ||
    name.includes('cabo') ||
    name.includes('fonte') ||
    name.includes('carregador') ||
    name.includes('adaptador') ||
    name.includes('folio') ||
    name.includes('capa') ||
    name.includes('case') ||
    name.includes('trackpad') ||
    name.includes('teclado') ||
    name.includes('mouse')
  ) {
    return true;
  }

  return false;
}

function processAppleProduct(p) {
  if (!p) return null;
  if (isDisallowedProduct(p)) return null; // Exclui modelos AS IS, CPO, ativados e seminovos
  if (isAppleNovo(p)) {
    return { ...p, isSeminovo: false, condition: isCpoProduct(p) ? 'CPO' : 'NOVO' };
  }
  return null;
}

// Configuração local de preços e rotas
// 4. AUTENTICAÇÃO, ANTI-PIRATARIA & ENDPOINTS REST
// =========================================================================

// Estado compartilhado do ajuste de pre?os do admin; controle exclusivo do Cledson.
const adminPricingFile = path.join(__dirname, 'data', 'admin-pricing.json');
let adminPricing = { active: true, version: Date.now() };
if (fs.existsSync(adminPricingFile)) {
  const saved = JSON.parse(fs.readFileSync(adminPricingFile, 'utf8'));
  if (typeof saved.active !== 'boolean') throw new Error('Configuração de preços inválida');
  adminPricing = { active: saved.active, version: Math.max(Date.now(), Number(saved.version) || 0) };
}
PricingCore.setDfuActive(adminPricing.active);
PricingCore.setDfuActive(true); // DFU global, independente de usuário.
function userPricingState(user) {
  const username = (user.username || '').toLowerCase();
  const isAdminDfuUser = user.role === 'admin' && username !== 'cledson';
  return {
    dfuActive: isAdminDfuUser && adminPricing.active,
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
  if (!user) return res.status(401).json({ error: 'Sessão inválida ou expirada.' });
  if (user.role !== 'admin') {
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
  const username = (req.user.username || '').toLowerCase();
  if (username !== 'cledson') {
    return res.status(403).json({ error: 'Acesso n?o autorizado.' });
  }
  if (typeof req.body.active !== 'boolean') return res.status(400).json({ error: 'Estado inv?lido.' });
  if (req.body.active !== adminPricing.active) {
    const next = { active: req.body.active, version: Math.max(Date.now(), adminPricing.version + 1) };
    fs.mkdirSync(path.dirname(adminPricingFile), { recursive: true });
    fs.writeFileSync(adminPricingFile + '.tmp', JSON.stringify(next));
    fs.renameSync(adminPricingFile + '.tmp', adminPricingFile);
    adminPricing = next;
    PricingCore.setDfuActive(adminPricing.active);
    invalidateProductsCache();
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

async function performCatalogSnapshotAsync(isoDateOverride = null) {
  if (isWritingSnapshot) return;
  isWritingSnapshot = true;
  try {
    const dataDir = path.join(__dirname, 'data');
    await fs.promises.mkdir(dataDir, { recursive: true });

    const todayStr = isoDateOverride || new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(new Date());
    const todayPath = path.join(dataDir, `snapshot_${todayStr}.json`);
    const latestPath = path.join(dataDir, `snapshot_latest.json`);
    const tempPath = path.join(dataDir, `snapshot_temp_${Date.now()}.json`);

    const productsList = Array.from(productsMap.values()).filter(p => !isDisallowedProduct(p));
    if (productsList.length > 0) {
      const jsonContent = JSON.stringify(productsList);
      await fs.promises.writeFile(tempPath, jsonContent, { encoding: 'utf-8', mode: 0o600 });
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

function resolveCatalogDates(rawDate) {
  const spNow = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
  const trimmed = typeof rawDate === 'string' ? rawDate.trim() : '';
  if (!trimmed) {
    const [, month, day] = spNow.split('-');
    return { isoDate: spNow, dateStr: `${day}-${month}` };
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed) && Number.isFinite(Date.parse(trimmed)) &&
      new Date(trimmed).toISOString().slice(0, 10) === trimmed) {
    const [, month, day] = trimmed.split('-');
    return { isoDate: trimmed, dateStr: `${day}-${month}` };
  }
  if (/^\d{2}-\d{2}$/.test(trimmed)) {
    const [day, month] = trimmed.split('-');
    const year = spNow.slice(0, 4);
    const isoCandidate = `${year}-${month}-${day}`;
    if (Number.isFinite(Date.parse(isoCandidate)) && new Date(isoCandidate).toISOString().slice(0, 10) === isoCandidate) {
      return { isoDate: isoCandidate, dateStr: trimmed };
    }
  }
  const error = new Error('Data inválida. Use DD-MM ou AAAA-MM-DD.');
  error.status = 400;
  throw error;
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
      if (Array.isArray(products)) return products.filter(product => !isDisallowedProduct(product) && !PricingCore.isSeminovoProduct(product));
    }
  } catch (error) {
    console.warn('[Snapshot]', error.message);
  }
  return latest ? Array.from(productsMap.values()).filter(product => !isDisallowedProduct(product) && !PricingCore.isSeminovoProduct(product)) : [];
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
const SERVER_DFU_ACTIVE = false;
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

// Página de custos: somente custo + DFU, sem margem e restrita ao administrador logado.
app.get('/api/cost-products', requireAdminApi, (req, res) => {
  const products = Array.from(productsMap.values())
    .filter(p => !isDisallowedProduct(p) && !PricingCore.isSeminovoProduct(p));
  const data = products.map(p => ({
    ...formatProductForClient(p, false),
    price: PricingCore.applyDFU(p.price, p.category, p.name),
    supplier: null
  }));
  res.json({ success: true, total: data.length, dollarRate, dollarVariation,
    latestDate, isShielded: true, pricingMode: 'cost', dfuActive: true, data });
});

// Importação manual de lista de preços do dia pelo Painel Administrativo
app.post('/api/admin/daily-prices', requireAdminApi, asyncHandler(async (req, res) => {
  const { rawText, date, mode = 'replace' } = req.body || {};
  if (!rawText || typeof rawText !== 'string' || !rawText.trim()) {
    return res.status(400).json({ error: 'Nenhum texto de produtos fornecido.' });
  }
  const { isoDate, dateStr } = resolveCatalogDates(date);
  const parsed = processDailyPricesText(rawText, { dateStr });
  if (!parsed.success || parsed.stats.failedLines > 0 || parsed.products.length === 0) {
    return res.status(400).json({
      error: 'A lista contém linhas inválidas ou nenhum produto permitido. O catálogo anterior foi preservado.',
      stats: parsed.stats
    });
  }
  const { cleanProducts, auditReport } = sanitizeCatalog(parsed.products, { todayDateStr: dateStr });
  if (!cleanProducts.length) {
    return res.status(400).json({
      error: 'Nenhum produto permitido após validação. O catálogo anterior foi preservado.',
      stats: parsed.stats,
      audit: auditReport
    });
  }

  const normalized = cleanProducts.map(product => ({ ...product, supplier: null }));
  if (mode === 'append') {
    normalized.forEach(p => productsMap.set(String(p.id), p));
  } else {
    productsMap.clear();
    normalized.forEach(p => productsMap.set(String(p.id), p));
  }

  latestDate = Array.from(productsMap.values())
    .map(p => p.priceDate || p.sheetDate || '')
    .filter(d => /^\d{2}-\d{2}$/.test(d))
    .sort((a, b) => (b.slice(3) + b.slice(0, 2)).localeCompare(a.slice(3) + a.slice(0, 2)))[0] || dateStr;

  invalidateProductsCache();
  await performCatalogSnapshotAsync(isoDate);
  localIo.emit('catalog_reloaded', {
    total: productsMap.size,
    dollarRate,
    dollarVariation,
    latestDate
  });

  res.json({
    success: true,
    date: latestDate,
    added: normalized.length,
    totalCatalog: productsMap.size,
    stats: parsed.stats
  });
}));

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

  let products = Array.from(productsMap.values()).filter(p => !isDisallowedProduct(p) && !PricingCore.isSeminovoProduct(p));
  
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

// Estado básico do catálogo manual, sem certificações de auditoria.
app.get(['/api/health', '/api/v1/health'], (req, res) => {
  res.json({ status: 'OK', mode: 'manual', totalProducts: productsMap.size, latestDate });
});

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
    if (user.role === 'admin' && pricingUsername !== 'cledson') clientSocket.join('pricing_admin');
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
  if (productsMap.size > 0) {
    // Catálogo já carregado do snapshot mais recente (snapshot_latest.json)
    return;
  }
  try {
    const cachePath = path.join(__dirname, 'data', 'cached_catalog.json');
    if (fs.existsSync(cachePath)) {
      const items = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
      productsMap.clear();
      items.forEach(p => productsMap.set(String(p.id), p));
      totalSuppliers = new Set(items.map(p => p.supplier?.name).filter(Boolean)).size;
      latestDate = '10-09';
      console.log(`[Catálogo local] ✅ ${items.length} produtos carregados do cache offline.`);
    }
  } catch (err) {
    console.warn('[Catálogo local] Falha ao carregar cache offline:', err.message);
  }
}

// Start service
async function start() {
  await auth.initAuth();
  const savedProducts = getHistoricalCatalog('latest');
  for (const p of savedProducts) {
    if (p && p.id && !isDisallowedProduct(p)) productsMap.set(String(p.id), p);
  }
  latestDate = savedProducts.map(p => p.priceDate || p.sheetDate || '')
    .filter(date => /^\d{2}-\d{2}$/.test(date))
    .sort((a, b) => (b.slice(3) + b.slice(0, 2)).localeCompare(a.slice(3) + a.slice(0, 2)))[0] || '';
  loadOfflineCatalog();
  server.listen(PORT, () => {
    console.log(`[Catálogo manual] ${productsMap.size} produtos disponíveis na porta ${PORT}.`);
    if (process.env.DISABLE_LIVE_DOLLAR !== 'true') {
      fetchLiveDollar();
      setInterval(fetchLiveDollar, 60 * 1000);
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
