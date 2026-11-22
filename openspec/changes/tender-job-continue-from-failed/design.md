# Design：招标一键分析失败后，从失败的这一步继续（FIX-20b）

## Context

动机见 proposal。来源与 FIX-20 相同，即 Evan 2026-11-22 对「12-3 Indoor Canadian Flag」的生产实测。需求原话是：「关键步骤最终失败时，提供『从失败的这一步继续』，复用已完成步骤的产出，不从头重跑」。以下逐条读代码核对，基于 main `2ef4f9c8`；FIX-18 的部分按它的四件套（`/home/user/wt/fix18/openspec/changes/tender-analysis-single-entry/`）写。

**「重新分析」是从头来**
- 它先取消旧 Job（`cancelAgentRun`），再新建 Job（`trigger-service.ts:160-168`）。
- 分析记录的幂等键按 Job 生成（`analysis-run-service.ts:57-59`），新 Job 必然新建分析记录（`:180-186`）。
- 第 3 步的检查点存在分析记录的 `workerCursor` 上，只对同一条记录、同一文件指纹有效（`tender-workforce/v2-resumable-workforce.ts:74-86`）。所以重新分析时第 3 步从第一个内容段重来；生产上第 3 步一次要 13 分钟。

**步骤行本身就是检查点**
- 每一轮按步骤状态全量重算哪些可以开跑（`agent-runtime-v2/persist.ts:133-164`）。
- 下游只读已完成上游的 `outputJson` 与交接数据（`executor.ts:83-99`、`workforce-runtime/handoff.ts:555-664`）。
- 恢复路径的注释也写明「steps 即 checkpoint」（`resume.ts:375-376`）。
- 所以只要把失败那一步改回未执行、Job 改回排队，已完成步骤不会再执行。

**现有的恢复与修复都用不上**
- `resumeWorkforceJob` 拒绝终态 `failed`（`resume.ts:112-126`）。对「需要人工处理」，手动恢复只放行身份失效类错误码（`:55-59`、`:163-175`），这条规则有冻结测试（`phase2c1-pause-resume.test.ts:199-216`）。
- 验证器的修复只把失败步骤改回「待开始」，不清尝试次数（`verifier.ts:400-429`）。下一轮预检会直接判为耗尽（`executor.ts:1119-1127`）；认领条件本身也要求尝试次数小于上限（`:1273-1285`）。

**「失败」状态的 Job 是怎么来的**
- 处理器重试耗尽写 `model_failed`（`processor.ts:106`）：时间片里抛了异常，常常没有任何失败步骤。
- 租约超时且尝试耗尽的清扫写 `external_timeout`（`processor.ts:722-760`）：只改 Job，不碰步骤。被平台强制结束的那一步仍是「执行中」。
- 处理器回收遗留「执行中」步骤只在成功认领之后做，注释写明这是唯一回收边界（`processor.ts:233-277`）。清扫成失败的 Job 不会再被认领，所以那一步一直停在「执行中」。
- 被强制结束两次的常见情形，其实走的是另一条路：下一次认领把这一步记为 `stale_running_exhausted` 并终止，下一轮执行器把 Job 写成 `needs_human` / `blocked_graph`（`processor.ts:262-275`、`executor.ts:266-296`）。

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
- 失败通知只在分析记录为 `FAILED` / `AGENT_FAILED` 时发（`alerts.ts:88`）。

**入口、权限与身份**
- 卡片接口 `POST` 现在只接受 `start / restart / cancel`（`route.ts:60-83`）。
- 写操作的权限是 `requireTenderAnalysisWrite`，即 `requireProjectWriteAccess`（`tender-auto-analysis/api-access.ts:27-32`）。
- 「开始 / 重新分析」实际还会检查：招投标数字员工的组织开关（`trigger-service.ts:118-124`）、建作业时的用户级开关（按岗位派生角色，`job.ts:149-158`）、组织的 AI 任务额度（`route.ts:115-119`）。FIX-18 把前两样合成 `canStart`（FIX-18 design D1）。
- 处理器每次认领都按 `metadata.initiatedByUserId` 重新解析执行主体（`processor.ts:283`、`agent-runtime-v2/principal.ts:55-107`），所以继续以后仍以发起人的身份执行；模型费用的月度预检也按发起人算（`ai/client.ts:173-185`）。
- 作业接口只读（`app/api/workforce/jobs/[id]/route.ts:13-18`）。

