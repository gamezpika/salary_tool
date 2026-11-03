'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  acc TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  jobs TEXT NOT NULL DEFAULT '[]',
  scope TEXT NOT NULL DEFAULT '[]',
  scope_b TEXT NOT NULL DEFAULT '[]',
  back TEXT NOT NULL DEFAULT 'none',
  enabled INTEGER NOT NULL DEFAULT 1,
  fails INTEGER NOT NULL DEFAULT 0,
  pw_hash TEXT NOT NULL,
  must_change INTEGER NOT NULL DEFAULT 1,
  last_login INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions(
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS settings(
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  version INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS org(
  g TEXT NOT NULL,
  b TEXT NOT NULL DEFAULT '',
  PRIMARY KEY(g,b)
);
CREATE TABLE IF NOT EXISTS audit(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  t INTEGER NOT NULL,
  acc TEXT NOT NULL,
  name TEXT NOT NULL,
  cat TEXT NOT NULL,
  act TEXT NOT NULL,
  det TEXT NOT NULL DEFAULT '',
  risk TEXT NOT NULL DEFAULT '',
  src TEXT NOT NULL,
  ip TEXT NOT NULL DEFAULT '',
  file_hash TEXT NOT NULL DEFAULT '',
  prev_hash TEXT NOT NULL,
  hash TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_t ON audit(t);
CREATE INDEX IF NOT EXISTS audit_file ON audit(file_hash);
-- 操作记录只能新增：资料库层就挡掉修改和删除
CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit BEGIN SELECT RAISE(ABORT,'audit is append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit BEGIN SELECT RAISE(ABORT,'audit is append-only'); END;
`;

function openDb(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const file = path.join(dataDir, 'salary.db');
  // 资料文件只给执行程序的账号读；要在建立前先设好，WAL 文件才会继承
  fs.closeSync(fs.openSync(file, 'a', 0o600));
  fs.chmodSync(file, 0o600);
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  db.exec(SCHEMA);
  return db;
}
module.exports = { openDb };
