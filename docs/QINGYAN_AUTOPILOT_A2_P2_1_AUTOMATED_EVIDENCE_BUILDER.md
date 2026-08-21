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

入口 `parseStructuredSourcesSnapshot()` 做运行时闭合校验：未知顶层/嵌套字段、非法数组、非法 normalized value 一律 `NOT_EVALUABLE` + `EVIDENCE_INVALID_STRUCTURED_SOURCE`，且不得抛异常。

| 领域 | 仓库内 canonical 源 | P2.1 覆盖 |
|---|---|---|
| TENDER_ANALYSIS | `AnalysisResultV2`（`src/lib/tender-understanding/contract.ts`）。纯适配器 `adaptAnalysisResultV2()` 丢掉 `rawValue` / `snippet` / 文档正文。强制要求必须是 ACTIVE + `mandatory===true` + 有 evidence 的真实 requirement，禁止存在位 / `tender-mandatory` 伪造 sourceId。 | **IMPLEMENTED** |
| RESEARCH | 无安全 canonical claim 源。合成 claims **不得**变成 `SUFFICIENT`。 | **SAFE_INTERFACE_ONLY** |
| EMAIL_DRAFT | 无安全 canonical 元数据源。合成 boolean checklist **不得**变成 `SUFFICIENT`。 | **SAFE_INTERFACE_ONLY** |
| GENERIC | 仅映射合同中已有 requirementId 的显式事实。空需求不得语义充分。 | **IMPLEMENTED** |

无安全结构化源时，collector 返回 `EVIDENCE_UNSUPPORTED_STRUCTURED_SOURCE`。这是正确失败，不是缺陷。

## 隐私

复用 P2.0：`PUBLIC` · `INTERNAL` · `SENSITIVE` · `PROHIBITED`

- `candidate.privacyClass === PROHIBITED` 或扫描结果为 PROHIBITED：**不得进入** `evidenceFacts`。必填 → 包级 `PRIVACY_BLOCKED`；选填 → 拒绝并记审计，不得混入 `SUFFICIENT` 包。
- `factSummary` / `normalizedValue` / locator 可读字段：确定性 `[EMAIL]` / `[PHONE]`。任一处脱敏 → `acceptance=REDACTED`、`privacyClass=SENSITIVE`。
- `sourceId` 必须是不透明标识符。含 PII / 密钥 / 自由文本 → 拒绝该事实，**不得**把邮箱 sourceId 收成 `[EMAIL]`。
- HTML/markup 载荷 fail-closed：`EVIDENCE_HTML_REJECTED`。
- `privacySummary.prohibitedCount` 计入 SECRET / RAW / PROHIBITED_CLASS。

## 证据身份与 provenance

`canonicalFactHash` **始终本地**由脱敏后的 kind + requirementId + factKey + normalizedValue + sourceType + sourceId 计算。上游 64-hex **不得**覆盖身份，只可写入 `provenance.sourceContentHash`。

`EvidenceRef` = sha256(packet version + kind + requirementId + factKey + sourceType + sourceId + **canonicalFactHash**)。禁止随机 UUID。

`packetHash` 对 Judge-facing 包内容哈希，**仅排除** `provenance.createdAt`。稳定 provenance（collectorVersion / extractorVersion / sourceContentHash / sourceObservedAt）计入 hash。`rejectedFacts` / `diagnostics` 排序后再哈希。

## 界限

- `MAX_EVIDENCE_FACTS = 100`
- `MAX_FACTS_PER_REQUIREMENT = 20`
- `MAX_FACT_SUMMARY_LENGTH = 500`
- `MAX_PACKET_SAFE_TEXT_BYTES = 32 KB`（完整 Judge-facing payload，不仅是 factSummary 列表）

溢出：`EVIDENCE_PACKET_LIMIT_EXCEEDED` → `NOT_EVALUABLE`，输出空 facts + 溢出诊断，**禁止**截断后再算成 `SUFFICIENT`。溢出输出本身必须有界。

需求级状态：`READY` · `INSUFFICIENT` · `CONFLICTING` · `PRIVACY_BLOCKED` · `NOT_EVALUABLE`。  
**READY = 结构上够证据，不是需求语义为真。**

包级优先级：`PRIVACY_BLOCKED` > 溢出 `NOT_EVALUABLE` > 必填 `CONFLICTING` > 必填不足 `INSUFFICIENT` > 已知域必填均 READY 则 `SUFFICIENT` > GENERIC 空需求 `NOT_EVALUABLE`。

同一 `EvidenceRef` 只计一次。同 `requirementId` + `factKey`、不同 `normalizedValue` → `CONFLICTING`，不自动选边。kind 不匹配不计分。未知 requirementId 拒绝。缺证据 ≠ 负向事实。

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