**项目级互斥**
- 发起与重新分析在事务里拿 `pg_advisory_xact_lock(hashtext('tender-workforce-start:<org>:<project>'))`（`trigger-service.ts:148-149`），FIX-18 让旧管线也拿同一把锁（FIX-18 design D4），并定了「在跑」的口径（D5）。
- 「需要人工处理」算在活跃集里（`trigger-service.ts:40-51`），「失败」不算；`cancelAgentRun` 对失败的 Job 什么都不做（`agent-runtime/run.ts:549-558`）。

**运行时架构门禁**（`scripts/test-runtime-architecture.sh`）
- 新的 AgentRun 状态写入方报 `NEW_RUN_STATUS_WRITER_FORBIDDEN`，新的步骤写入方报 `NEW_STEP_MODEL_WRITER_FORBIDDEN`（`runtime-architecture/guards.ts:75-77`、`:384-401`；负例 `guards-negative.test.ts:81,84`）。
- `src/lib/tender-workforce/` 今天没有任何一处直接写 AgentRun 或步骤。`workforce-runtime/resume.ts` 已在两份基线名单里（`runtime-architecture-baseline.json:140`、`:151`）。
- 审计可以在事务里写（`audit/logger.ts:50` 的 `writeAuditLog` 接受事务客户端，失败即抛）；事件也可以在事务里写（`agent-runtime/run.ts:707` 的 `appendAgentRunEventInTx`，先锁 AgentRun 行）。

**卡片的「分析结束」回调**
- 卡片按 jobId 记住「已经通知过结束」（`agent-card.tsx:79`、`:106-115`），审阅面板靠这个回调重新加载（`analysis-panel.tsx:463`；FIX-13 合并后 `:475`）。继续沿用同一个 jobId，第一次停下时已经记过，继续之后跑完不会再通知，面板停在旧状态。

**与 FIX-15 的交叉**
- FIX-15 D6 把「被截止截断的次数」记在步骤 `evidenceJson.continuation.deadlineCuts`，满 3 次再被截止就算一次失败。继续时不清它，第 8 步再被截止一次就直接失败。

## Goals / Non-Goals

**Goals**
- 关键步骤失败停下后，能用卡片发起的人在项目卡片上点一下，就从失败的那一步往下跑：已完成步骤不重跑，第 3 步从检查点续跑，同一条分析记录最后进入待审阅。
- 继续与其它发起入口互斥，同一个项目同一时刻只有一单在跑。
- 判定全部确定性；零 schema、零新队列、零模型调用；运行时架构基线不改。

**Non-Goals（具体到文件）**
- `src/lib/workforce-runtime/resume.ts`：`resumeWorkforceJob` 的状态规则与冻结测试不改；只新增一个独立导出函数（D2）。
- `src/lib/agent-runtime-v2/**`：执行器、验证器、依赖推进都不改。
- `src/lib/workforce-runtime/processor.ts`：不改；继续后的 Job 由它照常认领。
- `src/lib/tender-workforce/deterministic-plan.ts`：不改。
- `src/app/api/workforce/jobs/**` 与 `src/app/(main)/workforce/**`：作业页不加按钮。
- `src/lib/tender-auto-analysis/alerts.ts` 的完成通知（`:130-249`，归 FIX-16）。
- `src/lib/runtime-architecture/runtime-architecture-baseline.json`：不改。
- `src/lib/muse-bridge/**`、`prisma/**`、`vercel.json`。

## Decisions

### D1 关键步骤与可继续的条件（全部确定性）

**关键步骤** = 招投标确定性计划里综合汇总以外的每一步。FIX-20 之后，综合汇总因执行失败会被降级、不再让 Job 停下；剩下的步骤一旦失败，第 9 步就到不了。

**可继续**需要同时满足下面八条。判定写成纯函数，放在新文件 `src/lib/tender-workforce/continue-eligibility.ts`（不连数据库，CI 单测可以直接引用），由 `trigger-service.ts` 读出数据后调用；不读错误原文。

