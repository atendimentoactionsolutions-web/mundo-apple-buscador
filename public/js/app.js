// MUNDO APPLE BUSCADOR - Frontend Engine (Tempo Real & Filtros Adaptativos)
let allProducts = [];
let currentUser = null;
let authSessionChecked = false;
let catalogStatus = 'loading';
let catalogRequestId = 0;
let currentCategory = 'ALL';
let selectedModel = ''; // Isolated model filter (e.g. "IPHONE 17 PRO MAX")
let searchQuery = '';
let selectedStorage = '';
let selectedRam = '';
let selectedColor = '';
let selectedSupplier = '';
let sortMode = 'price_asc';

// Connect to Local Socket.io server
const socket = io();

// ==========================================
// MODO DFU (Ajuste Global de Custo Base)
// Regra: Somente o usuário 'admin' tem DFU ativo (iPhones +100, MacBooks +200, Apple Watch +100).
// O usuário 'cledson' NUNCA entra no DFU (+0, custo real).
// ==========================================
const storedUser = (localStorage.getItem('logged_username') || '').toLowerCase();
window.DFU_ACTIVE = (storedUser === 'admin');
window.DFU_IPHONE_VALUE = 100;
window.DFU_MAC_VALUE = 200;
window.DFU_WATCH_VALUE = 100;
window.DFU_IPAD_VALUE = 50;
window.DFU_VALUE = 100;
window.IS_CATALOG_SHIELDED = false;

function applyDFU(cost, category, rawModel) {
  if (window.IS_CATALOG_SHIELDED) return Number(cost) || 0;

  // Regra estrita: Cledson nunca entra no DFU (sempre custo real)
  const activeUser = ((currentUser && currentUser.username) || localStorage.getItem('logged_username') || '').toLowerCase();
  if (activeUser === 'cledson') {
    return Number(cost) || 0;
  }

  // Somente o usuário 'admin' tem o DFU ativo
  if (activeUser && activeUser !== 'admin') {
    return Number(cost) || 0;
  }

  if (window.PricingCore && typeof window.PricingCore.applyDFU === 'function') {
    return window.PricingCore.applyDFU(cost, category, rawModel);
  }
  if (!window.DFU_ACTIVE) return Number(cost) || 0;
  const numCost = Number(cost) || 0;
  if (numCost <= 0) return 0;
  const cat = (category || '').toUpperCase().trim();
  const model = (rawModel || '').toUpperCase();
  const isIphone = cat === 'IPH' || model.includes('IPHONE');
  const isMac = cat === 'MCB' || model.includes('MAC') || model.includes('MACBOOK');
  const isWatch = cat === 'RLG' || model.includes('WATCH');
  const isIpad = cat === 'IPAD' || cat === 'IPD' || model.includes('IPAD');
  if (isIphone) {
    return numCost + (window.DFU_IPHONE_VALUE || 100);
  }
  if (isMac) {
    return numCost + (window.DFU_MAC_VALUE || 200);
  }
  if (isWatch) {
    return numCost + (window.DFU_WATCH_VALUE || 100);
  }
  if (isIpad) {
    return numCost + (window.DFU_IPAD_VALUE || 50);
  }
  return numCost;
}
// ==========================================

// DOM elements
const productsGrid = document.getElementById('productsGrid');
const shownCountEl = document.getElementById('shownCount');
const totalCountEl = document.getElementById('totalCount');
const searchInput = document.getElementById('searchInput');
const searchClearBtn = document.getElementById('searchClearBtn');
const autocompleteDropdown = document.getElementById('autocompleteDropdown');
const storageFilter = document.getElementById('storageFilter');
const ramFilter = document.getElementById('ramFilter');
const colorFilter = document.getElementById('colorFilter');
const supplierFilter = document.getElementById('supplierFilter');
const clearFiltersBtn = document.getElementById('clearFiltersBtn');
const dollarRateText = document.getElementById('dollarRateText');

function updateHeaderDollarDisplay(rate, variation) {
  const topRateEl = document.getElementById('topHeaderDollarRate');
  const topVarEl = document.getElementById('topHeaderDollarVar');
  if (topRateEl && rate) {
    const num = Number(rate);
    topRateEl.textContent = `R$ ${num.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
  }
  if (topVarEl && variation !== undefined && variation !== null) {
    const numVar = Number(variation);
    const sign = numVar > 0 ? '+' : '';
    topVarEl.textContent = `${sign}${numVar.toFixed(2)}%`;
    topVarEl.className = 'dollar-var-badge ' + (numVar > 0 ? 'positive' : (numVar < 0 ? 'negative' : ''));
  }
}

const dollarVarText = document.getElementById('dollarVarText');
const dateText = document.getElementById('dateText');
const categoryNav = document.getElementById('categoryNav');

// Active Model Banner DOM
const activeModelBanner = document.getElementById('activeModelBanner');
const activeModelNameText = document.getElementById('activeModelNameText');
const activeModelCountText = document.getElementById('activeModelCountText');
const removeModelBtn = document.getElementById('removeModelBtn');

// // Helper para identificar e excluir rigorosamente produtos CPO (Certified Pre-Owned)
function isCpoProduct(p) {
  if (!p) return false;
  const n = (p.name || '').toUpperCase();
  const d = (p.description || '').toUpperCase();
  const r = (p.region || '').toUpperCase();
  return n.includes('CPO') || d.includes('CPO') || r.includes('CPO');
}

function isAsIsProduct(p) {
  if (window.PricingCore && typeof window.PricingCore.isAsIsProduct === 'function') {
    return window.PricingCore.isAsIsProduct(p);
  }
  if (!p) return false;
  const cat = (p.category || '').toUpperCase().trim();
  const name = (p.name || '').toUpperCase();
  const desc = (p.description || '').toUpperCase();
  const reg = (p.region || '').toUpperCase();
  return (
    name.includes('AS IS') ||
    name.includes('AS-IS') ||
    name.includes('ASIS') ||
    desc.includes('AS IS') ||
    desc.includes('AS-IS') ||
    desc.includes('ASIS') ||
    cat.includes('AS IS') ||
    cat.includes('AS-IS') ||
    reg.includes('AS IS') ||
    reg.includes('AS-IS')
  );
}

function isDisallowedProduct(p) {
  if (window.PricingCore && typeof window.PricingCore.isDisallowedProduct === 'function') {
    return window.PricingCore.isDisallowedProduct(p);
  }
  if (!p) return true;
  if (isCpoProduct(p)) return true;
  if (isAsIsProduct(p)) return true;
  const cat = (p.category || '').toUpperCase().trim();
  const name = (p.name || '').toUpperCase();
  const desc = (p.description || '').toUpperCase();
  const isSemi = p.isSeminovo === true || p.condition === 'SEMINOVO' || cat === 'SEMI' ||
                 name.includes('SEMI NOVO') || name.includes('SEMI-NOVO') || name.includes('SEMINOVO') ||
                 name.includes('USADO') || name.includes('VITRINE') || desc.includes('SEMI');
  if (isSemi && isDisallowedSeminovo(p)) return true;
  return false;
}

// Utilitário de Debounce para entradas do usuário (evita travamentos ao digitar)
function debounce(fn, delay = 120) {
  let timer = null;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

// Batching de re-renderização visual para eventos WebSocket em rajada
let pendingUiRefresh = null;
function scheduleUiRefresh() {
  if (pendingUiRefresh) return;
  pendingUiRefresh = requestAnimationFrame(() => {
    pendingUiRefresh = null;
    if (typeof refreshCurrentView === 'function') {
      refreshCurrentView();
    }
  });
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ==========================================
// CACHE LOCAL ULTRA-RÁPIDO (INDEXEDDB)
// Carrega valores e produtos instantaneamente (<15ms)
// Com segregação estrita entre visitantes (blindado) e logados (fornecedores)
// ==========================================
const DB_NAME = 'BuscadorAppleCache';
const STORE_NAME = 'catalog';

function openCatalogDb() {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || !window.indexedDB) return resolve(null);
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        try { req.result.createObjectStore(STORE_NAME); } catch (e) {}
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch (e) {
      resolve(null);
    }
  });
}

function getCatalogCacheKey() {
  return currentUser ? `authed_products_${currentUser.id || currentUser.username}` : 'shielded_products';
}

async function getCachedCatalog() {
  try {
    const db = await openCatalogDb();
    if (!db) return null;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const key = getCatalogCacheKey();
        const req = store.get(key);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      } catch (e) {
        resolve(null);
      }
    });
  } catch (e) {
    return null;
  }
}

async function saveCachedCatalog(data, key = getCatalogCacheKey()) {
  try {
    const db = await openCatalogDb();
    if (!db) return;
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put(data, key);
  } catch (e) {}
}

async function clearCachedCatalog() {
  try {
    const db = await openCatalogDb();
    if (!db) return;
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.clear();
  } catch (e) {}
}

// Inicializa cache em memória instantaneamente antes da rede
async function restoreCachedCatalog() {
  const cached = await getCachedCatalog();
  if (cached && cached.isShielded !== !currentUser) return;
  if (cached && allProducts.length === 0) {
    const list = Array.isArray(cached) ? cached : (cached.products || []);
    if (list.length > 0) {
      if (cached.isShielded !== undefined) {
        window.IS_CATALOG_SHIELDED = !!cached.isShielded;
      }
      allProducts = list;
      catalogStatus = 'ready';
      if (totalCountEl) totalCountEl.textContent = allProducts.length;
      updateDynamicFilters();
      if (typeof refreshCurrentView === 'function') {
        refreshCurrentView();
      }
    }
  }
}

let selectedDateMode = 'today';

// 1. Fetch initial dataset from backend API (suporta alternar entre Hoje e Ontem)
async function loadProducts(dateParam) {
  if (!authSessionChecked) return;
  const requestId = ++catalogRequestId;
  const cacheKey = getCatalogCacheKey();
  try {
    const target = dateParam || selectedDateMode || 'today';
    const res = await fetch(`/api/products?date=${target}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (requestId !== catalogRequestId) return;
    if (json.success && Array.isArray(json.data)) {
      window.IS_CATALOG_SHIELDED = !!json.isShielded;
      allProducts = json.data.filter(p => !isDisallowedProduct(p));
      catalogStatus = 'ready';
      lastColorCategory = '';
      if (!json.isHistorical) saveCachedCatalog({ isShielded: window.IS_CATALOG_SHIELDED, products: allProducts }, cacheKey);
      if (totalCountEl) totalCountEl.textContent = allProducts.length;
      if (json.dollarRate) updateHeaderDollarDisplay(json.dollarRate, json.dollarVariation);

      // Status Badge e indicador de data ativa
      const badgeText = document.getElementById('connectionText');
      const badgeDot = document.getElementById('connectionDot');
      if (json.isHistorical) {
        if (badgeText) badgeText.textContent = `TABELA DE ONTEM (${json.latestDate})`;
        if (badgeDot) badgeDot.style.backgroundColor = '#f59e0b';
      } else {
        if (badgeText) badgeText.textContent = 'PREÇOS ATUALIZADOS AO VIVO';
        if (badgeDot) badgeDot.style.backgroundColor = 'var(--accent-green)';
      }

      updateDynamicFilters();
      refreshCurrentView();
    } else throw new Error('Resposta de catálogo inválida.');
  } catch (err) {
    if (requestId !== catalogRequestId) return;
    catalogStatus = 'error';
    refreshCurrentView();
    console.error('Erro ao carregar produtos por data:', err);
  }
}

// 2. DYNAMIC / ADAPTIVE FILTERS
// When a model is selected, filters adapt to show ONLY capacities, colors, and suppliers of that model!
function updateDynamicFilters() {
  // Base pool of products based on current category and selected model
  let pool = allProducts.filter(p => {
    if (currentCategory !== 'ALL') {
      const pCat = (p.category || '').toUpperCase();
      if (currentCategory === 'IPAD' && (pCat !== 'IPAD' && pCat !== 'IPD')) return false;
      if (currentCategory !== 'IPAD' && pCat !== currentCategory) return false;
    }
    if (selectedModel) {
      if ((p.name || '').trim().toUpperCase() !== selectedModel.trim().toUpperCase()) return false;
    }
    return true;
  });

  // Extract available Capacities from the pool
  const capacitiesMap = new Map();
  // Extract available RAMs from the pool
  const ramsMap = new Map();
  // Extract available Colors from the pool
  const colorsMap = new Map();
  // Extract available Suppliers from the pool
  const suppliersMap = new Map();

  pool.forEach(p => {
    if (p.storage) {
      const s = p.storage.trim().toUpperCase();
      capacitiesMap.set(s, (capacitiesMap.get(s) || 0) + 1);
    }
    const ram = getMacBookRam(p);
    if (ram) {
      ramsMap.set(ram, (ramsMap.get(ram) || 0) + 1);
    }
    if (p.color) {
      const c = p.color.trim().toUpperCase();
      if (!selectedStorage || (p.storage || '').toUpperCase().includes(selectedStorage)) {
        colorsMap.set(c, (colorsMap.get(c) || 0) + 1);
      }
    }
    if (p.supplier?.name) {
      const supp = p.supplier.name.trim();
      suppliersMap.set(supp, (suppliersMap.get(supp) || 0) + 1);
    }
  });

  // Update Storage Dropdown
  const customStoragesOrder = ['64GB', '128GB', '256GB', '512GB', '1TB', '2TB'];
  const availableStorages = Array.from(capacitiesMap.keys()).sort((a, b) => {
    const ia = customStoragesOrder.indexOf(a);
    const ib = customStoragesOrder.indexOf(b);
    if (ia !== -1 && ib !== -1) return ia - ib;
    return a.localeCompare(b);
  });

  if (storageFilter) {
    storageFilter.innerHTML = '<option value="">Capacidade (Todas)</option>';
    availableStorages.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s;
      opt.textContent = `${s} (${capacitiesMap.get(s)})`;
      if (s === selectedStorage) opt.selected = true;
      storageFilter.appendChild(opt);
    });

    if (selectedStorage && !capacitiesMap.has(selectedStorage)) {
      selectedStorage = '';
      storageFilter.value = '';
    }
  }

  // Update RAM Dropdown
  const ramWrapper = document.getElementById('ramFilterWrapper');
  if (ramFilter) {
    const sortedRams = Array.from(ramsMap.keys()).sort((a, b) => (parseInt(a) || 0) - (parseInt(b) || 0));
    ramFilter.innerHTML = '<option value="">Memória RAM (Todas)</option>';
    sortedRams.forEach(r => {
      const opt = document.createElement('option');
      opt.value = r;
      opt.textContent = `${r} (${ramsMap.get(r)})`;
      if (r === selectedRam) opt.selected = true;
      ramFilter.appendChild(opt);
    });

    if (ramWrapper) {
      ramWrapper.style.display = sortedRams.length > 0 ? 'inline-block' : 'none';
    }

    if (selectedRam && !ramsMap.has(selectedRam)) {
      selectedRam = '';
      ramFilter.value = '';
    }
  }

  // Update Colors Dropdown
  const sortedColors = Array.from(colorsMap.entries()).sort((a, b) => b[1] - a[1]);
  if (colorFilter) {
    colorFilter.innerHTML = '<option value="">Cor (Todas as Cores)</option>';
    sortedColors.forEach(([c, count]) => {
      const opt = document.createElement('option');
      opt.value = c;
      opt.textContent = `${c} (${count})`;
      if (c === selectedColor) opt.selected = true;
      colorFilter.appendChild(opt);
    });

    if (selectedColor && !colorsMap.has(selectedColor)) {
      selectedColor = '';
      colorFilter.value = '';
    }
  }

  // Update Suppliers Dropdown
  const sortedSuppliers = Array.from(suppliersMap.keys()).sort();
  if (supplierFilter) {
    supplierFilter.innerHTML = '<option value="">Fornecedor (Todos)</option>';
    sortedSuppliers.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s;
      opt.textContent = `${s} (${suppliersMap.get(s)})`;
      if (s === selectedSupplier) opt.selected = true;
      supplierFilter.appendChild(opt);
    });
  }

  // Active supplier count text
  const supplierCountLabel = document.getElementById('supplierCountLabel');
  if (supplierCountLabel) {
    supplierCountLabel.textContent = `${suppliersMap.size} fornecedores ativos neste filtro`;
  }
}

// 3. SELECT MODEL FUNCTION (Click on card or select from autocomplete)
window.selectModel = function(modelName) {
  selectedModel = modelName.trim();
  searchQuery = '';
  searchInput.value = selectedModel;
  searchClearBtn.style.display = 'flex';
  autocompleteDropdown.classList.remove('open');

  // If user selected a model that does not match currentCategory, reset category to ALL
  const sample = allProducts.find(p => (p.name || '').trim().toUpperCase() === selectedModel.toUpperCase());
  if (sample && currentCategory !== 'ALL') {
    const pCat = (sample.category || '').toUpperCase();
    const matches = (currentCategory === 'IPAD' && (pCat === 'IPAD' || pCat === 'IPD')) || (pCat === currentCategory);
    if (!matches) {
      currentCategory = 'ALL';
      document.querySelectorAll('.cat-pill').forEach(p => p.classList.toggle('active', p.dataset.category === 'ALL'));
    }
  }

  // Reset secondary filters when switching models to avoid empty results
  selectedStorage = '';
  selectedColor = '';
  selectedSupplier = '';

  updateDynamicFilters();
  render();

  // Scroll smoothly to filter area so user sees isolated results
  document.querySelector('.filter-bar-wrapper').scrollIntoView({ behavior: 'smooth', block: 'start' });
};

// Remove model isolation
window.clearSelectedModel = function() {
  selectedModel = '';
  searchQuery = '';
  searchInput.value = '';
  searchClearBtn.style.display = 'none';
  if (autocompleteDropdown) autocompleteDropdown.classList.remove('open');
  selectedStorage = '';
  selectedColor = '';
  selectedSupplier = '';

  updateDynamicFilters();
  render();
};

if (removeModelBtn) {
  removeModelBtn.addEventListener('click', clearSelectedModel);
}

// 4. Calculate Lowest Price per model variant (Name + Storage)
function getLowestPriceMap() {
  const map = new Map();
  for (const p of allProducts) {
    if (!p.price || p.price <= 0) continue;
    const key = `${(p.name || '').trim().toUpperCase()}_${(p.storage || '').trim().toUpperCase()}`;
    const curLowest = map.get(key);
    if (!curLowest || p.price < curLowest) {
      map.set(key, p.price);
    }
  }
  return map;
}

// 5. Filter and Sort logic
function getFilteredProducts() {
  const lowestMap = getLowestPriceMap();
  const sLower = searchQuery.trim().toLowerCase();

  let filtered = allProducts.filter(p => {
    // Excluir produtos CPO
    if (isCpoProduct(p)) return false;

    // Category filter
    if (currentCategory !== 'ALL') {
      const pCat = (p.category || '').toUpperCase();
      if (currentCategory === 'IPAD' && (pCat !== 'IPAD' && pCat !== 'IPD')) return false;
      if (currentCategory !== 'IPAD' && pCat !== currentCategory) return false;
    }

    // Selected Model isolation
    if (selectedModel) {
      if ((p.name || '').trim().toUpperCase() !== selectedModel.trim().toUpperCase()) return false;
    }

    // Free text search query (when model is not locked)
    if (!selectedModel && sLower) {
      const tokens = normalizeSearchText(sLower).split(' ').filter(Boolean);
      if (!matchSearchTokens(p, tokens)) return false;
    }

    // Storage filter
    if (selectedStorage) {
      const stor = (p.storage || '').toUpperCase();
      if (!stor.includes(selectedStorage)) return false;
    }

    // RAM filter
    if (selectedRam) {
      if (getMacBookRam(p) !== selectedRam) return false;
    }

    // Color filter
    if (selectedColor) {
      const col = (p.color || '').toUpperCase();
      if (col !== selectedColor) return false;
    }

    // Supplier filter
    if (selectedSupplier) {
      if (p.supplier?.name !== selectedSupplier) return false;
    }

    return true;
  });

  // Sorting
  filtered.sort((a, b) => {
    const pa = Number(a.price) || 0;
    const pb = Number(b.price) || 0;
    if (sortMode === 'price_asc') return pa - pb;
    if (sortMode === 'price_desc') return pb - pa;
    if (sortMode === 'name_asc') return (a.name || '').localeCompare(b.name || '');
    return 0;
  });

  return { filtered, lowestMap };
}

// Format Currency BRL
function formatBRL(val) {
  return Number(val).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// Extrai fielmente a quantidade de RAM de MacBooks e Macs
function getMacBookRam(p) {
  if (!p) return '';
  const cat = (p.category || '').toUpperCase();
  const name = (p.name || '').toUpperCase();
  const isMac = cat === 'MCB' || name.includes('MACBOOK') || name.includes('MAC MINI') || name.includes('MAC STUDIO') || name.includes('IMAC');
  if (!isMac) return '';

  // 1. No PXT, a memória RAM de MacBooks vem no campo region (ex: "8GB", "16GB", "24GB", "32GB", "36GB", "48GB", "64GB")
  if (p.region && /\b\d{1,3}\s*GB\b/i.test(p.region)) {
    return p.region.trim().toUpperCase();
  }

  // 2. Busca na descrição ou nome se houver menção explícita
  const combined = `${p.description || ''} ${p.name || ''}`;
  const m = combined.match(/\b(8|16|18|24|32|36|48|64|96|128)\s*GB\b/i);
  if (m) {
    return `${m[1]}GB`;
  }
  return '';
}

// Tradutor de cores e termos comuns Apple para busca em português e inglês
function getColorSynonyms(color) {
  if (!color) return '';
  const c = color.toLowerCase();
  const syn = [];
  if (c.includes('titanium') || c.includes('titanio')) syn.push('titanio titan');
  if (c.includes('desert')) syn.push('deserto');
  if (c.includes('natural')) syn.push('natural');
  if (c.includes('black')) syn.push('preto escuro');
  if (c.includes('white')) syn.push('branco claro');
  if (c.includes('silver')) syn.push('prata prateado');
  if (c.includes('gold')) syn.push('dourado ouro');
  if (c.includes('blue')) syn.push('azul');
  if (c.includes('pink')) syn.push('rosa');
  if (c.includes('green')) syn.push('verde');
  if (c.includes('purple')) syn.push('roxo');
  if (c.includes('yellow')) syn.push('amarelo');
  if (c.includes('starlight')) syn.push('estelar luz das estrelas');
  if (c.includes('midnight')) syn.push('meia noite');
  if (c.includes('space gray') || c.includes('gray') || c.includes('grey')) syn.push('cinza espacial cinza');
  return syn.join(' ');
}

// Normalizador de busca inteligente (ignora acentos, pontuação, maiúsculas/minúsculas e junta termos colados)
function normalizeSearchText(str) {
  if (!str) return '';
  let res = str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, ' ')
    // Separa letra→número e número→letra: IPHONE16 → iphone 16
    .replace(/([a-z])(\d)/g, '$1 $2')
    .replace(/(\d)([a-z])/g, '$1 $2');

  // Expansão de termos compostos colados comuns no universo Apple
  res = res
    .replace(/\bpromax\b/g, 'pro max')
    .replace(/\bapplewatch\b/g, 'apple watch')
    .replace(/\bwatchultra\b/g, 'watch ultra')
    .replace(/\bmacbookair\b/g, 'macbook air')
    .replace(/\bmacbookpro\b/g, 'macbook pro')
    .replace(/\bmacmini\b/g, 'mac mini')
    .replace(/\bmacstudio\b/g, 'mac studio')
    .replace(/\bairpodspro\b/g, 'airpods pro')
    .replace(/\bairpodsmax\b/g, 'airpods max')
    .replace(/\bipadair\b/g, 'ipad air')
    .replace(/\bipadpro\b/g, 'ipad pro')
    .replace(/\bipadmini\b/g, 'ipad mini');

  return res.replace(/\s+/g, ' ').trim();
}

// Verifica se todos os termos digitados na busca estão presentes no produto (com suporte a compacto e sinônimos)
function matchSearchTokens(product, tokens) {
  if (!tokens || tokens.length === 0) return true;
  const ram = getMacBookRam(product);
  const colorSyn = getColorSynonyms(product.color || '');
  const rawText = `${product.name || ''} ${product.description || ''} ${product.storage || ''} ${product.color || ''} ${colorSyn} ${product.region || ''} ${ram} ${ram ? ram + ' RAM' : ''} ${product.supplier?.name || ''}`;
  const normalized = normalizeSearchText(rawText);
  const normalizedCompact = normalized.replace(/\s+/g, '');

  return tokens.every(token => {
    const cleanToken = token.trim();
    if (!cleanToken) return true;
    const cleanCompact = cleanToken.replace(/\s+/g, '');
    return normalized.includes(cleanToken) || (cleanCompact && normalizedCompact.includes(cleanCompact));
  });
}

// Helper para montar mensagem direta e profissional de WhatsApp para o fornecedor
function buildSupplierWhatsAppMessage(model, storage, color, price, ram = '') {
  const parts = [];
  if (model) parts.push(model.trim().toUpperCase());
  if (ram && !model.toUpperCase().includes(ram.toUpperCase())) {
    parts.push(ram.trim().toUpperCase());
  }
  if (storage) parts.push(storage.trim().toUpperCase());
  if (color && color.toUpperCase() !== 'PADRÃO') parts.push(color.trim().toUpperCase());
  
  const productInfo = parts.join(' ');
  const formattedPrice = formatBRL(price || 0);
  return `Olá, ${productInfo} ${formattedPrice}, ainda está disponível?`;
}

// Apple Official Colors Hex Palette Helper
// Apple Official Colors Hex Palette Helper (Mapeamento Oficial de Cores Apple & PXT)
function getAppleColorHex(colorName) {
  if (!colorName) return '#8e8e93';
  const c = colorName.trim().toUpperCase();

  // Night Sky (Deep Dark Navy/Slate para iPhone Duo)
  if (c.includes('NIGHT SKY') || c.includes('NIGHTSKY')) return '#2a2f3a';

  // Star White (Pure/Pristine White perolado para iPhone Duo)
  if (c.includes('STAR WHITE') || c.includes('STARWHITE')) return '#f8fafc';

  // Glacier / Glacial (Glacier Ice Blue / Light icy cyan blue)
  if (c.includes('GLACIER') || c.includes('GLACIAL')) return '#a4c6da';

  // Burgundy / Bordo / Bordô / Cabernet / Maroon / Vinho (Deep Wine / Burgundy Red)
  if (c.includes('BURGUNDY') || c.includes('BORDO') || c.includes('CABERNET') || c.includes('MAROON') || c.includes('VINHO')) return '#6b1d2f';

  // Desert / Deserto Titanium
  if (c.includes('DESERT') || c.includes('DESERTO')) return '#c8a882';

  // Natural Titanium / Titânio Natural
  if (c.includes('NATURAL')) return '#9f9a93';

  // Citrus / Lime / Limão (Apple Neo / Pastel Lime Yellow)
  if (c.includes('CITRUS') || c.includes('LIME') || c.includes('LIMÃO') || c.includes('LIMAO')) return '#d9d686';

  // Cosmic Orange / Laranja / Orange / Coral
  if (c.includes('COSMIC') || c.includes('ORANGE') || c.includes('LARANJ') || c.includes('CORAL')) return '#e06d53';

  // Teal / Sage / Verde-azulado / Cyprus
  if (c.includes('TEAL') || c.includes('SAGE') || c.includes('CYPRUS')) return '#3b827e';

  // Ultramarine / Ultramarino / Indigo
  if (c.includes('ULTRAMARIN') || c.includes('INDIGO')) return '#4052b5';

  // Blush / Soft Pink / Pink / Rosa / Rose / Rose Gold
  if (c.includes('BLUSH') || c.includes('PINK') || c.includes('ROSA') || c.includes('ROSE')) {
    if (c.includes('GOLD') || c.includes('OURO')) return '#e8bfb5';
    return '#f7c5cc';
  }

  // Lavender / Purple / Roxo / Lilás / Violeta
  if (c.includes('LAVENDER') || c.includes('PURPLE') || c.includes('ROXO') || c.includes('VIOLET') || c.includes('LILAS')) {
    if (c.includes('DEEP') || c.includes('ESCURO')) return '#433447';
    return '#d1c7df';
  }

  // Jet Black / Space Black
  if (c.includes('JET BLACK') || (c.includes('SPACE') && c.includes('BLACK')) || (c.includes('PRETO') && c.includes('ESPACIAL'))) return '#111113';

  // Black / Midnight / Preto / Meia-noite / Charcoal
  if (c.includes('BLACK') || c.includes('PRETO') || c.includes('MEIA-NOITE') || c.includes('MIDNIGHT')) {
    if (c.includes('TITANIUM') || c.includes('TITANIO')) return '#3b3b3d';
    if (c.includes('MIDNIGHT') || c.includes('MEIA')) return '#1e2430';
    return '#18181a';
  }

  // Space Gray / Charcoal / Graphite / Grafite / Cinza
  if (c.includes('CHARCOAL') || c.includes('GRAFITE') || c.includes('GRAPHITE') || c.includes('CINZA') || c.includes('GRAY') || c.includes('GREY')) {
    return '#535150';
  }

  // Cloud White / White / Branco / White Titanium
  if (c.includes('WHITE') || c.includes('BRANC') || c.includes('CLOUD')) {
    if (c.includes('TITANIUM') || c.includes('TITANIO')) return '#ebeae6';
    return '#f5f5f7';
  }

  // Starlight / Estelar
  if (c.includes('STARLIGHT') || c.includes('ESTELAR')) return '#f0ece3';

  // Silver / Prata / Prateado
  if (c.includes('SILVER') || c.includes('PRATA') || c.includes('PRATEADO')) return '#e3e4e6';

  // Mist Blue / Deep Blue / Sky Blue / Blue / Azul / Sierra / Pacific
  if (c.includes('BLUE') || c.includes('AZUL') || c.includes('SIERRA') || c.includes('PACIFIC')) {
    if (c.includes('DEEP') || c.includes('ESCURO')) return '#24374b';
    if (c.includes('MIST') || c.includes('PACIFIC') || c.includes('PACIFICO')) return '#395b64';
    if (c.includes('SKY') || c.includes('LIGHT') || c.includes('CLARO') || c.includes('CEU')) return '#a4c2d7';
    if (c.includes('TITANIUM') || c.includes('TITANIO')) return '#394653';
    return '#496d8e';
  }

  // Gold / Dourado / Light Gold / Ouro
  if (c.includes('GOLD') || c.includes('DOURAD') || c.includes('OURO')) return '#fae7cf';

  // Alpine Green / Green / Verde / Menta
  if (c.includes('VERDE') || c.includes('GREEN') || c.includes('ALPINE') || c.includes('MINT') || c.includes('MENTA')) {
    if (c.includes('ALPINE') || c.includes('ALPINO')) return '#576856';
    if (c.includes('MIDNIGHT') || c.includes('ESCURO')) return '#2c3e35';
    if (c.includes('MINT') || c.includes('MENTA')) return '#bce3d6';
    return '#aee1cd';
  }

  // Yellow / Amarelo
  if (c.includes('YELLOW') || c.includes('AMAREL')) return '#f9e784';

  // Red / Vermelho / Product Red
  if (c.includes('RED') || c.includes('VERMELH')) return '#e02424';

  return '#8e8e93';
}

