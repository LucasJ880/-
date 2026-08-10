# Qingyan Tender T0 — UX Consolidation Audit（UX 整合审计）

| 项 | 值 |
|---|---|
| 基线 | `main @ abac67e`（含 PR #85 / Workforce 2B-1；等同 origin/main tip） |
| 分支 | `design/tender-t0-memory-intelligence`（docs-only） |
| 日期 | 2026-08-10 |
| 性质 | **READ-ONLY AUDIT + 设计**；未改任何生产代码 / Schema / 导航；未运行写路径 |
| 方法 | 全量代码走读（routes / components / API / Prisma / navigation），不凭文件名判断；所有结论带 file:line 证据 |
| 姊妹文档 | `QINGYAN_TENDER_T0_MEMORY_INTELLIGENCE_ARCHITECTURE.md`（数据/自动化架构）、`QINGYAN_TENDER_T0_IMPLEMENTATION_ROADMAP.md`（T1–T5） |
| 修订 | 2026-08-10 Final Architecture Micro-Fix：本文档仅做跨文档一致性核对，**审计数字（30 路由 / 47 页面+Tab / 13 组重复 / 9 套历史存储 / 18 项债 / 5-Tab IA）与全部 Decision 不变**；T2/T3/T5 引用处的最新口径（T2 Entry Gate、记忆模型三级、T5 硬依赖）以两份姊妹文档为准 |

---

## 1. Executive Summary

**核心判断：Tender 的 UX 问题不是"业务页面太多"，而是"结构错位 + 页内重复 + 平台内幕外溢"。**

实测数字（§2 逐项清点）：

| 维度 | 数字 |
|---|---|
| Tender 流相关路由总数 | **30 条**（另有 2 条 404 死路由） |
| 展开 tab 后用户可见页面/Tab 总数 | **47 个** |
| 业务用户真正的主战场 | **`/projects/[id]` 的 4 个 tab + 调查室（内含 7-tab 分析面板）** |
| AI 平台管理面路由（agents/prompts/tools/KB/conversations/feedbacks/feedback-tags） | **15 条（占路由 50%），全部无 UI 入口，仅 URL 直达** |
| 侧栏一级入口指向 stub 占位页 | **6 个**（周期采购/历史中标/竞争对手/采购机构/供应链/情报监控） |
| 同一项目页内的 AI 摘要面 | **4 个**（互不引用） |
| 审批/确认机制 | **4 套**（PendingAction、ApprovalRequest、Capabilities 投影、tender-analysis 自制 confirm） |
| 历史/活动类存储 | **9 套**（详见姊妹架构文档） |

结论：

1. **删的重点不是业务页面**，而是：死路由、stub 占位入口、页内重复卡片、双份导航、假链接/死锚点。
2. **藏的重点**是 15 条 AI 平台管理路由与运行时内幕（step 原始 JSON、execute/cancel 按钮、runtime 事件），全部转 INTERNAL_ONLY 并补齐权限门（其中 `conversations` 目前**无权限门**，属安全缺口）。
3. **合的重点**是把 `概览 + 文件 + 报价 + 工作台 + intelligence-room` 的内容重排进目标 5 个一级 tab（工作台 / 招标要求 / 标书与报价 / 情报 / 提交），文件降级为贯穿式资料抽屉，审批接入统一审批中心 + 工作台 Needs You。
4. 任务书的目标五页结构**适配现有代码，可行**（§5），但有若干与任务书假设不一致的现实（§8 ASSUMPTION_INVALID）。

---

## 2. CURRENT TENDER UX INVENTORY

图例（Decision）：`KEEP` 保留 / `MERGE` 合并 / `DELETE` 删除 / `HIDE` 隐藏 / `EMBED` 内嵌 / `DRAWER` 抽屉 / `MODAL` 弹窗 / `SECONDARY` 二级视图 / `INTERNAL_ONLY` 仅内部 / `REFACTOR_LATER` 后续重构。

### 2.1 `/projects/[id]` 主页面（`src/app/(main)/projects/[id]/page.tsx`，932 行客户端组件）

Tab 结构：仅 4 个 tab（`page.tsx:558-581`），状态存 `sessionStorage[qy_proj_tab_${id}]`（`page.tsx:207-216`）；**`?tab=` 参数从不读取**（只读 `activity`，`page.tsx:175`）→ 站内所有 `?tab=` 深链失效（见 §3-9）。

#### 2.1.1 全 tab 常驻区（chrome）

| 区块 | 组件 | 用途 | 数据源 | 写操作 | Decision |
|---|---|---|---|---|---|
| 项目头（名称/关键日期/距截标/统计 tile） | `project-detail-header.tsx` | 头部 | `/api/projects/[id]` | 否 | KEEP（但"文档" tile 链到 `/knowledge-bases` 平台面，`project-detail-header.tsx:117` → **改链到资料抽屉**） |
| 文件夹导入进度条 | `project-import-banner.tsx` | 建项后批量传文件 | `POST .../files`、`.../files/process-next` | 是 | KEEP（EMBED 进工作台任务区） |
| 隐形自动触发器 | `auto-ai-panels-runner.tsx`（渲染 null） | 静默自动生成进展摘要+清单 | `POST .../progress-summary`、`.../checklist` | **是（静默）** | REFACTOR_LATER（T5 应改为显式后台 Job，避免"打开页面才触发"） |
| 放弃/已交接 banner、转执行/放弃按钮 + 两个 Dialog | inline + `handoff-dialog.tsx`、`abandon-project-dialog.tsx` | 生命周期终态操作 | `.../handoff/*`、`.../abandon` | 是 | KEEP → **移入"提交"tab 的 Outcome 区**（MODAL 保留） |
| 项目成员表 + 加人/职责/移除 | inline `page.tsx:809-884` | 成员管理 | `.../members*` | 是 | KEEP → EMBED 工作台"团队"卡（编辑走 MODAL） |
| 成员加入简报 | `project-join-briefs.tsx` | 新成员简报 | `.../join-brief` | 是 | MERGE 进工作台"团队"卡 |
| 项目通知规则 | `project-notification-rule-card.tsx` | 关注规则 | `.../notification-rule` | 是 | DRAWER（设置类，不占一级面积） |
| 右栏「青砚·项目上下文」 | `project-context-panel.tsx:315` | 决策摘要/待确认/活动 | 派生 + `/api/ai/pending-actions?status=pending` | 否 | MERGE → 其内容就是"工作台"tab 的雏形（见 §5） |

