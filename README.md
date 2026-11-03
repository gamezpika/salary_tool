# 发薪分配工具

| 位置 | 内容 |
|---|---|
| `index.html` | 工具本体（单一文件版） |
| `server/` | 后端：登录、权限、共享设定、操作记录、OA 接口 |
| `web/` | 前端接点：登录和后台画面，`build.js` 产生 `server/public` |
| `demo/` | 不连后端的示范版 |
| `docs/INSTALL.md` | 给 IT 的安装说明 |

本机试用（需要 Node.js 22.13 以上）：

```bash
node web/build.js
cd server
COOKIE_SECURE=false ADMIN_INITIAL_PASSWORD=换成你的临时密码 npm start
# 打开 http://localhost:3000
```

测试：`cd server && npm test`
