# Qingyan Tender T1B — Workforce Integration Report
## One-Click Tender Agent + First Real E2E

- 实现 base：`8303145`（2B-2 merge 后 verified main）；交付前 main 先后合入 **#98（T1A 5-Tab UX）** 与 **#99（T2-M1 Ledger/Archive schema foundation）**，已按任务书 §4 审查式 rebase 至 `9efcfa4`（见 §13a 集成记录）
- Branch: `feature/tender-t1b-workforce-integration`
- 唯一执行链：Tender UI → Workforce Job（root AgentRun）→ AgentRunStep/Task → Worker Registry → Tender Tools（共享 tender-auto-analysis services）→ Handoff → Native Synthesis → Verifier → Job Read Model。**零第二套 Tender Runtime**（§2）。

---

## 1. Existing Tender Analysis Map（§5 调查结论）

CURRENT_TENDER_ANALYSIS_FLOW（实证）：

```
[分析投标文件 button] components/tender-analysis/analysis-panel.tsx
      ↓ POST /api/projects/[id]/tender-analysis/package {action:"enqueue"}
[SVC] tender-auto-analysis/enqueue-package.ts enqueueTenderPackageAnalysis
      （gate → getTenderPackageDocuments → fingerprint/idempotencyKey →
       TenderAnalysisRun(PENDING) + RunDocument[]）＝ DB 即队列
      ↓ cron */2min api/cron/tender-auto-analysis → worker.ts（lease/step 游标）
      ENSURE_PAGES → EXTRACT_FACTS → GENERATE_SECTIONS → EXTRACT_REQUIREMENTS
      → BUILD_DELIVERABLES → BUILD_CLARIFICATIONS → CREATE_TASKS → PROJECT_ROOM
      → FINALIZE(REVIEW_REQUIRED)
      ↓
[UI] analysis-panel（intelligence-room 挂载）+ analysis-progress-banner（files tab）
      ↓ 批准分析 → review.ts approveAnalysisRun
```

关键事实：`TENDER_ANALYSIS_LLM` 默认 off 且 llm-enrich 仅探活丢弃结果——legacy "分析" 实为**确定性正则抽取 + 模板**；`report.ts` RISKS 章节为硬编码样本文案（RCMP 专用）；fact 抽取规则为样本特化正则（M5000-25-3574-A "Backpacks for Cadets"）。requirement 抽取的通用 M-code / shall / must / mandatory 模式对任意文档有效。

## 2. Reused Services（§7 共享边界）

Workforce 与 legacy 共用同一批 stage service（Legacy Trigger 与 Workforce Worker 双入口，无 Workforce→legacy queue 调用）：

| Service | 用途 |
|---|---|
| `gate.ts canAutoEnqueueAnalysis` | tender 域门（workDomain / intelligenceRoom） |
| `package.ts getTenderPackageDocuments / computePackageFingerprint / packageTooLarge / detectMultiplePrimaryWarning` | 文件包选择 + 指纹 |
| `page-parse.ts parseDocumentPagesAndStore` | PDF → 逐页文本（幂等） |
| `extract.ts extractFromPages / extractRequirements` | facts + requirements + sourceRefs |
| `report.ts generateReportSections` | 16 报告章节 |
| `clarifications.ts buildClarifications` | 澄清草稿（draft-only） |
| `review.ts approveAnalysisRun` 等 | 结果人审流程（**零改动直接可用**——workforce 成功终态 = REVIEW_REQUIRED） |

## 3. Workforce Job Contract

- 创建唯一入口 = `createWorkforceJob`（含 `WORKFORCE_RUNTIME_ENABLED` + allowlist 门与 org 级 `DAILY_AGENT_RUNS` 配额治理）；T1B 是它的**第一个生产调用方**。
- `CreateWorkforceJobInput` 新增可选 `extraMetadata`（server-only；浅层、≤16 键、值 ≤500 字符、保留键 `goal/runtimeVersion/initiatedByUserId/threadId/channel/source/jobId` 不可覆盖 fail-closed）——与 goal 同事务写入，消除"创建后补写 metadata"与首个规划 slice 的竞态。
- goal 由 server 组装（`buildTenderAnalysisGoal`）：项目名 + 流程叙述 + 约束（≤8 任务 / dependsOn 声明 / analysis 模式 / synthesis 收尾 / finalize 依赖 synthesis）＝ §15 允许的 instructions/structured-context 杠杆。

