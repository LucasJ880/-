# 青砚系统清单（System Inventory）

**审计角色：** Acting CTO（只读）  
**审计基准：** `/Users/user/Desktop/青砚` @ `80c76e4`（`feature/agent-runtime-2-phase1`）  
**对照生产 tip：** worktree `青砚-visualizer-templates` @ `2255f8d`（`main`）  
**日期：** 2026-07-31  
**约束：** 未改业务代码 / Schema / 迁移；未进入修复阶段。

---

## 0. 审计范围声明

| 项 | 值 |
|---|---|
| 主审计树 | Cursor 工作区 `青砚` |
| 生产 tip 对照 | git worktree `青砚-visualizer-templates`（`main` = `2255f8d`） |
| merge-base | `80c76e4`（工作区是 `main` 的祖先，**落后于生产 tip**） |
| 结论影响 | 本清单以工作区为准；与 `main` 的差异单列为 **P0 工作区漂移风险** |

---

## 1. 项目目录结构（关键）

```
青砚/
├── prisma/                 # schema.prisma (~6420 行), migrations/, seed.ts
├── src/
│   ├── app/                # App Router：页面 + API Routes
│   ├── components/         # UI 组件
│   ├── hooks/
│   ├── lib/                # 业务 Service / 领域逻辑（93 个子目录）
│   ├── middleware.ts       # JWT cookie 门禁
│   └── instrumentation*.ts # Sentry 等
├── scripts/                # 测试入口、审计脚本、seed、worker
├── docs/                   # 交付/事故/阶段报告
├── deploy/                 # activepieces / postiz / workers
├── public/
├── package.json
└── vercel.json             # Cron 定义
```

---

## 2. 框架 / 语言 / 主要依赖

| 类别 | 技术 | 依据 |
|---|---|---|
| 框架 | Next.js **16.2.0**（App Router） | `package.json` |
| UI | React **19.2.4** + Tailwind 4 | `package.json` |
| 语言 | TypeScript 5 | `package.json` / `tsconfig.json` |
| ORM | Prisma **6.19.2** | `package.json` / `prisma/schema.prisma` |
| Auth | `jose` JWT + cookie `qy_session` | `src/middleware.ts`, `src/lib/auth` |
| 存储 | `@vercel/blob` | `src/lib/files/blob-access.ts` |
| AI | `openai`, LangChain/LangGraph | `package.json`, `src/lib/agent-*` |
| 邮件 | `googleapis` / Gmail draft；`nodemailer`/`resend` | `src/lib/google-email.ts` |
| 监控 | `@sentry/nextjs` | `package.json`, instrumentation |
| 限流 | `@upstash/ratelimit` + Redis | `package.json` |
| 测试 | `tsx` 脚本式单测 + Playwright（dev） | `scripts/test-all.sh` |
| Server Actions | **未使用**（`"use server"` 计数 = 0） | ripgrep |

---

## 3. 前端页面与路由

- **页面数：** 127（`src/app/**/page.tsx`）
- **主要分段：**
  - Auth：`(auth)/login|register|select-org`
  - Main shell：`(main)/` — 首页、tasks、projects、sales、trade、operations、capabilities、settings、wechat、inbox 等
  - Public：`/quote/[token]`、`/sales/share/visualizer/[token]`、`/display`

完整列表见仓库内 `find src/app -name page.tsx`（审计时已枚举）。

---

## 4. API Routes

- **Route 文件数：** 526（`src/app/api/**/route.ts`）
- **主要分组：** `auth`, `sales`, `trade`, `projects`, `tasks`, `ai`, `operations`, `capabilities`, `agent*`, `messaging`, `cron`, `files`, `visualizer`, `webhooks`, `organizations`, `audit-logs` 等
- **withAuth 包装：** 约 302 / 526（其余含 cron/webhook/share token/组织旧接口等，需逐条鉴权核对）

---

## 5. Service 层（`src/lib`）

代表性模块（非穷尽）：

| 域 | 路径 |
|---|---|
| 销售 | `src/lib/sales/*` |
| 投标 Bid Data | `src/lib/project-bid-data/*` |
| Pending Action | `src/lib/pending-actions/*` |
| AI Grader | `src/lib/ai-grader/*` |
| Agent（多套） | `agent`, `agent-core`, `agent-runtime`, `agent-runtime-v2`, `agent-supervisor` |
| 权限 | `src/lib/authorization/*` + `src/lib/rbac/*` |
| 组织 | `src/lib/organizations/*`, `src/lib/tenancy/*` |
| 文件 | `src/lib/files/*` |
| 运营 | `src/lib/operations/*` |
| 审计 | `src/lib/audit/*` |
| 微信/企微 | `src/lib/messaging/*`, WeChat models |

---

## 6. Prisma / 数据模型

- **Schema：** `prisma/schema.prisma`
- **模型数（工作区）：** **219**
- **生产 tip（main）模型数：** 214（Phase B/C 后结构不同；数字差异反映分支漂移）
- **核心业务模型（已确认存在）：**  
  `SalesCustomer`, `SalesOpportunity`, `SalesQuote`, `Project`, `Task`, `ProjectDocument`, `PendingAction`, `BidDataRevision`, `TenderRequirement`, `ProductEvidence`, `ComplianceResponse`, `PricingScenario`, `AuditLog`, `Organization`, `OrganizationMember`, `WeChatMessage`, `CustomerProfile`, `TradeProspect`, `ProjectQuote` …

---

## 7. Authentication / Authorization

