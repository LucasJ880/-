# 青砚 Autopilot A2-P2.0 — 自动评价控制合同

日期：2026-08-21  
状态：**契约 + 纯确定性路由**。未接入运行时，未授权 Production。

A2-P0 = CLOSED · A2-P1 = CLOSED · A2-P2.0 = THIS PHASE  
A2-P2.1 / P2.2 / P2.3 / P2.4 = NOT_STARTED · A3 = NOT_STARTED

## 原则

- **Automation First**：默认自动完成评价。
- **Human by Exception**：只有高风险、证据冲突且无法恢复、预算耗尽（中高风险未决）、隐私/策略硬阻断才升级人工。
- `UNKNOWN` **不会**自动变成人工评审。先考虑 `AUTO_RECOVER`，低风险再考虑 `AUTO_ABSTAIN`。
- `AUTO_FINALIZE` 只结束**评价记录**，不授权对外业务动作（发信、投标、改价、签字、付款）。

本阶段回答：任务预期是什么、需要什么证据、风险与恢复预算、何时停手升级。  
本阶段**不**回答：这次任务语义上是否正确（P2.1+），以及 Agent 为何失败（A3）。

## A2 vs A3

| 阶段 | 问题 |
|---|---|
| A2 Evaluate | 这次任务好不好？能否自动定论或恢复证据？ |
| A3 Diagnose | 为什么失败？系统怎么修？ |

A2 不得自动创建 A3 诊断。

## 风险类

`LOW` · `MEDIUM` · `HIGH` · `RESTRICTED`

由合同/策略决定，LLM 不得改风险。概念上：研究/分类/标书分析偏 LOW；报价/邮件草稿偏 MEDIUM；对外承诺/法律接受偏 HIGH；付款/签章/投标提交/权限变更偏 RESTRICTED。

HIGH / RESTRICTED 在路由第 2 步即 `HUMAN_ESCALATE` 或 `POLICY_BLOCKED`，评价器不得自动执行。

## 自动化等级

`L0_HUMAN_CONTROLLED` … `L5_RESTRICTED`

A2 评价恢复只允许 READ / SEARCH / VERIFY，上限 `L2_AUTO_PREPARE`。L4/L5 副作用不得由 Evaluation 单独授权。

## 恢复白名单

允许：`READ_EXISTING_DOCUMENT` · `SEARCH_PROJECT_DOCUMENTS` · `SEARCH_INTERNAL_FACTS` · `SEARCH_PUBLIC_WEB` · `SEARCH_AWARD_HISTORY` · `REFRESH_SOURCE_FACTS` · `RECHECK_TOOL_RESULT`

禁止作为评价恢复动作：`SEND_EMAIL` · `SUBMIT_BID` · `APPROVE_QUOTE` · `CHANGE_PRICE` · `SIGN_CONTRACT` · `MAKE_PAYMENT` · `DELETE_RECORD` · `CHANGE_RBAC` · `CHANGE_PRODUCTION_CONFIG`

默认 `maxRecoveryCycles = 3`。有限、非负、禁止 Infinity。P2.0 **不执行**这些动作。

## 预算默认值

`maxJudgeCalls = 2` · `maxRecoveryCycles = 3` · `maxExternalSearches = 5` · `maxCostUsd = 0.25`

P2.0 不计费，只锁定有界常量。

## 隐私

`PUBLIC` · `INTERNAL` · `SENSITIVE` · `PROHIBITED`

`PROHIBITED` 不得进入 Judge。路由 fail-closed：`POLICY_BLOCKED` / `POLICY_BLOCKED_PRIVACY`。  
实际扫描在 **P2.1**。

合法证据 kind：`SOURCE_FACT` · `TOOL_RESULT` · `ARTIFACT_FACT` · `BUSINESS_STATE` · `RUNTIME_FACT`。  
不含 `RAW_PROMPT` / `RAW_OUTPUT` / `RAW_EMAIL` / `RAW_TENDER` / `RAW_CONTRACT` / `RAW_TOOL_PAYLOAD`。

任务合同 `goalSummary` 只存规范化元数据，禁止 raw prompt / 邮件正文 / 标书正文 / tool payload。

## 合同权威

