# Qingyan Tender T0 — Implementation Roadmap（T1–T5）+ Phase 2 冲突矩阵

| 项 | 值 |
|---|---|
| 基线 | `main @ abac67e`（含 PR #85 / 2B-1）；在途：PR #87（2D-1，Draft）、2B-2（并行开发中，无 PR） |
| 分支 | `design/tender-t0-memory-intelligence`（docs-only） |
| 日期 | 2026-08-10 |
| 性质 | 路线图设计；**本轮不启动任何 T1+ 实施**，T0 交付后 STOP 等待人工 Final Review |
| 修订 | 2026-08-10 Final Architecture Micro-Fix：T2 增加 Entry Gate（ProjectEvent 写入点前置硬闸）；T3 冻结为 MemoryClaim+Buyer 核心 + Fingerprint/Snapshot 物化 Design Gate；AwardRecord 明确 T4 域表；T5 硬依赖清单（含 Deterministic Plan Injection） |
| 姊妹文档 | `QINGYAN_TENDER_T0_UX_CONSOLIDATION_AUDIT.md`、`QINGYAN_TENDER_T0_MEMORY_INTELLIGENCE_ARCHITECTURE.md` |

---

## 0. FILE OWNERSHIP / CONFLICT MATRIX（对 2B-2 / 2D-1 的硬边界）

依据：PR #87 实际 diff（20 文件）+ `docs/QINGYAN_WORKFORCE_PHASE2B_HANDOFF_PARALLEL_DESIGN.md` 点名的 2B-2 目标模块 + 2C 系列挂载点。本轮**只登记，不解决**。

### 0.1 DO_NOT_TOUCH_UNTIL_PHASE2_MERGED（Tender 任何阶段工作在 Phase 2 合并前禁改）

**Workforce / Runtime core（2B-2 与 2C 的主战场）：**

```
src/lib/workforce-runtime/{processor,resume,job,handoff,task-contract,workers,flags,constants,index}.ts
src/lib/agent-runtime-v2/{executor,persist,process,schemas,planner,flags,adapters,principal}.ts
src/lib/agent-runtime/{lease,queue,run}.ts
src/lib/approval/port.ts            ← 2C-1 已挂载（:519-523），2C-2/2C-3 继续在此落地
src/lib/pending-actions/executor.ts ← 2C-2 resource freshness 目标
src/app/api/cron/agent-runs/route.ts ← 唯一 Workforce 执行触发器
```

理由摘要：2B-2 将重写 `executor.ts:206-255` 的单步执行为批量并行（T1 幂等短路 / T2 步级 CAS / T3 `Promise.allSettled`）、给 `PlanStepSchema`（`schemas.ts:17-32`）加 `resources`、改 `persist.ts` 的 `refreshReadySteps` 与 `processor.ts` 的 slice 调度；`resume.ts:314-316` 是 2C-2 的显式挂载点。

**2D-1 / PR #87 独占文件：**

```
src/lib/workforce-runtime/read-model/**（含 PR 新增 list-service.ts / api-org.ts）
src/app/(main)/workforce/**、src/app/api/workforce/**
docs/QINGYAN_WORKFORCE_PHASE2D1_OPERATOR_UX_REPORT.md
```

注意：PR #87 的静态审计测试会扫描 `src/app/(main)/workforce/**` 与 `src/app/api/workforce/**` 全树找 mutation——**tender 工作也不得往这两棵树添加文件**。

### 0.2 POTENTIAL_CONFLICT（可改，但必须错位/协调）

| 文件 | 冲突方 | 协调规则 |
|---|---|---|
| `src/lib/navigation/registry.ts` | PR #87 在 WORK 组插入 `work-ai-jobs`（约 `:182-193`，displayOrder 65） | T1 导航改动**等 #87 合并后 rebase**；tender 条目用独立 displayOrder、远离 WORK 组插入点 |
| `src/lib/i18n/{en,zh,messages}.ts` | PR #87 各 +1 行（`nav_ai_jobs`，锚点在 `nav_ai_assistant` 附近） | tender key 加在接口/对象的不同区段；messages.ts 是接口，三文件必须同步否则 typecheck 失败 |
| `scripts/test-all.sh`、`scripts/test-ci-unit.sh` | PR #87（+3/+2）、2B-2 新 suite、PR #51/#52 也改 | tender suite 追加在远离 Workforce 块（`test-all.sh:60-76`）的位置 |
| `src/components/ui/{status-badge,empty-state}.tsx`、`src/components/page-header.tsx` | PR #87 页面 import 三者 | 只允许 additive props；禁止改/删既有 variant（会打断 #87 typecheck） |
| 审批/PendingAction UI（assistant approval-card / pending-inbox / inline-approval-panel / capabilities approvals 页） | 2C-3 将落人工介入语义 | tender 侧只做"读模型投影/入口"，不改审批语义与 payload/hash 处理 |
| `prisma/schema.prisma` | 2B-2 明确零 migration（设计 §15）；PR #87 不改；**真正的冲突源是 PR #52**（+53/−2） | T2+ 的 additive migration 需独立批准；与 #52 状态对表 |

