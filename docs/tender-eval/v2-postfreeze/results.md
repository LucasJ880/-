# Qingyan Tender Real Evaluation — Run Report

- Contract: tender-eval/v1
- Run: `20260811-032546Z-ae102dc`（2026-08-11T03:25:46.417Z）
- Git: `ae102dc4d3f0`
- Lanes: V1 + V2
- V1 versions: tender-auto-analysis-v1 / tender-analysis-prompt-v1 / tender-page-parse-v1
- 匹配阈值：token coverage ≥ 0.35（MATCHED），锚词判定见 evaluate.ts 头注

## case-a0-rcmp-fixture — V1 vs V2 对照

| 指标 | V1 | V2 |
| --- | --- | --- |
| Mandatory Recall (strict) | 100.0% | 87.5% |
| Mandatory Recall (lenient) | 100.0% | 100.0% |
| Requirement Recall (strict) | 100.0% | 87.5% |
| Requirement Precision | 100.0% | 53.3% |
| False Positive Rate | 0.0% | 46.7% |
| Critical Fact Accuracy | 94.4% | 83.3% |
| Evidence Accuracy | 100.0% | 100.0% |
| Unsupported Claim Rate | 0.0% | 0.0% |
| Risk Recall | 80.0% | 40.0% |
| CRITICAL_RISK_MISSED | 1 | 1 |
| Clarification Hallucinations | 0 | 0 |
| CROSS_DOMAIN_LEAK | 0 | 0 |
| expectedUnknown 违规 | 0 | 0 |

## case-a-rcmp-riso-real — V1 vs V2 对照

| 指标 | V1 | V2 |
| --- | --- | --- |
| Mandatory Recall (strict) | 44.7% | 76.3% |
| Mandatory Recall (lenient) | 65.8% | 84.2% |
| Requirement Recall (strict) | 44.7% | 76.3% |
| Requirement Precision | 80.7% | 31.4% |
| False Positive Rate | 0.0% | 42.2% |
| Critical Fact Accuracy | 77.3% | 72.7% |
| Evidence Accuracy | 100.0% | 100.0% |
| Unsupported Claim Rate | 0.0% | 0.0% |
| Risk Recall | 37.5% | 100.0% |
| CRITICAL_RISK_MISSED | 3 | 0 |
| Clarification Hallucinations | 1 | 0 |
| CROSS_DOMAIN_LEAK | 2 | 0 |
| expectedUnknown 违规 | 0 | 0 |

## case-b-dsbn-window-coverings — V1 vs V2 对照

| 指标 | V1 | V2 |
| --- | --- | --- |
| Mandatory Recall (strict) | 0.0% | 54.5% |
| Mandatory Recall (lenient) | 0.0% | 100.0% |
| Requirement Recall (strict) | 0.0% | 50.0% |
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
- Analyzer：tender-understanding/v2｜models=gpt-5.6-terra｜LLM calls=18（失败 1）｜windows=5｜87.4s｜tokens=17250/18351
- Prompts：tender-understanding-v2-extract@2×6，tender-understanding-v2-resolve@1×12｜UNKNOWN 槽位：site_visit,location,installation,warranty,bond,insurance,addenda｜冲突 0｜语料已解决歧义 1

### Scorecard

| 指标 | 值 | 说明 |
| --- | --- | --- |
| Requirement Recall (strict / lenient) | 87.5% / 100.0% | golden 16 条 |
| Mandatory Recall (strict / lenient) | 87.5% / 100.0% | mandatory golden 16 条 |
| Requirement Precision | 53.3% | 系统输出 30 条 |
| False Positive Rate | 46.7% | Duplicate Rate 0.0% |
| Critical Fact Accuracy | 83.3% | 关键事实 18 项；全事实 87.0%（23 项） |
| 值对证据错（计失败） | 0 项 | CORRECT_VALUE_BAD_EVIDENCE |
| Evidence Coverage / Accuracy | 100.0% / 100.0% | Unsupported Claim Rate 0.0% |
| Risk Recall | 40.0% | golden 5 条；CRITICAL_RISK_MISSED = 1 |
| Useful Clarification Rate | 27.3% | 系统提问 11 条；幻觉 0 条 |
| Already Answered Rate | 0.0% | NECESSARY 覆盖率 20.0% |
| CROSS_DOMAIN_LEAK | **0** | facts 0 + reqs 0 + 风险行 0 + 澄清 0 |
| CROSS_DOMAIN_LEAK | **0** | facts 0 + reqs 0 + 风险行 0 + 澄清 0 |
| 歧义处理 | 0/1 OK | expectedUnknown 违规 0 |

