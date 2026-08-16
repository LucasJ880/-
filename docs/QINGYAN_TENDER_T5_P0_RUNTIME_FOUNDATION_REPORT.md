# 青砚 Tender T5-P0 — Runtime Contract Foundation 报告

日期：2026-08-14 ｜ 基线 main @ `399a769` ｜ 分支 `feature/tender-t5-p0-deterministic-runtime` ｜ **SCHEMA_CHANGE = NONE**

本轮以当前 main 重新实证审计，未照抄预检旧结论。三项与预检不同的更正记在 §5。

## 1. Plan seam（P0A）

**问题**：`createWorkforceJob` 只接 `goal: string`（`job.ts:35`），`extraMetadata` 被
`sanitizeExtraMetadata` 限制为 ≤16 键标量 —— DAG 无法通过。唯一计划生产者是
`processor.ts:278` 的 `if (!run.planJson)` → `planAgentRuntimeV2`。

**改动**：
| 文件 | 作用 |
|---|---|
| `workforce-runtime/server-plan.ts` | `workforce-plan/v1` 契约；`validateWorkforcePlanGraph()`（重复 id / 自依赖 / 依赖闭包 / 前向引用 / DFS 环） |
| `workforce-runtime/plan-compile.ts` | **唯一验证链**：`sanitizePlannerOutput` → 图校验 → `applyWorkforceTaskSpecs` |
| `workforce-runtime/job.ts` | `plan?: ServerAuthoredPlanV1`；先校验后建 run；入队前落库；provenance 元数据 |
| `workforce-runtime/processor.ts` | LLM 路径改用同一 `compileWorkforcePlan`，并标记 `planSource=LLM_PLANNER` |

**§4 单一验证路径**：不存在 `validateLLMPlan()` / `validateServerPlan()` 两套标准 ——
两条路径都只能调用 `compileWorkforcePlan`。

**本轮为该链补齐的能力**：审计确认既有链路**完全没有**依赖闭包/环检测
（`applyWorkforceTaskSpecs` 不做；`PlanStepSchema.dependsOn` 只是 `string[]`）。
悬空依赖或环今天只在 `executor.ts` 表现为 `blocked_graph` 卡死并烧掉 lease 与重试预算。
现在落库前拒绝，**LLM 路径同样受益**。

**§6 原子性 / 孤儿 run**：`createWorkforceJob` 无事务（审计确认：每步独立写）。
采用的解法不是硬塞事务，而是**改变时序**：
1. 计划校验是纯函数 → 放在**任何 DB 写之前**，非法计划零副作用返回 `DETERMINISTIC_PLAN_INVALID:*`
2. 计划持久化放在 `status=queued` **之前** → 不存在"已入队但无计划"的可执行窗口
3. 持久化失败 → run 直接置终态 `failed` + `errorCode=deterministic_plan_persist_failed`，绝不 PENDING forever

**§5 planSource（无新增 DB 列）**：写入既有 `AgentRun.metadata`：
`planSource` / `planContractVersion` / `taskContractVersion` / `planTaskCount` / `plannerLlmCalls`，
且五个键全部加入 `RESERVED_METADATA_KEYS` —— 调用方无法经 `extraMetadata` 伪造
`SERVER_AUTHORED`（`sanitizeExtraMetadata` 命中保留键即整体拒绝）。
`plan` 字段本身不在任何请求体解析路径上，只能由受信服务端代码构造。

**§7 processor 行为**：server 计划预置后 `if (!run.planJson)` 恒 false → planner 零调用。
worker 的领域 LLM 调用**照常**（deterministic 指编排确定，不是整个 Tender 不调模型）。

## 2. Task contract 版本纪律（P0B）

**问题**（预检记为 PARTIAL，本轮复核属实）：`resources` 是并行安全冲突检测的关键字段，
被追加进 `workforce-task/v1` 却未 bump 版本 → 旧 reader 的 `.strip()` 静默丢弃它。

**改动**：
- 新增 `WORKFORCE_TASK_CONTRACT_WRITE_VERSION = "workforce-task/v1.1"`，**writer 只写新版**
- `contractVersion` 从 `z.literal(v1)` 改为登记制 `z.enum([v1, v1.1])` —— 未登记版本 fail-closed
- reader 把 legacy v1 的缺省 `resources` 归一为 `[]`，下游并行判定无需再区分版本
- 库中既有 v1 envelope 与 legacy AgentRun 恢复不受影响

