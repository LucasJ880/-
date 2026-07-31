# Wave 1 PR4 — 公开路由与自治鉴权契约

**分支：** `stabilization/w1-pr4-public-route-auth`  
**基准：** 最新 `origin/main`（含 PR #42 merge `f5d84bb`）  
**日期：** 2026-07-31 / 2026-08-01 rebase  

---

## 1. 问题描述

Middleware 对若干前缀跳过 session；真实授权依赖路由内自治。漏配会导致未授权调用或（相反）合法 Cron 被 session 门禁误杀。

**澄清：** `PUBLIC_PATHS` 只表示「不要求浏览器 Session」，**不**表示匿名可执行写操作。

## 2. 契约矩阵（摘要）

| 路由前缀 | 谁可调用 | 凭据 | 组织上下文 | 签名 | 限流 | 审计 | 无凭据 | 错组织 |
|---|---|---|---|---|---|---|---|---|
| `/api/cron/*` | Vercel Cron / 运维 | `Authorization: Bearer CRON_SECRET` | 任务内按项目/org 扫描 | 无 | 平台 cron | 部分 tracked | **401** | N/A |
| `/api/trade/cron` | Vercel Cron | `requireTradeCronSecret`（CRON_SECRET） | 任务内 | 无 | 小时窗 | tracked | **401**（未配置 **503**） | N/A |
| `/api/v1/*` | 外部系统 | API Token (`verifyApiToken`) | token/payload + 权限 | 无 | NEEDS_VERIFICATION | `logAudit`（projects） | **401** | **403** PERMISSION |
| `/api/operations/worker/*` | PostFlow worker | `Bearer POSTFLOW_WORKER_TOKEN` | job 内 | 无 | NEEDS_VERIFICATION | NEEDS_VERIFICATION | **401** | N/A |
| `/api/trade/webhook/*` | 微信/WhatsApp | Token/签名 | channel→org | 是 | NEEDS_VERIFICATION | NEEDS_VERIFICATION | 403/401/501 | 路由拒绝 |
| `/api/webhooks/firecrawl/*` | Firecrawl | signature/token | 任务绑定 | 是 | NEEDS_VERIFICATION | NEEDS_VERIFICATION | 401/403 | N/A |
| `/api/messaging/wecom/callback` | 企业微信 | msg_signature + encoding | gateway.org | 是 | NEEDS_VERIFICATION | NEEDS_VERIFICATION | **403** | N/A |
| `/api/sales/quotes/share/[token]` | 持有 shareToken 的客户 | URL token | 报价所属 org（隐式） | 无 | NEEDS_VERIFICATION | 签署路径部分 | **404** | 无跨 org 枚举 |
| `/api/visualizer/share` | 持有分享 token | token | session org | 无 | NEEDS_VERIFICATION | NEEDS_VERIFICATION | 401/404 | N/A |
| `/api/health` | 探活 | 无 | 无 | 无 | 无 | 无 | **200/503** | N/A |
| `/api/auth/login\|register\|…` | 匿名/OAuth | 各端点自有 | 登录后 | 视提供商 | 视实现 | 登录审计部分 | 400/401 | N/A |

完整断言见 `scripts/public-route-auth-contracts.test.ts`（静态契约 + `requireTradeCronSecret` / middleware 最小动态）。

## 3. 根因（本 PR 修复点）

`/api/trade/cron` 已在路由内校验 `CRON_SECRET`，但 **未** 列入 `PUBLIC_PATHS`。  
Vercel Cron 只带 Bearer、不带 `qy_session` → 被 middleware 以「未登录」拦截，密钥检查不可达。

## 4. `/api/trade/cron` 鉴权调用链

1. Middleware：`/api/trade/cron` ∈ `PUBLIC_PATHS` → 跳过 session  
2. `POST`/`GET` → `requireTradeCronSecret(request)`  
3. Helper 读 `process.env.CRON_SECRET`（服务端 env）  
4. 仅接受 `Authorization` 头与 `Bearer ${secret}` 全等；不接受 query / cookie / body  
5. 未配置 → **503**；无/错 Authorization → **401**；通过 → `null`，进入业务  

## 5. 修改文件

| 文件 | 变更 |
|---|---|
| `src/middleware.ts` | 增加 `/api/trade/cron` 到 PUBLIC_PATHS（**不**放宽密钥要求） |
| `src/app/api/health/route.ts` | 修正过时注释（本已在公开名单） |
| `scripts/public-route-auth-contracts.test.ts` | 契约 + helper/middleware 动态测试 |
| `scripts/test-ci-unit.sh` | 纳入 CI 子集（保留 #42 schema-drift 测试） |
| 本文档 | 矩阵与调用链 |

## 6. 未修改范围

- 未扩大 super admin / 组织隔离  
- 未改 `requireTradeCronSecret` 实现（仍为普通字符串比较）  
- 未改 share token / Session / API Token 数据模型  
- 未改审批、报价业务、Agent Runtime  
- 无 Schema / migration / 生产 DB / 生产 secret 操作  

## 7. 测试

`npx tsx scripts/public-route-auth-contracts.test.ts`  
`npm run test:ci`（含 release-safety、#42 schema-drift、本测试）

**已覆盖：** 无凭据 / 错凭据 / 未配置 / 正确 Bearer；middleware 不要求 session；响应不含 secret。  
**未覆盖：** 完整 route handler + `runDailyCron` 集成（需 stub 业务与 DB）。

## 8. 安全影响

- **收紧可达性正确性：** Cron 只能在持有 `CRON_SECRET` 时执行（与 `/api/cron/*` 一致）  
- 无凭据仍 401；未配置 secret 仍 fail-closed（503）  

## 9. 数据库影响

无。

## 10. 回滚

Revert middleware 一行即可；契约测试一并回滚。

## 11. 剩余风险

- `requireTradeCronSecret` **未**使用 `crypto.timingSafeEqual`；仓库也无共用 Bearer 安全比较 helper。按本 PR 文件范围 **未**擅自改 `src/lib/trade/access.ts`（建议 follow-up）。  
- 限流/审计覆盖不完整（标 NEEDS_VERIFICATION，属 Wave2+）  
- share token 熵与泄露面 — 产品接受度问题  
- 其他 `/api/cron/*` 同样为普通字符串比较  

## 12. P0 状态

**P0-04：部分关闭** — 契约测试落地 + trade/cron session 门禁修复；常量时间比较与全量动态 fuzz 未做。  
