# 青砚 Autopilot A2-P2.3 — Auto Recovery Loop Design Gate

日期：2026-08-23  
状态：**DESIGN GATE — LUCAS REVIEW DECISIONS INCORPORATED**。本文件是实现前冻结规格，不是实现报告。  
实现 = NOT_STARTED · Runtime wiring = NO · Production = OFF · Prisma/migration = NO

A2-P0 = CLOSED · A2-P1 = CLOSED · A2-P2.0 = CLOSED · A2-P2.1 = CLOSED · A2-P2.2 = CLOSED  
**A2-P2.3 = READY_FOR_DESIGN_FINAL_REVIEW** · A2-P2.4 = NOT_STARTED · A3 = NOT_STARTED

基线：`origin/main` = `29e4b2173f3bf7cc14052c1191a48cf3882d495e`（PR #153 merge）

权威函数 / 类型（沿用已合入代码，不得另造同义词）：

- `routeEvaluation()`
- `parseTaskContract()`
- `buildEvidencePacket()`
- `toEvaluationEvidenceStatus()`
- `parseStructuredSourcesSnapshot()`
- `runSemanticJudge()` — **P2.3 禁止调用**
- `SemanticEvidencePacketV1`
- `EvaluationRecoveryActionKind`
- `contract.recoveryPolicy.allowedActions`
- `contract.evaluationBudget`
- `route.allowedNextActions`

---

## 0. Gate 目的

P2.0 已经能把「证据不足 / 冲突 / 目标含混」路由成 `AUTO_RECOVER`，并给出白名单 `allowedNextActions`。  
P2.1 明确：**缺证据时不搜、不读额外文件、不查 Gmail、不跑 Tender Agent、不调 tool**。  
P2.2 Judge **只吃** `SUFFICIENT` 包。

因此当前缺口不是「再写一个 Judge」，而是：

> 谁在白名单内、有界地执行 recovery，把**已结构化**的证据增量交给现有 P2.1 Evidence Builder，重建 `SemanticEvidencePacketV1`？

本 Design Gate 冻结这个问题的边界。最终设计审查通过前 **不得写实现代码**。

---

## 1. 问题陈述

| 已有能力 | 缺口 |
|---|---|
| P2.0 `routeEvaluation()` 决定 `AUTO_RECOVER` + `allowedNextActions` | 没有执行器，决策是死的 |
| P2.1 `buildEvidencePacket()` 只消费已有 structured snapshot | 不会自己去找下一块**已结构化**事实 |
| P2.2 `runSemanticJudge()` 在包不充分时直接 `NOT_EVALUATED` | 不会为了凑证据去搜；P2.3 也不得替它搜完后直接 Judge |
| 预算 `evaluationBudget.maxRecoveryCycles = 3` 等常量已锁定 | 没有 cycle 账本去消耗它们 |

不解决这个缺口，Automation First 会停在「建议恢复」而永远不恢复。  
错误地扩大缺口（让模型选动作、发邮件、跑 Tender Agent、改 schema、直接改 packet、调 Judge）会破坏 P2.0–P2.2 的权威模型。

---

## 2. 权威模型（沿用，不得改写）

1. **LLM 不得决定 recovery。** 模型不能选动作、不能扩白名单、不能决定停手 / 升级 / finalize。
2. **P2.0 `routeEvaluation()` 仍是唯一路由权威。** 每个 recovery cycle **开始前**必须重跑。Loop 只执行当前路由已经允许、且被合同与 P2.3 V1 支持集同时允许的动作。
3. **P2.1 仍是唯一证据包权威。** Recovery **不得**直接改写 `SemanticEvidencePacketV1`。唯一合法路径见 D5。
4. **P2.2 仍是唯一语义裁决权威。** P2.3 **永不调用** `runSemanticJudge()`。包变 `SUFFICIENT` 之后停，返回 `EVIDENCE_READY_FOR_REEVALUATION`。P2.2 只由**后续独立编排阶段**调用。
5. **A2 不得创建 A3 诊断。** `failureType` 继续与 P2.2 一样保持 `null`。Adapter 失败也不是任务失败。
6. **Evaluation 恢复上限仍是 `READ_SEARCH_VERIFY_ONLY` / `L2_AUTO_PREPARE`。** 禁止一切对外副作用。
7. **预算权威仍是现有 P2.0** `evaluationBudget` + `recoveryPolicy`。P2.3 不另立预算合同。

沿用句式：

**EVERY CYCLE RE-ROUTES FIRST. EXECUTABLE ACTION = ROUTER ∩ CONTRACT ∩ P2.3_SUPPORTED_ACTIONS. ADAPTERS RETURN RecoverySnapshotDelta ONLY. P2.1 REBUILDS THE PACKET. P2.3 NEVER JUDGES.**

