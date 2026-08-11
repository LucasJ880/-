# Qingyan Tender Real Evaluation — Run Report

- Contract: tender-eval/v1
- Run: `20260811-011513Z-6b399ca`（2026-08-11T01:15:13.933Z）
- Git: `6b399caa01c2`
- Lanes: V1 + V2
- V1 versions: tender-auto-analysis-v1 / tender-analysis-prompt-v1 / tender-page-parse-v1
- 匹配阈值：token coverage ≥ 0.35（MATCHED），锚词判定见 evaluate.ts 头注

## case-a0-rcmp-fixture — V1 vs V2 对照

| 指标 | V1 | V2 |
| --- | --- | --- |
| Mandatory Recall (strict) | 100.0% | 87.5% |
| Mandatory Recall (lenient) | 100.0% | 87.5% |
| Requirement Recall (strict) | 100.0% | 87.5% |
| Requirement Precision | 100.0% | 51.8% |
| False Positive Rate | 0.0% | 48.1% |
| Critical Fact Accuracy | 94.4% | 77.8% |
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
| Requirement Precision | 80.7% | 28.3% |
| False Positive Rate | 0.0% | 46.7% |
| Critical Fact Accuracy | 77.3% | 77.3% |
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
- Analyzer：tender-understanding/v2｜models=gpt-5.6-terra｜LLM calls=16（失败 0）｜windows=5｜54.3s｜tokens=14467/13930
- Prompts：tender-understanding-v2-extract@2×5，tender-understanding-v2-resolve@1×11｜UNKNOWN 槽位：site_visit,quantity,installation,warranty,bond,insurance,addenda｜冲突 1｜语料已解决歧义 1

### Scorecard

| 指标 | 值 | 说明 |
| --- | --- | --- |
| Requirement Recall (strict / lenient) | 87.5% / 87.5% | golden 16 条 |
| Mandatory Recall (strict / lenient) | 87.5% / 87.5% | mandatory golden 16 条 |
| Requirement Precision | 51.8% | 系统输出 27 条 |
| False Positive Rate | 48.1% | Duplicate Rate 0.0% |
| Critical Fact Accuracy | 77.8% | 关键事实 18 项；全事实 82.6%（23 项） |
| 值对证据错（计失败） | 0 项 | CORRECT_VALUE_BAD_EVIDENCE |
| Evidence Coverage / Accuracy | 100.0% / 100.0% | Unsupported Claim Rate 0.0% |
| Risk Recall | 60.0% | golden 5 条；CRITICAL_RISK_MISSED = 0 |
| Useful Clarification Rate | 30.0% | 系统提问 10 条；幻觉 0 条 |
| Already Answered Rate | 0.0% | NECESSARY 覆盖率 20.0% |
| CROSS_DOMAIN_LEAK | **0** | facts 0 + reqs 0 + 风险行 0 + 澄清 0 |
| 歧义处理 | 0/1 OK | expectedUnknown 违规 0 |

### MISSED Requirements（2/16）

- `R0-M14`【mandatory】（CRITICAL）
- `R0-M15`【mandatory】（CRITICAL）

### FALSE_POSITIVE 输出（13）

- `R-001`
- `R-002`
- `R-003`
- `R-004`
- `R-005`
- `R-006`
- `R-007`
- `R-008`
- `R-009`
- `R-010`
- `R-012`
- `R-013`
- `R-014`

### 未达标事实（4/23）

- `F0-ENQUIRY`【critical】: NOT_EXTRACTED
- `F0-QTY-A`【critical】: NOT_EXTRACTED
- `F0-QTY-ANNUAL`【critical】: NOT_EXTRACTED
- `F0-QTY-7500`【critical】: NOT_EXTRACTED

### 风险判定

`RISK0-QTY[IMPORTANT]`(MISSED)、`RISK0-SUBMISSION[CRITICAL]`(DETECTED)、`RISK0-DELIVERY[IMPORTANT]`(DETECTED)、`RISK0-ELIGIBILITY[CRITICAL]`(DETECTED)、`RISK0-TECH-STANDARDS[IMPORTANT]`(MISSED)

### 澄清问题判定

- [LOW_VALUE] Environmental packaging specifications：The bidder cannot determine the environmental packa…
- [LOW_VALUE] Reciprocal procurement eligibility：The bidder cannot determine which suppliers are eligibl…
- [LOW_VALUE] Quarterly report：A bidder cannot determine who must submit the quarterly report or what in…
- [LOW_VALUE] Applicable Trading Partner：A bidder cannot determine from these pages which trading partne…
- [LOW_VALUE] Environmentally preferable packaging criteria：The specific packaging characteristics or co…
- [LOW_VALUE] Water-resistance test：The bidder cannot determine the water-resistance test method or pass…
- [USEFUL] Referenced technical specifications：The bidder cannot determine the applicable zipper, web…
- [USEFUL] Annex C measurement method：The bidder cannot determine the required dimension measurement …
- [NECESSARY] Sample requirement：The bidder cannot determine from these pages whether a sample is requir…
- [LOW_VALUE] Environmentally preferable packaging：The bidder cannot determine what packaging characteri…

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
- Analyzer：tender-understanding/v2｜models=gpt-5.6-terra｜LLM calls=54（失败 12）｜windows=21｜220.1s｜tokens=128580/86338
- Prompts：tender-understanding-v2-extract@2×30，tender-understanding-v2-resolve@1×24｜UNKNOWN 槽位：site_visit,installation,warranty,bond,addenda｜冲突 1｜语料已解决歧义 9

