# QINGYAN TENDER REAL EVALUATION V1 — Golden Benchmark & AI Quality Baseline

- 日期：2026-08-10
- 分支：`test/tender-real-evaluation-v1`（base = main@4f082cd，含 #95）
- 类型：PRODUCT VALIDATION / EVALUATION / TEST INFRASTRUCTURE
- 生产行为变更：**NO**（新增 tests / scripts / fixtures / docs + 1 个 npm script + test-all.sh 注册 1 行；`src/lib/tender-auto-analysis/**` 与一切生产模块零改动）
- Benchmark 契约：`tender-eval/v1`（`src/lib/tender-eval/contract.ts`）
- 运行方式：`npm run test:tender-eval` → `artifacts/tender-eval/<runId>/results.{json,md}`
- 本次基线快照：`docs/tender-eval/baseline-v1/`（runId `20260810-235654Z-4f082cd`，DETERMINISTIC lane，`tender-auto-analysis-v1` / `tender-analysis-prompt-v1` / `tender-page-parse-v1`）

> 一句话结论：**现有"Tender AI 分析"不是 AI——是一套针对单一 RCMP 文档手写的正则+模板引擎，LLM 通路是空壳。** 它在自己的合成 fixture 上接近满分（100% / 94.4%），在同一份招标的真实 43 页原件上强制要求召回掉到 44.7%，在青砚真实业务域（窗饰标书）上为 0%，并向窗饰客户输出 6/9 条背包主题的幻觉澄清问题。本报告建立了固定考卷与可重复评分器，把这个真实起点钉死为 V1 基线；后续 T1–T5 每个版本都跑同一套考卷比对。

---

## 1. Current evaluation coverage（现有评估覆盖审计）

现有 tender 测试共 18 个文件（16 个 `src/lib/tender-auto-analysis/__tests__/` + `tender-result.test.ts` + `tender-skills.test.ts`），全部注册在 `scripts/test-all.sh`，全部确定性、零 LLM、零 DB。分类结论：

| 分类 | 数量 | 代表 | 实质 |
| --- | --- | --- | --- |
| UNIT TEST | 11 | status / gate / idempotency / package-fingerprint / source-verify / addendum-diff 等 | 真实的函数级逻辑保护，质量合格 |
| REGRESSION TEST | 5 | extract-core / rcmp-regression / report-core / phase-efg-core / ready-gate | 固定输入→固定输出；其中 ready-gate 是**源码文本 grep**（readFileSync 8 个生产文件找字符串），极脆 |
| BUSINESS EVALUATION | **0** | — | **不存在任何"AI 输出 vs 黄金真相"的质量测量** |

关键定性：RCMP 回归系列接近**同义反复**——fixture 是照着 `extract/facts.ts` 里的硬编码正则写的（`/\bM5000-25-3574-A\b/`、`/Backpacks\s+for\s+Cadets/`、`/\bDate\s+(July\s+29,\s*2026)\b/` 等直接把该文档的编号/标题/日期写进"抽取器"），`looksLikeRcmpBackpackRfp()` 命中后还会**凭空补齐缺失的 M1–M15 占位行**（`requirements.ts:296-313`）。`clarifications.length >= 8` 断言结构上不可能失败（`clarifications.ts:186` 不足 8 条时回落全量模板）。五个业务维度（要求召回、事实准确、证据准确、风险检出、澄清质量）此前覆盖为**零**。

LLM 现状（对"AI Analysis"预期的校准）：整条管线只有两个 LLM 调用点，且都不影响分析内容——`extract/llm-enrich.ts:14` 发送 `"OK"` 做可用性探测后**原样返回 facts**；`report.ts:306` 仅对已生成的中文章节做语气润色。默认 `TENDER_ANALYSIS_LLM` 关闭时连这两个调用都不发生。生产 Tender 分析 = 纯确定性路径（`tender-phase11-final-validation.ts:326` 自证："生产等价权威路径"）。另有一条**旧 LLM 情报链路** `generateProjectIntelligence`（`src/lib/files/intelligence-extractor.ts:151`，写 `ProjectIntelligence`，生产库现存 8 行），带 `docs/intelligence-report-eval.md` 的 10 项人工检查清单——那是目前唯一"真 AI"，但只有人工评估协议，无自动评分。

## 2. Available real fixtures（现有真实数据）

