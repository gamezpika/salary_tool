'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { openDb } = require('./db');
const { loadAuditKey, createAudit } = require('./audit');
const A = require('./auth');
const { SETTINGS, canUse, canRead, describeChange } = require('./settings');
const { createSource, inScope, SourceNotAvailable } = require('./datasource');

class HttpError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; }
}
const ROLES = {
  管理员: { jobs: [1, 2, 3], back: 'full' }, 排程: { jobs: [1], back: 'none' }, 请款: { jobs: [2], back: 'none' },
  打款: { jobs: [3], back: 'none' }, 查核: { jobs: [], back: 'read' },
};
const BACK = { full: '管理', read: '只读', none: '无' };
const JOB = { 1: '作业一', 2: '作业二', 3: '作业三' };
const LOCK_AT = 5, IP_WINDOW = 10 * 60e3, IP_MAX = 30, MAX_BODY = 1 << 20;
const CLIENT_CATS = new Set(['导入', '导出', '设定', '操作', '权限']);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const CSP = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";

const str = (v, max, name) => {
  if (typeof v !== 'string') throw new HttpError(400, `${name}格式不对。`);
  const s = v.trim();
  if (!s) throw new HttpError(400, `${name}不能空白。`);
  if (s.length > max) throw new HttpError(400, `${name}太长了。`);
  return s;
};
const strList = (v, name) => {
  if (!Array.isArray(v) || v.length > 500) throw new HttpError(400, `${name}格式不对。`);
  return [...new Set(v.map(x => str(x, 200, name)))];
};
const scopeText = u => (u.scope.length || u.scopeB.length ? [...u.scope, ...u.scopeB.map(k => k.replace('|', ' / '))].join('、') : '全部');
const jobsText = j => j.map(x => JOB[x]).join('、') || '无';

