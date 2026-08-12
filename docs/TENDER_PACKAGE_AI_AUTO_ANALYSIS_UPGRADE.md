# Tender Package AI + Auto Analysis Upgrade

状态：交付供人工 Final Review（Draft PR，未 merge，未改生产）。

本轮把「上传招标文件夹 → 青砚自动读完 → 形成项目级 Tender Analysis → 用户可针对整个项目对话」
的链路补齐，并修复真实 UAT 暴露的两类问题：①点击「分析投标文件」无反馈；②「30 秒看懂项目」假「调查中」。

实现遵循任务书硬约束：**不重写现有系统、复用当前架构、补齐编排/包级智能/UI 状态/测试**；
**不改生产环境、不跑生产迁移、不 merge、不提高生产并行度**。新能力全部 flag 门控、生产默认关闭。

---

## 1. 原始根因

真实链路审计（PHASE A，四路并行）结论：

1. **自动入队已存在但触发点错误**：上传路由内 `maybeEnqueueTenderAnalysisAfterUpload`
   （`enqueue.ts:42`）在**每个文件**上传时同步入队，`forceIncludeDocumentIds:[thisDoc]`。10 文件 =
   10 次入队；幂等虽能收敛为 ≤1 活跃 run，但交错上传会不断改变 package fingerprint，cron 可能在最后一个
   文件落地前就分析**半包**再被 supersede。
2. **不存在真正的 Package Ready Gate**：`getTenderPackageDocuments` 纳入 `parseStatus∈{done,pending,parsing}`
   的 PDF，只要求 contentHash。`ready-gate.test.ts` 是安全加固测试，误名。
3. **静默失败**：`package/route.ts` 对 `project_not_found/missing_org/gate_closed/missing_content_hash/no_package_documents`
   一律返回 **HTTP 200 + ok:false**；前端 `analysis-panel.tsx:242` 只判 `res.ok` → 落空 → 清错误 → 重渲染同一空态。
4. **两套互不连接的推理栈**：
   - V1（生产在跑、无 flag）：`extract/facts.ts` 是对 RCMP「Backpacks for Cadets」单份文书的**硬编码正则过拟合**。
   - V2（`tender-understanding`）：真正的 chunk-grounded 跨文档推理，但 flag OFF（`SHADOW_EVALUATION_ONLY`），
     仅被 benchmark 引用，**零生产接线**（因未过冻结的 Release Gate）。
5. **会话无 package 上下文**：项目会话只注入最近 5 个 KB 文档；tender 技能只给整项目文档**预览**（summary-of-summaries）。
6. **Schema 已足够富**：`TenderAnalysisRun/Section/Fact/SourceRef/ExtractedRequirement/Deliverable/ClarificationQuestion/ChangeCandidate`
   均已存在 → `SCHEMA_CHANGE = NONE`。

## 2. 为什么点击「分析投标文件」没反应

见根因 3。前端只判 HTTP 传输状态；业务失败以 200 返回，`json.ok===false` 从不被检查，`load()` 找不到 run →
`setData(null); setError(null)` → 重渲染同一「暂无分析记录」空态，按钮照旧可点。用户看到「什么都没发生」。

## 3. 为什么上传以后没有自动 Tender Analysis（完整包级）

`AutoAiPanelsRunner` 只自动跑 `progress-summary` + `checklist`，从不触发 `tender-analysis/package`。
上传路由虽有 per-file 入队，但触发点在半包阶段（根因 1），且无 Ready Gate 保证「整包就绪才分析一次」。

## 4. 旧的 Document AI 架构

`process-next` 流水线逐文件产出 `aiSummaryJson`（`files/ai-summary.ts`），在
`project-file-manager.tsx` 每个文档行展示 documentType/summary/keyDates/technicalRequirements 等。
**本轮完整保留**（LEVEL 1，第一层「会读文件」）。

## 5. 新的 Package AI 架构

两层：
- **LEVEL 1 Document AI（保留）**：单文件结构化摘要。
- **LEVEL 2 Package AI（本轮接线）**：把 V2 `analyzeTender`（grounded 跨文档引擎）接入生产 worker，
  一步产出并持久化 facts / requirements / clarifications / sourceRefs / addendumChanges / sections / summary。
  跨文档 dedupe、Spec↔Drawing 冲突暴露（绝不自动择一）、Addendum precedence（supersede lineage）、
  证据强校验（value 对但 evidence 错也拒收）—— 全部来自 V2，落入既有表。