| 数据 | 位置 | 定性 |
| --- | --- | --- |
| RCMP RISO `M5000-25-3574-A` 真实原件（43 页 PDF，505KB，GoC 公开招标） | 本机 `fixtures/private/`（gitignored；`TENDER_FIXTURE_PDF_PATH` 约定） | **唯一完整真实标书**。产品域是背包（非窗饰），且抽取器对它过拟合 |
| RCMP 合成 fixture（15 页转写节选） | `src/lib/tender-auto-analysis/__tests__/fixtures/rcmp-backpack-pages.ts`（已提交） | 转写**不忠实**：真实 M3=37–55L，fixture 写 minimum 35 litres；真实 M11=dark blue/black，fixture 写 olive/black——以 fixture 为真相会学错事实（本次已在 case-a-real golden notes 登记） |
| DSBN 窗饰 RFP 浓缩转写 + Addendum-01 | `scripts/intelligence-report-eval/sample-input-01-curtain-tender.json`（已提交） | **repo 内唯一窗饰域标书文本**（~1.6k 字符），真实招标改写，非完整原件 |
| 生产 DB（只读盘点，2026-08-10） | Neon 生产库 | tender 域项目 16 个、PDF 文档约 24 份，但**仅 5 份文档有页级解析文本（共 68 页）**；TenderAnalysisRun 9 个（3 APPROVED / 3 REVIEW_REQUIRED / 3 SUPERSEDED）；ProjectIntelligence 8 行。真实标书存在于库中但大多未解析成页文本 |

repo 可见性：**PUBLIC**（`LucasJ880/-`）。因此 V1 起约定：真实标书全文一律 `fixtures/private/`（.gitignore 已有此约定），case 文件只携带引文级 `sourceQuote`；本次未提交任何完整标书文本与商业报价。

## 3. Missing real data → REAL_DATA_REQUIRED

按任务书理想组合，缺口如下（V1 框架已就绪，补数据即可成 case）：

| 目标 Case | 状态 | 需要 Lucas 提供 |
| --- | --- | --- |
| CASE A 普通 Roller Shades | **缺** | 1 份真实卷帘（手动）标书完整 PDF |
| CASE B Motorized Roller Shades | **缺**（现 DSBN case 仅浓缩转写，含 motorized 但无规格） | 1 份真实电动卷帘标书完整 PDF（含电机/控制规格） |
| CASE C 复杂 Technical Specifications | 部分（RCMP 原件充当，非窗饰域） | 1 份规格书厚重的窗饰/建材标书 |
| CASE D 多 Addendum | **缺**（DSBN 仅 1 个转写补遗） | 1 个含 ≥2 份真实 Addendum 的项目全套文件 |
| CASE E 有 Award/Outcome | **缺** | 1 个已知中标结果（含中标价或名次）的历史项目 |

供给路径已铺好：`npx tsx scripts/tender-eval-export-case.ts <projectId> <caseId>` 从库导出页文本到 `fixtures/private/tender-eval/<caseId>/`（自动生成 golden-skeleton.md 人工填写模板）；生产库那 16 个 tender 项目中未解析的 PDF 需先在应用内触发页解析。**Golden 答案必须由人（Lucas/投标负责人）确认——这是数据缺口，不是代码缺口。**

## 4. Benchmark cases（V1 实际建成）

| caseId | 来源 | 文档 | Golden 规模 | 作用 |
| --- | --- | --- | --- | --- |
| `case-a0-rcmp-fixture` | SYNTHETIC（committed fixture） | 1 doc / 15 页 | 16 req / 23 facts / 5 risks / 9 clar | **过拟合对照组**：管线在其构建目标上的表现；与 A-REAL 的分差 = 过拟合幅度 |
| `case-a-rcmp-riso-real` | **REAL**（43 页原件，本地加载，缺失自动 SKIP） | 1 doc / 43 页 | 38 req / 38 facts / 8 risks / 9 clar / 5 unknowns | 真实文档能力测量（含 p23 双重"30 天"证据陷阱、汇率禁令、报价表完整性等真实考点） |
| `case-b-dsbn-window-coverings` | NEAR_REAL_RECONSTRUCTED（repo 内 DSBN 转写） | 2 docs（主文件+补遗）/ 2 页 | 12 req / 15 facts / 5 risks / 8 clar / 5 unknowns | **业务域泛化**测量（窗饰）；含补遗覆盖考点（样品/保险/本地安装被 Addendum 改写） |

## 5. Golden answer method（黄金答案方法）

