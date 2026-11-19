const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function element() {
  const classes = new Set();
  const listeners = new Map();
  return { innerHTML: '', textContent: '', value: '', style: {}, listeners, dataset: {},
    classList: { add: name => classes.add(name), remove: name => classes.delete(name), contains: name => classes.has(name),
      toggle(name, value = !classes.has(name)) { value ? classes.add(name) : classes.delete(name); return value; } },
    setAttribute() {}, querySelectorAll: () => [], addEventListener: (name, handler) => listeners.set(name, handler),
    appendChild() {}, focus() {}, blur() {}, parentElement: { style: {} }
  };
}
async function setup(user = null, products = [], failure = false, pathname = "/") {
  const ids = ['clientShowcaseModal', 'showcaseModelTitle', 'showcaseModelSubtitle', 'clientShowcaseBody', 'priceCostLink', 'headerDollarBadge', 'adminHeaderBtn', 'userSessionInfo', 'tabStoreFront', 'tabCostLink', 'tabPricesDay', 'btnOpenCalculator', 'btnExportTopHeader', 'btnExportSfWhatsapp', 'btnExportAllSfWhatsapp', 'mobileDrawerCalcBtn', 'mobileDrawerExportBtn', 'mobileDrawerExportAllBtn', 'mobileDrawerCostBtn', 'mobileDrawerAdminBtn', 'brandLogoLink', 'viewStoreFront', 'viewPricesDay', 'viewQuotes', 'storefrontGrid', 'podMatrixGrid', 'sfShownCountText',
    'catalogHeading', 'catalogDescription', 'catalogModeLabel', 'btnClientMode', 'txtClientModeBtn', 'sfSearchInput',
    'sfSearchClearBtn', 'qbItemsList', 'qbCatalogDropdown', 'qbCatalogSearchInput',
    'pdfSelectionModal', 'pdfSelectionListBody', 'exportModalTitle', 'exportModalSubtitle', 'exportModalScopeLabel', 'exportModalCategoryPills', 'pdfSelectedCountBadge'];
  const elements = new Map(ids.map(id => [id, element()]));
  const storage = new Map();
  const errors = [];
  const events = new Map();
  const requests = [];
  let adminDfuActive = true;
  let pricingVersion = 1;
  const context = vm.createContext({
    URLSearchParams, QuoteCore: require('../public/js/quote-core'), PricingCore: require('../public/js/pricing-core'),
    document: { getElementById: id => elements.get(id) || null, querySelectorAll: () => [], querySelector: () => null,
      body: element(), cookie: '', addEventListener() {} },
    localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    io: () => ({ on: (event, handler) => events.set(event, handler), emit() {} }),
    location: { pathname, search: '', origin: 'http://localhost' }, navigator: {}, innerWidth: 1440,
    addEventListener() {}, setInterval() {}, setTimeout: () => 1, requestAnimationFrame: fn => { queueMicrotask(fn); return 1; },
    console: { log() {}, warn() {}, error: (...args) => errors.push(args) },
    fetch: async (url, options) => {
      if (url === '/api/pricing/admin-dfu') {
        adminDfuActive = JSON.parse(options.body).active;
        pricingVersion++;
        return { ok: true, json: async () => ({ dfuActive: false, adminDfuActive, pricingVersion }) };
      }
      requests.push(url);
      if (url.startsWith('/api/products') && failure) throw new Error('Offline');
      const data = url === '/api/auth/me' ? (user && { ...user, dfuActive: user.username === 'admin' && adminDfuActive, adminDfuActive, pricingVersion }) : url === '/api/margins'
        ? { success: true, margins: { categories: { IPH: 400 }, products: {} } }
        : url === '/api/card-rates' ? { success: true, rates: { baseRate: 0, installmentRates: {} } }
        : { success: true, data: products, isShielded: !user };
      return { ok: Boolean(data), status: data ? 200 : 401, json: async () => data };
    }
  });
  context.window = context;
  for (const name of ['quotes-module.js', 'app.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/js', name), 'utf8'), context, { filename: name });
  await new Promise(resolve => setImmediate(resolve));
  return { context, elements, errors, requests, events, read: code => vm.runInContext(code, context) };
}