## 4. Tool Scope（§12 MINIMUM TOOL SCOPE）

七个 tender 工具 **不进** `RUNTIME_V2_TOOL_CATALOG`：全局 planner 投影维持 13 个销售线工具零污染（`EXECUTABLE ⊋ PLANNER_VISIBLE` 为 #88 明确允许方向，p0-alignment 27/27 不变）。tender job 规划时由 processor 经 `workforce-runtime/scope.ts` 注入 `availableTools = 白名单`，planner sanitize 强制 `preferredTool ⊆ 白名单` → email/calendar/sales 写工具在 tender 计划里**结构性不可达**。

| 工具 | readOnly | 审批 | 写入 |
|---|---|---|---|
| tender_validate_input | ✗ | 无 | 创建/复用域 run + RunDocuments（幂等键 `tender-workforce:v1:{jobId}`） |
| tender_parse_documents | ✗ | 无 | ProjectDocumentPage（按真实 page 行幂等） |
| tender_extract_requirements | ✗ | 无 | Facts/SourceRefs/Requirements/Sections（共享 service） |
| tender_evidence_compliance | ✓ | 无 | 无（只读聚合） |
| tender_risk_analysis | ✗ | 无 | RISKS 章节（真实 LLM 分级，覆盖 legacy 模板文案） |
| tender_clarification_draft | ✗ | 无 | TenderClarificationQuestion（OPEN 草稿） |
| tender_finalize_analysis | ✗ | 无 | summaryJson=tender-analysis-result/v1 + REVIEW_REQUIRED |

全部 `requiresApproval=false`（机器分析产物，与 legacy auto-analysis 同信任级；无任何 §28 禁用动作）。全部**不标 `parallelSafe`** → 2B-2 classifier 恒 SEQUENTIAL（§30 顺序基线；未来 1→2 需另行 Gate 后按需标注）。

## 5. Worker Mapping（§13）

复用既有 registry：`tender_worker`（投标要求提取、合规与废标风险分析；2B-1 起预留，T1B 首次配齐工具）承担全部 work 任务；`synthesis_worker` 承担 synthesis。**零新增 worker**。

## 6. Task Graph（§14/§15）

经现行 Planner（模型）+ Task Contract 表达，无 deterministic plan injection。参考结构（测试用手工计划同构；真实 E2E 由模型自行规划）：

```
t0 validate → t1 parse → t2 extract ┬→ t3 evidence ┬→ t4 risk ┐
                                    └→ t5 clarify ─┴──────────┴→ t6 synthesis(native) → t7 finalize
```

8 步 = `AGENT_RUNTIME_V2_MAX_STEPS` 默认上限；goal 明示步数约束。

## 7. Domain Source of Truth（§6）

业务结果 100% 落 canonical Tender Domain：`TenderAnalysisRun`（workforce 专用状态，见 §15 节）+ RunDocument/Fact/SourceRef/ExtractedRequirement/Section/ClarificationQuestion。Workforce 侧只有执行态（AgentRun/Step/Event/Handoff）。**零第二套业务模型**（无 WorkforceRequirement 等）。写入全经 service（工具层不散落 db 业务规则；`analysis-run-service.ts` 为薄适配层：create/finalize/fail/upsertRiskSection，条件更新防复活）。

## 8. Trigger Idempotency（§10/§36）

三层：
1. `requestId` 重放（HTTP retry / 双击共享同一 requestId）→ 直接返回既有 Job；
2. `pg_advisory_xact_lock(hashtext("tender-workforce-start:{orgId}:{projectId}"))` 串行化 check-then-create 临界区 → 并发不同 requestId 也收敛 `ACTIVE_JOB_COUNT=1`（实测）；
3. 活跃集 `TENDER_JOB_BLOCKING_STATUSES`（queued…awaiting_approval + needs_human）阻断新建；终态（completed/failed/cancelled）不阻断——「重新分析」对 needs_human/终态走 restart（cancel 旧 + 建新）。

域侧第四层：TenderAnalysisRun.idempotencyKey = `tender-workforce:v1:{jobId}` unique → 工具重试/竞态 P2002 读回，**一 Job 至多一域 run**。

## 9. Authorization（§9）

