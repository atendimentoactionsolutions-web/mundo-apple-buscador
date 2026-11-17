const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
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

test('public API shields retail prices while admin routes require authentication', async t => {
  const app = await platform(t);
  const catalog = await app.request('/api/products');
  assert.equal(catalog.status, 200);
  assert.equal(catalog.body.total, 1);
  assert.equal(catalog.body.isShielded, true);
  const p = catalog.body.data[0];
  assert.equal(p.price, 6850, '6000 cost + 100 DFU + 750 margin');
  assert.equal(p.supplier, null);

  assert.equal((await app.request('/api/auth/me')).status, 401);
  assert.equal((await app.request('/api/auth/me', 'test-admin')).status, 200);
  assert.equal((await app.request('/api/auth/login', '', 'POST', { username: 'admin', password: 'wrong-password' })).status, 401);
  const login = await app.request('/api/auth/login', '', 'POST', { username: 'admin', password: 'test-password' });
  assert.equal(login.status, 200);
  assert.equal(login.body.user.role, 'admin');

  fs.symlinkSync(path.join(__dirname, '../public'), path.join(app.root, 'public'));

  for (const route of ['/preco-de-custo', '/admin', '/admin.html', '/painel.html']) {
    const resp = await fetch(app.origin + route, { redirect: 'manual' });
    assert.equal(resp.status, 302, `${route} must redirect unauthenticated visitors`);
    assert.match(resp.headers.get('location') || '', /^\/login\.html/);
    const lojistaResp = await fetch(app.origin + route, {
      headers: { cookie: 'fornecedor_session=test-a' },
      redirect: 'manual'
    });
    assert.equal(lojistaResp.status, 302, `${route} must redirect non-admin users`);
  }
  const loginPage = await fetch(app.origin + '/login.html', { redirect: 'manual' });
  assert.equal(loginPage.status, 200);
  const authedAdminPage = await fetch(app.origin + '/admin.html', {
    headers: { cookie: 'fornecedor_session=test-admin' },
    redirect: 'manual'
  });
  assert.equal(authedAdminPage.status, 200);
  const authedCostPage = await fetch(app.origin + '/preco-de-custo', {
    headers: { cookie: 'fornecedor_session=test-admin' },
    redirect: 'manual'
  });
  assert.equal(authedCostPage.status, 200);

  const health = await app.request('/api/health');
  assert.equal(health.body.mode, 'manual');
  assert.equal(health.body.auditReport, undefined);
  assert.equal(app.intervals.length, 0, 'No background product collection or recovery loop');
  for (const route of ['/api/sync', '/api/admin/push-catalog', '/api/price-history/id', '/api/audit']) {
    const response = await fetch(app.origin + route, { method: route.includes('sync') || route.includes('push') ? 'POST' : 'GET' });
    assert.equal(response.status, 404);
  }
});

test('admin user in data/users.json has valid scrypt hash and login unlocks admin and cost endpoints', async t => {
  const realUsers = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/users.json'), 'utf8'));
  const felipe = realUsers.find(u => u.username === 'felipe');
  assert.ok(felipe, 'admin felipe must exist in data/users.json');
  assert.equal(felipe.role, 'admin');
  assert.match(felipe.password_hash, /^scrypt:[0-9a-f]{32}:[0-9a-f]{128}$/);

  const root = temporaryProject(t);
  fs.mkdirSync(path.join(root, 'data'), { recursive: true });
  const crypto = require('node:crypto');
  const salt = 'admin-panel-salt';
  const testAdminPass = 'admin-panel-test-secret';
  fs.writeFileSync(path.join(root, 'data/users.json'), JSON.stringify([{
    id: 'admin-test',
    store_name: 'Administração Mundo Apple',
    owner_name: 'Admin',
    username: 'admin-panel-user',
    password_hash: `scrypt:${salt}:${crypto.scryptSync(testAdminPass, salt, 64).toString('hex')}`,
    role: 'admin',
    status: 'active',
    expires_at: null,
    current_session_token: null,
    active_session_tokens: []
  }]));
  importCatalog(list, { root, date: '2026-11-17' });

  const modules = isolatedModules(root);
  const service = modules.load('server.js');
  await service.start();
  if (!service.server.listening) await require('node:events').once(service.server, 'listening');
  t.after(async () => {
    modules.close();
    await new Promise(resolve => service.localIo.close(resolve));
  });

  const origin = `http://127.0.0.1:${service.server.address().port}`;
  const loginRes = await fetch(origin + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin-panel-user', password: testAdminPass })
  });
  assert.equal(loginRes.status, 200);
  const loginBody = await loginRes.json();
  assert.equal(loginBody.success, true);
  assert.equal(loginBody.user.username, 'admin-panel-user');
  assert.equal(loginBody.user.role, 'admin');

  const setCookie = loginRes.headers.get('set-cookie');
  const cookie = (setCookie || '').split(';')[0];
  assert.match(cookie, /^fornecedor_session=/);

  const meRes = await fetch(origin + '/api/auth/me', { headers: { cookie } });
  const me = await meRes.json();
  assert.equal(me.role, 'admin');
  assert.equal(me.dfuActive, true);

  const costRes = await fetch(origin + '/api/cost-products', { headers: { cookie } });
  assert.equal(costRes.status, 200);
  const cost = await costRes.json();
  assert.equal(cost.total, 2);
  assert.equal(cost.data.find(p => p.name === 'IPHONE 17 PRO').price, 6100);

  const importRes = await fetch(origin + '/api/admin/daily-prices', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ rawText: 'APPLE PENCIL PRO • Sem cor • Custo R$ 890,00', date: '17-11', mode: 'replace' })
  });
  assert.equal(importRes.status, 200);
  const importBody = await importRes.json();
  assert.equal(importBody.totalCatalog, 1);

  const invalidRes = await fetch(origin + '/api/admin/daily-prices', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ rawText: 'HOTWAV A17 • 128/4 • BLACK • Custo R$ 660,00', date: '17-11', mode: 'replace' })
  });
  assert.equal(invalidRes.status, 400);
  const afterInvalid = await (await fetch(origin + '/api/cost-products', { headers: { cookie } })).json();
  assert.equal(afterInvalid.total, 1, 'Failed import preserves existing catalog');
});

