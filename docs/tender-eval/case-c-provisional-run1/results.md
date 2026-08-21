# Qingyan Tender Real Evaluation — Run Report

- Contract: tender-eval/v1
- Run: `20260821-174440Z-10218b3`（2026-08-21T17:44:40.518Z）
- Git: `10218b3860da`
- Lanes: V1 + V2
- V1 versions: tender-auto-analysis-v1 / tender-analysis-prompt-v1 / tender-page-parse-v2
- 匹配阈值：token coverage ≥ 0.35（MATCHED），锚词判定见 evaluate.ts 头注

## case-a0-rcmp-fixture — V1 vs V2 对照

| 指标 | V1 | V2 |
| --- | --- | --- |
| Mandatory Recall (strict) | 100.0% | 75.0% |
| Mandatory Recall (lenient) | 100.0% | 75.0% |
| Requirement Recall (strict) | 100.0% | 75.0% |
| Requirement Precision | 100.0% | 48.0% |
| False Positive Rate | 0.0% | 52.0% |
| Critical Fact Accuracy | 94.4% | 83.3% |
| Evidence Accuracy | 100.0% | 100.0% |
| Unsupported Claim Rate | 0.0% | 0.0% |
| Risk Recall | 80.0% | 60.0% |
| CRITICAL_RISK_MISSED | 1 | 0 |
| Clarification Hallucinations | 0 | 0 |
| CROSS_DOMAIN_LEAK | 0 | 0 |
| expectedUnknown 违规 | 0 | 0 |

## case-a-rcmp-riso-real — V1 vs V2 对照

| 指标 | V1 | V2 |
| --- | --- | --- |
| Mandatory Recall (strict) | 44.7% | 81.6% |
| Mandatory Recall (lenient) | 65.8% | 89.5% |
| Requirement Recall (strict) | 44.7% | 81.6% |
| Requirement Precision | 80.7% | 31.2% |
| False Positive Rate | 0.0% | 31.2% |
| Critical Fact Accuracy | 77.3% | 72.7% |
| Evidence Accuracy | 100.0% | 100.0% |
| Unsupported Claim Rate | 0.0% | 0.0% |
| Risk Recall | 37.5% | 87.5% |
| CRITICAL_RISK_MISSED | 3 | 0 |
| Clarification Hallucinations | 1 | 0 |
| CROSS_DOMAIN_LEAK | 2 | 0 |
| expectedUnknown 违规 | 0 | 0 |

## case-b-dsbn-window-coverings — V1 vs V2 对照

| 指标 | V1 | V2 |
| --- | --- | --- |
| Mandatory Recall (strict) | 0.0% | 72.7% |
| Mandatory Recall (lenient) | 0.0% | 72.7% |
| Requirement Recall (strict) | 0.0% | 75.0% |
| Requirement Precision | N/A | 100.0% |
| False Positive Rate | N/A | 0.0% |
| Critical Fact Accuracy | 0.0% | 90.9% |
| Evidence Accuracy | N/A | 100.0% |
| Unsupported Claim Rate | N/A | 0.0% |
| Risk Recall | 0.0% | 40.0% |
| CRITICAL_RISK_MISSED | 2 | 1 |
| Clarification Hallucinations | 6 | 0 |
| CROSS_DOMAIN_LEAK | 9 | 0 |
| expectedUnknown 违规 | 0 | 0 |

## case-c-hrm-media-monitoring — V1 vs V2 对照

| 指标 | V1 | V2 |
| --- | --- | --- |
| Mandatory Recall (strict) | 4.0% | 68.0% |
| Mandatory Recall (lenient) | 8.0% | 92.0% |
| Requirement Recall (strict) | 4.0% | 68.0% |
| Requirement Precision | 8.3% | 10.1% |
| False Positive Rate | 83.3% | 65.8% |
| Critical Fact Accuracy | 0.0% | 80.0% |
| Evidence Accuracy | 100.0% | 100.0% |
| Unsupported Claim Rate | 0.0% | 0.0% |
| Risk Recall | 11.1% | 77.8% |
| CRITICAL_RISK_MISSED | 2 | 0 |
| Clarification Hallucinations | 0 | 0 |
| CROSS_DOMAIN_LEAK | 0 | 0 |
| expectedUnknown 违规 | 0 | 1 |

## case-a0-rcmp-fixture — lane V1

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
| Useful Clarification Rate | 100.0% | 系统提问 8 条；幻觉 0 条 |
| Already Answered Rate | 0.0% | NECESSARY 覆盖率 80.0% |
| CROSS_DOMAIN_LEAK | **0** | facts 0 + reqs 0 + 风险行 0 + 澄清 0 |
| CROSS_DOMAIN_LEAK | **0** | facts 0 + reqs 0 + 风险行 0 + 澄清 0 |
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

## case-a0-rcmp-fixture — lane V2

RCMP RISO 合成 fixture（过拟合对照）