// TÓPICO: Melhores Preços de Acordo com Cada Cor (Bolinhas Apple + WhatsApp Direto)
function renderColorPricesTopic() {
  const container = document.getElementById('colorPricesTopic');
  if (!container) return;

  // Mostra o tópico quando houver um modelo selecionado OU uma busca ativa por modelo
  const activeModel = selectedModel || (searchQuery.trim().length >= 2 ? searchQuery.trim() : '');
  if (!activeModel) {
    container.style.display = 'none';
    container.innerHTML = '';
    return;
  }

  // Coleta produtos correspondentes ao modelo/busca ativa (respeitando capacidade, se houver)
  const pool = allProducts.filter(p => {
    if (currentCategory !== 'ALL') {
      const pCat = (p.category || '').toUpperCase();
      if (currentCategory === 'IPAD' && (pCat !== 'IPAD' && pCat !== 'IPD')) return false;
      if (currentCategory !== 'IPAD' && pCat !== currentCategory) return false;
    }
    if (selectedModel) {
      if ((p.name || '').trim().toUpperCase() !== selectedModel.trim().toUpperCase()) return false;
    } else if (searchQuery.trim()) {
      const tokens = normalizeSearchText(searchQuery.trim()).split(' ').filter(Boolean);
      if (!matchSearchTokens(p, tokens)) return false;
    }
    if (selectedStorage) {
      if (!(p.storage || '').toUpperCase().includes(selectedStorage)) return false;
    }
    return true;
  });

  // Agrupa os melhores preços por cor
  const colorMap = new Map();
  pool.forEach(p => {
    if (!p.color || !p.price || p.price <= 0) return;
    const c = p.color.trim().toUpperCase();
    const existing = colorMap.get(c);
    if (!existing || p.price < existing.minPrice) {
      colorMap.set(c, {
        color: c,
        minPrice: p.price,
        bestSupplier: p.supplier?.name || 'Fornecedor',
        whatsappNumber: p.supplier?.whatsappNumber || '',
        isVerified: p.supplier?.isVerified,
        count: (existing ? existing.count : 0) + 1
      });
    } else {
      existing.count++;
    }
  });

  const colorsList = Array.from(colorMap.values()).sort((a, b) => a.minPrice - b.minPrice);

  if (colorsList.length === 0) {
    container.style.display = 'none';
    container.innerHTML = '';
    return;
  }

  const modelDisplayName = selectedModel || searchQuery.trim().toUpperCase();
  const storageDisplayName = selectedStorage ? ` • ${selectedStorage}` : '';

  const cardsHtml = colorsList.map(item => {
    const isSelected = selectedColor === item.color;
    const hex = getAppleColorHex(item.color);
    const rawPhone = (item.whatsappNumber || '').replace(/\D/g, '');
    const orderMsg = buildSupplierWhatsAppMessage(modelDisplayName, selectedStorage, item.color, item.minPrice);
    const waLink = rawPhone ? `https://wa.me/${rawPhone}?text=${encodeURIComponent(orderMsg)}` : '#';

    return `
      <div class="color-box-card ${isSelected ? 'active-color' : ''}">
        <div class="color-box-header" onclick="selectColorFromTopic('${item.color.replace(/'/g, "\\'")}')" style="cursor: pointer;">
          <div class="color-box-header-left">
            <span class="color-circle" style="background-color: ${hex};" title="Cor: ${item.color}"></span>
            <span class="color-box-name">${item.color}</span>
          </div>
          <span class="color-box-count">${item.count} opções</span>
        </div>

        <div class="color-box-price" onclick="selectColorFromTopic('${item.color.replace(/'/g, "\\'")}')" style="cursor: pointer;">
          ${formatBRL(item.minPrice)}
        </div>
           <div class="color-box-supplier" onclick="selectColorFromTopic('${item.color.replace(/'/g, "\\'")}')" style="cursor: pointer;" title="${item.bestSupplier}">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: -1px; margin-right: 3px; color: var(--accent-green);"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg>Menor: <strong>${item.bestSupplier}</strong>
          ${item.isVerified ? `
            <svg class="verified-icon" width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
            </svg>
          ` : ''}
        </div>

        <div class="color-box-actions-row">
          <a class="color-box-btn color-box-btn-wa" href="${waLink}" target="_blank" rel="noopener noreferrer" title="Chamar fornecedor no WhatsApp">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
              <path d="M17.472 14.382c-.301-.15-1.781-.879-2.057-.98-.276-.1-.477-.15-.678.15-.2.301-.778.98-.954 1.18-.175.201-.351.226-.652.075-1.933-.969-3.196-1.727-4.464-3.905-.337-.58.338-.538.968-1.799.1-.201.05-.376-.025-.526-.075-.15-.678-1.632-.929-2.235-.244-.588-.493-.508-.678-.517-.175-.008-.376-.01-.577-.01-.201 0-.527.075-.803.376-.276.301-1.054 1.03-1.054 2.511 0 1.481 1.079 2.91 1.23 3.111.15.201 2.123 3.242 5.143 4.546 2.067.893 2.87.897 3.896.744.624-.093 1.781-.728 2.032-1.431.251-.703.251-1.305.175-1.43-.075-.126-.276-.201-.577-.351zM12 21.848c-1.802 0-3.568-.485-5.116-1.405l-.367-.218-3.804.997 1.015-3.708-.239-.38C2.508 15.518 2 13.784 2 12c0-5.514 4.486-10 10-10s10 4.486 10 10-4.486 10-10 10zm0-18.182C7.488 3.666 3.818 7.336 3.818 12c0 1.636.474 3.208 1.371 4.564l.215.324-.606 2.215 2.268-.595.314.186C8.705 19.645 10.33 20.182 12 20.182c4.512 0 8.182-3.67 8.182-8.182 0-4.512-3.67-8.182-8.182-8.182z"/>
            </svg>
            Zap
          </a>
          <button class="color-box-btn color-box-btn-filter ${isSelected ? 'active' : ''}" onclick="selectColorFromTopic('${item.color.replace(/'/g, "\\'")}')" title="Filtrar por esta cor">
            ${isSelected ? '✕ Desmarcar' : 'Filtrar'}
          </button>
        </div>
      </div>
    `;
  }).join('');

  container.innerHTML = `
    <div class="color-prices-card">
      <div class="color-prices-header">
        <div>
          <div class="color-prices-title">
            <span><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: -3px; margin-right: 6px;"><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.563-2.512 5.563-5.563C22 6.5 17.5 2 12 2z"/></svg>Menores Preços por Cor:</span>
            <span class="model-highlight">${modelDisplayName}${storageDisplayName}</span>
          </div>
          <div class="color-prices-subtitle">
            Melhores valores encontrados no atacado para cada cor. Clique em qualquer cor para filtrar os produtos abaixo.
          </div>
        </div>
        ${selectedColor ? `
          <button class="remove-model-btn" onclick="selectColorFromTopic('${selectedColor.replace(/'/g, "\\'")}')" title="Remover filtro de cor">
            ✕ Ver todas as cores
          </button>
        ` : ''}
      </div>
      <div class="color-cards-grid">
        ${cardsHtml}
      </div>
    </div>
  `;

  container.style.display = 'block';
}

window.selectColorFromTopic = function(colorName) {
  if (selectedColor === colorName) {
    selectedColor = '';
    colorFilter.value = '';
  } else {
    selectedColor = colorName;
    colorFilter.value = colorName;
  }
  render();
};

// 6. Render Product Cards, Active Model Banner & Color Prices Topic
function render() {
  if (!productsGrid) return;
  const { filtered, lowestMap } = getFilteredProducts();
  if (shownCountEl) shownCountEl.textContent = filtered.length;

  // Active Model Banner update
  if (selectedModel) {
    if (activeModelBanner) activeModelBanner.style.display = 'flex';
    if (activeModelNameText) activeModelNameText.textContent = selectedModel;
    if (activeModelCountText) activeModelCountText.textContent = filtered.length;
  } else {
    if (activeModelBanner) activeModelBanner.style.display = 'none';
  }

  // Render Tópico de Melhores Preços por Cor (com proteção try/catch)
  try {
    renderColorPricesTopic();
  } catch (err) {
    console.error('Erro ao renderizar tópico de cores:', err);
  }

  if (filtered.length === 0) {
    productsGrid.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 60px 20px; color: var(--text-muted);">
        <h3 style="font-size: 1.2rem; color: var(--text-primary); margin-bottom: 8px;">Nenhum produto encontrado com os filtros selecionados.</h3>
        <p style="margin-bottom: 16px;">Tente selecionar outra cor, capacidade ou limpar os filtros.</p>
        <button class="action-btn" onclick="resetFilters()" style="margin: 0 auto;">✕ Limpar Filtros</button>
      </div>
    `;
    return;
  }

  const html = filtered.slice(0, 150).map(p => {
    // Supplier details
    const sName = p.supplier?.name || 'Fornecedor';
    const sAvatar = p.supplier?.profileImageUrl || 'https://pub-857bffb3be264baf89938943b80bff74.r2.dev/supplier-profiles/default.png';
    const sAddress = p.supplier?.address || 'São Paulo - SP';
    const isVerified = p.supplier?.isVerified;
    const whatsapp = (p.supplier?.whatsappNumber || '').replace(/\D/g, '');

    // Build WhatsApp message
    const orderMsg = buildSupplierWhatsAppMessage(p.name, p.storage, p.color, p.price);
    const waLink = whatsapp ? `https://wa.me/${whatsapp}?text=${encodeURIComponent(orderMsg)}` : '#';

    return `
      <article class="product-card" data-id="${p.id}">
        
        <!-- Supplier Header -->
        <div class="card-supplier">
          <img class="supplier-avatar" src="${sAvatar}" alt="${sName}" onerror="this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(sName)}&background=272b30&color=fff'">
          <div class="supplier-details">
            <div class="supplier-name-row">
              <span>${sName}</span>
              ${isVerified ? `
                <svg class="verified-icon" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
                </svg>
              ` : ''}
            </div>
            <span class="supplier-address" title="${sAddress}">${sAddress}</span>
          </div>
        </div>

        <!-- Product Body with Clickable Model -->
        <div class="card-body">
          <h4 class="product-title clickable-model" onclick="selectModel('${p.name.replace(/'/g, "\\'")}')" title="Clique para isolar este modelo e atualizar os filtros">
            <span>${p.name}</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="opacity: 0.5;">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
          </h4>
          <div class="tags-row">
            ${p.storage ? `<span class="tag tag-storage" onclick="filterByStorage('${p.storage}')" style="cursor: pointer;" title="Filtrar por esta capacidade">${p.storage}</span>` : ''}
            ${p.color ? `<span class="tag tag-color" onclick="filterByColor('${p.color.trim().toUpperCase()}')" style="cursor: pointer;" title="Filtrar por esta cor"><span class="color-circle-mini" style="background-color: ${getAppleColorHex(p.color)};"></span>${p.color}</span>` : ''}
            ${p.region ? `<span class="tag tag-region">${p.region}</span>` : ''}
          </div>
        </div>

        <!-- Price Section -->
        <div class="card-price-section">
          <div class="price-box">
            <span class="price-val">${formatBRL(p.price)}</span>
          </div>
        </div>

        <!-- Actions -->
        <div class="card-actions">
          <a class="whatsapp-btn" href="${waLink}" target="_blank" rel="noopener noreferrer">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981z"/>
            </svg>
            <span>Chamar no WhatsApp</span>
          </a>
        </div>
      </article>
    `;
  }).join('');

  productsGrid.innerHTML = html;
}

// 7. AUTOCOMPLETE SEARCH LOGIC
function renderAutocomplete(term) {
  if (!autocompleteDropdown) return;
  const t = term.trim();
  if (!t) {
    autocompleteDropdown.classList.remove('open');
    return;
  }

  const tokens = normalizeSearchText(t).split(' ').filter(Boolean);

  // Extract all matching unique models
  const modelCounts = new Map();
  allProducts.forEach(p => {
    if (isCpoProduct(p)) return;

    // Check category filter
    if (currentCategory !== 'ALL') {
      const pCat = (p.category || '').toUpperCase();
      if (currentCategory === 'IPAD' && (pCat !== 'IPAD' && pCat !== 'IPD')) return;
      if (currentCategory !== 'IPAD' && pCat !== currentCategory) return;
    }

    const name = (p.name || '').trim();
    if (!name) return;

    // Token-based match: todos os tokens devem estar no nome normalizado
    const normalizedName = normalizeSearchText(name);
    const compactName = normalizedName.replace(/\s+/g, '');
    const matches = tokens.every(tok => {
      const compactTok = tok.replace(/\s+/g, '');
      return normalizedName.includes(tok) || (compactTok && compactName.includes(compactTok));
    });
    if (matches) {
      modelCounts.set(name, (modelCounts.get(name) || 0) + 1);
    }
  });

  const sorted = Array.from(modelCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10);

  if (sorted.length === 0) {
    autocompleteDropdown.innerHTML = `
      <div style="padding: 14px; text-align: center; color: var(--text-muted); font-size: 0.85rem;">
        Nenhum modelo encontrado para "${term}"
      </div>
    `;
    autocompleteDropdown.classList.add('open');
    return;
  }

  const itemsHtml = sorted.map(([mName, count]) => `
    <div class="autocomplete-item" onclick="selectModel('${mName.replace(/'/g, "\\'")}')">
      <div class="autocomplete-item-name">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--accent-green); flex-shrink: 0;">
          <rect width="14" height="20" x="5" y="2" rx="2" ry="2"/>
          <path d="M12 18h.01"/>
        </svg>
        <span>${mName}</span>
      </div>
      <span class="autocomplete-item-badge">${count} opções</span>
    </div>
  `).join('');

  autocompleteDropdown.innerHTML = itemsHtml;
  autocompleteDropdown.classList.add('open');
}

// Search input events (instant model & keyword search)
if (searchInput) {
  const debouncedSearchInput = debounce((val) => {
    if (!val.trim()) {
      selectedModel = '';
      searchQuery = '';
      if (autocompleteDropdown) autocompleteDropdown.classList.remove('open');
      updateDynamicFilters();
      render();
      return;
    }

    selectedModel = '';
    searchQuery = val.trim();
    updateDynamicFilters();
    render();

    renderAutocomplete(val);
  }, 120);

  searchInput.addEventListener('input', (e) => {
    const val = e.target.value;
    if (searchClearBtn) searchClearBtn.style.display = val ? 'flex' : 'none';
    debouncedSearchInput(val);
  });

  searchInput.addEventListener('focus', () => {
    if (searchInput.value.trim()) {
      renderAutocomplete(searchInput.value);
    }
  });

  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const firstItem = autocompleteDropdown ? autocompleteDropdown.querySelector('.autocomplete-item') : null;
      if (firstItem && autocompleteDropdown && autocompleteDropdown.classList.contains('open')) {
        firstItem.click();
      } else {
        if (autocompleteDropdown) autocompleteDropdown.classList.remove('open');
        searchInput.blur();
      }
    } else if (e.key === 'Escape') {
      if (autocompleteDropdown) autocompleteDropdown.classList.remove('open');
      searchInput.blur();
    }
  });
}

if (searchClearBtn) {
  searchClearBtn.addEventListener('click', () => {
    clearSelectedModel();
    if (searchInput) searchInput.focus();
  });
}

// Shortcut ⌘K / Ctrl+K to focus search & Esc to close
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    if (currentView === 'products') {
      searchInput.focus();
      searchInput.select();
    } else {
      const podInp = document.getElementById('podSearchInput');
      if (podInp) { podInp.focus(); podInp.select(); }
    }
  }
  if (e.key === 'Escape') {
    if (autocompleteDropdown) autocompleteDropdown.classList.remove('open');
    const podDropdown = document.getElementById('podAutocompleteDropdown');
    if (podDropdown) podDropdown.classList.remove('open');
    const allOffersModal = document.getElementById('allOffersModal');
    if (allOffersModal) allOffersModal.classList.remove('active');
  }
});

// Close autocomplete when clicking outside
document.addEventListener('click', (e) => {
  if (!e.target.closest('.search-box')) {
    if (autocompleteDropdown) autocompleteDropdown.classList.remove('open');
  }
});

// 8. Helper filter functions for click on tags
window.filterByColor = function(colorName) {
  selectedColor = colorName;
  colorFilter.value = colorName;
  render();
};

window.filterByStorage = function(storageName) {
  selectedStorage = storageName;
  storageFilter.value = storageName;
  updateDynamicFilters();
  render();
};

window.resetFilters = function() {
  currentCategory = 'ALL';
  selectedModel = '';
  searchQuery = '';
  selectedStorage = '';
  selectedRam = '';
  selectedColor = '';
  selectedSupplier = '';
  sortMode = 'price_asc';

  searchInput.value = '';
  searchClearBtn.style.display = 'none';
  if (autocompleteDropdown) autocompleteDropdown.classList.remove('open');
  if (storageFilter) storageFilter.value = '';
  if (ramFilter) ramFilter.value = '';
  if (colorFilter) colorFilter.value = '';
  if (supplierFilter) supplierFilter.value = '';

  categoryNav.querySelectorAll('.category-pill').forEach(b => {
    b.classList.toggle('active', b.dataset.category === 'ALL');
  });

  updateDynamicFilters();
  render();
};

// 9. Real-Time Socket Event Listeners (Silent Updates com Batching e Anti-Duplicação)
socket.on('price_changed', (evt) => {
  if (!evt || !evt.id) return;
  const index = allProducts.findIndex(p => String(p.id) === String(evt.id));
  if (index >= 0) {
    const prod = allProducts[index];
    prod.price = evt.newPrice;
    if (evt.product && evt.product.supplier !== undefined) {
      prod.supplier = evt.product.supplier;
    }
    allProducts[index] = prod;
    scheduleUiRefresh();
  }
});

socket.on('product_created', (item) => {
  if (!item || !item.id) return;
  const index = allProducts.findIndex(p => String(p.id) === String(item.id));
  if (index >= 0) {
    allProducts[index] = item;
  } else {
    allProducts.unshift(item);
  }
  if (totalCountEl) totalCountEl.textContent = allProducts.length;
  updateDynamicFilters();
  scheduleUiRefresh();
});

socket.on('product_updated', (item) => {
  if (!item || !item.id) return;
  const index = allProducts.findIndex(p => String(p.id) === String(item.id));
  if (index >= 0) {
    allProducts[index] = item;
    scheduleUiRefresh();
  }
});

socket.on('product_deleted', (evt) => {
  if (!evt || !evt.id) return;
  allProducts = allProducts.filter(p => String(p.id) !== String(evt.id));
  if (totalCountEl) totalCountEl.textContent = allProducts.length;
  updateDynamicFilters();
  scheduleUiRefresh();
});


socket.on('dollar_rate_update', (data) => {
  if (data && data.dollarRate) {
    updateHeaderDollarDisplay(data.dollarRate, data.dollarVariation);
    if (dollarRateText) dollarRateText.textContent = `R$ ${Number(data.dollarRate).toFixed(4)}`;
    if (dollarVarText && data.dollarVariation !== undefined) dollarVarText.textContent = `${data.dollarVariation > 0 ? '+' : ''}${Number(data.dollarVariation).toFixed(2)}%`;
  }
});

socket.on('catalog_reloaded', (meta) => {
  if (meta && meta.dollarRate && dollarRateText) dollarRateText.textContent = `R$ ${Number(meta.dollarRate).toFixed(4)}`;
  if (meta && meta.dollarRate) updateHeaderDollarDisplay(meta.dollarRate, meta.dollarVariation);
  if (meta && meta.latestDate && dateText) dateText.textContent = meta.latestDate;
  loadProducts();
});

// Real-Time Connection Watchdog Status Handler
socket.on('pxt_connection_status', (status) => {
  const badge = document.getElementById('connectionBadge');
  const dot = document.getElementById('connectionDot');
  const text = document.getElementById('connectionText');

  if (!badge || !dot || !text) return;

  if (status.connected) {
    badge.style.backgroundColor = 'var(--accent-green-bg)';
    badge.style.borderColor = 'rgba(16, 185, 129, 0.3)';
    badge.style.color = 'var(--accent-green)';
    dot.style.backgroundColor = 'var(--accent-green)';
    text.textContent = 'PREÇOS ATUALIZADOS AO VIVO';
  } else {
    badge.style.backgroundColor = 'rgba(245, 158, 11, 0.15)';
    badge.style.borderColor = 'rgba(245, 158, 11, 0.4)';
    badge.style.color = 'var(--accent-amber)';
    dot.style.backgroundColor = 'var(--accent-amber)';
    text.textContent = 'RECONECTANDO AUTOMATICAMENTE...';
  }
});

// 10. Secondary Filter Change Events
if (categoryNav) {
  categoryNav.addEventListener('click', (e) => {
    const btn = e.target.closest('.category-pill');
    if (!btn) return;
    categoryNav.querySelectorAll('.category-pill').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentCategory = btn.dataset.category;
    selectedModel = '';
    if (searchInput) searchInput.value = '';
    if (searchClearBtn) searchClearBtn.style.display = 'none';
    if (autocompleteDropdown) autocompleteDropdown.classList.remove('open');
    updateDynamicFilters();
    render();
  });
}

if (storageFilter) {
  storageFilter.addEventListener('change', (e) => {
    selectedStorage = e.target.value;
    updateDynamicFilters();
    render();
  });
}

if (ramFilter) {
  ramFilter.addEventListener('change', (e) => {
    selectedRam = e.target.value;
    updateDynamicFilters();
    render();
  });
}

if (colorFilter) {
  colorFilter.addEventListener('change', (e) => {
    selectedColor = e.target.value;
    render();
  });
}

if (supplierFilter) {
  supplierFilter.addEventListener('change', (e) => {
    selectedSupplier = e.target.value;
    render();
  });
}

const dateFilterSelect = document.getElementById('dateFilterSelect');
if (dateFilterSelect) {
  dateFilterSelect.addEventListener('change', (e) => {
    selectedDateMode = e.target.value;
    loadProducts(selectedDateMode);
  });
}

if (clearFiltersBtn) {
  clearFiltersBtn.addEventListener('click', resetFilters);
}

// 11. Theme Toggle (Dark / Light)
const themeBtn = document.getElementById('themeBtn');
const themeLabel = document.getElementById('themeLabel');
const themeIcon = document.getElementById('themeIcon');

function updateThemeUI(isLight) {
  if (themeLabel) themeLabel.textContent = isLight ? 'Modo Escuro' : 'Modo Claro';
  if (themeIcon) {
    if (isLight) {
      themeIcon.innerHTML = `<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>`;
    } else {
      themeIcon.innerHTML = `<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>`;
    }
  }
}

const savedTheme = localStorage.getItem('apple_pxt_theme') || 'light';
if (savedTheme !== 'dark') {
  document.body.classList.add('light-theme');
  updateThemeUI(true);
} else {
  updateThemeUI(false);
}

if (themeBtn) {
  themeBtn.addEventListener('click', () => {
    const isLight = document.body.classList.toggle('light-theme');
    localStorage.setItem('apple_pxt_theme', isLight ? 'light' : 'dark');
    updateThemeUI(isLight);
  });
}

// =========================================================================
// 12. MARGENS & TAXAS DA MAQUININHA (LOJA FÍSICA)
// =========================================================================
function isAsIsProduct(p) {
  if (!p) return false;
  const cat = (p.category || '').toUpperCase().trim();
  const name = (p.name || '').toUpperCase();
  const desc = (p.description || '').toUpperCase();
  const reg = (p.region || '').toUpperCase();
  return (
    name.includes('AS IS') ||
    name.includes('AS-IS') ||
    name.includes('ASIS') ||
    desc.includes('AS IS') ||
    desc.includes('AS-IS') ||
    desc.includes('ASIS') ||
    cat.includes('AS IS') ||
    cat.includes('AS-IS') ||
    reg.includes('AS IS') ||
    reg.includes('AS-IS')
  );
}