### MISSED Requirements（0/16）

（无）

### PARTIAL Requirements（2）

- `R0-M14` ← `R-029`（coverage 0.857）
- `R0-M15` ← `R-030`（coverage 0.8）

### FALSE_POSITIVE 输出（14）

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
- `R-012`
- `R-013`
- `R-014`
- `R-015`

### 未达标事实（3/23）

- `F0-ENQUIRY`【critical】: NOT_EXTRACTED
- `F0-QTY-A`【critical】: NOT_EXTRACTED
- `F0-QTY-7500`【critical】: NOT_EXTRACTED

### 风险判定

`RISK0-QTY[IMPORTANT]`(MISSED)、`RISK0-SUBMISSION[CRITICAL]`(MISSED)、`RISK0-DELIVERY[IMPORTANT]`(DETECTED)、`RISK0-ELIGIBILITY[CRITICAL]`(DETECTED)、`RISK0-TECH-STANDARDS[IMPORTANT]`(MISSED)

### 澄清问题判定

- [LOW_VALUE] Applicable Trading Partner eligibility：Which trading partners qualify as Applicable Tradin…
- [LOW_VALUE] Quarterly report obligation：Who must submit the quarterly report, what it must contain, an…
- [LOW_VALUE] Environmentally preferable packaging specifications：A bidder cannot determine the applicab…
- [LOW_VALUE] Environmentally preferable packaging：What packaging characteristics, materials, standards,…
- [LOW_VALUE] Standing Offer and option-year dates：The actual start and end dates for Standing Offer Yea…
- [LOW_VALUE] Water-resistance test：The applicable water-resistance test and its pass criteria cannot be…
- [USEFUL] Performance standards and strength requirements：The required zipper strength/durability st…
- [USEFUL] Annex C measurement method：The prescribed measurement method cannot be determined because …
- [LOW_VALUE] Colour reference and marking placement：The colour reference and the required marking/logo …
- [NECESSARY] Sample requirement at bid time：Whether a sample is required at bid time, who must confirm …
- [LOW_VALUE] Environmentally preferable packaging：The specific packaging standards, documentation, or c…

未被问到的 NECESSARY 主题：`CLAR0-CALLUP`、`CLAR0-QTY-BASIS`、`CLAR0-WATER-TEST`、`CLAR0-OVERSEAS`

### 歧义处理

`AMB0-QTY(CLARIFICATION_REQUIRED)`(MISSED)

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
- Analyzer：tender-understanding/v2｜models=gpt-5.6-terra｜LLM calls=49（失败 11）｜windows=21｜207.0s｜tokens=112726/76974
- Prompts：tender-understanding-v2-extract@2×26，tender-understanding-v2-resolve@1×23｜UNKNOWN 槽位：site_visit,installation,warranty,bond,addenda｜冲突 1｜语料已解决歧义 9

### Scorecard

| 指标 | 值 | 说明 |
| --- | --- | --- |
| Requirement Recall (strict / lenient) | 76.3% / 84.2% | golden 38 条 |
| Mandatory Recall (strict / lenient) | 76.3% / 84.2% | mandatory golden 38 条 |
| Requirement Precision | 31.4% | 系统输出 102 条 |
| False Positive Rate | 42.2% | Duplicate Rate 26.5% |
| Critical Fact Accuracy | 72.7% | 关键事实 22 项；全事实 79.0%（38 项） |
| 值对证据错（计失败） | 0 项 | CORRECT_VALUE_BAD_EVIDENCE |
| Evidence Coverage / Accuracy | 100.0% / 100.0% | Unsupported Claim Rate 0.0% |
| Risk Recall | 100.0% | golden 8 条；CRITICAL_RISK_MISSED = 0 |
| Useful Clarification Rate | 0.0% | 系统提问 12 条；幻觉 0 条 |
| Already Answered Rate | 0.0% | NECESSARY 覆盖率 0.0% |
| CROSS_DOMAIN_LEAK | **0** | facts 0 + reqs 0 + 风险行 0 + 澄清 0 |
| CROSS_DOMAIN_LEAK | **0** | facts 0 + reqs 0 + 风险行 0 + 澄清 0 |
| 歧义处理 | 2/2 OK | expectedUnknown 违规 0 |

