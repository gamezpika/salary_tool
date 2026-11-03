'use strict';
const { loadConfig } = require('./config');
const { createApp } = require('./app');

(async () => {
  const config = loadConfig();
  const app = createApp(config);
  await app.ensureAdmin();
  app.server.listen(config.port, config.host, () => {
    console.log(`发薪分配工具后端已启动：${config.host}:${config.port}，资料来源：${config.dataSource}`);
    if (!config.cookieSecure) console.warn('注意：COOKIE_SECURE=false，只能用在本机开发。');
  });
  const stop = () => app.close().then(() => process.exit(0));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
})().catch(e => { console.error('启动失败：', e); process.exit(1); });