- 查看状态/结果：`requireTenderAnalysisRead`（= #95 同源 `requireProjectReadAccess`）。
- 启动 / 重新分析 / 取消：`requireTenderAnalysisWrite`（= `requireProjectWriteAccess` = repo 的 `requireProjectManageAccess` 同函数）——产生 AI 成本与写结果，取现有最严格项目门。
- Cancel 服务端再验 org + project + `metadata.workDomain=tender` + runType 归属（**绝不只拿 runId cancel**）。
- 执行期重鉴权沿用 executor 既有 `canInvokeTool`（组织成员 + 角色标签，tender 工具按 l0_read 风险档）。
- 零新 RBAC。

## 10. Needs Human（§27/§33）

复用现有 needs_human 语义（verifier hard floor 收敛）。错误语义分层：工具错误前缀 `INPUT_MISSING / DOCUMENT_PARSE_FAILED / MODEL_FAILED / TOOL_FAILED`（步骤 errorMessage，Job Center 可见技术原因）；卡片 UI 显示 read-model 字典文案（needsYou.title/detail）人话提示。缺文档/无法解析 → fail-closed，绝不虚构文档内容（§17）。补资料后「重新分析」即可（restart），无新 conversational resume engine。

## 11. Approval Boundary（§28）

T1B 全链 READ/ANALYSIS + 机器分析产物写入，无审批动作：不 GO/NO-GO、不 Technical Approve、不 Lock、不发邮件、不提交。审批基础设施未触碰（PendingAction / approval port / 2C-1 resume 零改动）；若未来 tender 工具声明 requiresApproval，2B-1/2C-1 既有链路自动生效。人工确认保留在域层：REVIEW_REQUIRED → 人审 → approveAnalysisRun（既有）。

## 12. Synthesis Contract（§22）

#94 native synthesis 原样复用（`taskKind=synthesis` 无 preferredTool → `executeWorkforceSynthesisTask`，模型出口 createCompletion，zod 结构化，fail-closed `synthesis_failed`）；输入 = declared dependsOn 声明序 validated Handoff。`tender_finalize_analysis` 按语义形状（summary+conclusions+synthesisOf）从声明证据读取综合结论，与域内确定性统计组装 `tender-analysis-result/v1`。

## 13. UI Integration（§8/§26/§48）

`TenderAnalysisAgentCard`（`components/tender-analysis/agent-card.tsx`）：自包含（自取数 + 8s 活跃轮询 + requestId 意图内稳定）；状态人话（分析中 x/y·当前任务 / 需要处理+原因 / 完成+摘要 / 已取消）；按钮「开始 AI 分析 / 重新分析 / 取消」；「查看执行详情」→ `/workforce/{jobId}`。挂载于 `TenderAnalysisPanel` 顶部两处渲染根——**零 projects/[id]/page.tsx 触碰**。flag off → GET `enabled=false` → 卡片渲染 null，legacy UI 逐像素原样（§37）。

### 13a. 与 T1A（#98）/ T2-M1（#99）的交付期集成

实现始于 `8303145`；交付前 main 合入 #98 与 #99（均属任务书 §4 需审查类别），已审查式 rebase 至 `9efcfa4`：

- **#98（T1A 5-Tab）**：对 panel 仅 additive props（sections/showRunControls/initialTab/quietEmpty），双渲染根结构保留。唯一冲突点=主渲染根同位插入，解决方案：**卡片仅在 `showRunControls`（主挂载点）渲染**——T1A 把 panel 多点挂载（招标要求 tab 主挂载 + 提交 tab quiet 挂载）后，卡片只在主挂载出现一次，不在次要挂载重复；quietEmpty 空态不渲染卡片。这正是 §48 预期的"T1A merge 后组件放进工作台"路径，一键入口随 panel 进入 5-Tab。
- **#99（T2-M1 schema foundation）**：纯新增表（Ledger/Archive 基础），与 T1B 文件面零交集、零冲突；本 PR 仍 SCHEMA_CHANGE=NONE（未触碰 schema、未使用新表）。
- rebase 后全套重验：tsc / eslint / 两个 T1B 套件 / build / **test-all 全量（union 树）** 结果见 §19 与 Final Gate。

## 14. Job Center Integration（§25）

Tender Job 自然出现在 `/workforce` 与 `/workforce/[id]`（runType=workforce_job 即被 read model 拾取，零 Job Center 改动）。标题 = planJson.objective（规划前 metadata.goal 截断）。新增 tender 域数据经 2D-1 安全投影（实测无 workforceHandoff/operationKey/priorEvidence/idempotencyKey 泄漏）。

## 15. Legacy tender-auto-analysis Compatibility（§7/§37）