#### 2.1.2 Tab「概览」（`page.tsx:584-721`）

| 区块 | 组件 | 数据源 | 写操作 | 与谁重复 | Decision |
|---|---|---|---|---|---|
| 项目决策摘要 | `ProjectCommandOverview`（`project-context-panel.tsx:215`) | 派生 | 否 | 右栏上下文面板同源 | MERGE → 工作台首屏 |
| 新项目引导 | `project-onboarding-guide.tsx` | props | 否 | — | KEEP（工作台空态） |
| AI 项目摘要 | `project-ai-summary-card.tsx` | `.../ai-summary`（`ProjectIntelligence.structuredSummaryJson`） | 是 | **4 个 AI 摘要面之一** | MERGE → 工作台"AI 简报"单卡 |
| 项目结论 / Insight | `project-insights-panel.tsx` | `.../insights`（`ProjectInsight`） | 是 | 与复盘卡联动 | EMBED 工作台"决策与结论"卡 |
| 历史相似项目经验 | `project-history-experience-card.tsx` | `.../similarities`（`ProjectSimilarity`） | 是 | 情报域 | **EMBED → 情报 tab（摘要留工作台）** |
| 项目复盘 | `project-review-card.tsx` | `.../reviews`（`ProjectReview`） | 是 | 结果/记忆域 | **EMBED → 提交 tab Outcome 区** |
| 企业规则 | `project-org-rules-card.tsx` | `.../org-rules` | 是 | `/projects/intelligence` 企业规则 tab | EMBED 情报 tab（同一数据两入口，保留一处编辑权） |
| 投标调查启动 + GO/HOLD/NO_GO | `start-intelligence-panel.tsx` | `.../bid-intelligence/start`、`/go-decision` | 是 | **与 intelligence-room 内完全重复**（`intelligence-room-client.tsx:221`） | MERGE：保留一处（工作台"阶段与决定"卡），调查室内删除 |
| AI 情报分析（BidToGo 卡：建议/风险/契合分 + Markdown 报告 + 人工复核） | `bidtogo/intelligence-card.tsx`（685 行） | `ProjectIntelligence` + review/regenerate | 是 | 4 个 AI 摘要面之一 | MERGE → 情报 tab"当前项目情报"主卡（复核流保留） |
| 项目进度（通用任务 vs 时间） | inline `page.tsx:656-669` | `.../overview` | 否 | **与下一行同名同页** | DELETE（保留招投标专用进度） |
| 招投标进度（阶段 stepper + 关键日期 + 时间轴） | `tender/project-progress-section.tsx` + `project-key-dates.tsx` | Project 日期字段派生 | 是（关键日期） | 同上 | KEEP → 工作台"阶段"卡（时间轴 DRAWER 展开） |
| 项目讨论 | `project-discussion-section.tsx` | `.../discussion*`（`ProjectConversation/ProjectMessage`） | 是 | — | KEEP → 工作台右栏/抽屉（贯穿） |
| 项目动态 | inline + `activity-timeline.tsx` | `.../activity?includeSystemEvents=true`（AuditLog+SYSTEM 消息） | 否 | 9 套历史存储之一 | KEEP → 工作台"最近活动"卡（T2 改读 Ledger 投影；runtime 事件改服务端过滤，见 §7-3） |

#### 2.1.3 Tab「文件」（`page.tsx:724-731`）

| 区块 | 组件 | 数据源 | 写操作 | Decision |
|---|---|---|---|---|
| 项目文件管理器（上传/外链/AI 摘要/重试解析/截止时间编辑） | `project-file-manager.tsx`（1013 行） | `.../files*`、`PATCH /api/projects/[id]` | 是 | **DRAWER/SECONDARY**：文件是"项目资源"，从工作台/招标要求/提交内任意处呼出，不再占一级 tab |
| 招标文件分析进度条 → `intelligence-room#tender-analysis` | `analysis-progress-banner.tsx`（挂在文件管理器内 `:426`） | `.../tender-analysis/runs?latest=1`（4s 轮询） | 否 | EMBED → 招标要求 tab 顶部（分析状态属于"要求"域） |
| AI 项目进展摘要 + 管理层摘要 | `project-progress-summary.tsx` | `.../progress-summary`（`ProjectProgressSummary`） | 是 | MERGE → 工作台"AI 简报"（4 摘要面之一；放在文件 tab 本身就是错位） |
| 投标清单 BidChecklist | `bid-checklist.tsx` | `.../checklist`（**伪装成 ProjectDocument 的 JSON**，`checklist/route.ts:56`） | 是 | EMBED → 提交 tab"提交就绪"区（数据层 T2 摘除伪文档存储） |
| 项目 AI 记忆 | `project-ai-memory.tsx` | `.../memory`（**无表，30 天 AuditLog+Email+Question+InquiryItem 读时聚合**，`src/lib/ai/memory.ts:5`） | 否 | DELETE（名不副实；工作台"最近活动"已覆盖；真记忆见架构文档 L3） |

