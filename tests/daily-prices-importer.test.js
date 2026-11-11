const test = require('node:test');
const assert = require('node:assert/strict');
const { parsePrice, parseSupplierLine, processDailyPricesText } = require('../lib/daily-prices-importer.js');

test('daily prices importer parses price formats accurately', () => {
  assert.equal(parsePrice('Custo R$ 1.499,00'), 1499);
  assert.equal(parsePrice('Custo R$ 1.049,99'), 1049.99);
  assert.equal(parsePrice('R$ 650,00'), 650);
  assert.equal(parsePrice('650'), 650);
  assert.equal(parsePrice('invalid'), null);
});

test('daily prices importer strictly blocks Hotwav and Android products', () => {
  const line1 = 'HOTWAV A17 PRO MAX • 128/4 • SILVER • Custo R$ 650,00';
  const line2 = 'HOTWAV A18 PRO MAX • 256/6 • BLACK • Custo R$ 1.040,00';
  const line3 = 'SAMSUNG S24 ULTRA • 256GB • TITANIUM • Custo R$ 5.000,00';

  const res1 = parseSupplierLine(line1);
  const res2 = parseSupplierLine(line2);
  const res3 = parseSupplierLine(line3);

  assert.equal(res1.isBlocked, true);
  assert.equal(res1.reason, 'HOTWAV_ANDROID');
  assert.equal(res2.isBlocked, true);
  assert.equal(res2.reason, 'HOTWAV_ANDROID');
  assert.equal(res3.isBlocked, true);
  assert.equal(res3.reason, 'HOTWAV_ANDROID');
});

test('daily prices importer strictly blocks Seminovos', () => {
  const line1 = 'IPHONE 15 PRO SEMI NOVO • 128GB • BLUE • Custo R$ 4.200,00';
  const line2 = 'IPHONE 13 VITRINE • 128GB • MIDNIGHT • Custo R$ 2.400,00';

  const res1 = parseSupplierLine(line1);
  const res2 = parseSupplierLine(line2);

  assert.equal(res1.isBlocked, true);
  assert.equal(res1.reason, 'SEMINOVO');
  assert.equal(res2.isBlocked, true);
  assert.equal(res2.reason, 'SEMINOVO');
});

test('daily prices importer correctly parses valid Apple Novos and creates official products', () => {
  const line = 'IPHONE 16 PRO MAX • 256GB • BLACK TITANIUM • Custo R$ 6.100,00 • Baixa disponibilidade: 2 fornecedores';
  const res = parseSupplierLine(line, { dateStr: '11-11' });

  assert.equal(res.isBlocked, undefined);
  assert.equal(res.name, 'IPHONE 16 PRO MAX');
  assert.equal(res.storage, '256GB');
  assert.equal(res.color, 'BLACK TITANIUM');
  assert.equal(res.price, 6100);
  assert.equal(res.category, 'IPH');
  assert.equal(res.condition, 'NOVO');
  assert.equal(res.isSeminovo, false);
  assert.equal(res.dispCount, 2);
  assert.equal(res.priceDate, '11-11');
});

test('daily prices importer processes batch text and reports block stats', () => {
  const text = `
    APPLE TV 4K • 128GB • Sem cor • Custo R$ 1.499,00
    HOTWAV A17 PRO MAX • 128/4 • SILVER • Custo R$ 650,00
    IPHONE 14 SEMI NOVO • 128GB • MIDNIGHT • Custo R$ 2.800,00
    IPAD 11 WIFI • 128GB • BLUE • Custo R$ 2.740,00
  `;

  const { success, products, stats } = processDailyPricesText(text, { dateStr: '11-11' });

  assert.equal(success, true);
  assert.equal(products.length, 2);
  assert.equal(stats.accepted, 2);
  assert.equal(stats.blockedHotwav, 1);
  assert.equal(stats.blockedSeminovos, 1);
});