- Legacy 模块**零删改**（display-labels 加 2 个新状态文案除外，additive）。
- Workforce 域 run 专用状态：`AGENT_ANALYZING`（进行中）/ `AGENT_FAILED`（失败/取消）——String 列新值零 schema 变更；不在 legacy `CLAIMABLE_STATUSES`、候选查询（PENDING/FAILED/EXTRACTING/ANALYZING）与 reaper（EXTRACTING/ANALYZING）任何集合 → **legacy cron 永不认领/回收 workforce run**（纯逻辑 + DB 双重断言）。刻意不用 legacy `FAILED`（会被候选查询复活重跑 legacy pipeline）。
- 成功终态复用 `REVIEW_REQUIRED` → panel 展示 / 人审 / approve 全流程零改动可用。
- 交互（实测）：同指纹 workforce 结果存在时 legacy enqueue `idempotent_reuse` 复用之（canonical 域收敛，正确行为）；新项目 legacy enqueue 照常 `enqueued=true`。
- files-tab 进度 banner 的 ACTIVE 集不含 AGENT_*（互不干扰；agent 状态由新卡片承载）。

## 16. Runtime Impact（§39）

**WORKFORCE_RUNTIME_CORE_MODIFIED = NO**——执行核心（executor / processor 执行与租约路径 / lease / CAS / fencing / verifier / parallel / task-contract / handoff / synthesis / approval / planner 引擎）零语义改动。逐项披露的 additive 触点（全部为注册表/接口扩展面）：

| 文件 | 变更 | 性质 |
|---|---|---|
| `workforce-runtime/scope.ts` | 新增：workDomain → planner availableTools 解析（未注册域 → undefined = 原行为） | 新扩展点（声明式） |
| `workforce-runtime/processor.ts` | 规划调用 +2 行：解析并传 `availableTools`（planner 既有参数） | 规划输入选择，非执行语义 |
| `workforce-runtime/job.ts` | `extraMetadata` 可选入参 + 消毒（保留键 fail-closed） | 创建入口接口扩展 |
| `agent-runtime-v2/adapters.ts` | +import +spread 注册 7 个 tender handler | #88 设计的唯一工具扩展点 |

不变量佐证：p0-alignment-pure 27/27（catalog=13、ghost=0）与全部 2B-2/2B-1/2C-1/2A 套件在改动后全绿（见 §19）。

## 17. Schema Impact

**SCHEMA_CHANGE = NONE / Migration = NONE**。零新表零新列；新 status 值走既有 String 列；T2 模型（ProjectEvent/ProjectCost/TenderArchiveItem）零实现（§46/§47）。

## 18. Feature Flag（§31）

`TENDER_WORKFORCE_ANALYSIS_ENABLED`（默认 **off**，fail-closed）+ 可选 `TENDER_WORKFORCE_ANALYSIS_ORG_ALLOWLIST`（非空即收窄）。沿用既有 envBool/WithEnv/describe 模式，无第二套 flag 系统。双门：本 flag 控 Tender 入口；`WORKFORCE_RUNTIME_ENABLED`（+allowlist）继续控 Job 创建。客户端经状态 API `enabled` 字段感知（repo 无 NEXT_PUBLIC flag 先例）。

## 19. Tests

新套件（已注册 `scripts/test-all.sh`；纯逻辑套件另入 `scripts/test-ci-unit.sh`）：