- 来源：SYNTHETIC（src/lib/tender-auto-analysis/__tests__/fixtures/rcmp-backpack-pages.ts（真实招标的人工转写节选，页码/正文与原件有出入））
- Golden 状态：PENDING_HUMAN_CONFIRMATION
- 文档 1 份 / 15 页
- Analyzer：tender-understanding/v2｜models=gpt-5.6-terra｜LLM calls=21（失败 1）｜windows=5｜108.4s｜tokens=22170/19099
- Prompts：tender-understanding-v2-extract@5×6，tender-understanding-v2-resolve@1×15｜UNKNOWN 槽位：site_visit,installation,warranty,bond,insurance,addenda,incumbent_supplier｜冲突 0｜语料已解决歧义 1

### Scorecard

| 指标 | 值 | 说明 |
| --- | --- | --- |
| Requirement Recall (strict / lenient) | 75.0% / 75.0% | golden 16 条 |
| Mandatory Recall (strict / lenient) | 75.0% / 75.0% | mandatory golden 16 条 |
| Requirement Precision | 48.0% | 系统输出 25 条 |
| False Positive Rate | 52.0% | Duplicate Rate 0.0% |
| Critical Fact Accuracy | 83.3% | 关键事实 18 项；全事实 87.0%（23 项） |
| 值对证据错（计失败） | 0 项 | CORRECT_VALUE_BAD_EVIDENCE |
| Evidence Coverage / Accuracy | 100.0% / 100.0% | Unsupported Claim Rate 0.0% |
| Risk Recall | 60.0% | golden 5 条；CRITICAL_RISK_MISSED = 0 |
| Useful Clarification Rate | 21.4% | 系统提问 14 条；幻觉 0 条 |
| Already Answered Rate | 0.0% | NECESSARY 覆盖率 20.0% |
| CROSS_DOMAIN_LEAK | **0** | facts 0 + reqs 0 + 风险行 0 + 澄清 0 |
| CROSS_DOMAIN_LEAK | **0** | facts 0 + reqs 0 + 风险行 0 + 澄清 0 |
| 歧义处理 | 0/1 OK | expectedUnknown 违规 0 |

### MISSED Requirements（4/16）

- `R0-M9`【mandatory】（CRITICAL）
- `R0-M11`【mandatory】（CRITICAL）
- `R0-M14`【mandatory】（CRITICAL）
- `R0-M15`【mandatory】（CRITICAL）

### FALSE_POSITIVE 输出（13）

- `R-001`
- `R-002`
- `R-003`
- `R-004`
- `R-006`
- `R-007`
- `R-008`
- `R-009`
- `R-010`
- `R-011`
- `R-023`
- `R-024`
- `R-025`

### 未达标事实（3/23）

- `F0-ENQUIRY`【critical】: NOT_EXTRACTED
- `F0-QTY-ANNUAL`【critical】: NOT_EXTRACTED
- `F0-QTY-7500`【critical】: NOT_EXTRACTED

### 风险判定

`RISK0-QTY[IMPORTANT]`(MISSED)、`RISK0-SUBMISSION[CRITICAL]`(DETECTED)、`RISK0-DELIVERY[IMPORTANT]`(DETECTED)、`RISK0-ELIGIBILITY[CRITICAL]`(DETECTED)、`RISK0-TECH-STANDARDS[IMPORTANT]`(MISSED)

### 澄清问题判定

- [LOW_VALUE] Environmental packaging specifications：What environmentally preferable packaging specifica…
- [LOW_VALUE] Applicable Trading Partner eligibility：Which trading partners qualify as an Applicable Tra…
- [LOW_VALUE] Quarterly report：A bidder cannot determine who must provide the quarterly report or what i…
- [LOW_VALUE] Water-resistance test：The bidder cannot determine which test applies or its acceptance cri…
- [USEFUL] Performance standards：The bidder cannot determine the applicable zipper strength and durab…
- [USEFUL] Annex C measurement method：The bidder cannot determine the required dimensional measuremen…
- [LOW_VALUE] Colour reference：The bidder cannot determine the exact olive/black colour reference.
- [LOW_VALUE] Logo placement：The bidder cannot determine the required marking, logo, or its placement.
- [LOW_VALUE] Technical drawing：The bidder cannot determine the required configuration of external pocke…
- [LOW_VALUE] Maximum empty weight：The bidder cannot determine the maximum permitted empty weight.
- [NECESSARY] Sample requirement：The bidder cannot determine whether a sample must be submitted with the…
- [LOW_VALUE] Environmentally preferable packaging：The bidder cannot determine the mandatory environment…
- [LOW_VALUE] Environmentally preferable packaging criteria：What packaging materials, standards, certifi…
- [LOW_VALUE] Standing Offer and option-year dates：The actual start and end dates for Standing Offer Yea…

未被问到的 NECESSARY 主题：`CLAR0-CALLUP`、`CLAR0-QTY-BASIS`、`CLAR0-WATER-TEST`、`CLAR0-OVERSEAS`

### 歧义处理

`AMB0-QTY(CLARIFICATION_REQUIRED)`(PARTIAL)