#### 2.1.4 Tab「报价」（`page.tsx:734-760`）

| 区块 | 组件 | 数据源 | 写操作 | Decision |
|---|---|---|---|---|
| 供应商询价（轮次/录报价/邮件草稿/比价） | `inquiry/*` 5 组件 | `.../inquiries*`（`ProjectInquiry/InquiryItem`） | 是（含发邮件） | KEEP → 标书与报价 tab"成本与询价"区 |
| 项目报价列表 → 编辑器 | `quote/project-quote-section.tsx` → `/projects/[id]/quotes/[quoteId]` | `.../quotes*`（`ProjectQuote` 版本化） | 是 | KEEP → 标书与报价 tab 主区；**版本历史 = DRAWER**（`ProjectQuote.version` 已存在，只缺 UI 呈现方式） |
| 向业主提问（澄清邮件） | `project-question-dialog.tsx` | `.../questions*` + Gmail | 是（外发） | MOVE → 招标要求 tab"澄清"区（MODAL 保留；与 `TenderClarificationQuestion` 断链问题见 §3-7） |

#### 2.1.5 Tab「工作台」（现名，实为 AI 工具箱；`page.tsx:763-806`）

| 区块 | 组件 | 数据源 | 写操作 | Decision |
|---|---|---|---|---|
| 一键生成文档 | `project-generate-menu.tsx` | `.../generate-pdf`（`ProjectGeneratedDocument` 版本化） | 是 | EMBED → 标书与报价 tab"标书文档"区（生成物即标书组成部分） |
| 项目 AI 对话 | `project-ai-chat.tsx`（718 行） | `/api/ai/threads*` | 是 | KEEP → 贯穿式"问青砚"入口（头部按钮/抽屉），不占 tab |
| 「分析投标文件」跳转块 | inline `page.tsx:772-797` | — | 否 | DELETE（锚点是坏的，见 §3-9；由招标要求 tab 直达取代） |
| AI 一键投标方案（多步 skill 流水） | `agent-tasks/ai-bid-package.tsx`（598 行） | `.../ai-bid-package*`（`AgentTask` 旧运行时） | 是 | HIDE → INTERNAL_ONLY（旧 AgentTask 运行时产物；能力由招标要求/报价内嵌 AI 取代；T5 若保留则迁 Workforce） |
| AI 任务（模板/专家角色/步骤时间线/逐步审批/原始 JSON） | `project-agent-tasks.tsx` + 11 个子组件 | `/api/agent/tasks*`（`AgentTask/AgentTaskStep/ApprovalRequest`） | 是 | HIDE → INTERNAL_ONLY（运行时内幕外溢主源：step 原始 inputJson/outputJson `step-detail-panel.tsx:26-27,105-139`、无权限门的 execute/cancel `project-agent-tasks.tsx:127,132`） |

### 2.2 `/projects/[id]/intelligence-room`（调查室，RSC + `intelligence-room-client.tsx`）

| 区块 | 数据源 | 写操作 | Decision |
|---|---|---|---|
| StartIntelligencePanel（第二份） | 同 2.1.2 | 是 | DELETE（重复实例） |
| 「30 秒看懂项目」11 格 | `BidIntelligenceRoom.summaryJson` | 否 | MERGE → 工作台首屏简报（4 摘要面之一） |
| 八个调查模块 | `BidIntelligenceModule.dataJson` | 否 | EMBED → 情报 tab"调查模块"区 |
| 事实来源与可信度（手工录入 fact + confidence） | `BidIntelligenceFact` | 是 | EMBED → 情报 tab"事实与证据"区（数据层与 TenderAnalysisFact 合流见架构文档） |
| 中国供应商简报 | `china-supplier-brief-panel.tsx`（服务端脱敏引擎） | 是 | EMBED → 标书与报价 tab 询价区 |
| TenderAnalysisPanel（7 内部 tab：中文分析/Requirement/风险/澄清/交付物/任务/来源） | `TenderAnalysisRun` 家族 | 是（confirm/reject/apply） | **拆分归位**：Requirement+来源+澄清+风险 → 招标要求 tab；交付物+任务 → 提交 tab；中文分析 → 招标要求"解读"区 |
| 主 AI 对话链接 | `?tab=ai` 深链（死链） | 否 | DELETE |

**调查室路由本身：MERGE 后删除**（内容全部归位 5 tab；过渡期可 301 到 `/projects/[id]`）。

### 2.3 `/projects/[id]/*` AI 平台子路由（15 条）

