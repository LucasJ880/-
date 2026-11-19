# Design：招标分析失败立刻告诉人（CHAIN-0c）

## Context

动机见 proposal。main `a764c06` 上的现状（只读核对）：

- 项目上的分析记录（`TenderAnalysisRun`，`analysisVersion = tender-workforce-analysis-v1`）由 Job 第 9 步改成「待审阅」。改成「AI 分析未完成」（`AGENT_FAILED`）的唯一函数 `failWorkforceTenderAnalysisRun`（`tender-workforce/analysis-run-service.ts:420`）只在用户重新发起 / 取消时被调用（`trigger-service.ts:162`、`:263`）。它按 `jobId → idempotencyKey` 找记录，只改仍在 `AGENT_ANALYZING` 的那一条，改了才调 `notifyTenderRunFailed`。
- `notifyTenderRunFailed`（`tender-auto-analysis/alerts.ts:58`）已认 `AGENT_FAILED`，收件人 = 项目负责人 + 发起人（去重），`sourceKey = tender-run-failed:{runId}:{userId}` 幂等；摘要只按错误码查表，Job 的错误码（`model_failed`、`external_timeout`…）都落到兜底「分析未能完成」。
- Job 写成失败 / 需要人工处理的地方都在 `workforce-runtime/processor.ts`：`processWorkforceJobSlice` 的各分支（重试耗尽 `requeueWorkforceJobAfterError`、缺 goal、规划澄清、执行器返回 failed / needs_human、principal 失效）都以返回值 `{ claimed, status, lostLease }` 收口；另有 `processQueuedWorkforceJobs` 开头的「租约过期且重试耗尽」清扫（批量 `updateMany` → failed）。
- 读模型（`workforce-runtime/read-model/`）的「需要你处理」只认结构化来源，**明文规定不读运行记录上的 `errorMessage`**（`projection.ts:380-386`，有源码审计测试）；步骤快照没有错误码；Job 失败时详情页没有任何原因卡。
- 域模块（`tender-workforce`）依赖 `workforce-runtime`，`workforce-runtime` 只能经动态 import 接域（`scope.ts` 的先例）。
- 项目卡片（`components/tender-analysis/agent-card.tsx`）对失败的 Job 已显示「上次 AI 分析未完成」和「重新分析」，但没有原因；接口 `latestAnalysisRun` 不带原因。

**复现段（任务书要求）**：生产上「12-01 21C31-254242」那个 Job 的 AgentRun / 事件记录本会话看不到（没有生产数据库与 Vercel 日志权限），所以没法确认当时走的是 `job.failed` 还是 `job.waiting_human`。按现象（详情页出现「需要人工处理」框、时间线「任务未能完成」、第 3 步「未成功」）更像执行器返回 `needs_human`（`processor.ts:566-600`，事件标题「需要人工处理」、`humanRequirement.type = CONFLICT_REQUIRES_HUMAN`、无 detail）。判断点 8 取 A 后两条路径收尾方式相同，所以隔离库测试**两条都作为第一组用例**：第 3 步工具失败 → 执行器 needs_human / 重试耗尽 → failed。拿到生产记录后把实际路径补进报告。

## Goals / Non-Goals

**Goals**：Job 停下的那一次处理器调用里就收尾（下一次 cron 之内，≤ 2 分钟）；原因确定性、可读、不泄露内部文本；收尾与通知幂等；对非招投标 Job 零影响。

**Non-Goals**（具体到文件）：`src/lib/agent-runtime/**`（不加事件类型）、`src/lib/agent-runtime-v2/**`（执行器 / 验证器不改）、`src/lib/workforce-runtime/resume.ts`（手动恢复路径）、`src/lib/tender-auto-analysis/worker.ts`（legacy 队列）、`prisma/**`、`vercel.json`、`src/lib/muse-bridge/**`、`src/lib/notifications/**`（只调用 `createNotification`）。

## Decisions