选择 v1.1 而非 v2 的理由：这是**向后兼容的字段语义澄清**，不是破坏性重构；
v1 记录仍可被完整读取并正确参与冲突判定。若未来出现不兼容变更再上 v2。

## 3. 真实 domain / policy 输入（P0C 前半）

**问题**（executor 两处 `canInvokeTool`，`:425` 与 `:1051`）：
`domain: "sales"` 字面量、`allowRoles` 硬编码、`modulesJson: undefined`、`toolPolicy` 缺失
→ org / workspace / module 三层策略**完全失活**。

**改动** `workforce-runtime/execution-policy.ts`：
- `workDomain` 取自 `AgentRun.metadata`（canonical = `Project.workDomain` 的投影，建 run 时由 server 写入）
- **显式映射** `ProjectWorkDomain → ToolDomain`：`tender|delivery → project`、`sales → sales`、其余 → `system`
  —— 两套词表不同（`tool-auth.ts:63-71` 没有 `tender` 键），透传会落到 `?? ["operations"]`
- `modulesJson` / `toolPolicy` / `workspaceIds` 复用既有 `resolveAgentTenant`（一次查询拿全，不新写 SQL）
- **freshness 策略**：同 run TTL 缓存 60s，避免每次 tool call 重复昂贵查询；resume 路径强制 `forceRefresh`
- 解析失败 → `policy_context_unavailable` fail-closed，绝不"无策略放行"

**顺带修复的风险降级**：tender 的 7 个工具不在 `RUNTIME_V2_TOOL_CATALOG` 中 →
`getRuntimeV2Tool()` 恒返回 `undefined` → 风险静默降为 `l0_read`。
改为：descriptor 缺失时按 `l1_internal_write` 处理，由 policy 层决定放行。

## 4. Resume 三道 freshness 门（P0C 后半）

**§12 TOCTOU**：审批时允许 ≠ 恢复执行时仍允许。三门插在 `resume.ts` 既有 §6–8 挂载点
（步骤 5 与 10 之间），在**真正恢复执行之前**重查：

| 门 | 检查 | 失败码 |
|---|---|---|
| A actor | membership 仍存在且 active；未被降级为 `org_viewer` | `ACTOR_STALE` |
| B scope | project 仍存在、仍属同 org、`workDomain` 未漂移 | `SCOPE_STALE` |
| C policy | **强制重取**策略（绝不复用 TTL 快照——那正是本门要防的） | `POLICY_STALE` |

park 复用既有 CAS + 双事件形状；`blockedBy` 从单一 `"principal"` 扩为四态。
三门与既有 `approval_rejected`（人工拒绝）/ `approval_expired`（超时）**保持正交** ——
过期 ≠ 拒绝 ≠ 陈旧，绝不折叠成同一状态。

**§13 未扩大产品行为**：没有为了"测试审批"把 tender 工具改成 `requiresApproval: true`。
read/analyze/extract/risk/synthesis 仍无审批；真正产生外部副作用的动作（send/submit/publish/
memory activation）才需要强审批，留待后续。

## 5. 与预检文档的三处更正

1. `T4_DATA_READY`：PARTIAL → **PASS**（T4 已于 2026-08-14 生产激活并通过烟测）
2. `DETERMINISTIC_PLAN_INJECTION`：BLOCKED → **本轮实现**（seam 已落地，见 §1）
3. 预检未记录的缺陷：**tender 工具风险等级静默降级**（§3 末段）

## 6. 验证

| 项 | 结果 |
|---|---|
| `tsc --noEmit` | 0 |
| `phase2b1-contracts` | 60/60 |
| `phase2b2-parallel-policy` | 43/43 |
| `t1b-pure` | 34/34 |
| `t5-plan-seam`（新增 36 断言） | 36/36 |

两处既有断言按新契约语义更新（writer 版本、`resources` 归一），非放宽标准。

## 7. 不变量确认

`SECOND_RUNTIME_CREATED = NO`（未新建 queue/scheduler/executor/approval engine）
`LEGACY_QUEUE_RETIRED = NO`（`tender-auto-analysis` 表/cron/worker/lease/reaper 全部保留）
`AUTO_MEMORY_WRITE = NO` ｜ `AWARD_WATCH_STARTED = NO` ｜ 生产 DB/env/deploy 零改动
