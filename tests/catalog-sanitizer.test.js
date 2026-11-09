const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeCatalog, isValidPrice, sanitizeStorage, sanitizeColor } = require('../lib/catalog-sanitizer.js');

test('catalog sanitizer validates prices correctly', () => {
  assert.equal(isValidPrice(100), true);
  assert.equal(isValidPrice('6920'), true);
  assert.equal(isValidPrice(0), false);
  assert.equal(isValidPrice(-50), false);
  assert.equal(isValidPrice(NaN), false);
  assert.equal(isValidPrice(null), false);
  assert.equal(isValidPrice(150000), false); // Absurdo
});

test('catalog sanitizer normalizes storage and color strings', () => {
  assert.equal(sanitizeStorage(' 256 gb '), '256GB');
  assert.equal(sanitizeStorage('1 tb'), '1TB');
  assert.equal(sanitizeColor(' cosmic orange '), 'COSMIC ORANGE');
});

test('catalog sanitizer strictly filters ativados, android, cpo, and seminovos', () => {
  const dirtyItems = [
    { id: '1', name: 'IPHONE 17 PRO MAX', category: 'IPH', price: 6920, storage: '256GB', color: 'BLUE', priceDate: '07-11' },
    { id: '2', name: 'SAMSUNG S24 ULTRA', category: 'SAMSUNG', price: 5000, storage: '256GB' }, // Android
    { id: '3', name: 'IPHONE 16 PRO ATIVADO', category: 'IPH', price: 4000, storage: '128GB' }, // Ativado
    { id: '4', name: 'IPHONE 15 CPO', category: 'IPH', price: 3500, storage: '128GB' }, // CPO
    { id: '5', name: 'IPHONE 14 PRO AS IS', category: 'IPH', price: 3000, storage: '128GB' }, // AS IS
    { id: '6', name: 'IPHONE 13 SEMI NOVO', category: 'SEMI', price: 2500, storage: '128GB' }, // Seminovo
    { id: '7', name: 'IPHONE 17 PRO MAX', category: 'IPH', price: 0, storage: '256GB' }, // Preço Zero
    { id: '8', name: 'IPHONE 17 PRO MAX', category: 'IPH', price: 6920, storage: '256GB', color: 'BLUE', priceDate: '06-11' }, // Stale ontem
    { id: '1', name: 'IPHONE 17 PRO MAX', category: 'IPH', price: 6920, storage: '256GB', color: 'BLUE', priceDate: '07-11' } // Duplicata de 1
  ];

  const { cleanProducts, auditReport } = sanitizeCatalog(dirtyItems, { strictTodayOnly: true, todayDateStr: '07-11' });

  assert.equal(cleanProducts.length, 1);
  assert.equal(cleanProducts[0].id, '1');
  assert.equal(cleanProducts[0].name, 'IPHONE 17 PRO MAX');
  assert.equal(cleanProducts[0].price, 6920);

  assert.equal(auditReport.anomalies.androidBlocked, 1);
  assert.equal(auditReport.anomalies.ativadoBlocked, 1);
  assert.equal(auditReport.anomalies.cpoBlocked, 1);
  assert.equal(auditReport.anomalies.asIsBlocked, 1);
  assert.equal(auditReport.anomalies.seminovoBlocked, 1);
  assert.equal(auditReport.anomalies.invalidPrice, 1);
  assert.equal(auditReport.anomalies.staleDateBlocked, 1);
  assert.equal(auditReport.anomalies.duplicateFixed, 1);
  assert.equal(auditReport.passed, true);
});
