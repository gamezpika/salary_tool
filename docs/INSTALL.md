# 发薪分配工具：安装说明（给 IT）

## 这个系统是什么

- 一个 Node.js 程序，没有第三方套件，资料库是单一的 SQLite 文件，适合 10 人左右内部使用。
- 程序同时提供网页和 API，只需要开一个对内的 HTTPS 网址。
- 浏览器只会连这台服务器，不会向其他网站载入程序或字体。

## 服务器会存什么

| 存 | 不存 |
|---|---|
| 账号、加密后的密码、权限、可看范围 | 员工姓名、完整薪资名单 |
| 共享设定：出款钱包地址、排程条件、矿工费 | 员工收款地址 |
| 事业群、事业处的名称 | 上传的 Excel（只在使用者浏览器里读取） |
| 操作记录：谁、何时、文件名、人数、总额、文件指纹；中途暂缓和补发还会记工号、个人金额和原因 | |

出款钱包地址和总额仍然敏感，资料文件和备份都要限制存取。

## 需求

- Linux 服务器（建议）并已安装 Docker 和 Docker Compose。
- 一个内部网址和 HTTPS 证书。**一定要有 HTTPS**：没有的话登录 Cookie 送不出去，文件指纹功能也不能用。
- 查链上余额时，服务器要能连到 `apilist.tronscanapi.com:443`。
- 不用 Docker 的话，也可以直接用 Node.js 22.13 以上执行，Windows Server 也可以：
  ```
  node web/build.js
  cd server && npm start
  ```

## 安装

```bash
git clone https://github.com/gamezpika/salary_tool.git
cd salary_tool
git checkout feat/backend-phase1   # 合并到 main 之后不用这行
cp .env.example .env               # 依需要修改
docker compose up -d --build
docker compose logs app            # 查看第一个管理员的临时密码
```

确认程序正常：`curl http://127.0.0.1:3000/api/health` 应该回 `{"ok":true}`。

## HTTPS（Nginx 范例）

```nginx
server {
    listen 443 ssl;
    server_name salary.example.internal;       # 换成你们的内部网址
    ssl_certificate     /etc/ssl/salary.crt;
    ssl_certificate_key /etc/ssl/salary.key;
    client_max_body_size 2m;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto https;
    }
}
```

- `TRUST_PROXY` 已在 `docker-compose.yml` 设为 true。少了 `X-Forwarded-For` 的话，操作记录的 IP 会不对，登录次数限制也会算到同一个 IP 上。
- 防火墙只开放公司内网或 VPN。这个系统不建议直接放到公网。

## 第一次使用

1. 用日志里的临时密码登录，设定自己的密码。
2. 到「后台 → 账号与权限」新增账号。每个账号会产生一组临时密码，只显示一次，本人第一次登录时必须修改。

## 备份和还原

资料都在 Docker volume `salary-data` 里：

| 文件 | 内容 |
|---|---|
| `salary.db` | 全部资料 |
| `audit.key` | 验证操作记录用的密钥，**要和备份分开保管** |

备份（服务运行中也可以执行，建议每天排程）：

```bash
docker compose exec app node --disable-warning=ExperimentalWarning scripts/backup.js
```

备份会放在 volume 里的 `backups/`。请再复制到服务器以外的地方，并定期试还原。

还原：停止服务，用备份文件取代 `salary.db`（同时删除 `salary.db-wal`、`salary.db-shm`），再启动。

## 更新程序

```bash
git pull
docker compose up -d --build
```

资料在 volume 里，更新不会被清掉。更新前请先备份。

## 忘记管理员密码

如果还有其他管理员，请他在后台按「重设密码」。如果唯一的管理员也忘了，请联系开发人员，目前没有内建的救援指令。

## 串接 OA（之后）

1. 拿到 OA 的 API 文件后，修改 `server/src/datasource/oa.js` 里的 `ENDPOINT` 和 `FIELD_MAP`。这份样板的路径和栏位都是假设，尚未对过真实 OA。
2. 在 `.env` 设定 `DATA_SOURCE=oa`、`OA_BASE_URL`、`OA_TOKEN`，请使用只读账号。
3. 接口 `GET /api/payroll?kind=monthly|approved` 会由服务器按账号范围过滤，明细不写进资料库。前端的读取按钮还没做，要等第二步确认后再接上。

## 已知限制

- 排程序号、已发名单、进行中的批次仍存在各人的浏览器，第二期才集中。
- 两个人同时处理同一批还不会被挡。设定有版本检查，会提示对方刚改过。
- 目前资料来源是 Excel，可看范围只是过滤画面，真正的管控要靠 OA 导出。
- 页面还含内联脚本，CSP 必须保留 `unsafe-inline`。
- 还没有两步验证。
- 导入、导出是在浏览器完成，再回报给后端（记录里 `src=client`）。懂技术的人可以不回报，所以这部分记录用来追查，不是强制控管。登录、账号权限、共享设定的记录由后端直接产生，绕不过。
- Dockerfile 还没有实际 build 过，因为开发环境没有 Docker daemon，第一次部署时请留意。
- 没有第三方资安检测，正式上线前建议做一次。
- Node 的 `node:sqlite` 目前仍标示为实验性功能；如果资料量或并发变大，再换成 PostgreSQL。