---

## 3. 本阶段回答 / 不回答

P2.3 **回答**：

- 每个 cycle 开始前如何重跑 `routeEvaluation()`？
- 可执行动作如何从三方交集中选出？
- Adapter 如何只返回有界 `RecoverySnapshotDelta`？
- Delta 如何经 TENDER 结构化投影进入现有 P2.1 builder？
- 预算、无进展、adapter 错误如何停机？

P2.3 **不回答**：

- 任务语义上是否成功（P2.2，且由后续编排调用）
- Agent 为什么失败（A3）
- 人来怎么审（P2.4）
- Production 何时打开 Capture / Processor / LLM Judge
- 如何 parse PDF / 读原文 / 读 Gmail / 调真实搜索 / 跑 Tender Agent
- 如何持久化 recovery 尝试（只定义 `recoveryAttemptKey`，本阶段不落库）

---

## 4. 范围

### 4.1 In scope（实现批准后）

纯库 + 注入 adapter 缝 + 单测。形状对齐 P2.0–P2.2：

- `runAutoRecoveryLoop({ contract, structuredSources, budgetState, recoveryState, policySignals, adapters, now })`
- **每个 cycle 开始前**重跑 `routeEvaluation()`
- 确定性 planner：从  
  `route.allowedNextActions ∩ contract.recoveryPolicy.allowedActions ∩ P2.3_SUPPORTED_ACTIONS`  
  选出 **恰好 1 个** 下一动作
- adapter port：只返回严格、有界的 `RecoverySnapshotDelta`
- 唯一重建路径：`RecoverySnapshotDelta` → canonical TENDER structured source projection → 现有 `buildEvidencePacket()` → 新的 `SemanticEvidencePacketV1`
- 有界 cycle / 外搜 / 成本账本；**前后**都检查预算
- 确定性 `NO_PROGRESS` 停机
- 确定性 `recoveryAttemptKey`（只在返回值中；不写库）
- 审计 ledger（内存，随返回值；不写库）

V1 唯一可恢复域：**`TENDER_ANALYSIS`**。

### 4.2 Out of scope（硬禁止）

| 禁止项 | 原因 |
|---|---|
| 改 P2.0 路由优先级 / 白名单 / 预算默认值 | 闭环合同已锁；P2.3 只消费 |
| 改 P2.1 collector / 隐私 / sufficiency 语义 | 身份已锁 |
| 改 P2.2 Judge 输入/解析/门 | 刚 CLOSED |
| 调用 `runSemanticJudge()` | 恢复 ≠ 语义评价；SUFFICIENT 后停 |
| 直接 mutate `SemanticEvidencePacketV1` | 唯一路径必须经 P2.1 builder |
| 真实外网 / 原文 / PDF / HTML / 任意嵌套 JSON adapter | V1 不支持 |
| 调用 `routeEvaluation()` **作为生产 runtime**（processor / cron） | 库内可测调用，不接线 |
| 改 `evaluate-judge.ts` | A2-P1 身份 |
| Prisma schema / 新 migration / Production migrate | P2.3 不持久化 |
| worker / cron / outbox / capture | P2.4+ |
| 打开 Production flags | 激活 blocker 仍在 |
| `SEND_EMAIL` 等副作用 | 已在 P2.0 禁止列表 |
| 让 LLM 规划 recovery | 权威模型 |
| 为 `RESEARCH` / `EMAIL_DRAFT` / `GENERIC` 做 recovery | V1 `NOT_SUPPORTED` |
| 开始 P2.4 / A3 | 阶段锁 |

---

## 5. 冻结决策

以下为 Lucas review 后的冻结文本。§12 为同一套 D1–D16 的批准登记。

### D1. 形态 = 同步有界 loop，不是 Production worker — ACCEPTED

一次 `runAutoRecoveryLoop` 在同一调用栈内跑完最多 `evaluationBudget.maxRecoveryCycles` 拍。  
不新建队列、cron、lease、Prisma 表、outbox。  
返回时 **不得** 把 `recoveryState.status` 留在 `IN_PROGRESS`。

外部若传入 `recoveryState.status === "IN_PROGRESS"`：loop **拒绝执行**，原样返回（对齐 P2.0 `AUTO_WAIT`，禁止双调度）。

**每个 recovery cycle 开始前必须重跑 `routeEvaluation()`。** 不得只在 loop 入口路由一次后就连跑多拍。上一拍的 packet / budget / attempt 状态必须进入下一拍的路由输入。

### D2. 唯一合法入口与每拍重入条件 — ACCEPTED

只有当 **当前这一拍** `routeEvaluation()` 结果为 `AUTO_RECOVER` 时才允许执行 adapter。  
不是 `AUTO_RECOVER` → 本拍零动作，loop 停。