| 路由 | 权限门 | 真实用途 | Decision |
|---|---|---|---|
| `agents`、`agents/[agentId]` | `PlatformAdminGate` | LLM agent 注册/配置/发布 | INTERNAL_ONLY（保持；从业务导航彻底摘除） |
| `knowledge-bases` 全家（4 条） | `PlatformAdminGate` | agent RAG 知识库版本管理 | INTERNAL_ONLY；**摘掉 header"文档" tile 的入口**（`project-detail-header.tsx:117`） |
| `prompts` 全家（3 条） | `PlatformAdminGate` | prompt 模板/版本/发布 | INTERNAL_ONLY |
| `tools`、`tools/[toolId]` | `PlatformAdminGate` | function-calling 工具注册 | INTERNAL_ONLY |
| `feedbacks`、`feedback-tags` | `PlatformAdminGate` | AI 反馈分诊/标签 | INTERNAL_ONLY |
| `conversations`、`conversations/[conversationId]` | **索引页无门**（详情页仅 admin tab 有门，`[conversationId]/page.tsx:406-415,442`） | AI 会话日志（含 token/cost 列，`conversations/page.tsx:31-33`） | INTERNAL_ONLY + **补 PlatformAdminGate（安全修复，T1 第一批）** |

### 2.4 周边 Tender 面

| 路由 | 真实内容 | 写操作 | Decision |
|---|---|---|---|
| `/bids`（招投标中心） | **15 行壳**：5 张硬编码链接卡（2 张同指 `/projects`，`bids-workspace-shell.tsx:17-43`）+ 最近 6 个项目；自述"未迁移"（`:80-83`） | 否 | DELETE（侧栏入口 `ws-bids` 与 `/operations/center` 卡改指 `/projects`；若保留品牌落地页则为 redirect） |
| `/projects`（项目列表） | 真列表：bid-phase chip、GO chip、截标倒计时、阻塞摘要、筛选 | 是（建项） | KEEP（Tender 一级入口） |
| 新建项目 Modal + 文件夹导入 | `projects/page.tsx:110-438` + `folder-import-zone.tsx`；**无 import-from-URL** | 是 | KEEP（URL 导入是 T2 Archive 的事，本轮不加） |
| `/projects/intelligence` | 「进行中的调查室」+ 5 tab 组织智能（企业规则/供应商表现/价格趋势/客户竞争/批量对比）两页拼一页 | 是（规则确认） | KEEP → 重构为**组织级情报中心**（T4 承载 Historical Award 等；本轮只登记） |
| `/projects/intelligence/{series,awards,competitors,agencies,supply-chain,monitor}` | **6 个 stub**（`IntelHubShell notEnabled`），却各占一条侧栏一级行 + hub 内 pill | 否 | DELETE 独立路由与侧栏行（T4 作为情报中心内的 section 复活；避免"很多入口点进去是空的"的观感） |
| `IntelHubShell` 内嵌第二份导航 | `intel-hub-shell.tsx:6-14` 与 registry 各存 7 条、文案不一致 | 否 | DELETE（导航单一来源 = registry） |
| 管理总览 `/`（AI 建议、自动巡检、放弃项目统计、快速查看抽屉） | dashboard 组件群 | 部分 | KEEP（跨项目层；Needs You 缺审批数据的问题见 §7-6） |
| `/notifications`、`/tasks`、`/inbox`、`/assistant` | 通知/工作队列/AI 建议收件箱（含**改 tender 阶段、建询价的建议卡**）/数字员工 | 是 | KEEP（跨项目层；阶段推进等写路径统一收敛到审批语义是 T2+ 议题） |
| `/capabilities/approvals` | 统一审批中心（8 tab；`projectId` 只显示裸 id，`[approvalId]/page.tsx:139`） | 是 | KEEP（Tender 审批的目标归宿；显示项目名是小改进） |
| `/admin/project-intake` | 平台管理员分发队列 | 是 | KEEP（INTERNAL/平台域） |
| `/ops/projects`、`/ops/projects/[id]` | 中标交接后的执行项目 | 是 | KEEP（delivery 域，非本轮范围） |
| `/projects/[id]/quotes`（无 page.tsx） | **404 死路由** | — | DELETE |
| `/projects/[id]/quality`（仅孤儿 layout） | **404 死路由** | — | DELETE |

### 2.5 导航现状（desktop / mobile）

- 桌面侧栏由 `src/lib/navigation/registry.ts` 单一驱动（`sidebar.tsx:334`）；Tender 相关：`ws-bids`(/bids)、`nav-projects`(/projects)、`nav-project-intel` + 6 个 stub 行、`nav-suppliers`、`cap-approvals`、`plat-intake`。
- 移动端：`mobile-tab-bar.tsx` 招投标 tab（`:245-251,274-281`）；`mobile-nav-drawer.tsx` 二级钻取，registry 驱动（`:151-154`）；sales 角色硬编码 4-tab，无 tender 入口。
- 角色可见性：`operations` 角色被隐藏全部 tender 入口（`nav-role-policy.ts:74-83`）。
- **注意**：PR #87（2D-1）将在 registry WORK 组插入 `work-ai-jobs`（+12 行）并动 `i18n` 三文件 → 本轮任何导航改动都禁止（见冲突矩阵，架构文档 §13）。

---

## 3. DUPLICATION MATRIX（重复功能矩阵）

任务书点名的组合逐一验证，另加代码实测新增项。**结论列**：`REAL` 确认重复 / `PARTIAL` 部分重复 / `NOT_DUP` 不构成重复。