### Scorecard

| 指标 | 值 | 说明 |
| --- | --- | --- |
| Requirement Recall (strict / lenient) | 81.6% / 89.5% | golden 38 条 |
| Mandatory Recall (strict / lenient) | 81.6% / 89.5% | mandatory golden 38 条 |
| Requirement Precision | 28.3% | 系统输出 120 条 |
| False Positive Rate | 46.7% | Duplicate Rate 25.0% |
| Critical Fact Accuracy | 77.3% | 关键事实 22 项；全事实 79.0%（38 项） |
| 值对证据错（计失败） | 0 项 | CORRECT_VALUE_BAD_EVIDENCE |
| Evidence Coverage / Accuracy | 100.0% / 100.0% | Unsupported Claim Rate 0.0% |
| Risk Recall | 100.0% | golden 8 条；CRITICAL_RISK_MISSED = 0 |
| Useful Clarification Rate | 0.0% | 系统提问 14 条；幻觉 0 条 |
| Already Answered Rate | 0.0% | NECESSARY 覆盖率 0.0% |
| CROSS_DOMAIN_LEAK | **0** | facts 0 + reqs 0 + 风险行 0 + 澄清 0 |
| 歧义处理 | 1/2 OK | expectedUnknown 违规 0 |

### MISSED Requirements（4/38）

- `R-COM-FX`【mandatory】（HIGH）
- `R-CERT-FCP`【mandatory】（NORMAL）
- `R-PERF-FORCED-LABOUR`【mandatory】（HIGH）
- `R-PERF-CALLUP-ITEMS`【mandatory】（NORMAL）

### PARTIAL Requirements（3）

- `R-SUB-3PDF` ← `R-011`（coverage 0.909）
- `R-SUB-5MB` ← `R-013`（coverage 0.313）
- `R-SUB-SUBSTANTIATION` ← `R-027`（coverage 0.333）

### FALSE_POSITIVE 输出（56）

- `R-001`
- `R-003`
- `R-005`
- `R-006`
- `R-008`
- `R-009`
- `R-010`
- `R-012`
- `R-015`
- `R-017`
- `R-022`
- `R-023`
- `R-024`
- `R-025`
- `R-026`
- `R-029`
- `R-030`
- `R-031`
- `R-032`
- `R-036`
- `R-038`
- `R-044`
- `R-046`
- `R-050`
- `R-051`
- `R-071`
- `R-072`
- `R-076`
- `R-078`
- `R-079`
- `R-080`
- `R-081`
- `R-082`
- `R-083`
- `R-084`
- `R-089`
- `R-090`
- `R-091`
- `R-092`
- `R-093`
- `R-094`
- `R-098`
- `R-100`
- `R-101`
- `R-102`
- `R-103`
- `R-109`
- `R-112`
- `R-113`
- `R-114`
- `R-115`
- `R-116`
- `R-117`
- `R-118`
- `R-119`
- `R-120`

### 未达标事实（8/38）

- `F-ENQUIRY-DEADLINE`【critical】: NOT_EXTRACTED
- `F-OPTIONS`: WRONG_VALUE（候选: contract_duration:F-071, req:R-104）
- `F-QTY-ANNEX-A`【critical】: NOT_EXTRACTED
- `F-QTY-ANNUAL`【critical】: NOT_EXTRACTED
- `F-QTY-AGGREGATE`【critical】: NOT_EXTRACTED
- `F-NO-ZIP`: WRONG_VALUE（候选: req:R-014, req:R-054, req:R-055, req:R-066）
- `F-CALLUP-MAX`【critical】: NOT_EXTRACTED
- `F-FORCED-LABOUR`: NOT_EXTRACTED

### 风险判定

`RISK-ELIGIBILITY[CRITICAL]`(DETECTED)、`RISK-SUBMISSION-REJECT[CRITICAL]`(DETECTED)、`RISK-SUBSTANTIATION[CRITICAL]`(DETECTED)、`RISK-PRICING-TABLE[CRITICAL]`(DETECTED)、`RISK-QTY-NO-GUARANTEE[IMPORTANT]`(DETECTED)、`RISK-DELIVERY-PRESSURE[IMPORTANT]`(DETECTED)、`RISK-FX[IMPORTANT]`(DETECTED)、`RISK-ADMIN-REPORTING[IMPORTANT]`(DETECTED)

