# Qingyan Tender T1A — 5-Tab UX Consolidation 实施报告

| 项 | 值 |
|---|---|
| 基线 | `main @ 4f082cd`（含 PR #92 T0 docs / #94 Workforce P0 / #95 Tender Security P0；等同 origin/main tip，HARD PREREQUISITE 满足） |
| 分支 | `feature/tender-t1a-ux-consolidation` |
| 日期 | 2026-08-10 |
| 性质 | PRODUCT IMPLEMENTATION：UX Consolidation + Existing Capability Integration；零 Schema、零 Runtime、零新 Pipeline |
| 设计基线 | `QINGYAN_TENDER_T0_UX_CONSOLIDATION_AUDIT.md` §4–6（Decision 全量沿用）+ `QINGYAN_TENDER_T0_IMPLEMENTATION_ROADMAP.md` T1（本 PR ≈ T1-PR3 + T1-PR4 主体 + T1-PR1 残余项；T1-PR2 导航收敛除外，见 §13） |
| T0_DRIFT | **无**：`git diff abac67e..4f082cd` 在 tender UI 面（`src/app/(main)/projects`、相关 components）零改动；#94/#95 只动了 runtime 与 API/DTO 层。T0 审计的 UI 结论全部仍然成立 |

---

## 0. Gate 键值（任务书 §16）

```
TENDER_PRIMARY_TABS              = 5
SCHEMA_CHANGE                    = NONE
WORKFORCE_RUNTIME_CORE_MODIFIED  = NO
NEW_WORKFORCE_EXECUTION_PATH     = NO
PRODUCTION_DATA_MIGRATION        = NO
```

佐证：diff 不含 `prisma/`、`src/lib/workforce-runtime/`、`src/lib/agent-runtime*/`、`src/lib/approval/`、`src/lib/pending-actions/`、`src/app/api/cron/` 任何文件；不新增任何 Workforce Task / 队列 / cron / 后台 Job；不触碰生产数据（视觉冒烟走临时隔离 Neon 分支，用后已删）。

---

## 1. Before / After Sitemap

### Before（4 tab + 独立调查室 + 死路由）

```
/projects/[id]                       4 tab：概览 | 文件 | 报价 | 工作台(实为 AI 工具箱)
  ├── 底部常驻：成员表 + 加入简报 + 通知规则
  ├── 页顶常驻：放弃/交接 banner + 转执行/放弃按钮
  └── ?tab= 参数从不读取（深链假绿，T0 B4）
/projects/[id]/intelligence-room     独立调查室（30秒/八模块/事实 + 分析面板 + 第二份调查启动 + 中国简报）
/projects/[id]/quotes                404 死路由（无 page.tsx）
/projects/[id]/quotes/[quoteId]      报价编辑器
/projects/[id]/quality               404 死路由（孤儿 layout）
/projects/[id]/{agents,prompts,tools,knowledge-bases,conversations,feedbacks,feedback-tags}  平台面（15 条）
```

### After（5 tab + 贯穿抽屉 + SAFE REDIRECT）

```
/projects/[id]?tab=
  ├── workbench   工作台   决策摘要 · Needs You · 阶段与决定 · AI 简报 · 结论 · 情报摘要 · 团队 · 讨论 · 动态
  ├── requirements 招标要求 分析进度条 · Requirement(行内证据/逐条确认) · 风险 · 澄清 · 解读 · 来源 · RFI
  ├── bid         标书与报价 报价 · 一键生成文档 · 供应商询价 · 中国供应商简报 · 关联供应商 · [版本历史 Drawer]
  ├── intel       情报     BidToGo 主卡(复核流) · 30秒/八模块/事实 · 相似项目 · 企业规则 · 7 个未来 Slot(空态)
  └── submission  提交     提交状态 · 提交就绪(清单+交付物/任务) · Outcome(结果标记/复盘/转执行/放弃)
贯穿：资料抽屉(文件管理器) · 问青砚抽屉(项目 AI 对话) · 右栏项目上下文（原样保留）
内部：InternalAgentToolsSection（AgentTask 面板 + AI 一键投标方案，仅平台管理员）
redirect：
  /projects/[id]/intelligence-room → /projects/[id]?tab=intel
  /projects/[id]/quotes            → /projects/[id]?tab=bid   （编辑器子路由不受影响）
  /projects/[id]/quality           → /projects/[id]
平台面 15 条路由：未改动（PlatformAdminGate 原样；conversations/ai-activity 门已由 #95 及更早修复覆盖）
```

