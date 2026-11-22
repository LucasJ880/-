# Design：招标一键分析失败后，从失败的这一步继续（FIX-20b）

## Context

动机见 proposal。来源与 FIX-20 相同，即 Evan 2026-11-22 对「12-3 Indoor Canadian Flag」的生产实测。需求原话是：「关键步骤最终失败时，提供『从失败的这一步继续』，复用已完成步骤的产出，不从头重跑」。以下逐条读代码核对，基于 main `2ef4f9c8`。

**「重新分析」是从头来**
- 它先取消旧 Job（`cancelAgentRun`），再新建 Job（`trigger-service.ts:160-168`）。
- 分析记录的幂等键按 Job 生成（`analysis-run-service.ts:57-59`），新 Job 必然新建分析记录（`:180-186`）。
- 第 3 步的检查点存在分析记录的 `workerCursor` 上，只对同一条记录、同一文件指纹有效（`tender-workforce/v2-resumable-workforce.ts:74-86`）。所以重新分析时第 3 步从第一个内容段重来；生产上第 3 步一次要 13 分钟。

**步骤行本身就是检查点**
- 每一轮按步骤状态全量重算哪些可以开跑（`agent-runtime-v2/persist.ts:133-164`）。
- 下游只读已完成上游的 `outputJson` 与交接数据（`executor.ts:83-99`、`workforce-runtime/handoff.ts:555-664`）。
- 恢复路径的注释也写明「steps 即 checkpoint」（`resume.ts:376-377`）。
- 所以只要把失败那一步改回「待开始」、Job 改回排队，已完成步骤不会再执行。

**现有的恢复与修复都用不上**
- `resumeWorkforceJob` 拒绝终态 `failed`（`resume.ts:112-126`）。对「需要人工处理」，手动恢复只放行身份失效类错误码（`:55-59`、`:163-175`），这条规则有冻结测试（`phase2c1-pause-resume.test.ts:199-216`）。
- 验证器的修复只把失败步骤改回「待开始」，不清尝试次数（`verifier.ts:400-429`）。下一轮预检会直接判为耗尽（`executor.ts:1119-1127`）；认领条件本身也要求尝试次数小于上限（`:1273-1285`）。

**执行次数上限**
- 每一轮开头，所有步骤的尝试次数之和达到 `maxToolCalls`（默认 12，`agent-runtime-v2/flags.ts:72`），Job 就转为需要人工处理（`executor.ts:252-260`）。
- 让出会退回尝试次数（`:1627`），所以正常跑完的步骤大多只记 1 次。

**分析记录的状态门**
- CHAIN-0c 收尾后，分析记录是「AI 分析未完成」（`AGENT_FAILED`）。
- 第 3 步的落库与检查点都要求记录为「分析中」（`v2-persist-workforce.ts:79-96`）。
- 第 9 步终态化也要求「分析中」（`analysis-run-service.ts:328-345`）。
- 所以继续时必须把分析记录改回「分析中」。CHAIN-0c design 的 Risks 已经点出：手动恢复后第 9 步写不进去。

**失败通知按分析记录只发一次**
- 去重键是 `tender-run-failed:{runId}:{userId}`（`alerts.ts:52-54`、`:115`）。
- 通知模块按 `sourceKey` 全局唯一去重（`notifications/create.ts:43-44`）。
- 所以继续之后再次停下，按现在的键不会再收到通知。

**入口与权限**
- 卡片接口 `POST` 现在只接受 `start / restart / cancel`（`route.ts:60-83`）。
- 写操作的权限是 `requireTenderAnalysisWrite`，即 `requireProjectWriteAccess`（`tender-auto-analysis/api-access.ts:27-32`）。
- 作业接口只读（`app/api/workforce/jobs/[id]/route.ts:13-18`）。

## Goals / Non-Goals

**Goals**
- 关键步骤失败停下后，用户在项目卡片上点一下，就从失败的那一步往下跑：已完成步骤不重跑，第 3 步从检查点续跑，同一条分析记录最后进入待审阅。
- 判定全部确定性；零 schema、零新队列、零模型调用。

**Non-Goals（具体到文件）**
- `src/lib/workforce-runtime/resume.ts`：不改它的状态规则与冻结测试。
- `src/lib/agent-runtime-v2/**`：执行器、验证器、依赖推进都不改。
- `src/lib/workforce-runtime/processor.ts`：不改；继续后的 Job 由它照常认领。
- `src/lib/tender-workforce/deterministic-plan.ts`：不改。
- `src/app/api/workforce/jobs/**` 与 `src/app/(main)/workforce/**`：作业页不加按钮。
- `src/lib/tender-auto-analysis/alerts.ts` 的完成通知（`:130-249`，归 FIX-16）。
- `src/lib/muse-bridge/**`、`prisma/**`、`vercel.json`。