合法 reasonCode（P2.0 已有）：

- `AUTO_RECOVERY_MISSING_EVIDENCE`
- `AUTO_RECOVERY_SOURCE_CONFLICT`
- `AUTO_RECOVERY_GOAL_AMBIGUOUS`

### D3. 不从 P2.2 语义结果启动 recovery；SUFFICIENT 后也不调 Judge — ACCEPTED

下列 **不是** P2.3 触发器：

- Judge `ABSTAINED` / `UNKNOWN`（证据已 `SUFFICIENT`，只是语义不确定）
- Judge `ACCEPTED` + `FAILURE`（有锚定的 NOT_SATISFIED，不是缺证据）
- Judge parser reject / provider unavailable（基础设施，不是 recovery）

缺证据是 P2.1 结构问题，不是 P2.2 语义问题。

若重建后的 packet `status === "SUFFICIENT"`：**立即 STOP**，返回 `EVIDENCE_READY_FOR_REEVALUATION`。  
**禁止**在 P2.3 内调用 `runSemanticJudge()`。P2.2 只由后续独立编排阶段调用。

### D4. 每 cycle 恰好 1 个动作；每次 adapter 尝试都计 cycle — ACCEPTED

禁止一拍扇出多个搜索。  
每一次 adapter 尝试都消耗 1 个 recovery cycle，包括：error、timeout、malformed delta、`NOT_FOUND`、`UNCHANGED`、`REJECTED`。  
**没有** adapter 内部隐藏重试。失败后更新有界 attempt 状态，进入下一拍（先重跑路由）。

### D5. 不得直接改 packet；唯一重建路径 — ACCEPTED

Recovery **MUST NOT** mutate `SemanticEvidencePacketV1`。

唯一接受路径：

```
RecoverySnapshotDelta
  → canonical TENDER structured source projection
  → 现有 P2.1 buildEvidencePacket()
  → rebuilt SemanticEvidencePacketV1
```

禁止：手写 `SUFFICIENT`、补 `evidenceFacts`、改 `packetHash`、绕过隐私门。

### D6. 可执行动作 = 三方交集 — ACCEPTED

Planner 候选必须同时属于：

1. `routeEvaluation().allowedNextActions`
2. `contract.recoveryPolicy.allowedActions`
3. `P2.3_SUPPORTED_ACTIONS`

并继续遵守：

- `recoveryPolicy.allowExternalResearch === false` → 去掉外研动作
- 外搜预算耗尽 → 去掉外研动作
- `FORBIDDEN_EVALUATION_SIDE_EFFECT_ACTIONS` 中的任何值 → fail-closed，不执行
- 不在 `P2.3_SUPPORTED_ACTIONS` 中的 P2.0 动作 → **本阶段视为不可执行**，不得 fallback 到真网络或原文读取

### D7. 规划优先级（固定顺序，且须通过 D6） — ACCEPTED

对 **required** 且状态为 `INSUFFICIENT` 的 requirement，按合同中的 requirement 顺序取第一个缺口，再按 evidenceKinds 套动作表，取 **第一个尚未尝试** 且落在三方交集中的动作。

| 缺口 evidenceKind | 规划顺序（仍须通过 D6；V1 不支持项会被交集丢掉） |
|---|---|
| `SOURCE_FACT` | `SEARCH_PROJECT_DOCUMENTS` → `READ_EXISTING_DOCUMENT` → `SEARCH_INTERNAL_FACTS` → `REFRESH_SOURCE_FACTS` → `SEARCH_AWARD_HISTORY` → `SEARCH_PUBLIC_WEB` |
| `ARTIFACT_FACT` | `SEARCH_PROJECT_DOCUMENTS` → `READ_EXISTING_DOCUMENT` → `REFRESH_SOURCE_FACTS` |
| `TOOL_RESULT` | `RECHECK_TOOL_RESULT` → `REFRESH_SOURCE_FACTS` |
| `BUSINESS_STATE` | `SEARCH_INTERNAL_FACTS` → `REFRESH_SOURCE_FACTS` |
| `RUNTIME_FACT` | `REFRESH_SOURCE_FACTS` → `RECHECK_TOOL_RESULT` |

V1 实际可执行集见 D12。表中出现 `READ_EXISTING_DOCUMENT` / `SEARCH_PUBLIC_WEB` / `SEARCH_AWARD_HISTORY` 只表示 P2.0 规划顺序；**P2.3 V1 不得执行它们**。

`CONFLICTING` required（reason `AUTO_RECOVERY_SOURCE_CONFLICT`）：

- 规划上只考虑 `REFRESH_SOURCE_FACTS`、`RECHECK_TOOL_RESULT`
- **禁止** 用公网搜索「打破」冲突
- **禁止** 选边；P2.1 冲突检测保持原样

