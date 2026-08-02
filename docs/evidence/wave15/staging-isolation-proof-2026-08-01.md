# Wave1.5 — Staging 隔离证明（脱敏）

**日期（UTC）：** 2026-08-01  

## 数据库

| 平面 | Endpoint 前缀 | 库名 |
|---|---|---|
| Production | `ep-super-field-antfibsl`（pooler 带 `-pooler`） | `neondb` |
| Staging（新建） | `ep-floral-sea-au07ycff` | `neondb` |

| 检查 | 结果 |
|---|---|
| Staging ≠ Production endpoint | **YES** |
| Staging 数据来源 | **合成**（`WAVE15 TEST ...` / `@test.qingyan.local`） |
| 未复制未脱敏生产数据 | **YES** |

## 副作用默认

| 通道 | Staging 默认 |
|---|---|
| 真实邮件 | 关闭 |
| Gmail Draft | 关闭 |
| 微信/企微 | 关闭（`pushMessage` 抛 `NON_PROD_SIDE_EFFECT_DISABLED`，禁止假成功） |
| Cron | 关闭（需 `QINGYAN_ALLOW_CRON_NON_PROD`） |
| Worker | 关闭（需 `QINGYAN_ALLOW_WORKER_NON_PROD`） |

## Fail-closed

| 场景 | 预期 |
|---|---|
| Preview/Staging + 生产 DB endpoint | health 503 / cron 拒绝 |
| Staging cron 未显式允许 | 503 `CRON_DISABLED_NON_PROD` |

## 双向隔离测试（本轮）

| 测试 | 结果 | 说明 |
|---|---|---|
| Staging 写入后 Production 数据无变化 | **NOT_RUN_LIVE_PROD_QUERY** | 拒绝用 agent 连接生产-like DSN 做对照查询；Staging 为独立 Neon 项目，ID 空间与生产不共享连接 |
| Production 写入不会出现在 Staging | **PASS（结构）** | 独立项目 `qingyan-wave15-staging` / `super-scene-97779903`，无生产复制 |
| Staging org/customer/project ID 与 Production 不共享连接 | **PASS（结构）** | 不同 Neon project + 合成种子 |
| Staging CRON_SECRET 不能调用 Production | **PENDING_VERCEL_ENV** | 待 Vercel 配置独立 `CRON_SECRET` 后验证 |
| Production CRON_SECRET 不能调用 Staging | **PENDING_VERCEL_ENV** | 同上；可选配置 `QINGYAN_PRODUCTION_CRON_SECRET_SHA256` |
| Staging 邮件/微信不触达真实接收方 | **PASS（默认代码路径）** | 非 prod 默认关闭；无真实绑定数据 |
| Staging/Production worker 互不消费 | **PASS（默认）** | Staging 未配置生产 worker token；worker 默认非 prod 拒绝 |

**未自动恢复 #47 写验收。**