1. **最新的确定性 Job。** 按项目取最新的招投标 Job（与 `getTenderWorkforceAnalysisStatus` 同一查询，`trigger-service.ts:303-307`）就是它，且 `metadata.planSource = "SERVER_AUTHORED"`（`job.ts:244-247`）。
2. **停在需要人工处理。** Job 状态为 `needs_human`，错误码为 `blocked_graph`（执行器，`executor.ts:290`）或 `verification_failed`（验证器，`verifier.ts:453`）。
3. **失败步骤都属于执行失败。** 至少一个步骤 `failed`，且每个失败步骤的错误码都在执行失败集合里：`tool_failed`、`synthesis_failed`、`model_quota_exhausted`、`org_ai_budget_exhausted`、`step_attempts_exhausted`、`stale_running_exhausted`。集合与 FIX-20 的降级集合同放在 `src/lib/workforce-runtime/constants.ts`（FIX-20 design D6），只多一个 `tool_failed`。
   - `synthesis_failed` 留在集合里，是为了 FIX-20 之前就停在综合汇总上的旧 Job，比如这次的「12-3」。
   - 契约类与权限类的码（`workforce_task_invalid`、`HANDOFF_*`、`handoff_build_failed`、`no_tool`、执行策略类、鉴权拒绝类）不可继续：这说明持久状态坏了，或权限变了，重跑那一步也没用。
4. **没有执行中或等待审批的步骤。**
5. **分析记录。** 按幂等键找到的分析记录为 `AGENT_FAILED`，且错误码不是 `cancelled`。
6. **文件指纹不变。** 分析记录的 `sourceHashFingerprint` 等于当前文件包重新算出的指纹，算法与发起时相同（`analysis-run-service.ts:130-161`）。缺内容指纹的，同样判为不可继续。
7. **继续次数没到上限。** 这个 Job 已有的审计 `tender.workforce.continued` 少于 2 条（D7）。
8. **执行次数够用。** 失败步骤清零后，全 Job 的尝试次数之和，加上还没完成的步骤数，不超过 `maxToolCalls`。每个没完成的步骤至少要跑一次，不满足就会在执行中途撞上上限（`executor.ts:252-260`）。

**拒绝原因**（中文，只取第一条命中；前七句对应上面八条，按条目顺序判定；后两句在事务里判定）：
- 第 1 条不满足（不是最新）：「这次分析已不是最新的一次，请在最新那次上操作」
- 第 1 条不满足（不是确定性计划）：「这次分析不支持从中途继续，请重新分析」
- 第 2、4、5 条不满足，或第 3 条里没有失败步骤：「这次分析没有停在失败的步骤上」
- 第 3 条里有契约或权限类的码：「这次的执行记录不完整，请重新分析」
- 第 6 条：「投标文件包已变化，请重新分析」
- 第 7 条：「这次分析已经继续过 2 次，请重新分析」
- 第 8 条：「这次分析的执行次数已接近上限，请重新分析」
- 锁内复查发现旧管线有一单在跑（D2）：沿用 FIX-18 D7 的「这个项目已经有一单招标文件分析在进行，进度见本页顶部「招标文件分析」一栏；那一单结束后再点。」
- 事务里任何一处条件更新没命中：「状态已变化，请刷新后再试」

被否决的备选：
- **任何失败都可继续。** 契约损坏时，重跑那一步还是同样的错误；权限变化应走既有的身份恢复。
- **「失败」状态的 Job 也可继续（`model_failed` / `external_timeout`）。** 见 Context：这两种 Job 往往没有失败步骤，或者留着一个「执行中」的步骤，第 3、4 条本来就过不了；要放行，就得在继续时把终态 Job 里的「执行中」步骤也处理掉，等于在处理器认领之外再开一个回收边界（`processor.ts:233-277` 的注释写明那是唯一回收边界）。G1 推荐只放行需要人工处理。
- **不查文件指纹。** 新上传的补遗不会进这次分析，第 1 步的清单是旧的，用户却以为分析已包含它。
- **所有尝试次数一起清零，绕开上限。** 上限就失去意义了；每一次继续只清失败的那几步，再用第 7 条封顶。

### D2 继续动作：放进已登记的写入方，一个事务

`workforce-runtime/resume.ts` 新增一个独立导出函数（名字实现时定），只做通用部分，并在同一事务里调用 `trigger-service.ts` 给的两段域回调。`resumeWorkforceJob` 一行不改。