- 唯一运行时校验入口：`parseTaskContract()`。未知顶层字段拒绝；递归拒绝 forbidden keys；只重建批准字段。
- 显式/工作流合同存在但畸形 → `INVALID_*` fail-closed（`RESTRICTED` + `L0_HUMAN_CONTROLLED` + 恢复关闭），不得降到领域模板。
- `verdictState`：`NOT_EVALUATED` | `PROPOSED` | `ACCEPTED` | `ABSTAINED`。语义 outcome 不得暗示 final。仅 `ACCEPTED` 可走 `AUTO_FINALIZE`。
- 权威是 `verdictState`，不是 outcome 形状，也不是遗留 `final` 布尔。
- 兼容矩阵（不合法组合 fail-closed，禁止静默归一化）：
  - `NOT_EVALUATED` → `UNKNOWN` / 缺省
  - `PROPOSED` → `TASK_SUCCESS` / `PARTIAL_SUCCESS` / `FAILURE` / `UNKNOWN`
  - `ACCEPTED` → `TASK_SUCCESS` / `PARTIAL_SUCCESS` / `FAILURE`
  - `ABSTAINED` → 仅 `UNKNOWN`
- `hasEvaluatableRequirements()`：GENERIC 且 `requirements.length === 0` 时，**不得**仅因未来 Judge 提议就产出语义 `TASK_SUCCESS` / `PARTIAL_SUCCESS`。P2.2 才允许在后续合同解析补齐 grounded requirements 后宣称成功。
- `AutomationLevel` 描述任务权威。Evaluation 恢复上限始终 `READ_SEARCH_VERIFY_ONLY`。L0 必人工；L5 fail-closed；L4 可 inspect，Evaluation 单独不授权对外动作。

## 路由优先级

1. 未校验合同 / 隐私 / 受限动作 → `POLICY_BLOCKED`
2. L5 → `POLICY_BLOCKED`；L0 → `HUMAN_ESCALATE`
3. legal / financial / external side effect / irreversible → `HUMAN_ESCALATE`
4. `escalationPolicy.requireHumanForRisk` 命中当前风险 → `HUMAN_ESCALATE`
5. `recoveryState = IN_PROGRESS` → `AUTO_WAIT`（不重复调度；歧义也不得抢跑）
6. `goalAmbiguous`：仍有 READ/SEARCH/VERIFY 恢复 → `AUTO_RECOVER` / `AUTO_RECOVERY_GOAL_AMBIGUOUS`；耗尽/不允许 → `HUMAN_ESCALATION_GOAL_AMBIGUOUS`
7. 证据不足/冲突 + 仍有安全恢复动作 → `AUTO_RECOVER`（Judge 预算耗尽不阻断本地读/搜；外搜预算只过滤外搜）
8. `ACCEPTED` + 证据充足 + 兼容 outcome + 策略允许 → `AUTO_FINALIZE`（只结束评价记录）
9. 低风险未决 → `AUTO_ABSTAIN`

`UNKNOWN` 默认不是人工。预算：恢复周期/全局费用耗尽才停止全部恢复。

## 领域模板

| 模板 | 风险 | 等级 | 说明 |
|---|---|---|---|
| TENDER_ANALYSIS | LOW | L1 | 截止日期等保守必填；读/搜恢复 |
| RESEARCH | LOW | L1 | 问题已答 + 来源证据 |
| EMAIL_DRAFT | MEDIUM | L2 | 不得隐含 `SEND_EMAIL` |
| GENERIC | MEDIUM | L1 | 无编造需求；无外网研究 |

解析优先级：显式合同 → 工作流合同 → 领域模板 → GENERIC。显式/工作流若存在且不安全则 fail-closed，不解析对话或客户正文。

每个合同带 provenance：`contractVersion` · `source` · `sourceId?` · `resolverVersion` · `createdAt`。

## 后续边界（未实现）

- **P2.1**：真实 Evidence Packet + 隐私扫描（仍不执行业务副作用）
- **P2.2**：语义 Judge（证据门后才能宣称需求满足）。GENERIC 空需求在补齐 grounded requirements 之前不得产出 `TASK_SUCCESS`。
- **P2.3**：有界自动恢复 worker
- **P2.4**：人工升级工作流（Human by Exception）
- **A3**：失败诊断

## 与 A2-P0 / A2-P1

运行时顺序不变：A1 overlay → mapped event → A2-P0 → optional A2-P1 Judge。  
P2.0 模块未接入 processor / Judge / outbox。

## Production

仍保持 Capture / Processor / LLM Judge 关闭。  
`A2_P1_PRODUCTION_ORG_SCOPE` 与 `A2_P1_CALL_BUDGET_OR_RATE_GUARD` 仍为 `REQUIRED_BEFORE_ACTIVATION`。

## KPI（设计目标，非实测）

自动评价 ≥ 95% · 人工升级 ≤ 5% · 假成功 ≤ 2%（目标 1%）· 隐私泄漏 0 · 无界重试 0 · 高风险自动动作 0 · 恢复成功率 ≥ 70%。
