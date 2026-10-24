# 青砚 Autopilot A2-P2.4 — Exception Routing + Validation Closure

日期：2026-08-25  
状态：**DESIGN GATE — READY_FOR_DESIGN_FINAL_REVIEW_2**。本文件是实现前冻结规格，不是实现报告。  
实现 = NOT_STARTED · Runtime wiring = NO · Production = OFF · Prisma/migration = NO

A2-P0 = CLOSED · A2-P1 = CLOSED · A2-P2.0 = CLOSED · A2-P2.1 = CLOSED · A2-P2.2 = CLOSED  
**A2-P2.3 = CLOSED** · **A2-P2.4 = READY_FOR_DESIGN_FINAL_REVIEW_2** · A3 = NOT_STARTED

基线：`origin/main` = `a131f7e774556c3f90c4cc47c7e36a30b5eb3791`  
（受控合入 latest main：B0/B1/B2、Approval CAS、PendingAction 基础设施。**不授权** P2.4 使用那些 runtime 系统。）

Design Review blockers：

```
P24_B1_CANONICAL_ROUTE_INPUT_BINDING = CLOSED
P24_B2_VALID_ESCALATION_ENVELOPE_TOTALITY = CLOSED
P24_B3_EXCEPTION_ID_AUTHORITY_VERSION_BINDING = CLOSED
P24_B4_SAFE_EVIDENCE_MINIMIZATION = CLOSED
```

权威函数 / 类型（沿用已合入代码，不得另造同义词）：

- `parseTaskContract()`
- `routeEvaluation()`
- `buildEvidencePacket()`
- `toEvaluationEvidenceStatus()`
- `runSemanticJudge()` / `toP2EvaluationState()`
- `runAutoRecoveryLoop()`
- `SemanticEvidencePacketV1`
- `EvaluationRouteDecision` / `EvaluationRouteReasonCode`
- `HARD_HUMAN_RISK_CLASSES = HIGH · RESTRICTED`
- `EvaluationEvidenceStatus` / `EvaluationRecoveryStatus`
- `EvaluationVerdictState` / `EvaluationOutcomeHint`

本阶段建议（实现批准后才创建）的纯函数名：

- `buildExceptionEnvelope()` — 唯一 envelope 构造入口
- `A2P2ExceptionEnvelopeV1` — 唯一人工升级信封类型

不得使用 R1 冻结 basename token：`plan` / `planner` / `orchestrator` / `engine` / `executor` / `processor` / `scheduler` / `queue` / `worker`（作为新文件名）。

---

## 0. Gate 目的

P2.0 已经能把高风险、法律/财务/外发、不可逆、冲突耗尽、L0 等路由成 `HUMAN_ESCALATE`。  
P2.1–P2.3 已经能建包、裁决、有界恢复。  
当前缺口不是「再写一个 Judge / Router / Approval」，而是：

> A. 把**已经由 P2.0 裁定**的 `HUMAN_ESCALATE` 物化成一份安全、有界、可审计、无 raw 数据的 `A2P2ExceptionEnvelopeV1`。  
> B. 用纯测试矩阵证明 A2 全链不能制造假成功、假 finalize、隐私泄漏、路由权威分裂、无界恢复、高风险自动动作、启发式人工升级。

本 Design Gate 冻结这个问题的边界。Lucas 审查通过前 **不得写实现代码**。

---

## 1. 问题陈述

| 已有能力 | 缺口 |
|---|---|
| P2.0 `routeEvaluation()` 决定 `HUMAN_ESCALATE` + `reasonCode` | 没有安全信封把该终态交给后续人类工作流 |
| P2.1 `buildEvidencePacket()` 已红acted / 拒绝 raw | 升级材料可能被错误地塞回 raw Tender / prompt / tool payload |
| P2.2 `runSemanticJudge()` 产出 `verdictState` + `outcome` | 不可把 Judge 失败或 UNKNOWN 偷偷变成人工 |
| P2.3 `runAutoRecoveryLoop()` 有界恢复并以 P2.0 为终态权威 | 不可把 adapter 错误、畸形 delta、未支持域变成任务失败或自动人工 |
| R1：Autopilot = evaluation / evidence / judge / recovery-policy | 不可把 P2.4 做成 runtime / planner / executor / Approval |

不解决这个缺口，Human by Exception 会停在「路由说了 HUMAN_ESCALATE」而没有可审计信封。  
错误地扩大缺口（P2.4 自己升级、自己改证据、写 PendingAction、发通知、开表）会破坏 P2.0–P2.3 与 R1。

---

## 2. 本阶段回答 / 不回答

P2.4 **回答**：

- 何时允许物化 exception？仅当**规范** `routeEvaluation()` 在同一快照上返回 `HUMAN_ESCALATE`。route-shaped 对象不够。
- `A2P2ExceptionEnvelopeV1` 的冻结字段、隐私边界、确定性 identity。
- A2 终态如何对应「零或一份 envelope」。
- A2 闭合验证矩阵与验收不变量。
- 未来纯测试 harness 可以调用哪些已有纯组件。

P2.4 **不回答**：

- 这次任务语义上是否正确（P2.2）
- 证据是否充足（P2.1）
- 该不该恢复、恢复什么（P2.0 + P2.3）
- 人类点 APPROVE / REJECT / EDIT / RETRY / RESUME 之后怎么走
- Production 何时打开 Capture / Processor / LLM Judge
- 人工评审队列、通知、任务指派、审批引擎
- A3 失败诊断

---

## 3. 权威模型（沿用，不得改写）

1. **P2.0 `routeEvaluation()` 是唯一路由权威，也是唯一终态路由权威。**  
   `P2_4_ROUTE_AUTHORITY = NO` · `P2_4_ROUTE_LOGIC = ZERO` · `P2_4_CANONICAL_ROUTE_VERIFICATION = P2_0_ROUTE_EVALUATION_ONLY`。  
   形状像 route 的对象 **不是** 权威。P2.4 必须用同一快照重建 `EvaluationRouteInput` 并**现调**既有 `routeEvaluation()`。不得抄写或重实现路由规则。
2. **P2.4 不是 Judge。** 不得调用、重跑或覆盖 `runSemanticJudge()`。不得把 provider 不可用 / 畸形提案解释成任务失败或人工升级。
3. **P2.4 不是 Router。** 不得把 `AUTO_ABSTAIN` / `AUTO_RECOVER` / `POLICY_BLOCKED` / `AUTO_FINALIZE` / `AUTO_WAIT` 转成 `HUMAN_ESCALATE`。
4. **P2.4 不是 Approval 系统。** 即使 latest main 已有 PendingAction / Approval CAS / `src/lib/approval/port.ts` / `src/lib/pending-actions/executor.ts`，P2.4 **不得** import、调用、创建或持久化它们，也不得发通知或写 AuditLog。
5. **证据权威仍是 P2.1。** 不得创建/改写 `EvidenceFact`、`EvidenceRef`、`packetHash`、requirement assessment、`packet.status`。
6. **恢复权威仍是 P2.3。** 不得重跑 recovery、扩白名单、把 adapter 错误写成任务失败。
7. **HIGH / RESTRICTED 硬人工底线仍是 P2.0 B9。** 合同 / Judge / Recovery / P2.4 都不得降级。
8. **`UNKNOWN != HUMAN_REQUIRED`。** P2.4 不得因为「看起来不确定」就升级。
9. **A2 不得创建 A3 诊断。** `failureType` 继续保持由既有阶段给出的 `null`；P2.4 不发明 failure taxonomy。
10. **Autopilot 仍是 evaluation / evidence / judge / recovery-policy 层。** 不得 import 执行引擎。