function createApp(config, log = console) {
  const db = openDb(config.dataDir);
  const audit = createAudit(db, loadAuditKey(config.dataDir));
  const source = config.source || createSource(config);
  const ipFails = new Map();
  let dummyHash = null;

  /* ---------- 资料 ---------- */
  const rowUser = r => r && ({
    id: r.id, acc: r.acc, name: r.name, role: r.role, jobs: JSON.parse(r.jobs), scope: JSON.parse(r.scope), scopeB: JSON.parse(r.scope_b),
    back: r.back, enabled: !!r.enabled, locked: r.fails >= LOCK_AT, mustChange: !!r.must_change, lastLogin: r.last_login, pwHash: r.pw_hash, fails: r.fails,
  });
  const pub = u => { const { pwHash, fails, ...o } = u; return o; };
  const q = {
    userById: db.prepare('SELECT * FROM users WHERE id=?'), userByAcc: db.prepare('SELECT * FROM users WHERE acc=?'), allUsers: db.prepare('SELECT * FROM users ORDER BY id'),
    insUser: db.prepare('INSERT INTO users(acc,name,role,jobs,scope,scope_b,back,pw_hash,must_change,created_at) VALUES(?,?,?,?,?,?,?,?,1,?)'),
    updUser: db.prepare('UPDATE users SET acc=?,name=?,role=?,jobs=?,scope=?,scope_b=?,back=?,enabled=? WHERE id=?'),
    fails: db.prepare('UPDATE users SET fails=? WHERE id=?'), okLogin: db.prepare('UPDATE users SET fails=0,last_login=? WHERE id=?'),
    setPw: db.prepare('UPDATE users SET pw_hash=?,must_change=?,fails=0 WHERE id=?'),
    insSess: db.prepare('INSERT INTO sessions(token_hash,user_id,created_at,last_seen) VALUES(?,?,?,?)'), sess: db.prepare('SELECT * FROM sessions WHERE token_hash=?'),
    touch: db.prepare('UPDATE sessions SET last_seen=? WHERE token_hash=?'), delSess: db.prepare('DELETE FROM sessions WHERE token_hash=?'),
    delUserSess: db.prepare('DELETE FROM sessions WHERE user_id=?'), delOtherSess: db.prepare('DELETE FROM sessions WHERE user_id=? AND token_hash<>?'),
    purge: db.prepare('DELETE FROM sessions WHERE last_seen<? OR created_at<?'),
    setting: db.prepare('SELECT * FROM settings WHERE key=?'), allSettings: db.prepare('SELECT key,value,version FROM settings'),
    putSetting: db.prepare('INSERT INTO settings(key,value,version,updated_at,updated_by) VALUES(?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,version=excluded.version,updated_at=excluded.updated_at,updated_by=excluded.updated_by'),
    org: db.prepare('SELECT g,b FROM org ORDER BY g,b'), insOrg: db.prepare('INSERT OR IGNORE INTO org(g,b) VALUES(?,?)'),
    exported: db.prepare("SELECT name,t,det FROM audit WHERE file_hash=? AND cat='导出' ORDER BY id DESC LIMIT 1"),
  };

  async function ensureAdmin() {
    if (db.prepare('SELECT COUNT(*) c FROM users').get().c) return null;
    const pw = config.adminInitialPassword || A.tempPassword();
    q.insUser.run(config.adminAccount, '管理员', '管理员', '[1,2,3]', '[]', '[]', 'full', await A.hashPassword(pw, config.scryptN), Date.now());
    audit.write({ who: { acc: 'system', name: '系统' }, cat: '权限', act: '建立第一个管理员', det: config.adminAccount, risk: 'high' });
    if (!config.adminInitialPassword) log.log(`\n首次启动：管理员账号 ${config.adminAccount}，临时密码 ${pw}\n（只显示这一次，第一次登录后必须修改）\n`);
    return pw;
  }

  /* ---------- 请求工具 ---------- */
  const clientIp = req => (config.trustProxy && String(req.headers['x-forwarded-for'] || '').split(',').pop().trim()) || req.socket.remoteAddress || '';
  const cookieOf = req => { for (const c of String(req.headers.cookie || '').split(';')) { const [k, ...v] = c.trim().split('='); if (k === 'sid') return v.join('='); } return ''; };
  const setCookie = (res, tok, maxAge) => res.setHeader('Set-Cookie', `sid=${tok}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${config.cookieSecure ? '; Secure' : ''}`);
  const send = (res, status, obj) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(obj));
  };
  const readBody = req => new Promise((ok, no) => {
    const chunks = []; let n = 0;
    req.on('data', c => { n += c.length; if (n > MAX_BODY) { no(new HttpError(413, '资料太大。')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { if (!n) return ok({}); try { const v = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (!v || typeof v !== 'object' || Array.isArray(v)) throw 0; ok(v); } catch (_) { no(new HttpError(400, '资料格式不对。')); } });
    req.on('error', no);
  });
  function currentUser(req) {
    const tok = cookieOf(req); if (!tok) return null;
    const th = A.sha(tok), s = q.sess.get(th); if (!s) return null;
    const now = Date.now();
    if (now - s.last_seen > config.idleMinutes * 60e3 || now - s.created_at > config.absoluteHours * 3600e3) { q.delSess.run(th); return null; }
    const u = rowUser(q.userById.get(s.user_id));
    if (!u || !u.enabled || u.locked) { q.delSess.run(th); return null; }
    q.touch.run(now, th);
    u.tokenHash = th;
    return u;
  }
  const needUser = c => { if (!c.user) throw new HttpError(401, '请先登录。'); if (c.user.mustChange) throw new HttpError(403, '请先修改密码。', { code: 'must_change' }); return c.user; };
  const needBack = (c, level) => { const u = needUser(c); if (u.back === 'full' || (level === 'read' && u.back === 'read')) return u; throw new HttpError(403, '你的账号没有这个权限。'); };
  const needJob = (c, ...jobs) => { const u = needUser(c); if (jobs.some(j => u.jobs.includes(j))) return u; throw new HttpError(403, '你的账号没有这个作业的权限。'); };
  const say = (c, cat, act, det, risk, who) => audit.write({ who: who || c.user, cat, act, det, risk, ip: c.ip });

  const newSession = (res, userId) => {
    const tok = A.newToken(), now = Date.now();
    q.insSess.run(A.sha(tok), userId, now, now);
    setCookie(res, tok, Math.round(config.absoluteHours * 3600));
  };

  /* ---------- 路由 ---------- */
  const routes = [];
  const route = (method, pattern, fn) => {
    const keys = [], re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
    routes.push({ method, re, keys, fn });
  };

  route('GET', '/api/health', async () => ({ ok: true }));

  route('POST', '/api/login', async c => {
    const now = Date.now(), rec = ipFails.get(c.ip);
    if (rec && now - rec.t < IP_WINDOW && rec.n >= IP_MAX) throw new HttpError(429, '尝试次数太多，请 10 分钟后再试。');
    const acc = typeof c.body.acc === 'string' ? c.body.acc.trim().slice(0, 100) : '', pw = typeof c.body.password === 'string' ? c.body.password.slice(0, 200) : '';
    const GENERIC = '账号或密码不对，或账号已停用、已锁定。';
    const u = acc ? rowUser(q.userByAcc.get(acc)) : null;
    // 账号不存在也跑一次验证，避免从回应时间猜出账号是否存在
    dummyHash = dummyHash || await A.hashPassword('dummy-password', config.scryptN);
    const pwOk = await A.verifyPassword(pw, u ? u.pwHash : dummyHash);
    const failIp = () => { if (ipFails.size > 10000) ipFails.clear(); const r = ipFails.get(c.ip); if (r && now - r.t < IP_WINDOW) r.n++; else ipFails.set(c.ip, { t: now, n: 1 }); };
    if (!u) { failIp(); say(c, '登录', '登录失败', '账号不存在', 'warn', { acc: acc || '（空白）', name: '（未知账号）' }); throw new HttpError(401, GENERIC); }
    if (!u.enabled) { failIp(); say(c, '登录', '登录被拒', '账号已停用', 'warn', u); throw new HttpError(401, GENERIC); }
    if (u.locked) { failIp(); say(c, '登录', '登录被拒', '账号已锁定', 'warn', u); throw new HttpError(401, GENERIC); }
    if (!pwOk) {
      failIp(); const n = u.fails + 1; q.fails.run(n, u.id);
      say(c, '登录', n >= LOCK_AT ? '账号被锁定' : '登录失败', `密码错误（第 ${n} 次）`, n >= LOCK_AT ? 'high' : 'warn', u);
      throw new HttpError(401, GENERIC);
    }
    q.okLogin.run(now, u.id); q.purge.run(now - config.idleMinutes * 60e3, now - config.absoluteHours * 3600e3);
    newSession(c.res, u.id);
    say(c, '登录', '登录成功', '', '', u);
    return { user: pub(rowUser(q.userById.get(u.id))) };
  });

  route('POST', '/api/logout', async c => {
    if (c.user) { q.delSess.run(c.user.tokenHash); say(c, '登录', '登出', ''); }
    setCookie(c.res, '', 0);
    return { ok: true };
  });

  route('GET', '/api/me', async c => { if (!c.user) throw new HttpError(401, '请先登录。'); return { user: pub(c.user) }; });

  route('POST', '/api/password', async c => {
    if (!c.user) throw new HttpError(401, '请先登录。');
    const u = c.user, cur = typeof c.body.current === 'string' ? c.body.current : '', next = c.body.next;
    if (!await A.verifyPassword(cur.slice(0, 200), u.pwHash)) { say(c, '权限', '修改密码失败', '目前密码不对', 'warn'); throw new HttpError(400, '目前的密码不对。'); }
    const bad = A.passwordProblem(next, u.acc); if (bad) throw new HttpError(400, bad);
    if (next === cur) throw new HttpError(400, '新密码不能和目前的相同。');
    q.setPw.run(await A.hashPassword(next, config.scryptN), 0, u.id);
    q.delOtherSess.run(u.id, u.tokenHash);
    say(c, '权限', '修改自己的密码', '');
    return { user: pub(rowUser(q.userById.get(u.id))) };
  });

  /* 设定：只回传这个账号的作业用得到的 */
  route('GET', '/api/settings', async c => {
    const u = needUser(c), values = {};
    for (const r of q.allSettings.all()) if (canRead(u, r.key)) values[r.key] = { value: r.value, version: r.version };
    return { values, writable: Object.keys(SETTINGS).filter(k => canUse(u, k)) };
  });
  route('PUT', '/api/settings/:key', async c => {
    const u = needUser(c); let key; try { key = decodeURIComponent(c.params.key); } catch (_) { throw new HttpError(400, '设定名称不对。'); }
    if (!SETTINGS[key]) throw new HttpError(404, '没有这个设定。');
    if (!canUse(u, key)) throw new HttpError(403, '你的账号不能改这个设定。');
    if (typeof c.body.value !== 'string' || c.body.value.length > 500000) throw new HttpError(400, '设定内容不对。');
    const cur = q.setting.get(key);
    if (cur && cur.value === c.body.value) return { version: cur.version, changed: false };
    const baseVersion = Number(c.body.version) || 0;
    if ((cur?.version || 0) !== baseVersion) throw new HttpError(409, '这个设定刚被别人改过。', { current: { value: cur.value, version: cur.version }, updatedBy: cur.updated_by });
    const version = baseVersion + 1;
    q.putSetting.run(key, c.body.value, version, Date.now(), u.acc);
    for (const ch of describeChange(key, cur?.value ?? null, c.body.value)) say(c, '设定', ch.act, ch.det, ch.risk);
    return { version, changed: true };
  });

  /* 操作记录 */
  route('POST', '/api/audit', async c => {
    const u = needUser(c), b = c.body;
    if (!CLIENT_CATS.has(b.cat)) throw new HttpError(400, '记录类别不对。');
    const risk = ['', 'warn', 'high'].includes(b.risk) ? b.risk : '';
    const fileHash = typeof b.fileHash === 'string' && /^[0-9a-f]{12,64}$/.test(b.fileHash) ? b.fileHash : '';
    audit.write({ who: u, cat: b.cat, act: str(b.act, 100, '操作'), det: typeof b.det === 'string' ? b.det.slice(0, 500) : '', risk, src: 'client', ip: c.ip, fileHash });
    return { ok: true };
  });
  route('GET', '/api/audit', async c => {
    needBack(c, 'read');
    const p = c.url.searchParams, where = [], args = [];
    if (p.get('u')) { where.push('acc=?'); args.push(p.get('u')); }
    if (p.get('c')) { where.push('cat=?'); args.push(p.get('c')); }
    if (p.get('risk') === '1') where.push("risk<>''");
    if (p.get('q')) { where.push("(act LIKE ? ESCAPE '\\' OR det LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\' OR acc LIKE ? ESCAPE '\\' OR file_hash LIKE ? ESCAPE '\\')"); const k = `%${p.get('q').replace(/[\\%_]/g, '\\$&')}%`; args.push(k, k, k, k, k); }
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const limit = Math.min(Math.max(Number(p.get('limit')) || 200, 1), 1000), offset = Math.max(Number(p.get('offset')) || 0, 0);
    return {
      total: db.prepare(`SELECT COUNT(*) c FROM audit ${w}`).get(...args).c,
      rows: db.prepare(`SELECT id,t,acc,name,cat,act,det,risk,src,ip,file_hash AS fileHash FROM audit ${w} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...args, limit, offset),
      people: db.prepare('SELECT acc,MAX(name) name FROM audit GROUP BY acc ORDER BY acc').all(),
      cats: db.prepare('SELECT DISTINCT cat FROM audit ORDER BY cat').all().map(r => r.cat),
    };
  });
  route('GET', '/api/audit/verify', async c => { needBack(c, 'read'); return audit.verify(); });
  route('POST', '/api/export-check', async c => {
    needJob(c, 3);
    const h = typeof c.body.hash === 'string' ? c.body.hash : '';
    if (!/^[0-9a-f]{12,64}$/.test(h)) throw new HttpError(400, '文件指纹格式不对。');
    const r = q.exported.get(h);
    return r ? { found: true, name: r.name, t: r.t } : { found: false };
  });

  /* 后台总览 */
  route('GET', '/api/overview', async c => {
    needBack(c, 'read');
    const d = new Date(); d.setHours(0, 0, 0, 0); const t0 = d.getTime();
    const one = (sql, ...a) => db.prepare(sql).get(...a).c;
    const lastAct = db.prepare("SELECT act FROM audit WHERE acc=? AND cat<>'登录' ORDER BY id DESC LIMIT 1");
    return {
      today: {
        ops: one('SELECT COUNT(*) c FROM audit WHERE t>=?', t0),
        people: one("SELECT COUNT(DISTINCT acc) c FROM audit WHERE t>=? AND act='登录成功'", t0),
        high: one("SELECT COUNT(*) c FROM audit WHERE t>=? AND risk='high'", t0),
        loginIssues: one("SELECT COUNT(*) c FROM audit WHERE t>=? AND cat='登录' AND risk<>''", t0),
      },
      attention: db.prepare("SELECT id,t,acc,name,cat,act,det,risk FROM audit WHERE risk<>'' ORDER BY id DESC LIMIT 8").all(),
      people: q.allUsers.all().map(r => ({ acc: r.acc, name: r.name, role: r.role, lastLogin: r.last_login, lastAct: lastAct.get(r.acc)?.act || '' })),
    };
  });

  /* 账号管理 */
  route('GET', '/api/users', async c => { needBack(c, 'read'); return { users: q.allUsers.all().map(r => pub(rowUser(r))), roles: Object.keys(ROLES), org: q.org.all() }; });
  route('POST', '/api/users', async c => {
    needBack(c, 'full');
    const acc = str(c.body.acc, 50, '账号'), name = str(c.body.name, 50, '姓名'), role = c.body.role;
    if (!ROLES[role]) throw new HttpError(400, '角色不对。');
    if (q.userByAcc.get(acc)) throw new HttpError(409, `账号「${acc}」已经有人用了。`);
    const temp = A.tempPassword();
    q.insUser.run(acc, name, role, JSON.stringify(ROLES[role].jobs), '[]', '[]', ROLES[role].back, await A.hashPassword(temp, config.scryptN), Date.now());
    say(c, '权限', '新增账号', `${name}（${acc}）· 角色 ${role}`, 'high');
    return { user: pub(rowUser(q.userByAcc.get(acc))), tempPassword: temp };
  });
  const target = c => { const u = rowUser(q.userById.get(Number(c.params.id))); if (!u) throw new HttpError(404, '找不到这个账号。'); return u; };
  route('PATCH', '/api/users/:id', async c => {
    const me = needBack(c, 'full'), u = target(c), b = c.body, self = u.id === me.id, n = { ...u }, logs = [];
    if (b.name !== undefined) { n.name = str(b.name, 50, '姓名'); if (n.name !== u.name) logs.push(['更改姓名', `${u.acc}：${u.name} → ${n.name}`]); }
    if (b.acc !== undefined) {
      n.acc = str(b.acc, 50, '账号');
      if (n.acc !== u.acc) { const o = rowUser(q.userByAcc.get(n.acc)); if (o && o.id !== u.id) throw new HttpError(409, `账号「${n.acc}」已经有人用了。`); logs.push(['更改账号', `${n.name}：${u.acc} → ${n.acc}`]); }
    }
    if ((b.role !== undefined || b.back !== undefined || b.enabled !== undefined) && self) throw new HttpError(400, '自己的角色、后台权限和启用状态不能自己改。');
    if (b.role !== undefined) {
      if (!ROLES[b.role]) throw new HttpError(400, '角色不对。');
      if (b.role !== u.role) { n.role = b.role; n.jobs = ROLES[b.role].jobs.slice(); n.back = ROLES[b.role].back; logs.push(['更改角色', `${n.name}：${u.role} → ${b.role}（作业和后台权限已照新角色带入）`]); }
    }
    if (b.jobs !== undefined) {
      if (!Array.isArray(b.jobs) || b.jobs.some(j => ![1, 2, 3].includes(j))) throw new HttpError(400, '作业格式不对。');
      const was = n.jobs; n.jobs = [...new Set(b.jobs)].sort(); if (jobsText(was) !== jobsText(n.jobs)) logs.push(['更改可用作业', `${n.name}：${jobsText(was)} → ${jobsText(n.jobs)}`]);
    }
    if (b.back !== undefined) {
      if (!BACK[b.back]) throw new HttpError(400, '后台权限不对。');
      if (b.back !== n.back) { logs.push(['更改后台权限', `${n.name}：${BACK[n.back]} → ${BACK[b.back]}`]); n.back = b.back; }
    }
    if (b.scope !== undefined || b.scopeB !== undefined) {
      const before = scopeText(n);
      if (b.scope !== undefined) n.scope = strList(b.scope, '事业群范围');
      if (b.scopeB !== undefined) n.scopeB = strList(b.scopeB, '事业处范围');
      if (before !== scopeText(n)) logs.push(['更改可看范围', `${n.name}：${before} → ${scopeText(n)}`]);
    }
    if (b.enabled !== undefined) { n.enabled = !!b.enabled; if (n.enabled !== u.enabled) logs.push([n.enabled ? '启用账号' : '停用账号', `${n.name}（${n.acc}）`]); }
    q.updUser.run(n.acc, n.name, n.role, JSON.stringify(n.jobs), JSON.stringify(n.scope), JSON.stringify(n.scopeB), n.back, n.enabled ? 1 : 0, u.id);
    if (!n.enabled) q.delUserSess.run(u.id);
    logs.forEach(([act, det]) => say(c, '权限', act, det, 'high'));
    return { user: pub(rowUser(q.userById.get(u.id))) };
  });
  route('POST', '/api/users/:id/unlock', async c => {
    needBack(c, 'full'); const u = target(c);
    q.fails.run(0, u.id); say(c, '权限', '解除账号锁定', `${u.name}（${u.acc}）`, 'high');
    return { ok: true };
  });
  route('POST', '/api/users/:id/reset-password', async c => {
    const me = needBack(c, 'full'), u = target(c);
    if (u.id === me.id) throw new HttpError(400, '要改自己的密码，请用「修改密码」。');
    const temp = A.tempPassword();
    q.setPw.run(await A.hashPassword(temp, config.scryptN), 1, u.id); q.delUserSess.run(u.id);
    say(c, '权限', '重设他人密码', `${u.name}（${u.acc}）`, 'high');
    return { tempPassword: temp };
  });

  /* 事业群、事业处清单：只有单位名称，来自导入的 Excel 或 OA */
  route('POST', '/api/org', async c => {
    needJob(c, 1, 2, 3);
    const items = c.body.items, mode = c.body.mode;
    if (!Array.isArray(items) || items.length > 5000 || !['replace', 'merge'].includes(mode)) throw new HttpError(400, '单位清单格式不对。');
    const clean = items.map(x => ({ g: str(x?.g, 200, '事业群'), b: typeof x?.b === 'string' ? x.b.trim().slice(0, 200) : '' }));
    db.exec('BEGIN IMMEDIATE');
    try { if (mode === 'replace') db.exec('DELETE FROM org'); clean.forEach(x => q.insOrg.run(x.g, x.b)); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; }
    return { ok: true };
  });

  /* TronScan 代理：API Key 只在服务器上 */
  route('GET', '/api/chain/account', async c => {
    needJob(c, 2, 3);
    const addr = c.url.searchParams.get('address') || '';
    if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(addr)) throw new HttpError(400, '地址格式不对。');
    if (!config.tronscanKey) throw new HttpError(503, '服务器还没设定 TronScan API Key，请找 IT。');
    let r;
    try { r = await fetch(`${config.tronscanBase}/api/accountv2?address=${encodeURIComponent(addr)}`, { headers: { accept: 'application/json', 'TRON-PRO-API-KEY': config.tronscanKey }, signal: AbortSignal.timeout(15000) }); } catch (_) { throw new HttpError(502, '服务器连不上 TronScan。'); }
    if (!r.ok) throw new HttpError(502, `TronScan 回应 HTTP ${r.status}。`);
    return await r.json();
  });

  /* OA 资料：后端先按账号范围过滤，明细不写进资料库，也不写进记录 */
  route('GET', '/api/payroll', async c => {
    const kind = c.url.searchParams.get('kind');
    if (!['monthly', 'approved'].includes(kind)) throw new HttpError(400, '名单种类不对。');
    const u = needJob(c, kind === 'monthly' ? 1 : 2);
    let rows;
    try { rows = await source.listPayroll({ month: c.url.searchParams.get('month') || '', kind }); } catch (e) {
      if (e instanceof SourceNotAvailable) throw new HttpError(501, e.message, { code: 'source_excel' });
      log.error('资料来源错误：', e.message); throw new HttpError(502, '读取资料来源失败。');
    }
    const kept = rows.filter(r => inScope(u, String(r.g ?? ''), String(r.b ?? '')));
    say(c, '导入', kind === 'monthly' ? '从 OA 读取月度薪资' : '从 OA 读取核准名单', `${kept.length}／${rows.length} 人 · 可看范围 ${scopeText(u)}`);
    return { source: source.name, rows: kept };
  });

  /* ---------- 静态文件 ---------- */
  function serveStatic(req, res, pathname) {
    let rel;
    try { rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, ''); } catch (_) { res.writeHead(400); return res.end(); }
    if (rel.includes('\0')) { res.writeHead(400); return res.end(); }
    const file = path.resolve(config.publicDir, rel);
    if (file !== config.publicDir && !file.startsWith(config.publicDir + path.sep)) { res.writeHead(403); return res.end(); }
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); return res.end('找不到页面'); }
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': file.endsWith('.html') ? 'no-store' : 'public, max-age=3600', 'content-length': st.size });
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
    });
  }

  /* ---------- 入口 ---------- */
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', CSP);
    if (config.cookieSecure) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    let url;
    try { url = new URL(req.url, 'http://localhost'); } catch (_) { res.writeHead(400); return res.end(); }
    if (!url.pathname.startsWith('/api/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
      return serveStatic(req, res, url.pathname);
    }
    try {
      const unsafe = !['GET', 'HEAD'].includes(req.method);
      if (unsafe) {
        // 防 CSRF：只收自己页面送来的 JSON 请求
        if (req.headers['x-requested-with'] !== 'payroll') throw new HttpError(403, '请求来源不对。');
        const origin = req.headers.origin;
        if (origin) { let host = ''; try { host = new URL(origin).host; } catch (_) { /* 不合法 */ } if (host !== req.headers.host) throw new HttpError(403, '请求来源不对。'); }
      }
      const hit = routes.map(r => ({ r, m: r.method === req.method && url.pathname.match(r.re) })).find(x => x.m);
      if (!hit) throw new HttpError(404, '找不到这个接口。');
      const c = { req, res, url, ip: clientIp(req), params: {}, body: {}, user: currentUser(req) };
      hit.r.keys.forEach((k, i) => { c.params[k] = hit.m[i + 1]; });
      if (unsafe) c.body = await readBody(req);
      send(res, 200, await hit.r.fn(c));
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, { error: e.message, ...(e.extra || {}) });
      log.error('服务器错误：', e);
      send(res, 500, { error: '服务器出错了，请稍后再试。' });
    }
  });
  return { server, db, audit, ensureAdmin, close: () => new Promise(ok => server.close(() => { db.close(); ok(); })) };
}
module.exports = { createApp, ROLES };