### 澄清问题判定

- [LOW_VALUE] Offer closing details：The bidder cannot determine the actual offer closing date, time, pla…
- [LOW_VALUE] Applicable Trading Partner eligibility definition：The provided pages do not define which e…
- [LOW_VALUE] Email submission address：The bidder cannot determine the email address to which the offer …
- [LOW_VALUE] Referenced Standard Instructions：The bidder cannot determine the specific Section 05 submi…
- [LOW_VALUE] Applicable Trading Partner eligibility definition：Which suppliers or countries qualify as …
- [LOW_VALUE] Certificate of Independent Offer Determination：A bidder cannot determine the certificate's…
- [LOW_VALUE] Referenced attachment contents：The information, declarations, and signatures required in A…
- [LOW_VALUE] Required certifications and additional information：The provided pages do not state the spe…
- [LOW_VALUE] Project Authority contact details：The bidder cannot determine the Project Authority's name…
- [LOW_VALUE] Standing Offer usage report format and data requirements：The bidder cannot determine the s…
- [LOW_VALUE] Project Authority identity：The bidder cannot determine the Project Authority's identity or…
- [LOW_VALUE] Invoice submission email address：The email address to which the invoice must be sent for c…
- [LOW_VALUE] Firm unit price amount：The firm unit price amount cannot be determined from these pages.
- [LOW_VALUE] Canadian Goods evaluation method：Whether aggregate evaluation or item-by-item evaluation w…

未被问到的 NECESSARY 主题：`CLAR-CALLUP-VOLUME`、`CLAR-QTY-BASIS`、`CLAR-OVERSEAS`

### 歧义处理

`AMB-QTY-BASIS(CLARIFICATION_REQUIRED)`(MISSED)、`AMB-FIRM-VS-ESTIMATED(FLAGGED)`(OK)

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
- Analyzer：tender-understanding/v2｜models=gpt-5.6-terra｜LLM calls=5（失败 0）｜windows=2｜20.8s｜tokens=4855/3720
- Prompts：tender-understanding-v2-extract@2×2，tender-understanding-v2-resolve@1×3｜UNKNOWN 槽位：tender_number,question_deadline,site_visit,location,quantity,delivery,warranty,bond,submission_method,pricing_method｜冲突 0｜语料已解决歧义 0

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
| Useful Clarification Rate | 0.0% | 系统提问 3 条；幻觉 0 条 |
| Already Answered Rate | 33.3% | NECESSARY 覆盖率 0.0% |
| CROSS_DOMAIN_LEAK | **0** | facts 0 + reqs 0 + 风险行 0 + 澄清 0 |
| 歧义处理 | 0/3 OK | expectedUnknown 违规 0 |

### MISSED Requirements（0/12）

（无）

### PARTIAL Requirements（6）

- `RB-WARRANTY` ← `R-010`（coverage 1）
- `RB-FIRST-QUALITY` ← `R-006`（coverage 0.75）
- `RB-MEASURE` ← `R-004`（coverage 1）
- `RB-REMOVAL` ← `R-005`（coverage 1）
- `RB-SUPPLY-INSTALL` ← `R-003`（coverage 0.161）
- `RB-SAMPLES-SHORTLIST` ← `R-012`（coverage 0.235）

### FALSE_POSITIVE 输出（0）

（无）

### 未达标事实（1/15）

- `FB-WARRANTY`【critical】: WRONG_VALUE（候选: req:R-010）

### 风险判定

`RISKB-NO-QUANTITIES[CRITICAL]`(DETECTED)、`RISKB-SERVICE-WEIGHTED[CRITICAL]`(MISSED)、`RISKB-MOTOR-SPECS[IMPORTANT]`(MISSED)、`RISKB-FIRE-CERT[IMPORTANT]`(DETECTED)、`RISKB-ADDENDUM-TRACKING[IMPORTANT]`(MISSED)

### 澄清问题判定

- [LOW_VALUE] Submission deadline time：The bidder cannot determine the submission time or applicable tim…
- [ALREADY_ANSWERED] Product sample requirement：The bidder cannot determine whether a sample is required, when …
- [LOW_VALUE] CSA and CSGA standards：The bidder cannot determine which specific CSA and CSGA standards a…

未被问到的 NECESSARY 主题：`CLARB-QUANTITIES`、`CLARB-PRICING-FORMAT`、`CLARB-MOTOR`、`CLARB-SUBMISSION`

### 歧义处理

`AMBB-QUANTITIES(CLARIFICATION_REQUIRED)`(PARTIAL)、`AMBB-MOTOR-SPECS(CLARIFICATION_REQUIRED)`(PARTIAL)、`AMBB-SUBMISSION-METHOD(CLARIFICATION_REQUIRED)`(PARTIAL)
