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

## 2026-08-02 续修（head `30d7186`）

| 项 | 结果 |
|---|---|
| PR | #48 Draft（未合并） |
| head | `30d7186267387ccf7b9287d768afe34626c5ac30` |
| CI (push) | [30758274249](https://github.com/LucasJ880/-/actions/runs/30758274249) **success** |
| CI (PR) | [30758275773](https://github.com/LucasJ880/-/actions/runs/30758275773) **success** |
| Preview URL | `https://git-stabilization-wave15-staging-isolation-lucas-9039s-projects.vercel.app` |
| Deployment URL | `https://1fjstwfyh-8sjrtm7y6-lucas-9039s-projects.vercel.app` |
| 匿名 `/api/health` 探针 | **BLOCKED_BY_ENVIRONMENT**（Vercel Deployment Protection → SSO 302；非产品 FAIL） |
| 期望 health（SSO 后） | `runtimeEnv=staging` / `dbPlane=staging` / `isolation=ok` / HTTP 200；指纹 `e0d93a32b6a2`（≠ 生产 `c5ef22efc58d`） |
| 写入口接线 | Pending Action approve/reject + executor + createDraft；projects PATCH；tasks POST；worker claim/report；Postiz webhook；pushMessage/pushToBindings |
| 持久 Staging 目标 | 优先独立 Vercel 项目 `qingyan-staging` 或长期分支 `staging`（勿只绑临时 PR） |

历史运维错误（不计产品 FAIL）：分支未 push / DSN `&` 被 shell 解析 / Vercel `branch_not_found`。

## 2026-08-03 人工 Browser health 验证

| 项 | 值 |
|---|---|
| 验证时间（UTC） | `2026-08-03T01:29:02.333Z` |
| 目标 | PR #48 branch Preview `/api/health`（Vercel SSO 登录后） |
| `BROWSER_HEALTH_GATE` | **PASS** |
| HTTP | 200（推断自 `status=ok`） |
| `status` | `ok` |
| `checks.database` | `ok` |
| `checks.isolation` | `ok` |
| `checks.runtimeEnv` | `staging` |
| `checks.dbPlane` | `staging` |
| `checks.dbFingerprint` | `e0d93a32b6a2` |
| `checks.latencyMs` | `800` |

未记录：Cookie、连接串、Neon endpoint 全称、密码、OAuth 或任何 Secret。  
指纹 `e0d93a32b6a2` ≠ 生产指纹 `c5ef22efc58d`。

## 2026-08-03 持久 Staging 验证

| 项 | 值 |
|---|---|
| 验证时间（UTC） | `2026-08-03T02:34:37.607Z` |
| Vercel project | `qingyan-staging` |
| Git branch | `staging` |
| Deployment | Preview |
| Commit | `9f389a90c19b32a6d85515f7ffbf4a602837a7de` |
| `PERSISTENT_STAGING_GATE` | **PASS** |
| `status` | `ok` |
| `checks.database` | `ok` |
| `checks.isolation` | `ok` |
| `checks.runtimeEnv` | `staging` |
| `checks.dbPlane` | `staging` |
| `checks.dbFingerprint` | `e0d93a32b6a2` |
| `checks.latencyMs` | `803` |

未记录：连接串、Cookie、数据库密码、`CRON_SECRET` 或其他 Secret。

| 门禁 | 状态 |
|---|---|
| Browser `/api/health`（PR Preview） | **PASS** |
| 持久 Staging（`qingyan-staging` + `staging`） | **PASS** |
| #48 Ready for Review | 门禁通过后可 Ready；**不自动合并** |
| #47 写验收恢复 | **未启动**（须 #48 批准并明确授权合并后） |
| Wave2 | **未批准** |

**未自动恢复 #47 写验收；未启动 Wave2；不自动合并 #48。**