// Limpa o nome do produto removendo redundâncias como SEMI-NOVO, SEMINOVO, USADO, etc.
function cleanModelName(name) {
  if (!name) return 'Apple';
  let cleaned = name
    .replace(/\bSEMI\s*-\s*NOVO\b/gi, '')
    .replace(/\bSEMI-NOVO\b/gi, '')
    .replace(/\bSEMI NOVO\b/gi, '')
    .replace(/\bSEMINOVO\b/gi, '')
    .replace(/\bSEMI\s*-\b/gi, '')
    .replace(/\bSEMI\b/gi, '')
    .replace(/\b(USADO|VITRINE|GRADE A\+?|GRADE B|SWAP|SWP|RECONDICIONADO)\b/gi, '')
    .replace(/[-–—\s]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return 'Apple';
  return cleaned;
}

// Categorização de Seções para Exportação WhatsApp e Listas
function getProductSectionInfo(p) {
  const isSemi = isSeminovoProduct(p);
  const cat = (p.category || '').toUpperCase().trim();
  const name = (p.name || '').toUpperCase();

  if (isSemi) {
    if (cat === 'IPAD' || cat === 'IPD' || name.includes('IPAD')) {
      return { key: 'IPADS_SEMI', title: 'IPADS SEMINOVOS', order: 25 };
    }
    if (cat === 'MCB' || cat === 'IMAC' || name.includes('MAC') || name.includes('IMAC')) {
      return { key: 'MACS_SEMI', title: 'MACBOOKS SEMINOVOS', order: 45 };
    }
    if (cat === 'RLG' || name.includes('WATCH') || name.includes('SERIES') || name.includes('ULTRA')) {
      return { key: 'WATCHES_SEMI', title: 'APPLE WATCHES SEMINOVOS', order: 55 };
    }
    return { key: 'IPHONES_SEMINOVOS', title: 'IPHONES SEMINOVOS', order: 20 };
  }

  if (cat === 'IPH' || name.includes('IPHONE')) {
    return { key: 'IPHONES_NOVOS', title: 'IPHONES NOVOS', order: 10 };
  }
  if (cat === 'IPAD' || cat === 'IPD' || name.includes('IPAD')) {
    return { key: 'IPADS', title: 'IPADS', order: 30 };
  }
  if (cat === 'MCB' || cat === 'IMAC' || name.includes('MAC') || name.includes('IMAC')) {
    return { key: 'MACS', title: 'MACBOOKS & MACS', order: 40 };
  }
  if (cat === 'RLG' || name.includes('WATCH') || name.includes('SERIES') || name.includes('ULTRA')) {
    return { key: 'WATCHES', title: 'APPLE WATCHES', order: 50 };
  }
  if (cat === 'PODS' || name.includes('AIRPOD')) {
    return { key: 'AIRPODS', title: 'AIRPODS', order: 60 };
  }
  return { key: 'ACESSORIOS', title: 'ACESSÓRIOS', order: 70 };
}

// Modelos de seminovos não permitidos (apenas a partir do iPhone 13, excluindo 13 Mini e 512GB/1TB no 15/16)
function isDisallowedSeminovo(nameOrProduct, storage) {
  if (window.PricingCore && typeof window.PricingCore.isDisallowedSeminovo === 'function') {
    return window.PricingCore.isDisallowedSeminovo(nameOrProduct, storage);
  }
  if (!nameOrProduct) return false;
  let name = '';
  let stor = '';
  let desc = '';
  if (typeof nameOrProduct === 'object' && nameOrProduct !== null) {
    name = nameOrProduct.name || '';
    stor = nameOrProduct.storage || '';
    desc = nameOrProduct.description || '';
  } else {
    name = String(nameOrProduct || '');
    stor = storage ? String(storage) : '';
  }
  const n = name.toUpperCase();
  const s = stor.toUpperCase().trim();
  const d = desc.toUpperCase();

  if (n.includes('13 MINI') || n.includes('13-MINI') || n.includes('13MINI')) return true;
  if (/\b(IPHONE|IPH)\s+(11|12|X|XR|XS|SE|8|7|6)\b/i.test(n)) {
    return true;
  }
  const hasHighCap = s.includes('512') || s.includes('1TB') || s.includes('1 TB') || s.includes('2TB') || s.includes('2 TB') ||
                     d.includes('512GB') || d.includes('1TB') || d.includes('1 TB') || d.includes('2TB') || d.includes('2 TB') ||
                     /\b(512GB|1TB|2TB)\b/i.test(n);
  if (hasHighCap) {
    return true;
  }
  return false;
}

// Helper to detect if a product is an Apple Seminovo
function isSeminovoProduct(p) {
  if (!p) return false;
  if (isAsIsProduct(p)) return false;
  if (isDisallowedSeminovo(p)) return false;
  if (p.isSeminovo === true || p.condition === 'SEMINOVO') return true;
  const cat = (p.category || '').toUpperCase().trim();
  const name = (p.name || '').toLowerCase();
  const desc = (p.description || '').toLowerCase();
  return (
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
}

// Calculates reference supplier price
// For Seminovos:
// 1 offer: price of the offer
// 2 offers: simple average
// 3 offers: discards min and max, takes middle
// 4+ offers: discards min and max extremes, takes exact arithmetic mean of middle suppliers
function calculateSupplierReferencePrice(offers, isSeminovo = false) {
  if (!offers || offers.length === 0) return 0;
  if (!isSeminovo) {
    const valid = offers.map(o => Number(o.price) || 0).filter(p => p > 0);
    return valid.length > 0 ? Math.min(...valid) : 0;
  }

  const validPrices = offers
    .map(o => Number(o.price) || 0)
    .filter(p => p > 0)
    .sort((a, b) => a - b);

  if (validPrices.length === 0) return 0;
  if (validPrices.length === 1) return validPrices[0];
  if (validPrices.length === 2) return Math.round((validPrices[0] + validPrices[1]) / 2);
  if (validPrices.length === 3) return validPrices[1];

  // 4 or more offers: discard lowest (index 0) and highest (index length - 1)
  const trimmed = validPrices.slice(1, -1);
  const sum = trimmed.reduce((acc, val) => acc + val, 0);
  return Math.round(sum / trimmed.length);
}

let margins = {
  categories: {
    SEMINOVOS: 600,
    IPH_DUO: 2300,
    IPH18: 1300,
    IPH: 750,
    MCB_AIR: 1000,
    MCB_PRO: 1300,
    MCB_MAX: 2500,
    IPAD: 500,
    RLG: 500,
    IMAC: 1500,
    PODS: 400,
    ACSS: 100,
    FOLIO: 400,
    PENCIL: 200,
    AIRTAG_UNIT: 100,
    AIRTAG_PACK: 350,
    MAGIC_KEY: 400,
    MAGIC_MOUSE: 430,
    APPLE_TV: 500
  },
  products: {}
};

let cardRates = {
  baseRate: 2.69,
  calculationMode: 'factor',
  installmentRates: {
    "1": 3.05, "2": 1.50, "3": 2.25, "4": 3.00, "5": 3.75, "6": 4.50,
    "7": 5.25, "8": 6.00, "9": 6.75, "10": 7.50, "11": 8.25, "12": 9.00,
    "13": 9.75, "14": 10.50, "15": 11.25, "16": 12.00, "17": 12.75, "18": 13.50
  }
};

async function loadMargins() {
  try {
    const res = await fetch('/api/margins');
    if (!res.ok) return;
    const data = await res.json();
    if (data.success && data.margins) {
      margins = data.margins;
      if (currentView === 'storefront') {
        renderStoreFront();
      }
    }
  } catch (err) {
    console.error('Erro ao carregar margens:', err);
  }
}

async function loadCardRates() {
  try {
    const res = await fetch('/api/card-rates');
    if (!res.ok) return;
    const data = await res.json();
    if (data.success && data.rates) {
      cardRates = data.rates;
    }
  } catch (err) {
    console.error('Erro ao carregar taxas da maquininha:', err);
  }
}

socket.on('margins_updated', async () => {
  await loadMargins();
  await loadProducts();
});

socket.on('card_rates_updated', async () => {
  await loadCardRates();
  if (document.getElementById('cardSimulatorModal')?.classList.contains('active')) recalculateSimulator();
  if (document.getElementById('quoteBuilderModal')?.classList.contains('active')) recalculateQuoteTotals();
});

function getProductMargin(rawModel, category, isSemi = false) {
  if (window.IS_CATALOG_SHIELDED) return 0; // Margem e DFU já embutidos no preço pelo backend
  if (window.PricingCore && typeof window.PricingCore.getProductMargin === 'function') {
    return window.PricingCore.getProductMargin(rawModel, category, isSemi, margins);
  }
  const nameUpper = (rawModel || '').trim().toUpperCase();
  const catUpper = (category || '').trim().toUpperCase();

  // 1. Exceção de modelo específico se cadastrada no painel admin
  let margin = margins.products ? margins.products[nameUpper] : undefined;
  if (margin !== undefined) return Number(margin) || 0;

  // 2. Se for Linha iPhone Duo, aplica a margem de R$ 2.300
  if (nameUpper.includes('IPHONE DUO') || nameUpper.includes('DUO')) {
    return (margins.categories && margins.categories.IPH_DUO !== undefined) ? Number(margins.categories.IPH_DUO) : 2300;
  }

  // 2.1. Se for Linha iPhone 18 (Lançamento Importante), aplica a margem de R$ 1.300
  if (nameUpper.includes('IPHONE 18') || nameUpper.includes('IPH 18')) {
    return (margins.categories && margins.categories.IPH18 !== undefined) ? Number(margins.categories.IPH18) : 1300;
  }

  // 3. Se for Seminovo, aplica a margem de Seminovos (padrão R$ 600)
  if (isSemi) {
    return (margins.categories && margins.categories.SEMINOVOS !== undefined) ? Number(margins.categories.SEMINOVOS) : 600;
  }

  // 4. Margem padrão por Categoria
  if (margins.categories) {
    if (nameUpper.includes('FOLIO') || nameUpper.includes('SMART FOLIO')) {
      return margins.categories.FOLIO ?? 400;
    } else if (nameUpper.includes('PENCIL')) {
      return margins.categories.PENCIL ?? 200;
    } else if (nameUpper.includes('AIRTAG') && (nameUpper.includes('4 PACK') || nameUpper.includes('4-PACK') || nameUpper.includes('4PACK') || nameUpper.includes('PACOTE') || nameUpper.includes('4PK') || nameUpper.includes('4 UN') || nameUpper.includes('4UN'))) {
      return margins.categories.AIRTAG_PACK ?? 350;
    } else if (nameUpper.includes('AIRTAG')) {
      return margins.categories.AIRTAG_UNIT ?? 100;
    } else if (nameUpper.includes('MAGIC KEY') || nameUpper.includes('MAGIC KEYBOARD') || nameUpper.includes('SMART KEYBOARD') || nameUpper.includes('SMART KEY')) {
      return margins.categories.MAGIC_KEY ?? 400;
    } else if (nameUpper.includes('MAGIC MOUSE') || (nameUpper.includes('MOUSE') && (catUpper === 'ACSS' || nameUpper.includes('APPLE')))) {
      return margins.categories.MAGIC_MOUSE ?? 430;
    } else if (nameUpper.includes('APPLE TV') || nameUpper.includes('APPLETV') || nameUpper.includes('TV 4K') || nameUpper.includes('TV HD')) {
      return margins.categories.APPLE_TV ?? 500;
    } else if (catUpper === 'IPH' || nameUpper.includes('IPHONE')) {
      return margins.categories.IPH ?? 750;
    } else if ((nameUpper.includes('MACBOOK') || catUpper === 'MCB') && nameUpper.includes('MAX')) {
      return (margins.categories && margins.categories.MCB_MAX !== undefined) ? margins.categories.MCB_MAX : 2500;
    } else if (nameUpper.includes('MACBOOK AIR') || nameUpper.includes('AIR M') || (catUpper === 'MCB' && nameUpper.includes('AIR'))) {
      return margins.categories.MCB_AIR ?? 1000;
    } else if (catUpper === 'MCB' || nameUpper.includes('MACBOOK') || nameUpper.includes('MAC MINI') || nameUpper.includes('MAC STUDIO') || nameUpper.includes('MAC PRO')) {
      return margins.categories.MCB_PRO ?? 1300;
    } else if (catUpper === 'IPAD' || catUpper === 'IPD' || nameUpper.includes('IPAD')) {
      if (nameUpper.includes('PRO') || nameUpper.includes('AIR')) {
        return margins.categories.IPAD_PRO_AIR ?? 750;
      } else {
        return margins.categories.IPAD ?? 500;
      }
    } else if (catUpper === 'RLG' || nameUpper.includes('WATCH') || nameUpper.includes('SERIES') || nameUpper.includes('ULTRA')) {
      if (nameUpper.includes('ULTRA') || nameUpper.includes('S12')) {
        return margins.categories.RLG_ULTRA_S12 ?? 800;
      } else {
        return margins.categories.RLG ?? 500;
      }
    } else if (catUpper === 'IMAC' || nameUpper.includes('IMAC')) {
      return margins.categories.IMAC ?? 1500;
    } else if (catUpper === 'PODS' || nameUpper.includes('AIRPOD')) {
      return margins.categories.PODS ?? 400;
    } else if (catUpper === 'ACSS' || nameUpper.includes('MAGIC')) {
      return margins.categories.ACSS ?? 100;
    } else {
      return margins.categories.DEFAULT ?? 500;
    }
  }

  return 500;
}

function getProductRetailPrice(p) {
  if (!p || !p.price) return 0;
  if (window.IS_CATALOG_SHIELDED) return Number(p.price) || 0;
  const isSemi = isSeminovoProduct(p);
  if (window.PricingCore && typeof window.PricingCore.calculateRetailPrice === 'function') {
    return window.PricingCore.calculateRetailPrice(p.price, p.category, p.name, isSemi, margins);
  }
  const dfuCost = applyDFU(p.price, p.category, p.name);
  const margin = getProductMargin(p.name, p.category, isSemi);
  return dfuCost + margin;
}

// =========================================================================
// VIEW MANAGER: PREÇOS DO DIA VS LOJA FÍSICA
// =========================================================================
let currentView = 'prices_of_the_day'; // Preços do Dia por padrão

let podCurrentCategory = 'IPH';
let podSearchQuery = '';
let podSelectedRegion = '';
let podOnlyVerified = false;

let sfCurrentCategory = 'IPH';
let sfSearchQuery = '';

window.switchView = function(viewName) {
  // Se não estiver logado, proibir acesso a Preços de Fornecedor e Orçamentos
  if ((viewName === 'prices_of_the_day' || viewName === 'quotes') && !currentUser) {
    viewName = 'storefront';
  }

  currentView = viewName;
  const viewPricesDay = document.getElementById('viewPricesDay');
  const viewStoreFront = document.getElementById('viewStoreFront');
  const viewQuotes = document.getElementById('viewQuotes');
  const tabPricesDay = document.getElementById('tabPricesDay');
  const tabStoreFront = document.getElementById('tabStoreFront');
  const tabQuotes = document.getElementById('tabQuotes');

  // Reset tabs
  if (tabPricesDay) tabPricesDay.classList.remove('active');
  if (tabStoreFront) tabStoreFront.classList.remove('active');
  if (tabQuotes) tabQuotes.classList.remove('active');

  // Reset views
  if (viewPricesDay) viewPricesDay.style.display = 'none';
  if (viewStoreFront) viewStoreFront.style.display = 'none';
  if (viewQuotes) viewQuotes.style.display = 'none';

  if (viewName === 'quotes') {
    if (viewQuotes) viewQuotes.style.display = 'block';
    if (tabQuotes) tabQuotes.classList.add('active');
    if (typeof loadQuotes === 'function') loadQuotes();
  } else if (viewName === 'storefront') {
    if (viewStoreFront) viewStoreFront.style.display = 'block';
    if (tabStoreFront) tabStoreFront.classList.add('active');
    renderStoreFront();
  } else {
    if (viewPricesDay) viewPricesDay.style.display = 'block';
    if (tabPricesDay) tabPricesDay.classList.add('active');
    renderPricesOfTheDay();
  }
};

function refreshCurrentView() {
  if (currentView === 'storefront') {
    renderStoreFront();
  } else {
    renderPricesOfTheDay();
  }
}

// Helpers de formatação para layout idêntico ao mockup
function formatBRLClean(val) {
  if (val === null || val === undefined || isNaN(val)) return 'R$ 0';
  const num = Number(val);
  if (num % 1 === 0) {
    return 'R$ ' + Math.round(num).toLocaleString('pt-BR');
  }
  return num.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatStorageBadge(storage) {
  if (!storage) return '';
  return storage.replace(/\s+/g, ' ').replace(/^(\d+)\s*(GB|TB)$/i, '$1 $2').toUpperCase();
}

function formatDisplayModelName(name) {
  if (!name) return '';
  let s = name.trim();
  s = s.replace(/\bIPHONE\b/gi, 'iPhone')
       .replace(/\bIPAD\b/gi, 'iPad')
       .replace(/\bMACBOOK\b/gi, 'MacBook')
       .replace(/\bIMAC\b/gi, 'iMac')
       .replace(/\bAIRPODS?\b/gi, 'AirPods')
       .replace(/\bWATCH\b/gi, 'Watch')
       .replace(/\bPRO MAX\b/gi, 'Pro Max')
       .replace(/\bPRO\b/gi, 'Pro')
       .replace(/\bPLUS\b/gi, 'Plus')
       .replace(/\bAIR\b/gi, 'Air')
       .replace(/\bMINI\b/gi, 'Mini')
       .replace(/\bULTRA\b/gi, 'Ultra')
       .replace(/\bSE\b/gi, 'SE');
  return s;
}

function formatColorName(c) {
  if (!c) return 'Padrão';
  const str = c.trim();
  return str.split(' ').map(w => {
    if (w.length <= 2 && w.toUpperCase() === 'SE') return 'SE';
    return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  }).join(' ');
}

let lastColorCategory = '';
function updateStoreFrontColorFilterOptions(products) {
  const select = document.getElementById('sfColorFilter');
  if (!select) return;
  if (lastColorCategory === sfCurrentCategory && select.options.length > 1) return;
  lastColorCategory = sfCurrentCategory;

  const currentVal = select.value;
  const colorSet = new Set();
  (products || allProducts).forEach(p => {
    if (p.color && !isDisallowedProduct(p)) {
      const c = p.color.trim();
      if (c) colorSet.add(formatColorName(c));
    }
  });
  const sorted = Array.from(colorSet).sort();
  select.innerHTML = '<option value="ALL">Todas</option>' + sorted.map(c => `<option value="${c}">${c}</option>`).join('');
  if (colorSet.has(currentVal)) {
    select.value = currentVal;
  } else {
    select.value = 'ALL';
  }
}

// Renderizador da View Loja Física (Mockup Fiel ao Design)
function renderStoreFront() {
  const container = document.getElementById('storefrontGrid');
  if (!container) return;

  const sLower = sfSearchQuery.trim().toLowerCase();
  const searchTokens = normalizeSearchText(sLower).split(' ').filter(Boolean);

  const sfCapacityFilter = document.getElementById('sfCapacityFilter');
  const selectedCapacity = sfCapacityFilter ? sfCapacityFilter.value : 'ALL';

  const sfColorFilter = document.getElementById('sfColorFilter');
  const selectedColor = sfColorFilter ? sfColorFilter.value : 'ALL';

  // Atualiza as opções de cor para o dropdown de cores
  updateStoreFrontColorFilterOptions();

  // Filtrar produtos válidos (exclui CPO, AS IS e itens desativados)
  const filtered = allProducts.filter(p => {
    if (isDisallowedProduct(p)) return false;
    if (!p.price || p.price <= 0) return false;

    const isSemi = isSeminovoProduct(p);

    // Filtro de Categoria (se houver busca por texto, busca em todo o catálogo)
    if (searchTokens.length === 0 && sfCurrentCategory !== 'ALL') {
      if (sfCurrentCategory === 'SEMI') {
        if (!isSemi) return false;
      } else {
        if (isSemi) return false; // Separa novos de seminovos
        const cat = (p.category || '').toUpperCase().trim();
        const name = (p.name || '').toUpperCase();
        if (sfCurrentCategory === 'IPH' && !(cat === 'IPH' || name.includes('IPHONE'))) return false;
        if (sfCurrentCategory === 'MCB' && !(cat === 'MCB' || name.includes('MACBOOK') || name.includes('MAC MINI') || name.includes('MAC STUDIO') || name.includes('MAC PRO') || name.includes('IMAC'))) return false;
        if (sfCurrentCategory === 'IPAD' && !(cat === 'IPAD' || cat === 'IPD' || name.includes('IPAD'))) return false;
        if (sfCurrentCategory === 'RLG' && !(cat === 'RLG' || name.includes('WATCH') || name.includes('SERIES') || name.includes('ULTRA'))) return false;
        if (sfCurrentCategory === 'PODS' && !(cat === 'PODS' || name.includes('AIRPOD'))) return false;
        if (sfCurrentCategory === 'ACSS' && !(cat === 'ACSS' || name.includes('PENCIL') || name.includes('MAGIC') || name.includes('CABO') || name.includes('FONTE') || name.includes('CARREGADOR'))) return false;
        if (sfCurrentCategory === 'IMAC' && !(cat === 'IMAC' || name.includes('IMAC'))) return false;
      }
    }

    // Filtro de Capacidade
    if (selectedCapacity !== 'ALL') {
      const normStorage = (p.storage || '').toUpperCase().replace(/\s+/g, '');
      if (normStorage !== selectedCapacity && (normStorage + 'GB') !== selectedCapacity) {
        return false;
      }
    }

    // Filtro de Cor
    if (selectedColor !== 'ALL') {
      const cName = formatColorName(p.color || '');
      if (cName.toUpperCase() !== selectedColor.toUpperCase()) {
        return false;
      }
    }

    // Filtro por texto digitado
    if (searchTokens.length > 0) {
      if (!matchSearchTokens(p, searchTokens)) return false;
    }

    return true;
  });

  // Agrupamento por Modelo e Armazenamento (cada variante é um card na grade de 4 colunas)
  const cardsMap = new Map();

  filtered.forEach(p => {
    const isSemi = isSeminovoProduct(p);
    const baseModelName = cleanModelName(p.name);
    const displayName = isSemi ? `${baseModelName} (Seminovo)` : baseModelName;
    const ram = getMacBookRam(p);
    const storageKey = (p.storage || 'PADRÃO').trim().toUpperCase();
    const cardUniqueKey = `${baseModelName.toUpperCase()}__${isSemi ? 'SEMI' : 'NEW'}__${storageKey}__${ram || ''}`;

    if (!cardsMap.has(cardUniqueKey)) {
      cardsMap.set(cardUniqueKey, {
        uniqueKey: cardUniqueKey,
        displayName: displayName,
        rawModelName: baseModelName,
        category: p.category,
        storage: (p.storage || '').trim(),
        ram: ram,
        isSeminovo: isSemi,
        colorsMap: new Map()
      });
    }

    const cardObj = cardsMap.get(cardUniqueKey);
    const colorName = (p.color || 'Padrão').trim();
    const colorKey = colorName.toUpperCase();

    if (!cardObj.colorsMap.has(colorKey)) {
      cardObj.colorsMap.set(colorKey, {
        color: colorName,
        offers: [p],
        ram: ram
      });
    } else {
      cardObj.colorsMap.get(colorKey).offers.push(p);
    }
  });

  // Processar preços de cada card e calcular menor/maior preço
  const cardsList = Array.from(cardsMap.values()).map(card => {
    const colorsArr = Array.from(card.colorsMap.values()).map(colObj => {
      const isSemi = card.isSeminovo;
      const offers = colObj.offers || [];
      const rawRefCost = calculateSupplierReferencePrice(offers, isSemi);
      const refCost = applyDFU(rawRefCost, card.category, card.rawModelName);
      
      const marginVal = getProductMargin(card.rawModelName, card.category, isSemi);
      const retailPrice = refCost + marginVal;

      return {
        color: colObj.color,
        retailPrice: retailPrice,
        ram: colObj.ram
      };
    }).sort((a, b) => a.retailPrice - b.retailPrice);

    const minPrice = colorsArr.length > 0 ? colorsArr[0].retailPrice : 0;
    const maxPrice = colorsArr.length > 0 ? colorsArr[colorsArr.length - 1].retailPrice : 0;

    return {
      ...card,
      colorsArr,
      minPrice,
      maxPrice
    };
  });

  // Mantém os modelos mais recentes no início, com as variantes ordenadas por capacidade.
  cardsList.sort((a, b) => {
    const rankA = getModelOrderRank(a.rawModelName || a.displayName, a.category);
    const rankB = getModelOrderRank(b.rawModelName || b.displayName, b.category);
    if (rankA !== rankB) return rankA - rankB;
    if (a.isSeminovo !== b.isSeminovo) return a.isSeminovo ? 1 : -1;
    const sDiff = getStorageRank(a.storage) - getStorageRank(b.storage);
    if (sDiff !== 0) return sDiff;
    return (parseInt(a.ram) || 0) - (parseInt(b.ram) || 0);
  });

  if (cardsList.length === 0) {
    if (allProducts.length === 0 && catalogStatus === 'loading') {
      container.innerHTML = `
        <div class="app-catalog-loader">
          <div class="app-spinner"></div>
          <p style="color: var(--text-primary, #0f172a); font-weight: 600; font-size: 1rem; margin-bottom: 6px;">Carregando vitrine com preços atualizados...</p>
          <span style="color: var(--text-muted, #64748b); font-size: 0.85rem;">Calculando margens e parcelamentos da loja</span>
        </div>
      `;
      return;
    }
    container.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 60px 20px; color: var(--text-muted);">
        <h3 style="font-size: 1.25rem; color: var(--text-primary, #0f172a); margin-bottom: 8px;">${catalogStatus === 'error' ? 'Não foi possível atualizar o catálogo.' : 'Nenhum produto encontrado.'}</h3>
        <p style="font-size: 0.9rem;">${catalogStatus === 'error' ? 'Verifique sua conexão e tente novamente.' : 'Tente outra busca ou categoria. O catálogo pode estar sem produtos disponíveis.'}</p>
        <button type="button" class="header-action-btn" onclick="loadProducts()" style="margin: 16px auto 0;">Atualizar catálogo</button>
      </div>
    `;
    return;
  }

  window.storefrontCardMap = new Map();
  const cardsByModel = new Map();
  cardsList.forEach(card => {
    const familyKey = `${(card.rawModelName || card.displayName).toUpperCase()}__${card.category || ''}__${card.isSeminovo ? 'SEMI' : 'NEW'}`;
    if (!cardsByModel.has(familyKey)) cardsByModel.set(familyKey, []);
    cardsByModel.get(familyKey).push(card);
  });

  let html = '';
  let cardIndex = 0;

  Array.from(cardsByModel.values()).forEach(modelCards => {
    const family = modelCards[0];
    html += `<section class="model-family-row" aria-label="${escapeHtml(family.displayName)}">`;
    modelCards.forEach(card => {
    const idx = cardIndex++;
    const cardKey = `sf_card_${idx}`;
    window.storefrontCardMap.set(cardKey, {
      model: card.displayName,
      rawModel: card.rawModelName,
      storage: card.storage,
      ram: card.ram,
      isSeminovo: card.isSeminovo,
      colors: card.colorsArr.map(c => ({ color: c.color, price: c.retailPrice }))
    });

    const colorRowsHtml = card.colorsArr.map(col => {
      const hex = getAppleColorHex(col.color);

      return `
        <button type="button" class="mock-color-row" data-model="${escapeHtml(encodeURIComponent(card.displayName))}" data-storage="${escapeHtml(encodeURIComponent(card.storage))}" data-color="${escapeHtml(encodeURIComponent(col.color))}" data-price="${col.retailPrice}" data-ram="${escapeHtml(encodeURIComponent(card.ram || ''))}" onclick="openCardSimulator(this.dataset.model, this.dataset.storage, this.dataset.color, Number(this.dataset.price), this.dataset.ram)" aria-label="${escapeHtml(`Simular ${card.displayName} ${card.storage}, cor ${col.color}, ${formatBRL(col.retailPrice)} à vista`)}">
          <span class="mock-color-left">
            <span class="mock-color-dot" style="background-color: ${hex};" aria-hidden="true"></span>
            <span class="mock-color-name" title="${escapeHtml(col.color)}">${escapeHtml(formatColorName(col.color))}</span>
          </span>
          <span class="mock-color-right">
            <span class="mock-price-block">
              <span class="mock-price-label">À VISTA</span>
              <span class="mock-price-val">${formatBRLClean(col.retailPrice)}</span>
            </span>
            <span class="mock-card-sim-btn" aria-hidden="true">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="2" y="5" width="20" height="14" rx="2.5"/>
                <line x1="2" y1="10" x2="22" y2="10"/>
              </svg>
            </span>
          </span>
        </button>
      `;
    }).join('');

    html += `
      <article class="mock-card">
        <div class="mock-card-header">
          <div class="mock-card-title-row">
            <h3 class="mock-card-title" title="${escapeHtml(card.displayName)}">${escapeHtml(formatDisplayModelName(card.displayName))}</h3>
            <button class="mock-card-ver-btn" onclick="openClientShowcaseModal('${cardKey}')" title="Ver detalhes do modelo">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/>
                <circle cx="12" cy="12" r="3"/>
              </svg>
              <span>Ver</span>
            </button>
          </div>
          <div class="mock-card-badges-row">
            ${card.storage ? `<span class="mock-storage-badge">${formatStorageBadge(card.storage)}</span>` : ''}
            ${card.isSeminovo ? `<span class="mock-seminovo-badge">Seminovo</span>` : ''}
            ${card.ram ? `<span class="mock-ram-badge">${card.ram} RAM</span>` : ''}
          </div>
        </div>
        <div class="mock-card-body">
          ${colorRowsHtml}
        </div>
      </article>
    `;
    });
    html += '</section>';
  });

  container.innerHTML = html;
}

// Helper para formatar texto deixando somente a primeira letra maiúscula (e o resto minúsculo)
function formatOnlyFirstLetterUpper(str) {
  if (!str) return '';
  const s = str.trim();
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

// Helper para formatar o nome do modelo para texto copiado (Modelo + GB em MAIÚSCULO)
function formatModelTitleForCopy(model, storage, ram) {
  const parts = [model || ''];
  if (ram && !model.toUpperCase().includes(ram.toUpperCase())) parts.push(ram);
  if (storage) parts.push(storage);
  return parts.join(' ').trim().toUpperCase()
    .replace(/\b(\d+)\s*GB\b/gi, '$1GB')
    .replace(/\b(\d+)\s*TB\b/gi, '$1TB')
    .replace(/\b(\d+)\s*RAM\b/gi, '$1 RAM');
}

// Modal de Vitrine Limpa para Apresentar ao Cliente
window.openClientShowcaseModal = function(firstArg, encStorage, encRam, isSeminovo, encColorsJson) {
  const modal = document.getElementById('clientShowcaseModal');
  const titleEl = document.getElementById('showcaseModelTitle');
  const subEl = document.getElementById('showcaseModelSubtitle');
  const bodyEl = document.getElementById('clientShowcaseBody');
  if (!modal || !bodyEl) return;

  let model = '', storage = '', ram = '', isSemi = false, colors = [];

  if (typeof firstArg === 'string' && window.storefrontCardMap && window.storefrontCardMap.has(firstArg)) {
    const data = window.storefrontCardMap.get(firstArg);
    model = data.model;
    storage = data.storage;
    ram = data.ram;
    isSemi = Boolean(data.isSeminovo);
    colors = data.colors || [];
  } else {
    model = decodeURIComponent(firstArg || '');
    storage = decodeURIComponent(encStorage || '');
    ram = decodeURIComponent(encRam || '');
    isSemi = Boolean(isSeminovo);
    try {
      colors = JSON.parse(decodeURIComponent(encColorsJson || '[]'));
    } catch (e) {
      colors = [];
    }
  }

  const titleFormatted = formatModelTitleForCopy(model, storage, ram);
  if (titleEl) titleEl.textContent = titleFormatted;
  if (subEl) {
    subEl.textContent = `${isSemi ? 'Seminovo Selecionado' : 'Produto Novo Lacrado'} • Preços válidos à vista e simulação no cartão`;
  }

  // Gera lista espaçosa de cores
  let colorsHtml = '';
  colors.forEach(c => {
    const hex = getAppleColorHex(c.color);
    const colorFormatted = formatOnlyFirstLetterUpper(c.color);
    colorsHtml += `
      <div style="display: flex; align-items: center; justify-content: space-between; padding: 12px 14px; background: var(--bg-input); border: 1px solid var(--border-color); border-radius: 12px; margin-bottom: 8px;">
        <div style="display: flex; align-items: center; gap: 10px;">
          <span style="width: 16px; height: 16px; border-radius: 50%; background-color: ${hex}; border: 1.5px solid rgba(255,255,255,0.3); display: inline-block;"></span>
          <span style="font-size: 0.95rem; font-weight: 700; color: var(--text-primary);">${colorFormatted}</span>
        </div>
        <div style="text-align: right;">
          <span style="font-size: 0.65rem; font-weight: 800; color: var(--text-muted); text-transform: uppercase; display: block;">À VISTA</span>
          <span style="font-size: 1.15rem; font-weight: 800; color: var(--accent-green);">${formatBRL(c.price)}</span>
        </div>
      </div>
    `;
  });

  bodyEl.innerHTML = `
    <div style="display: flex; flex-direction: column;">
      ${colorsHtml}
    </div>
  `;

  modal.classList.add('active');
};

window.closeClientShowcaseModal = function() {
  const modal = document.getElementById('clientShowcaseModal');
  if (modal) {
    modal.classList.remove('active');
  }
};

// Helper robusto para copiar texto no PC e Mobile (Opera GX, Chrome, Safari iOS/Mac)
async function robustCopyToClipboard(text) {
  if (!text) return false;

  // 1. Tenta API moderna do Clipboard
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      console.warn('[Clipboard] Falha no navigator.clipboard, usando fallback compatível:', e);
    }
  }

  // 2. Fallback universal (elementos a -999999px são bloqueados por segurança em novos browsers)
  let successful = false;
  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.style.position = "fixed";
  textArea.style.top = "0";
  textArea.style.left = "0";
  textArea.style.width = "2em";
  textArea.style.height = "2em";
  textArea.style.padding = "0";
  textArea.style.border = "none";
  textArea.style.outline = "none";
  textArea.style.boxShadow = "none";
  textArea.style.background = "transparent";
  textArea.style.opacity = "0.01";
  textArea.style.zIndex = "-1";
  textArea.setAttribute('readonly', '');
  document.body.appendChild(textArea);
  
  try {
    textArea.focus();
    textArea.select();
    textArea.setSelectionRange(0, text.length);
    successful = document.execCommand('copy');
  } catch (err) {
    successful = false;
  }
  document.body.removeChild(textArea);
  return successful;
}

// Helper para copiar tabela de preços formatada para WhatsApp de um modelo específico
window.copyModelPrices = async function(firstArg, secondArg, encStorage, encRam, encColorsJson, isCusto = false) {
  let btn, model = '', storage = '', ram = '', colors = [], custoFlag = false;

  if (typeof firstArg === 'string' && (window.storefrontCardMap?.has(firstArg) || window.matrixCardMap?.has(firstArg))) {
    const data = window.storefrontCardMap?.get(firstArg) || window.matrixCardMap?.get(firstArg);
    model = data.model;
    storage = data.storage;
    ram = data.ram;
    colors = data.colors || [];
    custoFlag = Boolean(data.isCusto);
    btn = secondArg;
  } else {
    btn = firstArg;
    model = decodeURIComponent(secondArg || '');
    storage = decodeURIComponent(encStorage || '');
    ram = decodeURIComponent(encRam || '');
    custoFlag = Boolean(isCusto);
    try {
      colors = JSON.parse(decodeURIComponent(encColorsJson || '[]'));
    } catch (e) {
      colors = [];
    }
  }

  try {
    const titleLine = formatModelTitleForCopy(model, storage, ram);

    let lines = [titleLine, ''];
    colors.forEach(c => {
      const colorFormatted = formatOnlyFirstLetterUpper(c.color);
      lines.push(`${colorFormatted} • ${formatBRL(c.price)}`);
    });

    if (!custoFlag) {
      lines.push('');
      const isSemi = Boolean(data?.isSeminovo) || model.toUpperCase().includes('SEMINOVO') || model.toUpperCase().includes('SEMI NOVO');
      if (!isSemi) {
        lines.push('Produto novo lacrado com 1 ano de garantia Apple.');
        lines.push('Emitimos nota fiscal.');
        lines.push('');
      }
      lines.push('Valores válidos para pagamento à vista.');
      lines.push('Consulte opções de parcelamento no cartão.');
    }

    const textToCopy = lines.join('\n');
    await robustCopyToClipboard(textToCopy);

    if (btn) {
      const originalHtml = btn.innerHTML;
      btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg><span style="color: #10b981; font-weight: 800;">Copiado!</span>`;
      setTimeout(() => {
        btn.innerHTML = originalHtml;
      }, 2000);
    }
  } catch (err) {
    console.error('Erro ao copiar lista de preços:', err);
  }
};

// =========================================================================
// MODAL: EDITAR MARGEM DIRETA DE UM MODELO ESPECÍFICO
// =========================================================================
let currentEditingModel = '';

window.openEditMarginModal = function(encModel) {
  const modelName = decodeURIComponent(encModel || '').trim();
  if (!modelName) return;

  currentEditingModel = modelName;
  const modal = document.getElementById('editMarginModal');
  const nameEl = document.getElementById('editMarginModelName');
  const inputEl = document.getElementById('editMarginInput');

  if (nameEl) nameEl.textContent = modelName.toUpperCase();

  const keyUpper = modelName.toUpperCase();
  const currentMargin = margins.products ? margins.products[keyUpper] : undefined;
  if (inputEl) {
    inputEl.value = (currentMargin !== undefined && currentMargin !== null) ? currentMargin : '';
  }

  if (modal) {
    modal.classList.add('active');
    modal.style.display = 'flex';
  }
};

window.closeEditMarginModal = function() {
  const modal = document.getElementById('editMarginModal');
  if (modal) {
    modal.classList.remove('active');
    modal.style.display = 'none';
  }
  currentEditingModel = '';
};

window.saveSingleProductMargin = async function() {
  if (!currentEditingModel) return;
  const inputEl = document.getElementById('editMarginInput');
  const btn = document.getElementById('btnSaveSingleMargin');
  const val = inputEl ? inputEl.value.trim() : '';

  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Salvando...';
  }

  try {
    const resp = await fetch('/api/margins/custom', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        singleProduct: currentEditingModel.toUpperCase(),
        singleMargin: val === '' ? null : Number(val)
      })
    });

    const data = await resp.json();
    if (resp.ok && data.success) {
      margins = data.margins;
      closeEditMarginModal();
      if (currentView === 'storefront') {
        renderStoreFront();
      }
    } else {
      alert(data.error || 'Não foi possível salvar a margem.');
    }
  } catch (err) {
    console.error('Erro ao salvar margem:', err);
    alert('Erro de conexão ao salvar margem.');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Salvar Margem';
    }
  }
};

