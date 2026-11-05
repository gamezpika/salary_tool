'use strict';
/* 由 ../index.html（工具本体）产生 server/public。工具的计算逻辑不改，只改下面这几个接点。 */
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..'), out = path.join(root, 'server', 'public');
let src = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
function rep(a, b) {
  if (!(a instanceof RegExp) && !src.includes(a)) throw new Error('工具本体已变动，找不到：' + a.slice(0, 70));
  if (a instanceof RegExp && !a.test(src)) throw new Error('工具本体已变动，找不到：' + a);
  src = src.split ? (a instanceof RegExp ? src.replace(a, b) : src.split(a).join(b)) : src;
}
// 不向第三方载入脚本和字体，发薪页面只跑自己服务器上的程序
rep(/<link [^>]*fonts\.g[^>]*>\n/g, '');
rep('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js', '/vendor/xlsx.bundle.js');
rep('https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.bundle.js', '/vendor/xlsx.bundle.js');
// 登录后才启动工具
rep('<script>\n(function(){', '<script>\nwindow.__startTool=function(){(function(){');
rep('render();\n})();\n</script>', 'render();\n})();};\n</script>');
// 导出时留下记录和文件指纹
rep('DL.save(', '__DS(DL,');
// TronScan 经由后端，API Key 不进浏览器
rep("if(!st.chain.key)throw new Error('还没有填 TronScan API Key');", '');
rep("fetch(`https://apilist.tronscanapi.com/api/accountv2?address=${encodeURIComponent(addr)}`,{headers:{accept:'application/json','TRON-PRO-API-KEY':st.chain.key}})", "fetch(`/api/chain/account?address=${encodeURIComponent(addr)}`,{headers:{accept:'application/json'}})");
rep("if(r.status===401||r.status===403)throw new Error('TronScan API Key 无效或没有权限');", "if(r.status===503)throw new Error('服务器还没设定 TronScan API Key，请找 IT');if(r.status===401||r.status===403)throw new Error('登录已过期或没有权限');");
rep('API Key 只存在这台电脑的浏览器；余额', '余额');
rep('</head>', '<link rel="stylesheet" href="/client.css">\n</head>');
rep('</body>', '<script src="/client.js"></script>\n</body>');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'vendor'), { recursive: true });
fs.writeFileSync(path.join(out, 'index.html'), src);
for (const f of ['client.js', 'client.css']) fs.copyFileSync(path.join(__dirname, f), path.join(out, f));
fs.copyFileSync(path.join(__dirname, 'vendor', 'xlsx.bundle.js'), path.join(out, 'vendor', 'xlsx.bundle.js'));
console.log('前端已产生：', out);
