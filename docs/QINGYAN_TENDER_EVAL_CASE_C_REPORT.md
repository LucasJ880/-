# tender-eval case-c — HRM-2026-0395 媒体监测 RFQ（首个服务类真实原件）

日期：2026-08-21 · 分支 `feature/tender-eval-case-c-hrm` · base = main `10218b38` · 基准契约 tender-eval/v1 不变（新增 case，评分/阈值/归一化零改动）

## 1. 为什么要这个 case

现有三案全是货物类（RCMP 背包 ×2、DSBN 窗饰）；青砚正在投的是服务类 / SaaS（Halifax 媒体监测）。
没有服务类 golden，基准对「我们真正投的标」是盲的——批次二新槽位（现任供应商 / 评分标准）
与 PO 服务条款风险（数据驻留 / IP / 无因终止）也无处测量。

## 2. 文档与 golden

- 文档：HRM 公开 RFQ 原件 26 页 + Purchase Order T&C – Services 24 页 + Supplier Code of Conduct 7 页
  （57 页），由 `scripts/tender-eval-export-case.ts` 从产品解析结果只读导出到
  `fixtures/private/tender-eval/case-c-hrm-media-monitoring/`（gitignored；缺失 → SKIPPED，不合成顶替）。
- golden：评审者逐页阅读导出文本转录，**每条带页码 + 原文引文**：33 fact（20 critical）/ 25 要求（全 mandatory）/
  2 歧义（保险 NA vs PO §13；合同期措辞）/ 9 风险（美企 0 分 / 数据驻留 / 无因终止 …）/ 7 澄清
  （提问截止日、现任身份与年费、保险适用性、内部估算、境外托管…）/ 4 expectedUnknown
  （提问截止日、现任名称、保险限额、内部估算——文件确实没写，系统不得声称）/ 5 幻觉探针。
- 状态 **PENDING_HUMAN_CONFIRMATION**（待 Lucas 逐条确认）。
- 读文发现：**截标 2026-09-08 14:00 Atlantic**（RFQ p1/p3/p20），项目名「09-05」不是文件口径；
  文件未给提问截止日（门户上的 8/28 不在文件里）；现任供应商**未具名**。

## 3. 首跑（provisional run 1，`20260821-174440Z-10218b3`，快照 docs/tender-eval/case-c-provisional-run1/）

| 指标 | V1 确定性 | V2 真实 LLM |
| --- | --- | --- |
| Mandatory Recall (strict / lenient) | 4.0% / 8.0% | **68.0% / 92.0%** |
| Critical Fact Accuracy | 0.0% | **80.0%** |
| Fact verdicts（32） | 全 NOT_EXTRACTED | CORRECT 23 / WRONG_VALUE 6 / NOT_EXTRACTED 3 |
| Evidence Accuracy / Unsupported | 100% / 0 | 100% / 0 |
| Risk Recall / CRITICAL_RISK_MISSED | 11.1% / 2 | **77.8% / 0** |
| 歧义标出 | 1/2 | **2/2** |
| CROSS_DOMAIN_LEAK / 幻觉澄清 | 0 / 0 | 0 / 0 |
| expectedUnknown 违规 | 0 | 1（golden 锚词误伤，见下） |

解读：
- V1 = RCMP 单文档正则，在服务类上归零——与 case-b 同一结论，**生产早已走 V2**，此处只作对照。
- V2 首跑即 80% 关键事实 / 92% 宽松召回 / 零幻觉零泄漏；新槽位 `incumbent_supplier`（未具名现任）
  与 `evaluation_criteria`（公式）被抽到并匹配 CORRECT（FC-INCUMBENT / FC-COST-FORMULA / FC-US-ZERO）。
- 唯一 expectedUnknown 违规 = 我的禁用锚词 `"cision"` 在 PO 隐私条款 "pre**cision**" 内子串命中
  （factKey req:R-208，摘录与现任无关）——**golden 锚词缺陷，非系统幻觉**；已改为 "cision ltd"/"cision canada"
  并在 case 文件注明 GOLDEN_CHANGE。修正后违规应为 0（下次复跑验证）。
- 6 条 WRONG_VALUE（站点踏勘布尔、评分权重长句、用户数、参考数、社交媒体、生活工资）多数为
  **候选命中但值归一化口径不合**（如布尔 vs「Not Applicable」文本、长句 vs 结构化声明）——属 golden
  别名/归一化校准候选，**留待人工确认时一并定夺，本 PR 不为分数调 golden 别名**。
- 3 条 NOT_EXTRACTED（绩效默认 60%、月均 375 条、年价单位）是真实漏抽——记入 V2 改进清单，
  **不为分数调生产代码**。

## 4. 纪律

- golden only human：本 case 由我读文转录、Lucas 确认后才升 HUMAN_CONFIRMED；AI/抽取器输出不反向进 golden。
- 基准冻结面（evaluate/normalize/contract/阈值）零字节改动；本 PR 只增 case 文件 + 注册 + 快照 + 报告。
- 真实标书全文只在本机私有目录；case 文件仅携带引文级 sourceQuote（repo PUBLIC）。

## 5. Gate

```
CASE_C_PROVENANCE      = REAL（57 页原件，产品解析文本导出）
CASE_C_GOLDEN_METHOD   = PENDING_HUMAN_CONFIRMATION（33/25/2/9/7/4 逐条页码引文）
CASE_C_FREEZE_DRIFT    = 0（评分/归一化/契约零改动）
CASE_C_FIRST_RUN       = V2 关键事实 80% / 强制召回 68-92% / 风险 77.8% / 零幻觉零泄漏
CASE_C_PROD_TUNING     = NONE（漏抽与归一化口径记入改进清单，不为分数调码）
CASE_C_STATUS          = READY_FOR_FINAL_REVIEW（Draft PR，不 merge）
```
