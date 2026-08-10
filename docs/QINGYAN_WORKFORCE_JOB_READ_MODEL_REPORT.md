# Qingyan Workforce — Job Read Model Foundation 交付报告（Lane D / P1-P2）

- 日期：2026-08-10
- 分支：`feature/workforce-job-read-model`（基于 verified main `97ac959`）
- 性质：**只读观测层**。NO UI / NO mutation / NO Runtime execution change。
- 上游依据（冻结，未做新研究）：
  - `docs/QINGYAN_WORKFORCE_OBSERVABILITY_JOB_TIMELINE_DESIGN.md`（§4 JobStatusProjection、§5 状态映射、§6 Progress、§7 CurrentTask、§9 NeedsYou、§3/§23 事件分层）
  - `docs/QINGYAN_WORKFORCE_PHASE2B_HANDOFF_PARALLEL_DESIGN.md`（worker/taskKind 可选契约、并行前向兼容）
  - `docs/QINGYAN_WORKFORCE_PHASE2C_CHECKPOINT_HUMAN_RESUME_DESIGN.md`（humanRequirement 词汇、resume 事件）

一句话：把 `AgentRun / AgentRunStep / AgentRunEvent / PendingAction` 投影成产品层可稳定消费的 `WorkforceJobViewModel`——**derived projection，不是新事实源**。`SCHEMA_CHANGE = NONE`，`RUNTIME_CORE_MODIFIED = NO`。

---

## 1. 交付物

| 文件 | 内容 |
|---|---|
| `src/lib/workforce-runtime/read-model/types.ts` | 契约类型（WorkforceJobViewModel / NeedsYouView / TaskView / TimelineItem / Progress / 快照输入类型） |
| `src/lib/workforce-runtime/read-model/projection.ts` | 纯投影函数（零 I/O）：`projectJobStatus` / `projectProgress` / `projectCurrentTasks` / `projectTaskView` / `projectNeedsYou` / `projectTimeline` / `projectInternalTimeline` / `projectBusinessRefs` / `sortStepsByPlanOrder` / `buildWorkforceJobViewModel` |
| `src/lib/workforce-runtime/read-model/service.ts` | `getWorkforceJobView({orgId, jobId, includeInternal?}, reader?)`——只读 Reader 契约（类型层面仅 findFirst/findMany）+ 懒加载 db |
| `src/lib/workforce-runtime/read-model/index.ts` | 公共出口 |
| `src/app/api/workforce/jobs/[id]/route.ts` | `GET /api/workforce/jobs/:id`（withAuth + 活跃 org membership → 404 不区分越权/不存在） |
| `__tests__/projection-golden.test.ts` | O1–O9 黄金场景 + 泄漏防线 + legacy/2B 兼容（70 断言，零 DB） |
| `__tests__/service-read-only.test.ts` | 租户隔离 + READ_ONLY（spy + 源码审计）+ orgId 强制（27 断言，零 DB） |
| `scripts/test-all.sh` / `scripts/test-ci-unit.sh` | 注册两个测试（纯投影零 DB，CI 子集可跑） |

## 2. Source-of-truth 字段（全部现有列/JSON 键，零迁移）

| 视图字段 | 事实源 |
|---|---|
| jobId | `AgentRun.id`（= rootRunId = metadata.jobId，2A 冻结等式） |
| status | `AgentRun.status` + `attempts` + `errorCode` + `planJson` + steps 存在性（queued 三分）+ `completedAt/cancelledAt`（未知状态 fail-safe） |
| title | `planJson.objective` 优先，否则 `metadata.goal` 截断 ~80 字符 |
| progress | `AgentRunStep.status` 计数（deterministic，非 LLM） |
| tasks / currentTasks | `AgentRunStep`（stepKey/title/status/startedAt/completedAt + `inputJson.worker.id`→workerKey、`inputJson.taskKind`→taskKind，均可选） |
| needsYou | 最新可见 `job.waiting_human` 事件 payload.humanRequirement + `PendingAction`（pending/rejected 集合）+ `AgentRun.errorCode` |
| timeline | `AgentRunEvent`（visibleToUser ∩ 类别白名单，sequence ASC） |
| businessRefs | `AgentRun.metadata`（workspaceId/projectId/customerId/vendorId→supplier/tenderId/orderId），零 JOIN |
| createdAt/startedAt/completedAt/lastActivityAt | `AgentRun` 时间列（updatedAt = lastActivityAt） |