- 全部 golden 由**逐页阅读源文件文本**转录：每条 fact/requirement/risk/clarification 带 `documentId + 允许页码 + 原文引文`，可逐条人工复核；`expectedUnknowns` 记录文件**确实没有回答**的字段（质保/保证金/样品/预算/现场踏勘），系统以确定口吻声称即违规。
- **抽取器/AI 输出从未反向进入 golden**。评分器锚词做过 3 处对真实输出形态的适配（如容忍换行截断的 M13 正文），均为"把系统输出对到正确的判定桶"，每处有源文件引文支撑，不改变文档真相。
- 现状标记：三个 case 均为 `PENDING_HUMAN_CONFIRMATION`——由本任务评审者（AI 读原文）起草，**待 Lucas 逐条确认后升级 HUMAN_CONFIRMED**；确认前所有数字定性为"临时基线"。
- 关键副产物：确认过程中发现 committed fixture 与真实原件的两处实质性偏差（M3 容量、M11 颜色）——**现有回归 fixture 本身教错事实**，已在 case 文件 notes 登记，未顺手修。

## 6. Metrics（指标与判定规则）

判定全部确定性、无 LLM judge（规则见 `evaluate.ts` 头注，阈值写入 run metadata）：

- **Requirement**：锚词组（组内 AND、组间 OR）定位候选 → 内容词覆盖率 ≥0.35 且 mandatory 标志一致 = MATCHED，否则 PARTIAL；无候选 = MISSED；未归属输出 = FALSE_POSITIVE；同 golden 第二候选起 = DUPLICATE。指标：Requirement/Mandatory Recall（strict=仅 MATCHED；lenient=含 PARTIAL）、Precision、FP Rate、Duplicate Rate。
- **Critical Facts**：归一化值判等（`2026-08-13`==`Aug 13 2026`；`$400K`==400000；`30 days`==`30 个日历日`；datetime 需日期+时间+时区齐备）。**值正确但证据缺失/页码错 = `CORRECT_VALUE_BAD_EVIDENCE`，计入失败**（任务书第十节铁律）。
- **Evidence**：sourceRef 的 snippet 必须逐字（归一化后）出现在其声称的 doc+page；golden 限定页码时页码必须命中。指标：Evidence Coverage / Evidence Accuracy / Unsupported Claim Rate。
- **Risk**：先剔除命中幻觉探针的风险行（不得给 golden 记 DETECTED），再按锚词判 DETECTED/MISSED；单列 `CRITICAL_RISK_MISSED`。
- **Clarification**：幻觉探针扫"问题+理由"；主题匹配只看问题文本。分类 NECESSARY / USEFUL / LOW_VALUE / ALREADY_ANSWERED / HALLUCINATED；指标 Useful Rate、Already-Answered Rate、NECESSARY 主题覆盖率。
- 分母为 0 → `null`（N/A），与 0 严格区分。评分引擎自身有 11 组自测（`eval-harness.test.ts`，已注册 test-all）。
- **Deterministic vs LLM 双 lane**：本次为 DETERMINISTIC lane（=生产默认路径）。LLM lane 记录字段已备（model/promptVersion/时间戳），但当前开启 `TENDER_ANALYSIS_LLM=1` 也不会改变抽取输出（no-op 探测）→ LLM lane = **NOT_MEASURED（结构性无物可测）**。

## 7. Baseline results（V1 基线，DETERMINISTIC lane）

| 指标 | A0 合成对照 | **A-REAL 真实原件** | **B 窗饰业务域** |
| --- | --- | --- | --- |
| Requirement Recall (strict/lenient) | 100% / 100% | **44.7% / 65.8%** | **0% / 0%** |
| Mandatory Recall (strict/lenient) | 100% / 100% | **44.7% / 65.8%** | **0% / 0%** |
| Requirement Precision | 100% | 80.7%（FP 0%，Dup 19.4%） | N/A（输出 0 条） |
| Critical Fact Accuracy | 94.4% (17/18) | **77.3% (17/22)** | **0% (0/11)** |
| Fact Accuracy（全部） | 95.7% | 65.8% | 0%（15 项全 NOT_EXTRACTED） |
| 值对但证据错（计失败） | 1 | 1 | 0 |
| Evidence Coverage / Accuracy | 100% / 100% | 100% / 100% | N/A（无任何声称） |
| Unsupported Claim Rate | 0% | 0% | N/A |
| Risk Recall | 80% | **37.5%** | **0%** |
| CRITICAL_RISK_MISSED | 1 | **3** | **2** |
| 幻觉风险行 | 0 | 1 | **3** |
| Useful Clarification Rate | 100% | 77.8% | **0%** |
| 幻觉澄清 / Already-Answered | 0 / 0 | 1 / 0 | **6 / 1** |
| NECESSARY 澄清覆盖率 | 80% | 100% | **0%** |
| 歧义处理 / Unknown 违规 | 1/1 OK / 0 | 2/2 OK / 0 | 1/3 OK / 0 |