| # | 组合 | 结论 | 证据与判定 |
|---|---|---|---|
| 1 | Requirement ↔ Evidence | **NOT_DUP（关系正确，但 Requirement 自身 4 份表示）** | Evidence 已是 Requirement 的子证据链：`TenderAnalysisSourceRef`（`schema.prisma:2411`，多态挂 fact/section/requirement/clarification/deliverable）。真正的重复是 Requirement 存在 4 种表示：`TenderExtractedRequirement` 行、`TenderAnalysisSection[MANDATORY_REQUIREMENTS]` 文本、`BidIntelligenceModule.dataJson` 投影 top-20（`project-room.ts:117`）、checklist 伪文档 JSON。且 `TenderExtractedRequirement` **在模块外零读者**。 |
| 2 | Files ↔ Documents | **PARTIAL** | 单一 `ProjectDocument` 模型，但被三重滥用：投标清单伪装成文档（`url="internal://bid-checklist"`，`checklist/route.ts:56`）；生成 PDF 双写 `ProjectGeneratedDocument`+镜像 `ProjectDocument` 行（`generate-docs.ts:308,324`）无回链；KB 文档（`KnowledgeDocument`）是 agent 配置域、与项目文件无关但 header 入口混淆。 |
| 3 | AI Analysis ↔ Tender Analysis | **REAL** | 两套分析系统并行：`BidIntelligenceRoom/Module/Fact`（Phase 1）与 `TenderAnalysisRun` 家族（Phase 1.1），靠 `project-room.ts` 单向有损投影缝合；页面上 4 个 AI 摘要面（AI 项目摘要 / 进展摘要 / 30 秒看懂 / BidToGo 情报卡）互不引用。 |
| 4 | Activity ↔ Timeline | **PARTIAL（同名不同物，但历史存储共 9 套）** | 「项目动态」= AuditLog+SYSTEM 消息合并流（`activity/query.ts:35`，includeSystemEvents 时**全量取回内存切片** `:65-66,105`）；「项目时间轴」= Project 日期列纯投影（`tender/timeline.ts:14`，不读任何日志表）。二者不重复，但同一阶段推进会**双写** AuditLog + ProjectMessage(SYSTEM)（`stage-transition.ts:16-17`）。 |
| 5 | Approval ↔ Technical Approval | **REAL（4 套机制）** | `PendingAction`（AI 动作）、`ApprovalRequest`（旧 AgentTask 步骤）、Capabilities 三源投影+决策网关、tender-analysis **自制 confirm**（facts/requirements/change-candidates/run-approve 直接 `db.update`+AuditLog，绕过前三者，auth 走 `requireTenderAnalysisWrite` 而非审批策略）。两层统一层（`approval/port.ts` 与 `capabilities/approvals/*`）也彼此重叠。 |
| 6 | Revision ↔ Version | **NOT_DUP（版本机制存在但分散、无统一 UI）** | `ProjectQuote.version`（每版新行）、`ProjectGeneratedDocument.version+stale`、`KnowledgeDocumentVersion`（agent 域）、`TenderAnalysisRun` supersession（`supersedesRunId`）。旧 Bid Data Revision 树在应用层不存在（幽灵层，见 8/3 审计）。缺的是"当前标书的 Version History Drawer"这一呈现层。 |
| 7 | Project Discussion ↔ Tender Notes | **PARTIAL** | 讨论 = `ProjectConversation/ProjectMessage`；但"备注"散落三处：招标结果备注**追加进 `Project.description` 文本**（`tender-result.ts:60-68`）、GO 决定 note 存 `BidIntelligenceRoom.goDecisionNote`、放弃原因存 `abandonedReason`。 |
| 8 | Agent Timeline ↔ Tender Timeline | **NOT_DUP（应隐藏前者）** | AgentTask 步骤时间线是运行时内幕（HIDE），Tender 时间轴是业务里程碑投影（KEEP）。 |
| 9 | `?tab=` 深链 ↔ 实际路由行为 | **REAL（断链）** | `projectAiTabHref()` 等生成 `?tab=ai`（`display-labels.ts:48-52`），页面从不读 `?tab`；单测只断言字符串未测行为（`bid-workflow-phase1.test.ts:169-170`）。工作台"前往分析"按钮锚点 `#tender-analysis` 在概览 tab 不存在（`page.tsx:779-785`）。 |
| 10 | StartIntelligencePanel ×2 | **REAL** | 同一项目在概览与调查室各渲染一份同功能面板（`page.tsx:618` / `intelligence-room-client.tsx:221`）。 |
| 11 | 「项目进度」×2 | **REAL** | 概览 tab 两张同名卡叠放（inline `page.tsx:657-668` 与 `project-progress-section.tsx:84`）。 |
| 12 | `/bids` ↔ `/projects` | **REAL** | `/bids` 是链接壳，5 卡中 2 卡同指 `/projects`；两者各占侧栏一级入口 + 移动 tab 候选。 |
| 13 | 侧栏情报导航 ↔ IntelHubShell pills | **REAL** | 同 7 条入口两份硬编码、文案不一致（`registry.ts:472-551` / `intel-hub-shell.tsx:6-14`）。 |
| 14 | 澄清问题两套模型 | **REAL（数据层）** | `TenderClarificationQuestion`（AI 生成、带证据、不能发送）与 `ProjectQuestion`（能发邮件、无证据），无 FK 无共享键。UI 上前者在分析面板、后者在报价 tab。 |
| 15 | 报价三套 | **NOT_DUP（域不同，登记即可）** | `ProjectQuote`（tender）/`SalesQuote`（B2C）/`TradeQuote`（外贸）。Tender 域内只认 `ProjectQuote`；跨域收敛不在本轮。 |

---

## 4. 建议删除 / 合并 / 隐藏清单

### 4.1 DELETE（T1 可安全删除）