## case-a-rcmp-riso-real — lane V1

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
| Useful Clarification Rate | 77.8% | 系统提问 9 条；幻觉 1 条 |
| Already Answered Rate | 0.0% | NECESSARY 覆盖率 100.0% |
| CROSS_DOMAIN_LEAK | **2** | facts 0 + reqs 0 + 风险行 1 + 澄清 1 |
| CROSS_DOMAIN_LEAK | **2** | facts 0 + reqs 0 + 风险行 1 + 澄清 1 |
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

## case-a-rcmp-riso-real — lane V2

RCMP Backpacks for Cadets — RISO M5000-25-3574-A（真实原件 43 页）

- 来源：REAL（fixtures/private/M5000-25-3574 - A - RFP - English.pdf（公开政府招标原件，本地加载，不提交））
- Golden 状态：PENDING_HUMAN_CONFIRMATION
- 文档 1 份 / 43 页
- Analyzer：tender-understanding/v2｜models=gpt-5.6-terra｜LLM calls=49（失败 6）｜windows=21｜233.1s｜tokens=127307/71218
- Prompts：tender-understanding-v2-extract@5×25，tender-understanding-v2-resolve@1×24｜UNKNOWN 槽位：site_visit,installation,warranty,bond,addenda,incumbent_supplier｜冲突 1｜语料已解决歧义 13

### Scorecard

| 指标 | 值 | 说明 |
| --- | --- | --- |
| Requirement Recall (strict / lenient) | 81.6% / 89.5% | golden 38 条 |
| Mandatory Recall (strict / lenient) | 81.6% / 89.5% | mandatory golden 38 条 |
| Requirement Precision | 31.2% | 系统输出 109 条 |
| False Positive Rate | 31.2% | Duplicate Rate 37.6% |
| Critical Fact Accuracy | 72.7% | 关键事实 22 项；全事实 79.0%（38 项） |
| 值对证据错（计失败） | 0 项 | CORRECT_VALUE_BAD_EVIDENCE |
| Evidence Coverage / Accuracy | 100.0% / 100.0% | Unsupported Claim Rate 0.0% |
| Risk Recall | 87.5% | golden 8 条；CRITICAL_RISK_MISSED = 0 |
| Useful Clarification Rate | 0.0% | 系统提问 10 条；幻觉 0 条 |
| Already Answered Rate | 0.0% | NECESSARY 覆盖率 0.0% |
| CROSS_DOMAIN_LEAK | **0** | facts 0 + reqs 0 + 风险行 0 + 澄清 0 |
| CROSS_DOMAIN_LEAK | **0** | facts 0 + reqs 0 + 风险行 0 + 澄清 0 |
| 歧义处理 | 1/2 OK | expectedUnknown 违规 0 |

### MISSED Requirements（4/38）

- `R-SUB-3PDF`【mandatory】（CRITICAL）
- `R-COM-FX`【mandatory】（HIGH）
- `R-CERT-FCP`【mandatory】（NORMAL）
- `R-PERF-CALLUP-ITEMS`【mandatory】（NORMAL）

### PARTIAL Requirements（3）

- `R-SUB-SUBSTANTIATION` ← `R-021`（coverage 0.292）
- `R-ELIG-RECIPROCAL` ← `R-004`（coverage 0.846）
- `R-PERF-ENV-PACKAGING` ← `R-061`（coverage 0.471）

### FALSE_POSITIVE 输出（34）

- `R-001`
- `R-002`
- `R-003`
- `R-009`
- `R-011`
- `R-013`
- `R-014`
- `R-015`
- `R-016`
- `R-019`
- `R-023`
- `R-024`
- `R-028`
- `R-029`
- `R-030`
- `R-031`
- `R-032`
- `R-056`
- `R-065`
- `R-066`
- `R-067`
- `R-070`
- `R-071`
- `R-072`
- `R-073`
- `R-074`
- `R-075`
- `R-079`
- `R-080`
- `R-081`
- `R-083`
- `R-084`
- `R-085`
- `R-102`

### 未达标事实（8/38）

- `F-ENQUIRY-DEADLINE`【critical】: NOT_EXTRACTED
- `F-OPTIONS`: WRONG_VALUE（候选: pricing_method:F-017, contract_duration:F-063, req:R-086）
- `F-QTY-ANNEX-A`【critical】: NOT_EXTRACTED
- `F-QTY-ANNUAL`【critical】: NOT_EXTRACTED
- `F-QTY-AGGREGATE`【critical】: NOT_EXTRACTED
- `F-NO-ZIP`: WRONG_VALUE（候选: req:R-018, req:R-034, req:R-035, req:R-046）
- `F-CALLUP-MAX`【critical】: NOT_EXTRACTED
- `F-FX-BAN`【critical】: NOT_EXTRACTED

### 风险判定