### MISSED Requirements（6/38）

- `R-M2`【mandatory】（CRITICAL）
- `R-SUB-3PDF`【mandatory】（CRITICAL）
- `R-CERT-FCP`【mandatory】（NORMAL）
- `R-CERT-RECIPROCAL-DECL`【mandatory】（CRITICAL）
- `R-CERT-ENV-DECL`【mandatory】（CRITICAL）
- `R-PERF-FORCED-LABOUR`【mandatory】（HIGH）

### PARTIAL Requirements（3）

- `R-M15` ← `R-085`（coverage 0.833）
- `R-SUB-5MB` ← `R-029`（coverage 0.313）
- `R-SUB-SUBSTANTIATION` ← `R-014`（coverage 0.333）

### FALSE_POSITIVE 输出（43）

- `R-001`
- `R-002`
- `R-003`
- `R-010`
- `R-012`
- `R-013`
- `R-017`
- `R-018`
- `R-019`
- `R-022`
- `R-023`
- `R-024`
- `R-025`
- `R-026`
- `R-027`
- `R-028`
- `R-031`
- `R-033`
- `R-034`
- `R-038`
- `R-056`
- `R-058`
- `R-059`
- `R-065`
- `R-066`
- `R-071`
- `R-073`
- `R-075`
- `R-076`
- `R-077`
- `R-078`
- `R-079`
- `R-080`
- `R-087`
- `R-094`
- `R-095`
- `R-096`
- `R-097`
- `R-098`
- `R-099`
- `R-100`
- `R-101`
- `R-102`

### 未达标事实（8/38）

- `F-ENQUIRY-DEADLINE`【critical】: WRONG_VALUE（候选: req:R-026）
- `F-QTY-ANNEX-A`【critical】: NOT_EXTRACTED
- `F-QTY-ANNUAL`【critical】: NOT_EXTRACTED
- `F-QTY-AGGREGATE`【critical】: NOT_EXTRACTED
- `F-NO-ZIP`: WRONG_VALUE（候选: req:R-030, req:R-037, req:R-038, req:R-049）
- `F-CALLUP-MAX`【critical】: NOT_EXTRACTED
- `F-ELIGIBILITY`【critical】: NOT_EXTRACTED
- `F-FORCED-LABOUR`: NOT_EXTRACTED

### 风险判定

`RISK-ELIGIBILITY[CRITICAL]`(DETECTED)、`RISK-SUBMISSION-REJECT[CRITICAL]`(DETECTED)、`RISK-SUBSTANTIATION[CRITICAL]`(DETECTED)、`RISK-PRICING-TABLE[CRITICAL]`(DETECTED)、`RISK-QTY-NO-GUARANTEE[IMPORTANT]`(DETECTED)、`RISK-DELIVERY-PRESSURE[IMPORTANT]`(DETECTED)、`RISK-FX[IMPORTANT]`(DETECTED)、`RISK-ADMIN-REPORTING[IMPORTANT]`(DETECTED)

### 澄清问题判定

- [LOW_VALUE] Applicable Trading Partner definition：A bidder cannot determine from these pages which cou…
- [LOW_VALUE] Transition to e-Procurement Solution：The nature and extent of the impact on a resulting St…
- [LOW_VALUE] Certifications：The bidder cannot determine which certifications and additional information…
- [LOW_VALUE] Referenced standard submission instructions：A bidder cannot determine the additional Secti…
- [LOW_VALUE] Integrity Policy and Directives：A bidder cannot determine from these pages alone the speci…
- [LOW_VALUE] Project Authority identity：The bidder cannot determine from these pages who will serve as …
- [LOW_VALUE] Delivery locations：The bidder cannot determine the actual delivery point(s) from the provi…
- [LOW_VALUE] Project Authority：The bidder cannot determine the Project Authority's identity or contact …
- [LOW_VALUE] Call-up-specific items and destination：From these pages, a bidder cannot determine the spe…
- [LOW_VALUE] Firm unit price schedule：The bidder cannot determine the Annex B unit-price schedule or th…
- [LOW_VALUE] Quantity period：The pages do not define what duration constitutes a “contract period” for …
- [LOW_VALUE] Canadian-content evaluation method：From these pages, a bidder cannot determine which Canad…