一个 `db.$transaction` 里依次做：

1. **域回调一（招投标，锁与复查）：**
   - 拿 `pg_advisory_xact_lock(hashtext('tender-workforce-start:<org>:<project>'))`，与发起、重新分析、旧管线同一把锁（`trigger-service.ts:148-149`、FIX-18 D4）；
   - 锁内复查：这个 Job 仍是本项目最新的招投标 Job；旧管线没有一单在跑（FIX-18 D5 的口径）；已继续次数仍少于 2。
   - 任一条不满足就整体回滚，返回 D1 对应的原因。
2. **Job**：`agentRun.updateMany`，条件是 id、组织、`runType`、`status = needs_human`、错误码在 D1 第 2 条的集合里。改为 `queued`，`attempts = 0`，`nextAttemptAt = now`，`leaseExpiresAt = null`，清掉 `errorCode` / `errorMessage` / `completedAt`。命中必须为 1 行。写法与审批恢复相同（`resume.ts:379-392`）。
3. **失败步骤**：`agentRunStep.updateMany`，条件是 id 在判定时取到的失败步骤集合里、且仍为 `failed`。
   - 改为 `pending`，`attemptCount = 0`，清掉 `errorCode` / `errorMessage` / `completedAt` / `outputJson` / `evidenceJson`。
   - 清 `evidenceJson` 是为了同时清掉 FIX-15 记的截断次数；第 3 步的检查点在分析记录的 `workerCursor` 上，不受影响。
   - 改回 `pending` 而不是 `ready`：下一轮开头的依赖推进照依赖重新提升（`persist.ts:133-164`），用户看到的都是「待开始」（`workforce/presentation.ts:69-70`）。
   - 命中行数必须等于集合大小。
   - `idempotencyKey` 不动：它是每一步固定的 `ar2:{runId}:{stepKey}:{toolName}:step`，不含尝试次数（`agent-runtime-v2/idempotency.ts:16-22`）。认领时写回同一行的同一个值，与普通重试完全相同，不会撞唯一约束 `@@unique([orgId, idempotencyKey])`（`schema.prisma:5550`）。
4. **域回调二（招投标，分析记录与审计）：**
   - `tenderAnalysisRun.updateMany`，条件是幂等键、`AGENT_FAILED`、错误码不是 `cancelled`。改为 `AGENT_ANALYZING`，清掉 `errorCode` / `errorMessageSanitized` / `failedAt`。`workerCursor` 不动，第 3 步就靠它续跑。命中必须为 1 行。
   - 用 `writeAuditLog(tx, …)` 写审计 `tender.workforce.continued`（`targetType = workforce_job`，`targetId = jobId`，`userId` = 点击的人，`afterData` 带重置的步骤键与这是第几次继续）。审计与重置同生同灭，D6、D7 数轮次才可靠。
5. **事件**：`appendAgentRunEventInTx` 写 `job.resumed`（既有类型，用户可见，时间线显示「已恢复执行」，`workforce/presentation.ts:201`），payload `{ trigger: "continue_from_failed_step", stepKeys, principalUserId, humanActorUserId, continueRound }`。

锁的顺序：项目锁 → AgentRun 行 → 步骤行 → 分析记录 → 审计 → 事件（事件写入再锁一次 AgentRun 行，同一事务里是空操作，`run.ts:707-724` 的注释）。发起、重新分析也是先拿项目锁，所以与继续整个串行，没有交叉等待。

不立即推进时间片，等下一次定时触发，与「开始 AI 分析」一致（`route.ts` 的 start 不调推进函数；推进函数只有审批与跟进两个调用方，`api/ai/pending-actions/[id]/route.ts:39`、`assistant/followup-task.ts:656`）。