// Category Count Badges Updater for Preços do Dia
function updatePricesDayCategoryCounts() {
  let cALL = 0, cSEMI = 0, cIPH = 0, cMCB = 0, cIPAD = 0, cRLG = 0, cPODS = 0, cACSS = 0, cIMAC = 0;

  allProducts.forEach(p => {
    if (!p.price || p.price <= 0) return;
    const isSemi = isSeminovoProduct(p);
    const cat = (p.category || '').toUpperCase().trim();
    const name = (p.name || '').toUpperCase();
    cALL++;
    if (isSemi) {
      cSEMI++;
    } else {
      if (cat === 'IPH' || name.includes('IPHONE')) cIPH++;
      else if (cat === 'MCB' || name.includes('MACBOOK') || name.includes('MAC MINI') || name.includes('MAC STUDIO') || name.includes('MAC PRO')) cMCB++;
      else if (cat === 'IPAD' || cat === 'IPD' || name.includes('IPAD')) cIPAD++;
      else if (cat === 'RLG' || name.includes('WATCH') || name.includes('SERIES') || name.includes('ULTRA')) cRLG++;
      else if (cat === 'PODS' || name.includes('AIRPOD')) cPODS++;
      else if (cat === 'ACSS' || name.includes('PENCIL') || name.includes('MAGIC') || name.includes('CABO') || name.includes('FONTE') || name.includes('CARREGADOR')) cACSS++;
      else if (cat === 'IMAC' || name.includes('IMAC')) cIMAC++;
    }
  });

  const elAll = document.getElementById('countCatALL');
  const elSemi = document.getElementById('countCatSEMI');
  const elIph = document.getElementById('countCatIPH');
  const elMcb = document.getElementById('countCatMCB');
  const elIpad = document.getElementById('countCatIPAD');
  const elRlg = document.getElementById('countCatRLG');
  const elPods = document.getElementById('countCatPODS');
  const elAcss = document.getElementById('countCatACSS');
  const elImac = document.getElementById('countCatIMAC');

  if (elAll) elAll.textContent = cALL;
  if (elSemi) elSemi.textContent = cSEMI;
  if (elIph) elIph.textContent = cIPH;
  if (elMcb) elMcb.textContent = cMCB;
  if (elIpad) elIpad.textContent = cIPAD;
  if (elRlg) elRlg.textContent = cRLG;
  if (elPods) elPods.textContent = cPODS;
  if (elAcss) elAcss.textContent = cACSS;
  if (elImac) elImac.textContent = cIMAC;
}

// 14. Model Sorting & Hierarchy Ranking (Zero Mistura - Organização Perfeita)
function getModelOrderRank(modelName, category) {
  const m = (modelName || '').toUpperCase();

  // 1. iPhones (Flagships mais novos primeiro)
  if (m.includes('IPHONE DUO') || m.includes('DUO')) return 5;
  if (m.includes('IPHONE 18 PRO MAX')) return 10;
  if (m.includes('IPHONE 18 PRO')) return 20;
  if (m.includes('IPHONE 18 AIR') || m.includes('IPHONE 18 PLUS') || m.includes('IPHONE 18 SLIM') || m.includes('IPHONE 18 FOLD')) return 30;
  if (m.includes('IPHONE 18')) return 40;

  if (m.includes('IPHONE 17 PRO MAX')) return 100;
  if (m.includes('IPHONE 17 PRO')) return 110;
  if (m.includes('IPHONE 17 AIR') || m.includes('IPHONE 17 PLUS') || m.includes('IPHONE 17 SLIM')) return 120;
  if (m.includes('IPHONE 17')) return 130;

  if (m.includes('IPHONE 16 PRO MAX')) return 200;
  if (m.includes('IPHONE 16 PRO')) return 210;
  if (m.includes('IPHONE 16 PLUS')) return 220;
  if (m.includes('IPHONE 16')) return 230;

  if (m.includes('IPHONE 15 PRO MAX')) return 300;
  if (m.includes('IPHONE 15 PRO')) return 310;
  if (m.includes('IPHONE 15 PLUS')) return 320;
  if (m.includes('IPHONE 15')) return 330;

  if (m.includes('IPHONE 14 PRO MAX')) return 400;
  if (m.includes('IPHONE 14 PRO')) return 410;
  if (m.includes('IPHONE 14 PLUS')) return 420;
  if (m.includes('IPHONE 14')) return 430;

  if (m.includes('IPHONE 13 PRO MAX')) return 500;
  if (m.includes('IPHONE 13 PRO')) return 510;
  if (m.includes('IPHONE 13 MINI')) return 520;
  if (m.includes('IPHONE 13')) return 530;

  if (m.includes('IPHONE 12')) return 600;
  if (m.includes('IPHONE 11')) return 700;
  if (m.includes('IPHONE')) return 800;

  // 2. MacBooks & Macs (Classificação rigorosa por Geração de Lançamento: M5 > M4 > M3 > M2 > M1)
  if (m.includes('M5')) {
    if (m.includes('MACBOOK PRO 16') || m.includes('PRO 16')) return 1000;
    if (m.includes('MACBOOK PRO 14') || m.includes('PRO 14')) return 1010;
    if (m.includes('MACBOOK PRO') || m.includes('PRO')) return 1020;
    if (m.includes('MACBOOK AIR 15') || m.includes('AIR 15')) return 1030;
    if (m.includes('MACBOOK AIR 13') || m.includes('AIR 13')) return 1040;
    if (m.includes('MACBOOK AIR') || m.includes('AIR')) return 1050;
    if (m.includes('MACBOOK')) return 1060;
    if (m.includes('MAC MINI')) return 1070;
    if (m.includes('MAC STUDIO')) return 1080;
    if (m.includes('IMAC')) return 1090;
    if (m.includes('MAC')) return 1100;
    return 1110;
  }

  if (m.includes('M4')) {
    if (m.includes('MACBOOK PRO 16') || m.includes('PRO 16')) return 1200;
    if (m.includes('MACBOOK PRO 14') || m.includes('PRO 14')) return 1210;
    if (m.includes('MACBOOK PRO') || m.includes('PRO')) return 1220;
    if (m.includes('MACBOOK AIR 15') || m.includes('AIR 15')) return 1230;
    if (m.includes('MACBOOK AIR 13') || m.includes('AIR 13')) return 1240;
    if (m.includes('MACBOOK AIR') || m.includes('AIR')) return 1250;
    if (m.includes('MACBOOK')) return 1260;
    if (m.includes('MAC MINI')) return 1270;
    if (m.includes('MAC STUDIO')) return 1280;
    if (m.includes('IMAC')) return 1290;
    if (m.includes('MAC')) return 1300;
    return 1310;
  }

  if (m.includes('M3')) {
    if (m.includes('MACBOOK PRO 16') || m.includes('PRO 16')) return 1400;
    if (m.includes('MACBOOK PRO 14') || m.includes('PRO 14')) return 1410;
    if (m.includes('MACBOOK PRO') || m.includes('PRO')) return 1420;
    if (m.includes('MACBOOK AIR 15') || m.includes('AIR 15')) return 1430;
    if (m.includes('MACBOOK AIR 13') || m.includes('AIR 13')) return 1440;
    if (m.includes('MACBOOK AIR') || m.includes('AIR')) return 1450;
    if (m.includes('MACBOOK')) return 1460;
    if (m.includes('MAC MINI')) return 1470;
    if (m.includes('MAC STUDIO')) return 1480;
    if (m.includes('IMAC')) return 1490;
    if (m.includes('MAC')) return 1500;
    return 1510;
  }

  if (m.includes('M2')) {
    if (m.includes('MACBOOK PRO 16') || m.includes('PRO 16')) return 1600;
    if (m.includes('MACBOOK PRO 14') || m.includes('PRO 14')) return 1610;
    if (m.includes('MACBOOK PRO') || m.includes('PRO')) return 1620;
    if (m.includes('MACBOOK AIR 15') || m.includes('AIR 15')) return 1630;
    if (m.includes('MACBOOK AIR 13') || m.includes('AIR 13')) return 1640;
    if (m.includes('MACBOOK AIR') || m.includes('AIR')) return 1650;
    if (m.includes('MACBOOK')) return 1660;
    if (m.includes('MAC MINI')) return 1670;
    if (m.includes('MAC STUDIO')) return 1680;
    if (m.includes('IMAC')) return 1690;
    if (m.includes('MAC')) return 1700;
    return 1710;
  }

  if (m.includes('M1')) {
    if (m.includes('MACBOOK PRO 16') || m.includes('PRO 16')) return 1800;
    if (m.includes('MACBOOK PRO 14') || m.includes('PRO 14')) return 1810;
    if (m.includes('MACBOOK PRO') || m.includes('PRO')) return 1820;
    if (m.includes('MACBOOK AIR 15') || m.includes('AIR 15')) return 1830;
    if (m.includes('MACBOOK AIR 13') || m.includes('AIR 13')) return 1840;
    if (m.includes('MACBOOK AIR') || m.includes('AIR')) return 1850;
    if (m.includes('MACBOOK')) return 1860;
    if (m.includes('MAC MINI')) return 1870;
    if (m.includes('MAC STUDIO')) return 1880;
    if (m.includes('IMAC')) return 1890;
    if (m.includes('MAC')) return 1900;
    return 1910;
  }

  if (m.includes('MACBOOK PRO')) return 1920;
  if (m.includes('MACBOOK AIR')) return 1930;
  if (m.includes('MACBOOK')) return 1940;
  if (m.includes('MAC MINI')) return 1950;
  if (m.includes('MAC STUDIO')) return 1960;
  if (m.includes('IMAC')) return 1970;
  if (m.includes('MAC')) return 1980;

  // 3. iPads (Do mais recente para o mais antigo)
  if (m.includes('IPAD PRO')) {
    if (m.includes('M5')) return 2000;
    if (m.includes('M4')) return 2010;
    if (m.includes('M2')) return 2020;
    if (m.includes('M1')) return 2030;
    return 2040;
  }
  if (m.includes('IPAD AIR')) {
    if (m.includes('M3')) return 2100;
    if (m.includes('M2')) return 2110;
    if (m.includes('M1')) return 2120;
    return 2130;
  }
  if (m.includes('IPAD MINI')) {
    if (m.includes('7') || m.includes('A17')) return 2140;
    if (m.includes('6')) return 2150;
    return 2160;
  }
  if (m.includes('IPAD 11')) return 2170;
  if (m.includes('IPAD 10')) return 2180;
  if (m.includes('IPAD 9')) return 2190;
  if (m.includes('IPAD')) return 2200;

  // 4. Apple Watches (Ultra 3 > Ultra 2 > Series 10 > Series 9)
  if (m.includes('ULTRA 3')) return 3000;
  if (m.includes('ULTRA 2')) return 3010;
  if (m.includes('ULTRA')) return 3020;
  if (m.includes('SERIES 10') || m.includes('SERIE 10') || m.includes('S10')) return 3030;
  if (m.includes('SERIES 9') || m.includes('SERIE 9') || m.includes('S9')) return 3040;
  if (m.includes('SERIES 8') || m.includes('SERIE 8') || m.includes('S8')) return 3050;
  if (m.includes('WATCH SE')) return 3060;
  if (m.includes('WATCH')) return 3070;

  // 5. AirPods
  if (m.includes('AIRPODS MAX')) return 4000;
  if (m.includes('AIRPODS PRO 2') || m.includes('PRO 2')) return 4010;
  if (m.includes('AIRPODS PRO')) return 4020;
  if (m.includes('AIRPODS 4')) return 4030;
  if (m.includes('AIRPODS 3')) return 4040;
  if (m.includes('AIRPODS')) return 4050;

  // 6. Acessórios
  if (m.includes('PENCIL PRO')) return 5000;
  if (m.includes('PENCIL')) return 5010;
  if (m.includes('MAGIC KEYBOARD')) return 5020;
  if (m.includes('MAGIC MOUSE') || m.includes('MAGIC TRACKPAD')) return 5030;
  if (m.includes('AIRTAG')) return 5040;
  if (m.includes('CARREGADOR') || m.includes('FONTE') || m.includes('CABO')) return 5050;

  return 9999;
}

function getStorageRank(storage) {
  if (!storage) return 999;
  const s = storage.toUpperCase().trim();
  if (s === '64GB') return 1;
  if (s === '128GB') return 2;
  if (s === '256GB') return 3;
  if (s === '512GB') return 4;
  if (s === '1TB') return 5;
  if (s === '2TB') return 6;
  return 50;
}

function getCategoryIcon(modelName, category) {
  const m = (modelName || '').toUpperCase();
  const c = (category || '').toUpperCase();
  if (c === 'IPH' || m.includes('IPHONE')) {
    return `<svg class="pod-model-section-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="3.5"/><line x1="11" y1="5" x2="13" y2="5" stroke-width="2.5"/></svg>`;
  }
  if (c === 'MCB' || m.includes('MACBOOK') || m.includes('MAC')) {
    return `<svg class="pod-model-section-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M2 19h20"/><path d="M10 16h4"/></svg>`;
  }
  if (c === 'IPAD' || c === 'IPD' || m.includes('IPAD')) {
    return `<svg class="pod-model-section-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="3"/><circle cx="12" cy="19" r="0.75" fill="currentColor"/></svg>`;
  }
  if (c === 'RLG' || m.includes('WATCH')) {
    return `<svg class="pod-model-section-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="5" width="12" height="14" rx="4"/><path d="M9 5V2h6v3"/><path d="M9 19v3h6v-3"/></svg>`;
  }
  if (c === 'PODS' || m.includes('AIRPOD')) {
    return `<svg class="pod-model-section-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="7" r="3"/><path d="M8 10v7a1.5 1.5 0 0 0 3 0v-2"/><circle cx="16" cy="7" r="3"/><path d="M16 10v7a1.5 1.5 0 0 1-3 0v-2"/></svg>`;
  }
  if (c === 'IMAC' || m.includes('IMAC')) {
    return `<svg class="pod-model-section-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="13" rx="2"/><path d="M8 21h8"/><path d="M12 16v5"/></svg>`;
  }
  if (c === 'ACSS' || m.includes('PENCIL') || m.includes('MAGIC') || m.includes('CABO')) {
    return `<svg class="pod-model-section-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 2 4 4-14 14H4v-4L18 2z"/><line x1="14.5" y1="5.5" x2="18.5" y2="9.5"/></svg>`;
  }
  return `<svg class="pod-model-section-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/></svg>`;
}

// Autocomplete Dropdown para a barra de pesquisa de Preços do Dia
function renderPodAutocomplete(term) {
  const dropdown = document.getElementById('podAutocompleteDropdown');
  if (!dropdown) return;
  const t = term.trim();
  if (!t) { dropdown.classList.remove('open'); return; }

  const tokens = normalizeSearchText(t).split(' ').filter(Boolean);

  const modelCounts = new Map();
  allProducts.forEach(p => {
    if (isCpoProduct(p)) return;
    const name = (p.name || '').trim();
    if (!name) return;
    const normalizedName = normalizeSearchText(name);
    const compactName = normalizedName.replace(/\s+/g, '');
    const matches = tokens.every(tok => {
      const compactTok = tok.replace(/\s+/g, '');
      return normalizedName.includes(tok) || (compactTok && compactName.includes(compactTok));
    });
    if (matches) {
      modelCounts.set(name, (modelCounts.get(name) || 0) + 1);
    }
  });

  const sorted = Array.from(modelCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8);

  if (sorted.length === 0) {
    dropdown.innerHTML = `
      <div style="padding: 12px; text-align: center; color: var(--text-muted); font-size: 0.82rem;">
        Nenhum modelo encontrado para "${term}"
      </div>
    `;
    dropdown.classList.add('open');
    return;
  }

  const itemsHtml = sorted.map(([mName, count]) => `
    <div class="autocomplete-item" onclick="selectPodModel('${mName.replace(/'/g, "\\'")}')">
      <div class="autocomplete-item-name">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--accent-green); flex-shrink: 0;">
          <rect width="14" height="20" x="5" y="2" rx="2" ry="2"/>
          <path d="M12 18h.01"/>
        </svg>
        <span>${mName}</span>
      </div>
      <span class="autocomplete-item-badge">${count} ofertas</span>
    </div>
  `).join('');

  dropdown.innerHTML = itemsHtml;
  dropdown.classList.add('open');
}

window.selectPodModel = function(modelName) {
  const podSearchInput = document.getElementById('podSearchInput');
  const dropdown = document.getElementById('podAutocompleteDropdown');
  const clearBtn = document.getElementById('podSearchClearBtn');

  if (podSearchInput) podSearchInput.value = modelName;
  if (dropdown) dropdown.classList.remove('open');
  if (clearBtn) clearBtn.style.display = 'flex';

  // Chaveia para ALL para que o modelo selecionado sempre seja visível (independente de ser Mac, Watch, iPad ou iPhone)
  podCurrentCategory = 'ALL';
  const catPills = document.querySelectorAll('#podCategoryNav .pod-cat-pill');
  catPills.forEach(p => p.classList.toggle('active', p.dataset.category === 'ALL'));

  renderPricesOfTheDay();
};

// Helper de ícone por tipo de dispositivo Apple
function getDeviceIconSvg(name) {
  const u = (name || '').toUpperCase();
  if (u.includes('WATCH')) {
    return `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="7"/><path d="M12 9v3l2 2"/></svg>`;
  }
  if (u.includes('MAC') || u.includes('IMAC')) {
    return `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="12" x="3" y="4" rx="2"/><line x1="2" y1="20" x2="22" y2="20"/></svg>`;
  }
  if (u.includes('IPAD')) {
    return `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect width="16" height="20" x="4" y="2" rx="2"/><circle cx="12" cy="18" r="0.5"/></svg>`;
  }
  if (u.includes('AIRPOD') || u.includes('PODS')) {
    return `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/></svg>`;
  }
  return `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="20" x="5" y="2" rx="2" ry="2"/><path d="M12 18h.01"/></svg>`;
}