沿用句式：

**P2.4 NEVER ROUTES. IT CALLS EXISTING routeEvaluation() ON ONE BOUND SNAPSHOT. A ROUTE-SHAPED OBJECT IS NOT AUTHORITY. VALID HUMAN_ESCALATE ALWAYS YIELDS EXACTLY ONE BOUNDED ENVELOPE. IT NEVER JUDGES. IT NEVER RECOVERS. IT NEVER APPROVES. IT NEVER TOUCHES PendingAction / Approval CAS.**

---

## 4. 范围

### 4.1 域

V1 验证矩阵以已实现的 A2 链为准，默认域仍是 `TENDER_ANALYSIS`（P2.3 V1 唯一可恢复域）。  
其他域若 P2.0 已路由 `HUMAN_ESCALATE`，P2.4 仍只物化信封，不补做该域 recovery。

### 4.2 允许

| 项 | 说明 |
|---|---|
| 纯函数 `buildExceptionEnvelope()` | 输入同一快照的合同/包/evaluation/recovery/budget/policySignals；内部现调 `routeEvaluation()` |
| `A2P2ExceptionEnvelopeV1` | 内存结构；确定性 `exceptionId`；展示集合有界投影 |
| 纯测试 harness | 调用现有 `parseTaskContract` / `buildEvidencePacket` / 注入式 Judge / `runAutoRecoveryLoop` / `routeEvaluation` / `buildExceptionEnvelope` |
| 闭集枚举复制 | 只引用 P2.0–P2.3 已冻结枚举 |

### 4.3 禁止

| 项 | 原因 |
|---|---|
| 修改 P2.0 / P2.1 / P2.2 / P2.3 源码 | 闭合阶段不得改已关闭权威 |
| 修改 test runners | 本 Gate 文档 only |
| 第二套 risk / escalation 词表 | 必须消费 `EvaluationRouteReasonCode` |
| LLM 升级 / 启发式升级 | `MODEL_ESCALATION_AUTHORITY = NO` |
| `AUTO_*` → `HUMAN_ESCALATE` 转换 | 无 helpful escalation |
| 创建 Evidence / 改 packet | 证据权威 = P2.1 |
| 调用 `runSemanticJudge()` 作为 P2.4 权威 | Judge 权威 = P2.2；harness 可注入调用以验证闭合，不得由 envelope 代码调用 |
| Prisma / migration / 新表 / AuditLog / PendingAction / ApprovalRequest / approval port / approval executor | V1 不持久化；latest main 的 CAS 基础设施也不可用 |
| 邮件 / Slack / 企微 / 任务指派 | 后期 runtime 集成 |
| APPROVE / REJECT / EDIT / RETRY / RESUME | 人类响应生命周期另开设计 |
| Production flags | 本 Gate 不关闭激活 blocker |
| 真网络 / 真 LLM / Production DB / PDF | harness 禁止 |
| 新 planner / orchestrator / executor / worker / scheduler 文件 | R1 禁止 |

---

## 5. 路由权威与资格（Eligibility）

冻结：

```
P2_4_ROUTE_AUTHORITY = NO
P2_4_ROUTE_LOGIC = ZERO
P2_4_CANONICAL_ROUTE_VERIFICATION = P2_0_ROUTE_EVALUATION_ONLY
```

形状像 `EvaluationRouteDecision` 的对象 **不是** 权威。P2.4 不得信任调用方传入的 `decision` / `reasonCode`，也不得复制 P2.0 优先级表。

### 5.1 规范输入：同一快照 + 现调 `routeEvaluation()`

未来 `buildExceptionEnvelope` 必须接收足够的规范权威输入，以重建**恰好一份**既有 `EvaluationRouteInput`，并调用**现有** `routeEvaluation()`：

- validated contract（经 `parseTaskContract()` 的同一结果；未校验则无信封）
- packet（当前 `SemanticEvidencePacketV1`；`evidenceState.status` 由 `toEvaluationEvidenceStatus(packet.status)` 得出）
- evaluation state（`verdictState` + `outcome`，来自 `toP2EvaluationState` 或与之绑定的同一 Judge 快照）
- recovery state
- budget state
- policy signals

上述字段必须来自**同一 routing snapshot**。禁止 mix-and-match（例如合同来自快照 A、packet 来自快照 B、recovery 来自快照 C）。

未来必测：

```
MIXED_AUTHORITY_SNAPSHOTS_REJECTED = PASS
```

### 5.2 唯一资格条件

Envelope 可以存在 **当且仅当** 该次规范调用：

```
routeEvaluation(reconstructedInput).decision === "HUMAN_ESCALATE"
```

若调用方同时提供 `expectedRoute`：

要求与规范 `routeEvaluation()` 结果 **精确相等**：

- `routerVersion`
- `decision`
- `reasonCode`
- `allowedNextActions`（按既有数组顺序精确相等）

任一字段不等 → `{ ok: false, reason: "EXPECTED_ROUTE_MISMATCH", envelope: null }`。

P2.4 **不得**根据 packet / Judge / recovery 自己「推断应该人工」。  
`P2_4_ROUTE_LOGIC = ZERO`：不得在 P2.4 内重写 HIGH 底线、legal 信号、预算耗尽等规则。

### 5.3 明确禁止的转换

| 输入 decision | P2.4 行为 |
|---|---|
| `AUTO_FINALIZE` | 零 envelope；不得升级 |
| `AUTO_ABSTAIN` | 零 envelope；不得升级 |
| `POLICY_BLOCKED` | 零 envelope；不得升级（即使看起来像隐私/受限） |
| `AUTO_RECOVER` | **非终态**；属于 P2.3；P2.4 不调用 |
| `AUTO_WAIT` | 零 envelope；不得升级 |
| `HUMAN_ESCALATE` | **恰好一份** `A2P2ExceptionEnvelopeV1` |

`POLICY_BLOCKED` 即使伴随 `POLICY_BLOCKED_PRIVACY` / `POLICY_BLOCKED_L5_RESTRICTED` 也 **不是** human-review envelope。那是策略阻断，不是人工评审。

### 5.4 无 helpful / LLM / heuristic escalation

禁止：

- 因 Judge `UNKNOWN` / `SEMANTIC_UNCERTAINTY` 而升级
- 因 provider `UNAVAILABLE` 而升级
- 因畸形 Judge 输出而升级
- 因畸形 recovery delta / adapter error 而升级
- 因未支持 recovery 域而升级
- 用模型选择 `HUMAN_ESCALATE`
- 用「风险看起来高」覆盖 `LOW`/`MEDIUM` 合同

`UNKNOWN_AUTO_ESCALATION_HEURISTIC = ZERO`

---

## 6. 人类升级条件 — 只消费 P2.0

P2.4 **不**发明平行风险词表。  
既有 `EVALUATION_ESCALATION_REASONS`（合同层）**不是** P2.4 envelope 的 `routeReasonCode` 权威。

冻结闭集（仅当前 P2.0 能与 `HUMAN_ESCALATE` **实际配对**的 reason）：