### 0.3 SAFE（两条在途 lane 均不触碰）

`src/app/(main)/projects/**`、`src/lib/tender-auto-analysis/**`、`src/lib/bid-workflow/**`、`src/components/tender*/bid*/inquiry/quote/project-*/**`、`src/components/app-shell.tsx`（注意 PR #24 workbench-v2 会改）、`mobile-nav-drawer.tsx`、`mobile-tab-bar.tsx`。

---

## 1. 阶段总览

```
T0（本轮）  审计 + 设计 + 路线图                              ← docs-only，已完成即 STOP
T1          UX Consolidation（5 tab 重构 + 删/合/藏）          ← 零 schema、零 runtime
T2          Project Ledger + Archive Foundation                ← 首批 additive migration
T3          Corporate Memory（Claims/Buyer/Fingerprint/相似检索）
T4          Tender Intelligence（Award/周期/竞争/定价/供应链）
T5          Automation + Learning Loop（Workforce 集成 + Award Watch + 自动沉淀）
```

依赖主线：T1 仅依赖 Phase 2 合并（导航/i18n 协调）；T2 独立于 T1 可并行准备但建议 T1 先行（新 UI 承接 Ledger 投影），**T2 写入实现另受 T2 Entry Gate（§3）约束**；T3 依赖 T2（claims 需要 archive/event 底座），核心=MemoryClaim+Buyer，Fingerprint/Snapshot 物化过 Design Gate；T4 依赖 T3（Buyer/Claims）；T5 依赖 Phase 2 全并 + T2–T4 数据面 + **硬依赖清单（§6，含 Deterministic Plan Injection = T5 HARD DEPENDENCY）**。

---

## 2. T1 — UX Consolidation

**目标**：把 47 个页面/tab 收敛为 Tender Detail 5 一级 tab + 贯穿抽屉；消灭死路由/断链/重复卡片/平台面外溢。**先解决用户流程，不动数据。**

### Scope

按 UX 审计文档 §4–6 执行，拆 PR 建议：

| PR | 内容 | 性质 |
|---|---|---|
| T1-PR1 诚实与安全修复 | `conversations` 补 PlatformAdminGate；`/ai-activity` 补门；AgentTask execute/cancel 加 canManage；删 2 条 404 死路由；修 `?tab=` 深链（页面读取参数）与坏锚点；分析进度条不再向普通用户透出原始 errorMessage | 最小、高价值、零冲突 |
| T1-PR2 导航收敛 | 删 `/bids` 壳与 `ws-bids`；删 6 个 stub 路由与侧栏行；删 IntelHubShell 双导航；`/operations/center` 卡指向修正 | **等 #87 合并后 rebase 再做**（registry/i18n 冲突区） |
| T1-PR3 Detail 5-tab 重构 | `projects/[id]/page.tsx` 拆分为 5 tab 容器 + 区块迁移（工作台/招标要求/标书与报价/情报/提交）；文件降级为资料抽屉；调查室内容归位后路由 301；4 摘要面合并为工作台 AI 简报 + 情报主卡；工作台 Needs You 卡（拼装现有 pending-actions + 待确认计数） | 大 PR，建议 feature flag（`TENDER_DETAIL_V2`）灰度 |
| T1-PR4 隐藏平台面 | AgentTask 面板 / 一键投标方案 → INTERNAL_ONLY；runtime 活动事件服务端过滤（activity API 增加服务端 category 过滤，替代 `filterProjectContextActivities` 纯客户端方案）；header"文档" tile 改指资料抽屉 | 中 |

### Dependencies
- PR #87（2D-1）合并（registry/i18n）；2B-2 合并非硬依赖（T1 不碰 runtime），但建议等齐以免 test-all.sh 反复冲突。
- 不依赖任何新数据。