## 3. Status mapping（设计 §5 完整落地）

| internal `AgentRun.status` | user status |
|---|---|
| `queued`（无 plan、无 steps、无失败记录 = 从未开始）/ `acknowledged`(v1) | QUEUED |
| `queued`（retry 回队：attempts>0 ∧ errorCode≠null） | WORKING（重试对用户静默） |
| `queued`（continuation 回队：planJson≠null ∨ 已有 steps） | WORKING（slice 间隙不是"排队"） |
| `planning` / `planned` / `executing` / `verifying` / `repairing` / `running`(v1) | WORKING |
| `awaiting_approval` / `needs_human` | NEEDS_YOU |
| `completed` | COMPLETED |
| `partially_executed` | PARTIAL |
| `failed` | FAILED |
| `cancelled` | CANCELLED |
| 未知（前向）| fail-safe：cancelledAt→CANCELLED；completedAt→FAILED（不谎报完成）；否则 WORKING |

## 4. Progress mapping（deterministic 计数，永不 LLM 报数）

- `totalTasks` = 全部 steps
- `completedTasks` = status ∈ {completed, **skipped**, partially_executed}（设计 §6：skipped 计入分子，黄金场景 s8 实证；分子单调不减）
- `activeTasks` = {running, awaiting_approval}
- `blockedTasks` = {blocked, failed}（阻塞下游/待人处理）
- percent 由消费方从计数推导；planning 期 0/0 由 UI 层解释（"正在拆解任务"属 2D 文案层）

## 5. Needs You mapping（结构化优先级，零自由文本解析）

优先级：① 最新 user-visible `job.waiting_human` 事件 `payload.humanRequirement.type` → ② `run.errorCode` 字典 → ③ open PendingAction 存在 → APPROVAL_REQUIRED → ④ `status=awaiting_approval` 状态兜底 → ⑤ fail-safe `UNKNOWN_HUMAN_INTERVENTION`（未知也显示，绝不静默）。

| 信号 | type |
|---|---|
| humanRequirement.type ∈ 已知集（runtime 实际写入词汇） | APPROVAL_REQUIRED / APPROVAL_REJECTED / PERMISSION_CHANGED / CLARIFICATION_REQUIRED / CONFLICT_REQUIRES_HUMAN |
| errorCode `clarification_required` | CLARIFICATION_REQUIRED（detail = 问题原文，errorMessage 即 planner clarification） |
| errorCode `approval_rejected` | APPROVAL_REJECTED |
| errorCode `approval_expired` | APPROVAL_REQUIRED（detail = 过期语义文案） |
| errorCode principal 失效码（INITIATOR_MISSING/USER_INACTIVE/NO_MEMBERSHIP/MEMBERSHIP_INACTIVE）+ 鉴权类（org_forbidden/pending_forbidden/user_unbound） | PERMISSION_CHANGED（内部码不透出 detail） |
| 未知 humanRequirement.type / 无任何信号 | UNKNOWN_HUMAN_INTERVENTION |

- title = 确定性字典；detail 只来自结构化字段（clarification 原文 / PendingAction.title / 过期文案）；`errorMessage` 堆栈类内容永不透出（O7 断言）。
- pendingActionIds：审批类 = pending 集合；拒绝类 = rejected 集合；事件 refs.pendingActionIds 并入去重。

## 6. Timeline filtering（双重闸门）

`visibleToUser=true` **∩** 事件类别白名单（设计 §23 冻结映射），`sequence ASC` 排序（不依赖 createdAt，同毫秒/乱序输入 deterministic）。**读侧不信任存量列值**——V2 executor 事件默认全 true 是已知缺陷（设计 §2.1），`tool.*`/`step.started` 即使列值可见也被白名单 fail-closed 排除。条目**不携带原始 payload**，只透出白名单派生字段（NEEDS_YOU 条目附 needsYouType）。

类别映射：job.created/job.queued(初次)/plan.created→JOB_STARTED；step.completed/verification.passed/job.progress△/job.retrying△→PROGRESS；job.waiting_human/approval.required/verification.needs_human/run.needs_human→NEEDS_YOU；job.resumed/approval.resolved/job.clarification_answered△/job.human_action_completed△/job.human_edited△→RESUMED；job.replanned△→REPLANNED；job.completed 按 payload.status 分流 COMPLETED/PARTIAL；job.failed→FAILED；run.cancelled/job.cancelled△→CANCELLED（△=设计已立项的前向事件，writer 落地即自动进入）。

