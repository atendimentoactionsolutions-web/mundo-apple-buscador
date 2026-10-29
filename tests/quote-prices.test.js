const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const quoteSource = fs.readFileSync(path.join(__dirname, '../public/js/quotes-module.js'), 'utf8');
const appSource = fs.readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf8');
const helpers = ['parseCurrencyInput', 'formatCurrencyInput', 'calculateInstallment'].map(name => {
  const start = appSource.indexOf(`function ${name}(`);
  return appSource.slice(start, appSource.indexOf('\n}', start) + 2);
}).join('\n');

function setup(user = { role: 'admin' }) {
  const elements = new Map(['qbItemsList', 'qbInstallmentsList', 'qbItemSubtotal-0', 'qbSummaryNet',
    'qbSummaryBalanceCard', 'qbCustomerName', 'quoteBuilderModal'].map(id => [id, {
    innerHTML: '', textContent: '', value: id === 'qbCustomerName' ? 'Cliente Teste' : '',
    style: {}, classList: { add() {}, remove() {} }
  }]));
  const context = vm.createContext({ currentUser: user, console,
    cardRates: { baseRate: 0, installmentRates: { 1: 0 } },
    document: { getElementById: id => elements.get(id) || null, addEventListener() {} },
    alert() {},
    open: url => { context.openedUrl = url; }
  });
  context.window = context;
  vm.runInContext(helpers + '\n' + quoteSource, context);
  vm.runInContext(`
    currentBuilderData.items = [
      { productId: 'a', name: 'iPhone 17 Pro', color: 'BLUE', storage: '256GB', quantity: 2,
        unitPrice: 1000, discountType: 'PERCENT', discountValue: 10 },
      { productId: 'b', name: 'AirPods Pro', quantity: 1, unitPrice: 500, discountType: 'FIXED', discountValue: 50 }
    ];
    currentBuilderData.items.forEach(calculateSingleItemSubtotal);
    currentBuilderData.tradeIn = { hasTradeIn: true, tradeInAmount: 200 };
    currentBuilderData.discount = { type: 'FIXED', value: 100 };
    currentBuilderData.paymentTerms.cashDownPayment = 300;
    renderBuilderItemsList();
    recalculateQuoteTotals();
  `, context);
  return { context, elements, data: () => vm.runInContext('currentBuilderData', context) };
}

test('admin can edit each unit price without losing focus or other product settings', () => {
  const app = setup();
  const initialMarkup = app.elements.get('qbItemsList').innerHTML;
  assert.match(initialMarkup, /id="qbItemUnitPrice-0"/);
  assert.match(initialMarkup, /id="qbItemUnitPrice-1"/);
  const input = { value: '120055' };
  app.context.onItemUnitPriceInput(0, input);
  assert.equal(input.value, '1.200,55');
  assert.equal(app.data().items[0].unitPrice, 1200.55);
  assert.equal(app.data().items[0].subtotal, 2160.99);
  assert.equal(app.data().items[0].quantity, 2);
  assert.equal(app.data().items[0].color, 'BLUE');
  assert.equal(app.data().items[1].unitPrice, 500);
  assert.equal(app.data().totalAmount, 2310.99);
  assert.equal(app.data().paymentTerms.installmentOptions[0].monthlyAmount, 2010.99);
  assert.equal(app.elements.get('qbItemSubtotal-0').textContent.replace(/\s/g, ''), 'R$2.160,99');
  assert.equal(app.elements.get('qbItemsList').innerHTML, initialMarkup);
  app.context.updateItemQuantity(0, 1);
  assert.equal(app.data().items[0].unitPrice, 1200.55);
  assert.match(app.elements.get('qbItemsList').innerHTML, /value="1.200,55"/);
});

test('editing prices is not offered to non-admin users or visitors', () => {
  for (const user of [{ role: 'lojista' }, null]) {
    const app = setup(user);
    assert.doesNotMatch(app.elements.get('qbItemsList').innerHTML, /id="qbItemUnitPrice-/);
    app.context.onItemUnitPriceInput(0, { value: '120055' });
    assert.equal(app.data().items[0].unitPrice, 1000);
  }
});

test('invalid prices are ignored and discounts do not make an item negative', () => {
  const app = setup();
  for (const value of ['-100', '9'.repeat(400)]) {
    app.context.onItemUnitPriceInput(0, { value });
    assert.equal(app.data().items[0].unitPrice, 1000);
  }
  app.context.onItemUnitPriceInput(99, { value: '100' });
  app.context.onItemUnitPriceInput(1, { value: '1000' });
  assert.equal(app.data().items[1].unitPrice, 10);
  assert.equal(app.data().items[1].subtotal, 0);
});

test('saving and reopening retain negotiated prices, cents and the WhatsApp total', async t => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mundo-apple-quotes-test-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(tempRoot)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(tempRoot).startsWith('mundo-apple-quotes-test-'));
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });
  const managerContext = vm.createContext({ require, console, __dirname: tempRoot, module: { exports: {} } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../quotes.js'), 'utf8'), managerContext);
  const manager = managerContext.module.exports;
  const app = setup();
  app.context.fetch = async (url, options) => {
    if (options?.method === 'POST') {
      const quote = manager.createQuote(JSON.parse(options.body), { id: 'test', username: 'admin' });
      return { json: async () => ({ success: true, quote }) };
    }
    return { json: async () => ({ success: true, ...manager.listQuotes() }) };
  };
  app.context.onItemUnitPriceInput(0, { value: '120055' });
  await app.context.saveCurrentQuote();
  const saved = manager.listQuotes().quotes[0];
  assert.equal(saved.items[0].unitPrice, 1200.55);
  assert.equal(saved.totalAmount, 2310.99);
  app.context.editQuote(saved.id);
  assert.equal(app.data().items[0].unitPrice, 1200.55);
  assert.match(app.elements.get('qbItemsList').innerHTML, /value="1.200,55"/);
  app.context.shareQuoteWhatsApp(saved.id);
  assert.match(decodeURIComponent(app.context.openedUrl), /2\.310,99/);
  const updated = manager.updateQuote(saved.id, { totalAmount: 0, totals: { netTotal: 0 } });
  assert.equal(updated.totalAmount, 0);
  assert.equal(manager.getQuoteById(saved.id).totalAmount, 0);
});
