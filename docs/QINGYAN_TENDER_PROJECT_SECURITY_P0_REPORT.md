# Qingyan Tender / Project Security P0 — Authorization & Internal Data Exposure Closure

| 项 | 值 |
|---|---|
| Base main SHA | `da50d2c` （含 PR #87 2D-1、PR #92 Tender T0） |
| Branch | `fix/tender-project-security-p0` |
| PR | Draft（DOCS+CODE，仅授权/数据暴露修复） |
| 日期 | 2026-08-10 |
| SECURITY_P0 | YES |
| SCHEMA_CHANGE | NONE |
| WORKFORCE_RUNTIME_CORE_MODIFIED | NO |
| TENDER_UX_REDESIGN | NO |
| NAVIGATION_CHANGE | NO |
| PRODUCTION_MUTATION | NO |

> This PR closes authorization / internal-data-exposure findings only. **It does not start Tender T1.**

---

## 1. Executive Summary

Tender T0 审计（PR #92）在 `/api/agent/tasks/**` 面标记了一组 P0：**AI 任务的执行/取消/读取缺少服务端授权，且任务步骤的内部执行数据（inputJson / outputJson / checkReportJson / 原始 error）被原样下发给普通业务用户**。本 PR 在 **API / service 访问边界** 关闭这些缺口，全部复用青砚既有授权原语（`requireProjectReadAccess` / `requireProjectManageAccess` / `isPlatformAdmin`）与既有 DTO 分流模式（对齐 `src/lib/conversations/dto.ts`）。

- **未改** 任何 Workforce Runtime / Agent Runtime V2 core、任务生命周期、审批决策语义、Prisma schema、导航、i18n。
- `AgentTask` 是独立 Prisma 模型（`projectId` FK + `createdById`），**非** Workforce `AgentRun`——授权在路由边界叠加即可，无需触碰运行时。
- T0 findings 中的 **conversations 与 ai-activity 已在 main 上被前序安全提交修复**（见 §3），本 PR 复核确认，不重复实现。

---

## 2. Base / Branch / PR / Head

- Base main：`da50d2c`（`git checkout -b fix/tender-project-security-p0 origin/main`）
- Branch：`fix/tender-project-security-p0`
- Head：见 PR（docs+code）
- 隔离：未基于 `#93`（2B-2 冻结）/ `#94`（Runtime P0）/ 旧 T0 分支；未 cherry-pick 任何 runtime feature 分支。

---

## 3. T0 Findings Revalidation

| Finding | 结论 | 证据 |
|---|---|---|
| **SEC-A** `/projects/[id]/conversations` 无 server gate | **ALREADY_FIXED_ON_MAIN** | 前序提交 `e08f3b5`（harden conversation diagnostic api boundaries）/ `d4199eb`（hide internal ai diagnostics）。API 全链走 `requireProjectReadAccess`（成员/org/404 语义）+ `isPlatformAdmin` 决定 `toBusinessConversationDto` vs `toPlatformDiagnostic*`；`tool-traces`/`run` 走 `requireDiagnosticProjectReadAccess`（平台管理员+项目）。 |
| **SEC-B** `/ai-activity` URL 可达 | **ALREADY_SECURED / NOT_REPRODUCED** | `/api/ai/activity` (`withAuth`) 硬限 `where.userId = user.id`；`projectId` 仅追加过滤不放宽；`afterData` 仅抽取 `subject/title/supplier/type`。每用户只见自己的活动，无跨用户/跨 org 暴露。页面无门但数据自限，非安全洞。 |
| **SEC-C** AgentTask execute 无授权 | **CONFIRMED → FIXED** | `execute/route.ts` 原仅 `withAuth`，直调 `executeFlowTask(taskId)`；flow-runner 不收 principal。 |
| **SEC-D** AgentTask cancel 无授权 | **CONFIRMED → FIXED** | `cancel/route.ts` 原仅 `withAuth` → `cancelFlowTask(taskId)`。 |
| **SEC-E** 普通用户可见 raw Agent Step JSON | **CONFIRMED → FIXED** | `tasks/[taskId]` GET 原 `include:{steps}` 无 select，`inputJson/outputJson/checkReportJson/error` 原样下发；`step-detail-panel.tsx` `JSON.stringify` 裸渲染。 |
| （同类）list GET / POST create / PATCH pause 无项目授权（跨 org） | **CONFIRMED → FIXED** | 同一模块同类漏洞，一并修复。 |
| （同类）steps approve/reject 无租户前置门 | **CONFIRMED → HARDENED** | 前置项目读授权；审批**决策语义仍由 ApprovalPort 保留**（不改 §18）。 |