```
P2_4_HUMAN_ESCALATION_REASON_CODES =
  HUMAN_ESCALATION_L0_HUMAN_CONTROLLED
  HUMAN_ESCALATION_LEGAL_COMMITMENT
  HUMAN_ESCALATION_FINANCIAL_COMMITMENT
  HUMAN_ESCALATION_EXTERNAL_SIDE_EFFECT
  HUMAN_ESCALATION_IRREVERSIBLE_ACTION
  HUMAN_ESCALATION_HIGH_RISK
  HUMAN_ESCALATION_CONTRACT_POLICY
  HUMAN_ESCALATION_GOAL_AMBIGUOUS
  HUMAN_ESCALATION_EVIDENCE_CONFLICT
  HUMAN_ESCALATION_RECOVERY_EXHAUSTED
  BUDGET_EXHAUSTED
```

| reasonCode | 谁决定（P2.0，P2.4 不推断） |
|---|---|
| `HUMAN_ESCALATION_L0_HUMAN_CONTROLLED` | automation policy L0 |
| `HUMAN_ESCALATION_LEGAL_COMMITMENT` | `policySignals.legalCommitment` |
| `HUMAN_ESCALATION_FINANCIAL_COMMITMENT` | `policySignals.financialCommitment` |
| `HUMAN_ESCALATION_EXTERNAL_SIDE_EFFECT` | `policySignals.externalSideEffect` |
| `HUMAN_ESCALATION_IRREVERSIBLE_ACTION` | `policySignals.irreversibleAction` |
| `HUMAN_ESCALATION_HIGH_RISK` | `HARD_HUMAN_RISK_CLASSES`（HIGH / RESTRICTED 走此码；P2.4 不另造 RESTRICTED 码） |
| `HUMAN_ESCALATION_CONTRACT_POLICY` | 合同把 LOW/MEDIUM 加入 `requireHumanForRisk` |
| `HUMAN_ESCALATION_GOAL_AMBIGUOUS` | 歧义且恢复不可执行 |
| `HUMAN_ESCALATION_EVIDENCE_CONFLICT` | `CONFLICTING` 且无剩余安全恢复 |
| `HUMAN_ESCALATION_RECOVERY_EXHAUSTED` | 中高风险未决且恢复不可执行 |
| `BUDGET_EXHAUSTED` | 预算耗尽；LOW → P2.0 `AUTO_ABSTAIN`，非 LOW → `HUMAN_ESCALATE` |

Envelope 的 `routeReasonCode` **必须等于** 本次规范 `routeEvaluation().reasonCode`，且必须属于 `P2_4_HUMAN_ESCALATION_REASON_CODES`。

永不接受不兼容配对，例如：

```
HUMAN_ESCALATE + AUTO_FINALIZED_SUFFICIENT_EVIDENCE
HUMAN_ESCALATE + POLICY_BLOCKED_PRIVACY
HUMAN_ESCALATE + AUTO_RECOVERY_MISSING_EVIDENCE
```

此类配对是权威输入畸形：拒绝信封。  
规范 `routeEvaluation()` 仍是主键；闭集只做绑定检查，不替代路由。

---

## 7. 终态合同

A2 评价链的终端处理（P2.4 V1）：

| `route.decision` | 是否终态 | ExceptionEnvelope |
|---|---|---|
| `AUTO_FINALIZE` | 是 | **无** |
| `AUTO_ABSTAIN` | 是 | **无** |
| `POLICY_BLOCKED` | 是 | **无**（除非 P2.0 **本身**返回 `HUMAN_ESCALATE`，此时走下一行而不是本行） |
| `HUMAN_ESCALATE` | 是 | **恰好一份** `A2P2ExceptionEnvelopeV1` |
| `AUTO_RECOVER` | **否** | 无；交给 P2.3 |
| `AUTO_WAIT` | 暂停，非人工终态 | **无** |

P2.4 **不得改变**上述 decision。  
规范 `HUMAN_ESCALATE` **必须**仍产出恰好一份信封（展示集合过大时做有界投影，不得整封丢弃）。  
同一权威终端状态（见 §9）必须得到同一 `exceptionId`。

---

## 8. Exception Envelope V1 冻结 schema

版本常量（实现时锁定，不得漂移）：

```
A2P2_EXCEPTION_SURFACE = "A2_P2_4_EXCEPTION_ENVELOPE"
A2P2_EXCEPTION_ENVELOPE_VERSION = "a2p2-exception-envelope-v1"
A2P2_EXCEPTION_IDENTITY_VERSION = "a2p2-exception-identity-v1"
```

### 8.1 `A2P2ExceptionEnvelopeV1` 字段（闭集）

实现必须 **exact keys**。未知字段拒绝。只重建下列字段：

| 字段 | 类型 | 权威来源 | 身份输入？ |
|---|---|---|---|
| `version` | `"a2p2-exception-envelope-v1"` | 常量 | 否（identity 用独立 version） |
| `exceptionId` | `sha256` hex 64 | §9 | 否（它是输出） |
| `taskType` | `A2P2DomainId` | 同一快照的 validated contract | 否 |
| `semanticContractHash` | hex 64 | 合同 / packet.contract | **是** |
| `packetHash` | hex 64 | `SemanticEvidencePacketV1.packetHash` | **是** |
| `judgeProposalHash` | hex 64 或 `null` | `SemanticJudgeDecision.proposalHash ?? null`（§8.7） | **是** |
| `routeDecision` | `"HUMAN_ESCALATE"` 字面量 | **规范** `routeEvaluation().decision` | 否 |
| `routeReasonCode` | `P2_4_HUMAN_ESCALATION_REASON_CODES` | **规范** `routeEvaluation().reasonCode` | **是** |
| `routerVersion` | 既有 `A2P2_ROUTER_VERSION` | **规范** `routeEvaluation().routerVersion` | **是** |
| `riskClass` | `LOW \| MEDIUM \| HIGH \| RESTRICTED` | 合同 | 否 |
| `automationLevel` | 既有 `AutomationLevel` | 合同 | 否 |
| `requiredRequirementCount` | 有限非负整数 | 全量 eligible required id 数 | 否 |
| `requiredRequirementIds` | `string[]` 确定性前缀，≤16 | §8.3 有界投影 | 否 |
| `requiredRequirementsTruncated` | boolean | `count > displayed.length` | 否 |
| `problemRequirementCount` | 有限非负整数 | 全量 eligible problem id 数 | 否 |
| `problemRequirementIds` | `string[]` 确定性前缀，≤16 | §8.3 有界投影 | 否 |
| `problemRequirementsTruncated` | boolean | `count > displayed.length` | 否 |
| `evidenceStatus` | `EvaluationEvidenceStatus` | `toEvaluationEvidenceStatus(packet.status)` | 否 |
| `evaluationOutcome` | `TASK_SUCCESS \| PARTIAL_SUCCESS \| FAILURE \| UNKNOWN` | 同一 Judge/evaluation 快照 | **是** |
| `verdictState` | `NOT_EVALUATED \| PROPOSED \| ACCEPTED \| ABSTAINED` | 同上 | **是** |
| `recoveryStatus` | `EvaluationRecoveryStatus` | 同一 recovery 快照 | **是** |
| `recoveryCyclesUsed` | 有限非负整数 | recovery/budget | 否 |
| `recoveryAttemptKeys` | hex 64 数组，≤16，排序去重 | P2.3 `attemptKeys` 只读投影；超 16 条同样有界前缀，不丢信封 | 否 |
| `safeEvidenceRefCount` | 有限非负整数 | 全量 eligible safe ref 数 | 否 |
| `safeEvidenceRefs` | ≤32，§8.4 | 确定性前缀 | 否 |
| `safeEvidenceRefsTruncated` | boolean | `count > displayed.length` | 否 |
| `safeSummary` | §8.5 | 由规范 `routeReasonCode` 生成的闭集摘要 | 否 |
| `observedAt` | ISO-8601 或 `null` | **调用方提供**；P2.4 不读系统时钟 | 否 |