- `t1b-pure.test.ts` **34/34**：flag 默认关/allowlist；白名单 7 工具全 executable ∧ 零审批 ∧ 零 parallelSafe；全局 catalog=13 零污染；scope 解析 fail-safe；AGENT_* 状态隔离（含 legacy worker 源码字面量扫描）；幂等键；阻断集；结果契约 strip/fail-closed；澄清零发送能力；goal 约束；T1B-02 路由授权源码契约。
- `t1b-integration.test.ts` **40/40**（隔离 Neon 分支）：T1B-01 启动+完整 §11 metadata；T1B-03 跨组织读/取消双拒；T1B-04 requestId 重放 + 活跃复用 + **并发双触发 ACTIVE_JOB_COUNT=1**；主管线 8 任务全链（真实共享 service 抽取：req=6/ref=18/澄清 9 条 canonical 落库；RISKS 结构化覆盖；summaryJson 过 v1 契约校验 readiness=GAPS_FOUND；native synthesis 声明序消费 5 上游；Job Center 投影安全）；T1B-05 缺文档 INPUT_MISSING→hard floor needs_human 且零域 run；T1B-07 跨项目 manifest 注入 fail-closed；T1B-11 t4 持续 MODEL_FAILED→重试耗尽→Job 非 completed、域 run 不假 REVIEW_REQUIRED；T1B-12 cancel 后零新认领 + 域 run AGENT_FAILED(cancelled)；T1B-14 flag off 拒启 + legacy 新项目照常入队 + 同指纹幂等复用；§7 legacy 零认领 DB 断言。
- 测试基建发现：tsx 下测试动态 import 与执行链静态 import 可产生双模块实例（repo 既知现象）——tender 工具测试接缝改为 `globalThis` Symbol 存储（进程级，仅 NODE_ENV=test 读取，生产零影响）。
- 回归：`test-all` 全量 **205/205 通过, 0 失败**（生产快照隔离分支；含 2B-2 policy/execution/claims/final-gate、P0 alignment 27+51、2B-1、2A、2C-1、kill-switch、read model/operator、production guards、Tender 全系列 + 新增 2 套件）。tsc / eslint（仅既有基线告警：ar2-preview/preview-hd-mask 的历史 any）/ build 全绿。

## 20. Real Tender E2E（§40–§43）

**环境**：生产快照 Neon 分支（`preview-t1b-e2e-*`，用毕即删）；真实项目 **「Bid Contract Package - CLZ-2026-001-A - Window Upgrade Phase 1 (Consultant Package)」**（Alberta Social Housing Corporation，Strathcona Place，Edmonton；主文件 AB-2026-05535 Bid Contract Package **15 页真实文本**，Protected A）；真实用户 lucas@（Lucas Bid org_owner / platform admin）；**全真模型链**（planner / risk / synthesis / verifier，零 stub）；驱动 = 触发服务 + `processWorkforceJobSlice`（与生产 cron 同一入口）。

**三轮实录（含两轮真实失败——按 §15 instructions/tool-scope 杠杆迭代，未触碰 Runtime）**：

| 轮 | 结果 | 发现与处置 |
|---|---|---|
| R1 | s1 后卡 awaiting_approval（零 PendingAction） | 模型 planner 给分析步骤误标 `requiresApproval=true`（planner 系统规则"写须审批"与分析写入的张力）。处置：工具描述全部改为"纯分析步骤：executionMode=analysis、requiresApproval=false"框定 + goal 显式反向指令。经「重新分析」restart 路径清场（实测 restart 正确 cancel 旧 Job + 域 run AGENT_FAILED） |
| R2 | 3/8 完成后 needs_human（hard floor 诚实收敛） | 模型对 dependsOn 组合有方差（s4/s6 只声明 [s3]，未含 s1）→ #89 scoped evidence 正确生效 → 工具拿不到 manifest fail-closed。处置：**manifest 回声**——每个 tender handler 输出携带分析清单，清单沿 handoff 链传播（声明任一 tender 上游即可获得；未声明依赖依旧零可见，#89 语义不变） |
| R3 | **COMPLETED 8/8**，`verification.passed`，域 run REVIEW_REQUIRED | 全链贯通：planner（真实 8 步计划）→ tender_worker×6 + synthesis_worker → 真实 LLM 风险分析 → native synthesis → finalize → tender-analysis-result/v1 落 summaryJson |

**§41 观察链**：用户触发 → Job Created/queued → Planner（plan.created）→ 8 Tasks（Job Center timeline 逐条 step.completed）→ Domain Results（TenderAnalysisRun 树）→ Synthesis → verification.passed → job.completed → Tender 卡片显示 COMPLETED + 域 run 待审阅 → 全程零人工进 Runtime。

**§42 结果人工检查**：
- Buyer/Project 理解 ✓（projectSummary 准确陈述：1 份 15 页主文件、无补遗、2 条强制要求已挂来源、facts=0、合规 NOT_ASSESSED、"不能确认投标响应已满足要求"——零虚构）；
- Closing Date：文档内未见 → 结果如实标注"截标日期缺失"并列入 next actions（不编造 ✓）；
- Requirements：GEN-001（如期履约义务）/GEN-002 均真实源自页面（通用 shall/must 模式）；GEN-002 为跨页断句残缺文本，**真实 LLM 风险分析准确识破并升为 HIGH 风险**（"文本不完整、义务范围无法确定"）——真分析，非模板；
- Risks：2 条 HIGH（合规未评估 / GEN-002 残缺），全部 source-linked，无一虚构；关键风险 0 如实；
- Evidence/Source：sourceRefCount=11，requirements 2/2 挂来源；
- Next Actions：7 条可执行（人工合规评审 / GEN-002 回查 / 澄清草稿决策 / 截标确认等）；
- Clarifications：9 条 OPEN 草稿（仅草稿 ✓）——**其中多数引用非本文档域内容（1000D 面料/拉链/M4–M6/7,500 等背包标词汇）**，系 legacy `buildClarifications` 样本模板所致（见 §22 新债 `TENDER_CLARIFICATION_TEMPLATE_BOUND`）；草稿仅供人工决策、绝不自动发送，风险受控但质量待偿。

