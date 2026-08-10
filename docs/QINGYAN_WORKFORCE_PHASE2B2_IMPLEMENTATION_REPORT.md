# Qingyan Workforce Runtime — Phase 2B-2 Implementation Report
## Controlled Parallel Task Execution

- 日期：2026-08-10
- 分支：`feature/workforce-runtime-phase2b2-controlled-parallel`
- Base main SHA：`abac67e87b11f6d8e542f139696b5301ae9e16be`（含 #78/#80/#81/#83/#84/#85/#86，HARD PREREQUISITE 逐项验证通过）
- 设计依据：`docs/QINGYAN_WORKFORCE_PHASE2B_HANDOFF_PARALLEL_DESIGN.md`（§3 调度语义 / §3.4 T2+T3 / §10 冲突模型）；无新外部调研
- 范围：**同一 Job 内满足安全条件的多个 ready Task 受控并行执行**——bounded、policy-driven、CAS-claimed、fenced、idempotent、resource-aware、approval-safe
- 明确不做（§38）：fallback worker / dynamic replan（2B-3）、resource revalidation（2C-2）、clarification resume（2C-3）、Memory Runtime、child run per task、UI、Operator redesign、跨 Job 全局资源锁

---

## 1. Schema Decision

```text
SCHEMA_CHANGE = NONE
Migration = NONE
```

零迁移。全部语义由现有结构承载：

| 需求 | 承载 |
|---|---|
| 执行策略 | 纯函数派生（`classifyTaskExecutionPolicy`），不落库 |
| 资源声明 | `inputJson.workforceTask.resources`（workforce-task/v1 **backward-compatible optional field**，§10 允许） |
| Step 认领 | 现有 `status` 列 + `updateMany` 条件 CAS |
| 并行上限 | env `WORKFORCE_JOB_MAX_PARALLEL_TASKS` |
| 观测 | 现有 AgentRunEvent 表（3 个新 eventType，无新表） |

## 2. Task Policy Classifier（§6–§9）

`src/lib/workforce-runtime/parallel.ts` — `classifyTaskExecutionPolicy(step, context)` 纯函数，**server-owned**：planner 只能提供信息（executionMode/riskLevel/resources 提议），安全策略判定完全在服务端。判定顺序（先命中先生效）：

1. **REQUIRES_APPROVAL**：`step.requiresApproval` ∨ `executionMode ∈ {write, approval}` ∨ **server tool catalog** 判定该工具 `requiresApproval` / 非 `readOnly`（planner 谎称 read 不可信——catalog 是 server-authoritative，纯函数测试验证）；
2. **SEQUENTIAL（fail-safe 全集）**：无 workforce-task/v1 spec（legacy / 损坏）、executionMode ∉ {read, analysis}、riskLevel ∉ {LOW, MEDIUM}、preferredTool 缺失 / 不在 catalog / **catalog 未显式标注 `parallelSafe`**——任何不确定一律串行；
3. **EXCLUSIVE_RESOURCE**：声明资源与占用集（running ∪ awaiting_approval ∪ 本 batch 已选任务的资源）相交——本轮禁止启动；
4. **SAFE_PARALLEL**：以上全部通过（含"声明了资源但无冲突"，P4b）。

`ToolDescriptor` 新增可选 `parallelSafe`（`tool-catalog.ts` 仅 9 个 read/analysis 工具显式标注；写工具与缺省一律不允许并行）。

## 3. Resource Declaration（§9–§10）

- 词汇：`{entity}:{id}`（`customer:` / `opportunity:` / `quote:` / `project:` / `tender:` / `email-thread:` 等），模式 `^[a-z][a-z0-9_-]{0,31}:\S{1,160}$`，精确字符串相等判冲突；
- 承载：planner 经 `PlanStepSchema.resources` **提议** → `applyWorkforceTaskSpecs` server 消毒（trim + 去重 + 上限 8）→ 落 `inputJson.workforceTask.resources`。任务书"优先复用 inputJson.resources 或已有等价结构"——采用 2B-1 已建立的 workforceTask namespaced envelope 作为等价结构（单一写入路径 + Zod 白名单校验免费获得）；
- **malformed fail-closed**：非法资源键 / 超上限 → `WORKFORCE_TASK_SPEC_INVALID`，整计划 FAIL VALIDATION（与 unknown worker 同路径）。声明影响并行安全，静默丢弃=漏声明=误并行，故不做宽容降级；
- V1 兼容双向验证：旧记录（无 resources）新 reader 照常 parse；新字段被旧 `.strip()` reader 安全丢弃。**contractVersion 不变**；
- 冲突控制范围：仅 same Job 内 batch（§9），无 distributed global lock。