// 15. Render Preços do Dia (ESTRITAMENTE ORGANIZADO POR MODELOS COM BANNERS DE SEÇÃO)
function renderPricesOfTheDay() {
  const container = document.getElementById('podMatrixGrid');
  if (!container) return;

  const podSearchInput = document.getElementById('podSearchInput');
  const podRegionFilter = document.getElementById('podRegionFilter');
  const podVerifiedFilter = document.getElementById('podVerifiedFilter');
  const podShownCountText = document.getElementById('podShownCountText');
  const podSupplierCountLabel = document.getElementById('podSupplierCountLabel');

  const searchTerm = (podSearchInput?.value || '').trim();
  const searchTokens = normalizeSearchText(searchTerm).split(' ').filter(Boolean);
  const selectedRegion = podRegionFilter?.value || '';
  const onlyVerified = podVerifiedFilter?.checked || false;

  // Filter pool
  const filtered = allProducts.filter(p => {
    if (!p.price || p.price <= 0) return false;
    if (isDisallowedProduct(p)) return false;

    const isSemi = isSeminovoProduct(p);

    // Category filter (se houver busca por texto, busca em todo o catalogo)
    if (searchTokens.length === 0 && podCurrentCategory !== 'ALL') {
      if (podCurrentCategory === 'SEMI') {
        if (!isSemi) return false;
      } else {
        if (isSemi) return false; // Exclui seminovos das abas de novos lacrados
        const cat = (p.category || '').toUpperCase().trim();
        const name = (p.name || '').toUpperCase();
        if (podCurrentCategory === 'IPH' && !(cat === 'IPH' || name.includes('IPHONE'))) return false;
        if (podCurrentCategory === 'MCB' && !(cat === 'MCB' || name.includes('MACBOOK') || name.includes('MAC MINI') || name.includes('MAC STUDIO') || name.includes('MAC PRO') || name.includes('IMAC'))) return false;
        if (podCurrentCategory === 'IPAD' && !(cat === 'IPAD' || cat === 'IPD' || name.includes('IPAD'))) return false;
        if (podCurrentCategory === 'RLG' && !(cat === 'RLG' || name.includes('WATCH') || name.includes('SERIES') || name.includes('ULTRA'))) return false;
        if (podCurrentCategory === 'PODS' && !(cat === 'PODS' || name.includes('AIRPOD'))) return false;
        if (podCurrentCategory === 'ACSS' && !(cat === 'ACSS' || name.includes('PENCIL') || name.includes('MAGIC') || name.includes('CABO') || name.includes('FONTE') || name.includes('CARREGADOR'))) return false;
        if (podCurrentCategory === 'IMAC' && !(cat === 'IMAC' || name.includes('IMAC'))) return false;
      }
    }

    // Search filter inteligente multi-palavras (modelo, RAM, capacidade, cor ou fornecedor)
    if (searchTokens.length > 0) {
      if (!matchSearchTokens(p, searchTokens)) return false;
    }

    // Region filter (aplica apenas em iPhones/iPads; MacBooks usam region para RAM)
    if (selectedRegion) {
      const isMac = (p.category || '').toUpperCase() === 'MCB' || (p.name || '').toUpperCase().includes('MAC');
      if (!isMac) {
        const reg = (p.region || p.description || p.name || '').toUpperCase();
        if (selectedRegion === 'EUA' && !(reg.includes('EUA') || reg.includes('USA') || reg.includes('LL/A') || reg.includes('CHIP VIRTUAL'))) return false;
        if (selectedRegion === 'BR' && !(reg.includes('BR') || reg.includes('ANATEL') || reg.includes('NACIONAL') || reg.includes('BZ/A'))) return false;
        if (selectedRegion === 'PY' && !(reg.includes('PY') || reg.includes('PARAGUAI') || reg.includes('PARAGUAY'))) return false;
        if (selectedRegion === 'GLOBAL' && !(reg.includes('GLOBAL') || reg.includes('J/A') || reg.includes('ZD/A') || reg.includes('HN/A'))) return false;
      }
    }

    // Verified filter
    if (onlyVerified && !p.supplier?.isVerified) return false;

    return true;
  });

  // AGRUPAMENTO ESTRITO POR MODELO E VARIANTE DE CAPACIDADE/RAM
  const modelFamilies = new Map();
  const suppliersSet = new Set();

  filtered.forEach(p => {
    if (p.supplier?.name) suppliersSet.add(p.supplier.name);

    const isSemi = isSeminovoProduct(p);
    const baseModelName = cleanModelName(p.name);
    const modelKey = isSemi ? `${baseModelName.toUpperCase()} [SEMINOVO]` : baseModelName.toUpperCase();
    const displayName = isSemi ? `${baseModelName} (Seminovo)` : baseModelName;
    const ram = getMacBookRam(p);
    const storageKey = (p.storage || 'PADRÃO').trim().toUpperCase();
    const variantKey = ram ? `${storageKey}__${ram}` : storageKey;

    if (!modelFamilies.has(modelKey)) {
      modelFamilies.set(modelKey, {
        modelName: displayName,
        rawModelName: baseModelName,
        category: p.category,
        isSeminovo: isSemi,
        storagesMap: new Map()
      });
    }

    const fam = modelFamilies.get(modelKey);
    if (!fam.storagesMap.has(variantKey)) {
      fam.storagesMap.set(variantKey, {
        model: displayName,
        rawModel: baseModelName,
        storage: (p.storage || '').trim(),
        ram: ram,
        isSeminovo: isSemi,
        colors: new Map(),
        allOffers: []
      });
    }

    const stGrp = fam.storagesMap.get(variantKey);
    stGrp.allOffers.push(p);

    const colorName = (p.color || 'Padrão').trim();
    const colorKey = colorName.toUpperCase();
    
    if (!stGrp.colors.has(colorKey)) {
      stGrp.colors.set(colorKey, {
        color: colorName,
        offers: [p],
        ram: ram
      });
    } else {
      stGrp.colors.get(colorKey).offers.push(p);
    }
  });

  // Ordena as famílias de modelos pela hierarquia oficial Apple
  const sortedFamilies = Array.from(modelFamilies.values()).sort((a, b) => {
    const rankA = getModelOrderRank(a.rawModelName || a.modelName, a.category);
    const rankB = getModelOrderRank(b.rawModelName || b.modelName, b.category);
    if (rankA !== rankB) return rankA - rankB;
    if (a.isSeminovo !== b.isSeminovo) return a.isSeminovo ? 1 : -1;
    return a.modelName.localeCompare(b.modelName);
  });

  // Atualiza contadores
  if (podShownCountText) {
    podShownCountText.textContent = `Mostrando ${sortedFamilies.length} modelos organizados (${filtered.length} ofertas)`;
  }
  if (podSupplierCountLabel) {
    podSupplierCountLabel.textContent = `${suppliersSet.size || 100}+ fornecedores conectados em tempo real`;
  }

  updatePricesDayCategoryCounts();

  if (sortedFamilies.length === 0) {
    if (allProducts.length === 0 && catalogStatus === 'loading') {
      container.innerHTML = `
        <div class="app-catalog-loader">
          <div class="app-spinner"></div>
          <p style="color: var(--text-primary, #fff); font-weight: 600; font-size: 1rem; margin-bottom: 6px;">Sincronizando cotações Apple em tempo real...</p>
          <span style="color: var(--text-muted, #888); font-size: 0.85rem;">Carregando modelos, cores e melhores preços dos fornecedores</span>
        </div>
      `;
      return;
    }
    container.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 60px 20px; color: var(--text-muted);">
        <h3 style="font-size: 1.25rem; color: var(--text-primary); margin-bottom: 8px;">Nenhum produto encontrado nesta categoria ou busca.</h3>
        <p style="margin-bottom: 16px;">Tente alterar os filtros ou pesquisar por outro modelo.</p>
        <button class="pod-btn-export" onclick="resetPodFilters()" style="margin: 0 auto;">✕ Limpar Filtros</button>
      </div>
    `;
    return;
  }

  // Renderiza estruturado por Seção de Modelo + Cards das Capacidades e RAM
  window.matrixCardMap = new Map();
  let html = '';
  sortedFamilies.forEach((fam, famIdx) => {
    // Ordena as capacidades do modelo em ordem lógica (128GB, 256GB, 512GB, 1TB, etc)
    const storages = Array.from(fam.storagesMap.values()).sort((a, b) => {
      const rA = getStorageRank(a.storage);
      const rB = getStorageRank(b.storage);
      if (rA !== rB) return rA - rB;
      return (parseInt(a.ram) || 0) - (parseInt(b.ram) || 0);
    });

    html += '<section class="model-family-row">';

    // Cards individuais de cada capacidade/RAM para este modelo
    storages.forEach((grp, grpIdx) => {
      const colorsArr = Array.from(grp.colors.values()).map(colObj => {
        const isSemi = grp.isSeminovo;
        const offers = colObj.offers || [];
        const rawRefPrice = calculateSupplierReferencePrice(offers, isSemi);
        
        let repOffer = offers[0];
        if (isSemi) {
          repOffer = offers.reduce((prev, curr) => {
            return (Math.abs(curr.price - rawRefPrice) < Math.abs(prev.price - rawRefPrice) ? curr : prev);
          }, offers[0]);
        } else {
          repOffer = offers.reduce((prev, curr) => (curr.price < prev.price ? curr : prev), offers[0]);
        }

        const refPrice = applyDFU(rawRefPrice, fam.category, grp.rawModel);

        return {
          color: colObj.color,
          displayPrice: refPrice,
          isSeminovo: isSemi,
          bestSupplier: repOffer.supplier?.name || 'Fornecedor',
          whatsappNumber: repOffer.supplier?.whatsappNumber || '',
          isVerified: repOffer.supplier?.isVerified,
          address: repOffer.supplier?.address || '',
          ram: colObj.ram,
          count: offers.length
        };
      }).sort((a, b) => a.displayPrice - b.displayPrice);

      const cardKey = `mat_${famIdx}_${grpIdx}`;
      window.matrixCardMap.set(cardKey, {
        model: grp.model,
        rawModel: grp.rawModel,
        storage: grp.storage,
        ram: grp.ram,
        isSeminovo: grp.isSeminovo,
        isCusto: true,
        allOffers: grp.allOffers || [],
        colors: colorsArr.map(c => ({ color: c.color, price: c.displayPrice }))
      });

      const colorRowsHtml = colorsArr.map(col => {
        const hex = getAppleColorHex(col.color);
        const rawPhone = (col.whatsappNumber || '').replace(/\D/g, '');
        const orderMsg = buildSupplierWhatsAppMessage(grp.rawModel + (grp.isSeminovo ? ' (Seminovo)' : ''), grp.storage, col.color, col.displayPrice, grp.ram);
        const waLink = rawPhone ? `https://wa.me/${rawPhone}?text=${encodeURIComponent(orderMsg)}` : '#';

        return `
          <div class="matrix-color-row">
            <div class="matrix-color-left" onclick="openAllOffersModal('${encodeURIComponent(grp.rawModel)}', '${encodeURIComponent(grp.storage)}', '${encodeURIComponent(col.color)}', '${encodeURIComponent(grp.ram || '')}', ${grp.isSeminovo}, '${cardKey}')">
              <span class="matrix-color-dot" style="background-color: ${hex};" title="Cor: ${col.color}"></span>
              <span class="matrix-color-name" title="${col.color}">${col.color}</span>
            </div>
            <div class="matrix-color-right">
              <div class="matrix-cost-group" onclick="openAllOffersModal('${encodeURIComponent(grp.rawModel)}', '${encodeURIComponent(grp.storage)}', '${encodeURIComponent(col.color)}', '${encodeURIComponent(grp.ram || '')}', ${grp.isSeminovo}, '${cardKey}')">
                <span class="matrix-cost-label">${col.isSeminovo ? 'PREÇO MÉDIO' : 'CUSTO'}</span>
                <span class="matrix-cost-val">${formatBRL(col.displayPrice)}</span>
              </div>
              <a class="matrix-wa-btn" href="${waLink}" target="_blank" rel="noopener noreferrer" title="Chamar ${col.bestSupplier} no WhatsApp (${formatBRL(col.displayPrice)})">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981z"/>
                </svg>
              </a>
            </div>
          </div>
        `;
      }).join('');

      html += `
        <article class="matrix-card">
          <div class="matrix-card-header">
            <div class="matrix-card-title-row">
              <h3 class="matrix-card-title" title="${grp.model}">${grp.model}</h3>
              <div class="matrix-card-actions">

                <button class="matrix-card-all-btn" onclick="openAllOffersModal('${encodeURIComponent(grp.rawModel)}', '${encodeURIComponent(grp.storage)}', '', '${encodeURIComponent(grp.ram || '')}', ${grp.isSeminovo}, '${cardKey}')" title="Ver todos os fornecedores deste modelo">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>
                    <rect width="8" height="4" x="8" y="2" rx="1" ry="1"/>
                  </svg>
                  <span>Todas</span>
                </button>
              </div>
            </div>
            <div class="matrix-card-badges-row">
              ${grp.isSeminovo ? `<span class="matrix-card-semi-badge">Seminovo</span>` : ''}
              ${grp.ram ? `<span class="matrix-card-ram-badge"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 19v-3"/><path d="M10 19v-3"/><path d="M14 19v-3"/><path d="M18 19v-3"/></svg>${grp.ram} RAM</span>` : ''}
              ${grp.storage ? `<span class="matrix-card-storage">${grp.storage}</span>` : ''}
            </div>
          </div>
          <div class="matrix-card-body">
            ${colorRowsHtml}
          </div>
        </article>
      `;
    });
    html += '</section>';
  });

  container.innerHTML = html;
}

// 16. Open Modal with All Offers for a Specific Model + Storage + RAM
window.openAllOffersModal = function(encodedModel, encodedStorage, encodedColor, encodedRam, isSeminovo = false, cardKey = null) {
  const model = decodeURIComponent(encodedModel || '');
  const storage = decodeURIComponent(encodedStorage || '');
  const selectedColor = encodedColor ? decodeURIComponent(encodedColor) : '';
  const selectedRam = encodedRam ? decodeURIComponent(encodedRam) : '';

  const modal = document.getElementById('allOffersModal');
  const title = document.getElementById('allOffersModalTitle');
  const body = document.getElementById('allOffersModalBody');
  if (!modal || !body) return;

  const ramTitlePart = selectedRam ? ` • ${selectedRam} RAM` : '';
  const storageTitlePart = storage ? ` • ${storage}` : '';
  const semiPart = isSeminovo ? ' (Seminovo)' : '';
  title.textContent = `${model}${semiPart}${ramTitlePart}${storageTitlePart}`;

  let offers = [];

  // 1. PRIORIDADE MÁXIMA: Buscar direto do grupo do card clicado (100% de garantia sem mismatch)
  if (cardKey && window.matrixCardMap && window.matrixCardMap.has(cardKey)) {
    const cardData = window.matrixCardMap.get(cardKey);
    if (cardData && Array.isArray(cardData.allOffers)) {
      offers = cardData.allOffers.slice();
      if (selectedColor) {
        offers = offers.filter(p => (p.color || '').trim().toUpperCase() === selectedColor.trim().toUpperCase());
      }
    }
  }

  // 2. FALLBACK INTELIGENTE: Caso não venha cardKey ou precise buscar no allProducts com normalização flexível
  if (offers.length === 0) {
    const normModel = model.trim().toUpperCase().replace(/\s+/g, ' ');
    const normStorage = storage.trim().toUpperCase().replace(/\s+/g, '');

    offers = allProducts.filter(p => {
      if (isCpoProduct(p)) return false;
      const pIsSemi = isSeminovoProduct(p);
      if (isSeminovo ? !pIsSemi : pIsSemi) return false;

      // Comparação flexível do nome do modelo
      const pCleanName = cleanModelName(p.name).toUpperCase().replace(/\s+/g, ' ');
      if (pCleanName !== normModel && !pCleanName.includes(normModel) && !normModel.includes(pCleanName)) {
        return false;
      }

      // Comparação flexível de armazenamento (ex: 256GB vs 256 GB)
      if (normStorage) {
        const pStorage = (p.storage || '').trim().toUpperCase().replace(/\s+/g, '');
        if (pStorage && pStorage !== normStorage) return false;
      }

      if (selectedRam && getMacBookRam(p) !== selectedRam) return false;
      if (selectedColor && (p.color || '').trim().toUpperCase() !== selectedColor.trim().toUpperCase()) return false;
      return p.price && p.price > 0;
    });
  }

  offers.sort((a, b) => (Number(a.price) || 0) - (Number(b.price) || 0));

  if (offers.length === 0) {
    body.innerHTML = `
      <div style="padding: 30px; text-align: center; color: var(--text-muted);">
        Nenhuma oferta adicional encontrada para este modelo com os filtros atuais.
      </div>
    `;
    modal.classList.add('active');
    return;
  }

  const lowestPrice = offers[0].price;
  const rawRefPrice = calculateSupplierReferencePrice(offers, isSeminovo);

  // We don't have category here easily, but we have model.
  // We can pass empty string for category, the model check inside applyDFU is enough.
  const headerRefPrice = applyDFU(rawRefPrice, '', model);

  const offersHtml = offers.map((p) => {
    const sName = p.supplier?.name || 'Fornecedor';
    const sAvatar = p.supplier?.profileImageUrl || 'https://pub-857bffb3be264baf89938943b80bff74.r2.dev/supplier-profiles/default.png';
    const sAddress = p.supplier?.address || 'São Paulo - SP';
    const isVerified = p.supplier?.isVerified;
    const whatsapp = (p.supplier?.whatsappNumber || '').replace(/\D/g, '');
    const isLowest = !isSeminovo && p.price === lowestPrice;
    const isRef = isSeminovo && (Math.abs(p.price - rawRefPrice) < 30);
    const colHex = getAppleColorHex(p.color);
    const ram = getMacBookRam(p);

    const displayPrice = applyDFU(p.price, '', model);

    const orderMsg = buildSupplierWhatsAppMessage(cleanModelName(p.name) + (isSeminovo ? ' (Seminovo)' : ''), p.storage, p.color, displayPrice, ram);
    const waLink = whatsapp ? `https://wa.me/${whatsapp}?text=${encodeURIComponent(orderMsg)}` : '#';

    return `
      <div class="all-offer-item">
        <div class="all-offer-supplier">
          <img class="all-offer-avatar" src="${sAvatar}" alt="${sName}" onerror="this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(sName)}&background=272b30&color=fff'">
          <div class="all-offer-supp-info">
            <div class="all-offer-supp-name-row">
              <span>${sName}</span>
              ${isVerified ? `
                <svg class="verified-icon" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
                </svg>
              ` : ''}
              ${isLowest ? `<span style="font-size: 0.65rem; background: var(--accent-green); color: #fff; padding: 2px 6px; border-radius: 4px; font-weight: 800;">MENOR VALOR</span>` : ''}
              ${isRef ? `<span style="font-size: 0.65rem; background: #f59e0b; color: #fff; padding: 2px 6px; border-radius: 4px; font-weight: 800;">FORNECEDOR MÉDIO</span>` : ''}
            </div>
            <div class="all-offer-supp-addr">${sAddress}</div>
          </div>
        </div>

        <div class="all-offer-color-tag">
          <span class="matrix-color-dot" style="background-color: ${colHex};"></span>
          <span>${p.color || 'Padrão'}</span>
          ${ram ? `<span style="margin-left: 6px; font-size: 0.7rem; font-weight: 700; color: #2997ff; background: rgba(0, 113, 227, 0.16); padding: 1px 6px; border-radius: 4px;">${ram} RAM</span>` : ''}
        </div>

        <div class="all-offer-price-group">
          <span class="all-offer-price-val">${formatBRL(displayPrice)}</span>
        </div>

        <a class="all-offer-wa-btn" href="${waLink}" target="_blank" rel="noopener noreferrer">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
            <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981z"/>
          </svg>
          <span>Negociar</span>
        </a>
      </div>
    `;
  }).join('');

  body.innerHTML = `
    <div class="all-offers-header-info">
      <div>
        <strong>${model} ${storage}</strong> ${isSeminovo ? '<span style="color: #f59e0b; font-weight: 700;">(Seminovo • Preço Médio: ' + formatBRL(headerRefPrice) + ')</span>' : '— Todos os fornecedores cadastrados'}
      </div>
      <span class="all-offers-count-badge">${offers.length} opções disponíveis</span>
    </div>
    <div class="all-offers-list">
      ${offersHtml}
    </div>
  `;

  modal.classList.add('active');
};

// Modal Close logic
const allOffersModal = document.getElementById('allOffersModal');
const closeAllOffersModal = document.getElementById('closeAllOffersModal');
if (closeAllOffersModal) {
  closeAllOffersModal.addEventListener('click', () => allOffersModal.classList.remove('active'));
}
if (allOffersModal) {
  allOffersModal.addEventListener('click', (e) => {
    if (e.target === allOffersModal) allOffersModal.classList.remove('active');
  });
}

// =========================================================================
// 16.5 SIMULADOR DE PARCELAMENTO NO CARTÃO (LOJA FÍSICA)
// =========================================================================
let currentSimData = {
  model: '',
  storage: '',
  color: '',
  cashPrice: 0,
  ram: '',
  entryAmount: 0
};

function calculateInstallment(cashPrice, entryAmount, installmentCount) {
  return QuoteCore.installment(cashPrice, entryAmount, installmentCount, cardRates);
}

window.openFreeCalculator = function(initialAmount = 0) {
  openCardSimulator('Calculadora de Taxas', '', '', initialAmount, '');
};

window.onSimCashPriceChange = function(val) {
  const price = parseFloat(val) || 0;
  currentSimData.cashPrice = price;
  const entryInp = document.getElementById('simEntryInput');
  if (entryInp) {
    entryInp.max = String(price);
  }
  recalculateSimulator();
};

// Currency Mask Helpers for Simulator Input (R$ 0,00)
function parseCurrencyInput(val) {
  if (!val) return 0;
  if (typeof val === 'number') return val;
  const digits = val.toString().replace(/\D/g, '');
  if (!digits) return 0;
  return parseFloat(digits) / 100;
}