## Decisions

### D1 关键步骤与可继续的条件（全部确定性）

**关键步骤** = 招投标确定性计划里综合汇总以外的每一步。FIX-20 之后，综合汇总因执行失败会被降级、不再让 Job 停下；剩下的步骤一旦失败，第 9 步就到不了。

**可继续**需要同时满足下面七条。判定写成纯函数，放在 `trigger-service.ts` 里，不读错误原文。

1. **最新的确定性 Job。** 按项目取最新的招投标 Job（与 `getTenderWorkforceAnalysisStatus` 同一查询，`trigger-service.ts:303-307`）就是它，且 `metadata.planSource = "SERVER_AUTHORED"`（`job.ts:244-247`）。
2. **停下的状态与错误码。**
   - Job 状态为 `needs_human` 时，错误码须为 `blocked_graph` 或 `verification_failed`；
   - 为 `failed` 时，错误码须为 `model_failed` 或 `external_timeout`。
   - 这四个码分别来自执行器、验证器、处理器的重试耗尽与清扫（`executor.ts:290`、`verifier.ts:453`、`processor.ts:106`、`:742`）。
3. **失败步骤都属于执行失败。** 至少一个步骤 `failed`，且每个失败步骤的错误码都在执行失败集合里：`tool_failed`、`synthesis_failed`、`model_quota_exhausted`、`org_ai_budget_exhausted`、`step_attempts_exhausted`、`stale_running_exhausted`。
   - `synthesis_failed` 留在集合里，是为了 FIX-20 之前就停在综合汇总上的旧 Job，比如这次的「12-3」。
   - 契约类与权限类的码（`workforce_task_invalid`、`HANDOFF_*`、`handoff_build_failed`、`no_tool`、执行策略类、鉴权拒绝类）不可继续：这说明持久状态坏了，或权限变了，重跑那一步也没用。
4. **没有执行中或等待审批的步骤。**
5. **分析记录。** 按幂等键找到的分析记录为 `AGENT_FAILED`，且错误码不是 `cancelled`。
6. **文件指纹不变。** 分析记录的 `sourceHashFingerprint` 等于当前文件包重新算出的指纹，算法与发起时相同（`analysis-run-service.ts:130-161`）。缺内容指纹的，同样判为不可继续。
7. **执行次数够用。** 失败步骤清零后，全 Job 的尝试次数之和，加上还没完成的步骤数，不超过 `maxToolCalls`。每个没完成的步骤至少要跑一次，不满足就会在执行中途撞上上限（`executor.ts:252-260`）。

**拒绝原因**（中文，只取第一条命中）：
- 「这次分析已不是最新的一次，请在最新那次上操作」
- 「这次分析没有停在失败的步骤上」
- 「这次的执行记录不完整，请重新分析」（命中契约或权限类码）
- 「投标文件包已变化，请重新分析」
- 「这次分析的执行次数已接近上限，请重新分析」
- 「状态已变化，请刷新后再试」

被否决的备选：
- **任何失败都可继续。** 契约损坏时，重跑那一步还是同样的错误；权限变化应走既有的身份恢复。
- **不查文件指纹。** 新上传的补遗不会进这次分析，第 1 步的清单是旧的，用户却以为分析已包含它。
- **所有尝试次数一起清零，绕开上限。** 上限就失去意义了；每一次继续只清失败的那几步，次数就跟着人工操作的次数走。

### D2 继续动作：一个事务、三处条件更新

在 `db.$transaction` 里按顺序做三处条件更新，每一处检查命中行数，不符就抛错回滚：

1. **Job**：`agentRun.updateMany`，条件是 id、组织、`runType` 与 D1 第 2 条的状态和错误码。改为 `queued`，`attempts = 0`，`nextAttemptAt = now`，`leaseExpiresAt = null`，清掉 `errorCode` / `errorMessage` / `completedAt`。元数据的继续次数 `continueCount + 1` 在同一事务里读改写，写进既有的 `metadata` JSON。
2. **失败步骤**：`agentRunStep.updateMany`，条件是 id 在判定时取到的失败步骤集合里、且仍为 `failed`。改为 `ready`，`attemptCount = 0`，清掉 `errorCode` / `errorMessage` / `completedAt`。命中行数必须等于集合大小。
   - `idempotencyKey` 不动：它是每一步固定的 `ar2:{runId}:{stepKey}:{toolName}:step`，不含尝试次数（`agent-runtime-v2/idempotency.ts:16-22`）。认领时写回同一行的同一个值，与普通重试完全相同，不会撞唯一约束 `@@unique([orgId, idempotencyKey])`（`schema.prisma:5550`）。
