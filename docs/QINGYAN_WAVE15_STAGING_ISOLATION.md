# Wave1.5 — Staging 隔离整改说明

**分支：** `stabilization/wave15-staging-isolation`  
**状态：** Draft PR（未自动恢复写验收）  
**关联：** #47 保持 Draft / 双 NO-GO；Wave2 未批准  

---

## 1. 为什么需要 Staging

默认 Vercel Preview 与 Production 共用 Neon endpoint `ep-super-field-antfibsl*`（`HOSTS_EQUAL=true`），属于 **production-adjacent**。  
因此默认 Preview **禁止** P5 / I2 / I6–I9 / T4–T6 写验收。

---

## 2. Staging 数据库（非敏感）

| 项 | 值 |
|---|---|
| Neon 项目名 | `qingyan-wave15-staging` |
| Neon project id | `super-scene-97779903` |
| Endpoint 前缀 | `ep-floral-sea-au07ycff` |
| Pooler 前缀 | `ep-floral-sea-au07ycff-pooler` |
| 库名 | `neondb` |
| 区域 | `aws-us-east-1` |
| 与 Production 不同 | **YES**（Production = `ep-super-field-antfibsl*`） |
| 数据类型 | **合成**（`WAVE15 TEST ...`，无真实客户 PII） |

Migrations：已在 Staging 空库执行（greenfield baseline + 后续）。

---

## 3. 合成测试账号 / 组织（邮箱为 `.local`）

| 角色 | Email | 组织 |
|---|---|---|
| Admin | `wave15-admin@test.qingyan.local` | Org A + Org B（可切换） |
| Member | `wave15-member@test.qingyan.local` | 仅 Org A |
| Outsider | `wave15-outsider@test.qingyan.local` | 仅 Org B |

资源命名前缀：`WAVE15 TEST ...`  
密码：仅存在于运维本地临时环境变量 / Secret 存储，**不入库**。

种子脚本：`scripts/wave15-seed-staging.ts`（强制 `QINGYAN_RUNTIME_ENV=staging` 且拒绝生产 endpoint）。

---

## 4. 副作用隔离方式

| 通道 | Staging 默认 | 开启条件 |
|---|---|---|
| 真实邮件 | 关闭 | `QINGYAN_ALLOW_REAL_EMAIL_NON_PROD=true` |
| Gmail Draft | 关闭 | `GMAIL_DRAFT_ENABLED` **且** `QINGYAN_ALLOW_GMAIL_DRAFT_NON_PROD` |
| 微信 / 企微 `pushMessage` | 关闭 | `QINGYAN_ALLOW_REAL_WECHAT_NON_PROD=true` |
| Cron 执行 | 关闭 | `QINGYAN_ALLOW_CRON_NON_PROD=true` + 非生产库 |
| Worker 执行 | 关闭 | `QINGYAN_ALLOW_WORKER_NON_PROD=true` + 非生产库 |
| 外部 webhook 副作用 | 关闭 | `QINGYAN_ALLOW_EXTERNAL_WEBHOOK_NON_PROD=true` |

显式环境标识：`QINGYAN_RUNTIME_ENV=staging`（优先于 hostname 猜测）。

---

## 5. Fail-closed 防线

模块：`src/lib/env/runtime-isolation.ts`

- 非 Production 命中生产 DB endpoint allowlist（默认 `ep-super-field-antfibsl`）→ `/api/health` **503 misconfigured**；cron fail-closed  
- 可选：`QINGYAN_PRODUCTION_CRON_SECRET_SHA256` 防止非 prod 复用生产 CRON_SECRET  
- 不打印连接串 / Secret  

---

## 6. Vercel Staging 配置清单（运维）

为固定分支（建议 `staging/wave15` 或本隔离分支）配置 **Preview 分支级** 环境变量：

1. `DATABASE_URL` / `DIRECT_URL` → Staging Neon（`ep-floral-sea-*`）  
2. `QINGYAN_RUNTIME_ENV=staging`  
3. `CRON_SECRET` → **新随机值**（≠ Production）  
4. 不设置 / 设为 false：`GMAIL_DRAFT_ENABLED`  
5. 不设置任何 `QINGYAN_ALLOW_*`（除非做受控测试）  
6. 不配置生产 `POSTFLOW_WORKER_TOKEN`  
7. 可选：设置 `QINGYAN_PRODUCTION_CRON_SECRET_SHA256` 为生产 cron 的 sha256  

部署后用 `/api/health` 确认：`runtimeEnv=staging`、`dbEndpointPrefix=ep-floral-sea-au07ycff`、`isolation=ok`。

---

## 7. 写验收恢复条件

仅当本 PR **合并**且 Staging 部署确认后，才可在 **#47** 恢复：

`P5` / `I2` / `I6`–`I9` / `T4`–`T6`

生产继续只读。本文件**不**自动恢复写验收。
