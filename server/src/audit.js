'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

/* 操作记录用 HMAC 串成链：每笔都包含上一笔的 hash，改动或抽掉任何一笔，验证就会失败。 */
function loadAuditKey(dataDir) {
  const p = path.join(dataDir, 'audit.key');
  try { return fs.readFileSync(p); } catch (_) { /* 第一次启动 */ }
  const k = crypto.randomBytes(32);
  fs.writeFileSync(p, k, { mode: 0o600, flag: 'wx' });
  return k;
}

function createAudit(db, key) {
  const sign = (prev, r) => crypto.createHmac('sha256', key)
    .update(JSON.stringify([prev, r.t, r.acc, r.name, r.cat, r.act, r.det, r.risk, r.src, r.ip, r.file_hash]))
    .digest('hex');
  const last = db.prepare('SELECT hash FROM audit ORDER BY id DESC LIMIT 1');
  const ins = db.prepare('INSERT INTO audit(t,acc,name,cat,act,det,risk,src,ip,file_hash,prev_hash,hash) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)');

  function write({ who, cat, act, det = '', risk = '', src = 'server', ip = '', fileHash = '' }) {
    const r = { t: Date.now(), acc: String(who?.acc ?? '-'), name: String(who?.name ?? '-'), cat, act, det: String(det), risk, src, ip, file_hash: fileHash };
    db.exec('BEGIN IMMEDIATE');
    try {
      const prev = last.get()?.hash || 'genesis';
      ins.run(r.t, r.acc, r.name, r.cat, r.act, r.det, r.risk, r.src, r.ip, r.file_hash, prev, sign(prev, r));
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  }

  function verify() {
    let prev = 'genesis', n = 0;
    for (const r of db.prepare('SELECT * FROM audit ORDER BY id').iterate()) {
      if (r.prev_hash !== prev || sign(prev, r) !== r.hash) return { ok: false, checked: n, badId: r.id };
      prev = r.hash; n++;
    }
    return { ok: true, checked: n };
  }
  return { write, verify };
}
module.exports = { loadAuditKey, createAudit };
