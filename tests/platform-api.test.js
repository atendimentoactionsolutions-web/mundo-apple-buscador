const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { platform, temporaryProject, isolatedModules } = require('./helpers/platform');
const { importCatalog } = require('../scripts/import-catalog');

const list = 'IPHONE 17 PRO • 256GB • BLUE • Custo R$ 6.000,00\n' +
  'HOTWAV A18 PRO MAX • 128/4 • BLACK • Custo R$ 880,00\n' +
  'IPHONE 16 CPO • 128GB • WHITE • Custo R$ 4.199,00';

test('manual import blocks unwanted products and never replaces the catalog with invalid input', t => {
  const root = temporaryProject(t);
  const result = importCatalog(list, { root, date: '2026-11-12' });
  assert.equal(result.total, 2);
  assert.equal(result.blocked.blockedHotwav, 1);
  assert.equal(result.blocked.blockedOthers, 0);
  const file = path.join(root, 'data/snapshot_latest.json');
  const before = fs.readFileSync(file, 'utf8');
  assert.equal(JSON.parse(before)[0].supplier, null);
  for (const raw of ['', 'unrecognized input', 'HOTWAV A17 • 128/4 • BLACK • Custo R$ 660,00']) {
    assert.throws(() => importCatalog(raw, { root, date: '2026-11-12' }));
    assert.equal(fs.readFileSync(file, 'utf8'), before);
  }
  assert.throws(() => importCatalog(list, { root, date: '2026-02-30' }), /Data inválida/);
});

test('public API uses saved products and DFU without accounts or automatic collection', async t => {
  const app = await platform(t);
  const catalog = await app.request('/api/products');
  assert.equal(catalog.status, 200);
  assert.equal(catalog.body.total, 1);
  assert.equal(catalog.body.isShielded, true);
  const p = catalog.body.data[0];
  assert.equal(p.price, 6850, '6000 cost + 100 DFU + 750 margin');
  assert.equal(p.supplier, null);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(app.root, 'data/users.json'))), []);
  assert.equal((await app.request('/api/auth/me', 'test-admin')).status, 401);
  assert.equal((await app.request('/api/auth/login', '', 'POST', { username: 'admin', password: 'anything' })).status, 401);
  const health = await app.request('/api/health');
  assert.equal(health.body.mode, 'manual');
  assert.equal(health.body.auditReport, undefined);
  assert.equal(app.intervals.length, 0, 'No background product collection or recovery loop');
  for (const route of ['/api/sync', '/api/admin/push-catalog', '/api/price-history/id', '/api/audit']) {
    const response = await fetch(app.origin + route, { method: route.includes('sync') || route.includes('push') ? 'POST' : 'GET' });
    assert.equal(response.status, 404);
  }
});

test('an imported list survives restart with its original date and final selling prices', async t => {
  const root = temporaryProject(t);
  importCatalog(list, { root, date: '2026-11-12' });
  for (let i = 0; i < 2; i++) {
    const modules = isolatedModules(root);
    const service = modules.load('server.js');
    await service.start();
    if (!service.server.listening) await require('node:events').once(service.server, 'listening');
    const response = await fetch(`http://127.0.0.1:${service.server.address().port}/api/products`);
    const catalog = await response.json();
    assert.equal(catalog.latestDate, '12-11');
    assert.equal(catalog.data.length, 2);
    assert.equal(catalog.data.find(p => p.name.includes('CPO')).condition, 'CPO');
    assert.equal(catalog.data[0].price, 6850);
    modules.close();
    await new Promise(resolve => service.localIo.close(resolve));
  }
});


test('cost API includes DFU once without retail margin or supplier contacts', async t => {
  const app = await platform(t);
  const cost = await app.request('/api/cost-products');
  const retail = await app.request('/api/products');
  assert.equal(cost.status, 200);
  assert.equal(cost.body.pricingMode, 'cost');
  assert.equal(cost.body.dfuActive, true);
  assert.equal(cost.body.isShielded, true);
  assert.equal(cost.body.data[0].price, 6100);
  assert.equal(cost.body.data[0].supplier, null);
  assert.equal(retail.body.data[0].price, 6850);
  assert.equal((await app.request('/api/products')).body.data[0].price, 6850);
});


test('partial catalog updates report the newest date regardless of product order', async t => {
  const root = temporaryProject(t);
  importCatalog(list, { root, date: '2026-11-12' });
  const file = path.join(root, 'data/snapshot_latest.json');
  const products = JSON.parse(fs.readFileSync(file, 'utf8'));
  products[1].priceDate = '14-11';
  products[1].sheetDate = '14-11';
  fs.writeFileSync(file, JSON.stringify(products));
  const modules = isolatedModules(root);
  const service = modules.load('server.js');
  await service.start();
  if (!service.server.listening) await require('node:events').once(service.server, 'listening');
  t.after(async () => {
    modules.close();
    await new Promise(resolve => service.localIo.close(resolve));
  });
  const origin = `http://127.0.0.1:${service.server.address().port}`;
  for (const route of ['/api/health', '/api/products', '/api/cost-products']) {
    const result = await (await fetch(origin + route)).json();
    assert.equal(result.latestDate, '14-11');
  }
});