3. **分析记录**：`tenderAnalysisRun.updateMany`，条件是幂等键、`AGENT_FAILED`、错误码不是 `cancelled`。改为 `AGENT_ANALYZING`，清掉 `errorCode` / `errorMessageSanitized` / `failedAt`。`workerCursor` 不动，第 3 步就靠它续跑。

**提交之后**写两样：
- 事件 `job.resumed`（既有类型，用户可见，时间线显示「已恢复执行」），payload `{ trigger: "continue_from_failed_step", stepKeys, humanActorUserId, continueCount }`；
- 审计 `tender.workforce.continued`（`targetType = workforce_job`）。

不立即推进时间片，等下一次定时触发，与「开始 AI 分析」一致（`route.ts` 的 start 不调推进函数；推进函数只有审批与跟进两个调用方）。

被否决的备选：
- **扩展 `resumeWorkforceJob`，加一个新触发源。** 要放开「failed 是终态」与「手动只放行身份失效」两条冻结规则，2C-1 的恢复语义会跟着变。处理器认领时本来就会重新校验发起人身份（`processor.ts:278-314`），执行器也会逐步重新校验执行策略与工具权限（`executor.ts:1171-1250`）。在招投标域内做重置、复用同样的「条件更新回到排队」写法，就够了。
- **新建一个「续跑」任务，在后台把失败步骤挑出来跑。** 那是一条新队列，违反硬纪律第 3 条。
- **继续后立即推进一个时间片。** 第 3 步没有执行预算就拒绝开跑（`tools.ts:1326-1333`），推进函数虽能给出预算，但那是多出来的一处推进点，而且要多一处触发点。

### D3 为什么这不算新增队列

继续只改既有 `AgentRun` 行的 `status / attempts / nextAttemptAt / leaseExpiresAt`，与审批恢复的写法相同（`resume.ts:381-395`），也与新建 Job 入队相同（`job.ts:303-311`）。认领者是既有的 `processQueuedWorkforceJobs`（`processor.ts:763-781`），由既有的 `/api/cron/agent-runs` 每 2 分钟一次触发（`vercel.json:67-69`）。

整个过程没有新表、新状态值、新租约、新定时任务、新执行者注册，也不扫描「失败的 Job」：只在用户点按钮时，对这一个 Job 做一次条件更新。

### D4 入口与权限

`POST /api/projects/[id]/tender-analysis/agent` 加 `action: "continue"`，请求体必须有 `jobId`。

- 权限：沿用路由开头的 `requireTenderAnalysisWrite`（`route.ts:45`），与 `restart` 完全同一个判定。
- Job 归属校验：沿用 `tenderJobWhere`（组织 + 项目 + `workDomain` + `runType`，`trigger-service.ts:66-80`），与 `cancel` 相同（`:244-247`）。
- 返回码见规格。409 的原因用 D1 的中文句子。

被否决的备选：**在作业页加按钮、走作业接口。** 作业接口明文只读，可见性按作业范围判定，另有一套口径（`api/workforce/jobs/[id]/route.ts:16-18`），要另立写接口与权限设计。项目卡片已有「重新分析」，权限口径一致。

### D5 项目卡片

`getTenderWorkforceAnalysisStatus`（`trigger-service.ts:297-367`）多返回 `continuable: boolean`，调用 D1 的判定，只读。卡片在 Job 不是活跃状态时显示按钮（`agent-card.tsx:222-240`）：可继续时，主按钮为「从失败的这一步继续」（`action: "continue"`），「重新分析」降为次按钮；否则保持现状。

被否决的备选：**每次都显示按钮，点了再报不可继续。** 用户会先点一次、看到拒绝。判定只读、很便宜，没有理由让人先试。

### D6 按轮收尾与通知

- 收尾（`job-failure-surfacing.ts:66-107`）读 Job 元数据里的 `continueCount`（缺省 0），通过 `failWorkforceTenderAnalysisRun` 传给 `notifyTenderRunFailed`。
- 失败通知的去重键：第 0 轮保持 `tender-run-failed:{runId}:{userId}`，旧数据完全不变；第 n 轮为 `tender-run-failed:{runId}:r{n}:{userId}`。
- 审计每轮一条：每轮的分析记录状态 CAS 会重新成立一次，审计跟着它写。
- 收尾时再调一次 D1 的判定；可继续，就把通知末句改为「可在项目里点「从失败的这一步继续」，或重新发起分析。」（现在的末句在 `alerts.ts:49`）。

被否决的备选：
- **用分析记录的 `attemptCount` 记轮次。** 那一列在旧管线里表示重试次数，通知会据此写出「（已尝试 N 次）」（`alerts.ts:47-48`），语义混了。
- **用失败时间做去重键。** 旧管线的失败记录也走这个函数，它们的去重行为会跟着变。

