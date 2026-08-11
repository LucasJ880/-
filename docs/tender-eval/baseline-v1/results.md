# Qingyan Tender Real Evaluation — Run Report

- Contract: tender-eval/v1
- Run: `20260810-235654Z-4f082cd`（2026-08-10T23:56:54.277Z）
- Git: `4f082cdbeccb`
- Lane: DETERMINISTIC（TENDER_ANALYSIS_LLM=off，model=null）
- Versions: tender-auto-analysis-v1 / tender-analysis-prompt-v1 / tender-page-parse-v1
- 匹配阈值：token coverage ≥ 0.35（MATCHED），锚词判定见 evaluate.ts 头注

## case-a0-rcmp-fixture

RCMP RISO 合成 fixture（过拟合对照）

- 来源：SYNTHETIC（src/lib/tender-auto-analysis/__tests__/fixtures/rcmp-backpack-pages.ts（真实招标的人工转写节选，页码/正文与原件有出入））
- Golden 状态：PENDING_HUMAN_CONFIRMATION
- 文档 1 份 / 15 页

### Scorecard

| 指标 | 值 | 说明 |
| --- | --- | --- |
| Requirement Recall (strict / lenient) | 100.0% / 100.0% | golden 16 条 |
| Mandatory Recall (strict / lenient) | 100.0% / 100.0% | mandatory golden 16 条 |
| Requirement Precision | 100.0% | 系统输出 16 条 |
| False Positive Rate | 0.0% | Duplicate Rate 0.0% |
| Critical Fact Accuracy | 94.4% | 关键事实 18 项；全事实 95.7%（23 项） |
| 值对证据错（计失败） | 1 项 | CORRECT_VALUE_BAD_EVIDENCE |
| Evidence Coverage / Accuracy | 100.0% / 100.0% | Unsupported Claim Rate 0.0% |
| Risk Recall | 80.0% | golden 5 条；CRITICAL_RISK_MISSED = 1 |
| 幻觉风险行 | 0 | 与文档无关主题的风险输出 |
| Useful Clarification Rate | 100.0% | 系统提问 8 条 |
| Already Answered Rate | 0.0% | 幻觉提问 0 条 |
| NECESSARY 澄清覆盖率 | 80.0% | golden NECESSARY 主题被问到的比例 |
| 歧义处理 | 1/1 OK | expectedUnknown 违规 0 |

### MISSED Requirements（0/16）

（无）

### FALSE_POSITIVE 输出（0）

（无）

### 未达标事实（1/23）

- `F0-ENQUIRY`【critical】: CORRECT_VALUE_BAD_EVIDENCE（候选: closing_datetime, enquiry_deadline_minus_5_days, recommendation_send_quantity_clarifications）

### 风险判定

`RISK0-QTY[IMPORTANT]`(DETECTED)、`RISK0-SUBMISSION[CRITICAL]`(DETECTED)、`RISK0-DELIVERY[IMPORTANT]`(DETECTED)、`RISK0-ELIGIBILITY[CRITICAL]`(MISSED)、`RISK0-TECH-STANDARDS[IMPORTANT]`(DETECTED)

### 澄清问题判定

- [NECESSARY] Call-up 的最小 / 最大 / 典型订购数量分别是多少？询价建议不晚于 2026-08-13（截标时区标签 MDT；closing=August 18, 2026 14:00…
- [NECESSARY] 「Up to 1500 per contract period」的准确含义是合同期硬上限、估算值，还是评标用数量？询价建议不晚于 2026-08-13（截标时区标签 MDT；clo…
- [NECESSARY] 投标阶段是否必须提交样品（sample required at bid time）？若需要，数量、费用与退回规则是什么？询价建议不晚于 2026-08-13（截标时区标签 MDT；…
- [NECESSARY] 防水/抗水测试所依据的具体标准（方法、时长、验收指标）是什么？询价建议不晚于 2026-08-13（截标时区标签 MDT；closing=August 18, 2026 14:00…
- [USEFUL] 1000D 面料要求的适用范围（主壳/部件/等同材料是否接受）如何界定？询价建议不晚于 2026-08-13（截标时区标签 MDT；closing=August 18, 2026 …
- [USEFUL] 尺寸/容量的官方测量方法（measurement method）以哪份附件为准？询价建议不晚于 2026-08-13（截标时区标签 MDT；closing=August 18, 2…
- [USEFUL] 拉链 / 织带 / 缝线的具体性能标准与测试方法分别是什么？询价建议不晚于 2026-08-13（截标时区标签 MDT；closing=August 18, 2026 14:00 …
- [USEFUL] 评标用 7,500（或年度 1,500×年数）是否仅用于评估，而不构成任何采购承诺？询价建议不晚于 2026-08-13（截标时区标签 MDT；closing=August 18,…

