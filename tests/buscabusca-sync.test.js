const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const candidates = [
  process.env.BUSCABUSCA_CATALOG_MODULE,
  '/opt/disparador-fornecedores/web/catalog.js',
  path.join(__dirname, '../../PROJETO-BUSCABUSCA/web/catalog.js'),
].filter(Boolean);
const catalogPath = candidates.find(p => fs.existsSync(p));
if (catalogPath) process.env.BUSCABUSCA_CATALOG_MODULE = catalogPath;
const { storefrontOffers, createBuscaBuscaSync } = require('../lib/buscabusca-sync.js');

const offer = (o) => ({ data: '25/11/2026', hora: '09:00:00', linhaOriginal: '', ...o });
const feed = [
  offer({ id: 'a', modelo: 'IPHONE 17 PRO MAX', capacidade: '256GB', cor: 'LARANJA', categoria: 'iPhones', condicao: 'Novo / Lacrado', preco: 7800, fornecedor: 'CARO CELL 1111', telefone: '55 11 91111-1111' }),
  offer({ id: 'b', modelo: 'IPHONE 17 PRO MAX', capacidade: '256GB', cor: 'LARANJA', categoria: 'iPhones', condicao: 'Novo / Lacrado', preco: 7500, fornecedor: 'PETRA CELL 8866', telefone: '5511999998866' }),
  offer({ id: 'c', modelo: 'IPHONE 15', capacidade: '128GB', cor: 'ROSA', categoria: 'iPhones', condicao: 'Seminovo', preco: 2500, fornecedor: 'ULTRA PHONE 8812', telefone: '5511988888812' }),
  offer({ id: 'd', modelo: 'HOTWAV A17 PRO MAX', capacidade: '128GB', cor: 'PRETO', categoria: 'Outros', condicao: 'Novo / Lacrado', preco: 680, fornecedor: 'ANDROID SHOP', telefone: '5511955550000' }),
];

test('storefrontOffers keeps the cheapest supplier and WhatsApp per variant and blocks non-Apple', { skip: !catalogPath && 'catalog.js do BuscaBusca indisponível' }, async () => {
  const rows = await storefrontOffers(feed);
  assert.ok(rows.length >= 2);
  assert.equal(rows.filter(r => /HOTWAV/i.test(r.name)).length, 0);
  for (const row of rows) {
    assert.ok(row.supplier && row.supplier.name, `fornecedor ausente em ${row.name}`);
    assert.match(row.supplier.whatsappNumber, /^\d{12,13}$/);
    assert.equal(row.priceSource, 'buscabusca');
  }
  const pro = rows.find(r => /17 pro max/i.test(r.name));
  assert.ok(pro, `iPhone 17 Pro Max ausente: ${rows.map(r => r.name).join(', ')}`);
  assert.equal(pro.sourceBase, 7500);
  assert.equal(pro.supplier.name, 'PETRA CELL 8866');
  assert.equal(pro.price, pro.sourceBase + pro.sourceAdjustment, 'DFU aplicado uma única vez');
  assert.equal(pro.offersCount, 2);
  const semi = rows.find(r => r.isSeminovo);
  assert.equal(semi.category, 'SEMI');
  assert.equal(semi.sourceAdjustment, 0);
});

test('createBuscaBuscaSync holds the previous catalog when the feed is empty after midnight (Opção B)', { skip: !catalogPath && 'catalog.js do BuscaBusca indisponível' }, async () => {
  let products = feed;
  const srv = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ products }));
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  process.env.BUSCABUSCA_PRODUCTS_URL = `http://127.0.0.1:${srv.address().port}/api/products`;
  let current = [];
  const sync = createBuscaBuscaSync({
    getCurrentProducts: () => current,
    getCurrentCount: () => current.length,
    onProductsSynced: async (items) => { current = items; },
  });
  try {
    const first = await sync.syncOnce();
    assert.equal(first.ok, true);
    assert.ok(current.length >= 2);
    assert.ok(sync.getStatus().lastSupplierCount >= 2);
    const before = current;
    products = [];
    const held = await sync.syncOnce();
    assert.equal(held.held, true);
    assert.equal(current, before, 'vitrine não pode zerar na virada do dia');
    assert.equal(sync.getStatus().holdingPreviousCatalog, true);
  } finally {
    delete process.env.BUSCABUSCA_PRODUCTS_URL;
    srv.close();
  }
});