禁止额外字段，包括但不限于：`rawPrompt`、`modelOutput`、`emailBody`、`facts`、`normalizedValue`、`factSummary`、`delta`、`ledger`、`diagnostics.detail`、`goalSummary` 原文、任意 `unknown` JSON。

### 8.2 输入边界（fail-closed，never-throw）

`buildExceptionEnvelope(raw: unknown)` 必须对任意运行时值 never-throw。

若规范 `routeEvaluation().decision !== "HUMAN_ESCALATE"` → `{ ok: false, reason: "NOT_HUMAN_ESCALATE", envelope: null }`。

仅当权威输入畸形/不安全时拒绝信封，例如：

- mix-and-match 快照
- `expectedRoute` 与规范结果不等
- hash 非 64 hex、枚举越界、禁止键、循环/BigInt
- `proposalStatus === "VALID"` 但缺少合法 `proposalHash`
- `HUMAN_ESCALATE` 配上不在 `P2_4_HUMAN_ESCALATION_REASON_CODES` 的 reason

```
{ ok: false, reason: "ENVELOPE_INPUT_INVALID" | "EXPECTED_ROUTE_MISMATCH" | "MIXED_AUTHORITY_SNAPSHOTS", envelope: null }
```

**展示集合过大不得拒绝信封。** 用 §8.3 有界投影。  
合法上游 `HUMAN_ESCALATE` **必须**仍产出恰好一份 envelope。

**不得**为了「能给人类看」而填 `doc-1`、page 1、`HIGH` confidence、假 hash。

循环结构 / BigInt / 畸形对象：不得对未校验 `unknown` 做会抛的 `JSON.stringify`。只解析已知字段。

未来必测：

```
VALID_17_REQUIRED_HUMAN_ESCALATE_HAS_ENVELOPE = PASS
VALID_MANY_PROBLEM_REQUIREMENTS_HAS_BOUNDED_ENVELOPE = PASS
VALID_MORE_THAN_32_SAFE_REFS_HAS_BOUNDED_ENVELOPE = PASS
DISPLAY_OVERFLOW_DOES_NOT_DROP_EXCEPTION = PASS
```

### 8.3 有界确定性投影（totality）

对 `requiredRequirementIds` / `problemRequirementIds` / `safeEvidenceRefs`：

1. 先得到全量 eligible 集合
2. **确定性排序**（id / evidenceRef 用 `localeCompare`）
3. 展示数组 = 排序后的确定性前缀（required/problem ≤16，safe refs ≤32）
4. `*Count` = **全量** eligible 数（不是展示长度）
5. `*Truncated === true` 当且仅当 `fullCount > displayed.length`

`problemRequirementIds` 全量来源（取并集，再与合同 requirement id 相交）：

1. P2.1 `requirementAssessments` 中 `state !== "READY"` 且该 requirement `required` 的 id
2. 若 Judge `proposalStatus === "VALID"`：required 且 `judgment !== "SATISFIED"` 的 id

禁止从 adapter payload / raw JSON 扫 id，禁止发明 `mandatory_requirements`。

全量为空是合法的（例如 HIGH 风险 + 证据 READY）：`problemRequirementCount = 0`，展示 `[]`，`truncated = false`，信封仍必须存在。

### 8.4 `safeEvidenceRefs`（最小化）

闭集元素 **仅**：

```
{
  evidenceRef: string,
  requirementId: string,
  evidenceKind: EvaluationEvidenceKind,
  canonicalFactHash: string
}
```

Never include：`factSummary` · `normalizedValue` · raw locator / page body · source text · model rationale。

准入：

- 必须能在当前 packet `evidenceFacts` 中精确匹配
- `acceptance` **恰好**为 `COLLECTED` 或 `REDACTED`
- **永不** `BLOCKED`
- V1 进一步限制：只属于**展示中的** `problemRequirementIds`
- 若展示 `problemRequirementIds` 为空：`safeEvidenceRefs = []`，`safeEvidenceRefCount = 0`，`truncated = false`
- 不得枚举无关成功证据（其他 requirement 的 READY 事实）

孤儿 ref / 与 packetHash 不一致 → 权威畸形，拒绝信封（这不是展示溢出）。

这不是新的证据权威，只是 P2.1 已接受 EvidenceRef 的只读最小化投影。

未来必测：

```
BLOCKED_EVIDENCE_REF_NOT_EXPOSED = PASS
UNRELATED_REQUIREMENT_EVIDENCE_NOT_EXPOSED = PASS
EMPTY_PROBLEM_SET_HAS_ZERO_SAFE_EVIDENCE_REFS = PASS
```

### 8.5 `safeSummary`

不是 LLM 文本。不是 Tender 段落。

V1：从 `routeReasonCode` 映射到**固定短句**（闭集，英文或中文择一冻结，长度 ≤ 160）。  
例如 `HUMAN_ESCALATION_HIGH_RISK` → `"HUMAN_ESCALATION_HIGH_RISK"` 本身或预登记一句。  
禁止拼接 `factSummary`、goal 对话、模型 rationale。

P2.2 rationale 即使 ≤160 也 **不得**进入 envelope（仍属模型输出）。

### 8.6 时间语义

| 字段 | 语义 |
|---|---|
| `observedAt` | 调用方观察到该终态 route 的时间。可空。不参与 `exceptionId`。 |
| 系统 `createdAt` | **V1 不写入信封。** P2.4 不发明墙钟权威。 |

禁止用 `Date.now()` 作为 identity。禁止随机 UUID 作为 identity。

### 8.7 `judgeProposalHash`

安全字段：`judgeProposalHash: hex64 | null`

来源 **只** 允许：

```
SemanticJudgeDecision.proposalHash ?? null
```

规则：

- Judge 未调用 / `proposalStatus !== "VALID"` / 无提案：`null` 合法
- 若 `proposalStatus === "VALID"`：`proposalHash` **必须存在且为合法 hex64**，否则权威畸形，拒绝信封
- 不得从模型输出重算 hash，不得用 packetHash 冒充

---

## 9. 确定性 exception identity

```
exceptionId = sha256Hex(canonicalJson({
  version: "a2p2-exception-identity-v1",
  routerVersion,
  semanticContractHash,
  packetHash,
  routeReasonCode,
  evaluationOutcome,
  verdictState,
  judgeProposalHash,
  recoveryStatus
}))
```

绑定理由：

- `packetHash` 绑定 P2.1 状态
- `judgeProposalHash` 绑定 P2.2 提案
- `routerVersion` 绑定路由语义

**不**参与 identity：

