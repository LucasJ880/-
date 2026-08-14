# Tender Analyst Synthesis — Semantic Remediation（PR #106）

日期：2026-08-13 ｜ 基线 head：`1a45bab1992f7c1b2a1e7db112979c6c79a61d4b`

## 1. Semantic UAT FAIL 证据（真实 5 文件 UAT，run cmsr1nh90…）

工程链路（upload→parse→package→auto enqueue→V2→REVIEW_REQUIRED）已通，但人工语义验收 FAIL：

1. 「中文分析」大量内容为英文（V2 输出源语言，`v2-map` 明示为已知 limitation）。
2. 无真正合并分析——只有分类后逐条提取（16 章节 = requirement 按 category 分行拼接）。
3. Requirement 分类错误：`Vendor must email invoices…`、Procurement Card、confidentiality、
   force majeure、gift/hospitality 混入「强制技术要求」。
4. 综合结论机械（`FINAL_RECOMMENDATION` 固定句式「请结合风险…综合判断」）。
5. 「陈述要点」原子事实全部要求人工 确认/驳回。
6. 无 workflow 感：114 条 mandatory 平铺，binding clause ≠ bid-critical 未区分。

## 2. Root Causes

- **RC-1 信息架构**：binding contractual obligation / bid-critical requirement / technical
  requirement 三者未分离；`mandatory=true` 直接渲染为「强制(技术)要求」。
- **RC-2 缺 Analyst 层**：V2 是 grounding engine（抽取+验证+去重+优先级链），从未有
  「投标人视角综合解读」层；16 章节是 category 投影，不是理解。
- **RC-3 语言**：V2 刻意输出源语言保证 grounding，UI 却把它当「中文分析」展示。
- **RC-4 抽取分类宽松**：extraction prompt 对 TECHNICAL 无负面清单，`Vendor must` 触发
  mandatory 后被 UI 放大为技术/关键。

## 3. 架构（V2 保留为 Grounding Engine）

```
Tender Package
  ↓ A/B/C  tender-understanding（不变：页窗抽取→证据验证→dedupe→补遗优先级→冲突→风险→澄清）
  ↓ D/E    tender-analyst PASS A  — Senior Tender Analyst（zh-CN 综合解读，仅引用既有 entity ID）
  ↓ F      tender-analyst PASS B  — Analyst QA Reviewer（检查误分类/幻觉引用/语言/重复；不得引入新事实）
  ↓        validateTenderAnalystSynthesis（硬校验：ID 存在性、BID_FATAL/TECHNICAL 依据、无支撑即移除）
  ↓        hydrateEvidenceIndex（supporting ID → document/page/snippet，Evidence Drawer 数据源）
  ↓ G      persistV2Fenced（不变：短事务 fence-first；synthesis 存 summaryJson.analystSynthesis）
```

- 所有 LLM 调用在 `runV2Inference`（事务外）；lease/fence 语义未动（§9）。
- Analyst 失败不阻断 canonical 落库（UI fallback legacy 视图）。

## 4. 契约

`TenderAnalystSynthesisV1`（`src/lib/tender-analyst/contract.ts`，版本
`tender-analyst-synthesis/v1`，存 `TenderAnalysisRun.summaryJson.analystSynthesis`，
**SCHEMA_CHANGE=NONE**）：executiveBrief / scope / keyRequirements /
technicalRequirements / commercialAndDelivery / risksAndGaps / clarifications /
currentAssessment(status=READY_TO_PRICE|NEEDS_CLARIFICATION|…) / nextActions /
coverage(uploaded/eligible/analyzed/excluded[]) / qa / evidenceIndex / telemetry。
关键 item 携带 phase（BID_SUBMISSION…GENERAL_CONTRACT）、impact（BID_FATAL…INFORMATIONAL）、
severity 与 supporting*Ids。

## 5. Prompt 版本

- `tender-analyst-synthesis@1`（PASS A）：投标人视角、zh-CN 输出（专名/编号/原文除外）、
  must/shall≠废标、technical 负面清单、UNKNOWN 直说、每个结论必须带 supporting IDs、
  DOCUMENT-BASED READINESS（不做商业 Go/No-Go）。
- `tender-analyst-qa@1`（PASS B）：九项检查（幻觉 ID / 合同条款当技术 / post-award 当废标 /
  unknown 当 known / 无支撑结论 / 重复 / 中英混乱 / boilerplate 置顶）；只能用既有 ID 修订；
  修不动 → needsHumanReview。
