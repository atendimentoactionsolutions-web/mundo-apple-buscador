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

test('catalog sanitizer blocks CPO, Ativado and Android while allowing AS IS and iPhone seminovos', () => {
  const dirtyItems = [
    { id: '1', name: 'IPHONE 17 PRO MAX', category: 'IPH', price: 6920, storage: '256GB', color: 'BLUE', priceDate: '07-11' },
    { id: '2', name: 'SAMSUNG S24 ULTRA', category: 'SAMSUNG', price: 5000, storage: '256GB' }, // Android (bloqueado)
    { id: '2b', name: 'HOTWAV A17 PRO MAX', category: 'HOTWAV', price: 650, storage: '128/4' }, // Hotwav Android (bloqueado)
    { id: '3', name: 'IPHONE 16 PRO ATIVADO', category: 'IPH', price: 4000, storage: '128GB', priceDate: '07-11' }, // Ativado (bloqueado)
    { id: '4', name: 'IPHONE 15 CPO', category: 'IPH', price: 3500, storage: '128GB' }, // CPO (bloqueado)
    { id: '5', name: 'IPHONE 14 PRO AS IS', category: 'IPH', price: 3000, storage: '128GB', priceDate: '07-11' }, // AS IS (permitido em Seminovos)
    { id: '6', name: 'IPHONE 12 SEMI NOVO', category: 'SEMI', price: 2100, storage: '128GB' }, // Seminovo permitido
    { id: '6b', name: 'IPHONE 13 MINI SEMI NOVO', category: 'SEMI', price: 2300, storage: '128GB' }, // Seminovo permitido
    { id: '6c', name: 'IPHONE 15 PRO SEMI NOVO', category: 'SEMI', price: 4500, storage: '512GB' }, // Seminovo permitido
    { id: '6d', name: 'IPHONE 13 SEMI NOVO', category: 'SEMI', price: 2500, storage: '128GB', color: 'MIDNIGHT', priceDate: '07-11' }, // Seminovo permitido
    { id: '7', name: 'IPHONE 17 PRO MAX', category: 'IPH', price: 0, storage: '256GB' }, // Preço Zero
    { id: '8', name: 'IPHONE 17 PRO MAX', category: 'IPH', price: 6920, storage: '256GB', color: 'BLUE', priceDate: '06-11' }, // Stale ontem
    { id: '1', name: 'IPHONE 17 PRO MAX', category: 'IPH', price: 6920, storage: '256GB', color: 'BLUE', priceDate: '07-11' } // Duplicata de 1
  ];

  const { cleanProducts, auditReport } = sanitizeCatalog(dirtyItems, { strictTodayOnly: true, todayDateStr: '07-11' });

  assert.equal(cleanProducts.length, 6);
  assert.equal(cleanProducts[0].id, '1');
  assert.equal(cleanProducts[0].name, 'IPHONE 17 PRO MAX');
  assert.equal(cleanProducts[0].price, 6920);
  assert.equal(cleanProducts.some(p => p.id === '3'), false);

  const asIsItem = cleanProducts.find(p => p.id === '5');
  assert.ok(asIsItem);
  assert.equal(asIsItem.isSeminovo, true);
  assert.equal(asIsItem.condition, 'SEMINOVO');

  const semiItem = cleanProducts.find(p => p.id === '6d');
  assert.ok(semiItem);
  assert.equal(semiItem.isSeminovo, true);
  assert.equal(semiItem.condition, 'SEMINOVO');

  assert.equal(auditReport.anomalies.androidBlocked, 2);
  assert.equal(auditReport.anomalies.ativadoBlocked, 1);
  assert.equal(auditReport.anomalies.cpoBlocked, 1);
  assert.equal(auditReport.anomalies.asIsBlocked, 0);
  assert.equal(auditReport.anomalies.seminovoBlocked, 0);
  assert.equal(auditReport.anomalies.invalidPrice, 1);
  assert.equal(auditReport.anomalies.staleDateBlocked, 1);
  assert.equal(auditReport.anomalies.duplicateFixed, 1);
  assert.equal(auditReport.passed, true);
});
