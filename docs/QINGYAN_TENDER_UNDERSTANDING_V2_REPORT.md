# QINGYAN TENDER UNDERSTANDING V2 REPORT
## Generalized LLM Tender Analyzer + Evidence Verification + Benchmark Gate

- 日期：2026-08-11
- 分支：`feature/tender-understanding-v2`（base = main@3b6406b；依赖并入 origin/test/tender-real-evaluation-v1 = PR #97 benchmark，#97 合并后本 PR diff 自动收敛）
- Feature Flag：`TENDER_ANALYSIS_V2_ENABLED`（**production default = OFF**）
- 模式：SHADOW / EVALUATION ONLY——V2 零生产路由接线，V1 用户路径原样保留
- SCHEMA_CHANGE = NONE ｜ WORKFORCE_RUNTIME_MODIFIED = NO ｜ T1B_STARTED = NO

> 一句话结论：V2 是一个真实调用 LLM（Unified Model Runtime，本次解析为 `gpt-5.6-terra`）的证据接地理解引擎——LLM 负责语义理解，确定性代码负责结构/归一化/去重/校验/状态约束，Evidence Verifier 是任何候选进入业务结果前的硬门。V1 的 RCMP 专用正则、背包澄清模板、固定风险文案在 V2 中一概不存在；跨域泄漏为 0；文档没写的信息保持 UNKNOWN。

---

## 1. V1 Root Cause Audit

PR #97 基线揭示的根因，本次逐文件复核确认：

1. **V1 不是通用理解引擎**：`extract/facts.ts` 的"抽取规则"把单一 RCMP 招标（M5000-25-3574-A）的编号/标题/发布日/合同期/DDP 条款写死在正则里；`extract/requirements.ts` 的 M-code 规则上限写死 15 并在 `looksLikeRcmpBackpackRfp()` 命中时**凭空补齐缺失 M 行**。
2. **LLM lane 是空壳**：`extract/llm-enrich.ts` 仅发 "OK" 探活后原样返回；`report.ts` 的 LLM 只做语气润色。语义理解从未发生。
3. **模板冒充分析**：9 条背包澄清问题 + "不足 8 条回落全量模板"（`clarifications.ts:186`）；RISKS 章节 5 行、summaryJson topRisks 4 行均为与输入无关的固定字符串——这是 B case 跨域幻觉（V1 leak=9）的直接来源。
4. **结构性缺口**：ADDENDUM/INCREMENTAL 路径生产不可达（`detectRunKind` 零调用方）；真实 PDF 上 M 条款正文被段落回退在换行处截断。

## 2. Hardcoded Logic Inventory（CURRENT_V1_HARDCODE_MAP）

