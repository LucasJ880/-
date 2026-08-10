# Qingyan Workforce Runtime — Phase 2B-1 Implementation Report
## Task + Worker + Structured Handoff Foundation

- 日期：2026-08-10
- 分支：`feature/workforce-runtime-phase2b1-task-handoff`
- Base main SHA：`97ac959bb976170d336a76165cf1167d9e049ee1`（PR #81 Phase 2C-1 merge；已验证 main 含 #78/#79/#80/#81）
- 设计依据：`docs/QINGYAN_WORKFORCE_PHASE2B_HANDOFF_PARALLEL_DESIGN.md`（本 PR 只实现其 2B-1 范围 + 任务书收紧项；无新外部调研）
- 范围：**One Job → Multiple Durable Tasks → Server-Validated Worker Assignment → Structured Handoff V1 → Downstream Task Context → Explicit Synthesis Task**
- 明确不做：并行执行（2B-2）、fallback worker / 动态 replan（2B-3）、resource freshness（2C-2）、clarification/replan（2C-3）、任何 UI

---

## 1. Bounded Implementation Audit（Concern → Existing primitive → Reuse decision）

| Concern | Existing primitive | Reuse decision |
|---|---|---|
| Task identity | `AgentRunStep` + `@@unique([runId, stepKey])` | 原样复用（Task = AgentRunStep，冻结） |
| Task lifecycle | step status 词汇表（pending/ready/running/awaiting_approval/completed/partially_executed/failed/blocked/skipped） | 原样复用，零新增状态 |
| Dependency | `dependsOnJson` + `dependenciesSatisfied` + `refreshReadySteps`（persist.ts，真实 enforcement） | 原样复用 |
| Worker assignment 存储 | 无列 | `inputJson.workforceTask`（namespaced envelope，零迁移；设计文档 §5 Option A） |
| Worker registry | supervisor `WORKER_REGISTRY`（skill 白名单线，绑定 runSkill 执行域） | 不直接复用（语义不同：那是 skill 白名单，不是 V2 Task 路由 profile）；新增最小 `src/lib/workforce-runtime/workers.ts`，沿用同一"配置对象+白名单校验"模式 |
| Handoff 存储 | `outputJson`（业务产物） | `outputJson.workforceHandoff`（namespaced，保留原业务 output，零迁移；设计文档 §6） |
| Upstream context 注入 | `asEvidenceMap` → `priorEvidence`（工具层业务数据管道） | **保留原样**（设计文档 §6.1"运输层零改动"；黄金场景 `s5_prioritize` 会读非依赖步骤 s1/s2，收敛会破坏 legacy 行为）；validated Handoff Context 作为**附加**受信协作上下文注入 `AdapterContext.workforce` |
| Synthesis 标记 | 无 | `WorkforceTaskSpecV1.taskKind = "synthesis"` |
| Planner step schema | `PlanStepSchema`（Zod） | 增加可选 `workerKey`/`taskKind` 提议字段（legacy 计划不受影响） |
| Planner 校验 | `sanitizePlannerOutput`（非法 tool 清洗/fail 路径） | 同模式：unknown workerKey → `applyWorkforceTaskSpecs` FAIL → 现有 planner failure path（退避重试→耗尽 failed） |
| Plan 持久化 | `persistPlanAndStepsWithClient`（workforce 走 fence 同事务） | 扩展：step 携带 spec 时写 `inputJson.workforceTask`；legacy 计划不写 inputJson |
| Step 完成持久化 | executor fenced write（outputJson/evidenceJson/completedAt） | Handoff 在**同一 fenced 原子写入**内落盘 |
| Fencing | `RunFence` / `fenceGuardedWrite` / tool 长 await 后 `fence.check()` | 原样复用；无新 fencing 机制 |
| Approval 暂停/恢复 | 2C-1 `resumeWorkforceJob` 单一入口 + reconcile | 原样复用；reconcile 终态化时补建 Handoff（同一 update 原子写入） |
| Reject fail-closed | 2C-1 resume 步骤 5b（rejected → needs_human(approval_rejected)） | 原样复用，零改动 |
| Kill-switch | `isWorkforceProcessingEnabled`（claim/queue 双 gate，#80） | 原样复用；Task 执行与 Handoff 生成都在 slice 内，天然受控 |
| 幂等键 | `buildStepOperationKey`（稳定，不含 attempt） | 原样复用 |
| 验证 | run 级 `verifyRuntimeV2Run` | 原样复用，零改动 |
| Final report | `buildFinalReport` | 复用机制；workforce run 存在已完成 synthesis Task 时附加其 Handoff summary 作为综合结论（不重写报告系统） |
| Events | `emitRuntimeV2Event` payload | 最小增强：step.started 带 workerKey/taskKind/upstreamStepKeys；step.completed 带 handoffVersion；不新建表 |
| Quota | run 级 governance（createAgentRun 复用） | 零改动；Worker 不产生独立计费身份 |
| AgentTask（legacy） | 独立模型 | **零触碰**（diff 中无任何 AgentTask 相关文件） |