| 对象 | 理由 |
|---|---|
| `/projects/[id]/quotes`（无 page.tsx）、`/projects/[id]/quality`（孤儿 layout） | 404 死路由 |
| `/bids` 路由 + `ws-bids` 侧栏项 + `bids-workspace-shell.tsx` | 自认未迁移的链接壳；入口改指 `/projects` |
| 6 个情报 stub 路由 + 对应 6 条侧栏行 | `notEnabled` 占位；T4 在情报中心内以 section 复活 |
| `intel-hub-shell.tsx` 硬编码 pill 导航 | 导航双源 |
| 概览 tab 的 inline「项目进度」卡 | 与招投标进度同名重复 |
| 调查室内第二份 `StartIntelligencePanel` | 同功能双实例 |
| 「分析投标文件」跳转块（坏锚点）与 `?tab=` 深链生成函数的死参数 | 断链 |
| 「项目 AI 记忆」卡（`project-ai-memory.tsx`） | 无表读时聚合、名不副实；被工作台活动卡覆盖 |

### 4.2 MERGE（T1 呈现层合并；数据层合并归 T2+）

| 来源 | 目标 |
|---|---|
| 4 个 AI 摘要面（AI 项目摘要 / 进展摘要+管理层摘要 / 30 秒看懂 / BidToGo 情报卡） | 工作台「AI 简报」单卡 + 情报 tab「当前项目情报」主卡（含人工复核流） |
| 概览「决策摘要」+ 右栏上下文面板 | 工作台首屏 |
| 调查室全部内容 | 按域拆入 5 tab（§2.2） |
| TenderAnalysisPanel 7 tab | 招标要求（Requirement/来源/澄清/风险/解读）+ 提交（交付物/任务） |
| 成员表 + 加入简报 | 工作台「团队」卡 |
| 澄清两套（呈现层先合并入口；模型合并见架构文档） | 招标要求「澄清」区 |

### 4.3 HIDE / INTERNAL_ONLY

| 对象 | 动作 |
|---|---|
| `agents/prompts/tools/knowledge-bases/feedbacks/feedback-tags`（13 条） | 保持 PlatformAdminGate；从一切业务入口摘除 |
| `conversations` ×2 | **补权限门（安全修复）** + INTERNAL_ONLY |
| AI 任务面板（AgentTask 全家 UI）、AI 一键投标方案 | INTERNAL_ONLY（运行时内幕 + 旧运行时） |
| 项目动态里的 runtime 事件 | 服务端过滤取代客户端过滤（`page.tsx:266` + `project-context-panel.tsx:71-96`） |
| `/ai-activity`（无门无导航但 URL 可达） | 补 PlatformAdminGate |

---

## 5. 目标 Information Architecture：Tender Detail 五页

**结论：任务书的 5 一级入口结构与现有代码适配良好，确认为目标态。**

```
Tender Detail
├── 1 工作台      ← 概览精华 + 右栏上下文 + 决策/团队/成本/活动
├── 2 招标要求    ← TenderAnalysis(Requirement/来源/澄清/风险/解读) + 分析进度
├── 3 标书与报价  ← ProjectQuote + 询价 + 生成文档 + Version History Drawer
├── 4 情报        ← BidIntelligence 模块/事实 + 相似项目 + 企业规则 + (T4: Award/周期/竞争/供应链/定价)
└── 5 提交        ← 交付物 + 清单 + 提交记录 + Outcome/复盘 + 交接/放弃
贯穿：资料抽屉(文件) · 问青砚(AI 对话) · Needs You(统一审批) · 讨论
```

### 5.1 Tab 1 工作台（操作中心，非简单 Overview）

任务书 §3 要求的信息与现状数据源对照（`✅` 现有 / `T2+` 待架构文档定义的数据）：

| 信息 | 数据源 | 状态 |
|---|---|---|
| 基本信息 / Closing Date / 距截标 | `Project` 字段 + header | ✅ |
| 当前阶段 | `lib/tender/stage.ts` 派生 + stepper | ✅ |
| Owner / Participants | `ProjectMember` + owner/purchaser | ✅ |
| 当前完成度 / 缺失项 | 进度对比 + checklist 缺件 + 未确认 requirement 数 | ✅（分散，需汇总卡） |
| 当前风险 | 分析面板风险 tab + intelligence 风险 | ✅（汇总） |
| 下一步动作 | `ProjectCommandOverview` 推荐 + stage-tasks | ✅ |
| Needs You | `/api/ai/pending-actions` + 待确认 fact/requirement 数 | ✅（拼装） |
| 当前投入成本（Estimated Value / Our Bid / Tender Cost / Cost% / Labor / External / AI+Data） | **无**（全库无人工成本模型；AI 成本在 `AiUsageLedger` 但 tender 不写入） | **T2**（Ledger 成本事件 + AI 账本桥接） |
| 最近活动 | ActivityTimeline | ✅（T2 换 Ledger 投影） |
| 重要项目决策 | GO/HOLD/NO_GO + run approve + 复盘决定（分散） | ✅ 部分（T2 决策事件化） |
| AI 建议 | AI 简报（合并后） | ✅ |
| 历史相似项目摘要 | `ProjectSimilarity` top | ✅（质量 T3 升级） |
| 当前情报摘要 | 情报 tab 主卡摘要 | ✅ |

工作台应能直接回答任务书列的 8 个问题；其中"到现在花了多少钱 / 以前谁中标 / 价格大概多少"三问依赖 T2 Ledger 与 T4 Award 数据，T1 先留结构化占位卡（明示"待启用"，不做假数据）。