| FILE | FUNCTION / 位置 | HARDCODE TYPE | 分类 | V2 处置 |
| --- | --- | --- | --- | --- |
| extract/facts.ts:129-263 | extractCoreFacts 规则表 | 编号/标题/日期/合同期/DDP/5MB/90days/评标法 字面正则 | CASE_SPECIFIC | REMOVE_FROM_V2（V1 legacy 保留） |
| extract/facts.ts:354-565 | extractQuantityFacts | "up to 1500" / "Each 1500" ×5 / 7500=1500×5 字面量 | CASE_SPECIFIC | REMOVE_FROM_V2 |
| extract/facts.ts:634-738 | appendJudgmentFacts | RCMP 主题推断/建议固定文案 | CASE_SPECIFIC | REMOVE_FROM_V2 |
| extract/requirements.ts:10 | M_CODE_RE（上限 M15） | M-code 特例 + 数量上限 | CASE_SPECIFIC | REMOVE_FROM_V2（LLM 语义识别替代） |
| extract/requirements.ts:13-33 | ZH_HINTS | 背包类中文启发翻译词表 | DOMAIN_SPECIFIC | REMOVE_FROM_V2 |
| extract/requirements.ts:35-43 | looksLikeRcmpBackpackRfp | 单案指纹判定 | CASE_SPECIFIC | REMOVE_FROM_V2 |
| extract/requirements.ts:296-313 | M1–M15 缺失回填占位 | 无证据 fabrication | CASE_SPECIFIC | REMOVE_FROM_V2 |
| extract/requirements.ts:135-139 | GENERIC_MANDATORY_LINE | 行首 shall/must 正则（过窄但通用） | GENERIC | KEEP（V1）；V2 由 LLM 承担语义判定 |
| extract/closing.ts:23-30 | CLOSING_PATTERNS | pattern#1 为 RFSO 双语封面特化 | 混合 | KEEP（V1）；V2 用通用归一化层 |
| extract/closing.ts:56 | enquiry = closing − 5 天 | 业务假设当普适规则 | DOMAIN_SPECIFIC | REMOVE_FROM_V2（只在文档明写规则时抽取） |
| clarifications.ts:108-168 | 9 条背包澄清模板 | 固定问题库 | CASE_SPECIFIC | REMOVE_FROM_V2 |
| clarifications.ts:171-186 | `selected.length >= 8 ? selected : specs` | 最低数量回落 | CASE_SPECIFIC FALLBACK | REMOVE_FROM_V2（V2 无数量目标） |
| report.ts:56-255 | 16 章模板（RISKS/BID_STRATEGY/…） | 与输入无关固定叙事 | CASE_SPECIFIC | REMOVE_FROM_V2 |
| report.ts:260-304 | buildSummaryJson | /Backpacks/、/M5000-/ 正则 + topRisks 固定 4 条 | CASE_SPECIFIC | REMOVE_FROM_V2 |
| extract/llm-enrich.ts | maybeEnrichFactsWithLlm | "OK" 探活 no-op | PLACEHOLDER | REMOVE_FROM_V2（真 LLM 通道替代） |
| source-verify.ts / page-parse.ts / hash.ts / status.ts / package.ts | — | 通用基础设施 | GENERIC | KEEP（V2 复用 page parser；verifier V2 独立同语义实现） |
| constants.ts:273-441 | 10 固定 deliverables + 11 固定 tasks | 流程模板 | DOMAIN_TEMPLATE | ISOLATE（V1 保留；V2 本阶段不生成 deliverables/tasks） |

统计：**V1_CASE_SPECIFIC_RULES_FOUND = 10 处**（上表 CASE_SPECIFIC 行）；**V1_CROSS_DOMAIN_FALLBACKS_FOUND = 3 处**（澄清模板回落、RISKS 固定叙事、summaryJson topRisks——即 V1 在 B case 上 9 条泄漏的全部来源）。

> 重要：以上 REMOVE_FROM_V2 指"V2 新实现中不存在"。V1 文件本 PR **零修改**（§7 不立即删除；V2 通过 Benchmark Gate 前 V1 仍是生产路径）。

## 3. V2 Architecture

```
AnalyzerInput (project-scoped documents)
  ↓ manifest.ts        DocumentManifest（documentId/name/type/sourceRole/pageCount/contentHash/parseVersion）
  ↓ manifest.ts        Page-aware Section Windows（≤4 页 / ≤9k chars / 1 页 overlap，标题页优先断窗）
  ↓ analyzer.ts        LLM Pass 1（并发≤3）：facts / requirements / potentialRisks / ambiguities
  │                    （prompts.ts tender-understanding-v2-extract@2；llm.ts Zod 校验 + 有界重试）
  ↓ verify.ts          Evidence Verifier（硬门）：doc∈scope / page 存在 / snippet 逐字在页 /
  │                    值在 snippet / 语义支持；mandatory signal 验证失败 → 降级 uncertain
  ↓ dedupe.ts          语义去重（指纹 + Jaccard≥0.62）：业务一条，EvidenceRefs 全保留
  ↓ precedence.ts      Addendum 修订 → SUPERSEDED/ACTIVE + AddendumChange；
  │                    通用跨文档矛盾（数值不一致）→ NEEDS_REVIEW + UNRESOLVED conflict
  ↓ synthesize.ts      Critical Fact 槽位（18 槽；无证据事实 = UNKNOWN）
  ↓ clarify.ts         歧义去重 → 全语料词汇检索 → LLM resolution 检查（resolve@1）→
  │                    答案证据可验证 → 不提问；否则生成 Clarification（无数量目标）
  ↓ risks.ts           零模板风险派生（verified 候选 + 矛盾 + UNKNOWN 阻断 + uncertain + 证据缺口）
  ↓ synthesize.ts      AnalysisResultV2（tender-analysis-result/v2）
```

职责分工（§1 原则落地）：**LLM 负责理解**（什么是 requirement、是否 mandatory、谁做什么、歧义在哪）；**deterministic code 负责**结构/归一化/去重/校验/状态机；**Evidence 负责证明**（无证据不进结果）。

## 4. Document Manifest