`RISK-ELIGIBILITY[CRITICAL]`(DETECTED)、`RISK-SUBMISSION-REJECT[CRITICAL]`(DETECTED)、`RISK-SUBSTANTIATION[CRITICAL]`(DETECTED)、`RISK-PRICING-TABLE[CRITICAL]`(DETECTED)、`RISK-QTY-NO-GUARANTEE[IMPORTANT]`(DETECTED)、`RISK-DELIVERY-PRESSURE[IMPORTANT]`(DETECTED)、`RISK-FX[IMPORTANT]`(MISSED)、`RISK-ADMIN-REPORTING[IMPORTANT]`(DETECTED)

### 澄清问题判定

- [LOW_VALUE] Offer closing details：The bidder cannot determine the offer destination, closing date, clo…
- [LOW_VALUE] Total Evaluated Price calculation：The formula, pricing rows, quantities, and calculation i…
- [LOW_VALUE] Certificate of Independent Offer Determination：The bidder cannot determine from these page…
- [LOW_VALUE] Applicable Trading Partner eligibility：Which countries, entities, or suppliers qualify as …
- [LOW_VALUE] Attachment 2 declaration content：The declarations, fields, and supporting information requ…
- [LOW_VALUE] Project Authority identity：The bidder cannot determine the Project Authority's name, title…
- [LOW_VALUE] Advance notice of business-location changes：The amount of advance notice the Contractor sh…
- [LOW_VALUE] EPS requirements：The technical, procedural, and integration requirements for the e-procure…
- [LOW_VALUE] Invoice submission email address：The email address to which the invoice must be sent for c…
- [LOW_VALUE] Delivery destination：The bidder cannot determine the specific delivery destination from th…

未被问到的 NECESSARY 主题：`CLAR-CALLUP-VOLUME`、`CLAR-QTY-BASIS`、`CLAR-OVERSEAS`

### 歧义处理

`AMB-QTY-BASIS(CLARIFICATION_REQUIRED)`(PARTIAL)、`AMB-FIRM-VS-ESTIMATED(FLAGGED)`(OK)

## case-b-dsbn-window-coverings — lane V1

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
| Useful Clarification Rate | 0.0% | 系统提问 9 条；幻觉 6 条 |
| Already Answered Rate | 11.1% | NECESSARY 覆盖率 0.0% |
| CROSS_DOMAIN_LEAK | **9** | facts 0 + reqs 0 + 风险行 3 + 澄清 6 |
| CROSS_DOMAIN_LEAK | **9** | facts 0 + reqs 0 + 风险行 3 + 澄清 6 |
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

## case-b-dsbn-window-coverings — lane V2

DSBN 窗饰供应与安装 RFP + Addendum-01（业务域泛化）

- 来源：NEAR_REAL_RECONSTRUCTED（scripts/intelligence-report-eval/sample-input-01-curtain-tender.json（真实 DSBN 招标浓缩转写，非完整原件））
- Golden 状态：PENDING_HUMAN_CONFIRMATION
- 文档 2 份 / 2 页
- Analyzer：tender-understanding/v2｜models=gpt-5.6-terra｜LLM calls=4（失败 0）｜windows=2｜25.5s｜tokens=5530/3871
- Prompts：tender-understanding-v2-extract@5×2，tender-understanding-v2-resolve@1×2｜UNKNOWN 槽位：tender_number,question_deadline,site_visit,location,quantity,delivery,installation,warranty,bond,pricing_method,incumbent_supplier｜冲突 0｜语料已解决歧义 0

### Scorecard

| 指标 | 值 | 说明 |
| --- | --- | --- |
| Requirement Recall (strict / lenient) | 75.0% / 75.0% | golden 12 条 |
| Mandatory Recall (strict / lenient) | 72.7% / 72.7% | mandatory golden 11 条 |
| Requirement Precision | 100.0% | 系统输出 9 条 |
| False Positive Rate | 0.0% | Duplicate Rate 0.0% |
| Critical Fact Accuracy | 90.9% | 关键事实 11 项；全事实 93.3%（15 项） |
| 值对证据错（计失败） | 0 项 | CORRECT_VALUE_BAD_EVIDENCE |
| Evidence Coverage / Accuracy | 100.0% / 100.0% | Unsupported Claim Rate 0.0% |
| Risk Recall | 40.0% | golden 5 条；CRITICAL_RISK_MISSED = 1 |
| Useful Clarification Rate | 50.0% | 系统提问 2 条；幻觉 0 条 |
| Already Answered Rate | 50.0% | NECESSARY 覆盖率 25.0% |
| CROSS_DOMAIN_LEAK | **0** | facts 0 + reqs 0 + 风险行 0 + 澄清 0 |
| CROSS_DOMAIN_LEAK | **0** | facts 0 + reqs 0 + 风险行 0 + 澄清 0 |
| 歧义处理 | 1/3 OK | expectedUnknown 违规 0 |

### MISSED Requirements（3/12）

- `RB-MEASURE`【mandatory】（NORMAL）
- `RB-REMOVAL`【mandatory】（NORMAL）
- `RB-SUPPLY-INSTALL`【mandatory】（HIGH）

### FALSE_POSITIVE 输出（0）