数据流：`Documents → Parsing/Pages → V2 windows(逐页原文) → LLM 结构化抽取 → 证据验证 → normalize/dedupe →
mandatory/precedence/conflict → risk → clarification(语料解决检查) → synthesis → 持久化`。
**非 summary-of-summaries**：V2 始终在逐页原文上抽取并回到 source snippet 验证（见 §8）。

## 6. Package Ready Gate 如何工作

`package-ready.ts` `assessPackageReadiness(rows)`（纯函数）：
- 候选 = 可解析 PDF（非 failed、非 addendum-only）。
- 无候选 → `NO_PACKAGE_DOCUMENTS`。
- 任一候选仍 `pending/parsing` → `DOCUMENT_PROCESSING`（**拒绝分析半包**——旧枚举缺此项）。
- 全部解析完成后缺 contentHash 且无 blob 回填 → `MISSING_CONTENT_HASH`。
- 否则 `READY`。
`getTenderPackageReadiness(projectId)` 取数后调用纯函数。就绪时机 = `process-next` 报 `done`（全部解析完毕），
天然覆盖文件夹导入与单独补遗上传。

## 7. Auto enqueue 如何保证幂等

`enqueueTenderPackageIfReady`（flag + readiness + gate）→ 委托 `enqueueTenderPackageAnalysis`：
- idempotencyKey = `sha256(tender-analysis:{projectId}:{fingerprint}:{prompt}:{analysis})`，DB `@unique`；
- fingerprint = 排序后 `{docId}:{contentHash}` 列表的 sha256（顺序无关）；
- 活跃集查找（idempotencyKey 或 fingerprint 命中）→ 复用；唯一键竞态 → 复查复用；
- 仅 supersede **更旧**的在飞 run（不碰 REVIEW_REQUIRED/APPROVED）。
触发点改为 `process-next` done（flag ON 时 per-file 入队改为只写 hash）→ 一个包一个活跃 run；
刷新/effect 重跑/多完成事件均幂等复用。

## 8. Package-level AI 如何避免 summary-of-summaries

V2 从不「先摘要再推理」：`manifest.ts` 保留每页 provenance，`prompts.ts` 以 `=== documentId X PAGE N === 原文`
喂 LLM；所有候选携带 `sourceDocumentId + pageNumber + verbatim snippet`；`verify.ts` 硬校验（页不存在/
snippet 不在页上/claimed 值不在 snippet 内 → 拒收）。dedupe 用 token-Jaccard 跨文件合并且并所有 evidence。

## 9. Addendum precedence 如何处理

V2 `precedence.ts` 对含 ADDENDUM 来源且带修订语义的 requirement 组标 base 为 `SUPERSEDED`、
`supersededById` 指向 addendum，并产出 `AddendumChangeV2` lineage。本轮映射为 `TenderAnalysisChangeCandidate`
（`entityType=requirement`），FULL run 也可写。补遗上传 → fingerprint 变化 → 新 FULL run（supersede 旧的），
旧版保留。

## 10. Conflict 如何处理

V2 对同类目、不同来源文档、数值签名不相交者标 `CONFLICT` + `UNRESOLVED`（绝不择一）。本轮把 UNRESOLVED 冲突
映射为 change candidate（`entityType=conflict`）并进入 RISKS 章节；Executive Brief 的「重大阻塞」以 `CONFLICT` 状态呈现。

## 11. Tender Chat 如何获得整个项目上下文

`chat-context.ts` `buildTenderPackageContext(projectId)`：取最新有效 run 的 summaryText + 关键 requirements +
RISKS 章节 + OPEN 澄清，格式化为 grounded 上下文块（含「未覆盖请答『暂无依据』，不要编造」硬指令），
在 `agent-core/conversation/adapter.ts` 注入 systemPrompt。**复用既有 runtime，不新建聊天系统**；
非 tender 项目或无分析时返回 null 退回普通会话。

## 12. 修改文件

- `src/app/api/projects/[id]/tender-analysis/package/route.ts` — 响应规范化 + `action:"auto"`。
- `src/app/api/projects/[id]/files/process-next/route.ts` — done 时 ready-gated 自动入队（flag 门控）。
- `src/components/tender-analysis/analysis-panel.tsx` — 修静默失败（判 `json.ok`）+ notice/busy 状态。
- `src/components/bid-workflow/project-intel-sections.tsx` — 30 秒看懂改为 Executive Brief 投影 + 字段级状态 + 轮询。
- `src/lib/agent-core/conversation/adapter.ts` — 注入 tender package 上下文。
- `src/lib/tender-auto-analysis/enqueue.ts` — flag ON 时 per-file 入队改为只写 hash。
- `src/lib/tender-auto-analysis/enqueue-package.ts` — 新增 `enqueueTenderPackageIfReady`。
- `src/lib/tender-auto-analysis/worker.ts` — V2 分支（EXTRACT_FACTS 跑 V2 + 心跳续租；后续步 no-op/防 RCMP 模板注入）。
- `scripts/test-all.sh` / `scripts/test-ci-unit.sh` — 注册 6 个新测试套件。