## 2. Schema decision

```text
PHASE_2B1_SCHEMA_CHANGE = NONE
Migration = NONE
```

Worker assignment 与 Handoff contract 均由现有 JSON 字段以 namespaced envelope 安全表达：
`AgentRunStep.inputJson.workforceTask`（写入端唯一：server 校验后的 persist）与
`AgentRunStep.outputJson.workforceHandoff`（写入端唯二：executor fenced 完成写入 / 审批 reconcile 原子写入）。

## 3. Task 模型与 Child Run 决策

```text
TASK_MODEL = AgentRunStep
CHILD_RUN_PER_TASK = NO（USE_CHILD_RUN_FOR_EVERY_TASK = NO）
```

Job 恒为 root AgentRun（`runType="workforce_job"`，jobId=runId）；测试断言 Job 全程无 `parentRunId` 指向它的子 run。Multi Task ≠ Multi Agent：Worker 是 Task 上的受控身份标签 + server profile，不是独立 AgentRun。

## 4. Worker Registry 设计（`src/lib/workforce-runtime/workers.ts`）

- server-owned **execution/profile registry**（bounded，V1 三个 worker）：
  `sales_worker`（role=sales_specialist，taskKinds=[work]）、`tender_worker`（role=tender_specialist，taskKinds=[work]，投标线预留）、`synthesis_worker`（role=synthesis_lead，taskKinds=[synthesis]）。
- 刻意不含 userId/orgId/scope/permissions/authorized/approval 等字段（测试断言）；**不是 authorization registry**。
- server 默认指派 deterministic：work→sales_worker（当前 V2 工具目录为销售线）、synthesis→synthesis_worker。
- 禁止动态创建：registry 之外的 workerKey 不存在任何注册路径（§39）。

## 5. Worker Assignment Validation（`task-contract.ts`）

```text
LLM proposed workerKey → server registry validation → sanitized assignment
```

- Planner（仅 workforce 路径传入 `workerRoster`）只能"提议" `workerKey`/`taskKind`；system prompt 明示禁止编造 worker/role/权限；planner **不能输出** systemPrompt/permissionPrompt/toolPolicy——Worker instructions 全部 server-owned。
- `applyWorkforceTaskSpecs`：unknown workerKey / worker 不支持 taskKind / 非法 taskKind → **整计划 FAIL VALIDATION**（`WORKFORCE_WORKER_INVALID`），走现有 planner failure path（throw → 退避重试重规划 → attempts 耗尽 failed）；planJson 不落库，无半成品计划。绝不 unknown worker → arbitrary worker。
- `spec.worker.role` 由 server registry 注入，不信任 LLM。
- 执行期再校验（executor gate）：registry 漂移（spec 中 worker 已不存在/不支持 taskKind）→ step failed + run needs_human（`workforce_worker_invalid`）。

## 6. Task Contract V1

```text
TASK_CONTRACT_VERSION = workforce-task/v1
```

`WorkforceTaskSpecV1 = { contractVersion, worker: { workerKey, role }, taskKind: "work"|"synthesis", objective, expectedOutput? }`（Zod `.strip()`；objective/expectedOutput 长度有界）。businessRefs 未纳入 V1（最小化，任务书允许收敛）。存储于 `inputJson.workforceTask`。

## 7. Handoff V1 Contract（`handoff.ts`）

```text
HANDOFF_CONTRACT_VERSION = workforce-handoff/v1
```

