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
  const context = vm.createContext({ currentUser: user,
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

test('activated products and models are strictly blocked from the search engine and catalog', () => {
  const PricingCore = require('../public/js/pricing-core.js');

  const blockedSamples = [
    { name: 'IPHONE 16 PRO MAX 256GB ATIVADO', category: 'IPH', price: 6500 },
    { name: 'IPHONE 15 128GB BLACK (ATIVADO)', category: 'IPH', price: 4200 },
    { name: 'IPHONE 14 128GB ESTELAR ATIV.', category: 'IPH', price: 3400 },
    { name: 'IPHONE 13 128GB ATV', category: 'IPH', price: 2900 },
    { name: 'IPHONE 15 PRO JÁ ATIVADO', category: 'IPH', price: 5000 },
    { name: 'IPHONE 16 DESLACRADO ATIVADO', category: 'IPH', price: 5100 },
    { name: 'IPHONE 16 PRO 128GB', category: 'ATIVADO', price: 5500 },
    { name: 'IPHONE 15 PRO', category: 'ATV', price: 4800 },
    { name: 'IPHONE 14 PRO', category: 'IPH', condition: 'ATIVADO', price: 4100 },
    { name: 'IPHONE 15', category: 'IPH', description: 'Aparelho novo ativado no exterior', price: 4000 }
  ];

  for (const sample of blockedSamples) {
    assert.equal(PricingCore.isAtivadoProduct(sample), true, `Deveria detectar como ativado: ${sample.name}`);
    assert.equal(PricingCore.isDisallowedProduct(sample), true, `Deveria bloquear do catálogo: ${sample.name}`);
  }

  // Garantir que Apple TV legítima NÃO é bloqueada indevidamente
  const allowedAppleTv = { name: 'APPLE TV 4K 64GB WI-FI', category: 'ACSS', price: 1200 };
  assert.equal(PricingCore.isAtivadoProduct(allowedAppleTv), false);
  assert.equal(PricingCore.isDisallowedProduct(allowedAppleTv), false);

  // Garantir que iPhone novo lacrado é permitido
  const allowedIphone = { name: 'IPHONE 16 PRO 128GB TITÂNIO NATURAL', category: 'IPH', price: 6800 };
  assert.equal(PricingCore.isAtivadoProduct(allowedIphone), false);
  assert.equal(PricingCore.isDisallowedProduct(allowedIphone), false);
});