### Schema impact：**NONE**
### Runtime impact：**NONE**（不触碰 §0.1 清单任何文件）

### Risk
- `sessionStorage` tab 键与既有用户态迁移；`?tab=` 修复会改变既有（坏的）行为——需同步修字符串断言型单测（`bid-workflow-phase1.test.ts:169-170`）。
- 932 行 client 组件拆分回归面大 → flag 灰度 + 保留旧 tab 渲染路径一个观察期。
- 移动端 tab-bar 招投标入口随 `/bids` 删除需同步改指 `/projects`。
- 角色矩阵（operations/sales 隐藏逻辑）必须逐角色回归（nav-permission-smoke 脚本已存在可复用）。

### Acceptance criteria
1. 业务用户全流程仅经 5 tab + 抽屉完成（上传→确认要求→询价报价→提交→结果）；
2. 死路由/断链数 = 0（含 `?tab=` 深链全通）；
3. 平台子路由无一可被非 platform admin 打开（含 conversations）；
4. 同一信息在 detail 页内只有一个可写入口（GO 决定、AI 摘要各一处）；
5. 导航单一来源 = registry，`findDuplicateHrefs` 通过；
6. 现有全部 tender 相关测试绿 + 新增 5-tab 路由/权限测试。

---

## 3. T2 — Project Ledger + Archive Foundation

**目标**：形成事件事实源与永久项目档案底座；成本第一次可见。

### T2 Entry Gate（ProjectEvent 写入实现开始前必须全部 APPROVED）

```
LEGACY_EVENT_STORE_DECISION_GATE      = APPROVED    ← 9 套存量存储逐套定档（架构文档 §3.5 判决提案的批准）
PROJECTEVENT_SOURCE_OF_TRUTH_BOUNDARY = APPROVED    ← 唯一权威业务事件边界（哪些事实归 Ledger、哪些留域内源）
DUAL_WRITE_PLAN                       = APPROVED / NOT_REQUIRED（TEMPORARY + 退出条件 + 对账方案）
IDEMPOTENCY_CONTRACT                  = APPROVED    ← eventKey 规范与重放语义
MIGRATION_PLAN                        = APPROVED    ← safe-migrate 流程内
```

**冻结口径**：`ProjectEvent` 表**方向已批准（direction = APPROVED）**；**生产写入点 NOT YET APPROVED**——Gate 全过前不得铺设任何 ProjectEvent production writer，尤其禁止一次性接入几十个写入点。

### Scope
- **T2-PR0（Gate 材料）**：把架构文档 §3.5 的 9 套存量判决提案定稿提批（KEEP_AS_DOMAIN_SOURCE / KEEP_AS_TECHNICAL_AUDIT / KEEP_AS_RUNTIME_TELEMETRY / DERIVED_ONLY / DUAL_WRITE_TEMPORARY / DEPRECATE / REMOVE），并产出上述五项 Gate 文件；
- `ProjectEvent` 表 +（**Gate 通过后**）首批写入点（stage-transition、tender-result、abandon、go-decision、run approve、document add、inquiry sent、quote confirmed、handoff、cost.recorded 手工录入）；每个业务事实只设**一条权威事件**，其他系统 reference/derive/notify/audit/project；
- 双写仅按 Gate 批准的 DUAL_WRITE_PLAN 执行：TEMPORARY（退出条件/日期明确）、EXPLICIT（逐点登记）、IDEMPOTENT（eventKey）、RECONCILED（对账/parity 脚本）；禁止无限期双写；
- 工作台 Ledger 投影（活动卡换源、成本卡、People 贡献）；
- `TenderArchiveItem` + 上传路径归档化（内容寻址 + 去重读路径）+ `ProjectDocument` supersede/软删/orgId 补列；
- tender AI 成本桥接 `AiUsageLedger`（worker FINALIZE 一次调用）；
- 顺手债（独立小 PR）：AuditLog traceId 列启用 + payload Json 化 + `(projectId, createdAt)` 索引；checklist 伪文档迁出；结果备注停止追加 description。

### Dependencies：T1 合并（新工作台承接投影）；migration 流程遵守 `safe-migrate-deploy` 纪律（历史事故文档在案）。
### Schema impact：**2 张新表 + 若干 additive 列**（架构文档 §15），每个 migration 单独批准。
### Runtime impact：**NONE**（纯领域服务层追加；不碰 Workforce）。