test('the full frontend starts in visitor mode and handles an empty catalog', async () => {
  const app = await setup();
  assert.equal(app.errors.length, 0);
  assert.equal(app.read('catalogStatus'), 'ready');
  assert.match(app.elements.get('storefrontGrid').innerHTML, /Nenhum produto encontrado/);
  assert.doesNotMatch(app.elements.get('storefrontGrid').innerHTML, /app-spinner/);
  assert.ok(app.requests.indexOf('/api/auth/me') < app.requests.findIndex(url => url.startsWith('/api/products')));
  assert.equal(app.read('getCatalogCacheKey()'), 'shielded_products');
});

test('the full frontend reports a network failure instead of an endless spinner', async () => {
  const app = await setup(null, [], true);
  assert.equal(app.read('catalogStatus'), 'error');
  assert.match(app.elements.get('storefrontGrid').innerHTML, /Não foi possível atualizar/);
});

test('store prices, quote search and numeric product IDs stay consistent', async () => {
  const products = [
    { id: 1, name: 'IPHONE 17 PRO', category: 'IPH', color: 'BLUE', storage: '256GB', price: 6500 },
    { id: 2, name: 'IPHONE 17 PRO', category: 'IPH', color: 'BLUE', storage: '256GB', price: 6000 }
  ];
  const app = await setup({ id: 'store-a', username: 'store-a', role: 'lojista' }, products);
  assert.equal(app.errors.length, 0);
  assert.equal(app.read('getCatalogCacheKey()'), 'authed_products_store-a');
  assert.match(app.elements.get('storefrontGrid').innerHTML, /data-price="6400"/);
  app.context.onQuoteCatalogSearch({ value: 'iphone 17' });
  assert.match(app.elements.get('qbCatalogDropdown').innerHTML, /data-retail-price="6400"/);
  app.context.addItemFromCatalog('1', 6400);
  assert.equal(app.read('currentBuilderData.items[0].unitPrice'), 6400);
  const originalMarkup = app.elements.get('qbItemsList').innerHTML;
  app.context.onItemDiscountValChange(0, '123');
  assert.equal(app.elements.get('qbItemsList').innerHTML, originalMarkup);
  await app.events.get('margins_updated')({ categories: { IPH: 9999 } });
  assert.equal(app.read('margins.categories.IPH'), 400);
  assert.match(app.elements.get('storefrontGrid').innerHTML, /data-price="6400"/);
});

test('an empty response replaces the old products instead of keeping stale offers', async () => {
  const products = [{ id: 1, name: 'IPHONE 17', category: 'IPH', color: 'BLACK', price: 6000 }];
  const app = await setup(null, products);
  assert.equal(app.read('allProducts.length'), 1);
  products.length = 0;
  await app.context.loadProducts();
  assert.equal(app.read('allProducts.length'), 0);
  assert.match(app.elements.get('storefrontGrid').innerHTML, /Nenhum produto encontrado/);
});


test('Cledson controls admin DFU while his own prices always remain unadjusted', async () => {
  const app = await setup({ id: 'cledson', username: 'cledson', role: 'lojista' });
  const button = element();
  app.elements.set('btnDfuToggle', button);
  const price = category => app.read(`applyDFU(1000, '${category}', '')`);
  assert.equal(price('IPH'), 1000);
  await app.context.toggleCledsonDfu();
  for (const [category, expected] of [['IPH', 1000], ['MCB', 1000], ['RLG', 1000], ['IPAD', 1000], ['PODS', 1000]]) {
    assert.equal(price(category), expected);
  }
  assert.equal(button.textContent, 'DFU admin: desativado');
  await app.context.checkAuthSession();
  assert.equal(price('IPH'), 1000);
  await app.context.toggleCledsonDfu();
  assert.equal(price('IPH'), 1000);
  assert.equal(button.textContent, 'DFU admin: ativado');
  assert.equal(app.errors.length, 0);
});

