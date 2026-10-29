const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../public/js/quote-core');
const pricing = require('../public/js/pricing-core');

test('quote calculations retain cents and cap deductions at the amount due', () => {
  const items = [{ unitPrice: 1200.55, quantity: 2, discountType: 'PERCENT', discountValue: 10 }];
  assert.equal(core.itemSubtotal(items[0]), 2160.99);
  const result = core.totals(items, { hasTradeIn: true, tradeInAmount: 5000 }, { type: 'FIXED', value: 100 }, { cashDownPayment: 10000 });
  assert.equal(result.totals.netTotal, 0);
  assert.equal(result.totals.tradeInDeduction, 2160.99);
  assert.equal(result.cashDownPayment, 0);
  assert.equal(result.financedAmount, 0);
});

test('invalid amounts, quantities and card rates cannot produce invalid totals', () => {
  for (const value of [-1, Infinity, NaN, 'abc']) assert.throws(() => core.amount(value));
  for (const value of [0, 100, 1.5, Infinity]) assert.throws(() => core.quantity(value));
  assert.throws(() => core.installment(100, 0, 1, { baseRate: 99, installmentRates: { 1: 1 } }));
  assert.equal(core.installment(100.55, 0, 1, { baseRate: 0, installmentRates: { 1: 0 } }).monthlyAmount, 100.55);
});

test('seminovo margins apply to newer iPhone families, with model overrides preserved', () => {
  const margins = { categories: { IPH18: 1300, SEMINOVOS: 600 }, products: {} };
  assert.equal(pricing.getProductMargin('IPHONE 18 PRO', 'IPH', true, margins), 600);
  assert.equal(pricing.getProductMargin('IPHONE 18 PRO', 'IPH', false, margins), 1300);
  margins.products['IPHONE 18 PRO'] = 700;
  assert.equal(pricing.getProductMargin('IPHONE 18 PRO', 'IPH', true, margins), 700);
});