### Risk
- 双写期一致性（Ledger 与 AuditLog/SYSTEM 消息并存）→ 以 eventKey 幂等 + 对账脚本护航；
- 事件词表过早膨胀 → 首批仅 §3.3 词表，扩词表走评审；
- 成本录入的采纳率是产品风险 → 工作台"记一笔"必须 ≤10 秒完成。

### Acceptance criteria
0. **T2 Entry Gate 五项全部 APPROVED 后才允许合入任何 ProjectEvent 写入点 PR**；
1. 任一测试项目：阶段推进/结果/成本动作在 Ledger 各生成**恰好一条**权威事件（幂等重放不重复；无第二事实源并行记录同一业务事实）；
2. 工作台成本卡显示 Labor/External/AI 三分项，AI 分项与 `AiUsageLedger` 对得上；
3. 归档项 hash 可验证、重复上传同文件不产生新 blob；
4. Timeline/Cost/People 三视图同源（改一处事件三视图同步变化）；
5. 若启用双写：对账脚本零差异，且退出条件已排期。

---

## 4. T3 — Corporate Memory

**目标**：历史项目自动沉淀；Fingerprint + Similar Tender 检索质变。

### Scope（按架构文档 §6.4 三级冻结口径）
- **LEVEL 1 初始核心持久化：`MemoryClaim` + `Buyer` 两表**（架构已批准；建表 migration 仍单独批准）；
- **持久化 Design Gate（T3 开始前定夺，物化未预批）**：`TenderFingerprint`（Option A derived projection vs Option B materialized table）；`ProjectMemorySnapshot`（默认 derived memory view，仅当 reproducibility / version pinning / audit replay / 训练集冻结需求证实后物化）；
- Buyer 归一化 job（历史 `clientOrganization` → 候选映射 → 低置信人批）；
- Fingerprint 构建（确认 facts/requirements 驱动，形态按 Gate 结论）+ pgvector 向量化（tender 内容首次入向量）+ **HNSW 索引**；
- 混合相似匹配替换 `similarity.ts` Jaccard 写入器（保留 `ProjectSimilarity` 表）；
- 向量能力 **REUSE FIRST**：激活 `ProjectInsight.embedding` 死字段（Json→vector）；**不默认新建** MemoryEmbedding/TenderEmbedding 等第二套向量存储；Review/tenderStatus 词表对齐；
- Memory Consolidation 手动触发版（关闭项目 → derived memory view + claims + 复盘草稿；snapshot 物化按 Gate）。

### Dependencies：T2（archive/event 底座 + 确认流数据质量）；两项 LEVEL 3 Design Gate 在 T3 启动前完成。
### Schema impact：**2 张核心新表（MemoryClaim、Buyer）** + vector 列与 HNSW 索引（pgvector migration 需在 Neon 分支演练）；TenderFingerprint / ProjectMemorySnapshot **物化未批准**（视 Gate 结论可能为 0–2 张追加表）。
### Runtime impact：NONE（计算走现有 API/cron 形态；不新建队列——在 T5 之前，fingerprint/claims 计算挂现有请求驱动 + tender-auto-analysis 后处理步骤，不加第二 cron）。

### Risk
- Buyer 合并错误污染全链 → 低置信合并强制人批 + 可回滚（claim supersede）；
- 向量回填全量成本 → 分批 + `AiUsageLedger` 记账；
- HNSW 对既有六个无索引 vector 列的连带（顺手补销售域索引与否单独决策，避免 scope 蔓延）。

### Acceptance criteria
1. 新建测试 tender 能在 ≤N 秒内返回 top-5 相似历史项目，且每条带 matchReasons+evidence；
2. 任一 AI 结论在 UI 呈现 CONFIRMED/SUPPORTED/INFERRED/UNKNOWN 徽标且可点开证据；
3. 关闭一个项目后，项目记忆（derived memory view；若 Gate 批准物化则为 snapshot）与 claims 自动生成、复盘确认后进入 org 检索；
4. 同名 buyer 变体（"City of Richmond"/"Richmond (City)"）归一后指向同一 Buyer。

---

## 5. T4 — Tender Intelligence

**目标**：情报 tab 从"当前文件分析"升级为七域决策系统。

