'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { createApp } = require('../src/app');
const { loadConfig } = require('../src/config');
const { SourceNotAvailable } = require('../src/datasource');

const WALLETS = 'payroll-allocator-wallets-v1', RULES = 'payroll-allocator-rules-v1';
const ADMIN_PW = 'Initial-Admin-Pw-1';
let app, base, tron, dir, oaRows = null;

class Client {
  constructor() { this.cookie = ''; }
  async call(method, url, body, headers = {}) {
    const r = await fetch(base + url, {
      method,
      headers: { 'x-requested-with': 'payroll', 'content-type': 'application/json', ...(this.cookie ? { cookie: this.cookie } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const sc = r.headers.get('set-cookie');
    if (sc) this.cookie = sc.split(';')[0];
    let json = null; try { json = await r.json(); } catch (_) { /* 非 JSON */ }
    return { status: r.status, json, setCookie: sc };
  }
  get(u) { return this.call('GET', u); }
  post(u, b = {}) { return this.call('POST', u, b); }
  put(u, b) { return this.call('PUT', u, b); }
  patch(u, b) { return this.call('PATCH', u, b); }
}
async function login(acc, password) { const c = new Client(); c.res = await c.post('/api/login', { acc, password }); return c; }
async function ready(acc, temp, next) {
  const c = await login(acc, temp);
  assert.equal(c.res.status, 200);
  const p = await c.post('/api/password', { current: temp, next });
  assert.equal(p.status, 200, JSON.stringify(p.json));
  return c;
}
let admin, adminUser;
const created = {};
async function makeUser(acc, role, patch) {
  const r = await admin.post('/api/users', { acc, name: acc + '名', role });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  if (patch) assert.equal((await admin.patch(`/api/users/${r.json.user.id}`, patch)).status, 200);
  const pw = `${acc}-Strong-Pass-9`;
  const c = await ready(acc, r.json.tempPassword, pw);
  created[acc] = { id: r.json.user.id, pw };
  return c;
}
const lastLogs = async n => (await admin.get(`/api/audit?limit=${n}`)).json.rows;

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'salary-test-'));
  tron = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ gotKey: req.headers['tron-pro-api-key'], balance: 5e6 }));
  });
  await new Promise(ok => tron.listen(0, '127.0.0.1', ok));
  const cfg = {
    ...loadConfig({}), dataDir: dir, publicDir: path.join(dir, 'pub'), cookieSecure: false, scryptN: 1024, adminInitialPassword: ADMIN_PW,
    tronscanKey: 'server-only-key', tronscanBase: `http://127.0.0.1:${tron.address().port}`,
    source: { name: 'fake', async listPayroll() { if (!oaRows) throw new SourceNotAvailable('Excel'); return oaRows; } },
  };
  fs.mkdirSync(cfg.publicDir); fs.writeFileSync(path.join(cfg.publicDir, 'index.html'), '<p>tool</p>');
  fs.writeFileSync(path.join(dir, 'secret.txt'), 'secret');
  app = createApp(cfg, { log() {}, error() {} });
  await app.ensureAdmin();
  await new Promise(ok => app.server.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${app.server.address().port}`;
  admin = await login('admin', ADMIN_PW);
  adminUser = admin.res.json.user;
});
after(async () => { await app.close(); tron.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('Cookie 是 HttpOnly + SameSite=Strict', () => {
  assert.match(admin.res.setCookie, /HttpOnly/);
  assert.match(admin.res.setCookie, /SameSite=Strict/);
});

test('第一次登录必须先改密码，否则什么都不能做', async () => {
  assert.equal(adminUser.mustChange, true);
  const r = await admin.get('/api/users');
  assert.equal(r.status, 403); assert.equal(r.json.code, 'must_change');
  assert.equal((await admin.post('/api/password', { current: ADMIN_PW, next: 'short' })).status, 400);
  assert.equal((await admin.post('/api/password', { current: 'wrong', next: 'A-Long-Enough-Pw-1' })).status, 400);
  assert.equal((await admin.post('/api/password', { current: ADMIN_PW, next: 'Admin-New-Pass-2' })).status, 200);
  assert.equal((await admin.get('/api/users')).status, 200);
});

test('没登录拿不到任何资料', async () => {
  const c = new Client();
  for (const u of ['/api/users', '/api/audit', '/api/settings', '/api/overview', '/api/audit/verify', '/api/payroll?kind=monthly', '/api/chain/account?address=T']) {
    assert.equal((await c.get(u)).status, 401, u);
  }
  assert.equal((await new Client().call('GET', '/api/me', undefined, { cookie: 'sid=forged' })).status, 401);
});

test('密码用 scrypt 保存，回应里不会出现密码 hash', async () => {
  const row = app.db.prepare('SELECT pw_hash FROM users WHERE acc=?').get('admin');
  assert.match(row.pw_hash, /^scrypt\$/);
  const r = await admin.get('/api/users');
  assert.ok(!JSON.stringify(r.json).includes('scrypt$'));
  assert.ok(!JSON.stringify(r.json).toLowerCase().includes('pwhash'));
});

test('错 5 次锁定；正确密码也进不去；管理员解锁后恢复', async () => {
  const c = await makeUser('lockme', '排程');
  assert.equal((await c.get('/api/me')).status, 200);
  for (let i = 0; i < 5; i++) assert.equal((await login('lockme', 'bad')).res.status, 401);
  assert.equal((await login('lockme', created.lockme.pw)).res.status, 401);
  assert.equal((await c.get('/api/me')).status, 401, '锁定后原本的会话也要失效');
  await admin.post(`/api/users/${created.lockme.id}/unlock`);
  assert.equal((await login('lockme', created.lockme.pw)).res.status, 200);
});

test('账号不存在和密码错误，回应完全一样', async () => {
  const a = await login('no-such-user', 'x'), b = await login('admin', 'x');
  assert.equal(a.res.status, b.res.status);
  assert.deepEqual(a.res.json, b.res.json);
});

test('一般账号不能用后台和账号管理，直接打 API 也不行', async () => {
  const c = await makeUser('plan1', '排程');
  assert.equal((await c.get('/api/users')).status, 403);
  assert.equal((await c.get('/api/audit')).status, 403);
  assert.equal((await c.post('/api/users', { acc: 'x', name: 'x', role: '管理员' })).status, 403);
  assert.equal((await c.patch(`/api/users/${created.plan1.id}`, { back: 'full', jobs: [1, 2, 3] })).status, 403, '不能帮自己提权');
  assert.equal((await c.post(`/api/users/${adminUser.id}/reset-password`)).status, 403);
});

test('查核（后台只读）只能看，不能改', async () => {
  const c = await makeUser('audit1', '查核');
  assert.equal((await c.get('/api/audit')).status, 200);
  assert.equal((await c.get('/api/users')).status, 200);
  assert.equal((await c.patch(`/api/users/${created.plan1.id}`, { name: 'hack' })).status, 403);
  assert.equal((await c.post('/api/users', { acc: 'y', name: 'y', role: '排程' })).status, 403);
  assert.equal((await c.post('/api/audit', { cat: '操作', act: '假' })).status, 200);
});

test('管理员不能改自己的角色、后台权限和启用状态', async () => {
  for (const b of [{ role: '排程' }, { back: 'none' }, { enabled: false }]) assert.equal((await admin.patch(`/api/users/${adminUser.id}`, b)).status, 400);
});

test('账号重复会被挡；改角色带入权限，并立刻生效', async () => {
  const c = await makeUser('swap1', '排程');
  assert.equal((await admin.patch(`/api/users/${created.swap1.id}`, { acc: 'ADMIN' })).status, 409);
  assert.equal((await c.put(`/api/settings/${WALLETS}`, { value: '[]', version: 0 })).status, 403);
  assert.equal((await admin.patch(`/api/users/${created.swap1.id}`, { role: '请款' })).json.user.jobs[0], 2);
  assert.equal((await c.put(`/api/settings/${RULES}`, { value: '[]', version: 0 })).status, 403, '权限改了，下一个请求就生效');
});

test('停用账号：会话立刻失效', async () => {
  const c = await makeUser('stop1', '排程');
  await admin.patch(`/api/users/${created.stop1.id}`, { enabled: false });
  assert.equal((await c.get('/api/me')).status, 401);
  assert.equal((await login('stop1', created.stop1.pw)).res.status, 401);
});

test('重设密码：旧密码和旧会话都失效，新密码必须再改', async () => {
  const c = await makeUser('reset1', '排程');
  const r = await admin.post(`/api/users/${created.reset1.id}/reset-password`);
  assert.equal((await c.get('/api/me')).status, 401);
  assert.equal((await login('reset1', created.reset1.pw)).res.status, 401);
  const n = await login('reset1', r.json.tempPassword);
  assert.equal(n.res.json.user.mustChange, true);
  assert.equal((await n.get('/api/settings')).status, 403);
});

test('设定：白名单、作业权限、版本冲突、改钱包地址进记录', async () => {
  const pay = await makeUser('req1', '请款'), pl = await makeUser('plan2', '排程');
  assert.equal((await pay.put('/api/settings/payroll-allocator-wbatches-v1', { value: '[{"name":"员工"}]', version: 0 })).status, 404, '批次明细不能存到后端');
  assert.equal((await pay.put('/api/settings/payroll-allocator-chain-v1', { value: '{"key":"x"}', version: 0 })).status, 404, 'API Key 不能经设定存');
  const wallets = v => JSON.stringify([{ name: '甲', payer: '甲', addr: v }]);
  const a = await pay.put(`/api/settings/${WALLETS}`, { value: wallets('TAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1'), version: 0 });
  assert.equal(a.json.version, 1);
  assert.equal((await pay.put(`/api/settings/${WALLETS}`, { value: wallets('TAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1'), version: 0 })).json.changed, false, '内容没变不算冲突');
  const conflict = await pay.put(`/api/settings/${WALLETS}`, { value: wallets('TBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB2'), version: 0 });
  assert.equal(conflict.status, 409); assert.equal(conflict.json.current.version, 1);
  assert.equal((await pay.put(`/api/settings/${WALLETS}`, { value: wallets('TBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB2'), version: 1 })).status, 200);
  const log = (await lastLogs(1))[0];
  assert.equal(log.act, '更改出款钱包地址'); assert.equal(log.risk, 'high'); assert.match(log.det, /TAAAA…AAA1 → TBBBB…BBB2/); assert.equal(log.src, 'server');
  assert.equal((await pl.put(`/api/settings/${WALLETS}`, { value: '[]', version: 2 })).status, 403);
  assert.ok(!(WALLETS in (await pl.get('/api/settings')).json.values), '作业一的人读不到钱包');
  assert.ok(WALLETS in (await pay.get('/api/settings')).json.values);
});

test('USDT 分配规则存到服务器共用，并写进记录', async () => {
  const key = 'payroll-allocator-wcfg-v1', c = await login('req1', created.req1.pw);
  const v = urules => JSON.stringify({ trxWs: [0], maxW: 0, urules });
  const r1 = await c.put(`/api/settings/${key}`, { value: v(['serial', 'amount', 'dept']), version: 0 });
  assert.equal(r1.status, 200);
  assert.equal((await c.put(`/api/settings/${key}`, { value: v(['amount', 'heads']), version: r1.json.version })).status, 200);
  const l = (await lastLogs(1))[0];
  assert.equal(l.act, '更改 USDT 分配规则');
  assert.equal(l.det, '序号连续、金额平均、部门尽量不拆开 → 金额平均、人数平均');
});

test('打款的人读得到暂缓分组，但不能改', async () => {
  const key = 'payroll-allocator-holdgroups-v1', pl = await login('plan1', created.plan1.pw), pay = await makeUser('pay9', '打款');
  assert.equal((await pl.put(`/api/settings/${key}`, { value: '{"groups":["SSC暂缓","HQ暂缓"],"map":{},"emp":{},"skip":{}}', version: 0 })).status, 200);
  const r = await pay.get('/api/settings');
  assert.ok(key in r.json.values); assert.ok(!r.json.writable.includes(key));
  assert.equal((await pay.put(`/api/settings/${key}`, { value: '{}', version: 1 })).status, 403);
});

test('操作记录：资料库层禁止修改和删除；验证能发现偷改', async () => {
  assert.throws(() => app.db.exec("UPDATE audit SET det='x'"), /append-only/);
  assert.throws(() => app.db.exec('DELETE FROM audit'), /append-only/);
  assert.equal((await admin.get('/api/audit/verify')).json.ok, true);
  // 模拟有人绕过 API 拆掉 trigger 直接改资料库
  app.db.exec('DROP TRIGGER audit_no_update');
  app.db.exec("UPDATE audit SET det='被改过' WHERE id=2");
  const v = (await admin.get('/api/audit/verify')).json;
  assert.equal(v.ok, false); assert.equal(v.badId, 2);
});

test('操作记录：使用者不能乱填类别、时间或身份', async () => {
  const c = await makeUser('fake1', '打款');
  assert.equal((await c.post('/api/audit', { cat: '登录', act: '登录成功' })).status, 400);
  await c.post('/api/audit', { cat: '操作', act: '测试', det: 'x'.repeat(2000), acc: 'admin', name: '管理员', t: 1, ip: '1.1.1.1', src: 'server' });
  const l = (await lastLogs(1))[0];
  assert.equal(l.acc, 'fake1'); assert.equal(l.src, 'client'); assert.ok(l.t > 1e12); assert.equal(l.det.length, 500);
});

test('文件指纹比对只给作业三，能分辨有没有导出记录', async () => {
  const req = await login('req1', created.req1.pw), pay = await login('fake1', created.fake1.pw);
  await req.post('/api/audit', { cat: '导出', act: '导出请款单', det: 'a.xlsx', fileHash: 'abcdef012345' });
  assert.equal((await pay.post('/api/export-check', { hash: 'abcdef012345' })).json.found, true);
  assert.equal((await pay.post('/api/export-check', { hash: '999999999999' })).json.found, false);
  assert.equal((await req.post('/api/export-check', { hash: 'abcdef012345' })).status, 403);
});

test('TronScan：Key 只在服务器，地址要合法，作业一不能用', async () => {
  const pay = await login('req1', created.req1.pw), pl = await login('plan2', created.plan2.pw);
  const addr = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
  const r = await pay.get(`/api/chain/account?address=${addr}`);
  assert.equal(r.json.gotKey, 'server-only-key');
  assert.equal((await pay.get('/api/chain/account?address=http://evil')).status, 400);
  assert.equal((await pl.get(`/api/chain/account?address=${addr}`)).status, 403);
});

test('OA 接口：Excel 模式回 501；OA 模式由后端按范围过滤，明细不进资料库', async () => {
  const pl = await login('plan2', created.plan2.pw);
  assert.equal((await pl.get('/api/payroll?kind=monthly')).json.code, 'source_excel');
  oaRows = [{ code: 'E1', name: '秘密姓名甲', g: '甲群', b: '一处', php: 11111 }, { code: 'E2', name: '秘密姓名乙', g: '甲群', b: '二处', php: 22222 }, { code: 'E3', name: '秘密姓名丙', g: '乙群', b: '三处', php: 33333 }];
  await admin.patch(`/api/users/${created.plan2.id}`, { scope: ['乙群'], scopeB: ['甲群|二处'] });
  const r = await pl.get('/api/payroll?kind=monthly');
  assert.deepEqual(r.json.rows.map(x => x.code), ['E2', 'E3']);
  assert.ok(!JSON.stringify(r.json).includes('秘密姓名甲'));
  assert.equal((await pl.get('/api/payroll?kind=approved')).status, 403);
  const l = (await lastLogs(1))[0];
  assert.match(l.det, /2／3 人/);
  app.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  const dbText = fs.readFileSync(path.join(dir, 'salary.db')).toString('utf8');
  assert.ok(!dbText.includes('秘密姓名') && !dbText.includes('33333'), '明细不能写进资料库');
  oaRows = null;
});

test('CSRF：缺标头或来自别的网站的写入都被挡', async () => {
  const noHeader = await fetch(`${base}/api/logout`, { method: 'POST', headers: { cookie: admin.cookie, 'content-type': 'application/json' }, body: '{}' });
  assert.equal(noHeader.status, 403);
  const evil = await admin.call('POST', '/api/logout', {}, { origin: 'https://evil.example' });
  assert.equal(evil.status, 403);
  assert.equal((await admin.get('/api/me')).status, 200);
});

test('静态文件：路径穿越读不到外面的文件；有安全标头', async () => {
  const raw = p => new Promise(ok => {
    const u = new URL(base);
    http.get({ host: u.hostname, port: u.port, path: p }, res => { let d = ''; res.on('data', x => { d += x; }); res.on('end', () => ok({ status: res.statusCode, body: d, headers: res.headers })); });
  });
  const home = await raw('/');
  assert.equal(home.status, 200);
  assert.match(home.headers['content-security-policy'], /frame-ancestors 'none'/);
  assert.equal(home.headers['x-content-type-options'], 'nosniff');
  for (const p of ['/../secret.txt', '/..%2Fsecret.txt', '/%2e%2e/secret.txt', '/..%2f..%2fsalary.db']) {
    const r = await raw(p);
    assert.notEqual(r.status, 200, p); assert.ok(!r.body.includes('secret'), p);
  }
});

test('错误的 JSON、太大的资料不会让服务器出错', async () => {
  const bad = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'x-requested-with': 'payroll' }, body: '{oops' });
  assert.equal(bad.status, 400);
  const big = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'x-requested-with': 'payroll' }, body: JSON.stringify({ acc: 'x'.repeat(2 << 20) }) }).catch(() => ({ status: 413 }));
  assert.equal(big.status, 413);
  assert.equal((await admin.get('/api/health')).status, 200);
});

test('怪异的网址不会让服务器当掉', async () => {
  const raw = p => new Promise(ok => { const u = new URL(base); http.get({ host: u.hostname, port: u.port, path: p }, res => { res.resume(); res.on('end', () => ok(res.statusCode)); }); });
  assert.equal(await raw('/%E0%A4%A'), 400);
  assert.equal(await raw('/a%00b'), 400);
  assert.equal((await admin.call('PUT', '/api/settings/%E0%A4%A', { value: 'x', version: 0 })).status, 400);
  assert.equal((await admin.get('/api/health')).status, 200);
});

test('登出后会话失效', async () => {
  const c = await login('req1', created.req1.pw);
  const stale = c.cookie;
  await c.post('/api/logout');
  const r = await new Client().call('GET', '/api/me', undefined, { cookie: stale });
  assert.equal(r.status, 401);
});