`manifest.ts buildDocumentManifest()`：projectId + documents[]（documentId/name/type/pageCount/sourceRole/contentHash）+ parseVersion（`tender-understanding-v2-manifest@1`）。sourceRole ∈ BASE_TENDER / SPECIFICATION / DRAWING / ADDENDUM / PRICING_FORM / SUBMISSION_FORM / OTHER，由调用方显式提供（生产 shadow 脚本从最近 TenderAnalysisRunDocument.role 只读映射）。输入永远 project-scoped——分析器无任何跨 org/project 查询能力（它根本没有 DB 访问）。

## 5. Chunk / Section Strategy

Page-aware 窗口：连续页聚合，上限 4 页 / 9k 字符，相邻窗口重叠 1 页（跨页条款容错）；`detectPageHeadings()` 只认通用结构（PART/SECTION/ANNEX/APPENDIX/ATTACHMENT/SCHEDULE/ADDENDUM/编号标题/全大写标题行），标题页在半窗后优先作为断点。每页在 prompt 中显式携带 `documentId + PAGE n` 标记——**任何时刻不存在丢失页 provenance 的 flatten**。

## 6. LLM Extraction Contract

单窗口 structured output（`extractionOutputSchema`，Zod 强校验）：facts[] / requirements[] / potentialRisks[] / ambiguities[]，每条必含 claim/type + sourceDocumentId + pageNumber + sourceSnippet（逐字）+ confidence。系统提示词硬规则：只抽本窗口页面内容、引文必须逐字、无证据不产出、字段撑不住就 null、禁止编值凑 schema。校验失败 → 带 schema 错误反馈的有界重试（≤2 次）；transient 模型错误 → 1 次重试；合法空数组 = 合法结果不重试（unknown 不触发"猜到为止"）。

## 7. Requirement Contract

`TenderRequirementV2`：id/category（21 个通用类目，无 RCMP/窗饰域类目）/statement/actor/action/object/**mandatory ∈ {true,false,"uncertain"}**/mandatorySignal（原文触发词）/deadline/quantity/unit/submissionStage/technicalArea/status（ACTIVE/SUPERSEDED/CONFLICT/NEEDS_REVIEW）/supersededById/evidence[]/confidence。缺失字段 = null，模型不为满足 schema 猜值（prompt 硬规则 + Zod nullable）。

## 8. Evidence Verification

`verify.ts` 四级硬校验：(1) 文档在 scope；(2) 页存在；(3) snippet 经 NFKC + whitespace 归一化后逐字在该页；(4) 值支持——claim/rawValue 中的日期/时长/金额（quantity 事实另查裸数字）必须出现在 **snippet 本身**（引对页但引错句同样 FAIL）+ claim↔snippet 内容词重叠下限。mandatory=true 但 mandatorySignal 无法在证据上下文找到 → 降级 "uncertain"（不拒收但不得计入 mandatory 清单）。拒收候选带 reasonCode 记入 metadata.rejectedCandidates（观测），绝不进业务列表。**"value 正确 + evidence 错" = FAIL** 与 #97 评分器同一纪律，两端一致。

## 9. Unknown Policy

Critical Facts 固定 18 槽（buyer/tender_number/project_title/closing_datetime/question_deadline/site_visit/location/scope/quantity/contract_duration/delivery/installation/warranty/bond/insurance/submission_method/pricing_method/addenda）。无已验证事实的槽 = `{status:"UNKNOWN"}`，进入 unknowns 列表 + projectSummary 显式呈现；**没有任何默认值路径**（V2-H3/H4/V2-06 断言保护）。UNKNOWN 是一等合法结果（§23）。

## 10. Deduplication

非 string-equality：statement 内容词指纹 + 同类目 token Jaccard ≥ 0.62 判同一条；跨文档（Base/Spec/Form）重复 → 业务一条，**EvidenceRefs 逐条合并保留**（V2-07/08 断言）。mandatory 合并规则：true+false 并存 → "uncertain"（不静默择一）。

## 11. Addendum Precedence

ADDENDUM 文档候选携带 revisionAction（CHANGES/REPLACES/REVISES/EXTENDS/DELETES）+ revisionTargetHint；同类目同主题（Jaccard ≥ 0.3 或 target hint 命中）且有修订语义 → base SUPERSEDED（记 supersededById）、addendum ACTIVE、产出 AddendumChange 记录——版本关系完整保留（V2-09 断言）。无修订语言 → 不偷偷选择（见 §12）。

