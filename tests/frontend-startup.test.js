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
async function setup(user = null, products = [], failure = false) {
  const ids = ['viewStoreFront', 'viewPricesDay', 'viewQuotes', 'storefrontGrid', 'podMatrixGrid', 'sfShownCountText',
    'catalogHeading', 'catalogDescription', 'catalogModeLabel', 'btnClientMode', 'txtClientModeBtn', 'sfSearchInput',
    'sfSearchClearBtn', 'qbItemsList', 'qbCatalogDropdown', 'qbCatalogSearchInput'];
  const elements = new Map(ids.map(id => [id, element()]));
  const storage = new Map();
  const errors = [];
  const events = new Map();
  const requests = [];
  const context = vm.createContext({
    URLSearchParams, QuoteCore: require('../public/js/quote-core'), PricingCore: require('../public/js/pricing-core'),
    document: { getElementById: id => elements.get(id) || null, querySelectorAll: () => [], querySelector: () => null,
      body: element(), cookie: '', addEventListener() {} },
    localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    io: () => ({ on: (event, handler) => events.set(event, handler), emit() {} }),
    location: { pathname: '/', search: '', origin: 'http://localhost' }, navigator: {}, innerWidth: 1440,
    addEventListener() {}, setInterval() {}, setTimeout: () => 1, requestAnimationFrame: fn => { queueMicrotask(fn); return 1; },
    console: { log() {}, warn() {}, error: (...args) => errors.push(args) },
    fetch: async url => {
      requests.push(url);
      if (url.startsWith('/api/products') && failure) throw new Error('Offline');
      const data = url === '/api/auth/me' ? user : url === '/api/margins'
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


test('Cledson can toggle DFU without the session refresh resetting the choice', async () => {
  const app = await setup({ id: 'cledson', username: 'cledson', role: 'lojista' });
  const button = element();
  app.elements.set('btnDfuToggle', button);
  const price = category => app.read(`applyDFU(1000, '${category}', '')`);
  assert.equal(price('IPH'), 1000);
  app.context.toggleCledsonDfu();
  for (const [category, expected] of [['IPH', 1100], ['MCB', 1200], ['RLG', 1100], ['IPAD', 1050], ['PODS', 1000]]) {
    assert.equal(price(category), expected);
  }
  assert.equal(button.textContent, 'DFU: ativado');
  await app.context.checkAuthSession();
  assert.equal(price('IPH'), 1100);
  app.context.toggleCledsonDfu();
  assert.equal(price('IPH'), 1000);
  assert.equal(button.textContent, 'DFU: desativado');
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
    app.context.toggleCledsonDfu();
    assert.equal(app.read('window.DFU_ACTIVE'), before);
    assert.equal(app.errors.length, 0);
  }
});


test('DFU updates both rendered catalogs and an open simulator synchronously, without accumulating', async () => {
  const app = await setup({ id: 'cledson', username: 'cledson', role: 'lojista' }, [
    { id: 1, name: 'IPHONE 17 PRO', category: 'IPH', color: 'BLACK', storage: '256GB', price: 6000 }
  ]);
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
    app.context.toggleCledsonDfu();
    assert.match(app.elements.get('storefrontGrid').innerHTML, /data-price="6500"/);
    assert.match(app.elements.get('podMatrixGrid').innerHTML, /6[.,]100/);
    assert.equal(app.read('currentSimData.unitPrice'), 6500);
    assert.equal(app.read('currentSimData.colorOptions[0].price'), 6500);
    assert.equal(app.read('currentSimData.additionalItems[0].unitPrice'), 6450);
    assert.equal(app.read('currentSimData.cashPrice'), 19400);
    assert.equal(app.read('currentSimData.entryAmount'), 100);
    await app.context.checkAuthSession();
    assert.equal(app.read('currentSimData.unitPrice'), 6500);
    app.context.toggleCledsonDfu();
    assert.match(app.elements.get('storefrontGrid').innerHTML, /data-price="6400"/);
    assert.equal(app.read('currentSimData.unitPrice'), 6400);
    assert.equal(app.read('currentSimData.additionalItems[0].unitPrice'), 6350);
    assert.equal(app.read('currentSimData.cashPrice'), 19100);
  }
  assert.equal(app.errors.length, 0);
});