### Scope
- `AwardRecord` 表（**§6.4 LEVEL 2 域表定位：属 T4 Intelligence，不是 T3 Memory MVP 必建表**；服务 Historical Award / Buyer Procurement History / Procurement Cycle / Competitor Win Analysis / Pricing Intelligence）+ 我方历史回灌（每个已结 tender 一条 award 事实）+ 人工/存量档案录入通道（**无爬虫**）；
- 情报 tab 七域装配：Historical Awards / Comparable / Buyer Pattern / Procurement Cycle / Competitor / Supply Chain（Trade customs_hint 只读引用）/ Pricing（Estimated Market Range / Suggested Bid Range，带来源与置信度）；
- 组织级情报中心改造（`/projects/intelligence` 承接被删 stub 的六个 section）；
- 公开证据 vs AI inference 的 UI 强制分离（claim status 驱动）。

### Dependencies：T3（Buyer/Claims；Fingerprint 按其 Design Gate 形态）。
### Schema impact：1 新表（AwardRecord）+ ProjectSimilarity 明细字段。
### Runtime impact：NONE。
### Risk：外部 award 数据合规边界（只允许公开公告/人工/既有档案，爬取留 T5 且需授权）；小样本下周期/价格推断过拟合 → 置信度阈值 + UNKNOWN 兜底展示。

### Acceptance criteria
1. 打开任一新 tender 的情报 tab，能回答任务书十问中至少 8 问（其余显示 UNKNOWN 而非空白/编造）；
2. 每个数字（历史价、区间、周期）可点开到 AwardRecord/档案证据；
3. 我方全部历史已结项目在 AwardRecord 可查。

---

## 6. T5 — Automation + Learning Loop

**目标**：员工正常工作、企业记忆自动形成；新标自动调用历史经验。

### Hard Dependencies（T5 启动前全部满足，缺一不得开工）

```
WORKFORCE_RUNTIME_PRODUCTION_READY      ← 适合生产自动化（Phase 2 correctness 收口）
DETERMINISTIC_PLAN_INJECTION            = AVAILABLE / APPROVED DESIGN
                                          （T5 HARD DEPENDENCY；由 Workforce Runtime Owner Design Gate 产出，
                                           在 Phase 2 稳定后、T5 前完成；本路线图不预设其 API/函数/持久化实现）
TASK_CONTRACT_STABLE                    ← workforce-task/v1 或其后继
WORKER_REGISTRY_STABLE
HANDOFF_STABLE                          ← workforce-handoff/v1 或其后继
APPROVAL_SCOPE_POLICY_INTEGRATED        ← Deterministic Plan 不绕过任何审批/Scope/Policy 语义
T2_T4_DATA_FOUNDATION_READY
```

**永久禁令**：T5 不允许创建 `TenderQueue` / `TenderWorkerRuntime` / `TenderJobEngine` / `TenderPipelineExecutor` / 第二套 Scheduler / 第二套 Background Runtime——Deterministic Plan 不可用时的正确动作是**等待/推动 Runtime Owner Gate**，而不是绕道自建。

### Scope
- **Workforce 集成（经 Runtime Owner Design Gate 后实施）**：
  - tender 工具注册进 V2 工具目录与执行适配层（架构文档 §13 映射表的 10 个 task 合同）；
  - Workforce Job 生产入口面（领域服务触发 + flag/allowlist 配置；现状 `createWorkforceJob` 无生产调用方）；
  - **Server-authored Deterministic Plan Injection**（按 Runtime Owner Gate 批准的设计接入；概念定义见架构文档 §12.3——只改变 Task DAG 来源，不绕过任何执行安全语义）；
- 事件→Job 链全通（tender.created→archive→extract→fingerprint→memory→intelligence；submitted→watch_award；award.found→outcome；closed→consolidate）；
- Award Watch（合规源轮询 + 人批入库）；Outcome 自动回填 + Win/Loss 草稿；Memory Consolidation 自动化；
- 源捕获自动化（Firecrawl 复用，HTML/PDF/screenshot 快照落 Archive）；邮件入站（外部前置能力，独立评估）；
- **tender-auto-analysis CONVERGENCE DECISION**（目标不是立即删除）：逐能力回答——哪些迁移为 Workforce Task、哪些保留为 deterministic domain service（去队列语义）、哪些 queue 语义退役、哪些包成 Workforce Task adapter；任何迁移前置 **behavior parity + rollback + 历史数据兼容**。

### Dependencies：上述 Hard Dependencies 全绿（Phase 2 全并 + Runtime Owner Gate + T2–T4 数据面）。
### Schema impact：预期 NONE（Workforce 冻结架构零新表；如 deterministic plan 需列级支持，与 runtime 团队共同提案）。
### Runtime impact：**有，且是唯一有 runtime impact 的阶段**——全部经正式评审进入 runtime 边界内文件。
### Risk：与 runtime 演进节奏耦合（2C-3/2C-4 未完时人工介入语义可能变化）；自动抓取合规边界；LLM 计划路径与确定性路径的行为差异需要金样例（复用 `scripts/e2e-workforce-golden.ts` 模式）。