## 12. Contradiction Handling

两层通用矛盾检测：(a) requirement 层——同类目、同主题、不同文档、数值签名不相交的 ACTIVE 对 → 双方 NEEDS_REVIEW + UNRESOLVED conflict（V2-10 断言：5 年 vs 3 年不得同时 active 也不得静默择一）；(b) fact 层——同 factType 归一化值不一致 → ADDENDUM+修订语言可 supersede，否则全部标 CONFLICT + UNRESOLVED conflict，槽位按 UNKNOWN 处理。UNRESOLVED conflict 必然产生 CONTRADICTION 风险（涉 mandatory/critical fact 时 CRITICAL）。

## 13. Risk Generation

零模板。来源仅限（§32）：verified LLM 风险候选（证据在案；CRITICAL 仅限 SUBMISSION/MANDATORY_MISSING/COMPLIANCE/ADDENDUM_CONFLICT 四类且 HIGH confidence）+ 确定性派生：未解决矛盾 / closing・submission_method UNKNOWN（CRITICAL 提交阻断）/ 商业槽位 UNKNOWN（聚合 IMPORTANT）/ mandatory uncertain（聚合 IMPORTANT）/ 证据拒收可见性（IMPORTANT）/ 截止临近（仅显式传 analysisDate 时启用——benchmark 不传，保持确定性）。每条 risk 链接 requirementIds/factIds/evidence 或明确 missing-evidence reasonCode。

## 14. Clarification Generation

只在全文档集分析完成后运行：歧义去重（Jaccard ≥ 0.55）→ 全 project 语料词汇检索 top-3 页（含 addenda/spec/form）→ LLM resolution 检查（resolve@1）→ **答案证据逐字可验证** → 不提问、记入 resolvedAmbiguities（含答案 evidence；V2-H5 断言）；仍未解决 → 生成 Clarification{question/reason/priority/relatedRequirementIds/supportingEvidence/whatIsUnknown/businessImpact}。**无最低数量目标；0 条合法**（V2-H6 断言）。resolution 调用失败 → 保守方向：仍生成澄清。

## 15. Synthesis Rule

`synthesize.ts` 只组装 verified 数据：criticalFacts 槽位择优（confidence → evidence 数）、mandatory 视图只含 ACTIVE、submissionChecklist = ACTIVE mandatory ∩ 提交相关类目、projectSummary 为确定性拼装（UNKNOWN 显式呈现，不经 LLM 自由发挥）。Synthesis 无任何新增 requirement/fact 的代码路径——需要新增只能回到 extraction pipeline 取证。

## 16. Persistence Strategy

本阶段**零持久化**（SCHEMA_CHANGE = NONE 的最强形式）：V2 结果为内存结构 + artifact JSON（benchmark 产物 / shadow 脚本输出 `artifacts/tender-v2-shadow/`）。Release Gate 通过后的接线方案（下一 PR）：复用既有 `TenderAnalysisRun / TenderExtractedRequirement / TenderAnalysisFact / TenderAnalysisSourceRef / TenderClarificationQuestion` canonical 服务写入（字段完全可承载：requirement.statement→originalRequirement、evidence→SourceRef、mandatory uncertain→complianceStatus NEEDS_CLARIFICATION），`analysisVersion = "tender-understanding-v2"` 区分。无需新表——SCHEMA_BLOCKER 不存在。

## 17. Feature Flag

`TENDER_ANALYSIS_V2_ENABLED`（flag.ts，envBool 语义与 repo feature-flags 一致）：production default OFF；当前唯一消费者是 `scripts/tender-v2-shadow-run.ts`（只读 DB → V2 分析 → artifact JSON，不写库、不动 approve/lock/revision 任何业务 Gate）。V1 worker/cron/API 零改动——flag OFF 时系统行为与 main 完全一致，flag ON 也只解锁 shadow 脚本。

## 18. Benchmark Integration

Runner 升级为多 lane：`npm run test:tender-eval`（默认 V1）/ `--lane=v2` / `--lane=both`。V2 lane 经 `src/lib/tender-eval/v2-adapter.ts`（考官侧桥接：case 文档集 → AnalyzerInput → AnalysisResultV2 → 评分器 SystemOutput）；**方向约束**：eval 可调用 V2，V2 生产模块零 tender-eval import（自审计：仅注释提及，无实际 import；case-specific 字符串扫描 = 0 命中）。V2 lane 无 API key → SKIPPED（BLOCKED_BY_ENV），禁止 mock 冒充。评分器新增统一 `CROSS_DOMAIN_LEAK`（facts+requirements+风险行+澄清全维度探针扫描）。每条记录携带 analyzerVersion / promptVersions / models / llmCalls / tokens / wallTime。