function formatCurrencyInput(num) {
  if (isNaN(num) || num === 0) return '';
  return num.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

window.handleSimCashInput = function(inp) {
  const num = parseCurrencyInput(inp.value);
  inp.value = formatCurrencyInput(num);
  currentSimData.cashPrice = num;
  recalculateSimulator();
};

window.handleSimEntryInput = function(inp) {
  const num = parseCurrencyInput(inp.value);
  const cashVal = currentSimData.cashPrice || 0;
  const tradeInVal = (currentSimData.tradeInActive ? currentSimData.tradeInAmount : 0) || 0;
  const maxEntry = Math.max(0, cashVal - tradeInVal);
  let finalVal = num;
  if (finalVal > maxEntry && cashVal > 0) {
    finalVal = maxEntry;
  }
  inp.value = formatCurrencyInput(finalVal);
  currentSimData.entryAmount = finalVal;
  recalculateSimulator();
};

window.handleSimTradeInToggle = function(chk) {
  const active = chk.checked;
  currentSimData.tradeInActive = active;
  const bodyEl = document.getElementById('simTradeInBody');
  const badgeEl = document.getElementById('simTradeInBadge');
  if (bodyEl) {
    bodyEl.style.display = active ? 'block' : 'none';
  }
  if (badgeEl) {
    badgeEl.style.display = (active && currentSimData.tradeInAmount > 0) ? 'inline-block' : 'none';
  }
  recalculateSimulator();
};

window.handleSimTradeInModelChange = function(sel) {
  const val = sel.value;
  currentSimData.tradeInModel = val;
  const customInp = document.getElementById('simTradeInCustomModel');
  if (customInp) {
    if (val === 'OUTRO') {
      customInp.style.display = 'block';
      customInp.focus();
    } else {
      customInp.style.display = 'none';
      currentSimData.tradeInCustomModel = '';
    }
  }
  recalculateSimulator();
};

window.handleSimTradeInCustomModel = function(inp) {
  currentSimData.tradeInCustomModel = inp.value.trim();
  recalculateSimulator();
};

window.handleSimTradeInStorageChange = function(sel) {
  currentSimData.tradeInStorage = sel.value;
  recalculateSimulator();
};

window.handleSimTradeInValueInput = function(inp) {
  const num = parseCurrencyInput(inp.value);
  const cashVal = currentSimData.cashPrice || 0;
  const entryVal = currentSimData.entryAmount || 0;
  const maxTradeIn = Math.max(0, cashVal - entryVal);
  let finalVal = num;
  if (finalVal > maxTradeIn && cashVal > 0) {
    finalVal = maxTradeIn;
  }
  inp.value = formatCurrencyInput(finalVal);
  currentSimData.tradeInAmount = finalVal;

  const badgeEl = document.getElementById('simTradeInBadge');
  if (badgeEl) {
    if (finalVal > 0 && currentSimData.tradeInActive) {
      badgeEl.textContent = `- ${formatBRL(finalVal)}`;
      badgeEl.style.display = 'inline-block';
    } else {
      badgeEl.style.display = 'none';
    }
  }

  recalculateSimulator();
};

function getSimulatorColorOptions(model, storage, ram, color, unitPrice) {
  if (!currentUser || !color) return [];

  const normalize = value => String(value || '').trim().toUpperCase().replace(/\s+/g, '');
  const isSemi = /\bSEMI[\s-]*NOVO\b/i.test(model);
  const rawModel = cleanModelName(model.replace(/\s*\(Seminovo\)\s*$/i, ''));
  const colors = new Map();

  // Consulta o catálogo inteiro, mesmo quando a vitrine está filtrada por cor.
  allProducts.forEach(product => {
    if (isDisallowedProduct(product) || !(Number(product.price) > 0)) return;
    if (isSeminovoProduct(product) !== isSemi) return;
    if (normalize(cleanModelName(product.name)) !== normalize(rawModel)) return;
    if (normalize(product.storage) !== normalize(storage)) return;
    if (normalize(getMacBookRam(product)) !== normalize(ram)) return;

    const name = (product.color || 'Padrão').trim();
    const key = normalize(name);
    if (!colors.has(key)) colors.set(key, { color: name, offers: [] });
    colors.get(key).offers.push(product);
  });

  const options = Array.from(colors.values()).map(option => {
    const category = option.offers[0].category;
    const referencePrice = calculateSupplierReferencePrice(option.offers, isSemi);
    return {
      color: option.color,
      price: applyDFU(referencePrice, category, rawModel) + getProductMargin(rawModel, category, isSemi)
    };
  });

  // Preserva a cor e o valor do card que abriu o simulador.
  const initialOption = options.find(option => normalize(option.color) === normalize(color));
  if (initialOption) {
    initialOption.color = color;
    initialOption.price = unitPrice;
  } else {
    options.push({ color, price: unitPrice });
  }

  return options.sort((a, b) => a.color.localeCompare(b.color, 'pt-BR'));
}

window.handleSimColorChange = function(select) {
  if (!currentUser) return;
  const option = (currentSimData.colorOptions || []).find(item => item.color === select.value);
  if (!option) return;

  currentSimData.color = option.color;
  currentSimData.unitPrice = option.price;
  const priceInput = document.getElementById('simCashInput');
  if (priceInput) priceInput.value = formatCurrencyInput(option.price);
  const colorDot = document.getElementById('simColorDot');
  if (colorDot) colorDot.style.backgroundColor = getAppleColorHex(option.color);
  recalculateSimulator();
};

function getSimProductKey(model, storage, ram, color) {
  return [model, storage, ram, color].map(value => String(value || '').trim().toUpperCase().replace(/\s+/g, '')).join('__');
}

function getSimCatalogOptions() {
  const variants = new Map();
  allProducts.forEach(product => {
    if (isDisallowedProduct(product) || !(Number(product.price) > 0)) return;
    const rawModel = cleanModelName(product.name);
    const isSemi = isSeminovoProduct(product);
    const model = isSemi ? `${rawModel} (Seminovo)` : rawModel;
    const storage = (product.storage || '').trim();
    const ram = getMacBookRam(product);
    const color = (product.color || 'Padrão').trim();
    const key = getSimProductKey(model, storage, ram, color);
    if (!variants.has(key)) variants.set(key, { key, model, rawModel, storage, ram, color, isSemi, category: product.category, offers: [] });
    variants.get(key).offers.push(product);
  });
  return Array.from(variants.values()).map(variant => ({
    key: variant.key, model: variant.model, storage: variant.storage, ram: variant.ram,
    color: variant.color, isSemi: variant.isSemi,
    unitPrice: applyDFU(calculateSupplierReferencePrice(variant.offers, variant.isSemi), variant.category, variant.rawModel)
      + getProductMargin(variant.rawModel, variant.category, variant.isSemi)
  })).sort((a, b) => a.model.localeCompare(b.model, 'pt-BR') || a.unitPrice - b.unitPrice);
}

window.toggleSimProductPicker = function() {
  const picker = document.getElementById('simProductPicker');
  if (!picker) return;
  picker.hidden = !picker.hidden;
  document.getElementById('simAddProductButton')?.setAttribute('aria-expanded', String(!picker.hidden));
  if (!picker.hidden) {
    const input = document.getElementById('simProductSearch');
    searchSimProducts(input?.value || '');
    input?.focus();
  }
};

window.searchSimProducts = function(query) {
  const results = document.getElementById('simProductResults');
  if (!results) return;
  const normalize = value => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const tokens = normalize(query).trim().split(/\s+/).filter(Boolean);
  const options = currentSimData.catalogOptions || [];
  const matches = options.map((option, index) => ({ option, index }))
    .filter(({ option }) => tokens.every(token => normalize(`${option.model} ${option.storage} ${option.ram} ${option.color}`).includes(token)));
  if (!matches.length) {
    results.innerHTML = '<p class="sim-product-empty">Nenhum produto encontrado. Tente outro modelo, capacidade ou cor.</p>';
    return;
  }
  results.innerHTML = matches.slice(0, 20).map(({ option, index }) => `
    <button type="button" class="sim-product-result" onclick="addSimProduct(${index})" aria-label="${escapeHtml(`Adicionar ${option.model}, ${option.storage}, ${option.color}, ${formatBRL(option.unitPrice)}`)}">
      <span><strong>${escapeHtml(option.model)}</strong><small>${escapeHtml([option.storage, option.ram ? `${option.ram} RAM` : '', option.color].filter(Boolean).join(' · '))}</small></span>
      <span class="sim-product-result-price">${formatBRL(option.unitPrice)} <span aria-hidden="true">＋</span></span>
    </button>
  `).join('') + (matches.length > 20 ? '<p class="sim-product-empty">Digite o modelo, a capacidade ou a cor para refinar a busca.</p>' : '');
};

window.addSimProduct = function(index) {
  const option = currentSimData.catalogOptions?.[index];
  if (!option) return;
  const primaryKey = getSimProductKey(currentSimData.model, currentSimData.storage, currentSimData.ram, currentSimData.color);
  if (option.key === primaryKey) {
    handleSimQtyStep(1);
  } else {
    const existing = currentSimData.additionalItems.find(item => item.key === option.key);
    if (existing) existing.quantity = Math.min(99, existing.quantity + 1);
    else currentSimData.additionalItems.push({ ...option, quantity: 1 });
  }
  renderSimAdditionalItems();
  recalculateSimulator();
};

function renderSimAdditionalItems() {
  const container = document.getElementById('simAdditionalItems');
  if (!container) return;
  container.innerHTML = (currentSimData.additionalItems || []).map((item, index) => `
    <article class="sim-added-product">
      <div class="sim-added-product-info">
        <strong>${escapeHtml(item.model)}</strong>
        <span>${escapeHtml([item.storage, item.ram ? `${item.ram} RAM` : '', item.color].filter(Boolean).join(' · '))}</span>
      </div>
      <div class="sim-added-product-controls">
        <label>Valor unitário${currentUser ? `<span class="sim-added-money"><span>R$</span><input type="text" inputmode="decimal" value="${formatCurrencyInput(item.unitPrice)}" aria-label="${escapeHtml(`Valor unitário de ${item.model}`)}" onfocus="this.select()" oninput="updateSimProductPrice(${index}, this)"></span>` : `<strong>${formatBRL(item.unitPrice)}</strong>`}</label>
        <label>Qtd<input type="number" min="1" max="99" value="${item.quantity}" aria-label="${escapeHtml(`Quantidade de ${item.model}`)}" onchange="updateSimProductQuantity(${index}, this)"></label>
        <div class="sim-added-subtotal"><span>Subtotal</span><strong id="simAdditionalSubtotal-${index}">${formatBRL(item.unitPrice * item.quantity)}</strong></div>
        <button type="button" class="sim-remove-product" onclick="removeSimProduct(${index})" aria-label="${escapeHtml(`Remover ${item.model}`)}">✕</button>
      </div>
    </article>
  `).join('');
}

window.updateSimProductQuantity = function(index, input) {
  const item = currentSimData.additionalItems?.[index];
  if (!item) return;
  item.quantity = Math.min(99, Math.max(1, parseInt(input.value) || 1));
  input.value = item.quantity;
  const subtotal = document.getElementById(`simAdditionalSubtotal-${index}`);
  if (subtotal) subtotal.textContent = formatBRL(item.unitPrice * item.quantity);
  recalculateSimulator();
};

window.updateSimProductPrice = function(index, input) {
  const item = currentSimData.additionalItems?.[index];
  if (!currentUser || !item) return;
  const price = parseCurrencyInput(input.value);
  if (!Number.isFinite(price) || price < 0 || price > 1e10 || /^\s*-/.test(input.value)) {
    input.value = formatCurrencyInput(item.unitPrice);
    return;
  }
  item.unitPrice = price;
  input.value = formatCurrencyInput(price);
  const subtotal = document.getElementById(`simAdditionalSubtotal-${index}`);
  if (subtotal) subtotal.textContent = formatBRL(item.unitPrice * item.quantity);
  recalculateSimulator();
};

window.removeSimProduct = function(index) {
  if (!Number.isInteger(index) || !currentSimData.additionalItems?.[index]) return;
  currentSimData.additionalItems.splice(index, 1);
  renderSimAdditionalItems();
  recalculateSimulator();
};

function getSimQuotationItems() {
  const d = currentSimData;
  const primary = {
    model: d.model, storage: d.storage, ram: d.ram, color: d.color,
    unitPrice: d.unitPrice ?? d.cashPrice ?? 0, quantity: d.quantity || 1,
    isSemi: /\bSEMI[\s-]*NOVO\b/i.test(d.model || '')
  };
  const additional = d.additionalItems || [];
  return d.model === 'Calculadora de Taxas' && primary.unitPrice === 0 && additional.length
    ? additional : [primary, ...additional];
}

window.openCardSimulator = function(encodedModel, encodedStorage, encodedColor, cashPrice, encodedRam) {
  const model = decodeURIComponent(encodedModel || '');
  const storage = decodeURIComponent(encodedStorage || '');
  const color = decodeURIComponent(encodedColor || '');
  const ram = decodeURIComponent(encodedRam || '');
  const baseUnitPrice = Number(cashPrice) || 0;

  currentSimData = {
    model: model || 'Calculadora de Taxas',
    storage,
    color,
    colorOptions: getSimulatorColorOptions(model, storage, ram, color, baseUnitPrice),
    additionalItems: [],
    catalogOptions: getSimCatalogOptions(),
    unitPrice: baseUnitPrice,
    quantity: 1,
    discountType: 'FIXED', // 'FIXED' (R$) ou 'PERCENT' (%)
    discountValue: 0,
    cashPrice: baseUnitPrice,
    ram,
    entryAmount: 0,
    tradeInActive: false,
    tradeInModel: 'iPhone 13',
    tradeInCustomModel: '',
    tradeInStorage: '128GB',
    tradeInAmount: 0
  };

  const modal = document.getElementById('cardSimulatorModal');
  const body = document.getElementById('cardSimulatorBody');
  if (!modal || !body) return;

  const colHex = getAppleColorHex(color);

  body.innerHTML = `
    <div class="sim-exec-container">
      <!-- Executive Header -->
      <div class="sim-exec-header">
        <div class="sim-exec-title">${escapeHtml(currentSimData.model)}</div>
        <div class="sim-exec-meta">
          ${storage ? `
            <span class="sim-exec-meta-item">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
              <span>${escapeHtml(storage)}</span>
            </span>
          ` : ''}
          ${ram ? `
            <span class="sim-exec-meta-item">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 19v-3"/><path d="M10 19v-3"/><path d="M14 19v-3"/><path d="M18 19v-3"/></svg>
              <span>${escapeHtml(ram)} RAM</span>
            </span>
          ` : ''}
          ${currentUser && currentSimData.colorOptions.length ? `
            <label class="sim-exec-meta-item sim-color-picker" for="simColorSelect">
              <span id="simColorDot" class="sim-color-dot" style="background-color: ${colHex};"></span>
              <span>Cor:</span>
              <select id="simColorSelect" class="sim-color-select" onchange="handleSimColorChange(this)" title="Selecionar cor e atualizar o preço do orçamento">
                ${currentSimData.colorOptions.map(option => `<option value="${escapeHtml(option.color)}"${option.color === color ? ' selected' : ''}>${escapeHtml(option.color)}</option>`).join('')}
              </select>
            </label>
          ` : color && color.toUpperCase() !== 'PADRÃO' ? `
            <span class="sim-exec-meta-item">
              <span style="background-color: ${colHex}; width: 10px; height: 10px; border-radius: 50%; display: inline-block; border: 1px solid rgba(255,255,255,0.3);"></span>
              <span>Cor: ${escapeHtml(color)}</span>
            </span>
          ` : ''}
        </div>
      </div>

      <section class="sim-add-products" aria-label="Adicionar produtos à cotação">
        <div class="sim-add-products-heading">
          <button type="button" id="simAddProductButton" class="sim-add-product-button" onclick="toggleSimProductPicker()" aria-expanded="false" aria-controls="simProductPicker">＋ Adicionar outro produto</button>
        </div>
        <div id="simProductPicker" class="sim-product-picker" hidden>
          <label for="simProductSearch">Buscar no catálogo</label>
          <input type="search" id="simProductSearch" placeholder="Busque modelo, capacidade ou cor…" oninput="searchSimProducts(this.value)" autocomplete="off">
          <div id="simProductResults" class="sim-product-results" aria-live="polite"></div>
        </div>
        <div id="simAdditionalItems" class="sim-additional-items"></div>
        <div id="simBundleSummary" class="sim-bundle-summary" hidden>
          <span>Total dos produtos <strong id="simBundleGross"></strong></span>
        </div>
      </section>

      <!-- Integrated Financial Controls -->
      <div class="sim-exec-controls" style="grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));">
        <div class="sim-exec-field">
          <label class="sim-exec-label" for="simCashInput">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/></svg>
            Preço Unitário
          </label>
          <div class="sim-exec-input-wrap">
            <span style="font-weight: 800; color: var(--text-muted); margin-right: 4px; font-size: 0.9rem;">R$</span>
            <input type="text" id="simCashInput" class="sim-exec-input" placeholder="0,00" value="${formatCurrencyInput(currentSimData.unitPrice)}" oninput="handleSimUnitPriceInput(this)">
          </div>
        </div>

        <div class="sim-exec-field">
          <label class="sim-exec-label">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Quantidade
          </label>
          <div class="sim-exec-input-wrap" style="padding: 0 4px; justify-content: space-between;">
            <button type="button" onclick="handleSimQtyStep(-1)" style="border: none; background: transparent; width: 30px; height: 100%; font-size: 1.1rem; font-weight: 800; cursor: pointer; color: var(--text-primary);">−</button>
            <input type="number" id="simQtyInput" min="1" max="99" value="1" onchange="handleSimQtyInput(this)" style="width: 38px; border: none; background: transparent; text-align: center; font-size: 0.95rem; font-weight: 800; color: var(--text-primary); outline: none;">
            <button type="button" onclick="handleSimQtyStep(1)" style="border: none; background: transparent; width: 30px; height: 100%; font-size: 1.1rem; font-weight: 800; cursor: pointer; color: var(--text-primary);">+</button>
          </div>
        </div>

        <div class="sim-exec-field">
          <label class="sim-exec-label">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><line x1="19" y1="5" x2="5" y2="19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/></svg>
            Desconto total
          </label>
          <div class="sim-exec-input-wrap" style="padding: 0; overflow: hidden;">
            <select id="simDiscountType" onchange="handleSimDiscountTypeChange(this)" style="border: none; background: rgba(0,0,0,0.04); font-size: 0.8rem; font-weight: 800; padding: 0 8px; height: 100%; border-right: 1.5px solid var(--border-color); color: var(--text-primary); outline: none; cursor: pointer;">
              <option value="FIXED">R$</option>
              <option value="PERCENT">%</option>
            </select>
            <input type="number" id="simDiscountValue" min="0" step="any" placeholder="0" oninput="handleSimDiscountValueInput(this)" style="width: 100%; height: 100%; border: none; background: transparent; padding: 0 8px; font-size: 0.95rem; font-weight: 800; color: var(--text-primary); outline: none;">
          </div>
        </div>

        <div class="sim-exec-field">
          <label class="sim-exec-label" for="simEntryInput">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
            Entrada PIX
          </label>
          <div class="sim-exec-input-wrap">
            <span style="font-weight: 800; color: var(--text-muted); margin-right: 4px; font-size: 0.9rem;">R$</span>
            <input type="text" id="simEntryInput" class="sim-exec-input" placeholder="0,00" value="" oninput="handleSimEntryInput(this)">
          </div>
        </div>

        <div class="sim-exec-field">
          <label class="sim-exec-label">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>
            Saldo no Cartão
          </label>
          <div class="sim-exec-badge-val" id="simHeroCardVal">${formatBRL(currentSimData.cashPrice)}</div>
        </div>
      </div>

      <!-- Trade-in Section (Aparelho na Troca) -->
      <div class="sim-tradein-card">
        <div class="sim-tradein-header">
          <label class="sim-tradein-toggle-label">
            <input type="checkbox" id="simTradeInActive" onchange="handleSimTradeInToggle(this)">
            <span class="sim-tradein-heading">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--accent-green);">
                <path d="m16 3 4 4-4 4"/><path d="M20 7H4"/><path d="m8 21-4-4 4-4"/><path d="M4 17h16"/>
              </svg>
              Deseja dar algum aparelho na troca?
            </span>
          </label>
          <span id="simTradeInBadge" class="sim-tradein-badge" style="display: none;">- R$ 0,00</span>
        </div>

        <div id="simTradeInBody" class="sim-tradein-body" style="display: none;">
          <div class="sim-tradein-grid">
            <div class="sim-exec-field">
              <label class="sim-exec-label" for="simTradeInModel">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect width="14" height="20" x="5" y="2" rx="2" ry="2"/><path d="M12 18h.01"/></svg>
                Modelo do Celular
              </label>
              <select id="simTradeInModel" class="sim-exec-select" onchange="handleSimTradeInModelChange(this)">
                <option value="iPhone 18 Pro Max">iPhone 18 Pro Max</option>
                <option value="iPhone 18 Pro">iPhone 18 Pro</option>
                <option value="iPhone 18 Plus">iPhone 18 Plus</option>
                <option value="iPhone 18">iPhone 18</option>
                <option value="iPhone 17 Pro Max">iPhone 17 Pro Max</option>
                <option value="iPhone 17 Pro">iPhone 17 Pro</option>
                <option value="iPhone 17 Air">iPhone 17 Air</option>
                <option value="iPhone 17 Plus">iPhone 17 Plus</option>
                <option value="iPhone 17">iPhone 17</option>
                <option value="iPhone 17e">iPhone 17e</option>
                <option value="iPhone 16 Pro Max">iPhone 16 Pro Max</option>
                <option value="iPhone 16 Pro">iPhone 16 Pro</option>
                <option value="iPhone 16 Plus">iPhone 16 Plus</option>
                <option value="iPhone 16">iPhone 16</option>
                <option value="iPhone 16e">iPhone 16e</option>
                <option value="iPhone 15 Pro Max">iPhone 15 Pro Max</option>
                <option value="iPhone 15 Pro">iPhone 15 Pro</option>
                <option value="iPhone 15 Plus">iPhone 15 Plus</option>
                <option value="iPhone 15">iPhone 15</option>
                <option value="iPhone 14 Pro Max">iPhone 14 Pro Max</option>
                <option value="iPhone 14 Pro">iPhone 14 Pro</option>
                <option value="iPhone 14 Plus">iPhone 14 Plus</option>
                <option value="iPhone 14">iPhone 14</option>
                <option value="iPhone 13 Pro Max">iPhone 13 Pro Max</option>
                <option value="iPhone 13 Pro">iPhone 13 Pro</option>
                <option value="iPhone 13" selected>iPhone 13</option>
                <option value="iPhone 13 Mini">iPhone 13 Mini</option>
                <option value="iPhone 12 Pro Max">iPhone 12 Pro Max</option>
                <option value="iPhone 12 Pro">iPhone 12 Pro</option>
                <option value="iPhone 12">iPhone 12</option>
                <option value="iPhone 12 Mini">iPhone 12 Mini</option>
                <option value="iPhone 11 Pro Max">iPhone 11 Pro Max</option>
                <option value="iPhone 11 Pro">iPhone 11 Pro</option>
                <option value="iPhone 11">iPhone 11</option>
                <option value="OUTRO">Outro Modelo (Digitar)...</option>
              </select>
              <input type="text" id="simTradeInCustomModel" class="sim-exec-input" placeholder="Digite o modelo..." style="display: none; margin-top: 6px; padding: 7px 10px; font-size: 0.85rem; border: 1.5px solid var(--border-color); border-radius: 6px; background: var(--bg-card); color: var(--text-primary);" oninput="handleSimTradeInCustomModel(this)">
            </div>

            <div class="sim-exec-field">
              <label class="sim-exec-label" for="simTradeInStorage">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
                Capacidade (GB)
              </label>
              <select id="simTradeInStorage" class="sim-exec-select" onchange="handleSimTradeInStorageChange(this)">
                <option value="64GB">64GB</option>
                <option value="128GB" selected>128GB</option>
                <option value="256GB">256GB</option>
                <option value="512GB">512GB</option>
                <option value="1TB">1TB</option>
                <option value="2TB">2TB</option>
              </select>
            </div>

            <div class="sim-exec-field">
              <label class="sim-exec-label" for="simTradeInValue">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
                Avaliação
              </label>
              <div class="sim-exec-input-wrap">
                <span style="font-weight: 800; color: var(--text-muted); margin-right: 6px; font-size: 0.95rem;">R$</span>
                <input type="text" id="simTradeInValue" class="sim-exec-input" placeholder="0,00" value="" oninput="handleSimTradeInValueInput(this)">
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Executive Installment Table -->
      <div class="sim-table-wrap">
        <table class="sim-exec-table">
          <thead>
            <tr>
              <th style="width: 45%;">Parcela</th>
              <th class="text-right" style="width: 55%;">Valor da Parcela</th>
            </tr>
          </thead>
          <tbody id="simInstallmentsGrid">
            <!-- Injected via recalculateSimulator -->
          </tbody>
        </table>
      </div>

      <!-- Footer Action Buttons -->
      <div style="margin-top: 10px;">
        <button class="sim-btn-copy-wa" onclick="copyCardSimulationToWhatsApp(this)" style="width: 100%; padding: 12px 18px; font-size: 0.95rem; font-weight: 800; display: flex; align-items: center; justify-content: center; gap: 8px;">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
          </svg>
          <span>Copiar Texto WhatsApp</span>
        </button>
      </div>
    </div>
  `;

  recalculateSimulator();
  modal.classList.add('active');
};


window.handleSimUnitPriceInput = function(inp) {
  const num = parseCurrencyInput(inp.value);
  inp.value = formatCurrencyInput(num);
  currentSimData.unitPrice = num;
  recalculateSimulator();
};

window.handleSimQtyStep = function(delta) {
  const qtyInp = document.getElementById('simQtyInput');
  const current = currentSimData.quantity || 1;
  const next = Math.min(99, Math.max(1, current + delta));
  currentSimData.quantity = next;
  if (qtyInp) qtyInp.value = next;
  recalculateSimulator();
};

window.handleSimQtyInput = function(inp) {
  const next = Math.min(99, Math.max(1, parseInt(inp.value) || 1));
  inp.value = next;
  currentSimData.quantity = next;
  recalculateSimulator();
};

window.handleSimDiscountTypeChange = function(sel) {
  currentSimData.discountType = sel.value;
  recalculateSimulator();
};

window.handleSimDiscountValueInput = function(inp) {
  const val = Math.max(0, parseFloat(inp.value) || 0);
  currentSimData.discountValue = val;
  recalculateSimulator();
};

window.recalculateSimulator = function() {
  const gridContainer = document.getElementById('simInstallmentsGrid');
  const heroCardVal = document.getElementById('simHeroCardVal');

  if (!gridContainer) return;

  // Soma o produto inicial e os itens adicionais da mesma cotação.
  const grossTotal = QuoteCore.money(getSimQuotationItems().reduce((total, item) => total + item.unitPrice * item.quantity, 0));

  // 2. Aplicação do Desconto (R$ ou %)
  const discType = currentSimData.discountType || 'FIXED';
  const discVal = Number(currentSimData.discountValue) || 0;
  let discountAmount = 0;
  if (discType === 'PERCENT') {
    discountAmount = grossTotal * (Math.min(100, discVal) / 100);
  } else {
    discountAmount = Math.min(grossTotal, discVal);
  }
  discountAmount = QuoteCore.money(discountAmount);

  // 3. Preço Total à vista com desconto aplicado
  const cashVal = Math.max(0, QuoteCore.money(grossTotal - discountAmount));
  currentSimData.cashPrice = cashVal;
  currentSimData.discountAmount = discountAmount;
  currentSimData.grossTotal = grossTotal;

  const entryVal = Math.min(cashVal, currentSimData.entryAmount || 0);
  const tradeInVal = currentSimData.tradeInActive ? Math.min(Math.max(0, cashVal - entryVal), currentSimData.tradeInAmount || 0) : 0;
  if (currentSimData.entryAmount !== entryVal) {
    currentSimData.entryAmount = entryVal;
    const input = document.getElementById('simEntryInput');
    if (input) input.value = formatCurrencyInput(entryVal);
  }
  if (currentSimData.tradeInActive && currentSimData.tradeInAmount !== tradeInVal) {
    currentSimData.tradeInAmount = tradeInVal;
    const input = document.getElementById('simTradeInValue');
    if (input) input.value = formatCurrencyInput(tradeInVal);
    const badge = document.getElementById('simTradeInBadge');
    if (badge) { badge.textContent = `- ${formatBRL(tradeInVal)}`; badge.style.display = tradeInVal > 0 ? 'inline-block' : 'none'; }
  }
  const totalDeductions = entryVal + tradeInVal;
  const balance = Math.max(0, QuoteCore.money(cashVal - totalDeductions));
  const summary = document.getElementById('simBundleSummary');
  if (summary) summary.hidden = !(currentSimData.additionalItems || []).length;
  const gross = document.getElementById('simBundleGross');
  if (gross) gross.textContent = formatBRL(grossTotal);

  if (heroCardVal) {
    if (totalDeductions > 0) {
      heroCardVal.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: flex-end; justify-content: center; width: 100%; line-height: 1.2;">
          <span style="font-size: 1.15rem; font-weight: 800; color: var(--accent-green);">${formatBRL(balance)}</span>
          <span style="font-size: 0.68rem; color: var(--text-muted); font-weight: 700; margin-top: 2px;">(Total Abatido: ${formatBRL(totalDeductions)})</span>
        </div>
      `;
    } else {
      heroCardVal.innerHTML = `<span style="font-size: 1.15rem; font-weight: 800; color: var(--accent-green);">${formatBRL(balance)}</span>`;
    }
  }

  let rowsHtml = '';
  for (let i = 1; i <= 18; i++) {
    const sim = calculateInstallment(cashVal, totalDeductions, i);
    const label = i === 1 ? '1x no cartão' : `${i}x`;

    rowsHtml += `
      <tr>
        <td style="font-weight: 800; color: var(--text-primary); font-size: 0.95rem;">${label}</td>
        <td class="text-right" style="color: var(--accent-green); font-weight: 800; font-size: 1.05rem;">
          ${formatBRL(sim.monthlyAmount)}
        </td>
      </tr>
    `;
  }

  gridContainer.innerHTML = rowsHtml;
};

window.copyCardSimulationToWhatsApp = async function(btn) {
  recalculateSimulator();
  const d = currentSimData;
  const cashVal = d.cashPrice || 0;
  const entryVal = d.entryAmount || 0;
  const tradeInVal = (d.tradeInActive ? d.tradeInAmount : 0) || 0;
  const totalDeductions = entryVal + tradeInVal;
  const balance = Math.max(0, cashVal - totalDeductions);

  let text = `SIMULAÇÃO DE PARCELAMENTO\n\n`;
  const qty = d.quantity || 1;
  const quotationItems = getSimQuotationItems();
  if ((d.additionalItems || []).length) {
    text += 'PRODUTOS DA COTAÇÃO:\n\n';
    quotationItems.forEach((item, index) => {
      text += `${index + 1}. ${item.model}${item.storage ? ` (${item.storage})` : ''}\n`;
      text += `Quantidade: ${item.quantity} unidade${item.quantity > 1 ? 's' : ''}\n`;
      if (item.ram) text += `RAM: ${item.ram}\n`;
      if (item.color && item.color.toUpperCase() !== 'PADRÃO') text += `Cor: ${item.color}\n`;
      text += `Preço unitário: ${formatBRL(item.unitPrice)}\n`;
      text += `Subtotal: ${formatBRL(item.unitPrice * item.quantity)}\n\n`;
    });
  } else {
    text += `Produto: ${d.model} ${d.storage ? `(${d.storage})` : ''}\n`;
    text += `Quantidade: ${qty} unidade${qty > 1 ? 's' : ''}\n`;
    if (d.ram) text += `RAM: ${d.ram}\n`;
    if (d.color && d.color.toUpperCase() !== 'PADRÃO') text += `Cor: ${d.color}\n`;
    if (qty > 1) text += `Preço Unitário: ${formatBRL(d.unitPrice || cashVal)}\n`;
  }
  if (d.discountAmount > 0) {
    const discLabel = d.discountType === 'PERCENT' ? `${d.discountValue}%` : formatBRL(d.discountAmount);
    text += `Desconto: - ${formatBRL(d.discountAmount)}${d.discountType === 'PERCENT' ? ` (${discLabel})` : ''}\n`;
  }
  text += `\n`;
  text += `Valor Total À Vista (PIX): ${formatBRL(cashVal)}\n\n`;

  if (d.tradeInActive && tradeInVal > 0) {
    const tradeModel = d.tradeInModel === 'OUTRO' ? (d.tradeInCustomModel || 'Outro Aparelho') : d.tradeInModel;
    text += `Aparelho na Troca: ${tradeModel} ${d.tradeInStorage || ''}\n\n`;
    text += `Valor Avaliado na Troca: - ${formatBRL(tradeInVal)}\n\n`;
  }
  
  if (entryVal > 0) {
    text += `Entrada em PIX: - ${formatBRL(entryVal)}\n\n`;
  }

  if (totalDeductions > 0) {
    text += `Saldo a Parcelar no Cartão: ${formatBRL(balance)}\n\n`;
  }
  
  text += `OPÇÕES DE PARCELAMENTO NO CARTÃO:\n\n`;

  const installmentOptions = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18];
  
  const installmentRows = installmentOptions.map(n => {
    const sim = calculateInstallment(cashVal, totalDeductions, n);
    return `${n}x de ${formatBRL(sim.monthlyAmount)}`;
  });

  text += installmentRows.join('\n');

  const isSemi = quotationItems.some(item => item.isSemi);
  if ((d.additionalItems || []).length && isSemi) {
    text += '\n\nGarantia: 1 ano Apple para produtos novos lacrados e 90 dias da loja para seminovos.\nEmitimos nota fiscal.';
  } else if (!isSemi) {
    text += `\n\nProduto novo lacrado com 1 ano de garantia Apple.\nEmitimos nota fiscal.`;
  }

  await robustCopyToClipboard(text);

  if (btn) {
    const origHtml = btn.innerHTML;
    btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg><span style="color: #10b981;">Copiado com Sucesso!</span>`;
    setTimeout(() => {
      btn.innerHTML = origHtml;
    }, 2000);
  } else {
    alert('Simulação copiada para a área de transferência! Cole no WhatsApp.');
  }
};

// Card Simulator Modal Close Logic
const cardSimulatorModal = document.getElementById('cardSimulatorModal');
const closeCardSimulatorModal = document.getElementById('closeCardSimulatorModal');
if (closeCardSimulatorModal) {
  closeCardSimulatorModal.addEventListener('click', () => cardSimulatorModal.classList.remove('active'));
}
if (cardSimulatorModal) {
  cardSimulatorModal.addEventListener('click', (e) => {
    if (e.target === cardSimulatorModal) cardSimulatorModal.classList.remove('active');
  });
}

const clientShowcaseModal = document.getElementById('clientShowcaseModal');
if (clientShowcaseModal) {
  clientShowcaseModal.addEventListener('click', (e) => {
    if (e.target === clientShowcaseModal) closeClientShowcaseModal();
  });
}

// 17. Export Preços do Dia Summary to WhatsApp (Agora com seleção por modelos)
window.exportPricesDayTable = function() {
  openExportSelectionModal('POD');
};

// =========================================================================
// SELEÇÃO DE PRODUTOS & EXPORTAÇÃO LIMPA PARA WHATSAPP (UNIVERSAL: SF OU POD)
// =========================================================================
let pdfSelectedVariantsMap = new Map(); // key: variantKey -> boolean
let pdfCachedFamilies = [];
let currentExportScope = 'SF'; // 'SF' = Loja Física, 'POD' = Preços do Dia (Fornecedores)
let exportModalIsAllScope = false;

window.openStorefrontExportModal = function(forceAll = true) {
  if (!currentUser) {
    if (confirm('A exportação completa da tabela para o WhatsApp está disponível para usuários cadastrados. Deseja entrar na sua conta agora?')) {
      window.location.href = '/login.html';
    }
    return;
  }
  openExportSelectionModal('SF', forceAll);
};
window.exportStorefrontPDF = window.openStorefrontExportModal;
window.openPdfSelectionModal = function(forceAll = true) {
  openExportSelectionModal('SF', forceAll);
};

window.toggleExportModalCatalogScope = function() {
  exportModalIsAllScope = !exportModalIsAllScope;
  openExportSelectionModal(currentExportScope, exportModalIsAllScope);
};

window.openExportSelectionModal = function(scope = 'SF', forceAll = false) {
  currentExportScope = scope;
  exportModalIsAllScope = Boolean(forceAll);
  const modal = document.getElementById('pdfSelectionModal');
  const body = document.getElementById('pdfSelectionListBody');
  const titleEl = document.getElementById('exportModalTitle');
  const subEl = document.getElementById('exportModalSubtitle');
  const scopeLabel = document.getElementById('exportModalScopeLabel');
  if (!modal || !body) return;

  if (scopeLabel) {
    scopeLabel.textContent = exportModalIsAllScope ? 'Voltar para Categoria Atual' : 'Ver Catálogo Inteiro';
  }

  if (titleEl) {
    if (scope === 'POD') {
      titleEl.textContent = 'Exportar Preços do Dia (Fornecedores)';
    } else {
      titleEl.textContent = exportModalIsAllScope
        ? 'Exportar Catálogo Completo para o WhatsApp'
        : 'Exportar Lista para o WhatsApp';
    }
  }
  if (subEl) {
    if (scope === 'POD') {
      subEl.textContent = 'Marque os modelos de fornecedor que deseja incluir no texto';
    } else {
      subEl.textContent = exportModalIsAllScope
        ? 'Exibindo todos os produtos e categorias disponíveis na loja'
        : 'Marque os modelos que deseja incluir no texto para enviar aos clientes';
    }
  }

  let filtered = [];

  if (scope === 'POD') {
    const podSearchInput = document.getElementById('podSearchInput');
    const podRegionFilter = document.getElementById('podRegionFilter');
    const podVerifiedFilter = document.getElementById('podVerifiedFilter');

    const searchTerm = (podSearchInput?.value || '').trim();
    const searchTokens = normalizeSearchText(searchTerm).split(' ').filter(Boolean);
    const selectedRegion = podRegionFilter?.value || '';
    const onlyVerified = podVerifiedFilter?.checked || false;

    filtered = allProducts.filter(p => {
      if (!p.price || p.price <= 0) return false;
      if (isCpoProduct(p)) return false;
      const isSemi = isSeminovoProduct(p);

      if (searchTokens.length === 0 && podCurrentCategory !== 'ALL') {
        if (podCurrentCategory === 'SEMI') {
          if (!isSemi) return false;
        } else {
          if (isSemi) return false;
          const cat = (p.category || '').toUpperCase().trim();
          const name = (p.name || '').toUpperCase();
          if (podCurrentCategory === 'IPH' && !(cat === 'IPH' || name.includes('IPHONE'))) return false;
          if (podCurrentCategory === 'MCB' && !(cat === 'MCB' || name.includes('MACBOOK') || name.includes('MAC MINI') || name.includes('MAC STUDIO') || name.includes('MAC PRO') || name.includes('IMAC'))) return false;
          if (podCurrentCategory === 'IPAD' && !(cat === 'IPAD' || cat === 'IPD' || name.includes('IPAD'))) return false;
          if (podCurrentCategory === 'RLG' && !(cat === 'RLG' || name.includes('WATCH') || name.includes('SERIES') || name.includes('ULTRA'))) return false;
          if (podCurrentCategory === 'PODS' && !(cat === 'PODS' || name.includes('AIRPOD'))) return false;
          if (podCurrentCategory === 'ACSS' && !(cat === 'ACSS' || name.includes('PENCIL') || name.includes('MAGIC') || name.includes('CABO') || name.includes('FONTE') || name.includes('CARREGADOR'))) return false;
          if (podCurrentCategory === 'IMAC' && !(cat === 'IMAC' || name.includes('IMAC'))) return false;
        }
      }

      if (searchTokens.length > 0) {
        if (!matchSearchTokens(p, searchTokens)) return false;
      }

      if (selectedRegion) {
        const isMac = (p.category || '').toUpperCase() === 'MCB' || (p.name || '').toUpperCase().includes('MAC');
        if (!isMac) {
          const reg = (p.region || p.description || p.name || '').toUpperCase();
          if (selectedRegion === 'EUA' && !(reg.includes('EUA') || reg.includes('USA') || reg.includes('LL/A') || reg.includes('CHIP VIRTUAL'))) return false;
          if (selectedRegion === 'BR' && !(reg.includes('BR') || reg.includes('ANATEL') || reg.includes('NACIONAL') || reg.includes('BZ/A'))) return false;
          if (selectedRegion === 'PY' && !(reg.includes('PY') || reg.includes('PARAGUAI') || reg.includes('PARAGUAY'))) return false;
          if (selectedRegion === 'GLOBAL' && !(reg.includes('GLOBAL') || reg.includes('J/A') || reg.includes('ZD/A') || reg.includes('HN/A'))) return false;
        }
      }

      if (onlyVerified && !p.supplier?.isVerified) return false;
      return true;
    });

    if (filtered.length === 0) {
      alert('Nenhum produto encontrado para exportar com os filtros atuais de Preços do Dia.');
      return;
    }
  } else {
    // SF Scope
    const sLower = sfSearchQuery.trim().toLowerCase();
    const searchTokens = normalizeSearchText(sLower).split(' ').filter(Boolean);

    filtered = allProducts.filter(p => {
      if (isDisallowedProduct(p)) return false;
      if (!p.price || p.price <= 0) return false;
      const isSemi = isSeminovoProduct(p);

      if (!exportModalIsAllScope && searchTokens.length === 0 && sfCurrentCategory !== 'ALL') {
        if (sfCurrentCategory === 'SEMI') {
          if (!isSemi) return false;
        } else {
          if (isSemi) return false;
          const cat = (p.category || '').toUpperCase().trim();
          const name = (p.name || '').toUpperCase();
          if (sfCurrentCategory === 'IPH' && !(cat === 'IPH' || name.includes('IPHONE'))) return false;
          if (sfCurrentCategory === 'MCB' && !(cat === 'MCB' || name.includes('MACBOOK') || name.includes('MAC MINI') || name.includes('MAC STUDIO') || name.includes('MAC PRO') || name.includes('IMAC'))) return false;
          if (sfCurrentCategory === 'IPAD' && !(cat === 'IPAD' || cat === 'IPD' || name.includes('IPAD'))) return false;
          if (sfCurrentCategory === 'RLG' && !(cat === 'RLG' || name.includes('WATCH') || name.includes('SERIES') || name.includes('ULTRA'))) return false;
          if (sfCurrentCategory === 'PODS' && !(cat === 'PODS' || name.includes('AIRPOD'))) return false;
          if (sfCurrentCategory === 'ACSS' && !(cat === 'ACSS' || name.includes('PENCIL') || name.includes('MAGIC') || name.includes('CABO') || name.includes('FONTE') || name.includes('CARREGADOR'))) return false;
          if (sfCurrentCategory === 'IMAC' && !(cat === 'IMAC' || name.includes('IMAC'))) return false;
        }
      }

      if (searchTokens.length > 0) {
        if (!matchSearchTokens(p, searchTokens)) return false;
      }
      return true;
    });

    if (filtered.length === 0) {
      alert('Nenhum produto encontrado para exportar com os filtros atuais da Loja Física.');
      return;
    }
  }

  // Limpa o mapa para a visualização atual garantindo que apenas os modelos presentes no modal sejam selecionados
  pdfSelectedVariantsMap.clear();

  const modelFamilies = new Map();
  let variantCounter = 0;

  filtered.forEach(p => {
    const isSemi = isSeminovoProduct(p);
    const secInfo = getProductSectionInfo(p);
    const baseModelName = cleanModelName(p.name).replace(/\s+/g, ' ').trim();
    const modelKey = isSemi ? `${baseModelName.toUpperCase()} [SEMINOVO]` : baseModelName.toUpperCase();
    const displayName = isSemi ? `${baseModelName} (Seminovo)` : baseModelName;
    const ram = getMacBookRam(p);
    const storageKey = (p.storage || 'PADRÃO').trim().toUpperCase();
    const variantKey = `${modelKey}__${storageKey}__${ram || ''}`;

    if (!modelFamilies.has(modelKey)) {
      modelFamilies.set(modelKey, {
        modelName: displayName,
        rawModelName: baseModelName,
        category: p.category,
        isSeminovo: isSemi,
        sectionKey: secInfo.key,
        sectionTitle: secInfo.title,
        sectionOrder: secInfo.order,
        variantsMap: new Map()
      });
    }

    const fam = modelFamilies.get(modelKey);
    if (!fam.variantsMap.has(variantKey)) {
      const varId = 'var_' + (++variantCounter);
      fam.variantsMap.set(variantKey, {
        varId: varId,
        variantKey: variantKey,
        model: displayName,
        rawModel: baseModelName,
        storage: (p.storage || '').trim(),
        ram: ram,
        isSeminovo: isSemi,
        colors: new Map()
      });
      pdfSelectedVariantsMap.set(varId, true);
    }

    const stGrp = fam.variantsMap.get(variantKey);
    const colorName = (p.color || 'Padrão').trim();
    const colorKey = colorName.toUpperCase();
    
    if (!stGrp.colors.has(colorKey)) {
      stGrp.colors.set(colorKey, {
        color: colorName,
        offers: [p],
        ram: ram
      });
    } else {
      stGrp.colors.get(colorKey).offers.push(p);
    }
  });

  pdfCachedFamilies = Array.from(modelFamilies.values()).sort((a, b) => {
    const secA = a.sectionOrder || 999;
    const secB = b.sectionOrder || 999;
    if (secA !== secB) return secA - secB;
    const rankA = getModelOrderRank(a.rawModelName || a.modelName, a.category);
    const rankB = getModelOrderRank(b.rawModelName || b.modelName, b.category);
    if (rankA !== rankB) return rankA - rankB;
    if (a.isSeminovo !== b.isSeminovo) return a.isSeminovo ? 1 : -1;
    return a.modelName.localeCompare(b.modelName);
  });

  let html = '';
  let lastSecKey = null;
  pdfCachedFamilies.forEach(fam => {
    if (fam.sectionKey && fam.sectionKey !== lastSecKey) {
      lastSecKey = fam.sectionKey;
      html += `
        <div style="margin: 20px 0 10px 0; padding: 7px 12px; background: rgba(255, 255, 255, 0.04); border-left: 3px solid var(--accent-green); border-radius: 4px; font-weight: 800; font-size: 0.84rem; color: var(--text-primary); text-transform: uppercase; letter-spacing: 0.5px;">
          ${fam.sectionTitle || 'PRODUTOS'}
        </div>
      `;
    }
    html += `
      <div style="margin-bottom: 14px; background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 10px; padding: 12px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; font-weight: 800; font-size: 0.88rem; color: var(--text-primary);">
          <span>${fam.modelName}</span>
          <span style="font-size: 0.72rem; padding: 2px 7px; border-radius: 6px; background: ${fam.isSeminovo ? 'rgba(245, 158, 11, 0.15)' : 'rgba(16, 185, 129, 0.15)'}; color: ${fam.isSeminovo ? '#f59e0b' : '#10b981'}; font-weight: 800;">${fam.isSeminovo ? 'SEMINOVO' : 'LACRADO'}</span>
        </div>
        <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 8px;">
    `;

    const variants = Array.from(fam.variantsMap.values()).sort((a, b) => {
      const rA = getStorageRank(a.storage);
      const rB = getStorageRank(b.storage);
      if (rA !== rB) return rA - rB;
      return (parseInt(a.ram) || 0) - (parseInt(b.ram) || 0);
    });

    variants.forEach(v => {
      const isChecked = pdfSelectedVariantsMap.get(v.varId) === true;
      const labelText = v.ram ? `${v.storage} (${v.ram} RAM)` : (v.storage || 'Padrão');

      html += `
        <label style="display: flex; align-items: center; gap: 8px; background: var(--bg-body); border: 1px solid var(--border-color); padding: 8px 10px; border-radius: 8px; cursor: pointer; font-size: 0.82rem; font-weight: 700; color: var(--text-primary); user-select: none;">
          <input type="checkbox" data-var-id="${v.varId}" ${isChecked ? 'checked' : ''} style="width: 16px; height: 16px; accent-color: var(--accent-green); cursor: pointer;">
          <span>${labelText}</span>
        </label>
      `;
    });

    html += `
        </div>
      </div>
    `;
  });

  body.innerHTML = html;

  // Sincronização direta e contínua dos checkboxes
  const handleSelectionUpdate = function(e) {
    const cb = e.target.closest('input[type="checkbox"]');
    if (cb && cb.dataset && cb.dataset.varId) {
      pdfSelectedVariantsMap.set(cb.dataset.varId, Boolean(cb.checked));
      updatePdfSelectedCountBadge();
    }
  };
  body.onchange = handleSelectionUpdate;
  body.onclick = function() {
    setTimeout(updatePdfSelectedCountBadge, 20);
  };

  updatePdfSelectedCountBadge();
  modal.classList.add('active');
  modal.style.display = 'flex';
};

window.closePdfSelectionModal = function() {
  const modal = document.getElementById('pdfSelectionModal');
  if (modal) {
    modal.classList.remove('active');
    modal.style.display = 'none';
  }
};

window.toggleAllPdfSelections = function(selectState) {
  const state = Boolean(selectState);
  pdfSelectedVariantsMap.forEach((_, key) => {
    pdfSelectedVariantsMap.set(key, state);
  });
  const checkboxes = document.querySelectorAll('#pdfSelectionListBody input[type="checkbox"]');
  checkboxes.forEach(cb => {
    cb.checked = state;
    if (cb.dataset && cb.dataset.varId) {
      pdfSelectedVariantsMap.set(cb.dataset.varId, state);
    }
  });
  updatePdfSelectedCountBadge();
};

function updatePdfSelectedCountBadge() {
  const badge = document.getElementById('pdfSelectedCountBadge');
  const checkedCbs = document.querySelectorAll('#pdfSelectionListBody input[type="checkbox"]:checked');
  let count = checkedCbs.length;
  if (count === 0 && !document.querySelector('#pdfSelectionListBody input[type="checkbox"]')) {
    pdfSelectedVariantsMap.forEach(val => { if (val === true) count++; });
  }
  if (badge) badge.textContent = `${count} selecionados`;
}

// Copia lista formatada para WhatsApp com os modelos selecionados
window.copySelectedStorefrontWhatsApp = async function(btn) {
  // Sincroniza com os checkboxes reais que estão fisicamente marcados na tela
  const checkedCbs = document.querySelectorAll('#pdfSelectionListBody input[type="checkbox"]:checked');
  const checkedIds = new Set();
  checkedCbs.forEach(cb => {
    if (cb.dataset && cb.dataset.varId) {
      checkedIds.add(cb.dataset.varId);
      pdfSelectedVariantsMap.set(cb.dataset.varId, true);
    }
  });

  let selectedCount = checkedIds.size;
  if (selectedCount === 0) {
    pdfSelectedVariantsMap.forEach(val => { if (val === true) selectedCount++; });
  }

  if (selectedCount === 0) {
    alert('Por favor, selecione pelo menos 1 modelo para exportar.');
    return;
  }

  const isPod = (currentExportScope === 'POD');
  let hasNovos = false;
  let hasSemis = false;

  // Organizar os itens selecionados por Seção
  const sectionsMap = new Map();

  pdfCachedFamilies.forEach(fam => {
    const variants = Array.from(fam.variantsMap.values()).sort((a, b) => {
      const rA = getStorageRank(a.storage);
      const rB = getStorageRank(b.storage);
      if (rA !== rB) return rA - rB;
      return (parseInt(a.ram) || 0) - (parseInt(b.ram) || 0);
    });

    variants.forEach(grp => {
      const isSelected = checkedIds.has(grp.varId) || (pdfSelectedVariantsMap.get(grp.varId) === true);
      if (!isSelected) return;

      if (grp.isSeminovo || grp.model.toUpperCase().includes('SEMINOVO')) {
        hasSemis = true;
      } else {
        hasNovos = true;
      }

      const colorsArr = Array.from(grp.colors.values()).map(colObj => {
        const isSemi = grp.isSeminovo;
        const offers = colObj.offers || [];
        const rawRefCost = calculateSupplierReferencePrice(offers, isSemi);
        if (!rawRefCost || rawRefCost <= 0) return null;
        const refCost = applyDFU(rawRefCost, fam.category, grp.rawModel);
        
        let finalPrice = refCost;
        if (!isPod) {
          const marginVal = getProductMargin(grp.rawModel, fam.category, isSemi);
          finalPrice = refCost + marginVal;
        }

        return {
          color: colObj.color,
          retailPrice: finalPrice,
          ram: colObj.ram
        };
      }).filter(Boolean).sort((a, b) => a.retailPrice - b.retailPrice);

      if (colorsArr.length === 0) return;

      const titleLine = formatModelTitleForCopy(grp.rawModel || grp.model, grp.storage, grp.ram);
      const modelLines = [titleLine, ''];

      colorsArr.forEach(c => {
        const colorFormatted = formatOnlyFirstLetterUpper(c.color);
        modelLines.push(`${colorFormatted} • ${formatBRL(c.retailPrice)}`);
      });

      const blockText = modelLines.join('\n');

      const secKey = fam.sectionKey || 'OUTROS';
      const secTitle = fam.sectionTitle || 'PRODUTOS';
      const secOrder = fam.sectionOrder || 999;

      if (!sectionsMap.has(secKey)) {
        sectionsMap.set(secKey, {
          title: secTitle,
          order: secOrder,
          blocks: []
        });
      }
      sectionsMap.get(secKey).blocks.push(blockText);
    });
  });

  if (sectionsMap.size === 0) {
    alert('Nenhum preço disponível para os modelos selecionados.');
    return;
  }

  const sortedSections = Array.from(sectionsMap.values()).sort((a, b) => a.order - b.order);
  const outputSections = [];

  sortedSections.forEach(sec => {
    if (sec.blocks.length > 0) {
      const secHeader = `${sec.title}\n-----------------`;
      outputSections.push(`${secHeader}\n\n${sec.blocks.join('\n\n')}`);
    }
  });

  let footer = '';
  if (!isPod) {
    const footerLines = [''];
    if (hasNovos && !hasSemis) {
      footerLines.push('Produto novo lacrado com 1 ano de garantia Apple.');
      footerLines.push('Emitimos nota fiscal.');
      footerLines.push('');
    } else if (hasNovos && hasSemis) {
      footerLines.push('Produtos novos lacrados com 1 ano de garantia Apple.');
      footerLines.push('Emitimos nota fiscal.');
      footerLines.push('');
    }
    footerLines.push('Valores válidos para pagamento à vista.');
    footerLines.push('Consulte opções de parcelamento no cartão.');
    footer = footerLines.join('\n');
  }

  const fullText = (outputSections.join('\n\n\n') + (footer ? '\n\n' + footer : '')).trim();

  const copySuccess = await robustCopyToClipboard(fullText);

  if (btn) {
    const origHtml = btn.innerHTML;
    if (copySuccess) {
      btn.disabled = true;
      btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg><span>Copiado com Sucesso!</span>`;
      btn.style.background = '#059669';
      setTimeout(() => {
        btn.innerHTML = origHtml;
        btn.style.background = 'var(--accent-green)';
        btn.disabled = false;
        closePdfSelectionModal();
      }, 1200);
    } else {
      btn.innerHTML = `<span>Copiar Manualmente</span>`;
      prompt('Pressione Ctrl+C (ou Cmd+C) para copiar a lista para o WhatsApp:', fullText);
      btn.innerHTML = origHtml;
    }
  } else {
    closePdfSelectionModal();
  }
};

// Exporta a lista COMPLETA de todos os produtos do catálogo para o WhatsApp (somente quando logado)
window.exportAllStorefrontWhatsApp = async function(btn) {
  if (!currentUser) {
    alert('Você precisa estar conectado a uma conta para exportar a lista de produtos.');
    return;
  }

  // Filtrar todos os produtos válidos do catálogo inteiro (sem restrição de categoria ou busca)
  const validProducts = (allProducts || []).filter(p => {
    if (isDisallowedProduct(p)) return false;
    if (!p.price || p.price <= 0) return false;
    return true;
  });

  if (validProducts.length === 0) {
    alert('Nenhum produto disponível no catálogo para exportar.');
    return;
  }

  // Agrupamento por Seção e Família de Modelo
  const sectionsMap = new Map();

  validProducts.forEach(p => {
    const secInfo = getProductSectionInfo(p);
    if (!sectionsMap.has(secInfo.key)) {
      sectionsMap.set(secInfo.key, {
        key: secInfo.key,
        title: secInfo.title,
        order: secInfo.order,
        familiesMap: new Map()
      });
    }

    const sectionObj = sectionsMap.get(secInfo.key);
    const isSemi = isSeminovoProduct(p);
    const baseModelName = cleanModelName(p.name).replace(/\s+/g, ' ').trim();
    const modelKey = baseModelName.toUpperCase();
    const ram = getMacBookRam(p);
    const storageKey = (p.storage || 'PADRÃO').trim().toUpperCase();
    const variantKey = `${modelKey}__${storageKey}__${ram || ''}`;

    if (!sectionObj.familiesMap.has(modelKey)) {
      sectionObj.familiesMap.set(modelKey, {
        modelName: baseModelName,
        rawModelName: baseModelName,
        category: p.category,
        isSeminovo: isSemi,
        variantsMap: new Map()
      });
    }

    const fam = sectionObj.familiesMap.get(modelKey);
    if (!fam.variantsMap.has(variantKey)) {
      fam.variantsMap.set(variantKey, {
        variantKey: variantKey,
        model: baseModelName,
        rawModel: baseModelName,
        storage: (p.storage || '').trim(),
        ram: ram,
        isSeminovo: isSemi,
        colors: new Map()
      });
    }

    const stGrp = fam.variantsMap.get(variantKey);
    const colorName = (p.color || 'Padrão').trim();
    const colorKey = colorName.toUpperCase();

    if (!stGrp.colors.has(colorKey)) {
      stGrp.colors.set(colorKey, {
        color: colorName,
        offers: [p],
        ram: ram
      });
    } else {
      stGrp.colors.get(colorKey).offers.push(p);
    }
  });

  const sortedSections = Array.from(sectionsMap.values()).sort((a, b) => a.order - b.order);

  const outputSections = [];
  let hasNovos = false;
  let hasSemis = false;

  sortedSections.forEach(sec => {
    const fams = Array.from(sec.familiesMap.values()).sort((a, b) => {
      const rankA = getModelOrderRank(a.rawModelName || a.modelName, a.category);
      const rankB = getModelOrderRank(b.rawModelName || b.modelName, b.category);
      if (rankA !== rankB) return rankA - rankB;
      return a.modelName.localeCompare(b.modelName);
    });

    const sectionBlocks = [];

    fams.forEach(fam => {
      const variants = Array.from(fam.variantsMap.values()).sort((a, b) => {
        const rA = getStorageRank(a.storage);
        const rB = getStorageRank(b.storage);
        if (rA !== rB) return rA - rB;
        return (parseInt(a.ram) || 0) - (parseInt(b.ram) || 0);
      });

      variants.forEach(grp => {
        if (grp.isSeminovo) {
          hasSemis = true;
        } else {
          hasNovos = true;
        }

        const colorsArr = Array.from(grp.colors.values()).map(colObj => {
          const isSemi = grp.isSeminovo;
          const offers = colObj.offers || [];
          const rawRefCost = calculateSupplierReferencePrice(offers, isSemi);
          if (!rawRefCost || rawRefCost <= 0) return null;
          const refCost = applyDFU(rawRefCost, fam.category, grp.rawModel);
          const marginVal = getProductMargin(grp.rawModel, fam.category, isSemi);
          const finalPrice = refCost + marginVal;

          return {
            color: colObj.color,
            retailPrice: finalPrice,
            ram: colObj.ram
          };
        }).filter(Boolean).sort((a, b) => a.retailPrice - b.retailPrice);

        if (colorsArr.length === 0) return;

        const titleLine = formatModelTitleForCopy(grp.rawModel, grp.storage, grp.ram);
        const modelLines = [titleLine, ''];

        colorsArr.forEach(c => {
          const colorFormatted = formatOnlyFirstLetterUpper(c.color);
          modelLines.push(`${colorFormatted} • ${formatBRL(c.retailPrice)}`);
        });

        sectionBlocks.push(modelLines.join('\n'));
      });
    });

    if (sectionBlocks.length > 0) {
      const secHeader = `${sec.title}\n-----------------`;
      outputSections.push(`${secHeader}\n\n${sectionBlocks.join('\n\n')}`);
    }
  });

  if (outputSections.length === 0) {
    alert('Nenhum preço disponível no catálogo para exportar.');
    return;
  }

  const footerLines = [''];
  if (hasNovos && !hasSemis) {
    footerLines.push('Produto novo lacrado com 1 ano de garantia Apple.');
    footerLines.push('Emitimos nota fiscal.');
    footerLines.push('');
  } else if (hasNovos && hasSemis) {
    footerLines.push('Produtos novos lacrados com 1 ano de garantia Apple.');
    footerLines.push('Emitimos nota fiscal.');
    footerLines.push('');
  }
  footerLines.push('Valores válidos para pagamento à vista.');
  footerLines.push('Consulte opções de parcelamento no cartão.');
  const footer = footerLines.join('\n');

  const fullText = (outputSections.join('\n\n\n') + (footer ? '\n\n' + footer : '')).trim();

  const copySuccess = await robustCopyToClipboard(fullText);

  if (btn) {
    const origHtml = btn.innerHTML;
    if (copySuccess) {
      btn.disabled = true;
      btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg><span style="color: #fff;">Lista Completa Copiada!</span>`;
      btn.style.background = '#059669';
      btn.style.borderColor = '#059669';
      btn.style.color = '#fff';
      setTimeout(() => {
        btn.innerHTML = origHtml;
        btn.style.background = 'rgba(16, 185, 129, 0.15)';
        btn.style.borderColor = 'rgba(16, 185, 129, 0.4)';
        btn.style.color = '#10b981';
        btn.disabled = false;
      }, 2500);
    } else {
      btn.innerHTML = `<span>Copiar Manualmente</span>`;
      prompt('Pressione Ctrl+C (ou Cmd+C) para copiar a lista completa:', fullText);
      btn.innerHTML = origHtml;
    }
  }
};

// Fechar modal de seleção ao clicar fora
const pdfSelectionModalEl = document.getElementById('pdfSelectionModal');
if (pdfSelectionModalEl) {
  pdfSelectionModalEl.addEventListener('click', (e) => {
    if (e.target === pdfSelectionModalEl) closePdfSelectionModal();
  });
}

// Reset Filters for Preços do Dia
window.resetPodFilters = function() {
  const podSearchInput = document.getElementById('podSearchInput');
  const podRegionFilter = document.getElementById('podRegionFilter');
  const podVerifiedFilter = document.getElementById('podVerifiedFilter');
  const podSearchClearBtn = document.getElementById('podSearchClearBtn');
  const podDropdown = document.getElementById('podAutocompleteDropdown');

  if (podSearchInput) podSearchInput.value = '';
  if (podSearchClearBtn) podSearchClearBtn.style.display = 'none';
  if (podRegionFilter) podRegionFilter.value = '';
  if (podVerifiedFilter) podVerifiedFilter.checked = false;
  if (podDropdown) podDropdown.classList.remove('open');
  podCurrentCategory = 'IPH';

  const catPills = document.querySelectorAll('#podCategoryNav .pod-cat-pill');
  catPills.forEach(p => p.classList.toggle('active', p.dataset.category === 'IPH'));

  renderPricesOfTheDay();
};

// Preços do Dia Toolbar Controls Event Listeners (Busca instantânea por modelo)
const podSearchInput = document.getElementById('podSearchInput');
const podSearchClearBtn = document.getElementById('podSearchClearBtn');
const podRegionFilter = document.getElementById('podRegionFilter');
const podVerifiedFilter = document.getElementById('podVerifiedFilter');
const podCategoryNav = document.getElementById('podCategoryNav');
const podAutocompleteDropdown = document.getElementById('podAutocompleteDropdown');

if (podSearchInput) {
  const debouncedPodSearch = debounce((val) => {
    renderPricesOfTheDay();
    if (val.trim().length >= 1) {
      renderPodAutocomplete(val);
    } else if (podAutocompleteDropdown) {
      podAutocompleteDropdown.classList.remove('open');
    }
  }, 120);

  podSearchInput.addEventListener('input', (e) => {
    const val = e.target.value;
    if (podSearchClearBtn) podSearchClearBtn.style.display = val ? 'flex' : 'none';
    debouncedPodSearch(val);
  });

  podSearchInput.addEventListener('focus', () => {
    if (podSearchInput.value.trim()) {
      renderPodAutocomplete(podSearchInput.value);
    }
  });

  podSearchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const dropdown = document.getElementById('podAutocompleteDropdown');
      const firstItem = dropdown ? dropdown.querySelector('.autocomplete-item') : null;
      if (firstItem && dropdown.classList.contains('open')) {
        firstItem.click();
      } else {
        if (dropdown) dropdown.classList.remove('open');
        podSearchInput.blur();
      }
    } else if (e.key === 'Escape') {
      const dropdown = document.getElementById('podAutocompleteDropdown');
      if (dropdown) dropdown.classList.remove('open');
      podSearchInput.blur();
    }
  });
}

