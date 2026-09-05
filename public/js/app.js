// MUNDO APPLE BUSCADOR - Frontend Engine (Tempo Real & Filtros Adaptativos)
let allProducts = [];
let currentCategory = 'ALL';
let selectedModel = ''; // Isolated model filter (e.g. "IPHONE 17 PRO MAX")
let searchQuery = '';
let selectedStorage = '';
let selectedColor = '';
let selectedSupplier = '';
let sortMode = 'price_asc';
let onlyVerified = false;

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
const colorFilter = document.getElementById('colorFilter');
const supplierFilter = document.getElementById('supplierFilter');
const sortFilter = document.getElementById('sortFilter');
const verifiedOnly = document.getElementById('verifiedOnly');
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

// 1. Fetch initial product data
async function loadProducts() {
  try {
    const res = await fetch('/api/products');
    const json = await res.json();
    if (json.success && Array.isArray(json.data)) {
      allProducts = json.data;
      if (dollarRateText) dollarRateText.textContent = `R$ ${Number(json.dollarRate).toFixed(4)}`;
      if (dollarVarText) dollarVarText.textContent = `(${Number(json.dollarVariation) >= 0 ? '+' : ''}${Number(json.dollarVariation).toFixed(2)}%)`;
      if (json.latestDate && dateText) dateText.textContent = json.latestDate;
      if (totalCountEl) totalCountEl.textContent = allProducts.length;

      updateDynamicFilters();
      render();
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
  // Extract available Colors from the pool
  const colorsMap = new Map();
  // Extract available Suppliers from the pool
  const suppliersMap = new Map();

  pool.forEach(p => {
    if (p.storage) {
      const s = p.storage.trim().toUpperCase();
      capacitiesMap.set(s, (capacitiesMap.get(s) || 0) + 1);
    }
    if (p.color) {
      const c = p.color.trim().toUpperCase();
      // If a storage is already selected, count colors for that storage
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

  storageFilter.innerHTML = '<option value="">Capacidade (Todas)</option>';
  availableStorages.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s;
    opt.textContent = `${s} (${capacitiesMap.get(s)})`;
    if (s === selectedStorage) opt.selected = true;
    storageFilter.appendChild(opt);
  });

  // If previous selectedStorage doesn't exist in new model, reset it
  if (selectedStorage && !capacitiesMap.has(selectedStorage)) {
    selectedStorage = '';
    storageFilter.value = '';
  }

  // Update Colors Dropdown
  const sortedColors = Array.from(colorsMap.entries()).sort((a, b) => b[1] - a[1]);
  colorFilter.innerHTML = '<option value="">Cor (Todas as Cores)</option>';
  sortedColors.forEach(([c, count]) => {
    const opt = document.createElement('option');
    opt.value = c;
    opt.textContent = `${c} (${count})`;
    if (c === selectedColor) opt.selected = true;
    colorFilter.appendChild(opt);
  });

  // If previous selectedColor doesn't exist in new model, reset it
  if (selectedColor && !colorsMap.has(selectedColor)) {
    selectedColor = '';
    colorFilter.value = '';
  }

  // Update Suppliers Dropdown
  const sortedSuppliers = Array.from(suppliersMap.keys()).sort();
  supplierFilter.innerHTML = '<option value="">Fornecedor (Todos)</option>';
  sortedSuppliers.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s;
    opt.textContent = `${s} (${suppliersMap.get(s)})`;
    if (s === selectedSupplier) opt.selected = true;
    supplierFilter.appendChild(opt);
  });

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
  searchInput.value = '';
  searchClearBtn.style.display = 'none';
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
      const name = (p.name || '').toLowerCase();
      const desc = (p.description || '').toLowerCase();
      const supp = (p.supplier?.name || '').toLowerCase();
      const stor = (p.storage || '').toLowerCase();
      const color = (p.color || '').toLowerCase();
      const combined = `${name} ${desc} ${supp} ${stor} ${color}`;
      if (!combined.includes(sLower)) return false;
    }

    // Storage filter
    if (selectedStorage) {
      const stor = (p.storage || '').toUpperCase();
      if (!stor.includes(selectedStorage)) return false;
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

    // Verified only
    if (onlyVerified) {
      if (!p.supplier?.isVerified) return false;
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

// Apple Official Colors Hex Palette Helper
function getAppleColorHex(colorName) {
  if (!colorName) return '#999999';
  const c = colorName.trim().toUpperCase();

  // Desert / Deserto Titanium
  if (c.includes('DESERT') || c.includes('DESERTO')) return '#c8a882';
  // Natural Titanium / Titânio Natural
  if (c.includes('NATURAL')) return '#9f9a93';
  // Black Titanium / Preto Espacial / Space Black / Meia-noite / Midnight
  if (c.includes('BLACK') || c.includes('PRETO') || c.includes('MEIA-NOITE') || c.includes('MIDNIGHT') || c.includes('ESCURO')) {
    if (c.includes('TITANIUM') || c.includes('TITANIO')) return '#3b3b3d';
    if (c.includes('SPACE') || c.includes('ESPACIAL')) return '#2e2e30';
    if (c.includes('MIDNIGHT') || c.includes('MEIA')) return '#1e2430';
    return '#222325';
  }
  // Space Gray / Grafite / Cinza
  if (c.includes('GRAFITE') || c.includes('GRAPHITE') || c.includes('CINZA') || c.includes('GRAY') || c.includes('GREY')) {
    return '#535150';
  }
  // White Titanium / White / Branco / Silver / Prata / Prateado / Starlight / Estelar
  if (c.includes('WHITE') || c.includes('BRANC')) {
    if (c.includes('TITANIUM') || c.includes('TITANIO')) return '#ebeae6';
    return '#f5f5f7';
  }
  if (c.includes('STARLIGHT') || c.includes('ESTELAR')) return '#f0ece3';
  if (c.includes('SILVER') || c.includes('PRATA') || c.includes('PRATEADO')) return '#e3e4e6';
  // Ultramarine / Ultramarino
  if (c.includes('ULTRAMARIN')) return '#3f51b5';
  // Deep Blue / Mist Blue / Blue / Azul
  if (c.includes('BLUE') || c.includes('AZUL')) {
    if (c.includes('DEEP') || c.includes('ESCURO') || c.includes('SIERRA')) return '#24374b';
    if (c.includes('MIST') || c.includes('PACIFIC') || c.includes('PACIFICO')) return '#395b64';
    if (c.includes('LIGHT') || c.includes('CLARO') || c.includes('CEU')) return '#a4c2d7';
    if (c.includes('TITANIUM') || c.includes('TITANIO')) return '#394653';
    return '#496d8e';
  }
  // Pink / Rosa / Rose / Dourado / Gold
  if (c.includes('PINK') || c.includes('ROSA') || c.includes('ROSE')) {
    if (c.includes('GOLD') || c.includes('OURO')) return '#e8bfb5';
    return '#f7c5cc';
  }
  if (c.includes('GOLD') || c.includes('DOURAD') || c.includes('OURO')) return '#fae7cf';
  // Teal / Verde / Green / Verde-acinzentado / Alpine Green
  if (c.includes('TEAL')) return '#88b5a5';
  if (c.includes('VERDE') || c.includes('GREEN')) {
    if (c.includes('ALPINE') || c.includes('ALPINO')) return '#576856';
    if (c.includes('MIDNIGHT') || c.includes('ESCURO')) return '#2c3e35';
    return '#aee1cd';
  }
  // Purple / Roxo / Violeta / Deep Purple / Lilas
  if (c.includes('PURPLE') || c.includes('ROXO') || c.includes('VIOLET') || c.includes('LILAS')) {
    if (c.includes('DEEP') || c.includes('ESCURO')) return '#433447';
    return '#d1c7df';
  }
  // Yellow / Amarelo
  if (c.includes('YELLOW') || c.includes('AMAREL')) return '#f9e784';
  // Orange / Laranja / Coral
  if (c.includes('ORANGE') || c.includes('LARANJ') || c.includes('CORAL')) return '#ff7d59';
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
      const combined = `${p.name || ''} ${p.description || ''}`.toLowerCase();
      if (!combined.includes(searchQuery.trim().toLowerCase())) return false;
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
    const orderText = encodeURIComponent(
      `Olá! Vi no *Mundo Apple Buscador* que você tem o menor preço no *${modelDisplayName}${storageDisplayName}* na cor *${item.color}* por *${formatBRL(item.minPrice)}*. Tem pronta entrega hoje?`
    );
    const waLink = rawPhone ? `https://wa.me/${rawPhone}?text=${orderText}` : '#';

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
          🏆 Menor: <strong>${item.bestSupplier}</strong>
          ${item.isVerified ? `
            <svg class="verified-icon" width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
            </svg>
          ` : ''}
        </div>

        <div class="color-box-actions-row">
          <a class="color-box-whatsapp-btn" href="${waLink}" target="_blank" rel="noopener noreferrer" title="Chamar o fornecedor ${item.bestSupplier} no WhatsApp">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
              <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981z"/>
            </svg>
            <span>WhatsApp</span>
          </a>
          <button class="color-box-filter-btn" onclick="selectColorFromTopic('${item.color.replace(/'/g, "\\'")}')" title="Filtrar produtos desta cor abaixo">
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
            <span>🎨 Menores Preços por Cor:</span>
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

  // Render Tópico de Melhores Preços por Cor
  renderColorPricesTopic();

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
    const orderText = encodeURIComponent(
      `Olá! Vi no *Mundo Apple Buscador* o produto *${p.name} ${p.storage || ''} ${p.color || ''}* listado hoje por *${formatBRL(p.price)}*. Ainda tem pronta entrega?`
    );
    const waLink = whatsapp ? `https://wa.me/${whatsapp}?text=${orderText}` : '#';

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
          <button class="history-btn" title="Ver Histórico de Preços" onclick="openPriceHistory('${p.id}', '${p.name.replace(/'/g, "\\'")}')">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
            </svg>
          </button>
        </div>
      </article>
    `;
  }).join('');

  productsGrid.innerHTML = html;
}

// 7. AUTOCOMPLETE SEARCH LOGIC
function renderAutocomplete(term) {
  const t = term.trim().toLowerCase();
  
  // Extract all matching unique models
  const modelCounts = new Map();
  allProducts.forEach(p => {
    // Check category filter
    if (currentCategory !== 'ALL') {
      const pCat = (p.category || '').toUpperCase();
      if (currentCategory === 'IPAD' && (pCat !== 'IPAD' && pCat !== 'IPD')) return;
      if (currentCategory !== 'IPAD' && pCat !== currentCategory) return;
    }

    const name = (p.name || '').trim();
    if (!name) return;

    if (!t || name.toLowerCase().includes(t)) {
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
      <div class="autocomplete-item-left">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--accent-lime);">
          <rect width="14" height="20" x="5" y="2" rx="2" ry="2"/>
          <path d="M12 18h.01"/>
        </svg>
        <span class="autocomplete-item-name">${mName}</span>
      </div>
      <span class="autocomplete-item-count">${count} opções</span>
    </div>
  `).join('');

  autocompleteDropdown.innerHTML = `
    <div class="autocomplete-section-title">Modelos Disponíveis (Clique para selecionar)</div>
    ${itemsHtml}
  `;
  autocompleteDropdown.classList.add('open');
}