（无）

### 未达标事实（1/15）

- `FB-WARRANTY`【critical】: WRONG_VALUE（候选: req:R-005）

### 风险判定

`RISKB-NO-QUANTITIES[CRITICAL]`(DETECTED)、`RISKB-SERVICE-WEIGHTED[CRITICAL]`(MISSED)、`RISKB-MOTOR-SPECS[IMPORTANT]`(MISSED)、`RISKB-FIRE-CERT[IMPORTANT]`(DETECTED)、`RISKB-ADDENDUM-TRACKING[IMPORTANT]`(MISSED)

### 澄清问题判定

- [NECESSARY] Submission deadline time and method：A bidder cannot determine the time by which proposals …
- [ALREADY_ANSWERED] Product sample requirement：A bidder cannot determine whether a sample is required for its …

未被问到的 NECESSARY 主题：`CLARB-QUANTITIES`、`CLARB-PRICING-FORMAT`、`CLARB-MOTOR`

### 歧义处理

`AMBB-QUANTITIES(CLARIFICATION_REQUIRED)`(PARTIAL)、`AMBB-MOTOR-SPECS(CLARIFICATION_REQUIRED)`(PARTIAL)、`AMBB-SUBMISSION-METHOD(CLARIFICATION_REQUIRED)`(OK)

## case-c-hrm-media-monitoring — lane V1

HRM-2026-0395 Media Monitoring Tool RFQ（真实服务类原件 57 页）

- 来源：REAL（fixtures/private/tender-eval/case-c-hrm-media-monitoring/（HRM 公开 RFQ 原件 26 页 + PO 服务条款 24 页 + 供应商行为准则 7 页；产品解析页文本导出，不提交））
- Golden 状态：PENDING_HUMAN_CONFIRMATION
- 文档 3 份 / 57 页

### Scorecard

| 指标 | 值 | 说明 |
| --- | --- | --- |
| Requirement Recall (strict / lenient) | 4.0% / 8.0% | golden 25 条 |
| Mandatory Recall (strict / lenient) | 4.0% / 8.0% | mandatory golden 25 条 |
| Requirement Precision | 8.3% | 系统输出 24 条 |
| False Positive Rate | 83.3% | Duplicate Rate 8.3% |
| Critical Fact Accuracy | 0.0% | 关键事实 20 项；全事实 0.0%（32 项） |
| 值对证据错（计失败） | 0 项 | CORRECT_VALUE_BAD_EVIDENCE |
| Evidence Coverage / Accuracy | 100.0% / 100.0% | Unsupported Claim Rate 0.0% |
| Risk Recall | 11.1% | golden 9 条；CRITICAL_RISK_MISSED = 2 |
| Useful Clarification Rate | 0.0% | 系统提问 9 条；幻觉 0 条 |
| Already Answered Rate | 0.0% | NECESSARY 覆盖率 0.0% |
| CROSS_DOMAIN_LEAK | **0** | facts 0 + reqs 0 + 风险行 0 + 澄清 0 |
| CROSS_DOMAIN_LEAK | **0** | facts 0 + reqs 0 + 风险行 0 + 澄清 0 |
| 歧义处理 | 1/2 OK | expectedUnknown 违规 0 |

### MISSED Requirements（23/25）

- `GR-DAILY`【mandatory】（CRITICAL）
- `GR-0830`【mandatory】（CRITICAL）
- `GR-USERS`【mandatory】（HIGH）
- `GR-UNIQUE-SIGNIN`【mandatory】（NORMAL）
- `GR-SEARCH`【mandatory】（HIGH）
- `GR-NEWSLETTER`【mandatory】（HIGH）
- `GR-REPORTING`【mandatory】（HIGH）
- `GR-DUPLICATES`【mandatory】（NORMAL）
- `GR-SEARCH-CUSTOM`【mandatory】（NORMAL）
- `GR-SUPPORT`【mandatory】（NORMAL）
- `GR-SUBMISSION`【mandatory】（CRITICAL）
- `GR-SUPPLEMENTS`【mandatory】（HIGH）
- `GR-ADDENDA-ACK`【mandatory】（HIGH）
- `GR-WCB`【mandatory】（CRITICAL）
- `GR-SAFETY-CERT`【mandatory】（HIGH）
- `GR-PRICE-CAD`【mandatory】（CRITICAL）
- `GR-VALIDITY`【mandatory】（HIGH）
- `GR-BIDFORM-SIGN`【mandatory】（NORMAL）
- `GR-NO-CONTACT`【mandatory】（NORMAL）
- `GR-CODE-CONDUCT`【mandatory】（NORMAL）
- `GR-NATIONALITY-DECL`【mandatory】（HIGH）
- `GR-INVOICE-HST`【mandatory】（NORMAL）
- `GR-BUSINESS-REG`【mandatory】（NORMAL）

### PARTIAL Requirements（1）

- `GR-ONDEMAND` ← `GEN-024`（coverage 0.167）

### FALSE_POSITIVE 输出（20）