`WorkforceHandoffPayloadV1 = { contractVersion, source: { runId, stepKey, workerKey }, summary, outputs?, evidenceRefs?, businessRefs?, warnings?, openQuestions?, createdAt }`（Zod `.strip()`）。

- **source 由 server 注入**（builder 参数，不信任模型）；消费端与真实上游行交叉核对 runId/stepKey/workerKey，不符 → `HANDOFF_SOURCE_MISMATCH` fail-closed。
- 校验/消毒：known version → parse（`.strip()` 丢弃一切白名单外字段）；unknown version → `HANDOFF_VERSION_UNSUPPORTED`；malformed → `HANDOFF_MALFORMED`；oversize → `HANDOFF_TOO_LARGE`。全部 fail-closed，绝不 silently accept。
- **尺寸边界**：summary≤2000、evidence/business refs≤20、warnings/questions≤10、outputs 单字段≤4KB/总计≤16KB（超出 → deterministic 截断占位 + warnings 标注）、信封序列化硬上限 32KB（读写两侧同校验；写侧超限降级为丢弃 outputs）。1MB 级原始输出不可能进入下游 prompt。
- **授权边界（最重要）**：schema 白名单中没有任何授权语义字段；`FORBIDDEN_HANDOFF_AUTH_FIELDS`（userId/orgId/role/scope/capabilities/permissions/authorized/approved/canWrite/toolPolicy/approvalBypass/admin 等）经 parse 后必然不存在于受信对象——受信对象永远重建，绝无 `{...rawHandoff}`。伪造字段零授权效果；Tool 执行完整走 principal→membership→capability→scopeGuard→tool policy→approval→idempotency（测试 46 端到端验证：伪造 `approved:true/canWrite:true/scope:*` 后写动作仍进入 PendingAction pending）。

## 8. Handoff 生成与存储

```text
raw Task result → server builder → V1 → validate → persist with Step
```

三个（且仅三个）生成点，全部 server-side：
1. executor 正常完成：与 `status=completed, outputJson, completedAt` 同一 fenced 原子写入；
2. executor skipped（无可写对象）：同一 fenced 写入；
3. 审批 reconcile 终态化（completed/skipped/partially_executed）：与 step 终态同一 update 原子写入（与 Step result persistence 同 durable boundary）。

`awaiting_approval` 期间**无**最终 Handoff（§33，测试断言）；reject → skipped 步骤保留真实终态 + Handoff 明示"未产生业务写入"，Job 由 2C-1 步骤 5b park needs_human，下游不执行（§34）。

## 9. Handoff Idempotency（§31）

builder 全程无 wall clock / random：`createdAt` = Step durable `completedAt`（executor/reconcile 均先取唯一时间值再共用）；同一 `(runId, stepKey, completed result)` 重复构建 → JSON 全等（测试断言）。completed Task 不会因 retry/continuation/resume/lease reclaim 重跑（2A durable 语义 + ready-only 执行），Handoff 不重复生成（测试 48：attemptCount/completedAt/信封 JSON 三者不变）。

## 10. Fencing 集成（§32）

Handoff 持久化处于 step result 的同一 `fenceGuardedWrite`/reconcile update 内；tool 长 await 后仍有 `fence.check()` 先行探测。stale worker（租约易主后）任何 Step result + Handoff 写入 → `LostLeaseError`，零写入（测试 47：直接 fenced 写入与完整 V2 round 双路径验证）。

## 11. Multi-Upstream 与顺序确定性（§23/§24）

`collectUpstreamHandoffs`：按 `dependsOnJson` **数组声明序**（plan 产物，稳定）解析上游，明确不依赖 DB 行序（纯函数测试以逆序行输入验证；集成测试以声明序 C,A,B ≠ 创建序验证）。一个 Task 可消费任意多个上游 Handoff（≤ maxSteps=16 天然有界）。本阶段 A/B/C 顺序逐个完成（无并行）。

## 12. Synthesis（§25–§28）

- `taskKind="synthesis"` 是显式 AgentRunStep，由 server-validated `synthesis_worker` 执行，走同一 executor（无新 Agent runtime）；
- 输入 = Task objective + validated upstream Handoffs（§27）；synthesis Handoff 的 `outputs.upstreamSummaries` 按声明序携带各上游 `{stepKey, workerKey, summary}`；
- Final Job Result：`buildFinalReport` 对 workforce run 附加"综合结论（stepKey）：synthesis summary"——复用现有报告机制，Job terminal 时**没有**隐式 LLM summarize everything。