- `tender-understanding-v2-extract@3`：新增 CATEGORY DISCIPLINE（TECHNICAL 仅产品/规格/性能/
  测试/材料/尺寸/质量/技术安装；invoice/PCard/保密/force majeure/gift 绝不 TECHNICAL）与
  STAGE DISCIPLINE（with bid / pre-award / post-award / ongoing）。

## 6. QA / 校验规则（§26）

- supporting ID 必须存在；关键 item supportingIds>0，否则移除（不持久化 unsupported claim）。
- BID_FATAL 必须关联明确淘汰措辞（reject / non-responsive / not be considered /
  condition of bid / will not be accepted…）或 SUBMISSION/MANDATORY 且 mandatory=true 的
  canonical 条款；否则降级 BID_REQUIRED。
- technicalRequirements 必须有 TECHNICAL/PRODUCT/PERFORMANCE/INSTALLATION 支撑；
  纯 COMMERCIAL/PRICING/REPORTING 支撑的 item 移出技术区。
- QA 修订版再次过同一校验；removedCount>0 → needsHumanReview。

## 7. Package Coverage Blocker（§3 审计结论）

真实项目「09-02 床垫 UAT-P0」上传 5 个用户文件：

| 文件 | 类型 | parse | hash | pageRows | 处置 |
|---|---|---|---|---|---|
| eRFB-Parts 1-4 …pdf | pdf | done | ✓ | 64 | 纳入 |
| Summary.rfx…pdf | pdf | done | ✓ | 20 | 纳入 |
| eRFB-Part 5 …pdf | pdf | done | ✓ | 1 | 纳入 |
| eRFB-Part 6 …pdf | pdf | done | ✓ | 1 | 纳入 |
| COS-0265_…Checklist.docx | docx | done | ✓ | **0** | **排除** |

排除原因：非 PDF 解析路径「不捏造页级行」（`page-parse.ts`），docx 无
`ProjectDocumentPage` → 无页码级 citation 基底；按 §3 安全规则不强行纳入。
（第 6 个文档「投标准备清单」为系统生成物 `source=ai_checklist`，不属于用户上传。）

修复：coverage 明细化（`excludedFiles[]` 带 filename/fileType/parseStatus/hash/pageCount/
exclusionReason），UI 显示「上传 5 · 纳入分析 4 · 排除 1（可展开原因）」，synthesis.coverage 同步。

## 8. UX（EXPERIENCE ON）

- IA：`项目解读`（默认）/ `关键要求` / `风险与缺口` / `澄清 / RFI` / `全部条款` / `来源`。
- 项目解读 6 模块：30 秒看懂 / 采购范围 / 投标关键要求 / 风险与缺口 / 当前文档判断 / 下一步。
- 关键要求 A–G 分组（A 废标、B 投标必须提交、C 技术/产品、D 资格/保险，默认展开；E 价格/商务、
  F 交付、G 中标后合同义务折叠）。
- 每个关键结论「查看证据」→ Evidence Drawer（文件/页码/原文 snippet，跨文件全列）。
- §22 AI 分析工作流条 + 推荐下一步；§17 陈述要点确认/驳回移出主 UI（facts 留作 evidence/audit）。
- 旧 run 无 synthesis / EXPERIENCE OFF → 完整 legacy 视图（flags-off 行为不变）。

## 9. 测试

`src/lib/tender-analyst/__tests__/analyst-synthesis.test.ts`（30 断言，合成 fixture）：
SEM-01..10 + §26 幻觉 ID 剔除 + deterministic 两段式编排（注入 invoker）+ §11 prompt 纪律。
全部注册进 `test-all.sh` / `test-ci-unit.sh`。既有 tender 套件全绿（v2-map/coverage/
chat-context/fence/understanding×3 等）。

## 10. Real UAT 与 Human Review Gate

- 流程：部署 preview → 对「09-02 床垫 UAT-P0」重新分析 → 单 worker（无并行提升）跑至
  REVIEW_REQUIRED → 真实浏览器验证 ①30 秒解读 ②采购范围 ③Key Requirements ④Risks&Gaps
  ⑤Clarifications ⑥Current Assessment ⑦Next Actions + 证据抽查路径。
- Claude 只能报告 `READY_FOR_HUMAN_SEMANTIC_REVIEW`；SEMANTIC_UAT 判定权在人工
  （抽查 ≥10 个关键结论 → 来源文件/页码/原文）。
- 性能：analystLatencyMs / reviewLatencyMs / analystLlmCalls 记入 summaryJson.metadata。
