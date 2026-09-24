// MUNDO APPLE BUSCADOR - Frontend Engine (Tempo Real & Filtros Adaptativos)
let allProducts = [];
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

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

let selectedDateMode = 'today';

// 1. Fetch initial dataset from backend API (suporta alternar entre Hoje e Ontem)
async function loadProducts(dateParam) {
  try {
    const target = dateParam || selectedDateMode || 'today';
    const res = await fetch(`/api/products?date=${target}`);
    if (!res.ok) return;
    const json = await res.json();
    if (json.success && Array.isArray(json.data)) {
      allProducts = json.data.filter(p => !isCpoProduct(p) && !isAsIsProduct(p));
      if (totalCountEl) totalCountEl.textContent = allProducts.length;

      // Status Badge e indicador de data ativa
      const badgeText = document.getElementById('connectionText');
      const badgeDot = document.getElementById('connectionDot');
      if (json.isHistorical) {
        if (badgeText) badgeText.textContent = `TABELA DE ONTEM (${json.latestDate})`;
        if (badgeDot) badgeDot.style.backgroundColor = '#f59e0b';
      } else {
        if (badgeText) badgeText.textContent = 'TEMPO REAL ATIVO';
        if (badgeDot) badgeDot.style.backgroundColor = 'var(--accent-green)';
      }

      updateDynamicFilters();
      refreshCurrentView();
    }
  } catch (err) {
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

// Normalizador de busca inteligente (ignora acentos, pontuação e maiúsculas/minúsculas)
function normalizeSearchText(str) {
  if (!str) return '';
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, ' ')
    // Separa letra→número e número→letra: IPHONE17E → iphone 17 e
    .replace(/([a-z])(\d)/g, '$1 $2')
    .replace(/(\d)([a-z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
}

// Verifica se todos os termos digitados na busca estão presentes no produto
function matchSearchTokens(product, tokens) {
  if (!tokens || tokens.length === 0) return true;
  const ram = getMacBookRam(product);
  const rawText = `${product.name || ''} ${product.description || ''} ${product.storage || ''} ${product.color || ''} ${product.region || ''} ${ram} ${ram ? ram + ' RAM' : ''} ${product.supplier?.name || ''}`;
  const normalized = normalizeSearchText(rawText);
  return tokens.every(token => normalized.includes(token));
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

  // Glacier / Glacial (Glacier Ice Blue / Light icy cyan blue)
  if (c.includes('GLACIER') || c.includes('GLACIAL')) return '#a4c6da';

  // Burgundy / Bordo / Bordô / Cabernet / Maroon / Vinho (Deep Wine / Burgundy Red)
  if (c.includes('BURGUNDY') || c.includes('BORDO') || c.includes('CABERNET') || c.includes('MAROON') || c.includes('VINHO')) return '#6b1d2f';

  // Desert / Deserto Titanium
  if (c.includes('DESERT') || c.includes('DESERTO')) return '#c8a882';

  // Natural Titanium / Titânio Natural
  if (c.includes('NATURAL')) return '#9f9a93';

  // Cosmic Orange / Laranja / Orange / Citrus / Coral
  if (c.includes('COSMIC') || c.includes('ORANGE') || c.includes('LARANJ') || c.includes('CITRUS') || c.includes('CORAL')) return '#e06d53';

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
    const matches = tokens.every(tok => normalizedName.includes(tok));
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
  searchInput.addEventListener('input', (e) => {
    const val = e.target.value;
    if (searchClearBtn) searchClearBtn.style.display = val ? 'flex' : 'none';

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
    autocompleteDropdown.classList.remove('open');
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

// 9. Real-Time Socket Event Listeners (Silent Updates)
socket.on('price_changed', (evt) => {
  const index = allProducts.findIndex(p => String(p.id) === String(evt.id));
  if (index >= 0) {
    const prod = allProducts[index];
    prod.price = evt.newPrice;
    allProducts[index] = prod;
    refreshCurrentView();
  }
});

socket.on('product_created', (item) => {
  allProducts.unshift(item);
  totalCountEl.textContent = allProducts.length;
  updateDynamicFilters();
  refreshCurrentView();
});

socket.on('product_updated', (item) => {
  const index = allProducts.findIndex(p => String(p.id) === String(item.id));
  if (index >= 0) {
    allProducts[index] = item;
    refreshCurrentView();
  }
});

socket.on('product_deleted', (evt) => {
  allProducts = allProducts.filter(p => String(p.id) !== String(evt.id));
  totalCountEl.textContent = allProducts.length;
  updateDynamicFilters();
  refreshCurrentView();
});

socket.on('catalog_reloaded', (meta) => {
  if (meta.dollarRate && dollarRateText) dollarRateText.textContent = `R$ ${Number(meta.dollarRate).toFixed(4)}`;
  if (meta.latestDate && dateText) dateText.textContent = meta.latestDate;
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
    text.textContent = 'TEMPO REAL ATIVO';
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

const savedTheme = localStorage.getItem('apple_pxt_theme') || 'dark';
if (savedTheme === 'light') {
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
  let cleaned = name.replace(/\b(SEMI-NOVO|SEMI NOVO|SEMINOVO|USADO|VITRINE|GRADE A\+?|GRADE B|SWAP|SWP|RECONDICIONADO)\b/gi, '')
                    .replace(/\s+/g, ' ')
                    .trim();
  if (!cleaned) return 'Apple';
  return cleaned;
}

// Helper to detect if a product is an Apple Seminovo
function isSeminovoProduct(p) {
  if (!p) return false;
  if (isAsIsProduct(p)) return false;
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
    return Math.min(...offers.map(o => Number(o.price) || 0).filter(p => p > 0));
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
    IPH: 750,
    MCB_AIR: 1000,
    MCB_PRO: 1300,
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

socket.on('margins_updated', (newMargins) => {
  margins = newMargins;
  if (currentView === 'storefront') {
    renderStoreFront();
  }
});

socket.on('card_rates_updated', (newRates) => {
  cardRates = newRates;
});

function getProductRetailPrice(p) {
  if (!p || !p.price) return 0;
  const cost = Number(p.price);
  const nameUpper = (p.name || '').trim().toUpperCase();
  const catUpper = (p.category || '').trim().toUpperCase();
  const isSemi = isSeminovoProduct(p);

  // 1. Exceção de modelo específico se cadastrada no painel admin
  let margin = margins.products ? margins.products[nameUpper] : undefined;

  // 2. Se for Linha iPhone 18 (Lançamento Importante), aplica a margem de R$ 1.100
  if (margin === undefined && (nameUpper.includes('IPHONE 18') || nameUpper.includes('IPH 18'))) {
    margin = (margins.categories && margins.categories.IPH18 !== undefined) ? margins.categories.IPH18 : 1100;
  }

  // 3. Se for Seminovo, aplica a margem de Seminovos (padrão R$ 600)
  if (margin === undefined && isSemi) {
    margin = (margins.categories && margins.categories.SEMINOVOS !== undefined) ? margins.categories.SEMINOVOS : 600;
  }

  // 4. Se não houver margem por produto nem for seminovo, usa a margem da categoria ou acessório específico
  if (margin === undefined && margins.categories) {
    // Acessórios Específicos
    if (nameUpper.includes('FOLIO') || nameUpper.includes('SMART FOLIO')) {
      margin = margins.categories.FOLIO ?? 400;
    } else if (nameUpper.includes('PENCIL')) {
      margin = margins.categories.PENCIL ?? 200;
    } else if (nameUpper.includes('AIRTAG') && (nameUpper.includes('4 PACK') || nameUpper.includes('4-PACK') || nameUpper.includes('4PACK') || nameUpper.includes('PACOTE') || nameUpper.includes('4PK') || nameUpper.includes('4 UN') || nameUpper.includes('4UN'))) {
      margin = margins.categories.AIRTAG_PACK ?? 350;
    } else if (nameUpper.includes('AIRTAG')) {
      margin = margins.categories.AIRTAG_UNIT ?? 100;
    } else if (nameUpper.includes('MAGIC KEY') || nameUpper.includes('MAGIC KEYBOARD') || nameUpper.includes('SMART KEYBOARD') || nameUpper.includes('SMART KEY')) {
      margin = margins.categories.MAGIC_KEY ?? 400;
    } else if (nameUpper.includes('MAGIC MOUSE') || (nameUpper.includes('MOUSE') && (catUpper === 'ACSS' || nameUpper.includes('APPLE')))) {
      margin = margins.categories.MAGIC_MOUSE ?? 430;
    } else if (nameUpper.includes('APPLE TV') || nameUpper.includes('APPLETV') || nameUpper.includes('TV 4K') || nameUpper.includes('TV HD')) {
      margin = margins.categories.APPLE_TV ?? 500;
    } else if (catUpper === 'IPH' || nameUpper.includes('IPHONE')) {
      margin = margins.categories.IPH ?? 750;
    } else if (nameUpper.includes('MACBOOK AIR') || nameUpper.includes('AIR M') || (catUpper === 'MCB' && nameUpper.includes('AIR'))) {
      margin = margins.categories.MCB_AIR ?? 1000;
    } else if (catUpper === 'MCB' || nameUpper.includes('MACBOOK') || nameUpper.includes('MAC MINI') || nameUpper.includes('MAC STUDIO') || nameUpper.includes('MAC PRO')) {
      margin = margins.categories.MCB_PRO ?? 1300;
    } else if (catUpper === 'IPAD' || catUpper === 'IPD' || nameUpper.includes('IPAD')) {
      margin = margins.categories.IPAD ?? 500;
    } else if (catUpper === 'RLG' || nameUpper.includes('WATCH') || nameUpper.includes('SERIES') || nameUpper.includes('ULTRA')) {
      margin = margins.categories.RLG ?? 500;
    } else if (catUpper === 'IMAC' || nameUpper.includes('IMAC')) {
      margin = margins.categories.IMAC ?? 1500;
    } else if (catUpper === 'PODS' || nameUpper.includes('AIRPOD')) {
      margin = margins.categories.PODS ?? 400;
    } else if (catUpper === 'ACSS' || nameUpper.includes('MAGIC')) {
      margin = margins.categories.ACSS ?? 100;
    } else {
      margin = margins.categories.DEFAULT ?? 500;
    }
  }

  return cost + (Number(margin) || 0);
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
  // Se não estiver logado, proibir acesso à visão de preços de fornecedor
  if (viewName !== 'storefront' && !currentUser) {
    viewName = 'storefront';
  }

  currentView = viewName;
  const viewPricesDay = document.getElementById('viewPricesDay');
  const viewStoreFront = document.getElementById('viewStoreFront');
  const tabPricesDay = document.getElementById('tabPricesDay');
  const tabStoreFront = document.getElementById('tabStoreFront');

  if (viewName === 'storefront') {
    if (viewPricesDay) viewPricesDay.style.display = 'none';
    if (viewStoreFront) viewStoreFront.style.display = 'block';
    if (tabPricesDay) tabPricesDay.classList.remove('active');
    if (tabStoreFront) tabStoreFront.classList.add('active');
    renderStoreFront();
  } else {
    if (viewPricesDay) viewPricesDay.style.display = 'block';
    if (viewStoreFront) viewStoreFront.style.display = 'none';
    if (tabPricesDay) tabPricesDay.classList.add('active');
    if (tabStoreFront) tabStoreFront.classList.remove('active');
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

// Renderizador da View Loja Física (Telão - Catálogo para Clientes)
function renderStoreFront() {
  const container = document.getElementById('storefrontGrid');
  const countText = document.getElementById('sfShownCountText');
  if (!container) return;

  const sLower = sfSearchQuery.trim().toLowerCase();
  const searchTokens = normalizeSearchText(sLower).split(' ').filter(Boolean);

  // Filtrar produtos válidos (exclui CPO)
  const filtered = allProducts.filter(p => {
    if (isCpoProduct(p)) return false;
    if (!p.price || p.price <= 0) return false;

    const isSemi = isSeminovoProduct(p);

    // Filtro de Categoria (se houver busca por texto, busca em todo o catalogo)
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

    // Filtro por texto digitado
    if (searchTokens.length > 0) {
      if (!matchSearchTokens(p, searchTokens)) return false;
    }

    return true;
  });

  // Agrupamento por Modelo e Variante
  const modelFamilies = new Map();

  filtered.forEach(p => {
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
        colors: new Map()
      });
    }

    const stGrp = fam.storagesMap.get(variantKey);
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

  // Ordenar famílias de modelos
  const sortedFamilies = Array.from(modelFamilies.values()).sort((a, b) => {
    const rankA = getModelOrderRank(a.rawModelName || a.modelName, a.category);
    const rankB = getModelOrderRank(b.rawModelName || b.modelName, b.category);
    if (rankA !== rankB) return rankA - rankB;
    if (a.isSeminovo !== b.isSeminovo) return a.isSeminovo ? 1 : -1;
    return a.modelName.localeCompare(b.modelName);
  });

  if (countText) {
    countText.textContent = `Mostrando ${sortedFamilies.length} modelos na Loja Física`;
  }

  if (sortedFamilies.length === 0) {
    container.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 60px 20px; color: var(--text-muted);">
        <h3 style="font-size: 1.25rem; color: var(--text-primary); margin-bottom: 8px;">Nenhum produto encontrado na loja com estes filtros.</h3>
        <p style="font-size: 0.9rem;">Tente buscar por outro termo ou selecione a categoria "Todos".</p>
      </div>
    `;
    return;
  }

  window.storefrontCardMap = new Map();
  let html = '';
  sortedFamilies.forEach((fam, famIdx) => {
    const storages = Array.from(fam.storagesMap.values()).sort((a, b) => {
      const rA = getStorageRank(a.storage);
      const rB = getStorageRank(b.storage);
      if (rA !== rB) return rA - rB;
      return (parseInt(a.ram) || 0) - (parseInt(b.ram) || 0);
    });

    const catIcon = getCategoryIcon(fam.rawModelName, fam.category);

    html += `
      <div class="pod-model-section">
        <div class="pod-model-section-left">
          <span class="pod-model-section-icon">${catIcon}</span>
          <h2 class="pod-model-section-title">${fam.modelName}</h2>
        </div>
        ${fam.isSeminovo ? `<span class="pod-badge-seminovo" style="background: rgba(245, 158, 11, 0.15); color: #f59e0b; border: 1px solid rgba(245, 158, 11, 0.35); padding: 3px 9px; border-radius: 6px; font-size: 0.72rem; font-weight: 800;">SEMINOVO</span>` : ''}
      </div>
    `;

    storages.forEach((grp, grpIdx) => {
      const colorsArr = Array.from(grp.colors.values()).map(colObj => {
        const isSemi = grp.isSeminovo;
        const offers = colObj.offers || [];
        const refCost = calculateSupplierReferencePrice(offers, isSemi);
        
        let marginVal = margins.products ? margins.products[grp.rawModel.toUpperCase()] : undefined;
        if (marginVal === undefined && isSemi) {
          marginVal = (margins.categories && margins.categories.SEMINOVOS !== undefined) ? margins.categories.SEMINOVOS : 600;
        }
        if (marginVal === undefined) {
          const dummyProd = { name: grp.rawModel, category: fam.category, price: refCost };
          marginVal = getProductRetailPrice(dummyProd) - refCost;
        }
        const retailPrice = refCost + (Number(marginVal) || 0);

        return {
          color: colObj.color,
          retailPrice: retailPrice,
          ram: colObj.ram
        };
      }).sort((a, b) => a.retailPrice - b.retailPrice);

      const cardKey = `sf_${famIdx}_${grpIdx}`;
      window.storefrontCardMap.set(cardKey, {
        model: grp.model,
        rawModel: grp.rawModel,
        storage: grp.storage,
        ram: grp.ram,
        isSeminovo: grp.isSeminovo,
        colors: colorsArr.map(c => ({ color: c.color, price: c.retailPrice }))
      });

      const colorRowsHtml = colorsArr.map(col => {
        const hex = getAppleColorHex(col.color);

        return `
          <div class="matrix-color-row" style="cursor: pointer;" onclick="openCardSimulator('${encodeURIComponent(grp.model)}', '${encodeURIComponent(grp.storage)}', '${encodeURIComponent(col.color)}', ${col.retailPrice}, '${encodeURIComponent(grp.ram || '')}')" title="Clique para calcular parcelas no cartão">
            <div class="matrix-color-left">
              <span class="matrix-color-dot" style="background-color: ${hex};" title="Cor: ${col.color}"></span>
              <span class="matrix-color-name" title="${col.color}">${col.color}</span>
            </div>
            <div class="matrix-color-right">
              <div class="matrix-cost-group">
                <span class="matrix-cost-label">À VISTA</span>
                <span class="matrix-retail-val">${formatBRL(col.retailPrice)}</span>
              </div>
              <button class="matrix-card-all-btn" style="color: var(--accent-green); border-color: rgba(16, 185, 129, 0.3); background: rgba(16, 185, 129, 0.08); padding: 3px 8px; font-size: 0.68rem;" title="Simular parcelas">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="2" y="5" width="20" height="14" rx="2.5"/>
                  <line x1="2" y1="10" x2="22" y2="10"/>
                </svg>
              </button>
            </div>
          </div>
        `;
      }).join('');

      const firstCol = colorsArr[0];
      const simLowestPrice = firstCol ? firstCol.retailPrice : 0;
      const simLowestColor = firstCol ? firstCol.color : '';

      html += `
        <article class="matrix-card">
          <div class="matrix-card-header">
            <div class="matrix-card-title-wrap">
              <h3 class="matrix-card-title" title="${grp.model}">${grp.model}</h3>
              <div style="display: flex; gap: 6px; align-items: center; margin-top: 3px; flex-wrap: wrap;">
                ${grp.isSeminovo ? `<span style="background: rgba(245, 158, 11, 0.15); color: #f59e0b; border: 1px solid rgba(245, 158, 11, 0.35); padding: 2px 7px; border-radius: 6px; font-size: 0.72rem; font-weight: 800;">SEMINOVO</span>` : ''}
                ${grp.ram ? `<span class="matrix-card-ram-badge" style="background: rgba(0, 113, 227, 0.18); color: #2997ff; border: 1px solid rgba(41, 151, 255, 0.35); padding: 2px 7px; border-radius: 6px; font-size: 0.72rem; font-weight: 700; display: inline-flex; align-items: center; gap: 3px;"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 19v-3"/><path d="M10 19v-3"/><path d="M14 19v-3"/><path d="M18 19v-3"/></svg>${grp.ram} RAM</span>` : ''}
                ${grp.storage ? `<span class="matrix-card-storage">${grp.storage}</span>` : ''}
              </div>
            </div>
            <div style="display: flex; gap: 5px; align-items: center;">

              <button class="matrix-card-all-btn" onclick="openClientShowcaseModal('${cardKey}')" title="Expandir vitrine deste modelo para o cliente">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/>
                  <circle cx="12" cy="12" r="3"/>
                </svg>
                <span>Ver</span>
              </button>
            </div>
          </div>
          <div class="matrix-card-body">
            ${colorRowsHtml}
          </div>
        </article>
      `;
    });
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

  // Pega o menor valor para pré-calcular simulação no cartão
  const lowestPrice = colors.length > 0 ? colors[0].price : 0;
  let installmentsHtml = '';
  if (lowestPrice > 0 && typeof cardRates !== 'undefined' && Array.isArray(cardRates) && cardRates.length > 0) {
    const customRates = [1, 3, 6, 10, 12, 18];
    const filteredRates = cardRates.filter(r => customRates.includes(r.installment));

    installmentsHtml = `
      <div style="margin-top: 20px; padding: 14px; background: rgba(0,0,0,0.15); border: 1px solid var(--border-subtle); border-radius: 14px;">
        <div style="display: flex; align-items: center; gap: 6px; font-size: 0.8rem; font-weight: 800; color: var(--text-secondary); margin-bottom: 10px; text-transform: uppercase;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="2" y="5" width="20" height="14" rx="2.5"/><line x1="2" y1="10" x2="22" y2="10"/></svg>
          Simulação de Parcelamento no Cartão (A partir de ${formatBRL(lowestPrice)})
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
          ${filteredRates.map(r => {
            const total = lowestPrice * (1 + (r.rate / 100));
            const perInstallment = total / r.installment;
            return `
              <div style="padding: 8px 10px; background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: 8px; display: flex; justify-content: space-between; align-items: center;">
                <span style="font-size: 0.8rem; font-weight: 700; color: var(--text-muted);">${r.installment}x</span>
                <span style="font-size: 0.85rem; font-weight: 800; color: var(--text-primary);">${formatBRL(perInstallment)}</span>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }

  bodyEl.innerHTML = `
    <div style="display: flex; flex-direction: column;">
      ${colorsHtml}
      ${installmentsHtml}
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

// Helper robusto para copiar texto no PC e Mobile
async function robustCopyToClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      // Continua para o fallback de textarea caso o browser bloqueie
    }
  }

  // Fallback 100% compatível com PC e Safari
  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.style.position = "fixed";
  textArea.style.left = "-999999px";
  textArea.style.top = "-999999px";
  textArea.setAttribute('readonly', '');
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();
  textArea.setSelectionRange(0, 99999);

  let successful = false;
  try {
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
    if (tokens.every(tok => normalizedName.includes(tok))) {
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

  // Se o modelo selecionado não coincidir com a categoria atual do Preços do Dia, chaveia para a categoria do produto ou IPH
  if (podCurrentCategory !== 'IPH') {
    podCurrentCategory = 'IPH';
    const catPills = document.querySelectorAll('#podCategoryNav .pod-cat-pill');
    catPills.forEach(p => p.classList.toggle('active', p.dataset.category === 'IPH'));
  }

  renderPricesOfTheDay();
};

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
    if (isCpoProduct(p)) return false;

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

    const catIcon = getCategoryIcon(fam.rawModelName, fam.category);

    // Cabeçalho / Divisor de Modelo (Zero Mistura!)
    html += `
      <div class="pod-model-section">
        <div class="pod-model-section-left">
          <span class="pod-model-section-icon">${catIcon}</span>
          <h2 class="pod-model-section-title">${fam.modelName}</h2>
        </div>
        ${fam.isSeminovo ? `<span class="pod-badge-seminovo" style="background: rgba(245, 158, 11, 0.15); color: #f59e0b; border: 1px solid rgba(245, 158, 11, 0.35); padding: 3px 9px; border-radius: 6px; font-size: 0.72rem; font-weight: 800;">SEMINOVO</span>` : ''}
      </div>
    `;

    // Cards individuais de cada capacidade/RAM para este modelo
    storages.forEach((grp, grpIdx) => {
      const colorsArr = Array.from(grp.colors.values()).map(colObj => {
        const isSemi = grp.isSeminovo;
        const offers = colObj.offers || [];
        const refPrice = calculateSupplierReferencePrice(offers, isSemi);
        
        let repOffer = offers[0];
        if (isSemi) {
          repOffer = offers.reduce((prev, curr) => {
            return (Math.abs(curr.price - refPrice) < Math.abs(prev.price - refPrice) ? curr : prev);
          }, offers[0]);
        } else {
          repOffer = offers.reduce((prev, curr) => (curr.price < prev.price ? curr : prev), offers[0]);
        }

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
        colors: colorsArr.map(c => ({ color: c.color, price: c.displayPrice }))
      });

      const colorRowsHtml = colorsArr.map(col => {
        const hex = getAppleColorHex(col.color);
        const rawPhone = (col.whatsappNumber || '').replace(/\D/g, '');
        const orderMsg = buildSupplierWhatsAppMessage(grp.rawModel + (grp.isSeminovo ? ' (Seminovo)' : ''), grp.storage, col.color, col.displayPrice, grp.ram);
        const waLink = rawPhone ? `https://wa.me/${rawPhone}?text=${encodeURIComponent(orderMsg)}` : '#';

        return `
          <div class="matrix-color-row">
            <div class="matrix-color-left" onclick="openAllOffersModal('${encodeURIComponent(grp.rawModel)}', '${encodeURIComponent(grp.storage)}', '${encodeURIComponent(col.color)}', '${encodeURIComponent(grp.ram || '')}', ${grp.isSeminovo})">
              <span class="matrix-color-dot" style="background-color: ${hex};" title="Cor: ${col.color}"></span>
              <span class="matrix-color-name" title="${col.color}">${col.color}</span>
            </div>
            <div class="matrix-color-right">
              <div class="matrix-cost-group" onclick="openAllOffersModal('${encodeURIComponent(grp.rawModel)}', '${encodeURIComponent(grp.storage)}', '${encodeURIComponent(col.color)}', '${encodeURIComponent(grp.ram || '')}', ${grp.isSeminovo})">
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
            <div class="matrix-card-title-wrap">
              <h3 class="matrix-card-title" title="${grp.model}">${grp.model}</h3>
              <div style="display: flex; gap: 6px; align-items: center; margin-top: 3px; flex-wrap: wrap;">
                ${grp.isSeminovo ? `<span style="background: rgba(245, 158, 11, 0.15); color: #f59e0b; border: 1px solid rgba(245, 158, 11, 0.35); padding: 2px 7px; border-radius: 6px; font-size: 0.72rem; font-weight: 800;">SEMINOVO</span>` : ''}
                ${grp.ram ? `<span class="matrix-card-ram-badge" style="background: rgba(0, 113, 227, 0.18); color: #2997ff; border: 1px solid rgba(41, 151, 255, 0.35); padding: 2px 7px; border-radius: 6px; font-size: 0.72rem; font-weight: 700; display: inline-flex; align-items: center; gap: 3px;"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 19v-3"/><path d="M10 19v-3"/><path d="M14 19v-3"/><path d="M18 19v-3"/></svg>${grp.ram} RAM</span>` : ''}
                ${grp.storage ? `<span class="matrix-card-storage">${grp.storage}</span>` : ''}
              </div>
            </div>
            <div style="display: flex; gap: 5px; align-items: center;">
              <button class="matrix-card-all-btn" onclick="copyModelPrices('${cardKey}', this)" title="Copiar custos deste modelo para WhatsApp">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <rect width="14" height="14" x="8" y="8" rx="2" ry="2"/>
                  <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>
                </svg>
                <span>Copiar</span>
              </button>
              <button class="matrix-card-all-btn" onclick="openAllOffersModal('${encodeURIComponent(grp.rawModel)}', '${encodeURIComponent(grp.storage)}', '', '${encodeURIComponent(grp.ram || '')}', ${grp.isSeminovo})" title="Ver todos os fornecedores deste modelo">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>
                  <rect width="8" height="4" x="8" y="2" rx="1" ry="1"/>
                </svg>
                <span>Todas</span>
              </button>
            </div>
          </div>
          <div class="matrix-card-body">
            ${colorRowsHtml}
          </div>
        </article>
      `;
    });
  });

  container.innerHTML = html;
}

// 16. Open Modal with All Offers for a Specific Model + Storage + RAM
window.openAllOffersModal = function(encodedModel, encodedStorage, encodedColor, encodedRam, isSeminovo = false) {
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

  let offers = allProducts.filter(p => {
    if (isCpoProduct(p)) return false;
    const pIsSemi = isSeminovoProduct(p);
    if (isSeminovo ? !pIsSemi : pIsSemi) return false;
    if (cleanModelName(p.name).toUpperCase() !== model.trim().toUpperCase()) return false;
    if (storage && (p.storage || '').trim().toUpperCase() !== storage.trim().toUpperCase()) return false;
    if (selectedRam && getMacBookRam(p) !== selectedRam) return false;
    if (selectedColor && (p.color || '').trim().toUpperCase() !== selectedColor.trim().toUpperCase()) return false;
    return p.price && p.price > 0;
  });

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
  const refPrice = calculateSupplierReferencePrice(offers, isSeminovo);

  const offersHtml = offers.map((p) => {
    const sName = p.supplier?.name || 'Fornecedor';
    const sAvatar = p.supplier?.profileImageUrl || 'https://pub-857bffb3be264baf89938943b80bff74.r2.dev/supplier-profiles/default.png';
    const sAddress = p.supplier?.address || 'São Paulo - SP';
    const isVerified = p.supplier?.isVerified;
    const whatsapp = (p.supplier?.whatsappNumber || '').replace(/\D/g, '');
    const isLowest = !isSeminovo && p.price === lowestPrice;
    const isRef = isSeminovo && (Math.abs(p.price - refPrice) < 30);
    const colHex = getAppleColorHex(p.color);
    const ram = getMacBookRam(p);

    const orderMsg = buildSupplierWhatsAppMessage(cleanModelName(p.name) + (isSeminovo ? ' (Seminovo)' : ''), p.storage, p.color, p.price, ram);
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
          <span class="all-offer-price-val">${formatBRL(p.price)}</span>
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
        <strong>${model} ${storage}</strong> ${isSeminovo ? '<span style="color: #f59e0b; font-weight: 700;">(Seminovo • Preço Médio: ' + formatBRL(refPrice) + ')</span>' : '— Todos os fornecedores cadastrados'}
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
  const baseRate = typeof cardRates.baseRate === 'number' ? cardRates.baseRate : 2.69;
  const parcelRate = cardRates.installmentRates && cardRates.installmentRates[String(installmentCount)] !== undefined 
    ? Number(cardRates.installmentRates[String(installmentCount)]) 
    : (installmentCount * 0.75);
  const totalRate = baseRate + parcelRate;
  
  const balanceToFinance = Math.max(0, cashPrice - (Number(entryAmount) || 0));
  if (balanceToFinance <= 0) {
    return {
      installmentCount,
      totalRate,
      totalAmount: 0,
      monthlyAmount: 0,
      balanceToFinance: 0
    };
  }

  // Modo Fator (Repassar taxa ao cliente para receber valor líquido à vista)
  const rateDecimal = totalRate / 100;
  const totalAmount = rateDecimal < 1 ? (balanceToFinance / (1 - rateDecimal)) : (balanceToFinance * (1 + rateDecimal));
  const monthlyAmount = totalAmount / installmentCount;

  return {
    installmentCount,
    totalRate,
    totalAmount,
    monthlyAmount,
    balanceToFinance
  };
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
  let finalVal = num;
  if (finalVal > cashVal && cashVal > 0) {
    finalVal = cashVal;
  }
  inp.value = formatCurrencyInput(finalVal);
  currentSimData.entryAmount = finalVal;
  recalculateSimulator();
};

window.openCardSimulator = function(encodedModel, encodedStorage, encodedColor, cashPrice, encodedRam) {
  const model = decodeURIComponent(encodedModel || '');
  const storage = decodeURIComponent(encodedStorage || '');
  const color = decodeURIComponent(encodedColor || '');
  const ram = decodeURIComponent(encodedRam || '');

  currentSimData = {
    model: model || 'Calculadora de Taxas',
    storage,
    color,
    cashPrice: Number(cashPrice) || 0,
    ram,
    entryAmount: 0
  };

  const modal = document.getElementById('cardSimulatorModal');
  const body = document.getElementById('cardSimulatorBody');
  if (!modal || !body) return;

  const colHex = getAppleColorHex(color);

  body.innerHTML = `
    <div class="sim-exec-container">
      <!-- Executive Header -->
      <div class="sim-exec-header">
        <div class="sim-exec-title">${currentSimData.model}</div>
        <div class="sim-exec-meta">
          ${storage ? `
            <span class="sim-exec-meta-item">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
              <span>${storage}</span>
            </span>
          ` : ''}
          ${ram ? `
            <span class="sim-exec-meta-item">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 19v-3"/><path d="M10 19v-3"/><path d="M14 19v-3"/><path d="M18 19v-3"/></svg>
              <span>${ram} RAM</span>
            </span>
          ` : ''}
          ${color && color.toUpperCase() !== 'PADRÃO' ? `
            <span class="sim-exec-meta-item">
              <span style="background-color: ${colHex}; width: 10px; height: 10px; border-radius: 50%; display: inline-block; border: 1px solid rgba(255,255,255,0.3);"></span>
              <span>Cor: ${color}</span>
            </span>
          ` : ''}
        </div>
      </div>

      <!-- Integrated Financial Controls -->
      <div class="sim-exec-controls">
        <div class="sim-exec-field">
          <label class="sim-exec-label" for="simCashInput">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/></svg>
            Preço À Vista (PIX)
          </label>
          <div class="sim-exec-input-wrap">
            <span style="font-weight: 800; color: var(--text-muted); margin-right: 6px; font-size: 0.95rem;">R$</span>
            <input type="text" id="simCashInput" class="sim-exec-input" placeholder="0,00" value="${formatCurrencyInput(currentSimData.cashPrice)}" oninput="handleSimCashInput(this)">
          </div>
        </div>

        <div class="sim-exec-field">
          <label class="sim-exec-label" for="simEntryInput">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
            Entrada PIX (Opcional)
          </label>
          <div class="sim-exec-input-wrap">
            <span style="font-weight: 800; color: var(--text-muted); margin-right: 6px; font-size: 0.95rem;">R$</span>
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

window.recalculateSimulator = function() {
  const gridContainer = document.getElementById('simInstallmentsGrid');
  const heroCardVal = document.getElementById('simHeroCardVal');

  if (!gridContainer) return;

  const cashVal = currentSimData.cashPrice || 0;
  const entryVal = currentSimData.entryAmount || 0;
  const balance = Math.max(0, cashVal - entryVal);

  if (heroCardVal) {
    heroCardVal.textContent = formatBRL(balance);
  }

  let rowsHtml = '';
  for (let i = 1; i <= 18; i++) {
    const sim = calculateInstallment(cashVal, entryVal, i);
    const label = i === 1 ? '1x (À vista)' : `${i}x`;

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
  const d = currentSimData;
  const cashVal = d.cashPrice || 0;
  const entryVal = d.entryAmount || 0;
  const balance = Math.max(0, cashVal - entryVal);
  const fmtNum = (val) => formatBRL(val).replace('R$', '').trim();

  let text = `SIMULAÇÃO DE PARCELAMENTO\n\n`;
  text += `Produto: ${d.model} ${d.storage ? `(${d.storage})` : ''}\n`;
  if (d.ram) text += `RAM: ${d.ram}\n`;
  if (d.color) text += `Cor: ${d.color}\n`;
  text += `\n`;
  text += `Valor À Vista (PIX): ${formatBRL(cashVal)}\n`;
  
  if (entryVal > 0) {
    text += `Entrada em PIX: ${formatBRL(entryVal)}\n`;
    text += `Saldo no Cartão: ${formatBRL(balance)}\n`;
  }
  
  text += `\nOPÇÕES DE PARCELAMENTO NO CARTÃO:\n\n`;

  const installmentOptions = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18];
  
  const installmentRows = installmentOptions.map(n => {
    const sim = calculateInstallment(cashVal, entryVal, n);
    return `${n}x de ${formatBRL(sim.monthlyAmount)}`;
  });

  text += installmentRows.join('\n');

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

window.openStorefrontExportModal = function() {
  openExportSelectionModal('SF');
};
window.exportStorefrontPDF = window.openStorefrontExportModal;
window.openPdfSelectionModal = function() {
  openExportSelectionModal('SF');
};

window.openExportSelectionModal = function(scope = 'SF') {
  currentExportScope = scope;
  const modal = document.getElementById('pdfSelectionModal');
  const body = document.getElementById('pdfSelectionListBody');
  const titleEl = document.getElementById('exportModalTitle');
  const subEl = document.getElementById('exportModalSubtitle');
  if (!modal || !body) return;

  if (titleEl) {
    titleEl.textContent = scope === 'POD' 
      ? 'Exportar Preços do Dia (Fornecedores)' 
      : 'Exportar Lista para o WhatsApp';
  }
  if (subEl) {
    subEl.textContent = scope === 'POD'
      ? 'Marque os modelos de fornecedor que deseja incluir no texto'
      : 'Marque os modelos que deseja incluir no texto para enviar aos clientes';
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

      if (podCurrentCategory !== 'ALL') {
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
      if (isCpoProduct(p)) return false;
      if (!p.price || p.price <= 0) return false;
      const isSemi = isSeminovoProduct(p);

      if (sfCurrentCategory !== 'ALL') {
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

  filtered.forEach(p => {
    const isSemi = isSeminovoProduct(p);
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
        variantsMap: new Map()
      });
    }

    const fam = modelFamilies.get(modelKey);
    if (!fam.variantsMap.has(variantKey)) {
      fam.variantsMap.set(variantKey, {
        variantKey: variantKey,
        model: displayName,
        rawModel: baseModelName,
        storage: (p.storage || '').trim(),
        ram: ram,
        isSeminovo: isSemi,
        colors: new Map()
      });
      pdfSelectedVariantsMap.set(variantKey, true);
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
    const rankA = getModelOrderRank(a.rawModelName || a.modelName, a.category);
    const rankB = getModelOrderRank(b.rawModelName || b.modelName, b.category);
    if (rankA !== rankB) return rankA - rankB;
    if (a.isSeminovo !== b.isSeminovo) return a.isSeminovo ? 1 : -1;
    return a.modelName.localeCompare(b.modelName);
  });

  let html = '';
  pdfCachedFamilies.forEach(fam => {
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
      const isChecked = pdfSelectedVariantsMap.get(v.variantKey) === true;
      const labelText = v.ram ? `${v.storage} (${v.ram} RAM)` : (v.storage || 'Padrão');

      html += `
        <label style="display: flex; align-items: center; gap: 8px; background: var(--bg-body); border: 1px solid var(--border-color); padding: 8px 10px; border-radius: 8px; cursor: pointer; font-size: 0.82rem; font-weight: 700; color: var(--text-primary);">
          <input type="checkbox" data-pdf-variant="${v.variantKey}" ${isChecked ? 'checked' : ''} onchange="onPdfVariantCheckboxChange('${v.variantKey}', this.checked)" style="width: 16px; height: 16px; accent-color: var(--accent-green); cursor: pointer;">
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

window.onPdfVariantCheckboxChange = function(variantKey, isChecked) {
  pdfSelectedVariantsMap.set(variantKey, Boolean(isChecked));
  updatePdfSelectedCountBadge();
};

window.toggleAllPdfSelections = function(selectState) {
  const state = Boolean(selectState);
  pdfSelectedVariantsMap.forEach((_, key) => {
    pdfSelectedVariantsMap.set(key, state);
  });
  const checkboxes = document.querySelectorAll('#pdfSelectionListBody input[type="checkbox"]');
  checkboxes.forEach(cb => {
    cb.checked = state;
  });
  updatePdfSelectedCountBadge();
};

function updatePdfSelectedCountBadge() {
  const badge = document.getElementById('pdfSelectedCountBadge');
  let selected = 0;
  pdfSelectedVariantsMap.forEach(val => { if (val === true) selected++; });
  if (badge) badge.textContent = `${selected} selecionados`;
}

// Copia lista completa formatada para WhatsApp com os modelos selecionados
window.copySelectedStorefrontWhatsApp = async function(btn) {
  let selectedCount = 0;
  pdfSelectedVariantsMap.forEach(val => { if (val === true) selectedCount++; });

  if (selectedCount === 0) {
    alert('Por favor, selecione pelo menos 1 modelo para exportar.');
    return;
  }

  const isPod = (currentExportScope === 'POD');
  const blocks = [];

  pdfCachedFamilies.forEach(fam => {
    const variants = Array.from(fam.variantsMap.values()).sort((a, b) => {
      const rA = getStorageRank(a.storage);
      const rB = getStorageRank(b.storage);
      if (rA !== rB) return rA - rB;
      return (parseInt(a.ram) || 0) - (parseInt(b.ram) || 0);
    });

    variants.forEach(grp => {
      if (pdfSelectedVariantsMap.get(grp.variantKey) !== true) return;

      const colorsArr = Array.from(grp.colors.values()).map(colObj => {
        const isSemi = grp.isSeminovo;
        const offers = colObj.offers || [];
        const refCost = calculateSupplierReferencePrice(offers, isSemi);
        
        let finalPrice = refCost;
        if (!isPod) {
          let marginVal = margins.products ? margins.products[grp.rawModel.toUpperCase()] : undefined;
          if (marginVal === undefined && isSemi) {
            marginVal = (margins.categories && margins.categories.SEMINOVOS !== undefined) ? margins.categories.SEMINOVOS : 600;
          }
          if (marginVal === undefined) {
            const dummyProd = { name: grp.rawModel, category: fam.category, price: refCost };
            marginVal = getProductRetailPrice(dummyProd) - refCost;
          }
          finalPrice = refCost + (Number(marginVal) || 0);
        }

        return {
          color: colObj.color,
          retailPrice: finalPrice,
          ram: colObj.ram
        };
      }).sort((a, b) => a.retailPrice - b.retailPrice);

      if (colorsArr.length === 0) return;

      const titleLine = formatModelTitleForCopy(grp.model, grp.storage, grp.ram);
      const modelLines = [titleLine, ''];

      colorsArr.forEach(c => {
        const colorFormatted = formatOnlyFirstLetterUpper(c.color);
        modelLines.push(`${colorFormatted} • ${formatBRL(c.retailPrice)}`);
      });

      blocks.push(modelLines.join('\n'));
    });
  });

  if (blocks.length === 0) {
    alert('Nenhum preço disponível para os modelos selecionados.');
    return;
  }

  const footer = isPod 
    ? '' 
    : ['', 'Valores válidos para pagamento à vista.', 'Consulte opções de parcelamento no cartão.'].join('\n');

  const fullText = (blocks.join('\n\n') + (footer ? '\n' + footer : '')).trim();

  await robustCopyToClipboard(fullText);

  if (btn) {
    const origHtml = btn.innerHTML;
    btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg><span>Copiado com Sucesso!</span>`;
    btn.style.background = '#059669';
    setTimeout(() => {
      btn.innerHTML = origHtml;
      btn.style.background = '';
      closePdfSelectionModal();
    }, 1200);
  } else {
    closePdfSelectionModal();
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
  podSearchInput.addEventListener('input', (e) => {
    const val = e.target.value;
    if (podSearchClearBtn) podSearchClearBtn.style.display = val ? 'flex' : 'none';
    
    // Busca instantânea no grid de preços
    renderPricesOfTheDay();

    // Sugestões de modelos enquanto digita
    if (val.trim().length >= 1) {
      renderPodAutocomplete(val);
    } else if (podAutocompleteDropdown) {
      podAutocompleteDropdown.classList.remove('open');
    }
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
    renderPricesOfTheDay();
  });
}

// StoreFront Event Listeners
const sfSearchInput = document.getElementById('sfSearchInput');
const sfSearchClearBtn = document.getElementById('sfSearchClearBtn');
const sfCategoryNav = document.getElementById('sfCategoryNav');

if (sfSearchInput) {
  sfSearchInput.addEventListener('input', (e) => {
    sfSearchQuery = e.target.value;
    if (sfSearchClearBtn) sfSearchClearBtn.style.display = sfSearchQuery ? 'flex' : 'none';
    renderStoreFront();
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
    const btn = e.target.closest('.pod-cat-pill');
    if (!btn) return;
    sfCategoryNav.querySelectorAll('.pod-cat-pill').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    sfCurrentCategory = btn.dataset.sfCategory || 'ALL';
    renderStoreFront();
  });
}

// Initial boot (Loja Física por padrão até verificar autenticação)
switchView('storefront');
loadProducts();
loadMargins();
loadCardRates();
checkAuthSession();

// =========================================================================
// GESTÃO DE SESSÃO & PROTEÇÃO ANTI-PIRATARIA
// =========================================================================
let currentUser = null;

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

    if (res.status === 401) {
      currentUser = null;
      if (tabPricesDay) tabPricesDay.style.display = 'none';
      if (btnOpenCalculator) btnOpenCalculator.style.display = 'none';
      if (publicAdminTopBtn) publicAdminTopBtn.style.display = 'inline-flex';
      if (userSessionInfo) userSessionInfo.style.display = 'none';

      // Sincroniza gaveta mobile: esconde Preços do Dia e Calculadora para quem não tem login
      const mobileDrawerUser = document.getElementById('mobileDrawerUser');
      const mobileDrawerAdminLabel = document.getElementById('mobileDrawerAdminLabel');
      const mobileDrawerPricesDayBtn = document.getElementById('mobileDrawerPricesDayBtn');
      const mobileDrawerCalcBtn = document.getElementById('mobileDrawerCalcBtn');
      const mobileDrawerLogoutBtn = document.getElementById('mobileDrawerLogoutBtn');
      if (mobileDrawerUser) mobileDrawerUser.style.display = 'none';
      if (mobileDrawerAdminLabel) mobileDrawerAdminLabel.textContent = 'Acessar Painel Admin';
      if (mobileDrawerPricesDayBtn) mobileDrawerPricesDayBtn.style.display = 'none';
      if (mobileDrawerCalcBtn) mobileDrawerCalcBtn.style.display = 'none';
      if (mobileDrawerLogoutBtn) mobileDrawerLogoutBtn.style.display = 'none';

      // Garante que o visitante fica exclusivamente na Loja Física
      switchView('storefront');
      refreshCurrentView();
      return;
    }

    const user = await res.json();
    currentUser = user;

    // Usuário autenticado (Lojista ou Admin):
    // - Exibe Preços do Dia
    // - Exibe Calculadora de Taxas
    if (tabPricesDay) {
      tabPricesDay.style.display = 'inline-flex';
    }
    if (btnOpenCalculator) {
      btnOpenCalculator.style.display = 'inline-flex';
    }

    // Registra sessão no WebSocket para controle anti-pirataria
    const sessionToken = getCookie('fornecedor_session');
    if (sessionToken) {
      socket.emit('register_session', sessionToken);
    }

    // Esconde o botão público de login "Painel Admin" e exibe a barra do lojista logado
    if (publicAdminTopBtn) {
      publicAdminTopBtn.style.display = 'none';
    }

    let badgeText = user.storeName || user.username;
    const adminHeaderBtnLabel = document.getElementById('adminHeaderBtnLabel');
    const mobileDrawerAdminLabel = document.getElementById('mobileDrawerAdminLabel');
    const mobileDrawerUser = document.getElementById('mobileDrawerUser');
    const mobileDrawerUserBadge = document.getElementById('mobileDrawerUserBadge');
    const mobileDrawerPricesDayBtn = document.getElementById('mobileDrawerPricesDayBtn');
    const mobileDrawerCalcBtn = document.getElementById('mobileDrawerCalcBtn');
    const mobileDrawerLogoutBtn = document.getElementById('mobileDrawerLogoutBtn');

    if (user.role === 'admin') {
      badgeText = '👑 ' + badgeText;
      if (adminHeaderBtnLabel) adminHeaderBtnLabel.textContent = 'Painel Admin';
      if (mobileDrawerAdminLabel) mobileDrawerAdminLabel.textContent = '👑 Painel Administrador';
    } else {
      if (adminHeaderBtnLabel) adminHeaderBtnLabel.textContent = 'Configurar Margens';
      if (mobileDrawerAdminLabel) mobileDrawerAdminLabel.textContent = '⚙️ Configurar Margens e Loja';
    }

    if (userSessionInfo && userStoreBadge) {
      userSessionInfo.style.display = 'flex';
      if (adminHeaderBtn) adminHeaderBtn.style.display = 'inline-flex';
      userStoreBadge.textContent = badgeText;
    }

    // Atualiza drawer mobile logado
    if (mobileDrawerUser && mobileDrawerUserBadge) {
      mobileDrawerUser.style.display = 'block';
      mobileDrawerUserBadge.textContent = badgeText;
    }
    if (mobileDrawerPricesDayBtn) mobileDrawerPricesDayBtn.style.display = 'flex';
    if (mobileDrawerCalcBtn) mobileDrawerCalcBtn.style.display = 'flex';
    if (mobileDrawerLogoutBtn) mobileDrawerLogoutBtn.style.display = 'flex';

  } catch (err) {
    console.error('Erro ao verificar sessão do usuário:', err);
  }
}

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
        <a href="/admin" class="mobile-drawer-item" id="mobileDrawerAdminBtn">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
            <circle cx="12" cy="12" r="3"/>
          </svg>
          <span id="mobileDrawerAdminLabel">Acessar Painel Admin</span>
        </a>
        <button class="mobile-drawer-item" id="mobileDrawerStoreFrontBtn" onclick="closeMobileMenu(); switchView('storefront');">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
            <polyline points="9 22 9 12 15 12 15 22"/>
          </svg>
          <span>Loja Física (Preço de Venda)</span>
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
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" id="mobileDrawerThemeIcon">
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
    const lBtn = drawer.querySelector('#mobileDrawerLogoutBtn');
    const uBox = drawer.querySelector('#mobileDrawerUser');
    const uBadge = drawer.querySelector('#mobileDrawerUserBadge');
    const aLabel = drawer.querySelector('#mobileDrawerAdminLabel');
    if (pBtn) pBtn.style.display = 'flex';
    if (cBtn) cBtn.style.display = 'flex';
    if (lBtn) lBtn.style.display = 'flex';
    if (uBox && uBadge) {
      uBox.style.display = 'block';
      uBadge.textContent = currentUser.role === 'admin' ? ('👑 ' + (currentUser.storeName || currentUser.username)) : (currentUser.storeName || currentUser.username);
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
socket.on('session_terminated', (data) => {
  alert('⚠️ Acesso Concorrente Detectado:\n\n' + (data.reason || 'Sua conta foi conectada em outro dispositivo ou navegador. O Fornecedor permite apenas 1 tela ativa por assinatura.'));
  window.location.href = '/login.html';
});

// =========================================================================
// MODO CLIENTE & COMPARTILHAMENTO DE CATÁLOGO LIMPO (SEM CUSTOS/FORNECEDORES)
// =========================================================================
let isClientMode = window.location.pathname.includes('/catalogo') || window.location.search.includes('mode=cliente');

function initClientModeCheck() {
  if (isClientMode) {
    document.body.classList.add('client-mode-active');
    switchView('store_front');
    const txtBtn = document.getElementById('txtClientModeBtn');
    if (txtBtn) txtBtn.textContent = 'Modo Lojista';
  }
}

window.toggleClientMode = function() {
  isClientMode = !isClientMode;
  if (isClientMode) {
    document.body.classList.add('client-mode-active');
    switchView('store_front');
    const txtBtn = document.getElementById('txtClientModeBtn');
    if (txtBtn) txtBtn.textContent = 'Modo Lojista';
  } else {
    document.body.classList.remove('client-mode-active');
    const txtBtn = document.getElementById('txtClientModeBtn');
    if (txtBtn) txtBtn.textContent = 'Modo Cliente';
  }
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