未被问到的 NECESSARY 主题：`CLAR-CALLUP-VOLUME`、`CLAR-QTY-BASIS`、`CLAR-OVERSEAS`

### 歧义处理

`AMB-QTY-BASIS(CLARIFICATION_REQUIRED)`(OK)、`AMB-FIRM-VS-ESTIMATED(FLAGGED)`(OK)

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
- Analyzer：tender-understanding/v2｜models=gpt-5.6-terra｜LLM calls=5（失败 0）｜windows=2｜19.9s｜tokens=5004/3736
- Prompts：tender-understanding-v2-extract@2×2，tender-understanding-v2-resolve@1×3｜UNKNOWN 槽位：tender_number,question_deadline,site_visit,location,quantity,delivery,bond,submission_method,pricing_method｜冲突 0｜语料已解决歧义 0

### Scorecard

| 指标 | 值 | 说明 |
| --- | --- | --- |
| Requirement Recall (strict / lenient) | 50.0% / 100.0% | golden 12 条 |
| Mandatory Recall (strict / lenient) | 54.5% / 100.0% | mandatory golden 11 条 |
| Requirement Precision | 100.0% | 系统输出 12 条 |
| False Positive Rate | 0.0% | Duplicate Rate 0.0% |
| Critical Fact Accuracy | 90.9% | 关键事实 11 项；全事实 93.3%（15 项） |
| 值对证据错（计失败） | 0 项 | CORRECT_VALUE_BAD_EVIDENCE |
| Evidence Coverage / Accuracy | 100.0% / 100.0% | Unsupported Claim Rate 0.0% |
| Risk Recall | 40.0% | golden 5 条；CRITICAL_RISK_MISSED = 1 |
| Useful Clarification Rate | 33.3% | 系统提问 3 条；幻觉 0 条 |
| Already Answered Rate | 33.3% | NECESSARY 覆盖率 25.0% |
| CROSS_DOMAIN_LEAK | **0** | facts 0 + reqs 0 + 风险行 0 + 澄清 0 |
| CROSS_DOMAIN_LEAK | **0** | facts 0 + reqs 0 + 风险行 0 + 澄清 0 |
| 歧义处理 | 0/3 OK | expectedUnknown 违规 0 |

### MISSED Requirements（0/12）

（无）

### PARTIAL Requirements（6）

- `RB-WARRANTY` ← `R-010`（coverage 1）
- `RB-FIRST-QUALITY` ← `R-006`（coverage 0.75）
- `RB-MEASURE` ← `R-004`（coverage 1）
- `RB-REMOVAL` ← `R-005`（coverage 1）
- `RB-SUPPLY-INSTALL` ← `R-003`（coverage 0.194）
- `RB-SAMPLES-SHORTLIST` ← `R-012`（coverage 0.235）

### FALSE_POSITIVE 输出（0）

（无）

### 未达标事实（1/15）

- `FB-SAMPLES`【critical】: WRONG_VALUE（候选: req:R-012）

### 风险判定

`RISKB-NO-QUANTITIES[CRITICAL]`(DETECTED)、`RISKB-SERVICE-WEIGHTED[CRITICAL]`(MISSED)、`RISKB-MOTOR-SPECS[IMPORTANT]`(MISSED)、`RISKB-FIRE-CERT[IMPORTANT]`(DETECTED)、`RISKB-ADDENDUM-TRACKING[IMPORTANT]`(MISSED)

### 澄清问题判定

- [NECESSARY] Flameproofing Affidavit：A bidder cannot determine the required affidavit form, content, or…
- [ALREADY_ANSWERED] Product sample requirement：A bidder cannot determine whether a sample is required for its …
- [LOW_VALUE] Contract renewal option：A bidder cannot determine who may exercise the renewal option or t…

未被问到的 NECESSARY 主题：`CLARB-QUANTITIES`、`CLARB-PRICING-FORMAT`、`CLARB-MOTOR`

### 歧义处理

`AMBB-QUANTITIES(CLARIFICATION_REQUIRED)`(PARTIAL)、`AMBB-MOTOR-SPECS(CLARIFICATION_REQUIRED)`(PARTIAL)、`AMBB-SUBMISSION-METHOD(CLARIFICATION_REQUIRED)`(PARTIAL)