## 13. 新增文件

- `src/lib/tender-auto-analysis/enqueue-outcome.ts` — 入队结果规范化（稳定 code + HTTP 状态 + 人类文案）。
- `src/lib/tender-auto-analysis/package-ready.ts` — Package Ready Gate。
- `src/lib/tender-auto-analysis/auto-flags.ts` — `TENDER_AUTO_PACKAGE_ANALYSIS_ENABLED`。
- `src/lib/tender-auto-analysis/v2-map.ts` — V2 结果 → 实体映射（纯，无 tender-eval import）。
- `src/lib/tender-auto-analysis/v2-persist.ts` — 跑 V2 + 持久化（幂等，含 AnalyzerInput 构建）。
- `src/lib/tender-auto-analysis/executive-brief.ts` — 30 秒看懂投影（纯 + loader）。
- `src/lib/tender-auto-analysis/chat-context.ts` — 会话 package 上下文（纯 formatter + loader）。
- `src/app/api/projects/[id]/tender-brief/route.ts` — Brief 端点。
- 6 个 `__tests__/*.test.ts`（enqueue-outcome / package-ready / auto-flags / v2-map / executive-brief / chat-context）。

## 14. 数据库是否修改

否。`SCHEMA_CHANGE = NONE`。全部复用既有模型。

## 15. migration 是否需要

不需要。未新增/修改任何 migration，未跑任何生产迁移。

## 16. tests

新增 6 套纯逻辑测试，共约 130+ 断言，全绿：
- enqueue-outcome（41）：无「HTTP 200 + 失败」不变量。
- package-ready（14）：CASE 3/4 语义。
- auto-flags（16）：默认 OFF、真假值、allowlist。
- v2-map（24）：SUPERSEDED 排除、NEEDS_REVIEW→NEEDS_CLARIFICATION、冲突→change candidate、16 章节、缺失→待核。
- executive-brief（24）：INTEL-01..08 纯逻辑（Missing≠Processing、外部字段永不 PROCESSING、STALE 保留旧值、冲突→CONFLICT）。
- chat-context（11）：grounded 指令、要求/风险/澄清注入、字符预算。
**PURE_REGRESSION = PASS**：全部 tender 纯套件回归 31/31；`tsc --noEmit` 0 error；`eslint` baseline PASS；agent-core 会话 12/12。
（含 Final Review Remediation 新增：v2-persist-fence（V2-LEASE-01/02/03）、package-coverage、auto-flags EXPERIENCE 用例。）
**DB_REGRESSION / FULL_REGRESSION / REAL_E2E** 需临时隔离 Neon + staging 三 flag，属人工执行（见 §17、GATE 校正口径）。

任务书 CASE 与覆盖：
- CASE 1/2（1 或 10 文件 → ONE run）：idempotency + package-ready 纯测试覆盖；DB 端到端留 §17。
- CASE 3（仍 processing 不提前分析）：package-ready DOCUMENT_PROCESSING。
- CASE 4（缺 hash 不静默忽略）：MISSING_CONTENT_HASH。
- CASE 5/6（刷新不重复 / 重新分析）：idempotency + reanalyze 既有测试。
- CASE 7（业务失败前端可见）：enqueue-outcome + 面板改动。
- CASE 8（补遗 → 新版分析、旧版保留）：fingerprint/ supersede + v2 addendumChanges。
- CASE 9/10（补遗覆盖 / 无补遗冲突）：v2-map precedence + conflict。
- INTEL-01..08：executive-brief。

## 17. REAL_E2E 结果

**BLOCKED（需人工在隔离环境执行）**。原因：
- DB 平面 + 真实 LLM 平面用例（`analyzeAndPersistV2` 全链、真实 10 文件 package、真实会话）需临时隔离 Neon 分支
  + 打开 `TENDER_ANALYSIS_V2_ENABLED` + `TENDER_AUTO_PACKAGE_ANALYSIS_ENABLED` + 有效模型密钥；
  本地 `.env` 仅生产库（fail-closed），不在本轮范围内执行生产/联网副作用。
