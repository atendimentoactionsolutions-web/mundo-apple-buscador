const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const { io } = require('socket.io-client');
const { platform } = require('./helpers/platform');

function quote() {
  return { customer: { name: 'Test Customer' }, items: [
    { name: 'iPhone', quantity: 2, unitPrice: 1000.55, discountType: 'FIXED', discountValue: 10, subtotal: 1 }
  ], totals: { netTotal: 1 }, totalAmount: 1, paymentTerms: { selectedInstallmentCount: 12 } };
}

test('API regression: sessions, store isolation, calculations and realtime updates', async t => {
  const app = await platform(t);
  await t.test('invalid, expired and blocked sessions cannot use authenticated APIs', async () => {
    for (const token of ['', 'invalid', 'test-expired', 'test-blocked']) {
      assert.equal((await app.request('/api/auth/me', token)).status, 401);
      assert.equal((await app.request('/api/quotes', token)).status, 401);
      const catalog = await app.request('/api/products', token);
      assert.equal(catalog.body.isShielded, true);
      assert.equal(catalog.body.data[0].supplier, null);
    }
    const response = await app.request('/api/auth/login', '', 'POST', { username: {}, password: [] });
    assert.equal(response.status, 401);
  });
  await t.test('each store sees only its proposals, with totals recalculated on the server', async () => {
    const created = await app.request('/api/quotes', 'test-a', 'POST', quote());
    assert.equal(created.status, 200);
    const saved = created.body.quote;
    assert.equal(saved.items[0].subtotal, 1981.1);
    assert.equal(saved.totalAmount, 1981.1);
    assert.equal(saved.paymentTerms.installmentOptions[11].totalAmount, 1981.1);
    assert.equal((await app.request(`/api/quotes/${saved.id}`, 'test-b')).status, 404);
    assert.equal((await app.request(`/api/quotes/${saved.id}`, 'test-b', 'PUT', quote())).status, 404);
    assert.equal((await app.request(`/api/quotes/${saved.id}`, 'test-b', 'DELETE')).status, 404);
    assert.equal((await app.request(`/api/quotes/${saved.id}/duplicate`, 'test-b', 'POST', {})).status, 404);
    const otherStore = await app.request('/api/quotes', 'test-b');
    assert.equal(otherStore.body.quotes.length, 0);
    assert.equal(otherStore.body.stats.totalQuotes, 0);
    assert.equal((await app.request('/api/quotes', 'test-admin')).body.quotes.length, 1);
    const invalid = quote(); invalid.items[0].unitPrice = -1;
    assert.equal((await app.request('/api/quotes', 'test-a', 'POST', invalid)).status, 400);
    assert.equal((await app.request(`/api/quotes/${saved.id}/status`, 'test-a', 'PATCH', { status: '<script>' })).status, 400);
  });
  await t.test('configuration updates preserve a zero fee and do not broadcast secret margins', async () => {
    const socket = io(app.origin, { transports: ['websocket'], reconnection: false });
    t.after(() => socket.disconnect());
    await once(socket, 'init_stats');
    const event = once(socket, 'margins_updated');
    assert.equal((await app.request('/api/admin/margins', 'test-admin', 'POST', { categories: { IPH: 900 } })).status, 200);
    assert.equal((await event).length, 0);
    assert.equal((await app.request('/api/margins', 'test-a')).body.margins.categories.IPH, 400);
    assert.equal((await app.request('/api/admin/card-rates', 'test-admin', 'POST', { baseRate: '0' })).status, 200);
    assert.equal((await app.request('/api/admin/card-rates', 'test-admin')).body.rates.baseRate, 0);
    assert.equal((await app.request('/api/admin/card-rates', 'test-admin', 'POST', { baseRate: 100 })).status, 400);
  });
  await t.test('logout disconnects only the matching authenticated socket', async () => {
    const socket = io(app.origin, { transports: ['websocket'], reconnection: false, extraHeaders: { cookie: 'fornecedor_session=test-a' } });
    t.after(() => socket.disconnect());
    await once(socket, 'init_stats');
    const disconnected = once(socket, 'disconnect');
    assert.equal((await app.request('/api/auth/logout', 'test-a', 'POST', {})).status, 200);
    await disconnected;
    assert.equal((await app.request('/api/auth/me', 'test-a')).status, 401);
    assert.equal((await app.request('/api/auth/me', 'test-admin')).status, 200);
  });
  await t.test('damaged data returns an error without replacing the existing records', async () => {
    const file = path.join(app.root, 'data/users.json');
    const backup = fs.readFileSync(file);
    fs.writeFileSync(file, '{damaged');
    assert.equal((await app.request('/api/auth/me', 'test-admin')).status, 500);
    assert.equal(fs.readFileSync(file, 'utf8'), '{damaged');
    fs.writeFileSync(file, backup);
  });
});