---

## 4. Conversations — before / after

- **Before / After 一致**：无需改动。API 已由 `e08f3b5`/`d4199eb` 加固：非平台管理员走业务 DTO（无 token/cost/prompt/tool-trace），跨 org / 非成员被 `requireProjectReadAccess` 以 404/403 拦截。本 PR 仅复核。

## 5. AI Activity — audit result

- `/api/ai/activity` 自限 `userId = user.id`（`withAuth`）。**AI_ACTIVITY_SERVER_AUTH = NOT_REQUIRED**（数据本身自限，无跨租户面）。未改动，避免过度工程（§13）。

## 6. AgentTask execute — before / after

| | Before | After |
|---|---|---|
| 授权 | 仅 `withAuth`（认证） | `withAuth` + 载入 `task.projectId` → `requireProjectManageAccess`（super_admin / owner / org_admin / project_admin）；任务不存在 404 |
| 直接打 API | 任意登录用户凭 taskId 可执行任意 org 任务 | 非管理者/跨 org → 403/404，`executeFlowTask` **不被调用**（零副作用） |
| resume 分支 | 同上 | 同一 manage 闸覆盖 `resumeFlowAfterApproval` |

## 7. AgentTask cancel — before / after

| | Before | After |
|---|---|---|
| 授权 | 仅 `withAuth` | `withAuth` + `requireProjectManageAccess`（同上）；任务不存在 404 |
| 直接打 API | 凭 taskId 即可取消 | 拦截后 `cancelFlowTask` 不被调用 |

## 8. Raw internal data exposure — before / after

新增安全投影模块 `src/lib/agent-tasks/dto.ts`（对齐 `conversations/dto.ts` 的「业务 vs 平台诊断」模式，禁止「先返回完整对象再由前端删字段」）：

| 数据 | Before（所有登录用户） | After（业务用户） | After（平台管理员） |
|---|---|---|---|
| `AgentTaskStep.inputJson` | 原文下发 + UI `JSON.stringify` 裸渲染 | `null`（不出服务端） | 完整（诊断） |
| `AgentTaskStep.outputJson` | 同上 | `null` | 完整 |
| `AgentTaskStep.checkReportJson` | 同上 | `null` | 完整 |
| `AgentTaskStep.error`（原始/含 stack） | 原文 | 脱敏文案「处理失败，请稍后重试或联系管理员」+ `hasError` 标记 | 原始 |
| `ApprovalRequest.previewJson / riskReason / decisionNote` | 原文（detail GET include） | 移除 | 完整 |
| list GET step.error | 原文 | 脱敏 | 原始 |

- `step-detail-panel.tsx` **无需改动**：`safeJsonParse(null)` 返回 null → 原始 JSON section 自然不渲染（服务端权威裁剪，UI 优雅降级）。
- **已知取舍（记入 debt）**：detail GET 对业务用户置空 `outputJson` 后，`SupplyChainCard`（`skillId==="supply_chain_analysis"` 时从原始 output 渲染的结构化卡）对非管理员不再显示。这是安全优先的服务端最小化选择；若产品需为业务用户保留该可视化，应在 T1 建独立 **safe presentation projection**（§20），不属本 P0。
- **未改动 `/api/agent/tasks/recent`**：该端点自限 `createdById = user.id`（本人的自动巡检任务），其 `checkReportJson` 被 dashboard「自动巡检」卡（`dashboard-auto-inspections.tsx`）解析为**结构化业务卡**（非 raw dump）。剥离会破坏合法业务功能且非确认漏洞，故保留；如需硬化另立安全投影任务。

## 9. Authorization primitives reused