- `problemRequirementIds` / `problemRequirementCount` / truncated 标志
- `safeEvidenceRefs` / count / truncated
- `requiredRequirementIds` / count / truncated
- `observedAt`
- `recoveryAttemptKeys`
- `safeSummary`

因此展示截断 **不得** 改变 `exceptionId`。

要求：

- 使用既有 P2.1 `canonicalJson` + `sha256Hex`
- 同一权威终端状态 → 同一 `exceptionId`
- 禁止 `crypto.randomUUID()` 作为权威 id
- identity 输入不齐 → 不生成信封（权威畸形，不是展示溢出）

未来必测：

```
ROUTER_VERSION_CHANGES_EXCEPTION_ID = PASS
JUDGE_PROPOSAL_CHANGE_CHANGES_EXCEPTION_ID = PASS
DISPLAY_TRUNCATION_DOES_NOT_CHANGE_EXCEPTION_ID = PASS
```

---

## 10. Envelope 不得包含的数据

Never include：

- raw prompt / raw model output / Judge rationale
- raw email body
- raw Tender paragraph / PDF text / page body
- raw tool payload / recovery adapter payload / ledger 明细中的 delta facts
- 任意 nested `unknown` JSON
- secret / P2.1 会 redact 的 PII
- `PROHIBITED` 隐私类事实
- 被 P2.1 拒绝的 evidence 的原文

只使用：hashes、safe ids、closed enums、红acted/闭集 summary、仅 `COLLECTED`/`REDACTED` 且属于展示 problem requirements 的 EvidenceRef。

`PRIVACY_LEAK_PATHS = ZERO`

CASE 10：`POLICY_BLOCKED_PRIVACY` **不**产信封。即使错误地被调用，`buildExceptionEnvelope` 也必须因 `decision !== HUMAN_ESCALATE` 拒绝，且输入扫描不得把 privacy diagnostics 拷进任何字段。

---

## 11. 无新权威

| 层 | 权威 | P2.4 禁止 |
|---|---|---|
| P2.0 | 路由 / 合同 / 预算 / 硬风险底线 | 改 decision、改 reason、扩白名单、降 HIGH/RESTRICTED |
| P2.1 | 证据包 / 隐私 / sufficiency / packetHash | 造 fact、改 ref、改 status、把 CONFLICTING 改成 SUFFICIENT |
| P2.2 | 语义 outcome / verdictState | 调 Judge 作为 envelope 副作用；把 UNAVAILABLE 当 FAILURE |
| P2.3 | 有界 recovery / attempt key | 重跑 loop、把 NO_PROGRESS 当任务失败 |

P2.4 只读上述输出。不复制路由表。不把 route-shaped 对象当权威。

---

## 12. 人类评审 ≠ Approval 引擎

即使 latest main 已合入 B0/B1/B2 与 Approval CAS，P2.4 V1 **不得** import、调用、创建或持久化：

- `PendingAction`
- `ApprovalRequest` / approval port（含 `src/lib/approval/port.ts`）
- approval executor / `src/lib/pending-actions/executor.ts`
- agent runtime / `pending-link`
- worker / queue / notification
- AuditLog 写路径

只产生内存中的 `A2P2ExceptionEnvelopeV1`。

```
EXCEPTION_ENVELOPE_PERSISTENCE = NONE
PENDING_ACTION_CREATED = NO
APPROVAL_REQUEST_CREATED = NO
```

真实人类工作流集成属于**后续单独审查的 runtime/integration 阶段**，不是 P2.4 V1，也不是 A3。

---

## 13. 人类响应 — 明确 Out of Scope

P2.4 **不**定义：

`APPROVE` · `REJECT` · `EDIT` · `RETRY` · `RESUME`

不在人类评审后突变 evaluation state。  
不重启 P2.2 / P2.3。  
该生命周期需要单独设计 Gate。

---

## 14. 高风险底线（重申 P2.0 B9）

`HARD_HUMAN_RISK_CLASSES = HIGH · RESTRICTED` 不能被下列降级：

- Task Contract / 模板 / 工作流
- Judge outcome（含 TASK_SUCCESS）
- Recovery 把包修成 SUFFICIENT
- P2.4 envelope 文案或 identity

P2.0 在路由第 5 步附近即 `HUMAN_ESCALATE` + `HUMAN_ESCALATION_HIGH_RISK`。  
P2.4 只物化该状态。

未来验证必须锁定：

```
HIGH_RISK_AUTO_FINALIZE_PATHS = ZERO
RESTRICTED_RISK_AUTO_FINALIZE_PATHS = ZERO
HIGH_RISK_AUTO_ACTION_PATHS = ZERO
RESTRICTED_RISK_AUTO_ACTION_PATHS = ZERO
```

「AUTO_ACTION」在 A2 语境 = 评价层对外业务动作（发信/投标/改价/签字/付款）。  
`AUTO_FINALIZE` 只结束评价记录，**仍不得**在 HIGH/RESTRICTED 上出现。P2.0 已禁止；P2.4 验证矩阵必须复现。

RESTRICTED 另有 `POLICY_BLOCKED_RESTRICTED_ACTION` / `POLICY_BLOCKED_L5_RESTRICTED` 路径 — 那些是阻断不是 envelope。验证时两者都不得变成自动业务动作。

---

## 15. UNKNOWN 不是 HUMAN_REQUIRED

沿用 P2.0：

- 低风险 UNKNOWN + 仍有安全恢复 → `AUTO_RECOVER`（P2.3）
- 低风险 UNKNOWN + 恢复耗尽 → `AUTO_ABSTAIN`
- 中风险未决 + 耗尽 → P2.0 可能 `HUMAN_ESCALATE`（`HUMAN_ESCALATION_RECOVERY_EXHAUSTED` 或 `BUDGET_EXHAUSTED`）
- HIGH/RESTRICTED → 与 UNKNOWN 无关，硬人工或阻断

P2.4 不得把「低风险 UNKNOWN」升级成人审。

```
UNKNOWN_ALWAYS_HUMAN = NO
UNKNOWN_AUTO_ESCALATION_HEURISTIC = ZERO
```

---

## 16. 冲突在恢复之后

P2.4 **不**决定冲突是否仍未解决。

| 层 | 职责 |
|---|---|
| P2.1 | 报告 `CONFLICTING` |
| P2.3 | 报告有界 recovery 是否耗尽 / 无进展 |
| P2.0 | 决定 `AUTO_RECOVER` vs `HUMAN_ESCALATE` |
| P2.4 | 仅当后者时物化 |

禁止：多数票、LLM 裁决、公网搜索打破平局（P2.3 已禁；P2.4 不得重开）。

---

## 17. 失败语义

| 事件 | 不得解释为 | 正确权威 |
|---|---|---|
| Judge provider `UNAVAILABLE` | 任务 FAILURE、自动 `HUMAN_ESCALATE` | P2.2：`NOT_EVALUATED` + `UNKNOWN`；再交 P2.0 |
| 畸形 Judge 输出 | 任务 FAILURE、自动人工 | P2.2：`REJECTED` + `NOT_EVALUATED`；再交 P2.0 |
| 畸形 recovery delta | 任务 FAILURE | P2.3 拒绝投影；再交 P2.0 |
| P2.3 adapter error | 任务 FAILURE | P2.3 ledger `ERROR`；不是 `failureType` |
| 未支持 recovery 域 / `mandatory_requirements` V1 deny | 偶然人工 | P2.3 不投影；P2.0 按证据/风险路由 |
| `PRIVACY_BLOCKED` | 塞 raw 进信封 | P2.0 `POLICY_BLOCKED`；无信封 |
| 未校验合同 | 降级模板后人工 | P2.0 `POLICY_BLOCKED_UNVALIDATED_CONTRACT`；无信封 |