被否决的备选：
- **在 `trigger-service.ts` 里直接写 Job 与步骤。** 它会成为运行时基线之外的新写入方，门禁报 `NEW_RUN_STATUS_WRITER_FORBIDDEN` / `NEW_STEP_MODEL_WRITER_FORBIDDEN`；把 Job 改回排队的写法也会散到业务域。
- **扩展 `resumeWorkforceJob`，加一个新触发源。** 要放开「failed 是终态」与「手动只放行身份失效」两条冻结规则，2C-1 的恢复语义会跟着变。处理器认领时本来就会重新校验发起人身份（`processor.ts:278-314`），执行器也会逐步重新校验执行策略与工具权限（`executor.ts:1171-1250`）。
- **分析记录也由 `resume.ts` 直接写。** 运行时模块会认识招投标的表，破坏「Workforce owns orchestration，Tender owns domain logic」（`deterministic-plan.ts:8`）。
- **新建一个「续跑」任务，在后台把失败步骤挑出来跑。** 那是一条新队列，违反硬纪律第 3 条。
- **继续后立即推进一个时间片。** 第 3 步没有执行预算就拒绝开跑（`tools.ts:1326-1333`），推进函数虽能给出预算，但那是多出来的一处推进点，而且要多一处触发点。

### D3 为什么这不算新增队列

继续只改既有 `AgentRun` 行的 `status / attempts / nextAttemptAt / leaseExpiresAt`，写在运行时基线已登记的写入方 `resume.ts` 里，与审批恢复的写法相同（`resume.ts:379-392`），也与新建 Job 入队相同（`job.ts:303-311`）。认领者是既有的 `processQueuedWorkforceJobs`（`processor.ts:763-781`），由既有的 `/api/cron/agent-runs` 每 2 分钟一次触发（`vercel.json:67-69`）。

整个过程没有新表、新状态值、新租约、新定时任务、新执行者注册，也不扫描「失败的 Job」：只在用户点按钮时，对这一个 Job 做一次条件更新。项目锁是既有的事务级 advisory lock，事务结束即释放，不是租约。

被否决的备选：**另立一个「继续」专用的写入模块，并把它登记进运行时基线。** 门禁能过，但基线是只减不增的收敛清单，为一个按钮多一个写入方，违背收敛方向；`resume.ts` 本来就是「把停下的 Job 放回排队」的地方。

### D4 入口、权限与身份

`POST /api/projects/[id]/tender-analysis/agent` 加 `action: "continue"`，请求体必须有 `jobId`。

- 权限：
  - 路由开头的 `requireTenderAnalysisWrite`（`route.ts:45`），与「开始 / 重新分析」同一个判定；
  - 当前用户能用卡片发起，即 FIX-18 的 `canStart`：组织开关加用户级开关，角色按岗位派生，与建作业时同一算法（`job.ts:149-158`）。
  - 组织开关没开，返回 403「投标 AI 分析（数字员工）尚未在当前环境开放」；用户级开关没过，返回 403「Workforce Runtime 未开启，无法启动 AI 分析」。两句都与「开始 AI 分析」现在的返回相同（`trigger-service.ts:122`、`:218`，路由映射 `route.ts:96-98`）。
- Job 归属校验：沿用 `tenderJobWhere`（组织 + 项目 + `workDomain` + `runType`，`trigger-service.ts:66-80`），与 `cancel` 相同（`:244-247`）。
- 身份：继续以后仍以发起人的身份执行，处理器每次认领都重新校验发起人是否在职、是否仍是成员（`principal.ts:55-107`）。点击的人记在恢复事件的 `humanActorUserId` 与审计的 `userId` 上。模型费用的月度预检按发起人算（`ai/client.ts:173-185`）。继续不新建 Job，不占组织的 AI 任务额度（那是新建 Job 时的检查，`route.ts:115-119`）。见 G5。
- 返回码见规格。409 的原因用 D1 的中文句子。

被否决的备选：
- **只要项目写权限。** 没开通用户级开关的人，点不了「重新分析」，却能继续别人的 Job，花的是发起人的额度，等于绕过开关。
- **在作业页加按钮、走作业接口。** 作业接口明文只读，可见性按作业范围判定，另有一套口径（`api/workforce/jobs/[id]/route.ts:16-18`），要另立写接口与权限设计。项目卡片已有「重新分析」，权限口径一致。

### D5 项目卡片