## 19. V1 vs V2 Metrics（PROVISIONAL — Golden 未人工确认）

规范记录 = run `20260811-011513Z-6b399ca`（全部修复就位后的完整 both-lane 真实运行；快照已提交 `docs/tender-eval/v2-provisional-run4/`）。**全部数字为 PROVISIONAL——Golden 状态 PENDING_HUMAN_CONFIRMATION，人工确认前不构成 Release Gate 成绩。**

| 指标 | A0 V1 | A0 V2 | A-REAL V1 | A-REAL V2 | B V1 | B V2 |
| --- | --- | --- | --- | --- | --- | --- |
| Mandatory Recall (strict) | 100% | 87.5% | 44.7% | **81.6%** | 0% | **54.5%** |
| Requirement Recall (strict) | 100% | 87.5% | 44.7% | **81.6%** | 0% | **50.0%** |
| Critical Fact Accuracy | 94.4% | 77.8% | 77.3% | **77.3%** | 0% | **90.9%** |
| Evidence Accuracy | 100% | 100% | 100% | **100%** | N/A | **100%** |
| Unsupported Claim Rate | 0% | **0%** | 0% | **0%** | N/A | **0%** |
| Risk Recall | 80% | 60% | 37.5% | **100%** | 0% | 40% |
| CRITICAL_RISK_MISSED | 1 | **0** | 3 | **0** | 2 | **1** |
| Clarification Hallucinations | 0 | **0** | 1 | **0** | 6 | **0** |
| CROSS_DOMAIN_LEAK | 0 | **0** | 2 | **0** | 9 | **0** |
| expectedUnknown 违规 | 0 | 0 | 0 | 0 | 0 | 0 |

四次真实运行的方差（V2 mandatory recall strict；run3 的 A-REAL 受 token 截断影响，修复后不再复现）：A0 = 87.5/87.5/87.5/87.5（完全稳定）；A-REAL = 81.6/89.5/57.9*/81.6（中位 81.6）；B = 54.5/63.6/54.5/54.5。**结论：单次运行分数有 ±8–15pt 噪声，Release Gate 必须用多次运行中位数判定**（已列入 §23 协议建议）。

三案合读：V1 的失败模式是"错得自信"（B 泄漏 9 条背包内容、A-REAL 漏 3 个关键风险）；V2 的失败模式是"漏但不编"（leak/幻觉/unsupported 全零，miss 集中在少数类别，见 §22）。A0 上 V2（87.5%）低于 V1（100%）是预期现象——V1 的规则就是照着该 fixture 写的（过拟合对照组的存在意义）。

## 20. Real LLM Result

- REAL_LLM_E2E = **PASS**：4 次完整真实运行（禁 mock），Unified Model Runtime 解析模型 = **gpt-5.6-terra**（ProviderRouter/TASK_PRESETS.structured；V2 代码零模型名/SDK 硬编码）。
- Prompt：`tender-understanding-v2-extract@2` + `tender-understanding-v2-resolve@1`（集中于 prompts.ts，版本随 metadata 记录）。
- 规范运行（run4）：LLM calls 75（A0 16 / A-REAL 54 / B 5，含重试与 resolution pass）；失败调用 12（全部 A-REAL 密集页，重试后 failedWindows 影响面见 §22-F3）。
- 结构化输出纪律：Zod 强校验 + 有界重试（≤2）+ finishReason=length → TRUNCATED_OUTPUT 观测；合法空数组不重试（unknown 不"猜到为止"）。

## 21. Cost / Latency

run4（三案 V2 lane 合计）：
- Tokens：prompt ≈ 147.9k / completion ≈ 104.0k（getAiStats 进程内实测；gpt-5.6 的 completion 含 reasoning tokens）
- Wall time：A0 54s / A-REAL 220s / B 21s（并发 3）
- 规模：43 页真实 PDF → 21 窗口 → 41+ 抽取调用（含重试）——远低于"每页 10 次调用"反模式；页/窗/调用配比与 token 计入 metadata，后续可按 §50 做 section-aware batching 优化。成本量级：单次三案全跑约 25 万 token。