if (podSearchClearBtn) {
  podSearchClearBtn.addEventListener('click', () => {
    if (podSearchInput) podSearchInput.value = '';
    podSearchClearBtn.style.display = 'none';
    if (podAutocompleteDropdown) podAutocompleteDropdown.classList.remove('open');
    renderPricesOfTheDay();
  });
}

// Fechar dropdown de sugestões de modelo ao clicar fora
document.addEventListener('click', (e) => {
  if (podAutocompleteDropdown && !e.target.closest('.pod-search-wrap')) {
    podAutocompleteDropdown.classList.remove('open');
  }
});

if (podRegionFilter) {
  podRegionFilter.addEventListener('change', () => {
    renderPricesOfTheDay();
  });
}

if (podVerifiedFilter) {
  podVerifiedFilter.addEventListener('change', () => {
    renderPricesOfTheDay();
  });
}

if (podCategoryNav) {
  podCategoryNav.addEventListener('click', (e) => {
    const btn = e.target.closest('.pod-cat-pill');
    if (!btn) return;
    podCategoryNav.querySelectorAll('.pod-cat-pill').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    podCurrentCategory = btn.dataset.category || 'ALL';
    // Se clicar em uma categoria e houver termo de busca, limpa o campo de busca
    if (podSearchInput && podSearchInput.value) {
      podSearchInput.value = '';
      if (podSearchClearBtn) podSearchClearBtn.style.display = 'none';
      if (podAutocompleteDropdown) podAutocompleteDropdown.classList.remove('open');
    }
    renderPricesOfTheDay();
  });
}