`AUTO_RECOVERY_GOAL_AMBIGUOUS`：

- 仍只跑交集内的 V1 支持动作
- **禁止** 改 `goalSummary` / requirements
- 若 cycle 耗尽仍含混 → 交给已有 `HUMAN_ESCALATION_GOAL_AMBIGUOUS`

Optional requirement **单独**不得驱动 recovery。

### D8. 不可恢复 / 域不支持 → `NO_SAFE_ACTION` — ACCEPTED

出现以下情况时不得调用 adapter：

- packet `PRIVACY_BLOCKED` 或隐私 policy signal
- `POLICY_BLOCKED` 路由
- `HIGH` / `RESTRICTED`（路由在 recovery 之前就会 `HUMAN_ESCALATE`）
- `L0_HUMAN_CONTROLLED` / `L5_RESTRICTED`
- `taskType !== "TENDER_ANALYSIS"`（V1：`RESEARCH` / `EMAIL_DRAFT` / `GENERIC` = `NOT_SUPPORTED`）
- required 为 `NOT_EVALUABLE` 且原因是包上限 / 非法 structured source / 未校验合同
- 三方交集为空
- 指纹 / `recoveryAttemptKey` 显示无进展（D9）

`NO_SAFE_ACTION` → 不再空转。更新 attempt 状态后重跑 `routeEvaluation()`，期望 `AUTO_ABSTAIN` 或 `HUMAN_ESCALATE`（由 P2.0 既有规则决定）。

### D9. 确定性 `NO_PROGRESS` 停机 — ACCEPTED

下列任一情况 **不得** 形成无界 loop，必须硬停（耗尽本拍 cycle 后重路由一次，然后停）：

1. adapter 返回 empty delta（无新结构化事实）
2. 投影后的 structured source snapshot hash **未变**
3. 重建后的 `SemanticEvidencePacketV1.packetHash` **未变**
4. 重复的 `(packetHash, reasonCode, actionKind)` — 通过 `recoveryAttemptKey` 检测

`NO_PROGRESS` 不是任务失败，也不是语义 `FAILURE`。

### D10. Adapter 只返回严格有界 `RecoverySnapshotDelta` — ACCEPTED

Adapter **不得** 返回：raw body、PDF bytes、HTML、任意嵌套 JSON、prompt、邮件正文、标书原文、tool payload、模型输出、业务副作用。

V1 合法结果必须是严格 schema，例如：

```ts
type RecoverySnapshotDelta = {
  version: "a2p2-recovery-snapshot-delta-v1"
  actionKind: EvaluationRecoveryActionKind
  requirementIds: readonly string[]          // 有界、opaque id
  facts: readonly RecoveryDeltaFact[]        // 有界条数；已规范化的结构化事实
  sourceRefs: readonly RecoverySourceRef[]   // opaque sourceId + contentHash；无正文
  status: "FOUND" | "NOT_FOUND" | "UNCHANGED" | "REJECTED"
  externalResearchUsed: boolean
  costUsd: number                            // 有限、非负；NaN/Infinity → REJECTED
}

type RecoveryDeltaFact = {
  requirementId: string
  factKey: string
  evidenceKind: EvaluationEvidenceKind
  normalizedValue: SafeNormalizedValue       // 沿用 P2.1 安全标量 / 有界数组
  sourceId: string
  contentHash: string
}

type RecoverySourceRef = {
  sourceType: "STRUCTURED_TENDER_FACT" | "STRUCTURED_PROJECT_INDEX" | "STRUCTURED_INTERNAL_FACT" | "STRUCTURED_TOOL_RESULT"
  sourceId: string
  contentHash: string
}
```

实现阶段必须把未知字段、超长字符串、嵌套对象、raw 文本字段视为 `REJECTED`，不投影、不进 builder。

`REJECTED` / throw / timeout / malformed → **不投影、不重建 packet**，但 **消耗 1 个 cycle**。  
这 **不是** 任务失败。无隐藏重试。更新 attempt 状态后，下一拍先重跑 `routeEvaluation()`。

### D11. 预算账本 — ACCEPTED

现有 P2.0 `evaluationBudget` / `recoveryPolicy` 是唯一权威。不另立预算。

| 计数 | 规则 |
|---|---|
| recovery cycle | **每一次** adapter 尝试 +1，含 error / timeout / no-op / malformed |
| `externalSearches` | **仅**真正的外研动作 +1。V1 中 `SEARCH_PUBLIC_WEB` / `SEARCH_AWARD_HISTORY` 为 `NOT_SUPPORTED`，因此 V1 正常路径 **不得** 增加该计数 |
| `costUsd` | adapter 申报的有限界成本；非法数字 → `REJECTED`，cycle 仍消耗 |
| `maxJudgeCalls` | P2.3 **不消耗**（禁止调 Judge） |