## 2. Changed routes

| 路由 | 变化 |
|---|---|
| `/projects/[id]` | 932 行 4-tab 单体 → 5-tab 编排器（`page.tsx` ~470 行）+ 5 个 tab 组件 + 2 个抽屉组件 + 共享类型文件；读取 `?tab=` 并与 URL 双向同步（`router.replace`，保留 `?activity=` 等参数） |
| `/projects`（列表） | 「调查室」链接 → `?tab=intel`（文案改「情报」） |
| `/projects/intelligence`（组织情报中心） | 进行中调查室的项目链接 → `?tab=intel`（路由本身保留，T4 承载） |

## 3. Redirect routes（SAFE REDIRECT，无循环）

| 旧路由 | 目标 | 备注 |
|---|---|---|
| `/projects/[id]/intelligence-room` | `/projects/[id]?tab=intel` | 服务端 `redirect()`；同时移除了旧页面对 `db` 的**未鉴权直读**（原实现仅检查 cookie 存在性）。`#tender-analysis` 锚点深链会落在情报 tab（fragment 不上服务端，见 §11 debt） |
| `/projects/[id]/quotes` | `/projects/[id]?tab=bid` | 原为 404 死路由；`[quoteId]` 编辑器不受影响 |
| `/projects/[id]/quality` | `/projects/[id]` | 原为孤儿 layout 404；layout（PlatformAdminGate）保留，物理删除留待 Cleanup |

循环检查：三个目标均为详情页本身（不再二次 redirect）；静态测试断言详情页无服务端 `redirect(`。

## 4. Hidden routes / REMOVE_FROM_PRIMARY_UX

| 对象 | 处理 |
|---|---|
| AgentTask 面板（`ProjectAgentTasks` 11 组件族）+ AI 一键投标方案（`AiBidPackageSection`） | 从业务 tab 摘除 → `InternalAgentToolsSection`（页底折叠区，`isPlatformAdmin` 门控；旧组件的 overview/files/quotes 回跳经别名解析器适配）。Backend API 未动（授权已由 #95 收口） |
| 「项目 AI 记忆」卡（`project-ai-memory.tsx`，无表读时聚合） | 不再渲染（T0 DELETE → 本轮 REMOVE_FROM_PRIMARY_UX；组件文件保留待 Cleanup） |
| 概览 inline 通用「项目进度」卡 | 消除同名重复：招投标项目只显示招投标进度；**非招投标项目保留通用进度卡**（能力不丢失） |
| 调查室内第二份 `StartIntelligencePanel` | 随调查室重构消除；全局唯一实例在工作台「阶段与决定」（静态测试锁定 =1） |
| 「分析投标文件」坏锚点跳转块 | 删除；招标要求 tab 直达取代 |
| 分析进度条原始 `errorMessage` | 不再向业务用户渲染（T0 §7-3）；改为通用失败文案 + 重试指引 |
| 平台 15 条子路由 | 本轮零改动（门禁已存在；侧栏本就无入口） |

## 5. Existing capability mapping（现状面 → 新位置）