三列合读即结论：**A0→A-REAL 的落差（100→44.7）是过拟合幅度；A-REAL→B 的落差（44.7→0）是域迁移完全失效。** 唯一稳定的强项是证据纪律（见 §9）。

## 8. Top failure categories（失败大类，按严重度）

1. **业务域泛化 = 0（CASE B 全线归零）**：通用抽取只认行首 `bidder/contractor/offeror/... shall|must` 模式（`requirements.ts:136`），DSBN 的 "All materials shall…" / "Products shall…" / "9. System shall…" 一条都抓不到 → 0 条要求、0 条事实；closing 解析器（`extract/closing.ts:23`）不识别 "Submission Deadline: November 30, 2026"。
2. **对真实文档的强制要求盲区（A-REAL 13 条 MISSED，其中 7 条 CRITICAL）**：全部提交类/资格类/履约类硬门——邮箱+截标接收、三份 PDF、5MB/禁 ZIP、价格隔离、汇率条款禁令、诚信名单、Reciprocal 资格、30 天交付、24h 确认、DDP、装箱单、卸货、季报。这些每条都可能直接废标，当前一条都不进要求清单（部分作为"事实"存在，但不作为可勾稽的 requirement）。
3. **幻觉输出（CASE B）**：9 条澄清问题里 6 条是背包主题（1000D 面料、拉链织带、call-up 数量、7,500、海外制造/Reciprocal）——源于 `clarifications.ts:186` "不足 8 条回落全量 RCMP 模板"；风险章节 3 行 RCMP 硬编码风险照发给窗帘标书。**这是当前对客户最危险的行为：内容错得自信。**
4. **真实 PDF 上 M 条款正文截断**：段落回退 `[^\n]{8,200}` 在换行处截断（M1 只剩 "Main Compartment size must be:"，尺寸值丢失；M14 丢 PALS/MOLLE）→ 8 条 PARTIAL。要求"存在"但内容不可用于合规勾稽。
5. **风险=模板不=分析**：RISKS 章节 5 行与 summaryJson topRisks 4 行都是硬编码字符串（`report.ts:187-201, 279-284`），与输入无关 → A-REAL 8 条真实风险只"碰中"3 条（数量不保证/提交技术性/交付压力），资格、substantiation 失格、报价表完整性、汇率 4 类 CRITICAL/HIGH 全 MISS。
6. **证据指向弱源**：enquiry deadline 引 p1 封面（closing 输入）而非 p6 询价条款原文——两个 RCMP case 各 1 例 `CORRECT_VALUE_BAD_EVIDENCE`。另 A0 對照组也复现，说明是规则本身的证据习惯问题。
7. **补遗语义未测（结构性）**：ADDENDUM/INCREMENTAL 路径生产不可达（`detectRunKind` 零调用方、enqueue 全部硬编码 FULL），CASE B 的补遗覆盖考点（样品由"可能要"改为"入围才要"）当前无从答对。

## 9. Current AI strengths（当前强项——如实记录）

1. **证据纪律是真的**：两个 RCMP case 的 Evidence Coverage / Accuracy 均 100%，Unsupported Claim Rate 0%——`source-verify.ts` 的"CONFIRMED 必须逐字在页上，验不过即降级/丢弃"机制有效；`expectedUnknowns` 零违规（不虚构质保/保证金/预算/样品）。**宁可漏、不乱编**的失败模式方向是对的。
2. 数量歧义处理成熟（RCMP 域）：Annex A vs Annex B 口径冲突被标记+发问+7,500 坚持 DOCUMENT_INTERPRETATION 非保证——A-REAL 两条 knownAmbiguities 全 OK。
3. p23 证据陷阱通过：delivery 30 天正确引 p30/34，未被展期通知/季报的"30 天"干扰。
4. 在其构建域内澄清问题质量高：A-REAL 上 9 问 7 中（77.8% useful，NECESSARY 覆盖 100%）——模板内容本身是投标专家水准，问题在于它不看文档。
5. 多文档去重/冲突标记（DOCUMENT_CONFLICT 不静默覆盖）与包指纹/幂等/状态机等工程面有真实单测保护。

## 10. Current AI weaknesses（当前弱项）

一句话：**没有"读文档"的能力，只有"认得一份文档"的能力。** 具体即 §8 的 1/2/3/5；另加：翻译层是关键词启发式（`【待译】` 占位）、风险与商业分析章节内容与输入解耦、LLM enrichment 空壳、旧 intelligence 链路（真 LLM）与新管线互不相通且无自动评估。

## 11. Which failures block real customer use（哪些失败阻断真实客户使用）

按"给窗饰客户用"判定：