每个 cycle **开始前**检查预算；adapter 返回后 **再检查一次**。  
任一侧耗尽 → 不再执行下一动作；重跑路由后停。

### D12. V1 支持域与支持动作 — ACCEPTED

**域**

| `taskType` | V1 |
|---|---|
| `TENDER_ANALYSIS` | `SUPPORTED` |
| `RESEARCH` | `NOT_SUPPORTED` |
| `EMAIL_DRAFT` | `NOT_SUPPORTED` |
| `GENERIC` | `NOT_SUPPORTED` |

非 `TENDER_ANALYSIS`：零 adapter 调用，`NO_SAFE_ACTION`。

**动作**

```
P2.3_SUPPORTED_ACTIONS = [
  "SEARCH_PROJECT_DOCUMENTS",  // 仅已有 structured document index / facts
  "SEARCH_INTERNAL_FACTS",     // 仅已有 internal structured facts
  "REFRESH_SOURCE_FACTS",      // 仅刷新已结构化 source facts
  "RECHECK_TOOL_RESULT",       // 仅复核已有 structured tool result
]

P2.3_NOT_SUPPORTED_ACTIONS = [
  "SEARCH_PUBLIC_WEB",         // 真外网
  "SEARCH_AWARD_HISTORY",      // 真外网 / 外部奖项库
  "READ_EXISTING_DOCUMENT",    // V1 视为原文/PDF/body 读取，禁止
]
```

`SEARCH_PROJECT_DOCUMENTS` **只允许**打在已经存在的结构化文档索引 / 结构化事实上。  
禁止用它做 PDF/OCR/原文加载的后门。

P2.0 合同仍可列出 `NOT_SUPPORTED` 动作；P2.3 V1 **不得执行**。

### D13. 不改标识符 — ACCEPTED

实现必须使用现有代码标识，不得再发明一套同义词。

P2.0 全量动作（合同/路由仍用）：  
`READ_EXISTING_DOCUMENT` · `SEARCH_PROJECT_DOCUMENTS` · `SEARCH_INTERNAL_FACTS` · `SEARCH_PUBLIC_WEB` · `SEARCH_AWARD_HISTORY` · `REFRESH_SOURCE_FACTS` · `RECHECK_TOOL_RESULT`

路由：`AUTO_RECOVER` · `AUTO_WAIT` · `AUTO_FINALIZE` · `AUTO_ABSTAIN` · `HUMAN_ESCALATE` · `POLICY_BLOCKED`

本阶段新增、仅 P2.3 拥有的标识：

- `P2.3_SUPPORTED_ACTIONS` / `P2.3_NOT_SUPPORTED_ACTIONS`
- `RecoverySnapshotDelta`
- `recoveryAttemptKey`
- `NO_PROGRESS`
- `NO_SAFE_ACTION`
- `EVIDENCE_READY_FOR_REEVALUATION`

### D14. `recoveryAttemptKey` + 审计 ledger（返回值，不落库） — ACCEPTED

现在就定义确定性 `recoveryAttemptKey`，供**未来** runtime 幂等使用。P2.3 **不** persistence、不 worker、不 outbox。

```
recoveryAttemptKey = sha256(canonicalJson({
  version: "a2p2-recovery-attempt-key-v1",
  semanticContractHash,
  packetHash,
  reasonCode,
  actionKind,
  requirementIds: sorted opaque ids,
}))
```

同一 `(packetHash, reasonCode, actionKind)` 再出现 → `NO_PROGRESS`（D9.4）。

每拍 ledger：`cycleIndex`、`recoveryAttemptKey`、`actionKind`、`requirementIds`、`adapterStatus`、`deltaAccepted`、`sourceSnapshotHashAfter`、`packetHashAfter`、`packetStatusAfter`、`routeDecisionBefore`、`routeDecisionAfter`、`externalResearchUsed`、`costUsd`、`noProgress`。

Ledger 只含 opaque id / enum / 计数 / hash。禁止原始文档与 PII。

### D15. 停机条件（全部硬停） — ACCEPTED

1. 本拍 `routeEvaluation()` 结果不是 `AUTO_RECOVER`
2. 重建 packet `status === "SUFFICIENT"` → `EVIDENCE_READY_FOR_REEVALUATION`（不调 Judge）
3. `cyclesUsed >= evaluationBudget.maxRecoveryCycles`（前后检查）
4. `costUsdUsed >= evaluationBudget.maxCostUsd`（前后检查）
5. 外研预算耗尽且交集只剩外研动作
6. planner `NO_SAFE_ACTION`
7. `NO_PROGRESS`（empty delta / 源 hash 不变 / `packetHash` 不变 / 重复 attempt key）
8. 新包 `PRIVACY_BLOCKED`
9. adapter error / timeout / malformed，且已无其他未尝试安全动作
10. 传入 `IN_PROGRESS`（拒绝启动）
11. `taskType` 不是 `TENDER_ANALYSIS`