- 建议在 staging（按人工决策打开两 flag）跑：一个 ~10 文件真实 tender 文件夹 → 观察 auto-enqueue（ONE run）→
  V2 grounded 分析 → 面板/Brief/Chat 三读模型 → 人工核对 Scope/Closing/Product/Motor/Electrical/Addendum/
  Warranty/Submission/Pricing/Risks/Clarifications/Sources。

## 18. 已知 limitations

- **语言**：V2 输出为源语言（英文标书 → 英文陈述）。中文章节承载英文原文（`contentZh` 落英文），未做翻译层；
  面向英文标书的中国投标方可接受，翻译作为后续增强。
- **持久化非事务**：`analyzeAndPersistV2` 先删后建、非单事务；中途失败靠 worker 重试自愈（再删再建，幂等）。
- **V2 时延/成本**：N×结构化 LLM 调用；已加心跳续租，超大 package 极端情况下可能触发 lease/stale 重试。
- **Deliverables/Tasks**：V2 ON 时不套 RCMP 固定模板（防编造），对应 tab 可能为空；grounded nextActions/
  submissionChecklist 落 summaryJson，由 Brief/章节呈现，未回填为独立 deliverable/task 行（后续）。
- **Phase F**：未新建冗余「统一面板」，复用既有 TenderAnalysisPanel（项目级）+ 新 Executive Brief + 保留 Document AI。

## 19. 是否建议进入下一轮 UAT

建议：人工 Final Review 通过后，在 **staging** 打开两 flag 跑真实 10 文件 E2E（§17）。
生产保持两 flag OFF，直至 V2 过冻结 Release Gate + 本轮 staging UAT 通过。

---

## 30 SECOND PROJECT INTELLIGENCE ROOT CAUSE

1. **为何只有「最近变化」有数据**：它单独请求 `/activity`（真实审计流）；其余字段读**冻结**的 `room.summaryJson`。
2. **「调查中」是不是 active AI processing**：不是。它来自单一全局 `room.summaryStatus="investigating"`
   贴在全部 11 张卡下；背后无任何 active run/worker。
3. **startBidIntelligence 的 Task 是否被执行**：否。创建 4 条 `status=todo` 的 Task 后**全仓无 executor** 认领
   （唯一 cron 只消费 `TenderAnalysisRun`，从不查 Task 表）。「创建 Task」被误当「AI 已开始调查」。
4. **旧 summary 是否 stale**：是。更新分支被 `if(!room.summaryText)` 守卫（写一次即冻结）；唯一刷新路径是
   `TenderAnalysisRun` 的 PROJECT_ROOM 步，且它用**键不匹配**的 `run.summaryJson` 覆盖，多数 brief 字段落空。
5. **修改前 Source of Truth**：`BidIntelligenceRoom.summaryText/summaryJson`（写一次的元数据模板）+ 单一 summaryStatus。
6. **修改后 Source of Truth**：**最新有效 `TenderAnalysisRun`（package 分析）**，经 `getExecutiveBrief` 的
   deterministic projection；每字段带独立 readiness state；外部情报字段独立标注。
7. **哪些字段来自 Tender Package**：一句话摘要 / 采购单位 / 产品或服务 / 项目类型 / 当前建议(AI) / 重大阻塞 /
   下一步 / 最近变化（含 package/addendum 变更合并）。
8. **哪些字段必须等 T4**：周期采购可能 / 上一轮中标方 / 历史合同金额（+ buyer profile / 竞争对手 / 类似采购 /
   市场价格 / 采购周期）。
9. **Missing / Processing / Unknown / External 如何区分**：
   - 无 run → `NOT_STARTED`；活跃 run（PENDING/EXTRACTING/ANALYZING）→ `PROCESSING`（**唯一**允许"分析中"，且有 run 背书）；
   - run FAILED → `FAILED`；就绪但字段空 → `UNKNOWN`；fingerprint 变 → `STALE`；未解决冲突 → `CONFLICT`；
   - 外部情报字段 → `NEEDS_EXTERNAL_RESEARCH`。**Missing≠Processing 严格区分，绝不 null→"调查中"。**
10. **是否产生新的 AI Runtime / 第二套 Pipeline**：否。Brief 是纯 deterministic projection（零额外 LLM）；
    Chat 复用 agent-core runtime。`SECOND_INTELLIGENCE_RUNTIME_CREATED = NO`。

---

## PR #106 Final Review Remediation（三 release-safety blockers）

