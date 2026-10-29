const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const jspdf = require('../public/js/jspdf.umd.min');
const core = require('../public/js/quote-core');

const plugin = { exports: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/js/jspdf.plugin.autotable.min.js'), 'utf8'), {
  module: plugin, exports: plugin.exports, require: () => jspdf
});

test('PDF exports keep totals inside the page and number every generated page', () => {
  for (const count of [1, 13, 40]) {
    const texts = [];
    function TrackedPDF(options) {
      const doc = new jspdf.jsPDF(options);
      const originalText = doc.text.bind(doc);
      doc.text = (text, x, y, ...rest) => {
        if (typeof y === 'number') texts.push({ text, y, page: doc.internal.getCurrentPageInfo().pageNumber });
        return originalText(text, x, y, ...rest);
      };
      return doc;
    }
    const context = vm.createContext({ window: { jspdf: { jsPDF: TrackedPDF } }, document: { addEventListener() {} } });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/js/quotes-module.js'), 'utf8'), context);
    const items = Array.from({ length: count }, (_, index) => ({ name: `iPhone ${index + 1}`, unitPrice: 8000, quantity: 1, subtotal: 8000, color: 'BLUE', storage: '256GB' }));
    const totals = core.totals(items).totals;
    const doc = context.generateQuotePDFDoc({ code: 'TEST', customer: { name: 'Test Customer' }, items, totals,
      totalAmount: totals.netTotal, tradeIn: { hasTradeIn: true, tradeInAmount: 500, modelName: 'iPhone 13' },
      paymentTerms: { cashDownPayment: 500, commercialConditions: 'Pagamento no PIX ou no cartão.' } });
    const pageCount = doc.getNumberOfPages();
    if (count === 40) assert.ok(pageCount > 1);
    assert.equal(texts.filter(item => String(item.text).startsWith('Página ')).length, pageCount);
    assert.ok(texts.every(item => item.y >= 0 && item.y <= doc.internal.pageSize.getHeight()), 'No text starts outside a page');
    assert.ok(doc.output('arraybuffer').byteLength > 1000);
  }
});