- `GEN-001`
- `GEN-002`
- `GEN-003`
- `GEN-004`
- `GEN-005`
- `GEN-006`
- `GEN-007`
- `GEN-008`
- `GEN-009`
- `GEN-010`
- `GEN-011`
- `GEN-012`
- `GEN-013`
- `GEN-014`
- `GEN-015`
- `GEN-016`
- `GEN-017`
- `GEN-018`
- `GEN-019`
- `GEN-023`

### 未达标事实（32/32）

- `FC-BUYER`【critical】: NOT_EXTRACTED
- `FC-NUMBER`【critical】: NOT_EXTRACTED
- `FC-TITLE`【critical】: NOT_EXTRACTED
- `FC-TYPE`: NOT_EXTRACTED
- `FC-ISSUE`: NOT_EXTRACTED
- `FC-CLOSING`【critical】: NOT_EXTRACTED
- `FC-SITEVISIT`: NOT_EXTRACTED
- `FC-SUBMISSION`【critical】: NOT_EXTRACTED
- `FC-EVAL-WEIGHTS`【critical】: NOT_EXTRACTED
- `FC-COST-FORMULA`【critical】: NOT_EXTRACTED
- `FC-PERF-DEFAULT`【critical】: NOT_EXTRACTED
- `FC-US-ZERO`【critical】: NOT_EXTRACTED
- `FC-TERM`【critical】: NOT_EXTRACTED
- `FC-TERM-END`: NOT_EXTRACTED
- `FC-INCUMBENT`【critical】: NOT_EXTRACTED
- `FC-VOLUME`【critical】: NOT_EXTRACTED
- `FC-USERS`【critical】: NOT_EXTRACTED
- `FC-NEWSLETTER`: NOT_EXTRACTED
- `FC-DAILY-TIME`【critical】: NOT_EXTRACTED
- `FC-DAYS`【critical】: NOT_EXTRACTED
- `FC-PRICING`【critical】: NOT_EXTRACTED
- `FC-PRICE-UNIT`: NOT_EXTRACTED
- `FC-VALIDITY`【critical】: NOT_EXTRACTED
- `FC-INSURANCE-RFQ`: NOT_EXTRACTED
- `FC-WCB`【critical】: NOT_EXTRACTED
- `FC-REFERENCES`: NOT_EXTRACTED
- `FC-SOCIAL-VALUE`【critical】: NOT_EXTRACTED
- `FC-SOCIAL-MEDIA`: NOT_EXTRACTED
- `FC-LIVING-WAGE`: NOT_EXTRACTED
- `FC-OPTION-PRICE`: NOT_EXTRACTED
- `FC-DATA-RESIDENCY`【critical】: NOT_EXTRACTED
- `FC-TERMINATION`: NOT_EXTRACTED

### 风险判定

`RK-US-NATIONALITY[CRITICAL]`(MISSED)、`RK-PERF-60[IMPORTANT]`(MISSED)、`RK-DATA-RESIDENCY[CRITICAL]`(MISSED)、`RK-INSURANCE-CONFLICT[IMPORTANT]`(MISSED)、`RK-ADDENDA-WITHDRAW[IMPORTANT]`(MISSED)、`RK-TERMINATION-30D[IMPORTANT]`(DETECTED)、`RK-PRICE-DISCLOSURE[IMPORTANT]`(MISSED)、`RK-IP-ASSIGNMENT[IMPORTANT]`(MISSED)、`RK-NEGOTIATION-15[IMPORTANT]`(MISSED)

### 澄清问题判定

- [LOW_VALUE] Call-up 的最小 / 最大 / 典型订购数量分别是多少？询价建议不晚于 （截标日未知，待补）
- [LOW_VALUE] 「Up to 1500 per contract period」的准确含义是合同期硬上限、估算值，还是评标用数量？询价建议不晚于 （截标日未知，待补）
- [LOW_VALUE] 投标阶段是否必须提交样品（sample required at bid time）？若需要，数量、费用与退回规则是什么？询价建议不晚于 （截标日未知，待补）
- [LOW_VALUE] 防水/抗水测试所依据的具体标准（方法、时长、验收指标）是什么？询价建议不晚于 （截标日未知，待补）
- [LOW_VALUE] 是否允许海外制造（overseas manufacturing）？若允许，原产地声明与 Reciprocal Procurement 如何衔接？询价建议不晚于 （截标日未知，待补）
- [LOW_VALUE] 1000D 面料要求的适用范围（主壳/部件/等同材料是否接受）如何界定？询价建议不晚于 （截标日未知，待补）
- [LOW_VALUE] 尺寸/容量的官方测量方法（measurement method）以哪份附件为准？询价建议不晚于 （截标日未知，待补）
- [LOW_VALUE] 拉链 / 织带 / 缝线的具体性能标准与测试方法分别是什么？询价建议不晚于 （截标日未知，待补）
- [LOW_VALUE] 评标用 7,500（或年度 1,500×年数）是否仅用于评估，而不构成任何采购承诺？询价建议不晚于 （截标日未知，待补）