未被问到的 NECESSARY 主题：`CLAR0-OVERSEAS`

### 歧义处理

`AMB0-QTY(CLARIFICATION_REQUIRED)`(OK)

## case-a-rcmp-riso-real

RCMP Backpacks for Cadets — RISO M5000-25-3574-A（真实原件 43 页）

- 来源：REAL（fixtures/private/M5000-25-3574 - A - RFP - English.pdf（公开政府招标原件，本地加载，不提交））
- Golden 状态：PENDING_HUMAN_CONFIRMATION
- 文档 1 份 / 43 页

### Scorecard

| 指标 | 值 | 说明 |
| --- | --- | --- |
| Requirement Recall (strict / lenient) | 44.7% / 65.8% | golden 38 条 |
| Mandatory Recall (strict / lenient) | 44.7% / 65.8% | mandatory golden 38 条 |
| Requirement Precision | 80.7% | 系统输出 31 条 |
| False Positive Rate | 0.0% | Duplicate Rate 19.4% |
| Critical Fact Accuracy | 77.3% | 关键事实 22 项；全事实 65.8%（38 项） |
| 值对证据错（计失败） | 1 项 | CORRECT_VALUE_BAD_EVIDENCE |
| Evidence Coverage / Accuracy | 100.0% / 100.0% | Unsupported Claim Rate 0.0% |
| Risk Recall | 37.5% | golden 8 条；CRITICAL_RISK_MISSED = 3 |
| 幻觉风险行 | 1 | 与文档无关主题的风险输出 |
| Useful Clarification Rate | 77.8% | 系统提问 9 条 |
| Already Answered Rate | 0.0% | 幻觉提问 1 条 |
| NECESSARY 澄清覆盖率 | 100.0% | golden NECESSARY 主题被问到的比例 |
| 歧义处理 | 2/2 OK | expectedUnknown 违规 0 |

### MISSED Requirements（13/38）

- `R-SUB-EMAIL-DEADLINE`【mandatory】（CRITICAL）
- `R-SUB-3PDF`【mandatory】（CRITICAL）
- `R-SUB-5MB`【mandatory】（CRITICAL）
- `R-SUB-PRICE-SEPARATION`【mandatory】（CRITICAL）
- `R-COM-FX`【mandatory】（HIGH）
- `R-CERT-INTEGRITY`【mandatory】（HIGH）
- `R-CERT-FCP`【mandatory】（NORMAL）
- `R-ELIG-RECIPROCAL`【mandatory】（CRITICAL）
- `R-PERF-30DAYS`【mandatory】（CRITICAL）
- `R-PERF-CONFIRM-24H`【mandatory】（HIGH）
- `R-PERF-DDP`【mandatory】（CRITICAL）
- `R-PERF-PACKING-SLIP`【mandatory】（NORMAL）
- `R-PERF-UNLOADING`【mandatory】（NORMAL）

### PARTIAL Requirements（8）

- `R-M1` ← `M1`（coverage 0.176）
- `R-M2` ← `M2`（coverage 0.25）
- `R-M10` ← `M10`（coverage 0.273）
- `R-M14` ← `M14`（coverage 0.25）
- `R-SUB-SUBSTANTIATION` ← `GEN-004`（coverage 0）
- `R-PERF-ENV-PACKAGING` ← `GEN-002`（coverage 0.294）
- `R-PERF-QUARTERLY` ← `GEN-013`（coverage 0.125）
- `R-PERF-FORCED-LABOUR` ← `GEN-014`（coverage 0.133）

### FALSE_POSITIVE 输出（0）

（无）

### 未达标事实（13/38）

- `F-ENQUIRY-DEADLINE`【critical】: CORRECT_VALUE_BAD_EVIDENCE（候选: closing_datetime, enquiry_deadline_minus_5_days, recommendation_send_quantity_clarifications）
- `F-SUBMIT-EMAIL`【critical】: NOT_EXTRACTED
- `F-DELIVERY-POINT`【critical】: NOT_EXTRACTED
- `F-PRICING-CAD-DDP`: NOT_EXTRACTED
- `F-CALLUP-MAX`【critical】: NOT_EXTRACTED
- `F-CALLUP-10K`: NOT_EXTRACTED
- `F-INSURANCE-NONE`: NOT_EXTRACTED
- `F-QUARTERLY-REPORT`: NOT_EXTRACTED
- `F-LAWS`: NOT_EXTRACTED
- `F-FX-BAN`【critical】: NOT_EXTRACTED
- `F-PAYMENT`: NOT_EXTRACTED
- `F-CONTACT`: NOT_EXTRACTED
- `F-CLIENT-REF`: NOT_EXTRACTED

