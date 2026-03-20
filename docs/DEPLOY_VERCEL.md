# 上线流程：Vercel + Neon + GoDaddy 域名

面向本仓库（Next.js + Prisma + PostgreSQL）的推荐路径：代码在 **Vercel** 跑，数据库在 **Neon**，域名在 **GoDaddy** 购买与解析。

---

## 一、准备工作清单

- [ ] GitHub（或 GitLab / Bitbucket）账号，代码已推送到远程仓库  
- [ ] Vercel 账号（可用 GitHub 登录）  
- [ ] Neon 账号（可用 GitHub 登录）  
- [ ] GoDaddy 已购买域名（或任意注册商，步骤类似）

---

## 二、Neon：创建 PostgreSQL

1. 打开 [Neon Console](https://console.neon.tech/)，新建 **Project**。  
2. 创建后进入项目，在 **Connection details** 里会看到两类连接串（名称可能略有差异）：  
   - **Pooled**（带 `-pooler` 或标注为 Transaction / Pooled）→ 用作运行时连接  
   - **Direct**（非 pooler 直连）→ 给 Prisma **迁移**使用  
3. 在本项目中需要两个环境变量（与 `prisma/schema.prisma` 一致）：  
   - `DATABASE_URL` = **Pooled** 连接串（若暂时没有 Pooled，可先用 Direct 填在 `DATABASE_URL`，能跑起来；高并发时再改回 Pooled + Direct 分离）  
   - `DIRECT_URL` = **Direct** 连接串  

> **本地开发**：若没有 Pooler，可将 `DATABASE_URL` 与 `DIRECT_URL` 设为**同一条**直连字符串。

4. 在 Neon SQL Editor 或任意客户端里**不必**手动建表：部署时由 `prisma migrate deploy` 执行迁移。

---

## 三、GitHub：确保仓库可部署

1. 将当前项目推送到 GitHub（`main` 或你常用的默认分支）。  
2. 确认已提交：  
   - `prisma/schema.prisma`（`provider = "postgresql"`）  
   - `prisma/migrations/` 下的迁移目录  
   - `package.json` 中的 `build` / `postinstall`（本仓库已配置为生成 Client、执行迁移再构建 Next）

勿将 `.env`、本地 `*.db` 推送到仓库（已在 `.gitignore`）。

---

## 四、Vercel：导入项目并配置环境变量

1. 登录 [Vercel](https://vercel.com/) → **Add New…** → **Project** → 选择你的 GitHub 仓库 → **Import**。  
2. **Framework Preset** 选 **Next.js**（一般会自动识别）。  
3. **Root Directory** 若项目在仓库根目录则留空。  
4. **Environment Variables** 中至少添加：

| Name | 说明 |
|------|------|
| `DATABASE_URL` | Neon **Pooled**（或直连，见上文） |
| `DIRECT_URL` | Neon **Direct**（与本地规则相同；仅一条 URL 时可与 `DATABASE_URL` 相同） |
| `JWT_SECRET` | 生产环境**强随机**长字符串（勿与开发环境相同） |

按需添加（可选）：

| Name | 说明 |
|------|------|
| `OPENAI_API_KEY` | AI 对话 |
| `OPENAI_BASE_URL` | 兼容接口地址 |
| `OPENAI_MODEL` | 模型名 |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` | Google 登录；`GOOGLE_REDIRECT_URI` 必须为 **`https://你的域名/...`** |

5. 点击 **Deploy**。首次构建会执行：  
   `prisma generate` → `prisma migrate deploy` → `next build`。  
6. 若构建失败：  
   - 打开 **Deployment → Building → 日志**，查看 Prisma 或 Next 报错。  
   - 常见原因：`DATABASE_URL` / `DIRECT_URL` 错误、Neon 项目暂停、迁移与数据库状态不一致。

---

## 五、首次数据（种子用户等）

生产环境**不会**自动执行 `prisma db seed`。可选做法：

**方式 A（推荐，一次性）**：在本地用**生产库**连接串（务必小心）执行：

```bash
# 临时导出生产连接串，执行完 unset
export DATABASE_URL="postgresql://..."
export DIRECT_URL="postgresql://..."   # 可与上相同
npx prisma db seed
```

**方式 B**：打开站点 `/register`，自行注册账号使用。

若曾用 seed 创建 `admin@qingyan.ai` 且无密码，仍可在注册页用该邮箱注册以设置密码（逻辑见 `src/app/api/auth/register/route.ts`）。

---

## 六、GoDaddy：绑定自定义域名与 HTTPS

1. 在 Vercel 项目 → **Settings** → **Domains** → 添加你的域名（如 `example.com` 与可选 `www.example.com`）。  
2. Vercel 会显示需要配置的 **DNS 记录**（多为 **A** 指向 Vercel IP，或 **CNAME** 指向 `cname.vercel-dns.com` 等）。  
3. 登录 **GoDaddy** → 你的域名 → **DNS 管理** / **管理 DNS**：  
   - 按 Vercel 提示添加或修改记录；  
   - 删除冲突的旧 **A** / **CNAME**（例如曾指向其他主机的记录）。  
4. 等待 DNS 传播（通常数分钟至数小时）。  
5. Vercel 会自动申请 **Let’s Encrypt** 证书，全站 **HTTPS**。  
6. 若使用 Google OAuth，到 Google Cloud Console 把**已获授权的 JavaScript 来源**与**重定向 URI** 改为 `https://你的域名/...`。

---

## 七、上线后自检

- [ ] 首页或登录页能打开，浏览器地址栏为**锁形**（HTTPS）。  
- [ ] 注册/登录成功，刷新后仍保持登录（Cookie 正常）。  
- [ ] 需要 AI 时，对话页能调通模型（已配置 `OPENAI_*`）。  
- [ ] Neon 控制台可见连接与查询（确认库在用）。

---

## 八、后续发版

推送代码到 Git 默认分支后，Vercel 会自动触发新部署；`prisma migrate deploy` 会在每次 build 中应用**尚未执行**的迁移。  
新增表或字段时，在本地改 `schema.prisma` 后执行：

```bash
npx prisma migrate dev --name 描述本次变更
```

将生成的 `prisma/migrations/` 新目录提交并推送，再部署即可。

---

## 参考链接

- [Vercel — Deploy Next.js](https://vercel.com/docs/frameworks/nextjs)  
- [Neon — Prisma](https://neon.tech/docs/guides/prisma)  
- [Prisma — Deploy migrations to production](https://www.prisma.io/docs/orm/prisma-migrate/workflows/development-and-production)