test('DFU toggle is hidden and ignored for visitors, admin and other users', async () => {
  for (const username of [null, 'admin', 'other']) {
    const app = await setup(username ? { id: username, username, role: 'lojista' } : null);
    const button = element();
    app.elements.set('btnDfuToggle', button);
    app.context.syncDfuButtons();
    assert.equal(button.style.display, 'none');
    const before = app.read('window.DFU_ACTIVE');
    await app.context.toggleCledsonDfu();
    assert.equal(app.read('window.DFU_ACTIVE'), before);
    assert.equal(app.errors.length, 0);
  }
});


test('admin receives DFU changes in both catalogs and open simulator without accumulating', async () => {
  const app = await setup({ id: 'admin', username: 'admin', role: 'admin' }, [
    { id: 1, name: 'IPHONE 17 PRO', category: 'IPH', color: 'BLACK', storage: '256GB', price: 6000 }
  ]);
  app.events.get('pricing_updated')({ dfuActive: false, pricingVersion: 2 });
  const modal = element();
  modal.classList.add('active');
  app.elements.set('cardSimulatorModal', modal);
  for (const id of ['simInstallmentsGrid', 'simHeroCardVal', 'simCashInput']) app.elements.set(id, element());
  app.read(`currentSimData = {
    model: 'IPHONE 17 PRO', storage: '256GB', ram: '', color: 'BLACK', unitPrice: 6400,
    quantity: 2, discountType: 'FIXED', discountValue: 50, entryAmount: 100,
    colorOptions: [{color: 'BLACK', price: 6400}],
    additionalItems: [{key: getSimProductKey('IPHONE 17 PRO', '256GB', '', 'BLACK'), unitPrice: 6350, quantity: 1}]
  }`);
  for (let cycle = 0; cycle < 3; cycle++) {
    app.events.get('pricing_updated')({ dfuActive: true, pricingVersion: 3 + cycle * 2 });
    assert.match(app.elements.get('storefrontGrid').innerHTML, /data-price="6500"/);
    assert.match(app.elements.get('podMatrixGrid').innerHTML, /6[.,]500/);
    assert.match(app.elements.get('podMatrixGrid').innerHTML, /PREÇO DO DIA/);
    assert.doesNotMatch(app.elements.get('podMatrixGrid').innerHTML, /6[.,]100/);
    assert.equal(app.read('currentSimData.unitPrice'), 6500);
    assert.equal(app.read('currentSimData.colorOptions[0].price'), 6500);
    assert.equal(app.read('currentSimData.additionalItems[0].unitPrice'), 6450);
    assert.equal(app.read('currentSimData.cashPrice'), 19400);
    assert.equal(app.read('currentSimData.entryAmount'), 100);
    await app.context.checkAuthSession();
    assert.equal(app.read('currentSimData.unitPrice'), 6500);
    app.events.get('pricing_updated')({ dfuActive: false, pricingVersion: 4 + cycle * 2 });
    assert.match(app.elements.get('storefrontGrid').innerHTML, /data-price="6400"/);
    assert.equal(app.read('currentSimData.unitPrice'), 6400);
    assert.equal(app.read('currentSimData.additionalItems[0].unitPrice'), 6350);
    assert.equal(app.read('currentSimData.cashPrice'), 19100);
  }
  assert.equal(app.errors.length, 0);
});


