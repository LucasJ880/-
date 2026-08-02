# Wave1.5 — 持久 Staging 目标（非敏感配置证明）

**日期（UTC）：** 2026-08-02  
**关联：** Draft PR #48（未合并）  
**状态：** 目标已声明；独立 Vercel 项目尚未创建（合并前阻塞项）

---

## 选定方案（优先）

独立 Vercel 项目：`qingyan-staging`

**备选：** 长期保留 git 分支 `staging`（绑定同一 Neon，勿只依赖临时 PR Preview）。

当前 PR 分支 Preview（`stabilization/wave15-staging-isolation`）**仅用于本轮代码验证**，不得作为最终 Staging。

---

## 必须绑定（非敏感）

| 项 | 值 / 策略 |
|---|---|
| Neon endpoint 前缀 | `ep-floral-sea-au07ycff`（≠ Production `ep-super-field-antfibsl`） |
| Neon project | `qingyan-wave15-staging` / `super-scene-97779903` |
| `QINGYAN_RUNTIME_ENV` | `staging` |
| `QINGYAN_EXPECTED_DB_PLANE` | `staging`（**必须显式**；PR Preview 亦须设置） |
| `VERCEL_ENV` | Vercel Preview 平面（勿声明 production） |
| `CRON_SECRET` | **独立新值**（≠ Production；不入库） |
| `POSTFLOW_WORKER_TOKEN` | **不配置**生产 token |
| `GMAIL_DRAFT_ENABLED` | 未设置 / `false` |
| `QINGYAN_ALLOW_*` | **默认全部不设置** |
| 微信 / 企微真实发送 | 默认关闭 |
| cron / worker | 默认关闭 |
| 环境变量策略 | **禁止**复制 Production 全集 |

可选指纹（匿名 health）：`e0d93a32b6a2`（`sha256(ep-floral-sea-au07ycff)[:12]`）

---

## 已完成 vs 待完成

| 项 | 状态 |
|---|---|
| Staging Neon + 合成种子 | **DONE** |
| PR 分支 Preview 绑定 Staging DSN + 独立 CRON_SECRET | **DONE**（运维侧） |
| 代码 fail-closed 白名单矩阵 | **DONE**（本 PR） |
| 独立 Vercel 项目 `qingyan-staging` | **TODO（合并前）** |
| 浏览器人工 `/api/health` 验证 | **PENDING_HUMAN**（SSO；不得标 PASS） |

---

## 历史运维错误（不计产品 FAIL）

- 分支尚未 push 时配置 env → `branch_not_found`
- DSN 中 `&` 被 shell 解析
- 后续传递 DSN：交互式 stdin / 严格引用 / 不回显 / 临时文件用完即删

**未恢复 #47 写验收；未进入 Wave2；未合并 #48。**