## 4. Step CAS Claim（§12–§13）

核心安全点。`executor.ts` workforce 路径彻底废除"read ready rows → 直接 update running"：

```text
ready → updateMany({ where: { id, status: "ready" },
                     data: { status: "running", attemptCount: {increment: 1},
                             idempotencyKey, startedAt } })
     → count === 1 才拥有该 Task（同一 guard 事务内回读最新行）
     → count === 0 = TASK_ALREADY_CLAIMED：不执行 Tool、无事件、无写入
```

- 有 fence 时 CAS 在 `fence.guard` 事务内（run lease token 断言 + Step 行 CAS 同一原子 commit）；
- **双保险**（§13）：run-level lease 是第一道防线；即使两个 driver 同时越过它（P6 直接双 round 模拟），Step CAS 保证 exactly-one 执行，Tool side effect count = 1（DB 探针实测）；
- gate（spec/worker/上游 Handoff 校验）在 **CAS 之前**执行——gate 失败不消耗 attemptCount（保持 2B-1 §45 语义：gate-failed step attemptCount=0）。

### 4.1 Stale running 回收（P7 前置）

batch 在单轮内 await 完成 → 轮次开始时不存在"本 driver 正在执行中"的 running Step。因此 workforce 轮次开始时的 running 行只能来自 crash / 租约易主前的旧 worker：当前 driver（持有 run lease）将其 fenced 重置为 ready，经 CAS 重新认领执行。旧 worker 迟到写入被 RunFence 阻断（LOST_LEASE，零写入）。重置不清 attemptCount；重复 crash 由 run attempts（≤5）与 maxToolCalls 双重预算兜底。

## 5. Bounded Parallel Batch（§11/§14–§15）

`buildParallelBatch`（纯函数，deterministic 按计划创建序）：

```text
refreshReadySteps → stale running 回收 → 任一 Step awaiting_approval？→ run 收敛 awaiting（不建新批）
→ classify 逐个 ready → 组批：
    maxParallelTasks ≤ 1        → 恒 [队首]（回滚保证：与单步调度语义一致）
    队首 REQUIRES_APPROVAL/SEQUENTIAL → [队首] 单独成批
    队首 EXCLUSIVE_RESOURCE      → 空批（占用清除后自然恢复）
    队首 SAFE_PARALLEL           → 向后收集资源不相交的 SAFE_PARALLEL，
                                   非 SAFE / 资源相交者 deferred（留在 ready），
                                   收满 maxParallelTasks 为止
→ pre-flight（no_tool / canInvokeTool 重鉴权 / workforce gate；失败只写 Step）
→ 逐个 CAS 认领（失败者丢弃，另一 driver 已拿走）
→ Promise.allSettled（仅 server 分类 + CAS 认领后的 bounded 批）
→ coordinator 聚合 outcome，唯一决定 Job 下一状态
```

- 绝无 `Promise.all(allReadyTasks)`；单批上限 = `WORKFORCE_JOB_MAX_PARALLEL_TASKS`（default **1**、min 1、hard max **4**，非法值回落 1）；
- 单个 Task 异常不取消已启动 sibling（allSettled）；每个 Task 独立收敛 durable outcome（P9）；
- legacy `runtime_v2` 走原单步路径，行为零变化（workforce-only 块已从该路径移除，等价 2B-1 前 legacy 形态；测试 §51 回归验证）。

## 6. Run-Level State Ownership（§16）

并行 Promise 禁止竞写 `AgentRun.status`：