## 与八条硬纪律的关系

1. **零 schema**：遵守。只写既有列（`AgentRun.status / attempts / nextAttemptAt / leaseExpiresAt / errorCode / errorMessage / completedAt / metadata`，`AgentRunStep` 的状态与计数列，`TenderAnalysisRun.status / errorCode / errorMessageSanitized / failedAt`），以及既有事件、审计、通知表。
2. **出站先审批**：不涉及。站内通知不算出站；继续后第 9 步照既有规则发 Muse `analysis.ready`。
3. **禁止第三套队列**：遵守，见 D3。
4. **脱敏**：遵守。接口与通知只有固定中文与步骤名；规格里写了 SHALL NOT。
5. **不爬登录页**：不涉及。
6. **邮箱分离**：不涉及。
7. **确定性优先**：遵守。判定是查表与比较，继续动作零模型调用；继续之后的执行沿用既有步骤，不多调。
8. **测试注册**：遵守。`continue-eligibility.test.ts` 进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`；`continue-from-failed-db.isolated.test.ts` 进 `scripts/test-all.sh`。

## 验证方式

- `npx tsx src/lib/tender-workforce/__tests__/continue-eligibility.test.ts`（纯函数）：
  - D1 七条逐条正反例；
  - 拒绝原因只取第一条；
  - 旧 Job 停在综合汇总（`synthesis_failed`）可继续；
  - 契约 / 权限码不可继续；
  - 次数上限边界（恰好等于、超出 1）。
- 隔离库 `NODE_ENV=test npx tsx src/lib/tender-workforce/__tests__/continue-from-failed-db.isolated.test.ts`：
  - 预置第 3 步失败（带检查点）的确定性计划 Job 与 `AGENT_FAILED` 分析记录；
  - 走路由：只读成员 403、别的项目 404、并发两次只成功一次；
  - 走真处理器跑完：第 1、2 步次数与产出不变、第 3 步从检查点续跑、同一条分析记录进入待审阅、Job 完成；
  - 再造一次失败，验证第二轮收尾与新通知；
  - 卡片接口 `continuable`；响应里搜不到错误码与指纹。
  - 改动前的代码上，这些用例应失败：`continue` 返回 400「未知的 action」。
- 扩展的测试：`job-failure-surfacing-db.isolated.test.ts`（同一轮重放仍一条）、`job-failure-surfacing.test.ts`（卡片源码断言：两个按钮）。
- 回归：
  - `t1b-integration.test.ts`、`phase2c1-pause-resume.test.ts`、`t5-p11-resumability.test.ts` 通过数不变；
  - `npm run typecheck`、`npm run lint:baseline`、`bash scripts/test-runtime-architecture.sh`、CI 子集、`npm test`；
  - `git diff origin/main -- prisma/ vercel.json src/lib/workforce-runtime/resume.ts` 为空。

## Risks / Trade-offs

- **余额还没充值就点了继续。** 失败的那一步会再失败一次（2 次尝试），Job 又停下，通知写明余额不足。每次继续只清失败的那几步，所以不会无限重试。
- **之前走过验证的 Job（`verification_failed`）继续后，修复轮次已用完。** 验证次数按已有记录累加（`verifier.ts:344-347`），再要修复就直接转人工。只有验证通过才会完成；报告里写明。
- **FIX-18 改了卡片的按钮布局。** 本 change 排在它后面合并，按它合并后的样子放按钮。

## Migration Plan

无数据迁移、无开关。合并部署即生效；回滚 = 回退本 PR。旧 Job 只要满足 D1，就同样可以继续，比如 2026-11-22「12-3」。

## 留给 GATE

**G1 「失败」状态的 Job 能不能继续**
- A（推荐）能，只限 `model_failed` / `external_timeout`。这两个码分别是处理器重试耗尽与超时清扫，属于执行问题。
- B 只允许「需要人工处理」。后果：被平台反复强制结束、最后被清扫成失败的 Job，只能从头重跑，正是这次要解决的情况之一。
- 推荐 A。

**G2 文件包变了之后**
- A（推荐）不可继续，提示重新分析。
- B 照样继续，用旧清单。后果：新补遗不在分析里，用户看不出来。
- 推荐 A。

**G3 继续之后要不要立刻推进一个时间片**
- A（推荐）不推进，等定时触发（≤ 2 分钟），与「开始 AI 分析」一致。
- B 在响应之后推进一次。后果：多一处推进点；第 3 步需要的执行预算要在这里另算。
- 推荐 A。

**G4 合并顺序**
- 推荐 FIX-20 → FIX-18 → 本 change。本 change 依赖 FIX-20 的错误码与原因规则，而 FIX-18 会改同一张卡片的按钮与同一个 POST 接口。
