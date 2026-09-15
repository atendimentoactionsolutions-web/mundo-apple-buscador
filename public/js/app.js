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

// 1. Fetch initial dataset from backend API
async function loadProducts() {
  try {
    const res = await fetch('/api/products');
    if (!res.ok) return;
    const json = await res.json();
    if (json.success && Array.isArray(json.data)) {
      allProducts = json.data.filter(p => !isCpoProduct(p));
      if (dollarRateText) dollarRateText.textContent = `R$ ${Number(json.dollarRate).toFixed(4)}`;
      if (dollarVarText) dollarVarText.textContent = `(${Number(json.dollarVariation) >= 0 ? '+' : ''}${Number(json.dollarVariation).toFixed(2)}%)`;
      if (json.latestDate && dateText) dateText.textContent = json.latestDate;
      if (totalCountEl) totalCountEl.textContent = allProducts.length;

      // Update Toolbar Dollar & Date in Preços do Dia
      const podDollarRate = document.getElementById('podDollarRate');
      const podDateLabel = document.getElementById('podDateLabel');
      if (podDollarRate) {
        const dVal = Number(json.dollarRate || 5.1253).toFixed(4);
        const dVar = Number(json.dollarVariation || 0.57);
        const sign = dVar >= 0 ? '+' : '';
        podDollarRate.innerHTML = `R$ ${dVal} <small id="podDollarVar">${sign}${dVar.toFixed(2)}%</small>`;
      }
      if (podDateLabel && json.latestDate) {
        podDateLabel.textContent = json.latestDate;
      }

      updateDynamicFilters();
      refreshCurrentView();
    }
  } catch (err) {
    console.error('Erro ao carregar produtos:', err);
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

  // Desert / Deserto Titanium
  if (c.includes('DESERT') || c.includes('DESERTO')) return '#c8a882';
  // Natural Titanium / Titânio Natural
  if (c.includes('NATURAL')) return '#9f9a93';
  // Cosmic Orange / Laranja / Orange / Citrus / Coral
  if (c.includes('COSMIC') || c.includes('ORANGE') || c.includes('LARANJ') || c.includes('CITRUS') || c.includes('CORAL')) return '#e06d53';
  // Teal / Sage / Verde-azulado
  if (c.includes('TEAL') || c.includes('SAGE')) return '#3b827e';
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
  if (c.includes('JET BLACK') || (c.includes('SPACE') && c.includes('BLACK'))) return '#1c1c1e';
  // Black / Midnight / Preto / Meia-noite / Charcoal
  if (c.includes('BLACK') || c.includes('PRETO') || c.includes('MEIA-NOITE') || c.includes('MIDNIGHT')) {
    if (c.includes('TITANIUM') || c.includes('TITANIO')) return '#3b3b3d';
    if (c.includes('MIDNIGHT') || c.includes('MEIA')) return '#1e2430';
    return '#222325';
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
  // Alpine Green / Green / Verde
  if (c.includes('VERDE') || c.includes('GREEN') || c.includes('ALPINE')) {
    if (c.includes('ALPINE') || c.includes('ALPINO')) return '#576856';
    if (c.includes('MIDNIGHT') || c.includes('ESCURO')) return '#2c3e35';
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
  const { filtered, lowestMap } = getFilteredProducts();
  shownCountEl.textContent = filtered.length;

  // Active Model Banner update
  if (selectedModel) {
    activeModelBanner.style.display = 'flex';
    activeModelNameText.textContent = selectedModel;
    activeModelCountText.textContent = filtered.length;
  } else {
    activeModelBanner.style.display = 'none';
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
searchInput.addEventListener('input', (e) => {
  const val = e.target.value;
  searchClearBtn.style.display = val ? 'flex' : 'none';

  if (!val.trim()) {
    selectedModel = '';
    searchQuery = '';
    autocompleteDropdown.classList.remove('open');
    updateDynamicFilters();
    render();
    return;
  }

  // Real-time search as user types
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
    const firstItem = autocompleteDropdown.querySelector('.autocomplete-item');
    if (firstItem && autocompleteDropdown.classList.contains('open')) {
      firstItem.click();
    } else {
      autocompleteDropdown.classList.remove('open');
      searchInput.blur();
    }
  } else if (e.key === 'Escape') {
    autocompleteDropdown.classList.remove('open');
    searchInput.blur();
  }
});

searchClearBtn.addEventListener('click', () => {
  clearSelectedModel();
  searchInput.focus();
});

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
categoryNav.addEventListener('click', (e) => {
  const btn = e.target.closest('.category-pill');
  if (!btn) return;
  categoryNav.querySelectorAll('.category-pill').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  currentCategory = btn.dataset.category;
  selectedModel = '';
  searchInput.value = '';
  searchClearBtn.style.display = 'none';
  autocompleteDropdown.classList.remove('open');
  updateDynamicFilters();
  render();
});

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

clearFiltersBtn.addEventListener('click', resetFilters);

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
// 12. VIEW MANAGER: PRODUTOS (DEFAULT) VS PREÇOS DO DIA (AO LADO)
// =========================================================================
let currentView = 'products'; // Produtos primeiro por padrão
let podCurrentCategory = 'ALL';
let podSearchQuery = '';
let podSelectedRegion = '';
let podOnlyVerified = false;

window.switchView = function(viewName) {
  currentView = viewName;
  const viewPricesDay = document.getElementById('viewPricesDay');
  const viewProducts = document.getElementById('viewProducts');
  const tabPricesDay = document.getElementById('tabPricesDay');
  const tabProducts = document.getElementById('tabProducts');

  if (viewName === 'prices_of_the_day') {
    if (viewPricesDay) viewPricesDay.style.display = 'block';
    if (viewProducts) viewProducts.style.display = 'none';
    if (tabPricesDay) tabPricesDay.classList.add('active');
    if (tabProducts) tabProducts.classList.remove('active');
    renderPricesOfTheDay();
  } else {
    if (viewPricesDay) viewPricesDay.style.display = 'none';
    if (viewProducts) viewProducts.style.display = 'block';
    if (tabPricesDay) tabPricesDay.classList.remove('active');
    if (tabProducts) tabProducts.classList.add('active');
    render();
  }
};

function refreshCurrentView() {
  if (currentView === 'prices_of_the_day') {
    renderPricesOfTheDay();
  } else {
    render();
  }
}

// Category Count Badges Updater for Preços do Dia
function updatePricesDayCategoryCounts() {
  let cALL = 0, cIPH = 0, cMCB = 0, cIPAD = 0, cRLG = 0, cPODS = 0, cACSS = 0, cIMAC = 0;

  allProducts.forEach(p => {
    if (!p.price || p.price <= 0) return;
    const cat = (p.category || '').toUpperCase().trim();
    const name = (p.name || '').toUpperCase();
    cALL++;
    if (cat === 'IPH' || name.includes('IPHONE')) cIPH++;
    else if (cat === 'MCB' || name.includes('MACBOOK') || name.includes('MAC MINI') || name.includes('MAC STUDIO') || name.includes('MAC PRO')) cMCB++;
    else if (cat === 'IPAD' || cat === 'IPD' || name.includes('IPAD')) cIPAD++;
    else if (cat === 'RLG' || name.includes('WATCH') || name.includes('SERIES') || name.includes('ULTRA')) cRLG++;
    else if (cat === 'PODS' || name.includes('AIRPOD')) cPODS++;
    else if (cat === 'ACSS' || name.includes('PENCIL') || name.includes('MAGIC') || name.includes('CABO') || name.includes('FONTE') || name.includes('CARREGADOR')) cACSS++;
    else if (cat === 'IMAC' || name.includes('IMAC')) cIMAC++;
  });

  const elAll = document.getElementById('countCatALL');
  const elIph = document.getElementById('countCatIPH');
  const elMcb = document.getElementById('countCatMCB');
  const elIpad = document.getElementById('countCatIPAD');
  const elRlg = document.getElementById('countCatRLG');
  const elPods = document.getElementById('countCatPODS');
  const elAcss = document.getElementById('countCatACSS');
  const elImac = document.getElementById('countCatIMAC');

  if (elAll) elAll.textContent = cALL;
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

  // 2. MacBooks & Macs
  if (m.includes('MACBOOK PRO 16')) return 1000;
  if (m.includes('MACBOOK PRO 14')) return 1010;
  if (m.includes('MACBOOK PRO')) return 1020;
  if (m.includes('MACBOOK AIR 15')) return 1030;
  if (m.includes('MACBOOK AIR 13')) return 1040;
  if (m.includes('MACBOOK AIR')) return 1050;
  if (m.includes('MACBOOK')) return 1060;
  if (m.includes('MAC MINI')) return 1070;
  if (m.includes('MAC STUDIO')) return 1080;
  if (m.includes('IMAC')) return 1090;
  if (m.includes('MAC')) return 1100;

  // 3. iPads
  if (m.includes('IPAD PRO 13')) return 2000;
  if (m.includes('IPAD PRO 11')) return 2010;
  if (m.includes('IPAD PRO')) return 2020;
  if (m.includes('IPAD AIR 13')) return 2030;
  if (m.includes('IPAD AIR 11')) return 2040;
  if (m.includes('IPAD AIR')) return 2050;
  if (m.includes('IPAD MINI')) return 2060;
  if (m.includes('IPAD 10') || m.includes('IPAD 11')) return 2070;
  if (m.includes('IPAD 9')) return 2080;
  if (m.includes('IPAD')) return 2090;

  // 4. Apple Watches
  if (m.includes('ULTRA 2') || m.includes('ULTRA 3')) return 3000;
  if (m.includes('ULTRA')) return 3010;
  if (m.includes('SERIES 10') || m.includes('SERIE 10') || m.includes('S10')) return 3020;
  if (m.includes('SERIES 9') || m.includes('SERIE 9') || m.includes('S9')) return 3030;
  if (m.includes('SERIES 8') || m.includes('SERIE 8') || m.includes('S8')) return 3040;
  if (m.includes('WATCH SE')) return 3050;
  if (m.includes('WATCH')) return 3060;

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

  // Se o modelo selecionado não coincidir com a categoria atual do Preços do Dia, reseta para ALL
  if (podCurrentCategory !== 'ALL') {
    podCurrentCategory = 'ALL';
    const catPills = document.querySelectorAll('#podCategoryNav .pod-cat-pill');
    catPills.forEach(p => p.classList.toggle('active', p.dataset.category === 'ALL'));
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

    // Category filter
    if (podCurrentCategory !== 'ALL') {
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

    const modelKey = (p.name || 'Apple').trim().toUpperCase();
    const ram = getMacBookRam(p);
    const storageKey = (p.storage || 'PADRÃO').trim().toUpperCase();
    // Chave única para separar variantes (MacBooks separam por RAM e SSD para nunca misturar)
    const variantKey = ram ? `${storageKey}__${ram}` : storageKey;

    if (!modelFamilies.has(modelKey)) {
      modelFamilies.set(modelKey, {
        modelName: (p.name || 'Apple').trim(),
        category: p.category,
        storagesMap: new Map()
      });
    }

    const fam = modelFamilies.get(modelKey);
    if (!fam.storagesMap.has(variantKey)) {
      fam.storagesMap.set(variantKey, {
        model: fam.modelName,
        storage: (p.storage || '').trim(),
        ram: ram,
        colors: new Map(),
        allOffers: []
      });
    }

    const stGrp = fam.storagesMap.get(variantKey);
    stGrp.allOffers.push(p);

    const colorName = (p.color || 'Padrão').trim();
    const colorKey = colorName.toUpperCase();
    const curColor = stGrp.colors.get(colorKey);

    if (!curColor || p.price < curColor.minPrice) {
      stGrp.colors.set(colorKey, {
        color: colorName,
        minPrice: p.price,
        bestSupplier: p.supplier?.name || 'Fornecedor',
        whatsappNumber: p.supplier?.whatsappNumber || '',
        isVerified: p.supplier?.isVerified,
        address: p.supplier?.address || '',
        ram: ram,
        count: (curColor ? curColor.count : 0) + 1
      });
    } else {
      curColor.count++;
    }
  });

  // Ordena as famílias de modelos pela hierarquia oficial Apple
  const sortedFamilies = Array.from(modelFamilies.values()).sort((a, b) => {
    const rankA = getModelOrderRank(a.modelName, a.category);
    const rankB = getModelOrderRank(b.modelName, b.category);
    if (rankA !== rankB) return rankA - rankB;
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
  let html = '';
  sortedFamilies.forEach(fam => {
    // Ordena as capacidades do modelo em ordem lógica (128GB, 256GB, 512GB, 1TB, etc)
    const storages = Array.from(fam.storagesMap.values()).sort((a, b) => {
      const rA = getStorageRank(a.storage);
      const rB = getStorageRank(b.storage);
      if (rA !== rB) return rA - rB;
      return (parseInt(a.ram) || 0) - (parseInt(b.ram) || 0);
    });

    const catIcon = getCategoryIcon(fam.modelName, fam.category);
    const storagesCount = storages.length;

    // Cabeçalho / Divisor de Modelo (Zero Mistura!)
    html += `
      <div class="pod-model-section">
        <div class="pod-model-section-left">
          <span class="pod-model-section-icon">${catIcon}</span>
          <h2 class="pod-model-section-title">${fam.modelName}</h2>
        </div>
        <span class="pod-model-section-badge">${storagesCount} ${storagesCount === 1 ? 'configuração disponível' : 'configurações disponíveis'}</span>
      </div>
    `;

    // Cards individuais de cada capacidade/RAM para este modelo
    storages.forEach(grp => {
      const colorsArr = Array.from(grp.colors.values()).sort((a, b) => a.minPrice - b.minPrice);

      const colorRowsHtml = colorsArr.map(col => {
        const hex = getAppleColorHex(col.color);
        const rawPhone = (col.whatsappNumber || '').replace(/\D/g, '');
        const orderMsg = buildSupplierWhatsAppMessage(grp.model, grp.storage, col.color, col.minPrice, grp.ram);
        const waLink = rawPhone ? `https://wa.me/${rawPhone}?text=${encodeURIComponent(orderMsg)}` : '#';

        return `
          <div class="matrix-color-row">
            <div class="matrix-color-left" onclick="openAllOffersModal('${encodeURIComponent(grp.model)}', '${encodeURIComponent(grp.storage)}', '${encodeURIComponent(col.color)}', '${encodeURIComponent(grp.ram || '')}')">
              <span class="matrix-color-dot" style="background-color: ${hex};" title="Cor: ${col.color}"></span>
              <span class="matrix-color-name" title="${col.color}">${col.color}</span>
            </div>
            <div class="matrix-color-right">
              <div class="matrix-cost-group" onclick="openAllOffersModal('${encodeURIComponent(grp.model)}', '${encodeURIComponent(grp.storage)}', '${encodeURIComponent(col.color)}', '${encodeURIComponent(grp.ram || '')}')">
                <span class="matrix-cost-label">CUSTO</span>
                <span class="matrix-cost-val">${formatBRL(col.minPrice)}</span>
              </div>
              <a class="matrix-wa-btn" href="${waLink}" target="_blank" rel="noopener noreferrer" title="Chamar ${col.bestSupplier} no WhatsApp (${formatBRL(col.minPrice)})">
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
                ${grp.ram ? `<span class="matrix-card-ram-badge" style="background: rgba(0, 113, 227, 0.18); color: #2997ff; border: 1px solid rgba(41, 151, 255, 0.35); padding: 2px 7px; border-radius: 6px; font-size: 0.72rem; font-weight: 700; display: inline-flex; align-items: center; gap: 3px;"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 19v-3"/><path d="M10 19v-3"/><path d="M14 19v-3"/><path d="M18 19v-3"/></svg>${grp.ram} RAM</span>` : ''}
                ${grp.storage ? `<span class="matrix-card-storage">${grp.storage}</span>` : ''}
              </div>
            </div>
            <button class="matrix-card-all-btn" onclick="openAllOffersModal('${encodeURIComponent(grp.model)}', '${encodeURIComponent(grp.storage)}', '', '${encodeURIComponent(grp.ram || '')}')" title="Ver todos os fornecedores deste modelo">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>
                <rect width="8" height="4" x="8" y="2" rx="1" ry="1"/>
              </svg>
              <span>Todas</span>
            </button>
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
window.openAllOffersModal = function(encodedModel, encodedStorage, encodedColor, encodedRam) {
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
  title.textContent = `${model}${ramTitlePart}${storageTitlePart}`;

  let offers = allProducts.filter(p => {
    if (isCpoProduct(p)) return false;
    if ((p.name || '').trim().toUpperCase() !== model.trim().toUpperCase()) return false;
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

  const offersHtml = offers.map((p) => {
    const sName = p.supplier?.name || 'Fornecedor';
    const sAvatar = p.supplier?.profileImageUrl || 'https://pub-857bffb3be264baf89938943b80bff74.r2.dev/supplier-profiles/default.png';
    const sAddress = p.supplier?.address || 'São Paulo - SP';
    const isVerified = p.supplier?.isVerified;
    const whatsapp = (p.supplier?.whatsappNumber || '').replace(/\D/g, '');
    const isLowest = p.price === lowestPrice;
    const colHex = getAppleColorHex(p.color);
    const ram = getMacBookRam(p);

    const orderMsg = buildSupplierWhatsAppMessage(p.name, p.storage, p.color, p.price, ram);
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
        <strong>${model} ${storage}</strong> — Todos os fornecedores cadastrados
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

// 17. Export Preços do Dia Summary to WhatsApp
window.exportPricesDayTable = function() {
  const groupsMap = new Map();
  allProducts.forEach(p => {
    if (!p.price || p.price <= 0) return;
    const key = `${p.name} ${p.storage || ''}`.trim();
    const cur = groupsMap.get(key);
    if (!cur || p.price < cur.minPrice) {
      groupsMap.set(key, { name: key, minPrice: p.price, supplier: p.supplier?.name || 'Fornecedor' });
    }
  });

  const sorted = Array.from(groupsMap.values()).slice(0, 30);
  let text = `*TABELA DE PREÇOS DO DIA — FORNECEDOR*\n`;
  text += `Data: ${new Date().toLocaleDateString('pt-BR')}\n`;
  text += `----------------------------------------\n`;
  sorted.forEach(item => {
    text += `📱 *${item.name}*: ${formatBRL(item.minPrice)} (${item.supplier})\n`;
  });
  text += `----------------------------------------\n`;
  text += `Consulte mais modelos em nosso painel oficial!`;

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => {
      alert('Resumo de preços copiado com sucesso para a área de transferência! Cole no WhatsApp.');
    }).catch(() => {
      prompt('Copie o texto abaixo para o WhatsApp:', text);
    });
  } else {
    prompt('Copie o texto abaixo para o WhatsApp:', text);
  }
};

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
  podCurrentCategory = 'ALL';

  const catPills = document.querySelectorAll('#podCategoryNav .pod-cat-pill');
  catPills.forEach(p => p.classList.toggle('active', p.dataset.category === 'ALL'));

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

// Initial boot (Produtos por padrão)
switchView('products');
loadProducts();
checkAuthSession();

// =========================================================================
// GESTÃO DE SESSÃO & PROTEÇÃO ANTI-PIRATARIA
// =========================================================================
let currentUser = null;

async function checkAuthSession() {
  try {
    const res = await fetch('/api/auth/me');
    if (res.status === 401) {
      return; // sem login, continua sem badge
    }
    const user = await res.json();
    currentUser = user;

    // Registra sessão no WebSocket para controle anti-pirataria
    const sessionToken = getCookie('fornecedor_session');
    if (sessionToken) {
      socket.emit('register_session', sessionToken);
    }

    // Exibe identificação no cabeçalho
    const userSessionInfo = document.getElementById('userSessionInfo');
    const userStoreBadge = document.getElementById('userStoreBadge');
    const adminHeaderBtn = document.getElementById('adminHeaderBtn');

    if (userSessionInfo && userStoreBadge) {
      userSessionInfo.style.display = 'flex';
      let badgeText = user.storeName || user.username;
      if (user.role === 'admin') {
        badgeText = '👑 ' + badgeText;
        if (adminHeaderBtn) adminHeaderBtn.style.display = 'inline-flex';
      }
      userStoreBadge.textContent = badgeText;
    }
  } catch (err) {
    console.error('Erro ao verificar sessão do usuário:', err);
  }
}

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