**§43 度量（无本案 Golden Answer）**：REQUIREMENT_RECALL = NOT_MEASURED（定性：通用模式对 consultant 合同文体召回偏低，15 页仅出 2 条）；MANDATORY_RECALL = NOT_MEASURED；EVIDENCE_ACCURACY = NOT_MEASURED（抽出的 2 条要求 2/2 正确挂源，样本过小不报数值）；CRITICAL_RISK_MISSED = NOT_MEASURED；Unsupported claims：requirements/risks/summary/nextActions 层 **0**；澄清草稿层 7/9 含非本文档域内容（已如实登记）。BENCHMARK_INTEGRATION = PENDING（Real Tender Benchmark V1 未就绪，未阻塞本实现）。

## 21. Performance Baseline（§44）

SEQUENTIAL BASELINE（`WORKFORCE_JOB_MAX_PARALLEL_TASKS=1`，production 默认；R3 实测）：

| 指标 | 值 |
|---|---|
| total wall time | **81.8s**（2 slices） |
| planner time | 20.1s（模型）；首 slice 含规划共 47.1s |
| model time 合计 | 58.9s / 4 次调用（planner 20.1 + risk 12.1 + synthesis 19.7 + verifier 7.0） |
| tool time（非模型步骤） | ~6.3s（validate 0.9 / parse 0.5 / extract 2.2 / evidence 0.6 / clarify 1.4 / finalize 0.6） |
| synthesis task | 20.2s（native，声明序消费 5 上游） |
| risk task | 13.1s（真实 LLM 分级） |

未开启 parallel=2（§30/§44）；1→2 留待独立 Production Parallelism Validation Gate。

## 22. Known Gaps

| Gap | 说明 | 去向 |
|---|---|---|
| `TENDER_AI_COST_ACCOUNTING_GAP` | AiUsageLedger 桥接（usage-ledger-bridge）只认 request-context orgId，而该 context 从未赋 orgId；createCompletion 亦不向 recordAiCall 透传 orgId/runId → workforce（cron/驱动路径）模型调用**不入账**（读侧 recordAiCall 日志仍有量）。属既有全局缺口（非 T1B 引入），已验证。 | T2 Cost（§32 明确不在本 PR 修） |
| `TENDER_FACT_EXTRACTION_SAMPLE_BOUND` | legacy fact 抽取为样本特化正则（Backpacks for Cadets），任意其他真实标书 fact≈0（requirements 通用模式不受影响）；`TENDER_ANALYSIS_LLM` 默认 off。sourceCoverage.factCount 如实为 0，不虚构。 | Tender 抽取质量演进（T3/T4 线） |
| `TENDER_BLOB_PRIVATE_TOKEN_LOCAL_GAP` | 本地环境仅有 legacy public blob token；私有 store 文档（近期上传）本地不可读 → 本地重解析受限（生产 Vercel 环境不受影响）。E2E 中未解析文档如实记入 analysisLimitations。 | 运维凭证（非代码债） |
| `PLANNER_STEP_FLAG_VARIANCE` | 模型 planner 可能给分析步骤误标 requiresApproval=true → awaiting_approval 且无 PendingAction 可批（E2E R1 实测出现一次）。已按 §15 用工具描述框定 + goal 反向指令收敛（R3 未再现）；用户侧「重新分析」restart 可自助清场。残余方差属 §15 PLANNER_GAP 迭代面；根治属 T5 deterministic plan injection。 | 观察项（有清场路径） |
| `PLANNER_DEPENDSON_VARIANCE` | 模型 dependsOn 组合有方差（E2E R2：s4/s6 未声明 s1）→ scoped evidence 正确 fail-closed。已以 manifest 回声（handoff 链传播清单）结构性消解；#89 声明语义不变。 | 已消解（记录方法论） |
| `TENDER_CLARIFICATION_TEMPLATE_BOUND` | legacy `buildClarifications` 与 facts 同为样本特化：对任意文档生成含背包标域内容（1000D/拉链/M4–M6/7,500）的模板化澄清草稿（E2E 实测 7/9 非本文档域）。草稿仅供人工决策、绝不自动发送（§21），风险受控；质量债与 fact 抽取同源。 | Tender 抽取质量演进（T3/T4 线） |
| legacy 队列债 | tender-auto-analysis DB 队列 = T0 已登记的第二套队列债，T1B 按 §7 共存不迁移。 | T5 convergence decision |