// StoreFront Event Listeners
const sfSearchInput = document.getElementById('sfSearchInput');
const sfSearchClearBtn = document.getElementById('sfSearchClearBtn');
const sfCategoryNav = document.getElementById('sfCategoryNav');

if (sfSearchInput) {
  const debouncedSfSearch = debounce(() => {
    renderStoreFront();
  }, 120);

  sfSearchInput.addEventListener('input', (e) => {
    sfSearchQuery = e.target.value;
    if (sfSearchClearBtn) sfSearchClearBtn.style.display = sfSearchQuery ? 'flex' : 'none';
    // Ao buscar por texto na Loja Física, sincroniza o botão de categoria para TODOS
    if (sfCategoryNav && sfSearchQuery.trim()) {
      sfCategoryNav.querySelectorAll('.cat-pill, .pod-cat-pill').forEach(b => {
        b.classList.toggle('active', b.dataset.sfCategory === 'ALL');
      });
      sfCurrentCategory = 'ALL';
    }
    debouncedSfSearch();
  });

  // Fecha o teclado virtual do celular quando o usuário aperta Enter ou Esc
  sfSearchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === 'Escape') {
      sfSearchInput.blur();
    }
  });
}

if (sfSearchClearBtn) {
  sfSearchClearBtn.addEventListener('click', () => {
    if (sfSearchInput) sfSearchInput.value = '';
    sfSearchQuery = '';
    sfSearchClearBtn.style.display = 'none';
    renderStoreFront();
  });
}

if (sfCategoryNav) {
  sfCategoryNav.addEventListener('click', (e) => {
    const btn = e.target.closest('.cat-pill, .pod-cat-pill');
    if (!btn) return;
    sfCategoryNav.querySelectorAll('.cat-pill, .pod-cat-pill').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    sfCurrentCategory = btn.dataset.sfCategory || 'ALL';
    // Se clicar em uma categoria específica e houver busca ativa, limpa a busca para navegar pela categoria
    if (sfSearchInput && sfSearchQuery) {
      sfSearchInput.value = '';
      sfSearchQuery = '';
      if (sfSearchClearBtn) sfSearchClearBtn.style.display = 'none';
    }
    // Ao alternar categorias, reseta o filtro de cor para todas
    const colFilter = document.getElementById('sfColorFilter');
    if (colFilter) colFilter.value = 'ALL';
    lastColorCategory = '';
    renderStoreFront();
  });
}

// Filtros Dropdown da Vitrine (Capacidade e Cor)
const sfCapacityFilter = document.getElementById('sfCapacityFilter');
const sfColorFilter = document.getElementById('sfColorFilter');

if (sfCapacityFilter) {
  sfCapacityFilter.addEventListener('change', () => {
    renderStoreFront();
  });
}

if (sfColorFilter) {
  sfColorFilter.addEventListener('change', () => {
    renderStoreFront();
  });
}

// Ações do Top Header
window.handleCustoFornecedorClick = function() {
  if (!currentUser) {
    window.location.href = '/login.html';
    return;
  }
  switchView('prices_of_the_day');
};

// Event listeners para o input de busca MOBILE (dentro do card de categorias)
const sfSearchInputMobile = document.getElementById('sfSearchInputMobile');
const sfSearchClearBtnMobile = document.getElementById('sfSearchClearBtnMobile');

if (sfSearchInputMobile) {
  const debouncedSfMobileSearch = debounce(() => {
    renderStoreFront();
  }, 120);

  sfSearchInputMobile.addEventListener('input', (e) => {
    sfSearchQuery = e.target.value;
    if (sfSearchInput) sfSearchInput.value = sfSearchQuery;
    if (sfSearchClearBtnMobile) sfSearchClearBtnMobile.style.display = sfSearchQuery ? 'flex' : 'none';
    if (sfCategoryNav && sfSearchQuery.trim()) {
      sfCategoryNav.querySelectorAll('.pod-cat-pill').forEach(b => {
        b.classList.toggle('active', b.dataset.sfCategory === 'ALL');
      });
      sfCurrentCategory = 'ALL';
    }
    debouncedSfMobileSearch();
  });
  sfSearchInputMobile.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === 'Escape') sfSearchInputMobile.blur();
  });
}

if (sfSearchClearBtnMobile) {
  sfSearchClearBtnMobile.addEventListener('click', () => {
    if (sfSearchInputMobile) sfSearchInputMobile.value = '';
    if (sfSearchInput) sfSearchInput.value = '';
    sfSearchQuery = '';
    sfSearchClearBtnMobile.style.display = 'none';
    if (sfSearchClearBtn) sfSearchClearBtn.style.display = 'none';
    renderStoreFront();
  });
}

// Fechar dropdown de sugestões de modelo do Preços do Dia ao clicar fora
document.addEventListener('click', (e) => {
  const podDropdown = document.getElementById('podAutocompleteDropdown');
  if (podDropdown && !e.target.closest('#viewPricesDay .pod-search-wrap')) {
    podDropdown.classList.remove('open');
  }
});

// Ao clicar em qualquer ponto da barra de busca (inclusive na lupa), foca imediatamente no input
document.querySelectorAll('.pod-search-wrap').forEach(wrap => {
  wrap.addEventListener('click', (e) => {
    if (e.target.closest('.search-clear-btn') || e.target.closest('.autocomplete-dropdown')) return;
    const inp = wrap.querySelector('input');
    if (inp && document.activeElement !== inp) {
      inp.focus();
    }
  });
});

// Initial boot (Loja Física por padrão até verificar autenticação)
async function initializeApp() {
  await checkAuthSession();
  authSessionChecked = true;
  await Promise.all([loadMargins(), loadCardRates()]);
  await restoreCachedCatalog();
  await loadProducts();
}

// Sincronizacao / Auto-refresh periodico a cada 1 minuto (60 segundos)
setInterval(() => {
  checkAuthSession().then(() => loadProducts());
}, 60 * 1000);

// =========================================================================
// GESTÃO DE SESSÃO & PROTEÇÃO ANTI-PIRATARIA
// =========================================================================
async function checkAuthSession() {
  try {
    const res = await fetch('/api/auth/me');
    const tabPricesDay = document.getElementById('tabPricesDay');
    const publicAdminTopBtn = document.getElementById('publicAdminTopBtn');
    const userSessionInfo = document.getElementById('userSessionInfo');
    const userStoreBadge = document.getElementById('userStoreBadge');
    const adminHeaderBtn = document.getElementById('adminHeaderBtn');
    const btnOpenCalculator = document.getElementById('btnOpenCalculator');
    const btnExportSfWhatsapp = document.getElementById('btnExportSfWhatsapp');
    const btnExportAllSfWhatsapp = document.getElementById('btnExportAllSfWhatsapp');

    const btnExportTopHeader = document.getElementById('btnExportTopHeader');
    const mobileDrawerExportBtn = document.getElementById('mobileDrawerExportBtn');
    const mobileDrawerExportAllBtn = document.getElementById('mobileDrawerExportAllBtn');

    if (res.status === 401 || res.status === 403) {
      if (currentUser) {
        allProducts = [];
        catalogRequestId++;
        window.IS_CATALOG_SHIELDED = true;
      }
      currentUser = null;
      updateCatalogPresentation();
      localStorage.removeItem('logged_username');
      window.DFU_ACTIVE = false;
      if (window.PricingCore && typeof window.PricingCore.setDfuActive === 'function') {
        window.PricingCore.setDfuActive(false);
      }
      const tabQuotes = document.getElementById('tabQuotes');
      if (tabQuotes) tabQuotes.style.display = 'none';
      if (tabPricesDay) tabPricesDay.style.display = 'none';
      if (btnOpenCalculator) btnOpenCalculator.style.display = 'none';
      if (btnExportTopHeader) btnExportTopHeader.style.display = 'none';
      if (btnExportSfWhatsapp) btnExportSfWhatsapp.style.display = 'none';
      if (btnExportAllSfWhatsapp) btnExportAllSfWhatsapp.style.display = 'none';
      if (publicAdminTopBtn) publicAdminTopBtn.style.display = 'none';
      if (userSessionInfo) userSessionInfo.style.display = 'none';

      const brandLogoLink = document.getElementById('brandLogoLink');
      if (brandLogoLink) {
        brandLogoLink.href = '/login.html';
        brandLogoLink.title = 'Entrar no Sistema';
      }

      // Sincroniza gaveta mobile: esconde Preços do Dia, Calculadora e Acesso Admin para visitantes
      const mobileDrawerUser = document.getElementById('mobileDrawerUser');
      const mobileDrawerAdminBtn = document.getElementById('mobileDrawerAdminBtn');
      const mobileDrawerPricesDayBtn = document.getElementById('mobileDrawerPricesDayBtn');
      const mobileDrawerCalcBtn = document.getElementById('mobileDrawerCalcBtn');
      const mobileDrawerLogoutBtn = document.getElementById('mobileDrawerLogoutBtn');
      if (mobileDrawerUser) mobileDrawerUser.style.display = 'none';
      if (mobileDrawerAdminBtn) mobileDrawerAdminBtn.style.display = 'none';
      const mobileDrawerQuotesBtn = document.getElementById('mobileDrawerQuotesBtn');
      if (mobileDrawerQuotesBtn) mobileDrawerQuotesBtn.style.display = 'none';
      if (mobileDrawerPricesDayBtn) mobileDrawerPricesDayBtn.style.display = 'none';
      if (mobileDrawerCalcBtn) mobileDrawerCalcBtn.style.display = 'none';
      if (mobileDrawerExportBtn) mobileDrawerExportBtn.style.display = 'none';
      if (mobileDrawerExportAllBtn) mobileDrawerExportAllBtn.style.display = 'none';
      if (mobileDrawerLogoutBtn) mobileDrawerLogoutBtn.style.display = 'none';

      // Garante que o visitante fica exclusivamente na Loja Física
      const viewSwitchNav = document.getElementById('viewSwitchNav');
      if (viewSwitchNav) viewSwitchNav.classList.add('single-tab');
      switchView('storefront');
      refreshCurrentView();
      return;
    }

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const user = await res.json();
    currentUser = user;
    updateCatalogPresentation();
    const username = (user.username || '').toLowerCase();
    localStorage.setItem('logged_username', username);

    // Regra estrita: Cledson nunca entra no DFU. Somente Admin tem DFU (+100).
    if (username === 'cledson') {
      window.DFU_ACTIVE = false;
      if (window.PricingCore && typeof window.PricingCore.setDfuActive === 'function') {
        window.PricingCore.setDfuActive(false);
      }
    } else if (username === 'admin') {
      window.DFU_ACTIVE = true;
      if (window.PricingCore && typeof window.PricingCore.setDfuActive === 'function') {
        window.PricingCore.setDfuActive(true);
      }
    } else {
      window.DFU_ACTIVE = false;
      if (window.PricingCore && typeof window.PricingCore.setDfuActive === 'function') {
        window.PricingCore.setDfuActive(false);
      }
    }
    scheduleUiRefresh();

    const viewSwitchNav = document.getElementById('viewSwitchNav');
    if (viewSwitchNav) viewSwitchNav.classList.remove('single-tab');

    // Usuário autenticado (Lojista ou Admin):
    // - Exibe Preços do Dia
    // - Exibe Calculadora de Taxas
    // - Exibe Exportar Valores (WhatsApp)
    const tabQuotes = document.getElementById('tabQuotes');
    if (tabQuotes) {
      tabQuotes.style.display = 'inline-flex';
    }
    if (tabPricesDay) {
      tabPricesDay.style.display = 'inline-flex';
    }
    if (btnOpenCalculator) {
      btnOpenCalculator.style.display = 'inline-flex';
    }
    if (btnExportTopHeader) {
      btnExportTopHeader.style.display = 'inline-flex';
    }
    if (btnExportSfWhatsapp) {
      btnExportSfWhatsapp.style.display = 'inline-flex';
    }
    if (btnExportAllSfWhatsapp) {
      btnExportAllSfWhatsapp.style.display = 'inline-flex';
    }

    // Registra sessão no WebSocket para controle anti-pirataria
    socket.emit('register_session');

    // Esconde o botão público de login "Painel Admin" e exibe a barra do lojista logado
    if (publicAdminTopBtn) {
      publicAdminTopBtn.style.display = 'none';
    }

    let badgeText = user.storeName || user.username;
    const adminHeaderBtnLabel = document.getElementById('adminHeaderBtnLabel');
    const mobileDrawerAdminBtn = document.getElementById('mobileDrawerAdminBtn');
    const mobileDrawerAdminLabel = document.getElementById('mobileDrawerAdminLabel');
    const mobileDrawerUser = document.getElementById('mobileDrawerUser');
    const mobileDrawerUserBadge = document.getElementById('mobileDrawerUserBadge');
    const mobileDrawerPricesDayBtn = document.getElementById('mobileDrawerPricesDayBtn');
    const mobileDrawerCalcBtn = document.getElementById('mobileDrawerCalcBtn');
    const mobileDrawerLogoutBtn = document.getElementById('mobileDrawerLogoutBtn');

    if (userSessionInfo && userStoreBadge) {
      userSessionInfo.style.display = 'flex';
      if (adminHeaderBtn) adminHeaderBtn.style.display = 'none';
      userStoreBadge.style.display = 'none'; // REMOVIDO A PEDIDO DO USUARIO
    }

    const brandLogoLink = document.getElementById('brandLogoLink');
    if (brandLogoLink) {
      brandLogoLink.href = '/';
      brandLogoLink.title = 'Início';
    }

    // Atualiza drawer mobile logado
    if (mobileDrawerAdminBtn) mobileDrawerAdminBtn.style.display = 'none';
    if (mobileDrawerUser && mobileDrawerUserBadge) {
      mobileDrawerUser.style.display = 'block';
      mobileDrawerUserBadge.style.display = 'none'; // REMOVIDO A PEDIDO DO USUARIO
    }
    const mobileDrawerQuotesBtn = document.getElementById('mobileDrawerQuotesBtn');
    if (mobileDrawerQuotesBtn) mobileDrawerQuotesBtn.style.display = 'flex';
    if (mobileDrawerPricesDayBtn) mobileDrawerPricesDayBtn.style.display = 'flex';
    if (mobileDrawerCalcBtn) mobileDrawerCalcBtn.style.display = 'flex';
    if (mobileDrawerExportBtn) mobileDrawerExportBtn.style.display = 'flex';
    if (mobileDrawerExportAllBtn) mobileDrawerExportAllBtn.style.display = 'flex';
    if (mobileDrawerLogoutBtn) mobileDrawerLogoutBtn.style.display = 'flex';

    // Exibe botão de sincronizar na Loja Física apenas quando logado
    const sfSyncBtn = document.getElementById('btnSyncSfPrices');
    if (sfSyncBtn) sfSyncBtn.style.display = 'none';
    const topSyncBtn = document.getElementById('btnSyncTopHeader');
    if (topSyncBtn) topSyncBtn.style.display = 'none';
    const drawerSyncBtn = document.getElementById('mobileDrawerSyncBtn');
    if (drawerSyncBtn) drawerSyncBtn.style.display = 'none';

    // Se vier do Painel Admin clicando em 'Exportar Valores' (?export=true)
    if (window.location.search.includes('export=true')) {
      setTimeout(() => {
        if (typeof openStorefrontExportModal === 'function') {
          openStorefrontExportModal();
        }
      }, 500);
    }

  } catch (err) {
    console.error('Erro ao verificar sessão do usuário:', err);
  }
}

// Sincronizar preços diretamente pela tela da Loja Física (Desktop, Top Header e Mobile Drawer)
window.triggerStorefrontSyncPrices = async function(btn) {
  const spans = [
    document.getElementById('btnSyncSfPricesText'),
    document.getElementById('btnSyncTopHeaderText'),
    document.getElementById('mobileDrawerSyncText')
  ].filter(Boolean);

  const icons = [
    document.getElementById('sfSyncIconSpin'),
    document.getElementById('topSyncIconSpin')
  ].filter(Boolean);

  const origTexts = spans.map(s => s.textContent);

  if (btn) btn.disabled = true;
  spans.forEach(s => s.textContent = 'Atualizando...');
  icons.forEach(i => i.style.animation = 'spin 0.8s linear infinite');

  try {
    await loadProducts();
    if (catalogStatus === 'ready') {
      spans.forEach(s => s.textContent = `✓ Atualizado (${allProducts.length.toLocaleString('pt-BR')})`);
      if (btn) btn.style.color = 'var(--accent-green)';
    } else {
      spans.forEach(s => s.textContent = 'Erro ao atualizar');
    }
  } catch (err) {
    console.error('Erro ao atualizar preços:', err);
    spans.forEach(s => s.textContent = 'Erro ao atualizar');
  } finally {
    icons.forEach(i => i.style.animation = '');
    setTimeout(() => {
      spans.forEach((s, idx) => s.textContent = origTexts[idx] || 'Atualizar Preços');
      if (btn) {
        btn.disabled = false;
        btn.style.color = '#3b82f6';
      }
    }, 3000);
  }
};

// Monta gaveta mobile dinamicamente APENAS em telas móveis quando o usuário clicar
function ensureMobileDrawerMounted() {
  if (window.innerWidth > 768) return null;
  let drawer = document.getElementById('mobileDrawer');
  let overlay = document.getElementById('mobileDrawerOverlay');
  if (drawer && overlay) return { drawer, overlay };

  overlay = document.createElement('div');
  overlay.className = 'mobile-drawer-overlay';
  overlay.id = 'mobileDrawerOverlay';
  overlay.onclick = window.closeMobileMenu;

  drawer = document.createElement('aside');
  drawer.className = 'mobile-drawer';
  drawer.id = 'mobileDrawer';
  drawer.innerHTML = `
    <div class="mobile-drawer-header">
      <div style="display: flex; align-items: center; gap: 8px;">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
          <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M15.97 6.37c.61-.75 1.04-1.8 1.01-2.85-.92.04-2.02.62-2.67 1.37-.58.66-1.09 1.73-1.02 2.76 1.03.08 2.07-.53 2.68-1.28z"/>
        </svg>
        <span style="font-weight: 800; font-size: 1rem;">Menu</span>
      </div>
      <button class="mobile-drawer-close" onclick="closeMobileMenu()">✕</button>
    </div>
    <div class="mobile-drawer-body">
      <div class="mobile-drawer-user" id="mobileDrawerUser" style="display: none;">
        <span class="mobile-drawer-user-badge" id="mobileDrawerUserBadge">Loja</span>
      </div>
      <div class="mobile-drawer-nav">
        <button class="mobile-drawer-item" id="mobileDrawerStoreFrontBtn" onclick="closeMobileMenu(); switchView('storefront');">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
            <polyline points="9 22 9 12 15 12 15 22"/>
          </svg>
          <span>Loja Física (Preço de Venda)</span>
        </button>
        <button class="mobile-drawer-item" id="mobileDrawerQuotesBtn" onclick="closeMobileMenu(); switchView('quotes');" style="display: none;">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
            <line x1="16" y1="13" x2="8" y2="13"/>
            <line x1="16" y1="17" x2="8" y2="17"/>
            <polyline points="10 9 9 9 8 9"/>
          </svg>
          <span>Orçamentos & Propostas</span>
        </button>
        <button class="mobile-drawer-item" id="mobileDrawerPricesDayBtn" onclick="closeMobileMenu(); switchView('prices_of_the_day');" style="display: none;">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/>
            <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/>
            <path d="M4 22h16"/>
            <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/>
            <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/>
            <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>
          </svg>
          <span>Preços do dia (Custo Fornecedor)</span>
        </button>
        <button class="mobile-drawer-item" id="mobileDrawerExportBtn" onclick="closeMobileMenu(); openStorefrontExportModal();" style="display: none; color: var(--accent-green);">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <rect width="14" height="14" x="8" y="8" rx="2" ry="2"/>
            <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>
          </svg>
          <span>Exportar Selecionados (WhatsApp)</span>
        </button>
        <button class="mobile-drawer-item" id="mobileDrawerExportAllBtn" onclick="closeMobileMenu(); exportAllStorefrontWhatsApp(this);" style="display: none; color: var(--accent-green);">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>
            <rect x="8" y="2" width="8" height="4" rx="1" ry="1"/>
          </svg>
          <span>Exportar Tudo (WhatsApp)</span>
        </button>
        <button class="mobile-drawer-item" id="mobileDrawerSyncBtn" onclick="triggerStorefrontSyncPrices(this)" style="display: none; color: #3b82f6;">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>
          </svg>
          <span id="mobileDrawerSyncText">Atualizar Preços PXT</span>
        </button>
        <button class="mobile-drawer-item" id="mobileDrawerCalcBtn" onclick="closeMobileMenu(); openFreeCalculator();" style="display: none;">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <rect width="16" height="20" x="4" y="2" rx="2"/>
            <line x1="8" x2="16" y1="6" y2="6"/>
            <line x1="16" x2="16" y1="14"/>
            <path d="M16 10h.01"/><path d="M12 10h.01"/><path d="M8 10h.01"/>
            <path d="M12 14h.01"/><path d="M8 14h.01"/>
            <path d="M12 18h.01"/><path d="M8 18h.01"/>
          </svg>
          <span>Calculadora de Taxas</span>
        </button>
        <button class="mobile-drawer-item" id="mobileDrawerThemeBtn" onclick="toggleThemeFromDrawer()">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" id="mobileDrawerThemeIcon">
            <circle cx="12" cy="12" r="4"/>
            <path d="M12 2v2"/><path d="M12 20v2"/>
            <path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/>
            <path d="M2 12h2"/><path d="M20 12h2"/>
            <path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>
          </svg>
          <span id="mobileDrawerThemeLabel">Alternar Modo Claro / Escuro</span>
        </button>
        <button class="mobile-drawer-item logout" id="mobileDrawerLogoutBtn" onclick="handleHeaderLogout()" style="display: none;">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
            <polyline points="16 17 21 12 16 7"/>
            <line x1="21" y1="12" x2="9" y2="12"/>
          </svg>
          <span>Encerrar Sessão</span>
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  document.body.appendChild(drawer);

  // Se o usuário já estiver logado, exibe os itens restritos na gaveta
  if (currentUser) {
    const pBtn = drawer.querySelector('#mobileDrawerPricesDayBtn');
    const cBtn = drawer.querySelector('#mobileDrawerCalcBtn');
    const eBtn = drawer.querySelector('#mobileDrawerExportBtn');
    const lBtn = drawer.querySelector('#mobileDrawerLogoutBtn');
    const aBtn = drawer.querySelector('#mobileDrawerAdminBtn');
    const uBox = drawer.querySelector('#mobileDrawerUser');
    const uBadge = drawer.querySelector('#mobileDrawerUserBadge');
    const aLabel = drawer.querySelector('#mobileDrawerAdminLabel');
    if (pBtn) pBtn.style.display = 'flex';
    if (cBtn) cBtn.style.display = 'flex';
    if (eBtn) eBtn.style.display = 'flex';
    if (lBtn) lBtn.style.display = 'flex';
    if (aBtn) aBtn.style.display = 'flex';
    if (uBox && uBadge) {
      uBox.style.display = 'block';
      uBadge.style.display = 'none'; // REMOVIDO A PEDIDO DO USUARIO
    }
    if (aLabel) {
      aLabel.textContent = currentUser.role === 'admin' ? '👑 Painel Administrador' : '⚙️ Configurar Margens e Loja';
    }
  }

  return { drawer, overlay };
}

// Funções para controle do Menu Hamburger Drawer no Mobile
window.toggleMobileMenu = function() {
  if (window.innerWidth > 768) return; // NUNCA no desktop
  const mounted = ensureMobileDrawerMounted();
  if (!mounted) return;
  const { drawer, overlay } = mounted;
  const willOpen = !drawer.classList.contains('open');
  if (willOpen) {
    drawer.style.setProperty('display', 'flex', 'important');
    overlay.style.setProperty('display', 'block', 'important');
    setTimeout(() => {
      drawer.classList.add('open');
      overlay.classList.add('open');
    }, 10);
  } else {
    window.closeMobileMenu();
  }
};

window.closeMobileMenu = function() {
  const drawer = document.getElementById('mobileDrawer');
  const overlay = document.getElementById('mobileDrawerOverlay');
  if (drawer && overlay) {
    drawer.classList.remove('open');
    overlay.classList.remove('open');
    setTimeout(() => {
      drawer.style.setProperty('display', 'none', 'important');
      overlay.style.setProperty('display', 'none', 'important');
    }, 300);
  }
};

// No desktop, DESTROI qualquer elemento de gaveta do DOM se existir
function destroyDesktopDrawer() {
  if (window.innerWidth > 768) {
    const drawer = document.getElementById('mobileDrawer');
    const overlay = document.getElementById('mobileDrawerOverlay');
    if (drawer) drawer.remove();
    if (overlay) overlay.remove();
  }
}
window.addEventListener('resize', destroyDesktopDrawer);
document.addEventListener('DOMContentLoaded', destroyDesktopDrawer);
destroyDesktopDrawer();

window.toggleThemeFromDrawer = function() {
  const themeBtn = document.getElementById('themeBtn');
  if (themeBtn) {
    themeBtn.click();
  }
};

async function handleHeaderLogout() {
  try {
    localStorage.removeItem('logged_username');
    if (typeof clearCachedCatalog === 'function') {
      await clearCachedCatalog();
    }
    await fetch('/api/auth/logout', { method: 'POST' });
  } finally {
    window.location.href = '/';
  }
}

function getCookie(name) {
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return parts.pop().split(';').shift();
  return null;
}

// Alerta Anti-Pirataria em tempo real se a conta for aberta em outro aparelho
socket.on('session_terminated', async (data) => {
  localStorage.removeItem('logged_username');
  if (typeof clearCachedCatalog === 'function') {
    await clearCachedCatalog();
  }
  alert('⚠️ Acesso Concorrente Detectado:\n\n' + (data.reason || 'Sua conta foi conectada em outro dispositivo ou navegador. O Fornecedor permite apenas 1 tela ativa por assinatura.'));
  window.location.href = '/login.html';
});

// =========================================================================
// MODO CLIENTE & COMPARTILHAMENTO DE CATÁLOGO LIMPO (SEM CUSTOS/FORNECEDORES)
// =========================================================================
let isClientMode = window.location.pathname.includes('/catalogo') || window.location.search.includes('mode=cliente');

function updateCatalogPresentation() {
  const authenticated = Boolean(currentUser);
  const customerView = !authenticated || isClientMode;
  document.body.classList.toggle('session-authenticated', authenticated);
  document.body.classList.toggle('client-mode-active', isClientMode);
  const heading = document.getElementById('catalogHeading');
  const description = document.getElementById('catalogDescription');
  const label = document.getElementById('catalogModeLabel');
  const toggle = document.getElementById('btnClientMode');
  const toggleText = document.getElementById('txtClientModeBtn');
  if (heading) heading.textContent = customerView ? 'Encontre seu próximo Apple.' : 'Seu catálogo de vendas.';
  if (description) description.textContent = customerView
    ? 'Compare modelos, escolha sua cor e simule o parcelamento.'
    : 'Consulte os preços e escolha uma cor para preparar o orçamento.';
  if (label) label.textContent = customerView ? 'CATÁLOGO APPLE' : 'ÁREA DA LOJA';
  if (toggle) {
    toggle.style.display = authenticated ? 'inline-flex' : 'none';
    toggle.setAttribute('aria-pressed', String(isClientMode));
  }
  if (toggleText) toggleText.textContent = isClientMode ? 'Voltar à loja' : 'Modo cliente';
}

function initClientModeCheck() {
  if (isClientMode) {
    switchView('storefront');
  }
  updateCatalogPresentation();
}

window.toggleClientMode = function() {
  if (!currentUser) return;
  isClientMode = !isClientMode;
  updateCatalogPresentation();
  switchView('storefront');
};

window.shareClientCatalogLink = async function() {
  const catalogUrl = `${window.location.origin}/catalogo`;
  const shareData = {
    title: 'Catálogo Oficial - Produtos Apple',
    text: 'Confira nossa lista atualizada de iPhones, Macs e iPads com valores à vista e simulação de parcelamento no cartão:',
    url: catalogUrl
  };

  if (navigator.canShare && navigator.canShare(shareData)) {
    try {
      await navigator.share(shareData);
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
    }
  }

  try {
    await navigator.clipboard.writeText(catalogUrl);
    alert(`✅ Link do Catálogo do Cliente Copiado com Sucesso!\n\n${catalogUrl}\n\nEnvie este link no WhatsApp do seu cliente para ele visualizar a vitrine limpa sem preços de custo.`);
  } catch (err) {
    prompt('Copie o link do catálogo para enviar ao cliente:', catalogUrl);
  }
};

initClientModeCheck();
switchView('storefront');
initializeApp();