排除（fail-closed）：job.claimed / job.lease_renewed / job.queued(retry/continuation) / job.resume_blocked / tool.* / step.started/ready / verification.started / repair.* / supervisor.* / grader.* / context.* / background.* / 一切未知 eventType。

Internal/Admin：同一服务 `includeInternal=true` 附 `internalTimeline`（全量事件原样）；默认 false；**本阶段 API 不透出该开关**（2D Admin 面再接 RBAC）。

## 7. Tenant isolation

- 服务层：`orgId + runId + runType=workforce_job` 三条件 `findFirst`；steps/events/pendingActions 三条查询同样强制 `orgId`；空 orgId fail-closed。
- 越权 / 不存在 / 非 workforce run 统一 `NOT_FOUND`，不区分（防枚举）。
- API 层：withAuth（登录 + active）→ 活跃 org membership 解析（`getUserActiveOrgId` + membership fallback，与 agent-supervisor 路由同模式）→ 404。
- 测试：Org B 读 Org A Job → NOT_FOUND；spy 断言 4 条查询全部 `where.orgId = 调用方 orgId`。

## 8. Phase 2B compatibility

- `workerKey` / `taskKind`：来自 `inputJson.worker.id` / `inputJson.taskKind`（2B-1 的 Option A 承载点），**当前恒 undefined**——契约先行，Lane D 不阻塞 Lane A，2B-1 合并后字段自动出现（O9 synthetic 已验证透出路径）。
- Worker 投影边界：只透出执行身份标识 workerKey；displayName 解析留给消费层（避免 read-model 依赖 supervisor registry 的技能种子）；权限/scope/authorized/allowedSkills 语义**结构性排除**（测试断言即使被塞进 inputJson 也零出现）。
- `currentTasks` 从现在起就是数组（0/1/N）：2B-2 并行落地无需 breaking change（O9 双 running 断言）。
- Legacy（2A 早期 / 无 humanRequirement / 无 planJson / 无事件）：fail-safe 全覆盖（UNKNOWN_HUMAN_INTERVENTION / 状态兜底 APPROVAL_REQUIRED / createdAt 排序兜底）。

## 9. Schema decision

```text
SCHEMA_CHANGE = NONE
```

无新表、无新列、无索引变更、无 enum。投影每请求从五个现有模型推导（1×AgentRun + 1×steps + 1×events + 1×PendingAction，均走现有索引 `[orgId, runId]` / `[runId, status]` / `[runId, sequence]` 语义）。设计 §25 已论证物化/快照表在当前量级（org 内活跃 Job 数十）不成立。

## 10. API decision

交付最小只读端点 `GET /api/workforce/jobs/:id`：复用现有 `withAuth` + org membership 栈，不扩大 scope（与 `/api/agent-supervisor/runs/:id` 同鉴权模式）。列表页 `GET /api/workforce/jobs`、timeline 分页、needs-you 聚合端点按设计 §24 留待 2D（OBS-3），contract 已就绪。`includeInternal` 服务层已支持但 API 不透出（Admin RBAC 面属 2D）。

## 11. Runtime core 边界（硬约束遵守证明）

- 未修改：`workforce-runtime/processor.ts` / `agent-runtime-v2/executor.ts` / `agent-runtime-v2/persist.ts` / `workforce-runtime/resume.ts`（git diff 零触碰）。
- read-model 不 import 执行内核（源码审计断言：processor/executor/persist/resume/appendAgentRunEvent 零引用）。
- 零写入：Reader 契约类型只有 findFirst/findMany；spy 证明 + 源码审计（`.create(/.update(/.delete(/.upsert(/$executeRaw/$transaction` 全目录零出现）。
- Read Model 不依赖任何 Runtime 修改即可工作 → 无 BLOCKED_BY_RUNTIME_CONTRACT。

## 12. 验证

| 项 | 结果 |
|---|---|
| O1–O9 黄金投影（含泄漏/兼容共 70 断言） | PASS |
| 服务层隔离/只读（27 断言） | PASS |
| `npx tsc --noEmit` | PASS |
| `eslint`（baseline 口径） | PASS |
| `next build` | PASS |
| CI 子集注册（test-ci-unit.sh，零 DB 可跑） | PASS |

---

*本报告对应 Lane D / P1-P2 交付。Phase 2D（Job Center UI / 列表 API / needs-you 聚合 / proactive 推送 / Admin internal view RBAC）不在本轮范围。*
