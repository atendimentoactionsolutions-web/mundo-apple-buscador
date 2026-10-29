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
    'simHeroCardVal', 'simCashInput', 'simColorDot', 'simAdditionalItems', 'simBundleSummary', 'simBundleGross',
    'simProductResults', 'simProductPicker', 'simProductSearch', 'simAddProductButton', 'simEntryInput', 'simTradeInValue',
    'simAdditionalSubtotal-0'].map(id => [id, {
    innerHTML: '', value: '', style: {}, hidden: true, focus() {}, setAttribute() {}, classList: { add() {} }
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

test('the picker adds another product with its catalog price and copies the combined quote', async () => {
  const app = setup([
    product('BLACK', 6000),
    product('WHITE', 1200, { name: 'AIRPODS PRO', storage: '', category: 'PODS' }),
    product('WHITE', 1000, { name: 'AIRPODS PRO', storage: '', category: 'PODS' })
  ]);
  app.open();
  assert.match(app.elements.get('cardSimulatorBody').innerHTML, /Adicionar outro produto/);
  app.context.toggleSimProductPicker();
  assert.equal(app.elements.get('simProductPicker').hidden, false);
  app.context.searchSimProducts('airpods white');
  assert.match(app.elements.get('simProductResults').innerHTML, /AIRPODS PRO/);
  const index = app.data().catalogOptions.findIndex(option => option.model === 'AIRPODS PRO');
  assert.equal(app.data().catalogOptions.filter(option => option.model === 'AIRPODS PRO').length, 1);
  app.context.addSimProduct(index);
  const additional = app.data().additionalItems[0];
  assert.equal(additional.unitPrice, 1400);
  assert.equal(app.data().cashPrice, 8150);
  assert.equal(app.elements.get('simBundleSummary').hidden, false);
  app.context.handleSimDiscountValueInput({ value: '150' });
  app.context.handleSimEntryInput({ value: '100000' });
  assert.equal(app.data().cashPrice, 8000);
  await app.context.copyCardSimulationToWhatsApp();
  assert.match(app.context.copied, /PRODUTOS DA COTAÇÃO/);
  assert.match(app.context.copied, /1\. IPHONE 17 PRO \(256GB\)/);
  assert.match(app.context.copied, /2\. AIRPODS PRO/);
  assert.match(app.context.copied, /8\.000,00/);
  assert.match(app.context.copied, /7\.000,00/);
  assert.match(app.context.copied, /18x de/);
});

test('additional quantities, editable prices, removal and reopening keep totals consistent', () => {
  const app = setup([product('BLACK', 6000), product('WHITE', 1000, { name: 'AIRPODS PRO', category: 'PODS', storage: '' })]);
  app.open();
  const index = app.data().catalogOptions.findIndex(option => option.model === 'AIRPODS PRO');
  app.context.addSimProduct(index);
  app.context.addSimProduct(index);
  assert.equal(app.data().additionalItems.length, 1);
  assert.equal(app.data().additionalItems[0].quantity, 2);
  const markup = app.elements.get('simAdditionalItems').innerHTML;
  app.context.updateSimProductPrice(0, { value: '125055' });
  assert.equal(app.data().additionalItems[0].unitPrice, 1250.55);
  assert.equal(app.data().cashPrice, 9251.1);
  assert.equal(app.elements.get('simAdditionalItems').innerHTML, markup, 'Typing does not recreate the active field');
  app.context.updateSimProductQuantity(0, { value: '3' });
  assert.equal(app.data().cashPrice, 10501.65);
  app.context.handleSimEntryInput({ value: '900000' });
  app.context.removeSimProduct(0);
  assert.equal(app.data().additionalItems.length, 0);
  assert.equal(app.data().cashPrice, 6750);
  assert.equal(app.data().entryAmount, 6750);
  assert.equal(app.elements.get('simBundleSummary').hidden, true);
  app.context.addSimProduct(index);
  app.open();
  assert.equal(app.data().additionalItems.length, 0);
  assert.equal(app.data().cashPrice, 6750);
});

test('adding the same primary variant increases its quantity instead of duplicating it', () => {
  const app = setup([product('BLACK', 6000)]);
  app.open();
  app.context.addSimProduct(0);
  assert.equal(app.data().quantity, 2);
  assert.equal(app.data().additionalItems.length, 0);
  assert.equal(app.data().cashPrice, 13500);
});

test('client mode can include additional retail products without editing their price', async () => {
  const app = setup([product('WHITE', 1000, { name: 'AIRPODS PRO', category: 'PODS', storage: '' })], null);
  app.context.IS_CATALOG_SHIELDED = true;
  app.open();
  app.context.addSimProduct(0);
  assert.equal(app.data().additionalItems[0].unitPrice, 1000);
  app.context.updateSimProductPrice(0, { value: '100' });
  assert.equal(app.data().additionalItems[0].unitPrice, 1000);
  assert.doesNotMatch(app.elements.get('simAdditionalItems').innerHTML, /updateSimProductPrice/);
  await app.context.copyCardSimulationToWhatsApp();
  assert.match(app.context.copied, /AIRPODS PRO/);
  assert.match(app.context.copied, /7\.750,00/);
});

test('mixed new and seminovo items retain the chosen configuration in the copied quote', async () => {
  const app = setup([product('BLUE', 4000, { name: 'IPHONE 16 PRO', isSeminovo: true, region: '' })]);
  app.open();
  app.context.addSimProduct(0);
  await app.context.copyCardSimulationToWhatsApp();
  assert.match(app.context.copied, /IPHONE 16 PRO \(Seminovo\) \(256GB\)/);
  assert.match(app.context.copied, /Cor: BLUE/);
  assert.match(app.context.copied, /90 dias da loja para seminovos/);
  app.context.searchSimProducts('produto inexistente');
  assert.match(app.elements.get('simProductResults').innerHTML, /Nenhum produto encontrado/);
});