// Search input events
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

  renderAutocomplete(val);
});

searchInput.addEventListener('focus', () => {
  renderAutocomplete(searchInput.value);
});

searchClearBtn.addEventListener('click', () => {
  clearSelectedModel();
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
  selectedColor = '';
  selectedSupplier = '';
  sortMode = 'price_asc';
  onlyVerified = false;

  searchInput.value = '';
  searchClearBtn.style.display = 'none';
  autocompleteDropdown.classList.remove('open');
  storageFilter.value = '';
  colorFilter.value = '';
  supplierFilter.value = '';
  sortFilter.value = 'price_asc';
  verifiedOnly.checked = false;

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
    render();
  }
});

socket.on('product_created', (item) => {
  allProducts.unshift(item);
  totalCountEl.textContent = allProducts.length;
  updateDynamicFilters();
  render();
});

socket.on('product_updated', (item) => {
  const index = allProducts.findIndex(p => String(p.id) === String(item.id));
  if (index >= 0) {
    allProducts[index] = item;
    render();
  }
});

socket.on('product_deleted', (evt) => {
  allProducts = allProducts.filter(p => String(p.id) !== String(evt.id));
  totalCountEl.textContent = allProducts.length;
  updateDynamicFilters();
  render();
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

storageFilter.addEventListener('change', (e) => {
  selectedStorage = e.target.value;
  updateDynamicFilters();
  render();
});

colorFilter.addEventListener('change', (e) => {
  selectedColor = e.target.value;
  render();
});

supplierFilter.addEventListener('change', (e) => {
  selectedSupplier = e.target.value;
  render();
});

sortFilter.addEventListener('change', (e) => {
  sortMode = e.target.value;
  render();
});

verifiedOnly.addEventListener('change', (e) => {
  onlyVerified = e.target.checked;
  render();
});

clearFiltersBtn.addEventListener('click', resetFilters);

// 11. Theme Toggle (Dark / Light)
const themeBtn = document.getElementById('themeBtn');
const savedTheme = localStorage.getItem('apple_pxt_theme') || 'dark';
if (savedTheme === 'light') {
  document.body.classList.add('light-theme');
}

themeBtn.addEventListener('click', () => {
  const isLight = document.body.classList.toggle('light-theme');
  localStorage.setItem('apple_pxt_theme', isLight ? 'light' : 'dark');
});

// 12. Price History Modal
const historyModal = document.getElementById('historyModal');
const closeHistoryModal = document.getElementById('closeHistoryModal');
const historyModalTitle = document.getElementById('historyModalTitle');
const historyModalBody = document.getElementById('historyModalBody');

closeHistoryModal.addEventListener('click', () => historyModal.classList.remove('active'));
historyModal.addEventListener('click', (e) => {
  if (e.target === historyModal) historyModal.classList.remove('active');
});

window.openPriceHistory = async function(id, name) {
  historyModalTitle.textContent = `Histórico de Preço: ${name}`;
  historyModalBody.innerHTML = '<div style="padding: 20px; text-align: center;">Carregando histórico...</div>';
  historyModal.classList.add('active');

  try {
    const res = await fetch(`/api/price-history/${id}`);
    const data = await res.json();
    const history = data.history || data.data || [];

    if (!Array.isArray(history) || history.length === 0) {
      historyModalBody.innerHTML = '<p style="padding: 16px; text-align: center;">Nenhuma variação recente registrada para este produto.</p>';
      return;
    }

    let rows = history.map(h => `
      <div style="display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid var(--border-color);">
        <span>${h.date || h.createdAt?.slice(0, 10) || 'Hoje'}</span>
        <strong style="color: var(--accent-green);">${formatBRL(h.price)}</strong>
      </div>
    `).join('');

    historyModalBody.innerHTML = rows;
  } catch (err) {
    historyModalBody.innerHTML = '<p style="color: red; padding: 16px;">Falha ao carregar o histórico de preço.</p>';
  }
};

// Initial boot
loadProducts();