## 22. Remaining Failure Classes

按影响排序（全部已在 benchmark 明细中可复查；均为记录不即时修）：
1. **F1 数量/表格类事实弱**（A0+A-REAL 共同）：Annex A "up to N per period" / Annex B 年度行 / 评估合计推导（7500）未稳定成为 quantity facts——模型倾向把表格行留在 requirement/pricing 语境。V1 靠硬编码在此项"满分"，V2 需要表格感知抽取（T-next：表格结构化 pass）。
2. **F2 运行方差**：A-REAL mandatory recall 4 次 57.9–89.5（中位 81.6）。根因之一（token 截断）已修；残余为采样方差。协议对策：Release Gate 采用 ≥3 次运行中位数 + 失败窗口数上限。
3. **F3 密集页窗口失败**：run4 A-REAL 12/54 调用失败（重试后仍有窗口丢失）。已加 TRUNCATED_OUTPUT 观测与 20k 预算；进一步方向：窗口自适应缩窗重试。
4. **F4 风险框架化不足**（B 40%）：service-weighted 评分结构、addendum 版本管理这类"结构性商业风险"模型不主动当 risk 输出；确定性派生规则目前只覆盖矛盾/UNKNOWN/uncertain。方向：从 verified facts 派生更多结构性风险规则（评分权重、多文档版本存在性）。
5. **F5 rule-form deadline 仍不稳**（F-ENQUIRY-DEADLINE/F0-ENQUIRY）：**"截标前 5 天"类规则文本未稳定落为 question_deadline fact（prompt @2 已加指引，run4 仍 miss）。
6. **F6 resolution pass 漏判 1 例**（B：已被补遗回答的问题仍被提出 → ALREADY_ANSWERED 1 条）。方向：resolution 检索扩大 top-k 或提高 addendum 权重。
7. **F7 V2 澄清主题与 golden 澄清清单错位**：A-REAL 14 条 V2 澄清全部落 LOW_VALUE——多数是合理的文档歧义问题但不在 golden 主题集内；判定悬置至 golden 人工确认（可能需要扩充 golden clarification 集合而非改系统）。
8. F8 fixture 合成文本 vs 真实 PDF：A0（合成断片文本）事实覆盖低于同源真实 PDF——合成 fixture 的碎片化排版本身是干扰源（LEGACY_FIXTURE_CONFLICT 已在 #97 登记，本 PR 未动历史 fixture）。

## 23. Release Gate Status

§43 目标 vs run4 PROVISIONAL（Golden 未确认，一切非正式）：

| 指标 | 目标 | A0 | A-REAL | B | 判定 |
| --- | --- | --- | --- | --- | --- |
| MANDATORY_RECALL | ≥90% | 87.5% | 81.6% | 54.5% | ✗ 未达 |
| REQUIREMENT_RECALL | ≥85% | 87.5% | 81.6% | 50.0% | ✗ 未达 |
| CRITICAL_FACT_ACCURACY | ≥90% | 77.8% | 77.3% | 90.9% | ✗ 未达（B 达标） |
| EVIDENCE_ACCURACY | ≥95% | 100% | 100% | 100% | ✓ |
| UNSUPPORTED_CRITICAL_CLAIMS | =0 | 0 | 0 | 0 | ✓ |
| CROSS_DOMAIN_TEMPLATE_LEAK | =0 | 0 | 0 | 0 | ✓ |
| CRITICAL_RISK_MISSED 显著下降 | vs V1 1/3/2 | 0 | 0 | 1 | ✓ |

**RELEASE_GATE = NOT_PASSED（且结构上不可能 PASS：Golden 仍 PENDING_HUMAN_CONFIRMATION）。** 证据/反幻觉四项硬门全绿；召回三项未达线。V2 保持 SHADOW/EVALUATION 模式，V1 继续生产路径。补充协议建议：Golden 确认后 Gate 采用 ≥3 次运行中位数。

## 24-A. Final Review Remediation（2026-08-11，PR100 = CONDITIONAL_PASS 整改）

### Benchmark Independence & Scorer Freeze

- 考官/被试永久分离生效：benchmark scorer（evaluate.ts）、normalize、golden cases、contract
  已随 PR #97 冻结（BENCHMARK_FREEZE_CONTRACT，见 V1 报告）；本 PR 相对冻结版的
  tender-eval 差异仅剩 **v2-adapter.ts（新增）+ runner 多 lane + report-io 多 lane 渲染**
  ——全部为 Candidate 适配/呈现层，scorer/golden **零字节漂移**（已验证）。