```
PROVIDER_FAILURE_EQUALS_TASK_FAILURE = NO
ADAPTER_FAILURE_EQUALS_TASK_FAILURE = NO
```

A2 仍不发明 A3 `failureType`。

---

## 18. A2 验证矩阵（未来实现的纯测试，本 Gate 只冻结期望）

编排顺序（harness，不是 Production runtime）：

```
parseTaskContract
→ buildEvidencePacket()
→ （若 SUFFICIENT）runSemanticJudge(injected deterministic provider)
→ toP2EvaluationState
→ routeEvaluation()
→ 若 AUTO_RECOVER：runAutoRecoveryLoop()（零成本 fixture adapter）
→ 每拍结束后再次 routeEvaluation()
→ 仅当 HUMAN_ESCALATE：buildExceptionEnvelope()
```

禁止 live LLM、live network、Production DB。

### CASE 1 — 充足 + 高置信接受 + TASK_SUCCESS + LOW

期望：`AUTO_FINALIZE` · **无** envelope · 不得变 `HUMAN_ESCALATE`

### CASE 2 — 充足 + PARTIAL_SUCCESS

期望路由 **只由 P2.0** 定义（当前：`ACCEPTED` + `SUFFICIENT` + 兼容 outcome → `AUTO_FINALIZE`）。  
P2.4 不得因为 PARTIAL 就升级或阻止 finalize。

### CASE 3 — 证据缺失 + 安全恢复可用

期望：`AUTO_RECOVER` · P2.4 **不调用**（零 envelope）

### CASE 4 — Recovery 建成 SUFFICIENT 包

期望：P2.3 `EVIDENCE_READY_FOR_REEVALUATION` · P2.4 **不调用**  
（后续独立编排才可再 Judge；P2.4 不接刀）

### CASE 5 — Recovery 耗尽 + LOW UNKNOWN

期望：P2.0 权威，当前实现为 `AUTO_ABSTAIN` · **不是**自动人工 · 零 envelope

### CASE 6 — 恢复后仍 CONFLICTING

期望：P2.0 决定；若 `HUMAN_ESCALATE` + `HUMAN_ESCALATION_EVIDENCE_CONFLICT` → **恰好一份**安全信封

### CASE 7 — HIGH risk

期望：`HUMAN_ESCALATE` + `HUMAN_ESCALATION_HIGH_RISK` · 恰好一份信封 · 即使 Judge 说 TASK_SUCCESS 也不得 `AUTO_FINALIZE` · problem 集可空 → `safeEvidenceRefs = []`

### CASE 8 — RESTRICTED risk

期望：`HUMAN_ESCALATE`（硬底线）或既有 `POLICY_BLOCKED_*` · 若是 `HUMAN_ESCALATE` → 恰好一份信封 · 零 `AUTO_FINALIZE`

### CASE 9 — legal / financial / external-send / irreversible

期望：对应 P2.0 reasonCode 的 `HUMAN_ESCALATE` · 一份信封 · P2.4 不重判信号

### CASE 10 — privacy blocked

期望：`POLICY_BLOCKED` / `POLICY_BLOCKED_PRIVACY` · **无**信封 · 信封路径若被误调用也不得含 raw 隐私

### CASE 11 — Judge provider unavailable

期望：P2.2 `UNAVAILABLE` · `NOT_EVALUATED`/`UNKNOWN` · **不得**当成任务失败 · **不得**仅因此 `HUMAN_ESCALATE`

### CASE 12 — 畸形 Judge 输出

期望：P2.2 reject · **不得**变成 `HUMAN_ESCALATE`，除非 P2.0 在**其他**已有条件下如此路由（例如 HIGH 底线，与畸形输出无关）

### CASE 13 — 畸形 recovery delta

期望：P2.3 拒绝 · **不得**任务失败 · 不得由 P2.4 升级

### CASE 14 — P2.3 adapter error

期望：cycle 记账后交还 P2.0 · **不得**任务失败 · 不得由 P2.4 升级

### CASE 15 — 未支持 recovery 域 / V1 不支持的 requirement

期望：无偶然人工升级 · 无假 `SUFFICIENT` · P2.4 不发明 envelope

### Envelope 必测（B1–B4）

| 测试 | 期望 |
|---|---|
| `MIXED_AUTHORITY_SNAPSHOTS_REJECTED` | 混用合同/包/recovery/budget/policy 快照 → 无信封 |
| `VALID_17_REQUIRED_HUMAN_ESCALATE_HAS_ENVELOPE` | 17 条 required + 规范 HUMAN_ESCALATE → **仍有**信封；`requiredRequirementCount=17`；展示 16；`truncated=true` |
| `VALID_MANY_PROBLEM_REQUIREMENTS_HAS_BOUNDED_ENVELOPE` | 大量 problem ids → 仍有信封；count=全量；展示 ≤16 |
| `VALID_MORE_THAN_32_SAFE_REFS_HAS_BOUNDED_ENVELOPE` | >32 eligible refs → 仍有信封；展示 ≤32 |
| `DISPLAY_OVERFLOW_DOES_NOT_DROP_EXCEPTION` | 展示溢出 ≠ 丢异常 |
| `ROUTER_VERSION_CHANGES_EXCEPTION_ID` | `routerVersion` 变则 `exceptionId` 变 |
| `JUDGE_PROPOSAL_CHANGE_CHANGES_EXCEPTION_ID` | `judgeProposalHash` 变则 `exceptionId` 变 |
| `DISPLAY_TRUNCATION_DOES_NOT_CHANGE_EXCEPTION_ID` | 截断标志/展示前缀变化不改 identity |
| `BLOCKED_EVIDENCE_REF_NOT_EXPOSED` | `acceptance === BLOCKED` 不得出现 |
| `UNRELATED_REQUIREMENT_EVIDENCE_NOT_EXPOSED` | 非展示 problem requirement 的证据不得出现 |
| `EMPTY_PROBLEM_SET_HAS_ZERO_SAFE_EVIDENCE_REFS` | problem 为空 → `safeEvidenceRefs = []` |

---

## 19. A2 闭合不变量（未来验收冻结）

