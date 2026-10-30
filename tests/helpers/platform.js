const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { once } = require('node:events');

const project = path.resolve(__dirname, '../..');
function temporaryProject(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mundo-apple-regression-'));
  t.after(() => {
    if (path.dirname(path.resolve(root)) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith('mundo-apple-regression-')) throw new Error('Diretório temporário inesperado.');
    fs.rmSync(root, { recursive: true, force: true });
  });
  return root;
}
function isolatedModules(root, environment = {}) {
  const cache = new Map();
  const timers = new Set();
  const errors = [];
  const intervals = [];
  function load(name) {
    if (cache.has(name)) return cache.get(name).exports;
    const module = { exports: {} };
    cache.set(name, module);
    const context = vm.createContext({
      module, __dirname: root, Buffer, URL, URLSearchParams,
      require: request => request === './auth' ? load('auth.js') : request === './quotes' ? load('quotes.js')
        : request.startsWith('./public/js/') ? require(path.join(project, request)) : require(request),
      process: { env: { ...process.env, PORT: '0', PAUSE_PXT_UPSTREAM: 'true', DISABLE_LIVE_DOLLAR: 'true', ...environment }, on() {} },
      console: { log() {}, warn() {}, error: (...args) => errors.push(args) },
      setInterval: (...args) => { intervals.push(args[1]); const timer = setInterval(...args); timers.add(timer); return timer; },
      setTimeout: (...args) => { const timer = setTimeout(...args); timers.add(timer); return timer; },
      clearInterval, clearTimeout
    });
    vm.runInContext(fs.readFileSync(path.join(project, name), 'utf8'), context, { filename: name });
    return module.exports;
  }
  return { load, errors, intervals, close: () => timers.forEach(clearTimeout) };
}
function seed(root) {
  fs.mkdirSync(path.join(root, 'data'), { recursive: true });
  const salt = 'regression-test';
  const password_hash = `scrypt:${salt}:${crypto.scryptSync('test-password', salt, 64).toString('hex')}`;
  const rates = { baseRate: 0, installmentRates: Object.fromEntries(Array.from({ length: 18 }, (_, i) => [String(i + 1), 0])) };
  const users = [
    { id: 'admin-001', username: 'admin', role: 'admin', current_session_token: 'test-admin', active_session_tokens: ['test-admin'] },
    { id: 'cledson', username: 'cledson', role: 'lojista', current_session_token: 'test-cledson' },
    { id: 'store-a', username: 'store-a', role: 'lojista', current_session_token: 'test-a', custom_margins: { categories: { IPH: 400 }, products: {} }, custom_card_rates: rates },
    { id: 'store-b', username: 'store-b', role: 'lojista', current_session_token: 'test-b' },
    { id: 'expired', username: 'expired', role: 'lojista', current_session_token: 'test-expired', expires_at: '2000-01-01T00:00:00.000Z' },
    { id: 'blocked', username: 'blocked', role: 'lojista', current_session_token: 'test-blocked', status: 'blocked' }
  ].map(user => ({ password_hash, status: 'active', store_name: 'Test Store', expires_at: null, ...user }));
  fs.writeFileSync(path.join(root, 'data/users.json'), JSON.stringify(users));
  fs.writeFileSync(path.join(root, 'data/cached_catalog.json'), JSON.stringify([
    { id: 'phone-1', name: 'IPHONE 17 PRO', category: 'IPH', storage: '256GB', color: 'BLUE', price: 6000, supplier: { name: 'Supplier', whatsappNumber: '00000000' } }
  ]));
}
async function platform(t, environment = {}) {
  const root = temporaryProject(t);
  seed(root);
  const modules = isolatedModules(root, environment);
  const server = modules.load('server.js');
  await server.start();
  if (!server.server.listening) await once(server.server, 'listening');
  t.after(async () => {
    modules.close();
    await new Promise(resolve => server.localIo.close(resolve));
  });
  const origin = `http://127.0.0.1:${server.server.address().port}`;
  async function request(route, token = '', method = 'GET', body) {
    const response = await fetch(origin + route, { method, headers: {
      ...(token ? { cookie: `fornecedor_session=${token}` } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {})
    }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  }
  return { ...modules, ...server, root, origin, request };
}
module.exports = { platform, temporaryProject, isolatedModules, seed };
