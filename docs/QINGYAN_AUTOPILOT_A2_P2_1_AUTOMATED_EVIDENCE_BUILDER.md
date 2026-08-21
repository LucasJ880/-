# 青砚 Autopilot A2-P2.1 — 自动化 Evidence Builder

日期：2026-08-21  
状态：**纯确定性证据包 + Sufficiency Gate**。未接入运行时，未调用 Judge，未执行 recovery，未授权 Production。

A2-P0 = CLOSED · A2-P1 = CLOSED · A2-P2.0 = CLOSED · A2-P2.1 = THIS PHASE  
A2-P2.2 / P2.3 / P2.4 = NOT_STARTED · A3 = NOT_STARTED

## 原则

- **Automation First**：按 Task Contract 自动选择 collector，无需人工点选证据。
- **Human by Exception**：缺证据时返回确定性状态（`INSUFFICIENT` / `NOT_EVALUABLE` / `CONFLICTING` / `PRIVACY_BLOCKED`），不在本阶段弹窗要用户补证据。
- P2.1 **只构建评价证据**，不判断 `TASK_SUCCESS` / `PARTIAL_SUCCESS` / `FAILURE`。
- **`SUFFICIENT` ≠ `TASK_SUCCESS`**。`EvidencePacket.status = SUFFICIENT` 只表示：下一评价阶段有足够的、结构合法的证据。它不表示 AI 结论为真。语义判定属于 A2-P2.2 Grounded Semantic Judge。

## 包版本

`A2P2_EVIDENCE_PACKET_VERSION = "a2p2-evidence-packet-v1"`

入口：`buildEvidencePacket({ contract, structuredSources })`  
复用 P2.0 唯一 parser：`parseTaskContract()`。禁止第二套 Task Contract。

## 管线

```
raw structured fact candidate
→ schema / safe-value validation
→ forbidden / raw-field scan
→ secret / privacy scan
→ normalization / PII redaction
→ requirement compatibility
→ EvidenceRef generation
→ dedupe
→ structural conflict detection
→ sufficiency assessment
→ Semantic Evidence Packet V1
```

任一步不得静默绕过隐私门。

## Canonical 源发现

P2.1 **只消费已结构化快照**，不查库、不读原文、不调 LLM、不外搜。

| 领域 | 仓库内 canonical 源 | P2.1 覆盖 |
|---|---|---|
| TENDER_ANALYSIS | Tender Understanding V2 `DocumentFactV2` / `CriticalFactType`（`closing_datetime`、`submission_method`、`pricing_method`、`evaluation_criteria`）+ 强制要求存在位。不读 PDF / `sourceSnippet` / `rawValue`。 | **IMPLEMENTED** |
| RESEARCH | 无与 P2.0 RESEARCH 需求对齐的、可安全进入 Judge 的 claim 库。Trade `ResearchBundleV1` 含页面正文，禁止当证据原文。 | **SAFE_INTERFACE_ONLY** |
| EMAIL_DRAFT | `PendingAction` / `EmailDraftPayload` 含邮件正文，禁止为证明语义质量而入库。仅接受 checklist 元数据快照。 | **SAFE_INTERFACE_ONLY** |
| GENERIC | 仅映射合同中已有 requirementId 的显式事实。空需求不得语义充分。 | **IMPLEMENTED** |

无安全结构化源时，collector 返回 `EVIDENCE_UNSUPPORTED_STRUCTURED_SOURCE`。这是正确失败，不是缺陷。

## 安全值合同

`normalizedValue` 只允许：`string` / `number` / `boolean` / `null`，或上述标量的有界数组。

- `SAFE_FACT_STRING_MAX = 500`
- 禁止 HTML、全文邮件、标书段落、raw model/tool 输出、任意嵌套 JSON
- `factSummary` 是规范化、有界、脱敏后的评价摘要，不是原文

## 隐私

复用 P2.0：`PUBLIC` · `INTERNAL` · `SENSITIVE` · `PROHIBITED`

接受态：`COLLECTED` · `REDACTED` · `BLOCKED`

- 密钥 / Bearer / API key / cookie / password / 私钥 / 带凭证的 DB URL：**fail-closed**。不脱敏后继续。必填证据含密钥 → 包级 `PRIVACY_BLOCKED`，不得静默变成 `INSUFFICIENT`。
- PII（邮箱、电话）确定性替换为 `[EMAIL]` / `[PHONE]`。不做 AI PII 检测。
- `PROHIBITED` 不得作为 Judge-ready fact 进入包。
- 递归拒绝 P2.0 forbidden keys 以及 `rawPrompt` / `rawEmail` / `documentText` / `fullBody` 等。