停机后 **不** 自动 HUMAN UI、不发通知、不写评价终态到数据库、不调 `runSemanticJudge()`。

Adapter 错误 **不是** 任务失败，不得写成 `FAILURE` / 不得当 A3 诊断。

### D16. 成功长什么样 — ACCEPTED

Recovery **成功** 只表示下列之一：

- 重建 packet 为 `SUFFICIENT`，loop 返回 `EVIDENCE_READY_FOR_REEVALUATION`（**未**调 Judge）
- 或后续 `routeEvaluation()` 不再给出 `AUTO_RECOVER`（例如 `AUTO_ABSTAIN` / `HUMAN_ESCALATE` / `POLICY_BLOCKED`）

Recovery 本身 **不得** 宣称 `TASK_SUCCESS`。  
`SUFFICIENT ≠ TASK_SUCCESS` 继续成立。  
P2.2 若被调用，只发生在 **P2.3 之外** 的后续编排。

---

## 6. 循环（实现批准后）

```
parseTaskContract(contract)                         // 失败 → 零动作
buildEvidencePacket({ contract, structuredSources })

if recoveryState.status === IN_PROGRESS: return as-is
if taskType !== TENDER_ANALYSIS: NO_SAFE_ACTION; re-route; stop

loop at most evaluationBudget.maxRecoveryCycles:
  CHECK BUDGET (before)
  decision = routeEvaluation(...)                   // REQUIRED every cycle
  if decision !== AUTO_RECOVER: stop
  if packet.status === SUFFICIENT:                  // should already have been caught
    return EVIDENCE_READY_FOR_REEVALUATION          // NEVER runSemanticJudge

  plan = intersection(
    decision.allowedNextActions,
    contract.recoveryPolicy.allowedActions,
    P2.3_SUPPORTED_ACTIONS,
  )
  if empty or NO_PROGRESS key: mark NO_SAFE_ACTION / NO_PROGRESS; re-route; stop

  result = adapters[plan.action](request)           // exactly one attempt
  cyclesUsed += 1                                   // including error / no-op
  if true external research action: externalSearches += 1
  CHECK BUDGET (after)

  if error | timeout | malformed | REJECTED:
    do not project; do not treat as task FAILURE; no hidden retry
    record recoveryAttemptKey; continue to next cycle (which re-routes first)

  if NOT_FOUND | UNCHANGED | empty delta | source hash unchanged:
    NO_PROGRESS; re-route; stop or continue only if a different safe action remains

  project RecoverySnapshotDelta → canonical TENDER structured source
  packet = buildEvidencePacket(...)                 // existing P2.1 only
  if PRIVACY_BLOCKED: stop
  if packet.status === SUFFICIENT:
    return EVIDENCE_READY_FOR_REEVALUATION          // NEVER runSemanticJudge
  if packetHash unchanged: NO_PROGRESS; re-route; stop
```

内部可将 cycle 之间的 recovery 视为进行中，但 **不得** 把 `IN_PROGRESS` 泄漏给外部调用方作为终态。

---

## 7. 建议模块（尚未创建）

| 文件 | 职责 |
|---|---|
| `src/lib/autopilot/a2p2-recovery-types.ts` | `RecoverySnapshotDelta`、`recoveryAttemptKey`、`P2.3_SUPPORTED_ACTIONS`、ledger |
| `src/lib/autopilot/a2p2-recovery-plan.ts` | 三方交集 planner |
| `src/lib/autopilot/a2p2-recovery-merge.ts` | delta → TENDER structured projection；畸形 fail-closed |
| `src/lib/autopilot/a2p2-recovery-loop.ts` | 每拍重路由 + 预算 + NO_PROGRESS |
| `src/lib/autopilot/__tests__/a2p2-recovery-plan.test.ts` | 交集 / 域 / 不支持动作 |
| `src/lib/autopilot/__tests__/a2p2-recovery-loop.test.ts` | 每拍重路由、预算、无进展、禁止 Judge / 副作用 |

实现阶段才允许改 `scripts/test-all.sh` / `scripts/test-ci-unit.sh`，且必须 **并集** 保留全部现有 P2.0–P2.2 / Quote / Mention 车道。

---

## 8. 实现阶段验收（最终设计审查通过后才跑）

必须证明：