未被问到的 NECESSARY 主题：`CL-QUESTION-DEADLINE`、`CL-INCUMBENT`、`CL-INSURANCE`、`CL-DATA-HOSTING`

### 歧义处理

`AM-INSURANCE(CLARIFICATION_REQUIRED)`(MISSED)、`AM-TERM-DATES(FLAGGED)`(OK)

## case-c-hrm-media-monitoring — lane V2

HRM-2026-0395 Media Monitoring Tool RFQ（真实服务类原件 57 页）

- 来源：REAL（fixtures/private/tender-eval/case-c-hrm-media-monitoring/（HRM 公开 RFQ 原件 26 页 + PO 服务条款 24 页 + 供应商行为准则 7 页；产品解析页文本导出，不提交））
- Golden 状态：PENDING_HUMAN_CONFIRMATION
- 文档 3 份 / 57 页
- Analyzer：tender-understanding/v2｜models=gpt-5.6-terra｜LLM calls=64（失败 11）｜windows=29｜425.3s｜tokens=168432/119921
- Prompts：tender-understanding-v2-extract@5×35，tender-understanding-v2-resolve@1×29｜UNKNOWN 槽位：installation,warranty,bond｜冲突 1｜语料已解决歧义 9

### Scorecard

| 指标 | 值 | 说明 |
| --- | --- | --- |
| Requirement Recall (strict / lenient) | 68.0% / 92.0% | golden 25 条 |
| Mandatory Recall (strict / lenient) | 68.0% / 92.0% | mandatory golden 25 条 |
| Requirement Precision | 10.1% | 系统输出 228 条 |
| False Positive Rate | 65.8% | Duplicate Rate 24.1% |
| Critical Fact Accuracy | 80.0% | 关键事实 20 项；全事实 71.9%（32 项） |
| 值对证据错（计失败） | 0 项 | CORRECT_VALUE_BAD_EVIDENCE |
| Evidence Coverage / Accuracy | 100.0% / 100.0% | Unsupported Claim Rate 0.0% |
| Risk Recall | 77.8% | golden 9 条；CRITICAL_RISK_MISSED = 0 |
| Useful Clarification Rate | 5.9% | 系统提问 17 条；幻觉 0 条 |
| Already Answered Rate | 0.0% | NECESSARY 覆盖率 25.0% |
| CROSS_DOMAIN_LEAK | **0** | facts 0 + reqs 0 + 风险行 0 + 澄清 0 |
| CROSS_DOMAIN_LEAK | **0** | facts 0 + reqs 0 + 风险行 0 + 澄清 0 |
| 歧义处理 | 2/2 OK | expectedUnknown 违规 1 |

### MISSED Requirements（2/25）

- `GR-DAILY`【mandatory】（CRITICAL）
- `GR-NATIONALITY-DECL`【mandatory】（HIGH）

### PARTIAL Requirements（6）

- `GR-REPORTING` ← `R-051`（coverage 0.583）
- `GR-ONDEMAND` ← `R-052`（coverage 1）
- `GR-SUBMISSION` ← `R-024`（coverage 0.632）
- `GR-WCB` ← `R-027`（coverage 0.7）
- `GR-BIDFORM-SIGN` ← `R-015`（coverage 0.313）
- `GR-NO-CONTACT` ← `R-032`（coverage 0.059）

### FALSE_POSITIVE 输出（150）

- `R-002`
- `R-003`
- `R-006`
- `R-011`
- `R-012`
- `R-013`
- `R-021`
- `R-025`
- `R-026`
- `R-031`
- `R-033`
- `R-037`
- `R-038`
- `R-039`
- `R-041`
- `R-042`
- `R-043`
- `R-048`
- `R-057`
- `R-060`
- `R-061`
- `R-062`
- `R-063`
- `R-064`
- `R-065`
- `R-066`
- `R-068`
- `R-069`
- `R-070`
- `R-071`
- `R-072`
- `R-076`
- `R-077`
- `R-078`
- `R-079`
- `R-080`
- `R-081`
- `R-082`
- `R-083`
- `R-084`
- `R-086`
- `R-087`
- `R-088`
- `R-089`
- `R-090`
- `R-091`
- `R-092`
- `R-093`
- `R-094`
- `R-095`
- `R-096`
- `R-097`
- `R-098`
- `R-099`
- `R-100`
- `R-101`
- `R-102`
- `R-103`
- `R-104`
- `R-105`
- `R-106`
- `R-107`
- `R-108`
- `R-109`
- `R-110`
- `R-111`
- `R-112`
- `R-113`
- `R-116`
- `R-117`
- `R-118`
- `R-119`
- `R-120`
- `R-121`
- `R-122`
- `R-125`
- `R-126`
- `R-127`
- `R-128`
- `R-129`
- `R-130`
- `R-131`
- `R-132`
- `R-133`
- `R-134`
- `R-136`
- `R-137`
- `R-138`
- `R-139`
- `R-140`
- `R-141`
- `R-142`
- `R-144`
- `R-145`
- `R-146`
- `R-147`
- `R-148`
- `R-149`
- `R-150`
- `R-151`
- `R-152`
- `R-153`
- `R-154`
- `R-155`
- `R-156`
- `R-158`
- `R-159`
- `R-160`
- `R-162`
- `R-163`
- `R-164`
- `R-165`
- `R-168`
- `R-169`
- `R-170`
- `R-171`
- `R-173`
- `R-174`
- `R-175`
- `R-176`
- `R-177`
- `R-178`
- `R-179`
- `R-180`
- `R-181`
- `R-182`
- `R-183`
- `R-184`
- `R-185`
- `R-186`
- `R-187`
- `R-188`
- `R-189`
- `R-190`
- `R-191`
- `R-192`
- `R-193`
- `R-194`
- `R-195`
- `R-196`
- `R-197`
- `R-201`
- `R-202`
- `R-209`
- `R-212`
- `R-214`
- `R-216`
- `R-225`
- `R-226`
- `R-227`