| 层 | 位置 | 说明 |
|---|---|---|
| Edge 登录门禁 | `src/middleware.ts` | JWT cookie；公开路径白名单 |
| API 认证包装 | `src/lib/common/api-helpers.ts` → `withAuth` | 401/403 + 统一 500 |
| 会话用户 | `src/lib/auth` | `getCurrentUser` |
| Security-1 权限注册表 | `src/lib/authorization/permissions.ts` + `authorize.ts` | 新路径 |
| 旧 RBAC / data-scope | `src/lib/rbac/*` | 仍被 PendingAction / 多处使用 |
| 组织解析 | `resolveSalesOrgIdForRequest`, `active-org`, `select-org` 页 | 多入口 |

---

## 8. 组织与角色隔离

- 模型：`Organization`, `OrganizationMember`, Role Profile（Security-1）
- Sales：`src/lib/sales/org-context.ts` + `rbac/data-scope.ts`（`salesCreatedScope` / `salesAssignableScope`）
- PendingAction：列级 `orgId` + metadata 二次校验（`executor.ts`）
- Super admin 跨组织：`isPlatformSuperAdmin` → scope `null`（**高权限路径，需审计关注**）

---

## 9. 文件上传与存储

- 统一 Blob：`src/lib/files/blob-access.ts`（`@vercel/blob`）
- 解析/摘要：`parse-content.ts`, `ai-summary.ts`
- 项目文件：`ProjectDocument` + `src/components/project-files/*`
- API：`src/app/api/files/**`, product-content upload 等

---

## 10. Gmail / 邮件草稿

- `src/lib/google-email.ts`：`createGmailDraft`, `assertGmailDraftReady`
- PendingAction 类型：`grader.email_draft`（`src/lib/pending-actions/types.ts`）
- 销售：`src/lib/sales/email-composer.ts`, `/api/sales/email-compose`
- 设置页：`(main)/settings/email`

---

## 11. 微信 / 企业微信

- 模型：`WeChatBinding`, `WeChatGateway`, `WeChatMessage`, `WeChatContext`, `WeChatGraderContext`
- API：`/api/auth/wechat`, `/api/messaging/wecom/callback`, trade webhook
- Worker：`npm run wechat:worker` → `scripts/wechat-worker.ts`
- Grader 微信链路：`src/lib/ai-grader/wechat-*.ts`
- 页面：`(main)/wechat`, `settings/wechat`

---

## 12. AI Agent / Grader / Pending Action / Task Center

| 概念 | 路径 |
|---|---|
| Agent Runtime v1 | `src/lib/agent-runtime` |
| Agent Runtime v2 | `src/lib/agent-runtime-v2` |
| Agent Supervisor | `src/lib/agent-supervisor` |
| Agent Core + tools | `src/lib/agent-core` |
| AI Grader | `src/lib/ai-grader` |
| PendingAction 执行 | `src/lib/pending-actions/executor.ts` |
| API | `/api/ai/pending-actions`, `/api/agent*`, `/api/capabilities/*` |
| Task | `Task` 模型 + `/api/tasks`, `(main)/tasks` |
| Project Orchestrator Task Center | `src/lib/project-orchestrator` + 项目 AI tasks 页 |

---

## 13. 客户 / 商机 / 报价 / 项目 / 投标

| 域 | 页面入口 | API | Lib |
|---|---|---|---|
| 客户 | `/sales`, `/sales/customers/[id]` | `/api/sales/customers` | `lib/sales` |
| 商机 | sales 列表/详情 | `/api/sales/opportunities` | `opportunity-lifecycle.ts` |
| 报价 | `/sales/quotes`, `/quote/[token]` | `/api/sales/quotes` | sales + quote |
| 项目 | `/projects`, `/projects/[id]` | `/api/projects` | `lib/projects`, orchestrator |
| 投标 Bid Data | `/projects/[id]/bid-data` | `/api/projects/[id]/bid-data/**` | `lib/project-bid-data` |
| 外贸并行 | `/trade/**` | `/api/trade/**` | `lib/trade` |

---

## 14. 测试 / CI/CD / 部署

| 项 | 状态 | 依据 |
|---|---|---|
| 单元测试入口 | `npm test` → `scripts/test-all.sh` | 含 tsc |
| GitHub Actions | **无** `.github/workflows` | 目录不存在 |
| Vercel | `vercel.json` crons + `.vercel` | 存在 |
| Deploy 辅助 | `deploy/*` workers | 存在 |
| 工作区 `npm run build` | **含 `prisma migrate deploy`** | `package.json` L9 — **危险** |
| main tip `build` | 仅 `prisma generate && next build` | worktree `package.json` |

---

## 15. 日志 / 监控 / 审计

- API 日志：`src/lib/common/logger.ts` + requestId（`withAuth`）
- Sentry：`instrumentation.ts` / `@sentry/nextjs`
- 审计：`AuditLog` + `src/lib/audit/logger.ts`；页面 `(main)/admin/audit-logs`；API `/api/audit-logs`

---

## 16. 静态验证快照（本轮）

见 `QINGYAN_TEST_COVERAGE_GAPS.md` 与汇报摘要。要点：

| 检查 | 结果 |
|---|---|
| `prisma validate` | PASS |
| `npm run lint` | **FAIL** — 59 errors / 111 warnings |
| `tsc --noEmit`（src） | PASS（0）；`.next/types` 生成类型另有问题 |
| 安全 build（无 migrate） | **FAIL** — Turbopack parse error |
| 关键单测抽样 6 项 | 6/6 PASS |

---

## 17. NEEDS_VERIFICATION

1. 生产线上实际运行的是 `main@2255f8d` 还是其它 alias（需 Vercel 部署记录确认）。
2. 工作区分支是否仍计划合并，还是应废弃（产品/工程决策）。
3. 无 GitHub Actions 是否刻意依赖 Vercel + 人工脚本（部署策略确认）。
