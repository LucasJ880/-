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
  │                    （prompts.ts tender-understanding-v2-extract@1；llm.ts Zod 校验 + 有界重试）
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

«BENCH_TABLE»

## 20. Real LLM Result

«REAL_LLM»

## 21. Cost / Latency

«COST»

## 22. Remaining Failure Classes

«FAILURES»

## 23. Release Gate Status

«GATE»

## 24. T1B Readiness

«T1B»