## 证据身份与 provenance

`EvidenceRef` = sha256(packet version + kind + requirementId + factKey + sourceType + sourceId + contentHash)。禁止随机 UUID。

`packetHash` 对规范化包内容哈希，**排除** `createdAt`。同源事实重放得到同一 ref 与同一 hash。

每条事实至少包含：`sourceType` · `sourceId` · `collectorVersion` · `contentHash`。locator 闭合为 page / section / field / recordKey / toolName。

## 去重、冲突、计数

- 同一 `EvidenceRef` 只计一次（`minimumEvidenceRefs` 计 unique accepted refs）。
- 同 `requirementId` + `factKey`、不同 `normalizedValue` → `CONFLICTING`。不自动选边。
- 需求允许的 `evidenceKinds` 不匹配 → 可留作 metadata，**不计入**该需求。
- 未知 `requirementId` → 拒绝。
- 缺证据 ≠ 负向事实。禁止把 “budget 未出现” 写成 `budget = 0`。

需求级状态：`READY` · `INSUFFICIENT` · `CONFLICTING` · `PRIVACY_BLOCKED` · `NOT_EVALUABLE`。  
**READY = 结构上够证据，不是需求语义为真。**

包级优先级：`PRIVACY_BLOCKED` > 必填 `CONFLICTING` > 必填不足 `INSUFFICIENT` > 已知域必填均 READY 则 `SUFFICIENT` > GENERIC 空需求 `NOT_EVALUABLE`。溢出 → `NOT_EVALUABLE`，禁止截断后假 `SUFFICIENT`。

## 界限

- `MAX_EVIDENCE_FACTS = 100`
- `MAX_FACTS_PER_REQUIREMENT = 20`
- `MAX_FACT_SUMMARY_LENGTH = 500`（`SAFE_FACT_STRING_MAX`）
- `MAX_PACKET_SAFE_TEXT_BYTES = 32 KB`

溢出行为：确定性拒绝评价（`EVIDENCE_PACKET_LIMIT_EXCEEDED` → `NOT_EVALUABLE`），不静默丢掉可能造成冲突的事实。

## Collector 权威

自动按 `taskContract.taskType` 选择。这是 **AUTO COLLECTION**。

缺失证据时 **不** 搜网、读额外文件、查 Gmail、跑 Tender Agent、调 tool。那是 **AUTO RECOVERY**，属于 A2-P2.3。

Email collector 不得发信、不得改 `automationLevel`。

## P2.0 路由适配

纯函数 `toEvaluationEvidenceStatus()`：

| EvidencePacketStatus | EvaluationEvidenceStatus |
|---|---|
| SUFFICIENT | SUFFICIENT |
| INSUFFICIENT | INSUFFICIENT |
| CONFLICTING | CONFLICTING |
| PRIVACY_BLOCKED | PRIVACY_BLOCKED |
| NOT_EVALUABLE | INSUFFICIENT |

**禁止**在生产 runtime 调用 `routeEvaluation()`。

Builder 不得改写 `riskClass` / `automationLevel` / `requireHumanForRisk` / `recoveryPolicy`。B1–B9 保持 CLOSED。HIGH / RESTRICTED 硬人工底线仍在 P2.0 parser/router。

## 与后续阶段

| 阶段 | 职责 |
|---|---|
| P2.1（本阶段） | 结构证据是否够、是否冲突、是否隐私阻断 |
| P2.2 | 在 grounded 证据上做语义 Judge（仍受确定性门约束） |
| P2.3 | 缺证据时的自动 recovery 执行（仍在白名单内） |
| P2.4 | 运行时接入 |

本阶段不改 `instrumentation.ts` / `processor.ts` / outbox / Prisma / 迁移。不持久化 Evidence Packet。

## 激活 blocker（沿用，本阶段不关闭）

- `A2_P1_PRODUCTION_ORG_SCOPE = REQUIRED_BEFORE_ACTIVATION`
- `A2_P1_CALL_BUDGET_OR_RATE_GUARD = REQUIRED_BEFORE_ACTIVATION`

Production Capture / Processor / LLM Judge 保持关闭。