- 原临时存在于本 PR 的 requirementAsFactCandidate 通道桥按冻结决议**从 scorer 移除**，
  在 v2-adapter 内重实现（Candidate 输出形状适配归 adapter；scorer 不知道被试风格）。
- 静态扫描：src/lib/tender-understanding/** 对 tender-eval / golden / baseline /
  provisional 的 import 与引用 = **0**（V2_BENCHMARK_INPUT_LEAK = 0）。

### Risk / Ambiguity Semantic Evidence Gates（§15/16 必修）

verify.ts 补齐语义支持硬门：真实引文存在但与断言无关 → REJECT（NO_SEMANTIC_SUPPORT）：

- Risk：`risk.description` 须被 `sourceSnippet` 语义支持；
- Ambiguity：`topic + description + whatIsUnknown` 组合文本须被 `sourceSnippet` 支持；
- 判定完全通用（token 支持 + 数值/日期检查，零领域词零案例词）；方向保守——宁拒 borderline，
  不让 unsupported claim 进业务结果。
- 新增测试 V2-E7（无关 risk 拒收）/ V2-E8（无关 ambiguity 拒收）/ V2-E9、E10（语义支持正控防过严）
  全部通过；修复后真实运行中 A0 现场拒收 2 条 NO_SEMANTIC_SUPPORT 风险候选（门在真实条件下生效）。

### Post-Fix V2 Benchmark（冻结 scorer tender-eval/v1；run `20260811-032546Z-ae102dc`，
快照 docs/tender-eval/v2-postfreeze/；PROVISIONAL——Golden 仍 PENDING_HUMAN_CONFIRMATION）

| 指标 | A0 V1→V2 | A-REAL V1→V2 | B V1→V2 |
| --- | --- | --- | --- |
| Mandatory Recall (strict) | 100%→87.5% | 44.7%→**76.3%** | 0%→**54.5%** |
| Requirement Recall (strict) | 100%→87.5% | 44.7%→76.3% | 0%→50.0% |
| Critical Fact Accuracy | 94.4%→83.3% | 77.3%→72.7% | 0%→**90.9%** |
| Evidence Accuracy | 100%→**100%** | 100%→**100%** | N/A→**100%** |
| Unsupported Claim Rate | 0 | **0** | **0** |
| Risk Recall / CRITICAL_RISK_MISSED | 80%/1→40%/1 | 37.5%/3→**100%/0** | 0%/2→40%/1 |
| Clarification Hallucinations | 0→0 | 1→**0** | 6→**0** |
| CROSS_DOMAIN_LEAK | 0→0 | 2→**0** | 9→**0** |

对比修复前 run4：A-REAL mandatory 81.6→76.3、A0 风险召回 60→40——落在已知运行方差带
（A-REAL 四次 57.9–89.5）内且方向符合预期（语义门收紧只减不增），**按 §22 原则接受：
Evidence / Unsupported / Leak 优先于 Recall 数字，不为保分放宽 verifier**。
本轮未做任何 Recall 优化（§24 遵守）；Recall 改进属下一阶段。

### Production Release Decision

- RELEASE_GATE = **FAIL / NOT_READY**（Golden 未确认 + A-REAL/B mandatory < 90% +
  requirement/critical fact 未全面达线）。
- TENDER_ANALYSIS_V2_ENABLED 维持 default OFF、fail-closed；无任何 production route 调用
  analyzeTender（静态扫描 src/app+src/lib 零引用；唯一入口 = flag 门控的 shadow 脚本）；
  未接入 #101 T1B 生产路径；PRODUCTION_ENV_CHANGED = NO。
- **#100 merge ≠ production enablement**：合并只交付 shadow 能力与 benchmark lane，
  生产启用需另行通过 Confirmed-Golden Release Gate。

## 24. T1B Readiness

**T1B_READY = NO。** 依 §64：Confirmed Golden（未满足）+ 全部指标达线（未满足）缺一不可；不为启动 Workforce Agent 降低门槛。给 T1B 的输入：V2 的 `AnalysisResultV2` 契约（含 UNKNOWN/conflicts/evidence 全结构）已为 Workforce 任务注入做好形状准备，但接入前置条件 = Golden 确认 + F1/F2/F4 三类失败收敛 + 持久化接线 PR（§16）。