### 风险判定

`RISK-ELIGIBILITY[CRITICAL]`(MISSED)、`RISK-SUBMISSION-REJECT[CRITICAL]`(DETECTED)、`RISK-SUBSTANTIATION[CRITICAL]`(MISSED)、`RISK-PRICING-TABLE[CRITICAL]`(MISSED)、`RISK-QTY-NO-GUARANTEE[IMPORTANT]`(DETECTED)、`RISK-DELIVERY-PRESSURE[IMPORTANT]`(DETECTED)、`RISK-FX[IMPORTANT]`(MISSED)、`RISK-ADMIN-REPORTING[IMPORTANT]`(MISSED)

幻觉风险行：「4. 技术合规风险：M1–M15 未评估前存在样品/测试标准不清。…」

### 澄清问题判定

- [NECESSARY] Call-up 的最小 / 最大 / 典型订购数量分别是多少？询价建议不晚于 2026-08-13（截标时区标签 MDT；closing=August 18, 2026 14:00…
- [NECESSARY] 「Up to 1500 per contract period」的准确含义是合同期硬上限、估算值，还是评标用数量？询价建议不晚于 2026-08-13（截标时区标签 MDT；clo…
- [HALLUCINATED] 投标阶段是否必须提交样品（sample required at bid time）？若需要，数量、费用与退回规则是什么？询价建议不晚于 2026-08-13（截标时区标签 MDT；…
- [USEFUL] 防水/抗水测试所依据的具体标准（方法、时长、验收指标）是什么？询价建议不晚于 2026-08-13（截标时区标签 MDT；closing=August 18, 2026 14:00…
- [NECESSARY] 是否允许海外制造（overseas manufacturing）？若允许，原产地声明与 Reciprocal Procurement 如何衔接？询价建议不晚于 2026-08-13…
- [USEFUL] 1000D 面料要求的适用范围（主壳/部件/等同材料是否接受）如何界定？询价建议不晚于 2026-08-13（截标时区标签 MDT；closing=August 18, 2026 …
- [USEFUL] 尺寸/容量的官方测量方法（measurement method）以哪份附件为准？询价建议不晚于 2026-08-13（截标时区标签 MDT；closing=August 18, 2…
- [LOW_VALUE] 拉链 / 织带 / 缝线的具体性能标准与测试方法分别是什么？询价建议不晚于 2026-08-13（截标时区标签 MDT；closing=August 18, 2026 14:00 …
- [USEFUL] 评标用 7,500（或年度 1,500×年数）是否仅用于评估，而不构成任何采购承诺？询价建议不晚于 2026-08-13（截标时区标签 MDT；closing=August 18,…

### 歧义处理

`AMB-QTY-BASIS(CLARIFICATION_REQUIRED)`(OK)、`AMB-FIRM-VS-ESTIMATED(FLAGGED)`(OK)

## case-b-dsbn-window-coverings

DSBN 窗饰供应与安装 RFP + Addendum-01（业务域泛化）

- 来源：NEAR_REAL_RECONSTRUCTED（scripts/intelligence-report-eval/sample-input-01-curtain-tender.json（真实 DSBN 招标浓缩转写，非完整原件））
- Golden 状态：PENDING_HUMAN_CONFIRMATION
- 文档 2 份 / 2 页

### Scorecard

| 指标 | 值 | 说明 |
| --- | --- | --- |
| Requirement Recall (strict / lenient) | 0.0% / 0.0% | golden 12 条 |
| Mandatory Recall (strict / lenient) | 0.0% / 0.0% | mandatory golden 11 条 |
| Requirement Precision | N/A | 系统输出 0 条 |
| False Positive Rate | N/A | Duplicate Rate N/A |
| Critical Fact Accuracy | 0.0% | 关键事实 11 项；全事实 0.0%（15 项） |
| 值对证据错（计失败） | 0 项 | CORRECT_VALUE_BAD_EVIDENCE |
| Evidence Coverage / Accuracy | N/A / N/A | Unsupported Claim Rate N/A |
| Risk Recall | 0.0% | golden 5 条；CRITICAL_RISK_MISSED = 2 |
| 幻觉风险行 | 3 | 与文档无关主题的风险输出 |
| Useful Clarification Rate | 0.0% | 系统提问 9 条 |
| Already Answered Rate | 11.1% | 幻觉提问 6 条 |
| NECESSARY 澄清覆盖率 | 0.0% | golden NECESSARY 主题被问到的比例 |
| 歧义处理 | 1/3 OK | expectedUnknown 违规 0 |

### MISSED Requirements（12/12）

