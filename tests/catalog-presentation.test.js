const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf8');
const modeSource = source.slice(source.indexOf('let isClientMode ='), source.indexOf('window.shareClientCatalogLink ='));

function setup(user, pathname = '/') {
  const classes = new Set();
  const elements = new Map(['catalogHeading', 'catalogDescription', 'catalogModeLabel', 'btnClientMode',
    'txtClientModeBtn'].map(id => [id, { textContent: '', style: {}, attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; }
  }]));
  const context = vm.createContext({ currentUser: user, IS_COST_PAGE: pathname === "/preco-de-custo",
    syncDfuButtons() {},
    syncMobileDrawerActions() {},
    location: { pathname, search: '' },
    document: {
      body: { classList: { toggle(name, value) { value ? classes.add(name) : classes.delete(name); } } },
      getElementById: id => elements.get(id)
    },
    switchView: view => { context.selectedView = view; }
  });
  context.window = context;
  vm.runInContext(modeSource + '\ninitClientModeCheck();', context);
  return { context, classes, elements };
}

test('visitors see the customer catalog without a store mode toggle', () => {
  const app = setup(null);
  assert.equal(app.elements.get('catalogModeLabel').textContent, 'CATÁLOGO APPLE');
  assert.equal(app.elements.get('btnClientMode').style.display, 'none');
  assert.equal(app.classes.has('session-authenticated'), false);
  app.context.toggleClientMode();
  assert.equal(app.elements.get('btnClientMode').style.display, 'none');
});

test('store users can present the customer view and return without logging out', () => {
  const user = { username: 'store-user' };
  const app = setup(user);
  assert.equal(app.elements.get('catalogModeLabel').textContent, 'ÁREA DA LOJA');
  assert.equal(app.elements.get('btnClientMode').style.display, 'inline-flex');
  app.context.toggleClientMode();
  assert.equal(app.classes.has('client-mode-active'), true);
  assert.equal(app.classes.has('session-authenticated'), true);
  assert.equal(app.elements.get('catalogModeLabel').textContent, 'CATÁLOGO APPLE');
  assert.equal(app.elements.get('txtClientModeBtn').textContent, 'Voltar à loja');
  assert.equal(app.elements.get('btnClientMode').attributes['aria-pressed'], 'true');
  assert.equal(app.context.selectedView, 'storefront');
  assert.equal(app.context.currentUser, user);
  app.context.toggleClientMode();
  assert.equal(app.classes.has('client-mode-active'), false);
  assert.equal(app.elements.get('catalogModeLabel').textContent, 'ÁREA DA LOJA');
  assert.equal(app.elements.get('btnClientMode').attributes['aria-pressed'], 'false');
});

test('the shared catalog opens in customer mode, including with an existing login', () => {
  const app = setup({ username: 'store-user' }, '/catalogo');
  assert.equal(app.classes.has('client-mode-active'), true);
  assert.equal(app.elements.get('catalogModeLabel').textContent, 'CATÁLOGO APPLE');
  assert.equal(app.context.selectedView, 'storefront');
  app.context.currentUser = null;
  app.context.updateCatalogPresentation();
  assert.equal(app.classes.has('session-authenticated'), false);
  assert.equal(app.elements.get('btnClientMode').style.display, 'none');
});

test('only CPO and Android products are blocked while ativados, AS IS and Apple items are allowed', () => {
  const PricingCore = require('../public/js/pricing-core.js');

  const allowedSamples = [
    { name: 'IPHONE 16 PRO MAX 256GB ATIVADO', category: 'IPH', price: 6500 },
    { name: 'IPHONE 17 PRO MAX AS IS', category: 'SEMI', price: 6750 },
    { name: 'APPLE TV 4K 64GB WI-FI', category: 'ACSS', price: 1200 },
    { name: 'IPHONE 16 PRO 128GB TITÂNIO NATURAL', category: 'IPH', price: 6800 },
    { name: 'IPHONE 13 SEMI-NOVO', category: 'SEMI', price: 1850 }
  ];

  for (const sample of allowedSamples) {
    assert.equal(PricingCore.isDisallowedProduct(sample), false, `Deveria permitir no catálogo: ${sample.name}`);
  }

  const blockedSamples = [
    { name: 'IPHONE 15 CPO', category: 'IPH', price: 3500 },
    { name: 'APPLE WATCH ULTRA 3 CPO', category: 'RLG', price: 4500 },
    { name: 'HOTWAV A17 PRO MAX', category: 'HOTWAV', price: 650 },
    { name: 'SAMSUNG S24 ULTRA', category: 'SAMSUNG', price: 5000 },
    { name: 'XIAOMI REDMI NOTE 13', category: 'NOTE', price: 1200 }
  ];

  for (const sample of blockedSamples) {
    assert.equal(PricingCore.isDisallowedProduct(sample), true, `Deveria bloquear do catálogo: ${sample.name}`);
  }
});
