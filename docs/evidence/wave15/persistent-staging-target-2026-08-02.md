# Wave1.5 — 持久 Staging 目标（非敏感配置证明）

**日期（UTC）：** 2026-08-02  
**关联：** PR #48  
**状态：** `PERSISTENT_STAGING_GATE = PASS`（2026-08-03）

---

## 选定方案（已落地）

| 项 | 值 |
|---|---|
| Vercel project | `qingyan-staging` |
| Git branch | `staging` |
| Deployment environment | Preview |
| Verified commit | `9f389a90c19b32a6d85515f7ffbf4a602837a7de` |

PR 分支 Preview（`stabilization/wave15-staging-isolation`）仍可用于代码验证；长期 Staging 以本项目 + `staging` 分支为准。

---

## 必须绑定（非敏感）

| 项 | 值 / 策略 |
|---|---|
| Neon endpoint 前缀 | `ep-floral-sea-au07ycff`（≠ Production `ep-super-field-antfibsl`） |
| Neon project | `qingyan-wave15-staging` / `super-scene-97779903` |
| `QINGYAN_RUNTIME_ENV` | `staging` |
| `QINGYAN_EXPECTED_DB_PLANE` | `staging`（显式） |
| `VERCEL_ENV` | Preview 平面（勿声明 production） |
| `CRON_SECRET` | **独立新值**（≠ Production；不入库） |
| `POSTFLOW_WORKER_TOKEN` | **不配置**生产 token |
| `GMAIL_DRAFT_ENABLED` | 未设置 / `false` |
| `QINGYAN_ALLOW_*` | **默认全部不设置** |
| 微信 / 企微真实发送 | 默认关闭 |
| cron / worker | 默认关闭 |
| 环境变量策略 | **禁止**复制 Production 全集 |

匿名 health 指纹：`e0d93a32b6a2`（≠ 生产 `c5ef22efc58d`）

---

## 已完成 vs 待完成

| 项 | 状态 |
|---|---|
| Staging Neon + 合成种子 | **DONE** |
| PR 分支 Preview 绑定 Staging DSN + 独立 CRON_SECRET | **DONE** |
| 代码 fail-closed 白名单矩阵 | **DONE**（#48） |
| 独立 Vercel 项目 `qingyan-staging` | **DONE** |
| 长期 git 分支 `staging` | **DONE** |
| 浏览器人工 `/api/health`（PR Preview） | **PASS**（`2026-08-03T01:29:02.333Z`） |
| 浏览器人工 `/api/health`（持久 Staging） | **PASS**（`2026-08-03T02:34:37.607Z`） |
| `PERSISTENT_STAGING_GATE` | **PASS** |

---

## 2026-08-03 持久 Staging health（脱敏）

| 项 | 值 |
|---|---|
| 验证时间（UTC） | `2026-08-03T02:34:37.607Z` |
| Vercel project | `qingyan-staging` |
| Git branch | `staging` |
| Deployment | Preview |
| Commit | `9f389a90c19b32a6d85515f7ffbf4a602837a7de` |
| `status` | `ok` |
| `checks.database` | `ok` |
| `checks.isolation` | `ok` |
| `checks.runtimeEnv` | `staging` |
| `checks.dbPlane` | `staging` |
| `checks.dbFingerprint` | `e0d93a32b6a2` |
| `checks.latencyMs` | `803` |

未记录：连接串、Cookie、数据库密码、`CRON_SECRET` 或其他 Secret。

---

## 历史运维错误（不计产品 FAIL）

- 分支尚未 push 时配置 env → `branch_not_found`
- DSN 中 `&` 被 shell 解析
- 后续传递 DSN：交互式 stdin / 严格引用 / 不回显 / 临时文件用完即删

**未恢复 #47 写验收；未进入 Wave2；不自动合并 #48。**