test('logged-out visitors never see admin bar controls, calculator, export, USD or cost buttons, while admin sees them', async () => {
  const indexHtml = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const layoutCss = fs.readFileSync(path.join(__dirname, '../public/css/catalog-layout.css'), 'utf8');
  for (const id of ['priceCostLink', 'headerDollarBadge', 'btnOpenCalculator', 'btnExportTopHeader', 'userSessionInfo', 'adminHeaderBtn']) {
    assert.match(indexHtml, new RegExp(`id="${id}"[^>]*style="[^"]*display:\\s*none`), `${id} starts hidden in HTML`);
  }
  assert.match(layoutCss, /\.catalog-app:not\(\.admin-authenticated\) #btnOpenCalculator/);
  assert.match(layoutCss, /\.catalog-app:not\(\.admin-authenticated\) #btnExportTopHeader/);
  assert.match(layoutCss, /\.catalog-app\.admin-authenticated:not\(\.client-mode-active\) \.header-dollar-badge/);

  const app = await setup(null, [{ id: 'public-phone', name: 'IPHONE 17 PRO', category: 'IPH', price: 6850 }]);
  assert.equal(app.errors.length, 0);
  assert.equal(app.read('currentUser'), null);
  assert.equal(app.context.IS_CATALOG_SHIELDED, true);
  assert.equal(app.read('applyDFU(6850, "IPH", "IPHONE 17 PRO")'), 6850);
  assert.equal(app.context.document.body.classList.contains('admin-authenticated'), false);
  for (const id of ['priceCostLink', 'headerDollarBadge', 'btnOpenCalculator', 'btnExportTopHeader', 'adminHeaderBtn', 'userSessionInfo', 'btnExportSfWhatsapp', 'btnExportAllSfWhatsapp']) {
    assert.equal(app.elements.get(id).style.display, 'none', `${id} hidden for visitor`);
  }
  app.context.syncMobileDrawerActions();
  for (const id of ['mobileDrawerCalcBtn', 'mobileDrawerExportBtn', 'mobileDrawerExportAllBtn', 'mobileDrawerCostBtn', 'mobileDrawerAdminBtn']) {
    assert.equal(app.elements.get(id).style.display, 'none', `${id} hidden in mobile drawer for visitor`);
  }
  assert.equal(app.elements.get('brandLogoLink').href, '/login.html');
  assert.doesNotMatch(app.elements.get('storefrontGrid').innerHTML, /mock-card-cost-btn|openCardCostModal/);

  const storeUserApp = await setup({ id: 'lojista-1', username: 'loja', role: 'lojista' }, [{ id: 'public-phone', name: 'IPHONE 17 PRO', category: 'IPH', price: 6850 }]);
  assert.equal(storeUserApp.context.document.body.classList.contains('admin-authenticated'), false);
  for (const id of ['priceCostLink', 'headerDollarBadge', 'btnOpenCalculator', 'btnExportTopHeader', 'adminHeaderBtn']) {
    assert.equal(storeUserApp.elements.get(id).style.display, 'none', `${id} hidden for non-admin user`);
  }

  const adminApp = await setup({ id: 'admin-felipe', username: 'felipe', role: 'admin' }, [{ id: 'cost-phone', name: 'IPHONE 17 PRO', category: 'IPH', price: 6000 }]);
  assert.equal(adminApp.context.document.body.classList.contains('admin-authenticated'), true);
  for (const id of ['priceCostLink', 'headerDollarBadge', 'btnOpenCalculator', 'btnExportTopHeader', 'adminHeaderBtn']) {
    assert.equal(adminApp.elements.get(id).style.display, 'inline-flex', `${id} shown for admin`);
  }
  adminApp.context.syncMobileDrawerActions();
  for (const id of ['mobileDrawerCalcBtn', 'mobileDrawerExportBtn', 'mobileDrawerExportAllBtn', 'mobileDrawerCostBtn', 'mobileDrawerAdminBtn']) {
    assert.equal(adminApp.elements.get(id).style.display, 'flex', `${id} shown in mobile drawer for admin`);
  }
  adminApp.context.toggleClientMode();
  for (const id of ['priceCostLink', 'headerDollarBadge', 'btnOpenCalculator', 'btnExportTopHeader', 'adminHeaderBtn']) {
    assert.equal(adminApp.elements.get(id).style.display, 'none', `${id} hidden in client mode`);
  }
});


test('cost page requires admin login and loads a separate price list without extra DFU or margin', async () => {
  const visitorApp = await setup(null, [{ id: 'cost-phone', name: 'IPHONE 17 PRO', category: 'IPH', price: 6100 }], false, '/preco-de-custo');
  assert.ok(!visitorApp.requests.some(url => url.startsWith('/api/cost-products')));
  assert.equal(visitorApp.elements.get('priceCostLink').style.display, 'none');

  const app = await setup({ id: 'admin-felipe', username: 'felipe', role: 'admin' }, [{ id: 'cost-phone', name: 'IPHONE 17 PRO', category: 'IPH', price: 6100 }], false, '/preco-de-custo');
  assert.equal(app.errors.length, 0);
  assert.ok(app.requests.some(url => url.startsWith('/api/cost-products')));
  assert.ok(!app.requests.some(url => url.startsWith('/api/products')));
  assert.equal(app.read('getCatalogCacheKey()'), 'cost_products_dfu');
  assert.equal(app.read('getProductRetailPrice(allProducts[0])'), 6100);
  assert.equal(app.elements.get('catalogHeading').textContent, 'Preço de custo');
  assert.equal(app.elements.get('priceCostLink').href, '/');
  assert.equal(app.elements.get('priceCostLink').textContent, 'Preço real');
  assert.equal(app.elements.get('priceCostLink').style.display, 'inline-flex');
  assert.equal(app.elements.get('brandLogoLink').href, '/admin.html');
});

test('segmented tabs place Preço de Custo on the left and toggle cleanly between cost and day prices', async () => {
  const indexHtml = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const costPos = indexHtml.indexOf('id="tabCostLink"');
  const dayPos = indexHtml.indexOf('id="tabPricesDay"');
  assert.ok(costPos > -1 && dayPos > -1, 'both tabs present in index.html');
  assert.ok(costPos < dayPos, 'Preço de custo is on the LEFT of Preço do dia');

  const app = await setup(
    { id: 'admin-felipe', username: 'felipe', role: 'admin' },
    [{ id: 'phone-17pm', name: 'IPHONE 17 PRO MAX', storage: '256GB', color: 'COSMIC ORANGE', category: 'IPH', price: 7477 }]
  );
  assert.equal(app.errors.length, 0);

  // Default login on / starts on Preço do dia (real price with margin)
  assert.equal(app.read('currentPriceMode'), 'day');
  assert.equal(app.elements.get('tabPricesDay').classList.contains('active'), true);
  assert.equal(app.elements.get('tabCostLink').classList.contains('active'), false);

  // Switch to Preço de custo
  app.context.switchToCostPrices();
  assert.equal(app.read('currentPriceMode'), 'cost');
  assert.equal(app.elements.get('tabCostLink').classList.contains('active'), true);
  assert.equal(app.elements.get('tabPricesDay').classList.contains('active'), false);

  // Switch back to Preço do dia
  app.context.switchToDayPrices();
  assert.equal(app.read('currentPriceMode'), 'day');
  assert.equal(app.elements.get('tabPricesDay').classList.contains('active'), true);
  assert.equal(app.elements.get('tabCostLink').classList.contains('active'), false);
});


test('admin cards open their own costs by ID while hiding costs for visitors and client mode', async () => {
  const products = [
    { id: 'mac-16', name: 'MACBOOK AIR M5 13"', category: 'MCB', storage: '512GB', ram: '16GB', region: '16GB', color: 'SILVER', price: 8000 },
    { id: 'mac-24', name: 'MACBOOK AIR M5 13"', category: 'MCB', storage: '512GB', ram: '24GB', region: '24GB', color: 'SILVER', price: 10000 }
  ];
  const visitor = await setup(null, products);
  visitor.read("sfCurrentCategory = 'MCB'; renderStoreFront();");
  assert.doesNotMatch(visitor.elements.get('storefrontGrid').innerHTML, /mock-card-cost-btn|openCardCostModal/);

  const app = await setup({ id: 'admin-felipe', username: 'felipe', role: 'admin' }, products);
  assert.equal(app.elements.get('brandLogoLink').href, '/admin.html');
  assert.equal(app.elements.get('priceCostLink').style.display, 'inline-flex');
  app.read("sfCurrentCategory = 'MCB'; renderStoreFront();");
  assert.match(app.elements.get('storefrontGrid').innerHTML, /mock-card-actions[\s\S]*?<span>Ver<\/span>[\s\S]*?openCardCostModal/);
  const [key] = Array.from(app.context.storefrontCardMap).find(([, c]) => c.productIds.includes('mac-16'));
  let requested;
  app.context.fetch = async (url, options) => {
    requested = { url, options };
    return { ok: true, json: async () => ({ success: true, dfuActive: true, data: [
      { id: 'mac-16', color: 'SILVER', price: 8200 },
      { id: 'mac-24', color: 'SILVER', price: 10200 }
    ] }) };
  };
  const button = { innerHTML: 'Custo', disabled: false };
  await app.context.openCardCostModal(key, button);
  assert.equal(requested.url, '/api/cost-products');
  assert.equal(requested.options.cache, 'no-store');
  assert.equal(button.disabled, false);
  assert.equal(button.innerHTML, 'Custo');
  assert.match(app.elements.get('showcaseModelSubtitle').textContent, /DFU ativo.*Sem margem/);
  const modal = app.elements.get('clientShowcaseBody').innerHTML;
  assert.match(modal, /8\.200/);
  assert.doesNotMatch(modal, /10\.200/);
  app.context.openClientShowcaseModal(key);
  assert.doesNotMatch(app.elements.get('showcaseModelSubtitle').textContent, /Sem margem/);
  app.context.toggleClientMode();
  assert.equal(app.elements.get('priceCostLink').style.display, 'none');
  assert.doesNotMatch(app.elements.get('storefrontGrid').innerHTML, /mock-card-cost-btn|openCardCostModal/);
});

test('Apple TV capacities appear in accessories in both catalogs', async () => {
  const products = [
    { id: 'tv128', name: 'APPLE TV 4K', category: 'APPLE_TV', storage: '128GB', color: 'SEM COR', price: 1499 },
    { id: 'tv64', name: 'APPLE TV 4K', category: 'APPLE_TV', storage: '64GB', color: 'SEM COR', price: 1399 }
  ];
  for (const [pathname, user] of [['/', null], ['/preco-de-custo', { id: 'admin-felipe', username: 'felipe', role: 'admin' }]]) {
    const app = await setup(user, products, false, pathname);
    app.read("sfCurrentCategory = 'ACSS'; renderStoreFront(); podCurrentCategory = 'ACSS'; renderPricesOfTheDay();");
    for (const id of ['storefrontGrid', 'podMatrixGrid']) {
      const html = app.elements.get(id).innerHTML;
      assert.match(html, /APPLE TV 4K/i);
      assert.match(html, /128GB/);
      assert.match(html, /64GB/);
    }
    assert.equal(app.errors.length, 0);
  }
});

test('every current catalog offer is visible in its category, all products and model search', async () => {
  const file = path.join(__dirname, '../data/snapshot_latest.json');
  if (!fs.existsSync(file)) return;
  const products = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const [pathname, user] of [['/', null], ['/preco-de-custo', { id: 'admin-felipe', username: 'felipe', role: 'admin' }]]) {
    const app = await setup(user, [], false, pathname);
    for (const p of products) {
      app.context.auditProduct = p;
      const category = (p.category === 'APPLE_TV' ? 'ACSS' : p.category) + (p.condition === 'CPO' ? '_CPO' : '');
      app.read('allProducts = [auditProduct];');
      for (const cat of ['ALL', category]) {
        app.read(`sfCurrentCategory = ${JSON.stringify(cat)}; podCurrentCategory = ${JSON.stringify(cat)}; renderStoreFront(); renderPricesOfTheDay();`);
        assert.ok(Array.from(app.context.storefrontCardMap.values()).some(c => c.productIds.includes(p.id)), `${pathname} ${cat}: ${p.name} ${p.storage} ${p.color}`);
        assert.doesNotMatch(app.elements.get('podMatrixGrid').innerHTML, /Nenhum produto encontrado/, `${pathname}: ${p.name}`);
      }
      app.elements.get('sfSearchInput').value = p.name;
      app.read('renderStoreFront();');
      assert.ok(Array.from(app.context.storefrontCardMap.values()).some(c => c.productIds.includes(p.id)), `search: ${p.name}`);
      app.elements.get('sfSearchInput').value = '';
    }
    assert.equal(app.errors.length, 0);
  }
});

test('grouping the full current catalog preserves every offer ID', async () => {
  const file = path.join(__dirname, '../data/snapshot_latest.json');
  if (!fs.existsSync(file)) return;
  const products = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const [pathname, user] of [['/', null], ['/preco-de-custo', { id: 'admin-felipe', username: 'felipe', role: 'admin' }]]) {
    const app = await setup(user, products, false, pathname);
    const visible = new Set();
    for (const cat of ['IPH', 'MCB', 'IPAD', 'RLG', 'PODS', 'ACSS', 'IMAC', 'IPH_CPO', 'MCB_CPO', 'IPAD_CPO', 'RLG_CPO', 'PODS_CPO', 'ACSS_CPO', 'IMAC_CPO']) {
      app.read(`sfCurrentCategory = ${JSON.stringify(cat)}; renderStoreFront();`);
      for (const card of app.context.storefrontCardMap.values()) for (const id of card.productIds) visible.add(id);
    }
    assert.deepEqual([...visible].sort(), products.map(p => p.id).sort());
    assert.equal(app.errors.length, 0);
  }
});