- **BLOCKER-1（幻觉澄清/风险，§8-3）**：把背包问题发给窗帘业主=当场信誉破产。这是唯一"主动产生错误输出"的类别，比漏抽严重。
- **BLOCKER-2（业务域 0 召回，§8-1）**：对客户的实际标书产出空报告——产品不可用（但因输出为空而"安全地"不可用）。
- **BLOCKER-3（强制要求盲区，§8-2）**：44.7% mandatory recall 意味着投标团队若信任清单，会漏掉可废标的硬门（5MB 邮箱、报价表完整性、汇率条款禁令这类"技术性死刑"条款）。
- 非阻断但侵蚀信任：M 正文截断（§8-4）、证据弱源（§8-6）。
- **不阻断**：证据纪律与"不编造"性质（§9-1/2）是可交付客户的底座，应在 T1+ 保持为硬门。

## 12. What should T1/T2/T3/T4 improve（对路线图的输入）

按 T0 路线图（`QINGYAN_TENDER_T0_IMPLEMENTATION_ROADMAP.md`）对位，本基线给出的优先序：

- **T1（Tender UX/Workbench）**：UI 消费的 requirement/clarification 数据要显示 golden 化状态与证据页码；本基线的 `CORRECT_VALUE_BAD_EVIDENCE` 类别应成为 review UI 的一等公民（值对≠可用）。
- **T2（Ledger/Memory 入口）**：把"补遗覆盖"（CASE B 考点）作为 ProjectEvent/版本口径的验收用例；addendum 语义当前生产不可达（§8-7）需在 T2 排产。
- **T3（Tender Intelligence 真 AI 化）**：这是本报告的核心受益者——把 LLM 真正接进 extract/requirements/clarifications（替换 RCMP 模板），**验收标准就用本 benchmark**：CASE B mandatory recall 0%→目标 ≥80%，幻觉澄清 6→0，同时 Evidence Accuracy 不得跌破 100%（新增 LLM lane 记录 model/promptVersion 后跑同一考卷）。
- **T4（Award/Memory 域）**：CASE E 需要真实 award 数据（§3）；本契约的 `provenance`/`expectedUnknowns` 已为 award 类黄金字段留位。
- 横切：每个 T 合入前后各跑一次 `npm run test:tender-eval`，分差写进 PR——"变聪明"从此有数字。

## 附：本次交付物清单

- `src/lib/tender-eval/`：contract / normalize / evaluate / run-pipeline / real-pdf / report-io / cases×3 / README / 自测（11 组断言）
- `scripts/tender-eval-run.ts`（`npm run test:tender-eval`）、`scripts/tender-eval-export-case.ts`（真实数据供给脚手架）
- `docs/tender-eval/baseline-v1/results.{json,md}`（提交的基线快照）、本文档
- `scripts/test-all.sh` +1 行（评分引擎自测注册）；`package.json` +1 script
- 未修任何被发现的问题（含 fixture 与真实原件的偏差、clarifications 回落模板、M 正文截断）——全部只记录

---

## FINAL OUTPUT

```
REAL_TENDER_CASES        = 2  （1 REAL 完整原件 case-a-rcmp-riso-real + 1 NEAR_REAL_RECONSTRUCTED case-b-dsbn；
                               另有 1 SYNTHETIC 过拟合对照 case-a0 不计入）
GOLDEN_REQUIREMENTS      = 66 （A-REAL 38 + B 12 + A0 16；全部 PENDING_HUMAN_CONFIRMATION）
MANDATORY_RECALL         = A0 100% ｜ A-REAL 44.7%（strict）/ 65.8%（lenient）｜ B 0%
REQUIREMENT_RECALL       = A0 100% ｜ A-REAL 44.7%（strict）/ 65.8%（lenient）｜ B 0%
CRITICAL_FACT_ACCURACY   = A0 94.4% ｜ A-REAL 77.3% ｜ B 0%
EVIDENCE_ACCURACY        = A0 100% ｜ A-REAL 100% ｜ B N/A（零声称，无物可评）
CRITICAL_RISK_MISSED     = A0 1 ｜ A-REAL 3 ｜ B 2 （合计 6）
LLM_LANE                 = NOT_MEASURED（生产 LLM 通路为 no-op 空壳，结构性无物可测）
GOLDEN_CONFIRMATION      = PENDING_HUMAN_CONFIRMATION（Lucas 逐条确认后本基线转正）
REAL_DATA_REQUIRED       = 卷帘（手动）原件 / 电动卷帘原件（含电机规格）/ 复杂技术规格 /
                           多 Addendum 全套 / 含 Award 结果项目（见 §3，导出脚手架已就绪）
PRODUCTION_BEHAVIOR_CHANGE = NO
```