```
FALSE_TASK_SUCCESS_PATHS = ZERO
FALSE_AUTO_FINALIZE_PATHS = ZERO
HIGH_RISK_AUTO_ACTION_PATHS = ZERO
RESTRICTED_RISK_AUTO_ACTION_PATHS = ZERO
HIGH_RISK_AUTO_FINALIZE_PATHS = ZERO
RESTRICTED_RISK_AUTO_FINALIZE_PATHS = ZERO
PRIVACY_LEAK_PATHS = ZERO
UNBOUNDED_RECOVERY_PATHS = ZERO
MODEL_ROUTE_AUTHORITY = NO
MODEL_ESCALATION_AUTHORITY = NO
RECOVERY_ROUTE_AUTHORITY = NO
P2_4_ROUTE_AUTHORITY = NO
P2_4_ROUTE_LOGIC = ZERO
P2_4_CANONICAL_ROUTE_VERIFICATION = P2_0_ROUTE_EVALUATION_ONLY
UNKNOWN_ALWAYS_HUMAN = NO
UNKNOWN_AUTO_ESCALATION_HEURISTIC = ZERO
PROVIDER_FAILURE_EQUALS_TASK_FAILURE = NO
ADAPTER_FAILURE_EQUALS_TASK_FAILURE = NO
FALSE_RECOVERY_SUFFICIENCY_PATHS = ZERO
P2_3_TERMINAL_ROUTE_AUTHORITY = P2_0_ROUTE_EVALUATION_ONLY
RUN_SEMANTIC_JUDGE_CALL_COUNT_FROM_ENVELOPE_CODE = 0
```

`P2_4_ROUTE_AUTHORITY = NO` 表示 P2.4 **自身**没有路由权。  
`P2_4_CANONICAL_ROUTE_VERIFICATION = P2_0_ROUTE_EVALUATION_ONLY` 表示资格只来自现调既有 `routeEvaluation()`。

---

## 20. Validation harness 边界（实现阶段才写测试，本 Gate 不写代码）

允许的纯调用：

- `parseTaskContract` / 领域模板合同
- `buildEvidencePacket()`
- `runSemanticJudge()` + **注入的确定性 provider**
- `runAutoRecoveryLoop()` + 零成本 fixture adapter
- `routeEvaluation()`
- `buildExceptionEnvelope()`

禁止：

- Production E2E
- live LLM / live network
- Production DB / migrate
- 改 processor / outbox / capture
- 从 envelope 模块 import agent-runtime / workforce-runtime / executor / approval port / pending-actions

P2.4 V1 **不要求** Production E2E。

---

## 21. R1 Runtime Architecture 兼容

当前 Manifest：

> Autopilot = Evaluation / evidence / judge / recovery-policy layer.  
> NOT an executor runtime. Must not import execution engines.

P2.4 必须保持：

| 是 | 不是 |
|---|---|
| 评价层 exception 物化 | runtime |
| 确定性 recovery-policy 旁路的只读投影 | planner engine |
| 纯函数 | executor / worker / scheduler |
| 闭集信封 | approval mechanism / tool registry |

建议未来文件名（批准实现后）：

- `src/lib/autopilot/a2p2-exception-types.ts`
- `src/lib/autopilot/a2p2-exception-envelope.ts`
- `src/lib/autopilot/__tests__/a2p2-exception-envelope.test.ts`
- `src/lib/autopilot/__tests__/a2p2-a2-closure-matrix.test.ts`

禁止未来文件名示例：`a2p2-exception-plan.ts`、`a2p2-exception-engine.ts`、`a2p2-exception-processor.ts`、`a2p2-exception-orchestrator.ts`。

P2.3 已将 selector 命名为 `a2p2-recovery-select` 以遵守 basename freeze；P2.4 必须同样遵守。

Forbidden import growth：`autopilot → agent-core / agent-runtime / agent-runtime-v2 / workforce-runtime / agent-supervisor` 不得新增。

---

## 22. 持久化

V1：

```
NO Prisma
NO migration
NO new table
NO write path
NO AuditLog write
NO PendingAction write
NO ApprovalRequest write
NO approval port / executor call
```

ExceptionEnvelope = 纯内存。  
latest main 的 Approval CAS / PendingAction 基础设施 **不**构成 P2.4 授权。  
持久化是后续 integration concern，需单独审查。

```
P2_3_PRISMA_SCHEMA_CHANGED 沿用 = NO
P2_4 也不得改 schema
```

---

## 23. Production 锁（本 Gate 不关闭）

必须保持：

```
PRODUCTION_AUTOPILOT_CAPTURE = OFF
PRODUCTION_AUTOPILOT_PROCESSOR = OFF
AUTOPILOT_LLM_JUDGE_ENABLED = OFF / UNSET
AUTOPILOT_PRODUCTION_ACTIVATED = NO
PRODUCTION_MIGRATION_RUN_BY_P2_4 = NO
```

沿用、本阶段不关闭：

```
A2_P1_PRODUCTION_ORG_SCOPE = REQUIRED_BEFORE_ACTIVATION
A2_P1_CALL_BUDGET_OR_RATE_GUARD = REQUIRED_BEFORE_ACTIVATION
```

P2.4 **不**关闭这些 blocker。P2.4 合入（若将来实现）也不授权打开上述开关。

---

## 24. 与相邻阶段

| 阶段 | 职责 |
|---|---|
| P2.0 | 合同、预算、白名单、**唯一路由** |
| P2.1 | 结构化证据包 + 隐私 + sufficiency |
| P2.2 | grounded semantic Judge（仅 SUFFICIENT） |
| P2.3 | 有界 auto recovery；不 Judge；终态仍 P2.0 |
| **P2.4（本 Gate）** | 物化 `HUMAN_ESCALATE` 信封 + A2 闭合验证 |
| 后续 runtime/integration | 人审工作流、持久化、通知 — **不是本阶段** |
| A3 | 失败诊断 — **不得由 A2 自动创建** |

KPI 仍是 P2.0 设计目标，不是本阶段实测：自动评价 ≥ 95% · 人工升级 ≤ 5% · 假成功 ≤ 2% · 隐私泄漏 0 · 无界重试 0 · 高风险自动动作 0。

---

## 25. 明确拒绝的替代方案

| 方案 | 拒绝理由 |
|---|---|
| P2.4 根据 UNKNOWN「稳妥起见」升级 | `UNKNOWN != HUMAN_REQUIRED` |
| 把 `POLICY_BLOCKED` 包成人审单 | 阻断 ≠ 人工评审 |
| 把 `AUTO_ABSTAIN` 转成人工以免「没人看」 | helpful escalation 禁止 |
| LLM 生成 envelope summary / 决定是否升级 | `MODEL_ESCALATION_AUTHORITY = NO` |
| P2.4 修改 packet 让人类更好懂 | 证据权威 = P2.1 |
| 在 envelope 内存 Tender 原文 | 隐私 / raw 禁止 |
| 信任 route-shaped 对象、不现调 `routeEvaluation()` | `P2_4_ROUTE_AUTHORITY = NO`；形状不是权威 |
| 因 17 条 required / >32 refs 整封丢弃 | 合法 HUMAN_ESCALATE 必须 totality；有界投影 |
| 把 `BLOCKED` 或无关成功证据放进 `safeEvidenceRefs` | B4 最小化 |
| 把 `problemRequirementIds` 打进 `exceptionId` | 展示截断不得改 identity |
| 直接写 PendingAction / ApprovalRequest / approval port / CAS executor | latest main 有基础设施也不授权 |
| 开 Prisma 表存 exception | V1 无持久化 |
| P2.4 调 `runSemanticJudge()` 补一次 | 不是 Judge；harness 才可注入验证 |
| P2.4 发明终态 | 终态权威 = `routeEvaluation()` |
| 用公网/多数票解决冲突后再决定是否人工 | P2.1/P2.3/P2.0 已锁 |
| 随机 UUID 做 exceptionId | 必须确定性 |
| 开始 A3 并把 adapter error 当 HALLUCINATION | A3 = NOT_STARTED |
| 打开 Production flags | 激活 blocker 仍在 |