- **Task worker**（`executeClaimedWorkforceStep`）只写：Step state / Step result / Handoff（全部 fenced；tool 长 await 后先 `fence.check()`）；
- **Batch coordinator**（`executeWorkforceBatchRound`）独占：refresh 后组批、`executing` 转换、outcome 聚合、Run 终态决策。收敛优先级 `lost_lease > needs_human > awaiting_approval > continued`；
- 所有 coordinator Run 写入带 `status: { notIn: ["cancelled","failed","completed"] }` 终态保护（§23：cancel 后迟到收敛安全落地，不覆盖终态）。

## 7. Approval + Parallel（§8/§20）

- 审批任务**永不**与其他任务同批启动：队首审批 → 单独成批；SAFE 批收集跳过审批任务（deferred）；
- PendingAction 产生 → Step awaiting_approval（Task worker 写）→ coordinator 统一 Run → awaiting_approval → 2C-1 `resumeWorkforceJob` 链路原样复用；
- awaiting 窗口：executor 防御检查（任一 Step awaiting → 不建新批）+ awaiting Step 的资源持续占用占用集（设计文档 §3.3：审批窗口内不得并行产生同资源第二份草稿）；
- P5 实测：SAFE 批 [s5, b] 不含审批任务；审批任务单独 CAS 认领执行产生真实 PendingAction；Job awaiting_approval 后无新批、无新认领。

## 8. Fencing（§17）

Phase 2A RunFence 全链路保持：Step CAS claim、Step result、Handoff 持久化、coordinator 状态转换全部经 `fenceGuardedWrite` / `fence.guard`；tool 长 await 后保留 `fence.check()` 先行探测。P7 实测：A 认领后租约易主 → B stale-reset + 重新 CAS 完成任务 → A 迟到写入 `LOST_LEASE`，zero stale result / zero stale Handoff（completedAt、信封 JSON 与 B 写入完全一致，step.completed 事件恰好一次）。

### 8.1 并发事件序列修复（前置缺陷）

`appendAgentRunEvent` 原实现 `max(sequence)+1` 读写窗口非原子——并行 Task 同 run 并发 append 会撞 `@@unique([runId, sequence])` 且异常被吞（**事件静默丢失**）。已修复：unique violation（P2002）时重读重试（有界 8 次），其余错误语义不变。这是并行引入前必须修复的支撑点，对既有单写场景零行为变化。

## 9. Handoff Ordering（§18–§19）

- 严格复用 `workforce-handoff/v1`，无 V2、无契约改动；
- 并行任务各自在完成的同一 fenced 原子写入内落信封（2B-1 §31/§32 语义不变）；
- Synthesis 消费顺序恒为 `dependsOn` 声明序（`collectUpstreamHandoffs` 2B-1 实现原样复用）：P8 人为控制完成顺序 C→A→B（sleep 梯度实测 completedAt 严格递增），synthesis `upstreamSummaries` 仍为 A,B,C；
- legacy 三分法不变（P10 重跑验证）：`spec absent + 信封 absent` = TRUE LEGACY 放行；`信封 PRESENT + unknown/malformed/oversized/source mismatch` = FAIL CLOSED；`spec valid + 信封 absent` = HANDOFF_MISSING fail-closed。

## 10. Failure Behavior（§21）

- Tool 失败：记录真实 Task outcome（retry 回 ready / 耗尽 failed），不取消已启动 sibling，coordinator 本轮返回 continued；failed Task 的 downstream 依赖不满足 → 永不 ready → 现有 blocked-graph 检测 → needs_human（P9 实测：A/C durable + 信封完整，B failed attempt=2，D 零 attempt 零认领，Job needs_human）；
- gate / 重鉴权失败：只写 Step failed，coordinator 统一 Run needs_human（事件 title 与单步语义一致）；
- 未预期异常：防御性 needs_human；Step 若遗留 running 由下轮 stale 回收；
- 无 fallback worker / 无 dynamic replan（2B-3 边界）。

## 11. Kill-Switch（§22）与 Cancellation（§23）