## 23. T2/T3/T4/T5 Dependencies

- **T2**（Ledger/Archive/Cost，PR #96 preflight）：ProjectEvent 写入点（分析完成事件）、ProjectCost（本报告 cost gap 的正解）、TenderArchiveItem（文档溯源）。T1B 未预实现、未依赖。
- **T3/T4**（Memory/Intelligence）：requirements/risks 的结构化结果（tender-analysis-result/v1）是未来 TenderFingerprint/MemoryClaim 的自然输入。
- **T5**（Automation + Deterministic Plan Injection）：T1B 的 goal-驱动模型规划是过渡形态；deterministic server-authored plan 属 T5 Hard Dependency / Workforce Owner Design Gate，本 PR 零实现（§15 遵守）。
- **Parallel 1→2**：tender 工具已兼容（未标 parallelSafe = 恒串行安全）；开启需独立 Production Validation Gate 后按工具逐个评审标注。

---

# Final Gate（任务书 §50）

| Gate | 结论 |
|---|---|
| USER_TRIGGERED_ONE_CLICK_AGENT | **PASS**（一键触发 → 全链自动 → 结果回 UI；Real E2E R3） |
| WORKFORCE_JOB_CREATED | **PASS**（createWorkforceJob 唯一入口 + 完整 §11 metadata） |
| TENDER_WORKER_USED | **PASS**（tender_worker×6 work + synthesis_worker×1，registry 复用零新增） |
| SECOND_RUNTIME_CREATED | **NO**（零 TenderQueue/Engine/Scheduler；legacy 队列零认领 DB 断言） |
| CANONICAL_TENDER_DOMAIN_REUSED | **PASS**（TenderAnalysisRun 树 + 共享 stage services；零第二套业务模型） |
| TOOL_SCOPE_MINIMIZED | **PASS**（7 工具白名单；全局 catalog 13 零污染；planner sanitize 强制） |
| AUTHORIZATION | **PASS**（读=项目读门 / 启动·取消=项目写门；cancel 全量归属校验） |
| DOUBLE_TRIGGER_IDEMPOTENCY | **PASS**（requestId + advisory lock + 活跃集；并发实测 ACTIVE_JOB_COUNT=1） |
| CROSS_PROJECT_ISOLATION | **PASS**（跨组织双拒 + 跨项目 manifest 注入 fail-closed + 工具执行期自证） |
| REQUIREMENT_ANALYSIS | **PASS**（共享管线真实抽取 + 源挂钩；召回质量债已登记） |
| EVIDENCE_ANALYSIS | **PASS**（覆盖/合规聚合；复用 complianceStatus 恒不自动 COMPLIANT 不变量） |
| RISK_ANALYSIS | **PASS**（真实 LLM 分级 + source-linked；E2E 识破 GEN-002 残缺文本） |
| CLARIFICATION_DRAFT | **PASS**（OPEN 草稿仅供人审、零发送；legacy 模板质量债已登记） |
| NATIVE_SYNTHESIS | **PASS**（#94 原样复用；E2E 声明序消费 5 上游，20.2s 真实综合） |
| VERIFIER_HARD_FLOOR | **PASS**（T1B-05/T1B-11 + E2E R2：required 失败绝不 completed） |
| JOB_CENTER_INTEGRATION | **PASS**（/workforce 列表+详情零改动呈现；投影零内部泄漏断言） |
| TENDER_UI_INTEGRATION | **PASS**（TenderAnalysisAgentCard；flag off 逐像素 legacy 原样） |
| LEGACY_TENDER_ANALYSIS_PRESERVED | **PASS**（零删改；新项目照常入队；同指纹幂等复用=正确收敛） |
| WORKFORCE_RUNTIME_CORE_MODIFIED | **NO**（执行核心零语义改动；4 个 additive 注册/接口触点见 §16） |
| SCHEMA_CHANGE | **NONE** |
| T2_MODELS_CREATED | **NO** |
| PRODUCTION_PARALLELISM | **1** |
| PRODUCTION_ENV_PARALLELISM_CHANGED | **NO** |
| REAL_E2E | **PASS**（真实 ASHC 标书 / 真实用户 / 全真模型链；81.8s SEQUENTIAL BASELINE） |
| T1B_STATUS | **READY_FOR_FINAL_REVIEW** |