### 5.2 Tab 2 招标要求

- Requirement 列表（逐条确认/驳回/责任人/合规状态）= `TenderExtractedRequirement` + confirm 流（现有）。
- 每条 requirement 内联证据（页码+原文片段）= `TenderAnalysisSourceRef`（**Evidence 不再有独立页面，进入 Requirement 内**——现状本就如此，强化为行内展开）。
- 澄清问题（AI 生成 → 转正式 RFI 发送）：合并两套模型入口。
- Addendum 变更（`TenderAnalysisChangeCandidate` apply/reject）。
- 风险与解读（中文分析 section）。
- 顶部：分析运行状态条 + 重新分析。

### 5.3 Tab 3 标书与报价

- 报价主区（`ProjectQuote` 编辑器入口、毛利、内部成本）；**Version History = Drawer**（读 `version` 链）。
- 供应商询价区（轮次、录入报价、比价、中国供应商简报-脱敏）。
- 标书文档区（`ProjectGeneratedDocument` + 一键生成；版本+stale 状态）。
- AI 内嵌：报价草稿/审核（`aiDraftJson/aiReviewJson` 已有）。

### 5.4 Tab 4 情报

- 当前项目情报主卡（合并 BidToGo 卡 + 复核流）。
- 调查模块八宫格 + 事实与证据（confidence 分级）。
- 历史相似项目（含价差、经验）。
- 企业规则（org-rules）。
- T4 扩展位：Historical Awards / Buyer Pattern / 周期采购 / 竞争对手 / 供应链 / 定价区间（对应被删除的 6 个 stub，回归为本 tab 的 section）。

### 5.5 Tab 5 提交

- 交付物清单（`TenderDeliverable` + 状态）+ 投标清单（checklist）= 提交就绪度。
- 提交记录（submittedAt + 未来提交回执/文件清单）。
- Outcome 区：tender-result 录入（won/lost/...）、复盘卡（`ProjectReview`）、转执行/放弃操作。
- T5 扩展位：AWAITING_AWARD / Award Watch / Win-Loss 自动分析（见架构文档 §9-10）。

### 5.6 贯穿机制

| 机制 | 实现要点 |
|---|---|
| 资料抽屉（Files） | `project-file-manager` 移入 Drawer/Secondary，从任意 tab 呼出；上传不打断当前工作流 |
| 问青砚 | `project-ai-chat` 挂头部按钮 → 抽屉 |
| Needs You | 工作台卡 + 全局 `/capabilities/approvals`；tender 自制 confirm 是否投影进审批读模型见架构文档 §13 |
| 讨论 | 右栏/抽屉贯穿 |
| 移动端 | 5 tab 收进现有 mobile drawer 二级；tab-bar 招投标项指向 `/projects`（`/bids` 删除后） |

---

## 6. Current → Future UX Mapping（逐面映射）

| 现状面 | 目标位置 | 机制 |
|---|---|---|
| 概览·决策摘要 / 右栏上下文 | 工作台首屏 | MERGE |
| 概览·AI 项目摘要 + 文件·进展摘要 + 调查室·30秒看懂 + 概览·BidToGo 卡 | 工作台 AI 简报 + 情报主卡 | MERGE |
| 概览·投标调查启动 / GO 决定 | 工作台「阶段与决定」 | MERGE（删一份） |
| 概览·招投标进度 + 关键日期 + 时间轴 | 工作台「阶段」卡（时间轴 DRAWER） | EMBED |
| 概览·历史相似项目 | 情报 tab（摘要留工作台） | EMBED |
| 概览·项目结论 Insight | 工作台「决策与结论」 | EMBED |
| 概览·项目复盘 | 提交 tab Outcome 区 | EMBED |
| 概览·企业规则 | 情报 tab | EMBED |
| 概览·项目讨论 / 项目动态 | 贯穿抽屉 / 工作台活动卡 | KEEP |
| 文件 tab 全部 | 资料抽屉（分析进度条→招标要求；清单→提交；进展摘要→工作台） | DRAWER+拆分 |
| 报价 tab（询价/报价/提问） | 标书与报价（提问→招标要求·澄清） | EMBED |
| 工作台 tab（现 AI 工具箱） | 生成文档→标书与报价；AI 对话→贯穿；AgentTask 面板→INTERNAL_ONLY | 拆分 |
| 调查室整页 | 按域拆入 5 tab，路由删除 | MERGE |
| 分析面板 7 tab | 招标要求 ×5 + 提交 ×2 | EMBED |
| `/bids` | 删除，入口指 `/projects` | DELETE |
| 6 个情报 stub | 情报 tab / 组织情报中心 section（T4） | DELETE→回归 |
| 15 条平台子路由 | INTERNAL_ONLY（conversations 补门） | HIDE |
| 成员/简报/通知规则 | 工作台团队卡 + 设置抽屉 | EMBED/DRAWER |
| 转执行 / 放弃 | 提交 tab Outcome 区 | MODAL 保留 |

---

## 7. 本轮登记的 UX 级技术债 / 风险（不修复，只登记）