### 未达标事实（9/32）

- `FC-SITEVISIT`: WRONG_VALUE（候选: site_visit:F-007）
- `FC-EVAL-WEIGHTS`【critical】: WRONG_VALUE（候选: evaluation_criteria:F-015, evaluation_criteria:F-042）
- `FC-PERF-DEFAULT`【critical】: NOT_EXTRACTED
- `FC-VOLUME`【critical】: NOT_EXTRACTED
- `FC-USERS`【critical】: WRONG_VALUE（候选: req:R-045）
- `FC-PRICE-UNIT`: NOT_EXTRACTED
- `FC-REFERENCES`: WRONG_VALUE（候选: req:R-005, req:R-067）
- `FC-SOCIAL-MEDIA`: WRONG_VALUE（候选: req:R-048）
- `FC-LIVING-WAGE`: WRONG_VALUE（候选: project_title:F-050, other:F-051, scope:F-055, req:R-040）

### 风险判定

`RK-US-NATIONALITY[CRITICAL]`(DETECTED)、`RK-PERF-60[IMPORTANT]`(MISSED)、`RK-DATA-RESIDENCY[CRITICAL]`(DETECTED)、`RK-INSURANCE-CONFLICT[IMPORTANT]`(DETECTED)、`RK-ADDENDA-WITHDRAW[IMPORTANT]`(DETECTED)、`RK-TERMINATION-30D[IMPORTANT]`(DETECTED)、`RK-PRICE-DISCLOSURE[IMPORTANT]`(DETECTED)、`RK-IP-ASSIGNMENT[IMPORTANT]`(DETECTED)、`RK-NEGOTIATION-15[IMPORTANT]`(MISSED)

### 澄清问题判定

- [LOW_VALUE] Scope completion date：The bidder cannot determine the required scope-of-work completion da…
- [LOW_VALUE] Standing Offer applicability：Whether this RFQ is intended to establish a Standing Offer an…
- [NECESSARY] Insurance applicability：Whether any insurance coverage is required under this RFQ or Agree…
- [LOW_VALUE] Newsletter categories：The bidder cannot determine the complete set of required newsletter …
- [LOW_VALUE] Post-selection outstanding documents and conditions：Which specific documents remain outsta…
- [LOW_VALUE] Living wage rate：The actual living wage rate applicable to the call for bids cannot be det…
- [LOW_VALUE] Code of Conduct effective date：Whether a contract qualifies for the pre-effective-date exc…
- [LOW_VALUE] Factory and production facility details：A bidder cannot determine the timing, format, or l…
- [LOW_VALUE] Environmental responsibility standard：A bidder cannot determine what products or services …
- [LOW_VALUE] Record-detail standard：What records, level of detail, and format will be considered suffic…
- [LOW_VALUE] Additional invoice information：The pages do not identify what additional invoice informati…
- [LOW_VALUE] Not-to-exceed Price threshold：No actual not-to-exceed threshold amount is stated on these …
- [LOW_VALUE] Privacy Protection Schedule：The specific Privacy Protection Schedule obligations and condi…
- [LOW_VALUE] Data licensing agreement：The provisions of the attached data licensing agreement cannot be…
- [LOW_VALUE] Privacy and security standard：The document does not identify the applicable industry, the …
- [LOW_VALUE] Data licensing agreement：The provisions of the attached data licensing agreement are not s…
- [LOW_VALUE] Mandatory cure periods：Whether the Agreement contains mandatory cure periods and, if so, t…

未被问到的 NECESSARY 主题：`CL-QUESTION-DEADLINE`、`CL-INCUMBENT`、`CL-DATA-HOSTING`

### expectedUnknown 违规

- incumbent_name ← `req:R-208`：Supplier must make every reasonable effort to ensure the accuracy and completeness of personal information used by Suppl

### 歧义处理

`AM-INSURANCE(CLARIFICATION_REQUIRED)`(OK)、`AM-TERM-DATES(FLAGGED)`(OK)
