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

### 5.1 评估与违规码

| 违规 | 含义 |
|---|---|
| `PROD_DB_ON_NON_PROD_RUNTIME` | 非 prod 连接生产 Neon |
| `RUNTIME_ENV_MISMATCH` | 如 `VERCEL_ENV=preview` + `QINGYAN_RUNTIME_ENV=production` |
| `DB_ENDPOINT_UNRESOLVED` | staging/preview 下 DATABASE_URL 缺失/无法解析 |
| `WORKER_DISABLED_NON_PROD` | 未设 `QINGYAN_ALLOW_WORKER_NON_PROD` |
| `SIDE_EFFECT_DISABLED` | webhook / email / gmail 默认关闭 |
| `NON_PROD_SIDE_EFFECT_DISABLED` | 微信/企微 `pushMessage` 明确阻断（非 `{sent:0,failed:0}`） |
| `CRON_DISABLED_NON_PROD` | cron 未显式允许 |

### 5.2 已接线写入口（自身 503，不依赖 health）

- `POST /api/ai/pending-actions/[id]`（approve / reject / retry）
- `executePendingAction` / `rejectPendingAction`（含 `grader.internal_note` / `grader.project_task` 等）
- `PATCH /api/projects/[id]`
- `POST /api/tasks`
- `POST /api/operations/worker/claim` / `report`
- `dispatchPublishJob` → Postiz（出站 webhook）
- `pushMessage`（抛错，禁止假成功）
- Gmail Draft：`isGmailDraftEnabled` → 唯一 `isGmailDraftAllowed`

### 5.3 匿名 health 脱敏

生产匿名响应仅：`runtimeEnv` / `dbPlane` / `isolation`（**不**暴露 Neon endpoint 前缀）。  
Staging/Preview 可附带不可逆 `dbFingerprint`（12 位 sha256）。

---

## 6. 持久 Staging 目标（合并前运维）

**优先：** 独立 Vercel 项目 `qingyan-staging`，或长期分支 `staging`（勿只绑临时 PR 分支）。

必须绑定：

1. `DATABASE_URL` / `DIRECT_URL` → Staging Neon（`ep-floral-sea-au07ycff*`）  
2. `QINGYAN_RUNTIME_ENV=staging`  
3. `VERCEL_ENV` 正常为 preview（与 staging 声明一致，勿声明 production）  
4. `CRON_SECRET` → **新随机值**（≠ Production）  
5. 不设置 / 设为 false：`GMAIL_DRAFT_ENABLED`；微信/企微默认关闭  
6. 不设置任何 `QINGYAN_ALLOW_*`（除非受控测试）  
7. 无生产 `POSTFLOW_WORKER_TOKEN`  
8. **不得**复制生产环境变量全集  

可选：`QINGYAN_PRODUCTION_CRON_SECRET_SHA256` / `QINGYAN_PRODUCTION_WORKER_TOKEN_SHA256`。

部署后 `/api/health` 期望：`runtimeEnv=staging`、`dbPlane=staging`、`isolation=ok`、HTTP 200。

---

## 7. 写验收恢复条件

仅当本 PR **合并**且 Staging 部署确认后，才可在 **#47** 恢复：

`P5` / `I2` / `I6`–`I9` / `T4`–`T6`

生产继续只读。本文件**不**自动恢复写验收。
