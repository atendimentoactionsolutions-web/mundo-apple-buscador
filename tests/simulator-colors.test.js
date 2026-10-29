const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const PricingCore = require('../public/js/pricing-core');

const source = fs.readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf8');
const simulator = source.slice(source.indexOf('let currentSimData ='), source.indexOf('// Card Simulator Modal Close Logic'));
const helpers = ['escapeHtml', 'formatBRL', 'getAppleColorHex', 'cleanModelName', 'getMacBookRam',
  'isCpoProduct', 'isAsIsProduct', 'isDisallowedProduct', 'isDisallowedSeminovo',
  'isSeminovoProduct', 'calculateSupplierReferencePrice', 'applyDFU', 'getProductMargin'];
const helperSource = helpers.map(name => {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `Helper ${name} exists`);
  return source.slice(start, source.indexOf('\n}', start) + 2);
}).join('\n');

function product(color, price, extra = {}) {
  return { name: 'IPHONE 17 PRO', storage: '256GB', category: 'IPH', color, price, ...extra };
}

function setup(products, user = { username: 'cledson' }) {
  const elements = new Map(['cardSimulatorModal', 'cardSimulatorBody', 'simInstallmentsGrid',
    'simHeroCardVal', 'simCashInput', 'simColorDot'].map(id => [id, {
    innerHTML: '', value: '', style: {}, classList: { add() {} }
  }]));
  const context = vm.createContext({
    allProducts: products, currentUser: user, PricingCore, QuoteCore: require('../public/js/quote-core'),
    IS_CATALOG_SHIELDED: false, DFU_ACTIVE: user?.username === 'admin',
    margins: { categories: { IPH: 750, SEMINOVOS: 600, MCB_AIR: 1000 }, products: {} },
    cardRates: { baseRate: 2.69, installmentRates: { 1: 3.05, 2: 1.5 } },
    localStorage: { getItem: () => user?.username || '' },
    document: { getElementById: id => elements.get(id) || null },
    robustCopyToClipboard: async text => { context.copied = text; },
    alert() {}, setTimeout() {}
  });
  context.window = context;
  PricingCore.setDfuActive(user?.username === 'admin');
  vm.runInContext(helperSource + '\n' + simulator, context);
  return {
    context, elements,
    data: () => vm.runInContext('currentSimData', context),
    open: (model = 'IPHONE 17 PRO', storage = '256GB', color = 'BLACK', price = 6750, ram = '') =>
      context.openCardSimulator(...[model, storage, color].map(encodeURIComponent), price, encodeURIComponent(ram))
  };
}

test('logged-in selector uses all matching colors, keeping model, capacity and condition separate', () => {
  const app = setup([
    product('BLACK', 6000), product('BLUE', 6200), product('blue', 6400),
    product('PURPLE', 6500, { storage: '512GB' }),
    product('GREEN', 5000, { isSeminovo: true }),
    product('WHITE', 6400, { name: 'IPHONE 17 PRO MAX' }), product('ORANGE', 0)
  ]);
  app.open();
  const options = app.data().colorOptions;
  assert.equal(options.length, 2);
  assert.equal(options.find(o => o.color === 'BLUE').price, 6950);
  assert.equal(options.find(o => o.color === 'BLACK').price, 6750);
  assert.match(app.elements.get('cardSimulatorBody').innerHTML, /id="simColorSelect"/);
});

test('changing color recalculates installments, preserves negotiation and exports the selected color', async () => {
  const app = setup([product('BLACK', 6000), product('BLUE', 6200)]);
  app.open();
  app.context.handleSimQtyStep(1);
  app.context.handleSimDiscountValueInput({ value: '100' });
  app.context.handleSimEntryInput({ value: '100000' });
  app.context.handleSimTradeInToggle({ checked: true });
  app.context.handleSimTradeInValueInput({ value: '50000' });
  const oldInstallments = app.elements.get('simInstallmentsGrid').innerHTML;
  app.context.handleSimColorChange({ value: 'BLUE' });
  assert.equal(app.data().color, 'BLUE');
  assert.equal(app.data().unitPrice, 6950);
  assert.equal(app.data().quantity, 2);
  assert.equal(app.data().discountValue, 100);
  assert.equal(app.data().entryAmount, 1000);
  assert.equal(app.data().tradeInAmount, 500);
  assert.equal(app.data().cashPrice, 13800);
  assert.equal(app.elements.get('simCashInput').value, '6.950,00');
  assert.notEqual(app.elements.get('simInstallmentsGrid').innerHTML, oldInstallments);
  assert.equal(app.elements.get('simColorDot').style.backgroundColor, app.context.getAppleColorHex('BLUE'));
  await app.context.copyCardSimulationToWhatsApp();
  assert.match(app.context.copied, /Cor: BLUE/);
  assert.match(app.context.copied, /13\.800,00/);
  app.context.handleSimColorChange({ value: 'INVALID' });
  assert.equal(app.data().color, 'BLUE');
});

test('visitors retain the static color and cannot change it through the handler', () => {
  const app = setup([product('BLACK', 6000), product('BLUE', 6200)], null);
  app.open();
  assert.doesNotMatch(app.elements.get('cardSimulatorBody').innerHTML, /id="simColorSelect"/);
  app.context.handleSimColorChange({ value: 'BLUE' });
  assert.equal(app.data().color, 'BLACK');
});

test('seminovo prices keep the supplier reference rule and admin pricing', () => {
  const app = setup([product('BLACK', 6000), ...[4000, 4200, 4600, 9000].map(price =>
    product('BLUE', price, { isSeminovo: true }))], { username: 'admin' });
  app.open('IPHONE 17 PRO (Seminovo)');
  assert.equal(app.data().colorOptions.length, 2);
  assert.equal(app.data().colorOptions.find(o => o.color === 'BLUE').price, 5100);
});

test('Mac colors stay within the same RAM configuration', () => {
  const app = setup([
    product('SILVER', 6000, { name: 'MACBOOK AIR M4', category: 'MCB', region: '16GB' }),
    product('BLUE', 6200, { name: 'MACBOOK AIR M4', category: 'MCB', region: '16 GB' }),
    product('GOLD', 6500, { name: 'MACBOOK AIR M4', category: 'MCB', region: '24GB' })
  ]);
  app.open('MACBOOK AIR M4', '256GB', 'SILVER', 7000, '16GB');
  assert.equal(app.data().colorOptions.length, 2);
  assert.equal(app.data().colorOptions.find(o => o.color === 'BLUE').price, 7200);
});

test('free calculator has no product color selector', () => {
  const app = setup([product('BLUE', 6200)]);
  app.context.openFreeCalculator();
  assert.equal(app.data().colorOptions.length, 0);
  assert.doesNotMatch(app.elements.get('cardSimulatorBody').innerHTML, /id="simColorSelect"/);
});