test('an imported list survives restart with its original date and final selling prices', async t => {
  const root = temporaryProject(t);
  importCatalog(list, { root, date: '2026-11-12' });
  for (let i = 0; i < 2; i++) {
    const modules = isolatedModules(root, { BOOTSTRAP_ADMIN_PASSWORD: 'test-bootstrap-password' });
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

test('cost API requires admin authentication and returns DFU once without margin or supplier', async t => {
  const app = await platform(t);
  assert.equal((await app.request('/api/cost-products')).status, 401);
  assert.equal((await app.request('/api/cost-products', 'test-a')).status, 403);

  const cost = await app.request('/api/cost-products', 'test-admin');
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
  const modules = isolatedModules(root, { BOOTSTRAP_ADMIN_PASSWORD: 'test-bootstrap-password' });
  const service = modules.load('server.js');
  await service.start();
  if (!service.server.listening) await require('node:events').once(service.server, 'listening');
  t.after(async () => {
    modules.close();
    await new Promise(resolve => service.localIo.close(resolve));
  });
  const origin = `http://127.0.0.1:${service.server.address().port}`;
  for (const route of ['/api/health', '/api/products']) {
    const result = await (await fetch(origin + route)).json();
    assert.equal(result.latestDate, '14-11');
  }
  assert.equal((await fetch(origin + '/api/cost-products')).status, 401);

  const login = await fetch(origin + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'test-bootstrap-password' })
  });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const authedCost = await (await fetch(origin + '/api/cost-products', { headers: { cookie } })).json();
  assert.equal(authedCost.latestDate, '14-11');
});