| 现状面（T0 §2 清单） | 新位置 |
|---|---|
| 概览·决策摘要（ProjectCommandOverview） | 工作台首屏 |
| 右栏「青砚·项目上下文」 | 原样保留（导航目标升级为 5-tab + 抽屉，见 §7） |
| 新项目引导（onboarding） | 工作台（步骤 2/3 改指招标要求/标书与报价，文案同步更新） |
| AI 项目摘要 + 进展摘要/管理层摘要 | 工作台「AI 简报」区（两卡同区收敛；组件未合并，见 §11 debt） |
| 项目结论 Insight / 复盘卡 / 企业规则 | 工作台 / 提交 Outcome / 情报 |
| 投标调查启动 + GO/HOLD/NO_GO | 工作台「阶段与决定」（**单实例**；`intelligenceAvailable=false` 降级横幅保留） |
| BidToGo 情报卡（685 行，含人工复核流） | 情报 tab 主卡（**单实例**） |
| 招投标进度（stepper+关键日期+时间轴） | 工作台（通用进度卡仅非招投标项目显示） |
| 项目讨论 / 项目动态 | 工作台（讨论 mention 流保留：团队卡头像 → 讨论区草稿） |
| 文件 tab 全部（文件管理器/截止时间编辑/导入横幅） | 资料抽屉（贯穿，header 文档 tile + 顶栏「资料」按钮 + 各引导入口呼出）；导入横幅仍页级常驻 |
| 分析进度条（原挂文件管理器内） | 招标要求 tab 顶部（文件抽屉内实例保留，链接改指 `?tab=requirements`） |
| 投标清单 BidChecklist | 提交 tab「提交就绪」 |
| 报价 tab（询价/报价列表/向业主提问） | 标书与报价（询价/报价）+ 招标要求（RFI 提问入口） |
| 工作台 tab（旧 AI 工具箱）：生成文档 / AI 对话 / AgentTask 面板 | 标书与报价 / 问青砚抽屉 / INTERNAL_ONLY |
| 调查室：30秒看懂 + 八模块 + 事实录入 | 情报 tab（`ProjectIntelSections`，由 `intelligence-room-client.tsx` 重构改名而来，git rename 保史） |
| 调查室：中国供应商简报 | 标书与报价 tab |
| 分析面板 7 内部 tab | 拆分挂载：招标要求（requirements/risks/clarifications/report/sources）+ 提交（deliverables/tasks，quiet 空态、无运行控制）——经 `TenderAnalysisPanel` 新增 additive props（`sections/showRunControls/initialTab/quietEmpty`），确认/驳回/批准/重分析语义未动 |
| 成员表 + 加入简报 + 通知规则 | 工作台「团队」卡（通知规则收进折叠区） |
| 放弃/交接 banner + 转执行/放弃按钮 + 两 Dialog | 提交 tab Outcome 区（放弃状态在工作台决策摘要仍有 danger 提示） |
| Version/Revision | 版本历史 Drawer（只读聚合 `ProjectQuote.version` 链 + `ProjectGeneratedDocument.version+stale` + `TenderAnalysisRun` 运行史；不复活 Bid Data Revision 树） |
| 结果标记（tender-result） | 提交 tab Outcome 新增表单，走既有 `POST /tender-result`（此前该 API 无详情页 UI 入口；won/lost/no_bid/cancelled + 可选价格/备注；服务端自动产复盘草稿语义不变） |
| 工作台 Needs You | 新卡：`/api/ai/pending-actions` 项目内待确认列表 + 「在对话中处理」（问青砚抽屉内 ApprovalCard 确认流）+ 审批中心链接；零待确认时不渲染 |
| 情报未来模块（历史中标/采购机构画像/可比价格/竞争对手/采购周期/供应链/AI 策略） | 情报 tab「企业历史情报（建设中）」7 个稳定 Slot（`data-intel-slot` 可寻址），空态文案「企业历史数据尚未建立/尚未分析」，**无任何伪造 0 值**（静态测试锁定） |

## 6. Screenshots / UI descriptions（本地全栈视觉冒烟实录）

环境：worktree `next dev` + 临时隔离 Neon 分支（staging project 派生，`prisma db push` 对齐 schema）+ 合成种子（`qy_t1a_smoke_` 前缀 org/user/tender 项目）+ 自签 JWT。用后：dev server 停止、`.env.local`/launch.json/种子脚本删除、Neon 分支已删（`branches list` 验证 0 残留）。

- **桌面 1280px**：侧栏原样；5-tab 图标+全标签（工作台/招标要求/标书与报价/情报/提交）；顶栏「资料/问青砚」按钮；决策摘要四格（主要风险/等待确认/最近变化/推荐下一步）+ 快速开始 0/3。
- **移动 375px**：5-tab 等宽紧凑分段（短标签 工作台/要求/标书/情报/提交，每格 57px），`document.scrollWidth == 375` 无横向溢出；header tile 2×2 栅格。
- **资料抽屉**：右侧滑出（移动端近全宽），文件管理器完整（上传区/截止时间编辑显示种子日期 2026-08-24·剩余 14 天）。
- **问青砚抽屉**：项目 AI 助手完整渲染（「项目专家 · 聚焦本标书/风险/供应商/澄清邮件」）。
- **版本历史抽屉**：三分区（报价版本/生成文档版本/分析运行历史）各自诚实空态。
- **各 tab 空态**：招标要求「暂无分析记录+发起分析 CTA」；情报「尚未生成项目情报分析」「尚未开展项目调查→前往工作台」、7 Slot「尚未建立」；提交「尚未提交/未标记」+ 交付物 quiet 空态。