### Acceptance criteria
1. 新 tender 从创建到情报装配全程零人工触发，仅在三类人工节点（低置信/财务/战略）产生 Needs You；
2. 全部自动任务在 2D-1 Job Center 可见（businessRef `tender:{id}` 生效）且可 kill/resume；
3. 一个项目关闭后 24h 内记忆自动沉淀完成；
4. 全库不存在第二套新建队列（tender-auto-analysis 收敛决策已执行并记录）。

---

## 7. Phase 2 合并后的第一批代码从哪里开始（问题 O 的回答）

顺序执行：

1. **T1-PR1（诚实与安全修复）**——不等任何人：conversations/ai-activity 补门、execute/cancel 权限、死路由、断链。最小 diff、零冲突、立刻兑现价值；
2. **T1-PR2（导航收敛）**——在 #87 合并、rebase 之后动 registry/i18n；
3. **T1-PR3（5-tab 重构，flag 灰度）**；
4. 并行准备 **T2-PR0（T2 Entry Gate 材料：9 套存量存储判决定稿 + 双写/幂等/迁移方案）** 与 **T2-PR1（ProjectEvent 表提案 + migration 评审）**——**任何 ProjectEvent 写入点实现必须等 T2 Entry Gate 全过**；T1-PR3 合并后接投影。

---

## 8. Blocker / 技术债登记（本轮发现，全部不修）

| # | 项 | 级别 |
|---|---|---|
| B1 | `/projects/[id]/conversations` 无权限门（token/cost 泄露面） | P0（T1-PR1） |
| B2 | AgentTask execute/cancel 无 canManage；step 原始 JSON 全员可见 | P0（T1-PR1/PR4） |
| B3 | runtime 活动事件仅客户端过滤，服务端全量下发 | P1 |
| B4 | `?tab=` 深链失效 + 单测假绿（断言字符串不测行为） | P1 |
| B5 | tender AI 花费不入 `AiUsageLedger`（org 成本报表盲区） | P1（T2） |
| B6 | `listProjectActivity` includeSystemEvents 全量内存分页 | P1（T2 换 Ledger 时一并解决） |
| B7 | 结果备注追加进 `Project.description`（不可结构化回收） | P1（T2） |
| B8 | checklist 伪装 ProjectDocument（`internal://bid-checklist`） | P1（T2） |
| B9 | `TenderAnalysisSourceRef.documentId` 无 FK（证据可孤儿化）；`ProjectQuestion.emailId` 同类 | P1（T2） |
| B10 | 两套 PDF 解析管线并行（page-parse vs parse-content，后者不写 hash） | P2（T2 退役旧线） |
| B11 | `TenderExtractedRequirement` 零下游读者 + projection 死字段 + requirementFingerprint 算而不存 | P2（T3 激活） |
| B12 | 六个 vector 列零 ANN 索引（现有销售/知识检索全表扫） | P2（T3 顺带决策） |
| B13 | `AiCapabilityRegistry.embedding()` 抛"尚未接入"但 embedding.ts 在用（抽象与实现脱节） | P2 |
| B14 | Outcome 三套词表 / 5 状态字段漂移 | P1（T2 词表收敛） |
| B15 | tender-auto-analysis = 既有第二套队列（`TENDER_SECOND_QUEUE_DEBT`） | 架构债（**T5 CONVERGENCE DECISION**：逐能力迁移/保留/退役/adapter 化，前置 parity+rollback+历史兼容） |
| B16 | Workforce 无生产入口 + 无 deterministic plan 路径 | 架构缺口（**Deterministic Plan Injection = T5 HARD DEPENDENCY**；由 Workforce Runtime Owner Design Gate 在 Phase 2 稳定后、T5 前专项设计；不可用时禁止以第二套 runtime 变通） |
| B17 | 邮件入站未实现（email.received / 供应商报价自动摄取的外部前置） | 能力缺口（T5 前置） |
| B18 | 静默自动触发 AI 生成（auto-ai-panels-runner，成本不可见） | P2（T5 显式 Job 化） |

---

*T0 至此完成。按任务书 §25：STOP，等待人工 Final Review 后再启动 T1。*