- `WORKFORCE_RUNTIME_ENABLED=0`：processor claim/queue 双 gate 保持（#80）；executor 轮次新增即时检查——开关关闭后本轮 **NO DAG 推进 / NO batch selection / NO Step claim / NO Handoff 生成**（mid-slice 翻转即时生效，实测零认领零信封）；恢复后原状续跑；
- cancelled Job：不可被 claim（lease 条件）；executor 轮次开始即短路（不认领不执行，实测）；已在飞 Task 的迟到结果 durable 落 Step（安全收敛），coordinator 终态保护禁止覆盖 cancelled；未实现复杂 mid-request abort（任务书明示不做）。

## 12. Observability（§24）

最小内部事件（复用 AgentRunEvent，无新表，全部 `visibleToUser=false`）：

| 事件 | 载荷 | 时机 |
|---|---|---|
| `task.claimed` | stepKey / policy / attempt / operationKey | 每次 CAS 认领成功 |
| `parallel.batch_started` | stepKeys / maxParallelTasks | 批规模 ≥2 |
| `parallel.batch_completed` | stepKeys / outcomes | 批规模 ≥2 且未失 fence |

用户层继续由 #84 Read Model 投影（回归全绿，内部事件默认不可见）。

## 13. 并行上限与生产默认（§11/§37）

```text
WORKFORCE_JOB_MAX_PARALLEL_TASKS：default 1 / min 1 / hard max 4
DEFAULT_PRODUCTION_PARALLELISM = 1
```

本 PR 不改任何生产环境变量；production 默认串行（batch 恒 [队首]，调度语义与 2B-1 一致，仅新增 CAS 认领这一安全强化）。并行度 2/3/4 仅在测试内显式设置。legacy `AGENT_RUNTIME_V2_PARALLELISM` 与 workforce 路径解耦（仅作用于 legacy 单步路径的 slice 截断，行为不变）。

## 14. 文件清单

新增：
```text
src/lib/workforce-runtime/parallel.ts                       policy classifier + batch builder + limit
src/lib/workforce-runtime/__tests__/parallel-probe.ts       测试探针（Prisma delegate 插桩，生产零 test seam）
src/lib/workforce-runtime/__tests__/phase2b2-parallel-policy.test.ts
src/lib/workforce-runtime/__tests__/phase2b2-parallel-execution.test.ts
src/lib/workforce-runtime/__tests__/phase2b2-parallel-claims.test.ts
docs/QINGYAN_WORKFORCE_PHASE2B2_IMPLEMENTATION_REPORT.md
```

修改：
```text
src/lib/agent-runtime-v2/executor.ts      workforce batch 调度（CAS/allSettled/coordinator）；legacy 路径剥离 workforce 块（行为零变化）
src/lib/agent-runtime-v2/schemas.ts       PlanStep.resources 提议字段；ToolDescriptor.parallelSafe
src/lib/agent-runtime-v2/tool-catalog.ts  9 个 read/analysis 工具显式 parallelSafe
src/lib/workforce-runtime/task-contract.ts  workforce-task/v1 可选 resources + server 消毒
src/lib/workforce-runtime/index.ts        导出
src/lib/agent-runtime/run.ts              appendAgentRunEvent 并发 sequence 有界重试
src/lib/agent-runtime/types.ts            3 个 2B-2 内部 eventType
scripts/test-all.sh                       挂载 2B-2 三个套件
```

未触碰：processor.ts / persist.ts / handoff.ts / workers.ts / resume.ts / 两个 Production Guard / PendingAction core / RBAC core / Tender EFG / AgentTask。

## 15. 测试（隔离 Neon 分支 `preview-phase2b2-*`，`assertSafeTestDatabase` + `NODE_ENV=test` + `DATABASE_ENVIRONMENT=isolated`，跑完即删）

并发观测方法：测试探针在 **Prisma delegate 层** monkey-patch `findMany`（按 orgId 过滤 + 按 (model, take) 匹配注入 barrier / sleep / gate / fail），interval 扫描线计算真实并发峰值——生产代码零 test seam，满足 §25"必须用 barrier / controlled promise 证明"。

2B-2 新增（同一隔离分支连续两轮结果一致）：