### D1 只挂两个收口点，经域钩子动态加载
`processWorkforceJobSlice` 拿到 `runClaimedSlice()` 的结果后，若 `claimed && !lostLease && (status === "failed" || status === "needs_human")`，调 `onWorkforceJobStopped({ runId })`；清扫批量写 failed 后对每个 id 调同一个钩子。钩子在新文件 `workforce-runtime/domain-hooks.ts`：读 Job 的 `metadata.workDomain`，是 `tender` 才 `await import("@/lib/tender-workforce/job-failure-surfacing")`。钩子整体 try/catch，只 `console.warn`，返回值不参与 slice 结果。
- 否决「在每个写失败的分支里各调一次」：分支有七处，漏一处就回到今天的样子；否决「静态 import 招投标模块」：会成环（`scope.ts` 已写明）；否决「新开一个扫描任务找卡住的分析」：违反硬纪律第 3 条。

### D2 收尾 = 既有 `failWorkforceTenderAnalysisRun` + 一条审计
`surfaceTenderJobStopped(runId)`：读 Job（orgId、status、errorCode、metadata）→ 不是 tender 或状态不是 failed / needs_human 就返回 → 读步骤（按创建顺序）算原因 → `failWorkforceTenderAnalysisRun({ orgId, jobId: runId, errorCode, errorMessage: 原因 })` → 只有它返回 `updated: true` 才写审计 `tender.workforce.failed_surfaced`（targetType `workforce_job`，targetId = jobId）。幂等来自既有函数「只改仍在分析中的那条」：第二次调用 `updated: false`，不写审计、不发通知（通知另有 sourceKey 兜底）。`errorCode` 取 Job 的错误码，没有时用 `needs_human` / `workforce_failed`。
- 否决「先查审计再决定」：多一次查询且有并发窗口；状态 CAS 本身就是幂等闸。

### D3 原因是确定性的中文，不用原始错误文本
纯函数 `tenderJobStopReason({ steps, jobStatus, jobErrorCode })`：
- 步骤 = 第一个 `failed` 的；没有则第一个不是 completed / skipped / partially_executed 的；N = 它在按创建顺序排列的步骤里的位置（从 1 起）。
- 原因：先在该步 `errorMessage` 里认招投标工具的已知标记——`ANALYSIS_EMPTY` → 「模型调用全部失败，未产出有效分析」，`429` / `rate limit` → 「模型调用被限流」，`timeout` / `timed out` → 「单次调用超时」；再按错误码查表（`step_attempts_exhausted` / `model_failed` →「重试次数用尽」，`stale_running_exhausted` / `external_timeout` →「长时间没有进展」，`tool_failed` →「工具执行失败」，`blocked_graph` →「前置步骤没有完成」，`no_tool` →「步骤未指定工具」；Job 为 needs_human 且没有更具体的 →「需要人工处理」）；都不认识 →「执行出错」。
- 没有步骤 →「系统未记录原因」。整句截到 300 字。
- 招投标模块可以「认」错误文本里的已知标记（只输出固定中文，不复述原文）；读模型（D4）不读错误文本，只用错误码，所以详情页的原因可能比项目卡片粗一档（「工具执行失败」vs「模型调用全部失败」）——这是既有读模型纪律下的取舍。
- 否决任务书原写的「〈错误信息前 300 字〉」：原始错误常是英文堆栈或内部码，`alerts.ts` 头注与读模型都明文规定不给业务用户看；运维要看原文仍有内部时间线与运行记录。见 Q1。

### D4 读模型：步骤快照带错误码，详情视图多一个 `stopReason`
`WorkforceStepSnapshot` 加 `errorCode`（查询多 select 一列）；`WorkforceJobViewModel` 加 `stopReason?: { stepIndex, stepTitle, reasonZh }`，只在 Job 为「失败」或「需要你处理」时由 `projectStopReason(steps, run)` 算出（同 D3 的错误码表，不读错误文本）。`projectNeedsYou` 在 `detail` 为空时用 `stopReason` 拼出的那句作 detail。详情页：「需要你处理」框照旧；失败时新增「任务未能完成」卡，显示 `stopReason` 那句，没有就写「系统未记录原因」。
- 错误码表放在 `workforce-runtime/read-model/stop-reason.ts`（读模型自己的、域无关），招投标模块复用它再叠加已知标记，避免两张表不同步。