1. **每个 cycle 都先** `routeEvaluation()`；禁止入口只路由一次
2. 可执行动作 = `allowedNextActions ∩ allowedActions ∩ P2.3_SUPPORTED_ACTIONS`
3. `SEARCH_PUBLIC_WEB` / `SEARCH_AWARD_HISTORY` / `READ_EXISTING_DOCUMENT` 从未被执行
4. `SEARCH_PROJECT_DOCUMENTS` 只打 structured index/facts fixture，不碰 PDF/正文
5. Adapter 只产出合法 `RecoverySnapshotDelta`；raw body / PDF / HTML / 任意 JSON → `REJECTED`
6. 不直接 mutate packet；重建只经 TENDER 投影 + `buildEvidencePacket()`
7. packet 变 `SUFFICIENT` → `EVIDENCE_READY_FOR_REEVALUATION`，`runSemanticJudge` spy = 0
8. `RESEARCH` / `EMAIL_DRAFT` / `GENERIC` → 零 adapter
9. 每次 adapter 尝试（含 error/no-op）消耗 1 cycle；预算前后检查
10. empty delta / 源 hash 不变 / `packetHash` 不变 / 重复 `recoveryAttemptKey` → 停，无界 loop = 0
11. `recoveryAttemptKey` 确定性稳定；无 Prisma 写入
12. adapter error/timeout/malformed ≠ 任务 `FAILURE`；无隐藏重试
13. 不 import processor / prisma / evaluate-judge；无真实网络 adapter
14. `npx tsc --noEmit` PASS；相关单测 PASS

回归：全部现有 `a2p2-contract` / routing / evidence / semantic-judge 测试必须保持 PASS。

---

## 9. Production 锁（本 Gate 不关闭）

```
PRODUCTION_AUTOPILOT_CAPTURE = OFF
PRODUCTION_AUTOPILOT_PROCESSOR = OFF
AUTOPILOT_LLM_JUDGE_ENABLED = OFF / UNSET
AUTOPILOT_PRODUCTION_ACTIVATED = NO
PRODUCTION_MIGRATION_RUN_BY_P2_3 = NO

A2_P1_PRODUCTION_ORG_SCOPE = REQUIRED_BEFORE_ACTIVATION
A2_P1_CALL_BUDGET_OR_RATE_GUARD = REQUIRED_BEFORE_ACTIVATION
```

P2.3 即使实现合并进 main，也 **不** 授权打开上述开关。

---

## 10. 与相邻阶段

| 阶段 | 职责 |
|---|---|
| P2.0 | 合同、预算、白名单、路由 |
| P2.1 | 结构化证据包 + 隐私 + sufficiency |
| P2.2 | grounded semantic Judge（仅 SUFFICIENT；由后续编排调用） |
| **P2.3（本 Gate）** | 有界、白名单、确定性 auto recovery loop；不 Judge |
| P2.4 | Human by Exception 工作流 + 未来 runtime 接入 |
| A3 | 失败诊断 |

KPI 仍是 P2.0 设计目标，不是本阶段实测：自动评价 ≥ 95% · 人工 ≤ 5% · 假成功 ≤ 2% · 隐私泄漏 0 · 无界重试 0 · 高风险自动动作 0 · 恢复成功率 ≥ 70%。

---

## 11. 明确拒绝的替代方案

| 方案 | 拒绝理由 |
|---|---|
| 让 P2.2 Judge 带 tool 去搜证据 | `SEMANTIC_JUDGE_TOOL_COUNT = 0` 已锁 |
| P2.3 在 SUFFICIENT 后立刻 `runSemanticJudge()` | Lucas：后续独立编排才调 P2.2 |
| 在 P2.1 builder 内偷偷搜 | P2.1 合同禁止 AUTO RECOVERY |
| 直接改 `SemanticEvidencePacketV1` | 唯一路径必须经 P2.1 builder |
| Production worker + 新表 | 超前；前三相都是纯库 |
| 一拍执行全部 `allowedNextActions` | 预算不可审计，扇出过大 |
| 入口只路由一次然后连跑 3 拍 | 过期路由；必须每拍重跑 |
| 用网页搜索解决 CONFLICTING | 引入未信任第三值，等于选边 |
| 把 `READ_EXISTING_DOCUMENT` 做成 PDF/正文读取 | V1 `NOT_SUPPORTED` |
| 为 `RESEARCH` 合成 claims 以便恢复成功 | V1 域 `NOT_SUPPORTED` |
| Adapter 失败当任务失败 / 内部偷偷重试 | 不是 task failure；无隐藏重试 |

---

## 12. D1–D16 批准登记（Lucas review）

实现开始前以本表为准。状态 = 已纳入本文的 Lucas 决定，仍待最终设计审查签字后才能开写代码。

