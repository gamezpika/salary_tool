'use strict';
const path = require('node:path');
const num = (v, d) => (v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : d);

function loadConfig(env = process.env) {
  return {
    port: num(env.PORT, 3000),
    host: env.HOST || '0.0.0.0',
    dataDir: path.resolve(env.DATA_DIR || path.join(__dirname, '..', 'data')),
    publicDir: path.resolve(env.PUBLIC_DIR || path.join(__dirname, '..', 'public')),
    // 正式环境必须走 HTTPS；只有本机开发才设成 false
    cookieSecure: env.COOKIE_SECURE !== 'false',
    // 前面有 Nginx 等反向代理时设 true，才读得到真实 IP
    trustProxy: env.TRUST_PROXY === 'true',
    idleMinutes: num(env.SESSION_IDLE_MINUTES, 60),
    absoluteHours: num(env.SESSION_MAX_HOURS, 12),
    adminAccount: env.ADMIN_ACCOUNT || 'admin',
    adminInitialPassword: env.ADMIN_INITIAL_PASSWORD || '',
    tronscanKey: env.TRONSCAN_API_KEY || '',
    tronscanBase: env.TRONSCAN_BASE || 'https://apilist.tronscanapi.com',
    dataSource: env.DATA_SOURCE || 'excel',
    oa: { baseUrl: env.OA_BASE_URL || '', token: env.OA_TOKEN || '' },
    scryptN: num(env.SCRYPT_N, 32768),
  };
}
module.exports = { loadConfig };