---

# Final Human Review / Dark Merge Gate（2026-08-10）

人工 Final Review 已完成，正式判定：

| 键 | 判定 |
|---|---|
| FINAL_REVIEW | **PASS** |
| T1B_ENGINEERING | **PASS**（Runtime / Orchestration / Safety 工程链全 Gate 通过） |
| DARK_MERGE_APPROVED | **YES**（normal merge commit，能力以休眠态入 main） |
| PRODUCTION_ENABLEMENT_APPROVED | **NO** |
| TENDER_WORKFORCE_ANALYSIS_ENABLED_PRODUCTION | **OFF**（default off，fail-closed；repo 内零 committed production value） |
| PRODUCTION_ENV_CHANGE | **NO**（本轮零 Vercel/env/secret 操作） |
| PRODUCTION_PARALLELISM | **1** |
| PARALLELISM_ENABLEMENT | **NOT_STARTED** |
| NEXT_PHASE_AUTOSTART | **NO** |

## 质量 Blocker（为什么 Dark Merge ≠ 生产启用）

**T1B 的 Runtime / Orchestration / Safety 已通过工程 Gate**（一键触发、幂等、授权、隔离、
CAS/fencing、native synthesis、verifier hard floor、Job Center、209/209 回归、真实 E2E 全链）。

**但 Tender Understanding / Extraction / Clarification 未达到生产启用标准**，已知真实风险：

1. `TENDER_FACT_EXTRACTION_SAMPLE_BOUND` — 真实 E2E：15 页真实 Tender（ASHC CLZ-2026-001-A）
   仅提取出 2 条强制 Requirement（facts=0）；legacy 抽取规则为历史样本特化。
2. `TENDER_CLARIFICATION_TEMPLATE_BOUND` — 真实 E2E：澄清草稿 7/9 含跨领域模板污染
   （背包标词汇出现在窗户升级顾问标中）。
3. PR #97 Benchmark（tender-eval/v1）已证明旧 Analyzer 对真实 Tender 泛化能力不足
   （V1 基线：RCMP 过拟合 + LLM 空壳）。

因此：**T1B merge ≠ Tender Agent production approval**。

## Production Enablement Release Gate（冻结）

```
PRODUCTION_ENABLEMENT_GATE =
      CONFIRMED_GOLDEN
  AND MANDATORY_RECALL        >= 90%
  AND REQUIREMENT_RECALL      >= 85%
  AND CRITICAL_FACT_ACCURACY  >= 90%
  AND EVIDENCE_ACCURACY       >= 95%
  AND UNSUPPORTED_CRITICAL_CLAIMS = 0
  AND CROSS_DOMAIN_TEMPLATE_LEAK  = 0
```

全部满足之前，`TENDER_WORKFORCE_ANALYSIS_ENABLED` 不得在 production 开启。

## Dormant Capability 语义（永久分离的两个状态）

Merge 后系统拥有 **Dormant Tender Workforce Capability**：代码在 main、
测试常驻回归、staging 可灰度验证；但生产用户不可访问，除非未来显式开启 Feature Flag
（且必须先过上方 Release Gate）。

```
CODE_AVAILABLE       = YES
PRODUCTION_AVAILABLE = NO
```

## Next Main Priority（记录，不自动启动）

`NEXT_MAIN_PRIORITY = TENDER_UNDERSTANDING_V2`：真正通用的 Tender Understanding
+ PR #97 Benchmark Gate + 真实 Window Covering Tender 数据。未来流程：

Tender Understanding V2 → Confirmed Golden → Benchmark → Release Gate PASS →
Production org allowlist 灰度开启 → Real User Validation → Parallelism 1→2 独立 Gate。

本轮不启动：Tender Understanding V2 实现 / T2-P1 / T2-M2 / T3 / T4 / T5 /
Award Watch / Auto RFQ / Auto Submission / 2B-3 / 2C-2 / 2C-3 / Parallelism 1→2 /
Production Feature Flag rollout。