- `src/lib/projects/access.ts`：`requireProjectReadAccess` / `requireProjectManageAccess`（= `requireProjectWriteAccess`）。含 super_admin / owner / org_admin / project_admin 判定、404（缺失/未分发）vs 403（无权）语义、**服务端** org membership 查询。
- `src/lib/rbac/platform-admin.ts`：`isPlatformAdmin`。
- 未新写第二套授权世界（无 `isUserAllowedTenderTask()` 之类）。

## 10. Tenant isolation

- 所有相关 endpoint（read / execute / cancel / create / approve / reject）先按 **任务自身的 `projectId`** 解析授权；`requireProject*Access` 用 `project.orgId` + 服务端 `getOrgMembership` 判定，**从不信任客户端提交的 orgId**（§24 stale/invalid activeOrg 不适用——授权不读客户端 org）。
- 跨 org 的 project/task/run/conversation id → 404/403，覆盖读与写。

## 11. Denied mutation zero-side-effect proof

- execute / cancel / PATCH / create：授权失败在**调用 flow-runner / generateFlowPlan 之前**返回 `NextResponse`，`executeFlowTask` / `cancelFlowTask` / `generateFlowPlan` / `db.agentTask.update` 均不执行 → AgentTask / AgentTaskStep / ApprovalRequest 状态不变，无外部调用 / 邮件 / 日历 / 工具执行。
- approve / reject：前置读授权失败即 return，`approveApprovalItem` / `rejectApprovalItem` 不被调用。
- 由 `authz-contract.test.ts` 断言「授权符号出现在调用点之前」的布线（源码契约级），防回归。

## 12. Tests

| 测试 | 覆盖 | 结果 |
|---|---|---|
| `src/lib/agent-tasks/__tests__/dto.test.ts` | S10：业务投影序列化不含 input/output/checkReport/raw error/preview/riskReason 秘密；内部字段键位为 null；error 脱敏；诊断投影保留原文；completed 步骤不误标错误 | **23/23 PASS** |
| `src/app/api/agent/tasks/__tests__/route-exec.test.ts` | **路由级可执行**：驱动 execute/cancel 路由实际委托的 `runGuardedTaskMutation`，注入计数依赖——① execute 未授权→拦截+`executeFlowTask` 计数 0；② cancel 未授权→拦截+`cancelFlowTask` 计数 0；③ execute 已授权→flow runner 恰好一次；④ cancel 已授权→恰好一次；⑤ 跨 org taskId→拦截+零 flow-runner 调用；⑥ 拒绝前后 AgentTask status 不变；附加：任务不存在→404 且不调用 authorize/flow-runner | **15/15 PASS** |
| `src/app/api/agent/tasks/__tests__/authz-contract.test.ts` | S5/S6/S7/§27：逐路由源码契约——execute/cancel 经 `requireProjectManageAccess`+`runGuardedTaskMutation` 守卫编排派发，PATCH/POST 需 `requireProjectManageAccess`，detail/list/approve/reject 需 `requireProjectReadAccess`+投影；mutation 路由不得「仅 withAuth」 | **9/9 PASS** |
| 关联既有回归 | `agent-scope`(24)、`pre-execute-guard`(33)、`org-access`(16) | PASS |
| `npx tsc --noEmit` | 全项目类型 | PASS |
| `eslint`（全部改动文件） | — | PASS（0） |
| `next build` | — | **CI-gated**（`validate-lint-typecheck-test-build`；worktree 无 .env，不本地跑生产库；tsc+eslint 为本地编译门） |

**路由级测试实现方式**：execute/cancel 路由的「载入 projectId → 授权 → 派发」守卫链抽取为共用编排 `src/lib/agent-tasks/guarded-mutation.ts::runGuardedTaskMutation`（生产行为不变，两路由均委托它）；`route-exec.test.ts` 直接驱动该编排函数并注入带计数器的假 `onAuthorized`/假 `authorize`，从而在无 DB / 无真实 JWT 的环境下可执行地验证「拒绝路径零 flow-runner 调用、授权路径恰好一次、拒绝态 AgentTask status 不变」。真实路由把 `requireProjectManageAccess` 与 `executeFlowTask/cancelFlowTask` 传入相同 slot（由 `authz-contract.test.ts` 源码契约锁定）。