- `RB-NFPA`【mandatory】（CRITICAL）
- `RB-FIRE-CODE`【mandatory】（CRITICAL）
- `RB-CSA`【mandatory】（HIGH）
- `RB-WARRANTY`【mandatory】（HIGH）
- `RB-FIRST-QUALITY`【mandatory】（NORMAL）
- `RB-BATON`【mandatory】（HIGH）
- `RB-MEASURE`【mandatory】（NORMAL）
- `RB-REMOVAL`【mandatory】（NORMAL）
- `RB-SUPPLY-INSTALL`【mandatory】（HIGH）
- `RB-INSURANCE`【mandatory】（CRITICAL）
- `RB-AFFIDAVIT`【mandatory】（HIGH）
- `RB-SAMPLES-SHORTLIST`（NORMAL）

### FALSE_POSITIVE 输出（0）

（无）

### 未达标事实（15/15）

- `FB-BUYER`【critical】: NOT_EXTRACTED
- `FB-CLOSING`【critical】: NOT_EXTRACTED
- `FB-TERM`【critical】: NOT_EXTRACTED
- `FB-SCOPE`【critical】: NOT_EXTRACTED
- `FB-MOTORIZED`【critical】: NOT_EXTRACTED
- `FB-NFPA`【critical】: NOT_EXTRACTED
- `FB-FIRE-CODE`: NOT_EXTRACTED
- `FB-WARRANTY`【critical】: NOT_EXTRACTED
- `FB-EVAL-TOTAL`【critical】: NOT_EXTRACTED
- `FB-EVAL-PRICE-WEIGHT`: NOT_EXTRACTED
- `FB-INSURANCE`【critical】: NOT_EXTRACTED
- `FB-SAMPLES`【critical】: NOT_EXTRACTED
- `FB-LOCAL-INSTALL`: NOT_EXTRACTED
- `FB-AFFIDAVIT`【critical】: NOT_EXTRACTED
- `FB-ADDENDA-COUNT`: NOT_EXTRACTED

### 风险判定

`RISKB-NO-QUANTITIES[CRITICAL]`(MISSED)、`RISKB-SERVICE-WEIGHTED[CRITICAL]`(MISSED)、`RISKB-MOTOR-SPECS[IMPORTANT]`(MISSED)、`RISKB-FIRE-CERT[IMPORTANT]`(MISSED)、`RISKB-ADDENDUM-TRACKING[IMPORTANT]`(MISSED)

幻觉风险行：「1. 数量歧义：合同期上限 vs 年度评标量；7,500 仅为评估合计，非保证采购。…」；「3. 履约风险：DDP Regina + 短周期 call-up（如 30 days）对库存与物流的压力。…」；「4. 技术合规风险：M1–M15 未评估前存在样品/测试标准不清。…」

### 澄清问题判定

- [HALLUCINATED] Call-up 的最小 / 最大 / 典型订购数量分别是多少？询价建议不晚于 （截标日未知，待补）
- [HALLUCINATED] 「Up to 1500 per contract period」的准确含义是合同期硬上限、估算值，还是评标用数量？询价建议不晚于 （截标日未知，待补）
- [ALREADY_ANSWERED] 投标阶段是否必须提交样品（sample required at bid time）？若需要，数量、费用与退回规则是什么？询价建议不晚于 （截标日未知，待补）
- [LOW_VALUE] 防水/抗水测试所依据的具体标准（方法、时长、验收指标）是什么？询价建议不晚于 （截标日未知，待补）
- [HALLUCINATED] 是否允许海外制造（overseas manufacturing）？若允许，原产地声明与 Reciprocal Procurement 如何衔接？询价建议不晚于 （截标日未知，待补）
- [HALLUCINATED] 1000D 面料要求的适用范围（主壳/部件/等同材料是否接受）如何界定？询价建议不晚于 （截标日未知，待补）
- [LOW_VALUE] 尺寸/容量的官方测量方法（measurement method）以哪份附件为准？询价建议不晚于 （截标日未知，待补）
- [HALLUCINATED] 拉链 / 织带 / 缝线的具体性能标准与测试方法分别是什么？询价建议不晚于 （截标日未知，待补）
- [HALLUCINATED] 评标用 7,500（或年度 1,500×年数）是否仅用于评估，而不构成任何采购承诺？询价建议不晚于 （截标日未知，待补）

未被问到的 NECESSARY 主题：`CLARB-QUANTITIES`、`CLARB-PRICING-FORMAT`、`CLARB-MOTOR`、`CLARB-SUBMISSION`

### 歧义处理

`AMBB-QUANTITIES(CLARIFICATION_REQUIRED)`(OK)、`AMBB-MOTOR-SPECS(CLARIFICATION_REQUIRED)`(MISSED)、`AMBB-SUBMISSION-METHOD(CLARIFICATION_REQUIRED)`(MISSED)