test('admin split catalog pane renders Preço de Custo and Preço Real side-by-side without exposing DFU', async t => {
  const app = await platform(t);
  const adminHtml = fs.readFileSync(path.join(__dirname, '..', 'public/admin.html'), 'utf8');
  const pricingCoreSource = fs.readFileSync(path.join(__dirname, '..', 'public/js/pricing-core.js'), 'utf8');

  const visibleHtml = adminHtml
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '');
  assert.equal(/dfu/i.test(visibleHtml), false, 'Admin HTML must not mention DFU visibly');
  assert.match(adminHtml, /<div class="split-panes-grid mode-split" id="splitCatalogGrid">/);
  assert.match(adminHtml, /id="tabSplitCost"[\s\S]*?Preço de Custo/);
  assert.match(adminHtml, /id="tabSplitReal"[\s\S]*?Preço Real/);

  const inlineMatch = adminHtml.match(/<script>\s*([\s\S]*?)<\/script>\s*<\/body>/);
  assert.ok(inlineMatch, 'Inline script block must exist in admin.html');

  const elements = new Map();
  const makeClassList = (initial = []) => {
    const set = new Set(initial);
    return {
      add: (...cls) => cls.forEach(c => set.add(c)),
      remove: (...cls) => cls.forEach(c => set.delete(c)),
      toggle: (c, force) => (force === undefined ? (set.has(c) ? set.delete(c) : set.add(c)) : (force ? set.add(c) : set.delete(c))),
      contains: c => set.has(c)
    };
  };
  const getEl = id => {
    if (!elements.has(id)) {
      const listeners = {};
      const initialClasses = id === 'splitCatalogGrid'
        ? ['split-panes-grid', 'mode-split']
        : (id === 'btnModeSplit' ? ['split-mode-pill', 'active']
          : (id === 'tabSplitCost' ? ['split-tab-btn', 'active-cost']
            : (id === 'tabSplitReal' ? ['split-tab-btn', 'active-real'] : [])));
      elements.set(id, {
        id,
        value: '',
        textContent: '',
        innerHTML: '',
        scrollTop: 0,
        disabled: false,
        style: {},
        dataset: {},
        classList: makeClassList(initialClasses),
        addEventListener: (ev, fn) => { (listeners[ev] ||= []).push(fn); },
        dispatchEvent: ev => { (listeners[ev] || []).forEach(fn => fn({ target: elements.get(id) })); },
        querySelectorAll: () => [],
        focus: () => {}
      });
    }
    return elements.get(id);
  };

  let domLoadedHandler = null;
  const routeMap = new Map([
    ['/api/auth/me', await app.request('/api/auth/me', 'test-admin')],
    ['/api/health', await app.request('/api/health')],
    ['/api/admin/margins', await app.request('/api/admin/margins', 'test-admin')],
    ['/api/card-rates', await app.request('/api/card-rates')],
    ['/api/products', await app.request('/api/products', 'test-admin')],
    ['/api/cost-products', await app.request('/api/cost-products', 'test-admin')],
    ['/api/admin/lojistas', await app.request('/api/admin/lojistas', 'test-admin')]
  ]);
  const visitorProducts = await app.request('/api/products');
  const costProducts = routeMap.get('/api/cost-products');
  assert.equal(costProducts.body.data[0].price, 6100);
  assert.equal(visitorProducts.body.data[0].price, 6850);

  const windowObj = {
    location: { href: '/admin.html' },
    localStorage: { getItem: () => 'light', setItem: () => {}, removeItem: () => {} }
  };
  const sandbox = {
    window: windowObj,
    document: {
      body: { classList: makeClassList(['light-theme']), appendChild: () => {}, removeChild: () => {} },
      getElementById: getEl,
      querySelectorAll: () => [],
      addEventListener: (ev, fn) => { if (ev === 'DOMContentLoaded') domLoadedHandler = fn; },
      createElement: () => ({ click: () => {}, style: {} })
    },
    localStorage: windowObj.localStorage,
    requestAnimationFrame: fn => fn(),
    alert: () => {},
    confirm: () => true,
    CSS: { escape: s => String(s) },
    fetch: async url => {
      const hit = routeMap.get(url);
      assert.ok(hit, `Unexpected fetch to ${url}`);
      return {
        ok: hit.status >= 200 && hit.status < 300,
        status: hit.status,
        json: async () => hit.body
      };
    },
    URL,
    Blob,
    Map,
    Set,
    Array,
    Object,
    String,
    Number,
    Math,
    Promise,
    Date,
    RegExp,
    JSON,
    console
  };
  sandbox.self = sandbox.window;
  windowObj.fetch = sandbox.fetch;
  vm.createContext(sandbox);
  vm.runInContext(pricingCoreSource, sandbox, { filename: 'pricing-core.js' });
  vm.runInContext(inlineMatch[1], sandbox, { filename: 'admin-inline.js' });

  assert.equal(typeof domLoadedHandler, 'function');
  await domLoadedHandler();
  await new Promise(resolve => setTimeout(resolve, 20));

  const costHtml = getEl('splitCostScroll').innerHTML;
  const realHtml = getEl('splitRealScroll').innerHTML;
  assert.match(costHtml, /IPHONE 17 PRO/);
  assert.match(costHtml, /6\.100,00/);
  assert.match(realHtml, /6\.850,00/);
  assert.match(realHtml, /750,00 margem/);
  assert.equal(/dfu/i.test(costHtml + realHtml), false, 'Rendered split panes must never mention DFU');
  assert.equal(getEl('splitCostCount').textContent, '1 item');
  assert.equal(getEl('splitRealCount').textContent, '1 item');
  assert.equal(getEl('splitCatalogGrid').classList.contains('mode-split'), true);

  sandbox.onSplitTopTabClick('cost');
  assert.equal(getEl('splitCatalogGrid').classList.contains('mode-cost'), true);
  sandbox.onSplitTopTabClick('cost');
  assert.equal(getEl('splitCatalogGrid').classList.contains('mode-split'), true);

  const iphoneMarginInput = getEl('margin_IPH');
  iphoneMarginInput.value = '950';
  iphoneMarginInput.dispatchEvent('input');
  assert.match(getEl('splitCostScroll').innerHTML, /6\.100,00/);
  assert.match(getEl('splitRealScroll').innerHTML, /7\.050,00/);
});