- `getTenderWorkforceAnalysisStatus`（`trigger-service.ts:297-367`）多返回 `continuable: boolean` = D1 判定成立且当前用户 `canStart`，只读。
- 卡片在 Job 不是活跃状态时显示按钮（`agent-card.tsx:222-240`）：可继续时，主按钮为「从失败的这一步继续」（`action: "continue"`），「重新分析」降为次按钮；否则保持现状。按钮与文案由 FIX-18 抽出的纯函数 `src/lib/tender-workforce/agent-card-view.ts` 决定（FIX-18 design D11）。
- 继续成功后，卡片清掉「已经通知过结束」的记号（`agent-card.tsx:79`、`:106-115`），这次分析再次结束时照常调用 `onAnalysisFinished`，下方审阅面板随之刷新。
- 继续时拿项目锁的那一下，FIX-18 的卡片接口试拿锁会报「正在启动」（FIX-18 design D10），这是实情，不另处理。
- 规格：主规格「项目卡片显示原因」写着「按钮 SHALL 仍为「重新分析」」，FIX-18 已把它改成只对能用卡片发起的人成立。本 change 在 FIX-18 那一版上再改一次（MODIFIED），加上可继续时的主按钮；FIX-18 的场景原样保留。FIX-18 归档后若这条的文字又有变化，本 change 归档前按它同步。

被否决的备选：
- **每次都显示按钮，点了再报不可继续。** 用户会先点一次、看到拒绝。判定只读、很便宜，没有理由让人先试。
- **卡片按 jobId + 状态记「已通知」，不在继续时清。** 两次停下的状态可能相同（都是需要人工处理），仍会漏掉。

### D6 按轮收尾与通知

- 轮次 n = 这个 Job 的审计 `tender.workforce.continued` 条数（查 `AuditLog` 的 `targetType + targetId`，有索引，`schema.prisma:1328`）。第 0 轮是发起之后、还没继续过。
- 收尾（`job-failure-surfacing.ts:66-107`）算出 n，通过 `failWorkforceTenderAnalysisRun` 传给 `notifyTenderRunFailed`。
- 失败通知的去重键：第 0 轮保持 `tender-run-failed:{runId}:{userId}`，旧数据完全不变；第 n 轮为 `tender-run-failed:{runId}:r{n}:{userId}`。
- 审计 `tender.workforce.failed_surfaced` 每轮一条：每轮的分析记录状态 CAS 会重新成立一次，审计跟着它写。
- 收尾时再判一次 D1，结果传给通知；可继续时把末句改为「可在项目里点「从失败的这一步继续」，或重新发起分析。」（现在的末句在 `alerts.ts:49`）。
  - 判定在调用 `failWorkforceTenderAnalysisRun` 之前做，第 5 条按「这条记录即将收尾为未完成、不是取消」代入，不等记录真的改完。否则记录还在「分析中」，第 5 条永远不成立。
  - 这里的「可继续」只看 D1 八条，不看收件人的 `canStart`；收件人点进卡片后，按钮是否出现由卡片接口按他本人判定。
  - 收尾改完记录、发通知之前，若有人已经点了继续，通知读到记录回到「分析中」就不发（`alerts.ts:88`），人已经在处理，不再打扰。

被否决的备选：
- **用分析记录的 `attemptCount` 记轮次。** 那一列在旧管线里表示重试次数，通知会据此写出「（已尝试 N 次）」（`alerts.ts:47-48`），语义混了。
- **用失败时间做去重键。** 旧管线的失败记录也走这个函数，它们的去重行为会跟着变。
- **按 `job.resumed` 事件的条数数轮次。** 审批恢复也写这个事件，要再按 payload 过滤；审计本来就要写，直接数它更直接。

### D7 继续次数上限 2，次数从审计数出

- 每个 Job 最多继续 2 次。第 3 次请求返回 409「这次分析已经继续过 2 次，请重新分析」。
- 次数 = 审计 `tender.workforce.continued` 的条数，与 D6 的轮次是同一个数，审计在重置的同一事务里写（D2 第 4 步），不会少数。
- 理由：每次继续都把失败步骤的尝试次数清零，全 Job 的尝试次数之和不会因为反复继续而累积，D1 第 8 条封不住；第 3 步一次 13 分钟，不封顶就能无限重跑。

被否决的备选：
- **在 Job 元数据里记继续次数。** `AgentRun.metadata` 不在硬纪律第 1 条列出的扩展位里（Organization.settingsJson / User settings、Notification、AuditLog），审计在列。
- **不设上限。** 后果见上；「重新分析」虽然也不设上限，但它每次都新建 Job，受组织 AI 任务额度约束（`route.ts:115-119`），继续不受。
- **上限 1。** 余额不足这一类，充值前点一次、充值后再点一次是正常用法，1 次不够。