1. **安全**：`/projects/[id]/conversations` 无权限门（token/cost 可见）；`/ai-activity` 无门；AgentTask execute/cancel 无 canManage 检查；runtime 活动事件仅客户端过滤（服务端仍全量下发）。
2. **断链**：`?tab=` 深链失效（含单测假绿）；工作台→分析锚点坏；调查室"打开项目 AI 工作台"死链。
3. **越权面**：分析进度条向所有用户暴露原始 `errorMessage`（`analysis-progress-banner.tsx:99-101`）。
4. **性能**：`listProjectActivity` includeSystemEvents 全量取回内存分页（`activity/query.ts:65-66,105`）；导入横幅轮询 200 次上限。
5. **错位入口**：header"文档" tile → 平台 KB；`/operations/center`"项目执行"卡实际指向 tender 列表 `/projects`（`operations/center/page.tsx:28-30`）。
6. **Needs You 断供**：dashboard 数据源不含审批（`use-dashboard-data.ts` 仅 stats/calendar/reminders）→ 工作台 Needs You 卡需新聚合端点（T1 范围内可用现有 pending-actions API 拼装）。
7. **静默副作用**：`auto-ai-panels-runner` 打开页面即静默触发生成（用户不知情、成本不可见）。

---

## 8. ASSUMPTION_INVALID（任务书假设与代码现实的差异）

| # | 任务书假设 | 实际代码 | 设计调整 |
|---|---|---|---|
| 1 | 「Evidence 不应该继续独立成为一级页面」 | **Evidence 从未是独立页面**：证据 = `TenderAnalysisSourceRef`，已在分析面板「来源」tab 与 fact/requirement 关联展示 | 方向不变但动作变为：把来源 tab 内容内联进 Requirement 行级展开；数据层统一 `BidIntelligenceFact` 的平行证据字段（架构文档） |
| 2 | 「Approval 不应该形成 Tender 独立审批世界」 | Tender 没有形成"审批世界"——**它绕过了所有审批系统**：facts/requirements/change-candidates/run-approve 是直连 `db.update` 的业务确认（`review.ts:335-465`），不进 PendingAction/ApprovalRequest/Capabilities | 需要一个明确决策：业务确认（逐条 confirm）**保留轻量内联**但标准化审计与幂等；「重要财务/战略确认」类接入统一审批读模型（架构文档 §13 给出映射） |
| 3 | 「Revision/Version 应该成为当前标书内部的 Version History」 | 应用层无标书 Revision 系统（Bid Data 幽灵层已隔离）；已有版本机制：`ProjectQuote.version`、`ProjectGeneratedDocument.version+stale`、`TenderAnalysisRun.supersedesRunId` | 采纳：Version History Drawer 聚合上述三条版本链；**不复活** Bid Data Revision 树 |
| 4 | 「页面数量过多」 | 业务主战场只有 4 tab + 调查室；"多"的是平台子路由（50%）、stub（6）、页内重复卡片 | 消解手段以 HIDE + 页内 MERGE + 删 stub 为主，而非大规模删业务页 |
| 5 | 「AI Analysis 不应该成为一级页面」 | AI 分析今天就不是一级页面（卡片+面板形态） | 确认方向：继续内嵌，收敛 4 摘要面为 1+1 |
| 6 | 「不要建立第二套任务系统」 | **第二套已存在**：`tender-auto-analysis` 自带队列/lease/幂等/cron，与 Workforce 零共享（架构文档 §12） | 本轮不动；T5 给出收敛决策点（deterministic-plan 路径是前提） |
| 7 | 「Timeline/Cost/Activity/Audit/Members 五套重复页面」 | 现实略不同：**Cost 页面根本不存在**（成本完全不可见）；Timeline 是纯投影非存储；Activity=AuditLog 流。重复发生在存储层（9 套历史存储）而非五个页面 | Ledger 设计以"分类 9 套存储 + 单一新事实源"落地（架构文档 §3） |
| 8 | 「工作台」语义 | 现有名为"工作台"的 tab 实为 AI 工具箱 | T1 改名并重构为任务书定义的操作中心 |

---

## 9. 数字答案（对应任务书 §22 A–F，完整 A–O 见路线图文档末尾）

- **A. 用户可见主要页面/Tab**：30 条路由（+2 死路由），展开后 47 个页面/tab。其中业务核心 17 个（`/bids`、`/projects`、detail 4 tab、调查室 + 分析面板 7 tab、报价编辑器）、组织情报 11 个（5 真 tab + 6 stub）、平台内部 18 个、相邻域 3 个（intake/ops×2）。
- **B. 明显重复**：13 组确认重复/断链（§3 表中 REAL 9 组 + PARTIAL 4 组），另有安全性外溢 4 处（§7-1）。
- **C. 建议保留一级入口**：Tender Detail 内 **5 个**（工作台/招标要求/标书与报价/情报/提交）；组织层保留 `/projects`（列表）与 `/projects/intelligence`（情报中心）+ `/suppliers`、`/capabilities/approvals`（跨域）。
- **D. 可删除**：2 死路由、`/bids` 壳、6 stub 路由+侧栏行、IntelHubShell 双导航、重复进度卡、重复 StartIntelligencePanel、坏锚点跳转块、「项目 AI 记忆」卡。
- **E. 应合并**：4 AI 摘要面 → 1+1；调查室 → 5 tab；分析面板 7 tab → 招标要求+提交；成员+简报 → 团队卡；两套澄清问题入口 → 招标要求；概览+右栏 → 工作台。
- **F. 应隐藏**：15 条平台子路由（conversations 补门）、AgentTask 面板与一键投标方案、runtime 事件流服务端过滤、`/ai-activity` 补门。

---

*本文档为 T0 只读审计交付物之一；实施顺序、依赖与验收见 `QINGYAN_TENDER_T0_IMPLEMENTATION_ROADMAP.md`。*
