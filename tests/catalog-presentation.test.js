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