test('CPO categories separate phones, Macs and iPads from sealed products', async () => {
  const products = ['IPH', 'MCB', 'IPAD', 'RLG'].flatMap(category => [
    { id: category, name: category, category, price: 1000, condition: 'NOVO' },
    { id: category + '-cpo', name: category + ' CPO', category, price: 900, condition: 'CPO' }
  ]);
  for (const [pathname, user] of [['/', null], ['/preco-de-custo', { id: 'admin-felipe', username: 'felipe', role: 'admin' }]]) {
    const app = await setup(user, products, false, pathname);
    for (const category of ['IPH', 'MCB', 'IPAD', 'RLG']) {
      for (const suffix of ['', '_CPO']) {
        app.read(`sfCurrentCategory = '${category}${suffix}'; podCurrentCategory = '${category}${suffix}'; renderStoreFront(); renderPricesOfTheDay();`);
        const ids = Array.from(app.context.storefrontCardMap.values()).flatMap(c => Array.from(c.productIds));
        assert.deepEqual(ids, [category + (suffix ? '-cpo' : '')]);
        const html = app.elements.get('podMatrixGrid').innerHTML;
        if (suffix) assert.match(html, /CPO/); else assert.doesNotMatch(html, /CPO/);
      }
    }
  }
  const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  for (const attr of ['data-category', 'data-sf-category']) {
    assert.ok(html.indexOf(`${attr}="IPH"`) < html.indexOf(`${attr}="IPH_CPO"`));
    assert.ok(html.indexOf(`${attr}="IPH_CPO"`) < html.indexOf(`${attr}="MCB"`));
  }
});