---

## 26. D1–D18 批准登记

实现开始前以本表为准。Design Review 四个 blocker 已闭合后的状态：

```
D1_D18 = ACCEPTED
P24_B1_CANONICAL_ROUTE_INPUT_BINDING = CLOSED
P24_B2_VALID_ESCALATION_ENVELOPE_TOTALITY = CLOSED
P24_B3_EXCEPTION_ID_AUTHORITY_VERSION_BINDING = CLOSED
P24_B4_SAFE_EVIDENCE_MINIMIZATION = CLOSED
```

### D1 — 路由权威 — ACCEPTED_WITH_CANONICAL_P2_0_VERIFICATION

`P2_4_ROUTE_AUTHORITY = NO` · `P2_4_ROUTE_LOGIC = ZERO`。  
资格来自同一快照上现调既有 `routeEvaluation()`。route-shaped 对象不是权威。`expectedRoute` 必须与规范结果精确相等。

### D2 — 资格 — ACCEPTED_WITH_DECISION_REASON_BINDING

仅当规范 `decision === HUMAN_ESCALATE` 且 `reasonCode ∈ P2_4_HUMAN_ESCALATION_REASON_CODES` 才物化。  
禁止 `AUTO_*` / `POLICY_BLOCKED` → 人工。禁止 `HUMAN_ESCALATE + AUTO_FINALIZED_SUFFICIENT_EVIDENCE` 等不兼容配对。

### D3 — schema — ACCEPTED_WITH_BOUNDED_TOTAL_PROJECTION

冻结 `A2P2ExceptionEnvelopeV1` 闭集字段（§8）。未知键拒绝。  
展示集合用 count + 确定性前缀 + truncated；合法 HUMAN_ESCALATE 不得因溢出丢信封。

### D4 — 隐私 — ACCEPTED_WITH_DATA_MINIMIZATION

无 raw prompt / 模型输出 / 邮件 / Tender 正文 / PDF / tool payload / 任意 nested JSON / P2.1 应 redact 的 PII。  
`safeEvidenceRefs` 仅 `COLLECTED`/`REDACTED`，且只属于展示中的 problem requirements；空 problem 集 → 零 refs。永不 `BLOCKED`。

### D5 — 确定性 identity — ACCEPTED_WITH_ROUTER_AND_PROPOSAL_HASH_BINDING

`exceptionId` 绑定 `routerVersion` + `semanticContractHash` + `packetHash` + `routeReasonCode` + `evaluationOutcome` + `verdictState` + `judgeProposalHash` + `recoveryStatus`。  
`problemRequirementIds` / 展示截断 / `observedAt` / `recoveryAttemptKeys` 不进 identity。禁止随机 UUID。

### D6 — 无证据权威 — ACCEPTED

不创建/修改 EvidenceFact、EvidenceRef、packetHash、assessment、packet.status。

### D7 — 无 Judge 权威 — ACCEPTED

不覆盖 outcome / verdictState。envelope 代码不调用 `runSemanticJudge()`。  
`proposalStatus === VALID` 时必须有合法 `proposalHash`。provider 不可用 / 畸形输出 ≠ 任务失败，≠ 自动人工。

### D8 — 无 Recovery 权威 — ACCEPTED

不执行、不扩白名单、不把 adapter/delta 错误写成任务失败。  
`AUTO_RECOVER` 非终态，P2.4 不介入。

### D9 — UNKNOWN 语义 — ACCEPTED

`UNKNOWN != HUMAN_REQUIRED`。低风险耗尽 → 尊重 P2.0 `AUTO_ABSTAIN`。  
`UNKNOWN_AUTO_ESCALATION_HEURISTIC = ZERO`。

### D10 — 高风险底线 — ACCEPTED

HIGH / RESTRICTED 不得被合同、Judge、Recovery、P2.4 降级。  
`HIGH_RISK_AUTO_FINALIZE_PATHS = ZERO` · `RESTRICTED_RISK_AUTO_FINALIZE_PATHS = ZERO`。

### D11 — 冲突处理 — ACCEPTED

冲突是否未解决由 P2.1+P2.3 报告、P2.0 决定。P2.4 只在规范 `HUMAN_ESCALATE` 时物化。  
无多数票、无 LLM 裁决、无公网破平。

### D12 — 失败语义 — ACCEPTED

Judge/provider/adapter/delta/域不支持 ≠ 任务失败。  
`PROVIDER_FAILURE_EQUALS_TASK_FAILURE = NO` · `ADAPTER_FAILURE_EQUALS_TASK_FAILURE = NO`。  
不发明 A3 failureType。

### D13 — 验证矩阵 — ACCEPTED

CASE 1–15 与 Envelope 必测为未来纯测试验收合同。P2.4 不得覆盖 P2.0 在 CASE 2/5/11/12 上的既有路由。

### D14 — 持久化 / runtime 禁止 — ACCEPTED

无 Prisma、migration、表、写路径、AuditLog、PendingAction、ApprovalRequest、approval port、通知、worker。  
信封纯内存。latest main CAS 不授权。

### D15 — R1 兼容 — ACCEPTED

Autopilot 保持 evaluation / evidence / judge / recovery-policy。  
P2.4 不是 runtime / planner / executor / worker / scheduler / approval / tool registry。  
未来文件名避开冻结 token。无新增向执行引擎或 approval 的 import。

### D16 — A2 闭合标准 — ACCEPTED

§19 不变量全部成立后，A2-P2.4 **实现**才可称为闭合。  
本 Design Gate **本身**不闭合 Production 激活 blocker，也不开始 A3。

### D17 — 人类响应另开设计 — ACCEPTED

APPROVE / REJECT / EDIT / RETRY / RESUME 与评审后状态机 **不是** P2.4 V1。

### D18 — 非法输入 fail-closed — ACCEPTED

`buildExceptionEnvelope` never-throw。循环/BigInt/畸形权威 / mix-and-match → 无信封。  
展示溢出不是畸形权威，必须仍产信封。不得伪造 provenance。

---

## 27. 建议模块（尚未创建）

| 路径 | 职责 |
|---|---|
| `a2p2-exception-types.ts` | 版本常量、闭集类型、identity 输入 |
| `a2p2-exception-envelope.ts` | `buildExceptionEnvelope()` never-throw |
| `__tests__/a2p2-exception-envelope.test.ts` | 资格、隐私、identity、非法输入 |
| `__tests__/a2p2-a2-closure-matrix.test.ts` | CASE 1–15 + §19 不变量 |

**现在不得创建这些文件。**

---

## 28. 本 Gate 产出

| 项 | 状态 |
|---|---|
| 本设计文档 | 本提交 |
| 实现 PR | **未开始** |
| 测试代码 | **未开始** |
| Runtime / Production | **禁止** |
| A3 | **NOT_STARTED** |

```
IMPLEMENTATION_STARTED = NO
D1_D18 = ACCEPTED
A2_P2_3_STATUS = CLOSED
A2_P2_4_STATUS = READY_FOR_DESIGN_FINAL_REVIEW_2
A3_STATUS = NOT_STARTED
```

FINAL_STATUS = `A2_P2_4_READY_FOR_DESIGN_FINAL_REVIEW_2`

STOP. Design Final Review 2 通过并明确授权前不实现 P2.4。不开始 A3。