S1–S4/S8/S9/S11/S12 说明：S1（未登录）/S2（无 active 成员）/S3（成员可读）/S4（同 org 无项目权）/S5（跨 org）由复用的 `requireProject*Access` 语义保证（该 helper 已被既有 `tenant-isolation` 等套件覆盖）；S8/S9（授权管理者 execute/cancel 仍可用）——`route-exec` 已授权用例断言 flow runner 恰好一次，且授权通过后原 flow-runner 调用路径未变；S11（平台管理员诊断视图）由 `isPlatformAdmin` 分流保留；S12（拒绝零副作用）见 §11 + `route-exec` 计数用例。DB 集成态 S 矩阵未跑真实库（§30：纯 unit/契约/编排级足够，且 worktree DB 平面 fail-closed）。

## 13. Changed files

```
新增  src/lib/agent-tasks/dto.ts                                   安全投影（业务/诊断）
新增  src/lib/agent-tasks/guarded-mutation.ts                      execute/cancel 共用授权编排（load→authorize→dispatch）
新增  src/lib/agent-tasks/__tests__/dto.test.ts                    S10 数据最小化单测
新增  src/app/api/agent/tasks/__tests__/authz-contract.test.ts     授权布线契约测试
新增  src/app/api/agent/tasks/__tests__/route-exec.test.ts         路由级可执行测试（flow-runner 调用计数 / 零副作用）
改    src/app/api/agent/tasks/route.ts                             GET 读授权+error 脱敏；POST 管理授权
改    src/app/api/agent/tasks/[taskId]/route.ts                    GET 读授权+安全投影；PATCH 管理授权
改    src/app/api/agent/tasks/[taskId]/execute/route.ts            manage 授权 + 404（委托 runGuardedTaskMutation）
改    src/app/api/agent/tasks/[taskId]/cancel/route.ts             manage 授权 + 404（委托 runGuardedTaskMutation）
改    src/app/api/agent/tasks/[taskId]/steps/[stepId]/approve/route.ts  读授权前置（租户隔离）
改    src/app/api/agent/tasks/[taskId]/steps/[stepId]/reject/route.ts   读授权前置（租户隔离）
改    scripts/test-all.sh                                          注册 3 个安全测试
```

未触碰：`workforce-runtime/**`、`agent-runtime-v2/{executor,persist,process,planner,adapters,schemas}`、`prisma/**`、`schema.prisma`、导航、i18n、审批 core、UI 组件。

## 14. Explicit non-scope

未做（严格遵守任务书 §28）：Tender 5-Tab、导航整合、`/bids` 清理、stub 路由清理、ProjectEvent / Archive / Memory / Buyer / AwardRecord / Fingerprint / Vector / Intelligence / Award Watch / 自动化、2B-2 / #94 / 2B-3 / 2C-3、新 PendingAction 语义、schema migration、新 RBAC/角色模型、Vercel 配置、`recent`/dashboard 巡检卡改造、审批决策语义变更。

## 15. Remaining debt

| # | 项 | 归属 |
|---|---|---|
| SD-1 | `SupplyChainCard` 依赖原始 step output——业务用户安全投影后不显示；需 T1 建 safe presentation projection | T1 |
| SD-2 | `/api/agent/tasks/recent` 的 `checkReportJson` 仍下发（自限本人，供结构化巡检卡）；未来可为其建安全投影 | 后续 |
| SD-3 | AgentTask 面板整体 → INTERNAL_ONLY（T0 Roadmap T1-PR4 决策），本 P0 只堵数据/授权面，不做 UX 隐藏 | T1 |
| SD-4 | AgentTask/AgentTaskStep/ApprovalRequest 为 legacy 运行时（无 orgId 列），长期随旧运行时退役（T0 债 B-15/架构文档） | 架构 |

---

*Security P0 完成安全审计 + 代码修复 + 测试 + 报告 + Draft PR 后 STOP，等待人工 Final Review。不 merge、不 mark ready、不进入 T1。*