test('export modal pulls the active selected category (not always iPhone), supports switching categories, and respects Preço do Dia vs Preço de Custo', async () => {
  const products = [
    { id: 'iph-1', name: 'IPHONE 17 PRO', category: 'IPH', storage: '256GB', color: 'BLACK', price: 7000, condition: 'NOVO' },
    { id: 'mac-1', name: 'MACBOOK AIR M5 13"', category: 'MCB', storage: '512GB', ram: '16GB', color: 'SILVER', price: 8500, condition: 'NOVO' },
    { id: 'ipad-1', name: 'IPAD AIR M4 11" WIFI', category: 'IPAD', storage: '256GB', color: 'BLUE', price: 6200, condition: 'NOVO' },
    { id: 'watch-1', name: 'APPLE WATCH S12', category: 'RLG', storage: '46MM', color: 'BLACK', price: 3300, condition: 'NOVO' }
  ];
  const app = await setup({ id: 'admin-felipe', username: 'felipe', role: 'admin' }, products);
  let copiedText = '';
  app.context.robustCopyToClipboard = async text => { copiedText = text; return true; };

  // 1. User is in Preço do Dia and selects Mac (MCB), while sfCurrentCategory is still IPH
  app.read("podCurrentCategory = 'MCB'; sfCurrentCategory = 'IPH';");
  app.context.openStorefrontExportModal();
  assert.equal(app.read('exportModalCategory'), 'MCB');
  assert.match(app.elements.get('pdfSelectionListBody').innerHTML, /MACBOOK AIR M5/);
  assert.doesNotMatch(app.elements.get('pdfSelectionListBody').innerHTML, /IPHONE 17 PRO/);
  assert.match(app.elements.get('exportModalCategoryPills').innerHTML, /data-export-modal-cat="MCB"/);

  // Copy WhatsApp text in Preço do Dia mode: only MacBook with retail price (margin applied, no DFU/margem text)
  await app.context.copySelectedStorefrontWhatsApp();
  assert.match(copiedText, /MACBOOK AIR M5/i);
  assert.doesNotMatch(copiedText, /IPHONE 17 PRO/i);
  assert.doesNotMatch(copiedText, /margem|dfu/i);
  assert.match(copiedText, /Valores válidos para pagamento à vista/);

  // 2. Switch category directly inside the export modal to iPad
  app.context.selectExportModalCategory('IPAD');
  assert.equal(app.read('exportModalCategory'), 'IPAD');
  assert.match(app.elements.get('pdfSelectionListBody').innerHTML, /IPAD AIR M4/);
  assert.doesNotMatch(app.elements.get('pdfSelectionListBody').innerHTML, /MACBOOK AIR M5/);
  assert.doesNotMatch(app.elements.get('pdfSelectionListBody').innerHTML, /IPHONE 17 PRO/);

  await app.context.copySelectedStorefrontWhatsApp();
  assert.match(copiedText, /IPAD AIR M4/i);
  assert.doesNotMatch(copiedText, /MACBOOK AIR M5/i);
  assert.doesNotMatch(copiedText, /IPHONE 17 PRO/i);

  // 3. Toggle to All Catalog and back to page's active category (MCB, NOT IPH)
  app.context.toggleExportModalCatalogScope();
  assert.equal(app.read('exportModalCategory'), 'ALL');
  assert.match(app.elements.get('pdfSelectionListBody').innerHTML, /IPHONE 17 PRO/);
  assert.match(app.elements.get('pdfSelectionListBody').innerHTML, /APPLE WATCH S12/);
  app.context.toggleExportModalCatalogScope();
  assert.equal(app.read('exportModalCategory'), 'MCB');
  assert.match(app.elements.get('pdfSelectionListBody').innerHTML, /MACBOOK AIR M5/);
  assert.doesNotMatch(app.elements.get('pdfSelectionListBody').innerHTML, /IPHONE 17 PRO/);

  // 4. Switch to Preço de Custo tab and export Apple Watch -> exports cost price without retail margin or customer footer
  app.context.switchToCostPrices();
  app.read("podCurrentCategory = 'RLG';");
  app.context.openStorefrontExportModal();
  assert.equal(app.read('exportModalCategory'), 'RLG');
  assert.match(app.elements.get('exportModalTitle').textContent, /Preço de Custo.*Apple Watch/);
  await app.context.copySelectedStorefrontWhatsApp();
  assert.match(copiedText, /APPLE WATCH S12/i);
  assert.doesNotMatch(copiedText, /IPHONE 17 PRO/i);
  assert.doesNotMatch(copiedText, /Emitimos nota fiscal/);
  assert.doesNotMatch(copiedText, /margem|dfu/i);
});