| 套件 | 结果 |
|---|---|
| phase2b2-parallel-policy（分类矩阵 / fail-safe / 资源消毒 fail-closed / 上限 clamp / 批组装 §14 全分支） | 39/39 PASS |
| phase2b2-parallel-execution（P1 barrier 实测 maxConcurrency≥3；P2 bound=2 never 3；P3 SEQUENTIAL 零重叠；P4 同资源串行/异资源并行；P8 gate 协议强制完成序 C→A→B、消费序恒 A,B,C；P9 sibling 隔离） | 36/36 PASS（初版 33 断言两轮绿；P8 协议化 +3 断言后单跑与全量均绿） |
| phase2b2-parallel-claims（P5 审批独占+真实 PendingAction+awaiting 后零新批；P6 double driver exactly-one、side effect=1；P7 stale lease 零 stale 写入；§22 kill-switch；§23 cancellation） | 25/25 PASS ×2 |

P10/P11 回归（同一隔离分支，`scripts/test-all.sh` 全量）：

| 范围 | 结果 |
|---|---|
| 2B-1 三套件（H1–H5 / Task Worker Handoff / Multi-upstream / Synthesis / Unknown worker / Auth forgery / Unknown version / Approval handoff / Reject downstream block） | 60+42+19 全 PASS |
| 2A A–L（Job Identity 26 / Lease 16 / Timeout 7 / Approval Resume 13 / Stale Worker 31 / Normal Slices 10）+ Kill-Switch 16 + Test Isolation 契约 8 | 全 PASS |
| 2C-1（Pause/Resume M/N/R 26 + Expiry Races 7） | 全 PASS |
| Runtime V2 Golden Flow 14 / Planner 17 / Durable State 11 / Verifier-Security 15 / Preview Gate P0 30 / Read Model（#84）74+31+13 | 全 PASS |
| Production DB Test Guard 22 / Production Operation Guard 30 | 全 PASS |
| test-all 汇总 | **195/195 通过, 0 失败**（最终记录轮） |
| tsc --noEmit / eslint（改动文件）/ next build（本地 + CI `validate-lint-typecheck-test-build`） | 全 PASS |

全量运行记录（透明起见）：首轮全量中曾出现两类非回归失败并已归位——
(1) P8 顺序断言原以 sleep 梯度控制完成序，在全量负载下被 grader 内部路径差异打穿（1 断言），已改为 **gate 显式顺序协议**（完成序由协议强制，与负载/实现路径无关）并把 overlap 注入余量统一加宽到 500ms；修复后单跑与全量均绿。
(2) 10 个非 workforce 套件（Agent Trace / Governance Hygiene / Phase3A-2/3/4/5）失败：6 个因运行环境只显式传了 `DATABASE_URL` 而 Prisma 从主 repo `.env` 自动补齐了指向生产 direct endpoint 的 `DIRECT_URL` → `assertSafeTestDatabase` **按设计 fail-closed BLOCK**（补传 `DIRECT_URL=<隔离分支>` 后全绿）；4 个因隔离分支缺双租户种子数据（`sunny-home-deco`/`mengxin-home-textile`，用基线 main 代码在同一分支复现同样失败，证明与本 diff 无关），`prisma db push`（仅隔离分支）+ 官方幂等 seed 后 28+29+28+23 全 PASS。最终记录轮 195/195。

测试基建：复用 #86 fixture ownership / isolated org / cleanup / repeatable batch（两个新 DB 套件尾部执行 `cleanupWorkforceFixture` + `assertNoLeakedWorkforceJobs` 零泄漏断言，二轮重复运行验证）。

## 16. 已知边界（非缺陷，记录语义）

- `maxToolCalls` 预算检查在批认领前进行：一批 N 个认领可短暂越过预算至 +N-1（N≤4，总量仍被 run attempts 与 step maxAttempts 约束）；
- 批内 Task 失败当轮不阻断 sibling（§21 要求），Run 级收敛推迟到 coordinator——与单步语义的差异仅在同批窗口内（≤1 轮）；
- EXCLUSIVE_RESOURCE 队首会推迟整轮选择（不跳队首抢跑后位任务）——保守防饥饿策略，占用只来自 awaiting（会 park Run）与 stale running（会被回收），实际不可长期滞留。