### D1 — ACCEPTED
同步有界纯库 loop。无 worker/cron/outbox/Prisma。返回不得留 `IN_PROGRESS`。  
**每个 recovery cycle 开始前必须重跑 `routeEvaluation()`**，不得只在入口路由一次。

### D2 — ACCEPTED
仅当**本拍** `routeEvaluation()` = `AUTO_RECOVER` 才执行 adapter。  
Reason：`AUTO_RECOVERY_MISSING_EVIDENCE` / `AUTO_RECOVERY_SOURCE_CONFLICT` / `AUTO_RECOVERY_GOAL_AMBIGUOUS`。

### D3 — ACCEPTED
不从 P2.2 语义结果启动 recovery。  
P2.3 **永不**调用 `runSemanticJudge()`。重建包 `SUFFICIENT` → STOP + `EVIDENCE_READY_FOR_REEVALUATION`。P2.2 只由后续独立编排调用。

### D4 — ACCEPTED
每拍恰好 1 个动作。每一次 adapter 尝试都计 1 recovery cycle（含 error/no-op）。无隐藏重试。

### D5 — ACCEPTED
不得直接 mutate `SemanticEvidencePacketV1`。  
唯一路径：`RecoverySnapshotDelta` → canonical TENDER structured source projection → 现有 P2.1 `buildEvidencePacket()` → rebuilt packet。

### D6 — ACCEPTED
可执行动作 =  
`router.allowedNextActions ∩ contract.recoveryPolicy.allowedActions ∩ P2.3_SUPPORTED_ACTIONS`。

### D7 — ACCEPTED
确定性规划顺序保留，但实际执行必须通过 D6。V1 不支持动作即使出现在顺序表中也不得执行。冲突只 refresh/recheck，不选边、不用公网。

### D8 — ACCEPTED
`TENDER_ANALYSIS` 以外域、隐私/策略阻断、三方交集为空 → `NO_SAFE_ACTION`，不空转。

### D9 — ACCEPTED
确定性 `NO_PROGRESS`：empty delta、structured source snapshot hash 不变、重建 `packetHash` 不变、重复 `(packetHash, reasonCode, actionKind)`。禁止无界 loop。

### D10 — ACCEPTED
Adapter 只返回严格有界 `RecoverySnapshotDelta`。禁止 raw body / PDF / HTML / 任意嵌套 JSON / 副作用。畸形或超时 ≠ 任务失败；不投影；消耗 cycle；下一拍先重路由。

### D11 — ACCEPTED
预算权威 = 现有 P2.0 `evaluationBudget` / `recoveryPolicy`。  
cycle：每次尝试都计。`externalSearches`：仅真正外研动作。前后都检查。P2.3 不消耗 judge budget。

### D12 — ACCEPTED
域：`TENDER_ANALYSIS=SUPPORTED`；`RESEARCH=NOT_SUPPORTED`；`EMAIL_DRAFT=NOT_SUPPORTED`；`GENERIC=NOT_SUPPORTED`。  
动作：`SEARCH_PUBLIC_WEB=NOT_SUPPORTED`；`SEARCH_AWARD_HISTORY=NOT_SUPPORTED`；`READ_EXISTING_DOCUMENT=NOT_SUPPORTED`（原文/PDF/body）。  
`SEARCH_PROJECT_DOCUMENTS` 仅针对已有 structured document index/facts。

### D13 — ACCEPTED
沿用已合入 P2.0–P2.2 标识。不另造路由/动作同义词。P2.3 仅新增 D13 列出的 recovery 专用标识。

### D14 — ACCEPTED
现在定义确定性 `recoveryAttemptKey`，供未来 runtime 幂等。P2.3 **无** persistence / runtime / outbox。Ledger 只随返回值。

### D15 — ACCEPTED
硬停集合见 §5 D15。Adapter 错误不是任务失败。不停后调 Judge、不写库、不发通知。

### D16 — ACCEPTED
成功 ≠ `TASK_SUCCESS`。`SUFFICIENT` 只表示 `EVIDENCE_READY_FOR_REEVALUATION`。`SUFFICIENT ≠ TASK_SUCCESS`。

最终设计审查签字前仍不得开写代码。

---

## 13. 本 Gate 产出

| 项 | 状态 |
|---|---|
| 本设计文档 | 本提交 |
| 实现 PR | 未开始 |
| 测试 | 未开始 |
| Runtime / Production | 禁止 |

```
IMPLEMENTATION_STARTED = NO
A2_P2_3_STATUS = READY_FOR_DESIGN_FINAL_REVIEW
A2_P2_4_STATUS = NOT_STARTED
A3_STATUS = NOT_STARTED
```

FINAL_STATUS = `A2_P2_3_DESIGN_GATE_READY_FOR_DESIGN_FINAL_REVIEW`

STOP. 最终设计审查通过前不实现。