## 13. Worker Execution Context（§13/§14）

执行时从 server registry 取 Worker Profile，注入 `AdapterContext.workforce = { workerKey, role, taskKind, objective, spec, upstreamHandoffs }`——只传必要内容，不注入完整 Worker 对象，不含任何授权语义。Planner 无法生成 worker definition（registry 之外无写入路径）。

## 14. Failure 边界（§29）

fail-closed 一览（全部 step failed + run needs_human，无 fallback worker/动态 replan）：

| 场景 | errorCode |
|---|---|
| spec 存在但损坏 | `workforce_task_invalid` |
| worker 无效/不支持 taskKind（执行期） | `workforce_worker_invalid` |
| 上游步骤缺行/未终态 | `HANDOFF_UPSTREAM_MISSING` |
| 上游信封 unknown version | `HANDOFF_VERSION_UNSUPPORTED` |
| 上游信封 malformed / oversize | `HANDOFF_MALFORMED` / `HANDOFF_TOO_LARGE` |
| 上游信封来源不符 | `HANDOFF_SOURCE_MISMATCH` |
| server 自身构建失败（防御） | `handoff_build_failed` |

**Legacy 兼容例外（有意设计，非漏洞）**：终态上游**完全没有**信封 → legacy-completed 上游（2B-1 之前规划/完成的存量 Step、人工 reconcile 产物、2A/2C-1 回归测试的合成步骤）→ 跳过注入、允许执行。依据：Handoff 从不承载授权（§16），缺失只是缺业务上下文，present-but-invalid 才是契约违约；若对缺失也 fail-closed，升级时所有 in-flight Job 会被困死，且 2A Case H / 2C-1 全部回归会破。该边界有专项测试。

## 15. Kill-Switch / Quota / Observability / Parallel

- Kill-switch（#80）语义不变：`WORKFORCE_RUNTIME_ENABLED=0` → 不 claim/不 reclaim/不执行 Task/不生成 Handoff；恢复后继续（测试 50）。执行器无任何绕过路径（Task 执行只存在于 slice 内）。
- Quota：零新增；Worker 无独立计费身份。
- Observability：仅现有事件 payload 增量（step.started：workerKey/taskKind/upstreamStepKeys；step.completed：handoffVersion）；无新表、无 UI。
- **无并行执行**：executor 仍每轮 `ready[0]` 单步执行，未引入 Promise.all/worker pool/并发调度/资源锁（§38，2B-2 边界）。

## 16. Legacy 兼容（§51/§52）

- legacy `runtime_v2`：不传 workerRoster、计划无提议字段、步骤无 spec → 无 gate、无 Handoff、行为不变（测试 51：黄金链照常执行，inputJson 全空，无 workforce errorCode）。
- 旧 workforce run（2B-1 前规划）：spec absent → 按 legacy 行为续跑（readWorkforceTaskSpec="absent" 分支）。
- `AgentTask`：零行为变化——diff 不含任何 AgentTask 文件（冻结维持）。

## 17. 文件清单

新增：
```text
src/lib/workforce-runtime/workers.ts             Worker Registry（profile，非授权）
src/lib/workforce-runtime/task-contract.ts       workforce-task/v1 + server 指派校验
src/lib/workforce-runtime/handoff.ts             workforce-handoff/v1 + build/parse/sanitize/collect
src/lib/workforce-runtime/__tests__/fixtures/handoff-v1-golden.ts
src/lib/workforce-runtime/__tests__/phase2b1-contracts.test.ts
src/lib/workforce-runtime/__tests__/phase2b1-task-handoff.test.ts
src/lib/workforce-runtime/__tests__/phase2b1-approval-handoff.test.ts
docs/QINGYAN_WORKFORCE_PHASE2B1_IMPLEMENTATION_REPORT.md
```