**BLOCKER 1 — Package AI Experience 完全 flag-gated**
新增第三个主开关 `TENDER_PACKAGE_AI_EXPERIENCE_ENABLED`（+ `_ORG_ALLOWLIST`，default OFF），
只控制**用户可见读面**：Executive Brief / 30 秒看懂新版投影 / Tender Chat package context。
三 flag 职责分离：AUTO=orchestration，V2=reasoning engine，EXPERIENCE=read surface。
- `chat-context.ts` 内按 project.orgId 判 EXPERIENCE，OFF → 返回 null（会话不注入新上下文）。
- `/tender-brief` OFF → 返回 `experienceEnabled:false`；`ProjectIntelSections` 据此**退回 merge 前 room-based 渲染**。
- 生产三 flag 全 OFF → UI/会话行为与 merge 前完全一致。测试见 auto-flags（EXPERIENCE_OFF/ON/ALLOWLIST/职责分离）。

**BLOCKER 2 — V2 canonical 持久化 lease-fenced**
拆分 `runV2Inference`（LLM，零 canonical 写）与 `persistV2Fenced`（单事务：先 fence 校验
`run.id/leaseOwner/status∈{EXTRACTING,ANALYZING}/lease 未过期` 并原子续租——行锁持有至提交，
并发认领阻塞/失败，fence 通过才允许 clear+全部 canonical 写）。fence 失败 → `TenderV2LeaseLostError`，
**ZERO canonical 写**；事务内异常 → 全回滚（无 partial）。heartbeat `renewLease` 返回 false → 记 leaseLost，
推理返回后立即 fail-closed。worker 把 `TenderV2LeaseLostError` 转为既有 `LeaseLostError`（graceful yield，不 markFailed）。
复用现有 leaseOwner 契约，无第二套 lease。确定性 race 测试 V2-LEASE-01/02/03（可注入事务）全绿。

**BLOCKER 3 — Package 覆盖率可见性**
`package-coverage.ts` `summarizePackageCoverage` 汇总 uploaded / eligible / analyzed / excluded + reasons，
`/tender-brief` 返回 `coverage`，30 秒看懂头部展示真实标签「已分析 7 / 10 个文件 · 3 个文件当前格式尚未纳入」。
不扩展 DOCX/XLSX（避免 scope explosion），但**禁止谎报「已分析 10」**。测试覆盖 10→7 场景。

## GATE（已按 Final Review 校正口径）

```
TENDER_PACKAGE_AI_UPGRADE_STATUS = BLOCKED_PENDING_STAGING_REAL_E2E

# 工程实现（flag-gated，生产默认 OFF）
AUTO_ANALYSIS_AFTER_UPLOAD        = PASS
NO_MANUAL_FIRST_ANALYSIS_REQUIRED = PASS
PACKAGE_READY_GATE                = PASS
ONE_PACKAGE_ONE_ACTIVE_RUN        = PASS
SILENT_FAILURE_FIXED              = PASS
DOCUMENT_AI_PRESERVED             = PASS
PACKAGE_LEVEL_ANALYSIS            = PASS
CROSS_DOCUMENT_REASONING          = PASS
ADDENDUM_OVERRIDE                 = PASS
CONFLICT_DETECTION                = PASS
SOURCE_TRACEABILITY               = PASS
TENDER_CHAT_PACKAGE_CONTEXT       = PASS
ADDENDUM_AUTO_REANALYSIS          = PASS
THIRTY_SECOND_BRIEF               = PASS
FAKE_INVESTIGATING_STATE_REMOVED  = PASS
TENDER_PACKAGE_AS_PRIMARY_SOURCE  = PASS
STALE_INTELLIGENCE_REFRESH        = PASS
EXTERNAL_INTELLIGENCE_SCOPE       = DEFERRED_TO_T4
SECOND_INTELLIGENCE_RUNTIME_CREATED = NO

# Final Review Remediation
EXPERIENCE_MASTER_GATE            = PASS
PRODUCTION_BEHAVIOR_WHEN_FLAGS_OFF = UNCHANGED
V2_PERSISTENCE_FENCING            = PASS
STALE_V2_WORKER_WRITE             = BLOCKED
PACKAGE_COVERAGE_VISIBILITY       = PASS

# 回归口径（校正）
PURE_REGRESSION   = PASS
DB_REGRESSION     = BLOCKED_PENDING_ISOLATED_NEON
FULL_REGRESSION   = BLOCKED_PENDING_DB_VALIDATION
REAL_E2E          = BLOCKED_PENDING_STAGING_VALIDATION

PRODUCTION_ENV_CHANGED   = NO
PRODUCTION_MIGRATION_RUN  = NO
```

STOP —— 等待人工确认后再进入 isolated Neon + staging（三 flag ON）+ real ~10-file Tender E2E。
不 merge、不改生产、不提高生产并行度、不打开生产 flag。