## 7. API reuse（零新端点）

全部复用既有 API：`/api/projects/[id]`(+members/overview/handoff/activity) · `/api/ai/pending-actions` · `tender-analysis/*`（runs 列表复用作分析版本史；confirm/reject/approve/change-candidates 语义未动） · `bid-intelligence/*`（room/facts） · `quotes`（列表复用作报价版本链） · `generate-pdf`（GET 复用作文档版本；非管理员 403 时抽屉安静降级） · `inquiries` · `questions` · `tender-result`（首次接 UI） · `insights/reviews/org-rules/similarities/ai-summary/progress-summary/checklist` · `join-brief/notification-rule` · `handoff/abandon`。

导航契约变更：`ProjectContextTarget` 由旧 4 值改为 `5 tab + files + chat`；`deriveProjectCommandState` 的 nextAction 目标随之迁移（解读→requirements、待确认→workbench、询价/报价→bid）；`?tab=ai` 等旧值经 `lib/tender/detail-tabs.ts` 别名表**永久兼容**（`projectAiTabHref` 字符串未变，行为从假绿变为真通）。

## 8. Schema status

**SCHEMA_CHANGE = NONE。** 无 migration、无 `prisma/` diff、无 `db push`（对生产/staging 主分支；仅对即弃的临时冒烟分支做过 schema 对齐）。

## 9. Runtime impact

**NONE。** 冲突矩阵 §0.1 全部文件零触碰；无新 Workforce Task / TenderQueue / 后台 Job / cron / 并行 worker；`tender-auto-analysis` 既有队列未动。共享面按 §0.2 规则：`scripts/test-all.sh` / `test-ci-unit.sh` 仅在 tender/bid-workflow 区块 additive 追加 3 行（远离 Workforce 块）；`status-badge/empty-state/page-header`、审批 UI、`registry.ts`、`i18n` 三文件零改动。

## 10. Test results

| 门 | 结果 |
|---|---|
| `tsc --noEmit` | ✅ 0 error |
| `npm run lint:baseline`（CI 真实门禁） | ✅ PASS：无新增 error fingerprint，且相对基线**减少 2 处 error**（旧 page.tsx 既有）；`project-detail-header` 的 `Date.now` purity error 为基线既有（指纹不含行号，位移不构成新增） |
| `npm run test:ci`（CI unit subset，含新 3 套） | ✅ PASS |
| 新增：detail-tabs 解析契约 | ✅ 19/19（5 入口、别名、非法值、`?tab=ai` 字符串→行为闭环） |
| 新增：Tender 详情 IA 静态审计 | ✅ 36/36（一套导航/深链/redirect 无循环/平台面收敛/单一写入口/诚实空态/移动分段） |
| 更新：项目上下文决策契约 | ✅ 9/9（新导航目标；本套件此前未注册，现已入册） |
| 既有 Tender 回归（tender-result/price-gap/review-outcome/org-rules/tender-skills + tender-auto-analysis 全 16 套 + bid-workflow 4 套） | ✅ 全绿（bid-workflow-phase1 的 `?tab=ai` 断言不变仍绿） |
| `npm run build`（prisma generate + next build） | ✅ Compiled successfully（warnings 均为基线既有） |
| 浏览器级视觉冒烟 | ✅ 见 §6：5 入口/深链别名/redirect/三抽屉/移动/桌面/空态/403 面（generate-pdf 降级）全过 |

任务书 §15 清单逐项：5 入口唯一 ✅（IA 静态审计 + 冒烟）；T0 核心功能 reachable ✅（§5 映射全表）；Requirement→Evidence ✅（行内「来源」+ SourceSnippetDialog 原样）；Approval/Lock 无回归 ✅（相关模块零 diff + 套件绿；`TECHNICAL_REQUIREMENTS_MISSING`/`REVISION_NOT_APPROVED` 等语义所在后端未触碰）；Version 可访问 ✅（编辑器路由 + 版本抽屉）；AI 分析可找到 ✅（招标要求/情报/工作台简报）；redirect 无循环 ✅；403/404 ✅（详情页错误态保留；平台面门禁未动）；Loading/Empty ✅；Mobile/Desktop ✅。

