'use strict';
/* 备份：npm run backup -- [目标文件夹]。用 VACUUM INTO，服务运行中也能安全备份。
   audit.key 要另外保管：没有它，备份还是能读，但无法验证操作记录有没有被改过。 */
const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
const { loadConfig } = require('../src/config');

const cfg = loadConfig();
const dir = path.resolve(process.argv[2] || path.join(cfg.dataDir, 'backups'));
fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
const out = path.join(dir, `salary-${stamp}.db`);
const db = new DatabaseSync(path.join(cfg.dataDir, 'salary.db'));
db.prepare('VACUUM INTO ?').run(out);
db.close();
fs.chmodSync(out, 0o600);
console.log('备份完成：', out);
