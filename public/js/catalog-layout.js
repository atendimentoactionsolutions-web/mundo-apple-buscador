/* Presentation layer shared by the existing supplier and storefront catalogs.
 * Product data, pricing, authentication and exports remain in app.js.
 */
(function () {
  'use strict';

  const states = {
    storefront: { storage: '', color: '', sort: 'model' },
    prices_of_the_day: { storage: '', color: '', sort: 'model' }
  };
  const views = [
    { name: 'storefront', view: 'viewStoreFront', grid: 'storefrontGrid', render: 'renderStoreFront' },
    { name: 'prices_of_the_day', view: 'viewPricesDay', grid: 'podMatrixGrid', render: 'renderPricesOfTheDay' }
  ];
  const normalize = value => String(value || '').trim().replace(/\s+/g, ' ').toLocaleUpperCase('pt-BR');
  const storageKey = value => normalize(value).replace(/\s/g, '');

  function displayName(value) {
    return String(value || '').toLocaleLowerCase('pt-BR')
      .replace(/(^|[\s(])([a-zà-ú])/g, (_, space, letter) => space + letter.toLocaleUpperCase('pt-BR'))
      .replace(/\bIphone\b/g, 'iPhone').replace(/\bIpad\b/g, 'iPad')
      .replace(/\bImac\b/g, 'iMac').replace(/\bMacbook\b/g, 'MacBook')
      .replace(/\bAirpods\b/g, 'AirPods').replace(/\b([mMaA]\d+)\b/g, word => word.toUpperCase())
      .replace(/\b(\d+)\s*(gb|tb)\b/gi, (_, number, unit) => number + unit.toUpperCase());
  }

  function priceForSorting(row) {
    const value = row.querySelector('.matrix-retail-val, .matrix-cost-val');
    return value ? Number(value.textContent.replace(/[^\d,-]/g, '').replace(',', '.')) || 0 : 0;
  }

  function replaceOptions(select, values, firstLabel, current, sort) {
    const options = Array.from(values.entries());
    options.sort(sort || ((a, b) => a[1].localeCompare(b[1], 'pt-BR')));
    select.replaceChildren(new Option(firstLabel, ''), ...options.map(([value, label]) => new Option(label, value)));
    select.value = values.has(current) ? current : '';
    return select.value;
  }

  function makeFilters(config) {
    const view = document.getElementById(config.view);
    const categories = view && view.querySelector('.pod-categories-wrapper');
    if (!categories) return null;
    const filters = document.createElement('div');
    filters.className = 'catalog-filters';
    filters.setAttribute('aria-label', 'Filtros do catálogo');
    filters.innerHTML = `
      <label class="catalog-filter"><span>Capacidade:</span><select data-filter="storage" aria-label="Filtrar por capacidade"><option value="">Todas</option></select></label>
      <label class="catalog-filter"><span>Cor:</span><select data-filter="color" aria-label="Filtrar por cor"><option value="">Todas</option></select></label>
      <label class="catalog-filter catalog-sort"><span class="catalog-sr-only">Ordenar modelos:</span><select data-filter="sort" aria-label="Ordenar modelos"><option value="model">Ordem dos modelos</option><option value="price_asc">Menor preço</option><option value="price_desc">Maior preço</option></select></label>
      <span class="catalog-sr-only" data-filter="result" role="status" aria-live="polite"></span>`;
    categories.after(filters);
    filters.addEventListener('change', event => {
      const key = event.target.dataset.filter;
      if (!['storage', 'color', 'sort'].includes(key)) return;
      states[config.name][key] = event.target.value;
      if (typeof window[config.render] === 'function') window[config.render]();
    });
    categories.addEventListener('click', event => {
      if (!event.target.closest('.pod-cat-pill')) return;
      Object.assign(states[config.name], { storage: '', color: '', sort: 'model' });
      if (typeof window[config.render] === 'function') window[config.render]();
    });
    return filters;
  }

  function decorateCatalog(config) {
    const grid = document.getElementById(config.grid);
    if (!grid || !config.filters) return;
    const cards = Array.from(grid.querySelectorAll('.matrix-card'));
    const state = states[config.name];
    const storageOptions = new Map();
    const colorOptions = new Map();
    const families = new Map();

    cards.forEach(card => {
      const title = card.querySelector('.matrix-card-title');
      const rawName = title ? title.textContent.trim() : 'Apple';
      const key = normalize(rawName);
      if (title) title.textContent = displayName(rawName);
      if (!families.has(key)) {
        const section = document.createElement('section');
        section.className = 'catalog-model-family';
        section.setAttribute('aria-label', displayName(rawName));
        families.set(key, { section, cards: [], price: Infinity });
      }
      const storage = card.querySelector('.matrix-card-storage');
      const capacity = storageKey(storage && storage.textContent);
      if (capacity) storageOptions.set(capacity, capacity.replace(/(GB|TB)$/i, ' $1'));
      const rows = Array.from(card.querySelectorAll('.matrix-color-row'));
      rows.forEach(row => {
        const name = row.querySelector('.matrix-color-name');
        if (!name) return;
        const color = normalize(name.textContent);
        colorOptions.set(color, displayName(name.textContent));
        name.textContent = displayName(name.textContent);
        const simulator = row.querySelector('button[title="Simular parcelas"]');
        if (simulator) simulator.setAttribute('aria-label', `Simular parcelas: ${displayName(rawName)}, ${capacity}, ${displayName(color)}`);
      });
      families.get(key).cards.push({ card, capacity, rows });
    });

    state.storage = replaceOptions(config.filters.querySelector('[data-filter="storage"]'), storageOptions, 'Todas', state.storage,
      (a, b) => {
        const size = key => parseFloat(key) * (key.includes('TB') ? 1024 : 1);
        return size(a[0]) - size(b[0]) || a[0].localeCompare(b[0]);
      });
    state.color = replaceOptions(config.filters.querySelector('[data-filter="color"]'), colorOptions, 'Todas', state.color);
    config.filters.querySelector('[data-filter="sort"]').value = state.sort;

    // Preserve the application's original loader and empty-search message.
    if (!cards.length) return;

    let shown = 0;
    const visibleFamilies = [];
    families.forEach(family => {
      family.cards.forEach(({ card, capacity, rows }) => {
        let hasColor = false;
        rows.forEach(row => {
          const name = row.querySelector('.matrix-color-name');
          row.hidden = Boolean(state.color && normalize(name && name.textContent) !== state.color);
          if (!row.hidden) hasColor = true;
        });
        card.hidden = Boolean((state.storage && state.storage !== capacity) || !hasColor);
        if (!card.hidden) {
          shown += 1;
          rows.filter(row => !row.hidden).forEach(row => { family.price = Math.min(family.price, priceForSorting(row)); });
        }
        family.section.append(card);
      });
      if (family.cards.some(item => !item.card.hidden)) visibleFamilies.push(family);
    });
    if (state.sort !== 'model') {
      visibleFamilies.sort((a, b) => state.sort === 'price_desc' ? b.price - a.price : a.price - b.price);
    }
    grid.replaceChildren(...visibleFamilies.map(family => family.section));
    config.filters.querySelector('[data-filter="result"]').textContent = `${shown} opções de capacidade em ${visibleFamilies.length} modelos.`;
    if (!shown) {
      const empty = document.createElement('div');
      empty.className = 'catalog-filter-empty';
      const message = document.createElement('p');
      message.textContent = 'Nenhum produto encontrado com esta capacidade e cor.';
      const clear = document.createElement('button');
      clear.type = 'button';
      clear.textContent = 'Limpar filtros';
      clear.addEventListener('click', () => {
        Object.assign(state, { storage: '', color: '', sort: 'model' });
        window[config.render]();
      });
      empty.append(message, clear);
      grid.append(empty);
    }
  }

  function init() {
    document.body.classList.add('catalog-layout');
    let isLight = true;
    try {
      isLight = localStorage.getItem('apple_pxt_theme') !== 'dark';
      if (!localStorage.getItem('apple_pxt_theme')) localStorage.setItem('apple_pxt_theme', 'light');
    } catch (_) { /* Keep the default light theme when storage is unavailable. */ }
    document.body.classList.toggle('light-theme', isLight);
    if (typeof updateThemeUI === 'function') updateThemeUI(isLight);

    const header = document.querySelector('.top-header');
    const actions = document.querySelector('.header-right-group');
    const navigation = document.querySelector('.view-switch-nav');
    const storeTab = document.getElementById('tabStoreFront');
    const costTab = document.getElementById('tabPricesDay');
    if (navigation && storeTab && costTab) {
      navigation.prepend(storeTab);
      storeTab.querySelector('span').textContent = 'Preços de venda';
      costTab.querySelector('span').textContent = 'Custo fornecedor';
    }
    const badge = document.getElementById('connectionBadge');
    if (header && badge) {
      const status = document.createElement('div');
      status.className = 'catalog-status-bar';
      status.setAttribute('role', 'status');
      status.append(badge);
      header.after(status);
    }
    // Retain the live site's additional full-catalog export when it exists.
    const exportAll = document.getElementById('btnExportAllSfWhatsapp');
    if (actions && exportAll) {
      exportAll.classList.add('calc-top-btn', 'catalog-export-all');
      const exportButton = document.getElementById('btnExportTopHeader');
      if (exportButton) exportButton.after(exportAll);
      else actions.prepend(exportAll);
    }
    const session = document.getElementById('userSessionInfo');
    if (session && !document.getElementById('adminHeaderBtn')) {
      const settings = document.createElement('a');
      settings.id = 'adminHeaderBtn';
      settings.className = 'admin-link-btn';
      settings.href = '/admin';
      settings.title = 'Configurar margens e taxas da loja';
      settings.setAttribute('aria-label', 'Configurações da loja');
      settings.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 3-1 3-3 1-2 3 2 3-1 3 3 2 3-1 3 2 3-2 3-1 1-3-2-3 1-3-3-2-3 1-3-1Z"/><circle cx="12" cy="12" r="3"/></svg>';
      session.prepend(settings);
    }
    const logo = document.getElementById('brandLogoLink');
    if (logo) logo.setAttribute('aria-label', 'Mundo Apple — início');
    ['sfSearchInput', 'sfSearchInputMobile', 'podSearchInput'].forEach(id => {
      const input = document.getElementById(id);
      if (input) {
        input.placeholder = 'Buscar modelo, capacidade ou cor…';
        input.setAttribute('aria-label', 'Buscar modelo, capacidade ou cor');
      }
    });

    window.exportCurrentCatalog = function () {
      if (typeof currentView !== 'undefined' && currentView === 'prices_of_the_day' && typeof exportPricesDayTable === 'function') {
        exportPricesDayTable();
      } else if (typeof openStorefrontExportModal === 'function') {
        openStorefrontExportModal();
      }
    };
    const exportButton = document.getElementById('btnExportTopHeader');
    if (exportButton) exportButton.setAttribute('onclick', 'exportCurrentCatalog()');

    views.forEach(config => {
      config.filters = makeFilters(config);
      const originalRender = window[config.render];
      if (typeof originalRender !== 'function') return;
      window[config.render] = function (...args) {
        const result = originalRender.apply(this, args);
        decorateCatalog(config);
        return result;
      };
      decorateCatalog(config);
    });

    document.addEventListener('keydown', event => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'k') return;
      const isCosts = typeof currentView !== 'undefined' && currentView === 'prices_of_the_day';
      const input = document.getElementById(isCosts ? 'podSearchInput' : 'sfSearchInput');
      if (!input) return;
      event.preventDefault();
      input.focus();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