## 11. Known debt（本轮登记，不修）

| # | 项 | 说明 |
|---|---|---|
| D1 | **app-shell backdrop-blur 使页面内 fixed Drawer 错位**（`app-shell.tsx:92`，现代 Chromium 中 backdrop-filter 形成 containing block） | 本 PR 对自有三抽屉用 BodyPortal 规避（不改共享 `ui/drawer.tsx`）。**既有** `task-drawer` / `project-quick-view-drawer` 同样受影响——属 shell/共享层修复，POTENTIAL_PHASE2_CONFLICT 范围外溢，留全局修复 |
| D2 | 分析失败详情服务端仍下发（`runs?latest=1` 含 errorMessage 字段） | UI 已不渲染；服务端裁剪属 API 层（列表端点已有 `errorMessageSanitized` 先例），归 T1 后续小 PR |
| D3 | runtime 活动事件仍为客户端过滤（T0 B3） | `filterProjectContextActivities` 原样沿用；服务端过滤归 T1-PR4 残项/T2 |
| D4 | AI 简报为两卡同区，未真正合并为单卡；进展摘要与 AI 摘要仍是两套生成端点 | 数据层合并归 T2（4 摘要面 → 1+1 的数据侧收口） |
| D5 | 旧 `intelligence-room#tender-analysis` 书签落在情报 tab 而非招标要求（URL fragment 不上服务端） | 站内链接已全部改指 `?tab=requirements`；仅存量浏览器书签受影响，情报 tab 内容自洽 |
| D6 | `project-ai-memory.tsx` / `quality/layout.tsx` 等成为不可达代码 | 按任务书「物理删除放后续 Cleanup」保留文件 |
| D7 | `auto-ai-panels-runner` 打开页面静默触发生成（T0 §7-7） | 原样保留（REFACTOR_LATER，T5 显式 Job 化） |
| D8 | 提交 tab「提交状态」仅投影 Project 字段；提交回执/文件清单无数据源 | 诚实显示「暂无/尚未提交」；数据底座归 T2 Ledger |
| D9 | 冒烟环境发现 browser pane `visibilityState=hidden` 下 CSS transition 冻结 | 纯测试环境伪影（真实浏览器不受影响）；记录备后续冒烟复用：断言最终态前注入 `transition:none` |

## 12. T1B blockers

1. **T1-PR2 导航收敛未做（本 PR 有意出界外）**：删 `/bids` 壳与 `ws-bids`、删 6 个情报 stub 路由与侧栏行、删 `IntelHubShell` 双导航、`/operations/center` 卡指向修正、移动 tab-bar 招投标入口改指——全部需改 `src/lib/navigation/registry.ts` / `i18n` 三文件 / `mobile-tab-bar.tsx`，按任务书 §14 属 global navigation：**POTENTIAL_PHASE2_CONFLICT，本轮未触碰**。#87 已合并使冲突窗口关闭，T1B 可开工（角色矩阵回归用 nav-permission-smoke）。
2. D1（共享 Drawer 错位）建议在 T1B 或独立小 PR 全局修复（`ui/drawer.tsx` 加可选 portal，或 shell 层去除 backdrop-blur 对 fixed 的影响）。
3. 工作台「成本卡」「历史情报真数据」依赖 T2 Ledger / T3-T4 数据面——UI Slot 已留好（`data-intel-slot` 七位 + 情报摘要卡），T1B 无需再动结构。
4. `TENDER_DETAIL_V2` feature flag 未设：路线图建议灰度，但本实现为**同路由原位替换**且旧 4-tab 值全量别名兼容、回滚 = revert 单 commit，评估后未引入 flag（如 Final Review 要求灰度可补）。

---

## 附：Gate 键值（复录）

```
TENDER_PRIMARY_TABS              = 5
SCHEMA_CHANGE                    = NONE
WORKFORCE_RUNTIME_CORE_MODIFIED  = NO
NEW_WORKFORCE_EXECUTION_PATH     = NO
PRODUCTION_DATA_MIGRATION        = NO
```

*T1A 至此完成。按任务书 §17：Draft PR 已建立并保持 Draft，STOP 等待人工 Final Review；不自动进入 T1B。*