## 与八条硬纪律的关系

1. **零 schema**：遵守。只写既有列（`AgentRun.status / attempts / nextAttemptAt / leaseExpiresAt / errorCode / errorMessage / completedAt`，`AgentRunStep` 的状态、计数、错误、产出与执行记录列，`TenderAnalysisRun.status / errorCode / errorMessageSanitized / failedAt`），以及既有事件、审计、通知表。继续次数从 AuditLog 数出，不写 `AgentRun.metadata`（D7）。
2. **出站先审批**：不涉及。站内通知不算出站；继续后第 9 步照既有规则发 Muse `analysis.ready`。
3. **禁止第三套队列**：遵守，见 D3。写入放在运行时基线已登记的 `resume.ts`，项目锁是既有的事务级锁，运行时架构基线不改。
4. **脱敏**：遵守。接口与通知只有固定中文与步骤名；规格里写了 SHALL NOT。
5. **不爬登录页**：不涉及。
6. **邮箱分离**：不涉及。
7. **确定性优先**：遵守。判定是查表与比较，继续动作零模型调用；继续之后的执行沿用既有步骤，不多调。
8. **测试注册**：遵守。`continue-eligibility.test.ts` 进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`；`continue-from-failed-db.isolated.test.ts` 进 `scripts/test-all.sh`。

## 验证方式

- `npx tsx src/lib/tender-workforce/__tests__/continue-eligibility.test.ts`（纯函数）：
  - D1 八条逐条正反例；
  - 拒绝原因只取第一条，九句原因逐字；
  - 旧 Job 停在综合汇总（`synthesis_failed`）可继续；「失败」状态的 Job 不可继续；
  - 契约 / 权限码不可继续；
  - 继续次数 0 / 1 可、2 不可；
  - 执行次数边界（恰好等于、超出 1）；
  - 执行失败码集合取自 `workforce-runtime/constants.ts`；
  - 源码断言：`continue-eligibility.ts` 不引用 `@/lib/db`；`trigger-service.ts` 不出现 `.agentRun.update` / `.agentRunStep.update`。
- 隔离库 `NODE_ENV=test npx tsx src/lib/tender-workforce/__tests__/continue-from-failed-db.isolated.test.ts`：
  - 预置第 3 步失败（带检查点）的确定性计划 Job 与 `AGENT_FAILED` 分析记录；
  - 走路由：只读成员 403、过不了用户级开关 403、别的项目 404、缺 `jobId` 400；
  - 并发：两次继续只成功一次；继续与重新分析同时发起，最后项目里只有一单在跑；旧管线有一单在跑时 409；
  - 走真处理器跑完：第 1、2 步次数与产出不变、第 3 步从检查点续跑、同一条分析记录进入待审阅、Job 完成；
  - 再造一次失败，验证第二轮收尾与新通知；第三次继续被拒；
  - 失败步骤上预置 `evidenceJson.continuation.deadlineCuts`，继续后被清掉；
  - 卡片接口 `continuable`；响应里搜不到错误码与指纹。
  - 改动前的代码上，这些用例应失败：`continue` 返回 400「未知的 action」。
- 扩展的测试：`job-failure-surfacing-db.isolated.test.ts`（同一轮重放仍一条）、`job-failure-surfacing.test.ts`（卡片：两个按钮，继续后清「已通知」记号；FIX-18 之后对 `agent-card-view.ts` 做用例）。
- 回归：
  - `t1b-integration.test.ts`、`phase2c1-pause-resume.test.ts`、`t5-p11-resumability.test.ts`、`alerts.test.ts` 通过数不变；
  - `bash scripts/test-runtime-architecture.sh` 末行 `runtime-architecture guards PASS`；
  - `npm run typecheck`、`npm run lint:baseline`、CI 子集、`npm test`；
  - `git diff origin/main -- prisma/ vercel.json src/lib/runtime-architecture/runtime-architecture-baseline.json` 为空；`resumeWorkforceJob` 函数体不变（`phase2c1-pause-resume.test.ts` 全过）。

## Risks / Trade-offs

- **余额还没充值就点了继续。** 失败的那一步会再失败一次（2 次尝试），Job 又停下，通知写明余额不足。每次继续只清失败的那几步，最多继续 2 次，所以不会无限重试。
- **之前走过验证的 Job（`verification_failed`）继续后，修复轮次已用完。** 验证次数按已有记录累加（`verifier.ts:344-347`），再要修复就直接转人工。只有验证通过才会完成；报告里写明。
- **文件指纹在锁外判定。** 判定之后、提交之前上传的补遗不会让这次继续被拒。上传不拿项目锁，锁内重算也关不上这个窗口；窗口里上传的文件与正常分析中途上传一样处理（第 3 步按记录上的文件快照分析，`v2-resumable-workforce.ts:68-86`），下一次重新分析会纳入。
- **继续之后以发起人的身份花钱。** 见 D4 与 G5。
- **FIX-18 改了卡片的按钮布局与锁的使用方。** 本 change 排在它后面合并，按它合并后的样子放按钮、拿锁。FIX-18 的 GATE 若改了 `canStart` 或「在跑」的口径，本 change 跟着它。

## Migration Plan

无数据迁移、无开关。合并部署即生效；回滚 = 回退本 PR。旧 Job 只要满足 D1，就同样可以继续，比如 2026-11-22「12-3」（按日志推断它停在需要人工处理 / `blocked_graph`，待 FIX-20 附录 SQL 核实）。

## 留给 GATE

**G1 「失败」状态的 Job 能不能继续**
- A 能，只限 `model_failed` / `external_timeout`。后果：这两种 Job 往往没有失败步骤，或者留着一个「执行中」的步骤（清扫只改 Job），要放行就得在继续时把终态 Job 里的「执行中」步骤也回收，等于在处理器认领之外再开一个回收边界；还要处理「失败」不在活跃集里带来的互斥问题。
- B（推荐）只允许「需要人工处理」。后果：被平台反复强制结束、最后被清扫成失败的 Job 只能重新分析；但常见的「被强制结束两次」会被下一次认领记为 `stale_running_exhausted`，Job 停在需要人工处理，照样可继续。
- 推荐 B：A 的收益只覆盖少见情形，代价是一个新的回收边界。

**G2 文件包变了之后**
- A（推荐）不可继续，提示重新分析。
- B 照样继续，用旧清单。后果：新补遗不在分析里，用户看不出来。
- 推荐 A。

**G3 继续之后要不要立刻推进一个时间片**
- A（推荐）不推进，等定时触发（≤ 2 分钟），与「开始 AI 分析」一致。
- B 在响应之后推进一次。后果：多一处推进点；第 3 步需要的执行预算要在这里另算。
- 推荐 A。

**G4 每个 Job 最多继续几次**
- A（推荐）2 次，次数从审计数出（D7）。后果：充值前后各点一次够用；第 3 次只能重新分析。
- B 不设上限。后果：第 3 步每次 13 分钟、2 次尝试，可以无限重跑，且不受组织 AI 任务额度约束。
- C 1 次。后果：余额不足时，充值前误点一次就用完了。
- 推荐 A。

**G5 继续以谁的身份执行**
- A（推荐）发起人。与审批恢复相同；处理器每次认领都重新校验发起人；点击的人记在事件与审计上；费用按发起人预检。后果：发起人离职后继续会转为需要人工处理（身份失效），只能重新分析。
- B 改成点击的人。后果：要改 `metadata.initiatedByUserId`，那是防伪造的保留键（`job.ts:88-107`），处理器的身份恢复语义跟着变。
- 推荐 A：不动运行时的身份规则；点击的人本来就要过 `canStart`。

**G6 合并顺序**
- 推荐 FIX-20 → FIX-18 → 本 change。本 change 依赖 FIX-20 的错误码、原因规则与执行失败码集合，依赖 FIX-18 的 `canStart`、锁与卡片纯函数，并改同一张卡片的按钮与同一个 POST 接口。

## GATE 结论

Evan 2026-11-22 看过修订版：「GATE 按你的推荐来」——上面「留给 GATE」各条都按推荐（A / B 以各条写的推荐为准）。其中 G1（FIX-20）「GATE 前由有权限的人跑附录 SQL」：容器里没有生产连接，SQL 结果到之前，识别字面量先按 SDK 报错格式推出的「insufficient_quota / exceeded your current quota」实现，结果到后在实现 PR 里核对改正并补进报告 §1。