修改（未触碰 Tool Runtime core / RBAC core / Governance core / PendingAction core / 两个 Production Guard / Tender EFG）：
```text
src/lib/agent-runtime-v2/schemas.ts     PlanStepSchema 可选 workerKey/taskKind
src/lib/agent-runtime-v2/planner.ts     可选 workerRoster → prompt/schemaHint
src/lib/agent-runtime-v2/persist.ts     spec → inputJson.workforceTask
src/lib/agent-runtime-v2/executor.ts    workforce gate + handoff fenced 持久化 + 事件增强
src/lib/agent-runtime-v2/adapters.ts    AdapterContext.workforce（注入面）
src/lib/agent-runtime-v2/process.ts     reconcile 终态 Handoff + final report synthesis 呈现
src/lib/workforce-runtime/processor.ts  planner roster + applyWorkforceTaskSpecs 接线
src/lib/workforce-runtime/index.ts      导出
scripts/test-all.sh                     挂载 2B-1 三个套件
```

## 18. 测试结果（隔离 Neon 分支 `preview-phase2b1-*`，`assertSafeTestDatabase` + `NODE_ENV=test` + `DATABASE_ENVIRONMENT=isolated`，跑完即删）

2B-1 新增（两轮重复运行结果一致）：

| 套件 | 结果 |
|---|---|
| phase2b1-contracts（含 H1–H5 golden fixtures、尺寸边界、幂等、来源核对） | 45/45 PASS ×2 |
| phase2b1-task-handoff（§41/43/44/45/47/48/50/51） | 42/42 PASS ×2 |
| phase2b1-approval-handoff（§33/34/46/49） | 16/16 PASS ×2 |

回归（同一隔离分支顺序执行）：

| 套件 | 结果 |
|---|---|
| Workforce Kill-Switch（首位运行） | 15/15 PASS |
| 2A Job Identity / Lease / Timeout / Approval Resume / Stale Worker / Normal Slices（Case A–L） | 25+15+6+12+30+9 全 PASS |
| 2C-1 Pause/Resume（M/N/R）/ Expiry Races | 24+6 全 PASS |
| Runtime V2 Golden Flow / Planner / Durable State / Verifier-Security / Preview Gate P0 | 14+17+11+15+30 全 PASS |
| pre-execute guard / Agent scope / Runtime Context / Context propagation | 33+24+28+24 全 PASS |
| Production DB Test Guard / Production Operation Guard | 22+30 全 PASS |
| Governance / Approvals RBAC | 13+34 全 PASS |
| tsc --noEmit / eslint（改动文件）/ next build | 全 PASS |

已知既有事项（非本 PR 引入、未触碰）：Tender EFG 断言归 Issue #82 独立 Lane；Workforce 测试 cross-suite 污染治理归 Lane B（`P2_TEST_ISOLATION_DEBT`，本 PR 新增测试已按 unique org/run/idempotency prefix 编写并验证两轮重复运行稳定）。

## 19. Final Gate

```text
PHASE_2B1_SCHEMA_CHANGE = NONE
TASK_MODEL = AgentRunStep
CHILD_RUN_PER_TASK = NO
WORKER_REGISTRY = PASS
WORKER_ASSIGNMENT_VALIDATION = PASS
UNKNOWN_WORKER = FAIL_CLOSED
TASK_CONTRACT_VERSION = workforce-task/v1
HANDOFF_CONTRACT_VERSION = workforce-handoff/v1
HANDOFF_NORMAL_A_TO_B = PASS
HANDOFF_MULTI_UPSTREAM = PASS
HANDOFF_SYNTHESIS = PASS
HANDOFF_UNKNOWN_VERSION = FAIL_CLOSED
HANDOFF_MALFORMED = FAIL_CLOSED
HANDOFF_AUTH_FORGERY = BLOCKED
HANDOFF_SIZE_BOUNDARY = PASS
STALE_WORKER_HANDOFF_WRITE = BLOCKED
DUPLICATE_COMPLETED_TASK = PASS
APPROVAL_HANDOFF_REGRESSION = PASS
REJECT_DOWNSTREAM_EXECUTION = BLOCKED
KILL_SWITCH = PASS
LEGACY_RUNTIME_V2 = PASS
LEGACY_AGENTTASK = PASS
Phase 2A A–L = PASS
Phase 2C-1 = PASS
Golden = PASS
Production DB Guard = PASS
Production Operation Guard = PASS
Migration = NONE
tsc = PASS
eslint = PASS
build = PASS
```