### D5 项目卡片
`trigger-service.ts` 的 `latestAnalysisRun` 多返回 `failureReason`（= 分析记录的 `errorMessageSanitized`，只在 `AGENT_FAILED` 时给）；卡片在 Job 失败或分析为 `AGENT_FAILED` 时显示这一行。按钮不变（既有「重新分析」）。

### D6 失败通知摘要
`tenderFailureSummary` 多一个可选 `stopReason`：有且以「卡在第」开头时，摘要为「{项目}的 AI 分析已停止：{stopReason}。可在项目里重新发起分析。」；否则照旧。`REASON_TEXT` 补上 Job 错误码（同 D3）。`notifyTenderRunFailed` 多读 `errorMessageSanitized` 传进去。legacy 队列写的 FAILED 记录不以「卡在第」开头，摘要不变。

## 与八条硬纪律的关系

1. 零 schema：遵守。写既有列（`TenderAnalysisRun.status / errorCode / errorMessageSanitized / failedAt`）、既有 AuditLog、既有 Notification。
2. 出站先审批：不涉及（只有站内通知）。
3. 不新增队列 / cron：遵守。挂在既有处理器的同一次调用里，不加重试、扫描或定时任务。
4. 脱敏：遵守。原因只用固定中文，不出原始错误文本；Muse 通道不涉及。
5. 不爬登录页：不涉及。
6. 邮箱分离：不涉及。
7. 确定性优先：遵守。查表，零模型调用。
8. 测试注册：两个新纯函数测试与一个隔离库测试注册进 `scripts/test-all.sh`（纯函数同时进 `test-ci-unit.sh`）。

## 验证方式

- `npx tsx src/lib/tender-workforce/__tests__/job-failure-surfacing.test.ts`：原因拼装（已知标记 / 错误码 / 不认识 / 无步骤 / 截断 / 不含堆栈）、通知摘要、源码断言（钩子 try/catch 不改返回值、不读开关、只认 tender）。
- `npx tsx src/lib/workforce-runtime/read-model/__tests__/stop-reason.test.ts`：`stopReason` 投影、needs_you detail 兜底、源码断言不引用 `errorMessage`。
- 隔离库 `src/lib/tender-workforce/__tests__/job-failure-surfacing-db.isolated.test.ts`：真处理器 + 注入的必然失败第 3 步 → needs_human 与 failed 两条路径；分析记录、原因、两人各一条通知、审计一条；重放不重复；非招投标 Job 不触发；已待审阅的不改；清扫路径；项目卡片接口带原因。
- 回归：`workforce-runtime` 既有测试（含 `processor`、`read-model`、`operator-ux`）、`tender-workforce` 既有测试、`alerts` 测试期望值不改；`npm run typecheck`、`npm run lint:baseline`、运行时架构守卫、`npm run test:ci`。

## Risks / Trade-offs

- [`needs_human` 收尾为失败后，有人在 AI 任务详情里手动恢复了这个 Job，Job 跑完时分析记录已不在「分析中」，第 9 步写不进去] → 判断点 8 取 A 的已知代价；任务书定的处理方式是「重新发起分析」。报告里写明。
- [详情页原因比项目卡片粗一档] → D3 的取舍。
- [第 3 步失败本身的原因仍不知道] → 本次只让失败被看见；拿到生产日志后另立。
- [清扫路径没有步骤失败的记录（只是租约超时）] → 原因落到「长时间没有进展」或停在的那一步。

## Migration Plan

合并即生效，无开关、无迁移。已经卡在「分析中」的历史记录不会被回补（不加扫描）；用户点「重新分析」即可。回滚：回退本 PR。

## 审核关注点与拍板结果（Lucas 2026-11-19「全权负责……按照你推荐的去做」，按推荐）

| # | 问题 | 结果 |
|---|---|---|
| Q1 | 原因不用「错误信息前 300 字」，改为确定性中文（D3） | 按推荐 |
| Q2 | 判断点 8 取 A：needs_human 也收尾为「AI 分析未完成」 | 按推荐 |
| Q3 | 不回补已经卡住的历史记录 | 按推荐 |
