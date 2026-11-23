# Design：旧报价单、报价导出、报价 AI 与询价里的内部成本、利润率和供应商报价只给有财务查看权的人（FIX-26）

## Context

### 口径现状

「财务查看权」= `src/lib/project-finance/access.ts` 的 `resolveFinancePrivilege(user, orgId, ownerId).canReadAll`：平台超级管理员、持组织范围 `project.finance.manage` 或 `project.finance.read` 的人、项目负责人（PERM-4c1 起不认 `org_admin`；`bids` 岗位的 `project.finance.read` 只在 ASSIGNED 范围，不算）。已按它收口的：成本核算 `bid-workspace/cost-sheet`、CHAIN-2 寻源卡、CHAIN-2b 报价表助手（#532）、BIDPAGE-1 / BIDPAGE-3 的金额门；CHAIN-2e（#556，已审完、等生产查询后合并）把报价引擎、比价矩阵 / AI 报价分析的落地价、询价追踪页的落地价也收到这个口径，并新增带兜底的入口 `resolveFinanceViewSafe`（出错只剩超级管理员与负责人，标 `unconfirmed`）、提示句 `financeHiddenHintZh`（`src/lib/project-finance/view-hint.ts`）与 `resolveQuoteCapabilities(access, { finance })`（能看 = `canReadAll`；能编辑 = 能看 ∧（`privileged` ∨ 项目角色有 `project:cost:write`））。

旧报价单在生产上天天在用、没有开关：投标页签 `src/components/project-detail/tabs/bid-tab.tsx:51-53` → `BidQuoteArea`，报价引擎开关没开时只渲染旧报价单区块（`src/components/quote-engine/bid-quote-area.tsx:16`）。BIDPAGE 新页面把它挂在金额门里（`src/components/bid-page-v2/bid-page-v2.tsx:111-122`），但交接文档 §3 写明金额门「只决定挂不挂，不是数据保护」。

同一张表：报价引擎与逐行报价（BIDPAGE-3）建的报价也存在 `ProjectQuote`，`orgId` 不为空（`src/lib/quote-engine/service.ts:150-153`、`src/lib/bid-page-v2/quote-line/service.ts:170-173`）；引擎快照把估算成本、售价、毛利率写进 `internalCost` / `totalAmount` / `profitMargin` 三列，把估算成本、毛利、毛利率、加成、成本分解、情景写进 `summaryJson`（`service.ts:231-241`）。旧路由建报价从不写 `orgId`（`src/app/api/projects/[id]/quotes/route.ts:44-53`、`save-ai-draft/route.ts:30-44`），所以 `orgId` 是否为空就是「旧报价单 / 报价引擎的报价」的分界。

### 出口清单（2026-11-23 在 `c376be86` 上逐条核对）

「项目读者」= `requireProjectReadAccess`（`src/lib/projects/access.ts:116-166`）：平台超级管理员、负责人、项目所在组织的 `org_admin`（不必是项目成员）、任一 active 项目成员（含 `viewer`、`tester`）。「项目写者」= `requireProjectWriteAccess`（`:54-110`）：平台超级管理员、负责人、`org_admin`、`project_admin`。

本 change 处理（都没有开关，生产在跑）：

| # | 出口 | 谁能拿到（真实守卫） | 拿到什么 | 改成什么 |
|---|---|---|---|---|
| 1 | `GET …/quotes`（`quotes/route.ts:7-31`） | 项目读者 | 每份报价（含引擎与逐行报价）`totalAmount` + `profitMargin`（`:22-23`）；两数配对即成本 = 总额 ×（1 − 利润率） | 没有财务查看权：`profitMargin: null`，带 `costHidden`；所有人多带 `capabilities` |
| 2 | `GET …/quotes/{报价}`（`[quoteId]/route.ts:9-26`） | 项目读者 | 整行 + 行项：`internalCost`、`profitMargin`、`internalNotes`、`aiDraftJson`（AI 草稿，每行带 `costPrice`）、`aiReviewJson`；引擎报价还有 `pricingRate`、`pricingMethod`、`engineJson`、`summaryJson`、`customerJson`、`termsJson`，行项 `costPrice`、`sourceJson` | 对所有人只给旧报价单字段（D2）；没有财务查看权：内部成本、利润率、内部备注、AI 草稿 / 审查原文、行 `costPrice` 为 `null`，带 `costHidden`；引擎报价 409（D3） |
| 3 | `PATCH …/quotes/{报价}`（`:28-110`） | 项目读者（只读成员也能改价、把 `status` 改成任意值、整组替换行项并重算成本列） | 返回同 #2 的整行 | 要能编辑（D4），否则 403 不写库；引擎报价 409；返回按 #2 |
| 4 | `POST …/quotes`、`DELETE …/quotes/{报价}`、`POST …/quotes/save-ai-draft` | 项目读者 | 建 / 删草稿；`save-ai-draft` 把整份 AI 草稿存进 `aiDraftJson` | 要能编辑；`DELETE` 引擎报价 409 |
| 5 | `POST …/quotes/{报价}/ai/review`（`ai/review/route.ts:9-81`） | 项目读者 | 每行成本价、内部成本、利润率交给模型（`:49`、`:53-54`；提示词 `src/lib/ai/prompts/trade.ts:212`、`:217-219`，「利润率 < 5% 必须标记 urgent」`:249`），审查结论原样回给调用者 | 没有财务查看权 403、不调模型；引擎报价 409（D6） |
| 6 | `POST …/quotes/ai/generate-draft`（`generate-draft/route.ts:11-104`） | 项目读者 | 本项目已报价供应商的单价 / 总价交给模型（`:31-45`、`:59-66`），返回的草稿每行带 `costPrice`（提示词「costPrice 是内部成本参考」`trade.ts:116`）、`internalNotes`、`reasoning`（定价依据） | 不能编辑 403、不调模型（D6） |
| 7 | 旧报价单编辑器（`src/components/quote/quote-editor.tsx`） | 能打开编辑器的人 = 项目读者 | 内部成本（`quote-summary-bar.tsx:52-60`）、利润率（`:62-70`；`quote-top-summary.tsx:44-47,85,116-119,143-155`）、成本价一栏（`quote-line-table.tsx:82,159-165`）、规则检查「利润率 X%，低于 5% 安全线」（`src/lib/quote/rules.ts:67-95`）；读取失败时 `if (!res.ok) return;`（`quote-editor.tsx:68`）留下空白默认表单 | 按 `capabilities` / `costHidden` 显示（D9） |
| 8 | 报价单 PDF（`src/lib/quote/export-pdf.ts:133-139`；由编辑器 `quote-editor.tsx:24,322-325` 在浏览器生成） | 能打开编辑器的人 | 「Profit Margin: x%」印在给客户的报价单上（**最严重**：从客户手里出去） | 对所有人都不印，不出内部版 PDF（D5） |
| 9 | Excel（`src/lib/quote/export-excel.ts:43-47,55,66`；`quote-editor.tsx:25,326`） | 同上 | 「内部成本」「利润率」「成本价（内部）」 | 有财务查看权：内部成本表；没有：不含这三样（D5） |
| 10 | 智能体报价技能 `src/lib/agent/skills/quote.ts` | 问青砚 `project_bid_quote`（`src/lib/agent-core/tools/project-skills.ts:108-130`；工具角色 admin / sales，`_policy.ts:116`；`runStaticSkill` 只核对项目所属组织，`src/lib/agent-core/skills/static-bridge.ts:67-79`，不查项目读权限）；智能体任务里执行这一步的人（`flow-runner.ts:344-348`）；一键投标方案（项目写者，`run-step/route.ts:114-117`） | review：按传入的 `quoteId` 取报价、**不核对属于本项目**（`:179-187`）；成本价、内部成本、利润率交给模型（`:249`、`:252-254`）；规则检查带利润率（`:230`）。draft：供应商单价 / 总价交给模型（`:94-102`），返回带 `costPrice` 的草稿（`:148-152`） | 按执行的人判（D7）：`quoteId` 必须属于本项目；没有财务查看权时 review 不调模型、规则检查不评利润率，draft 不调模型；问青砚路径先查项目读权限 |
| 11 | 问青砚 `project_get_project_quotes`（`src/lib/agent-core/tools/enterprise-readonly.ts:516-557`） | 本组织任一 active 成员（`requireOrgMember` `:19-31`，不查项目读权限）；企业微信 @青砚 的项目上下文也能调（`src/lib/mention-gateway/policy.ts:33-42`，回复只给发起人 `:195-198`）；数字员工技能「投标废标风险检查」用它（`src/lib/agent-core/skills/tender-seed.ts:127`） | 每份报价 `subtotal`、`totalAmount`、`profitMargin`（`:548-550`） | 先查项目读权限；没有财务查看权 `profitMargin: null`、带 `costHidden`（D7） |
| 12 | `GET …/inquiries`（`inquiries/route.ts:10-17` → `src/lib/inquiry/service.ts:191-202`） | 项目读者 | 每轮每家供应商 `unitPrice`、`totalPrice`、`quoteNotes` 等 | GATE ① 推荐 A：没有财务查看权时三项为 `null`，轮次带 `priceHidden`（D8） |
| 13 | `GET …/inquiries/{轮次}`（`[inquiryId]/route.ts:10-22` → `service.ts:176-187`） | 项目读者 | 同上（另含供应商完整记录） | 同 #12 |
| 14 | `GET …/inquiries/{轮次}/compare`（`compare/route.ts:7-16` → `service.ts:438-462`；界面没有调用方） | 项目读者 | 按总价排序的单价 / 总价 / 报价备注 | 同 #12（每行带 `priceHidden`，排序照旧） |
| 15 | 询价写接口的返回：`PATCH …/inquiries/{轮次}`、`POST …/items`、`…/items/{条目}/{mark-sent,mark-replied,mark-declined,mark-no-response,select(POST/DELETE),record-quote}` | 项目写者 | 返回的条目或整轮带价格（`include: { supplier: true }`） | 没有财务查看权时按 #12 裁剪；`record-quote` 403 不写库、不推 Muse 事件 |
| 16 | 询价明细表（`src/components/inquiry/inquiry-detail.tsx:186-193` 总价 / 单价、`:198-203` 备注、`:326` 录入 / 更新报价） | 项目读者 | 同 #12 | 显示「—」+ 一句话，不出录入按钮（D9） |

不在本 change（写明归属）：

| # | 出口 | 谁能拿到 | 拿到什么 | 归属 |
|---|---|---|---|---|
| 17 | 比价矩阵 `…/compare/matrix` 与 AI 报价分析 `…/compare/analysis` | 项目读者 | 落地价（CHAIN-2e 收）；每行原价 `quoted` 与模型输入里的原价（CHAIN-2e D3 有意保留） | 落地价：CHAIN-2e；原价：GATE ① 选 A 时 FIX-26b（CHAIN-2e 合并后改它的文件） |
| 18 | 询价追踪页 `GET /api/org/tender-rfq/tracker`「报价 CAD x / 件」（`src/lib/tender-rfq/tracker-pure.ts:232-233`） | 每行所在项目的读者（`tracker.ts:84-93`） | 供应商原价 | 同上，FIX-26b（`tracker*.ts` 正被 CHAIN-2e 改） |
| 19 | 供应商履历 `GET /api/suppliers/{供应商}/history`（`src/app/api/suppliers/[id]/history/route.ts:8-18` → `src/lib/supplier/service.ts:139-174`） | 本组织 active 成员（`src/lib/supplier/access.ts:18-40`），不看项目 | 跨项目每次询价的 `totalPrice` | FIX-26b（要按行所在项目判，同 CHAIN-2e D5） |
| 20 | 组织项目智能的供应商平均单价（`src/app/api/org/project-intelligence/route.ts:17-41` → `src/lib/projects/supplier-performance.ts:21-41`） | 本组织 active 成员 | 跨项目、跨品类的平均单价（汇总值） | FIX-26b 或 GATE 定不收 |
| 21 | Muse `compare` / `price_scenario` | 有 Muse 身份的组织成员（只按组织取，`router.ts:480-481`） | 所选供应商落地价（决定 A）、矩阵 | CHAIN-2e 登记的「编号待定」；本 change 不改 |
| 22 | 报价引擎 14 个路由文件、「报价与成本」卡、单个报价页 | 改动前：项目角色带 `project:cost:read`（含 viewer） | 估算成本、毛利率 | CHAIN-2e |
| 23 | 逐行报价 `bid-page/quotes/**` | 金额门（`src/lib/bid-page-v2/quote-line/api-gate.ts:20-27`） | 成本行、毛利 | BIDPAGE-3，已收；它的报价经 #1 / #2 / #3 的旧接口仍可读写——本 change 用 D3 堵上 |
| 24 | 报价表助手、房间 JSON、目标毛利 | — | — | CHAIN-2b / FIX-25 |

核对后不是出口的：项目 AI 上下文只带报价标题、状态、总额（`src/lib/projects/project-ai-context.ts:84-88`，卖价）；问青砚 `project_get_project_inquiries` 只给轮次与条数（`enterprise-readonly.ts:478-514`）；AI 记忆只记供应商名与状态（`src/lib/ai/memory.ts:117-127`）；旧报价单路由不写审计、不发通知；项目动态只拼固定字段（`src/lib/activity/formatter.ts:232-247`）；审计列表不返回 `afterData`（`src/lib/audit/query.ts:23-27`）；询价邮件起草不带价格（`src/lib/agent/skills/email-draft.ts`）；`ProjectInquiry.token` 没有任何代码读写；模板推荐 `quotes/ai/recommend-template` 只给项目资料。

## Goals / Non-Goals

**Goals**：出口表 #1–#16 里，没有财务查看权的人拿不到内部成本、成本价、利润率（含引擎写进同表的毛利率）与（GATE ① 选 A 时）供应商单价、总价、报价备注；PDF 对任何人都不带利润率；没有资格的人不能改旧报价单、不能触发报价 AI；界面写一句为什么、找谁，不停在空白或转圈；有财务查看权且能编辑的人看到、改到、导出的一切与改动前相同（PDF 少一行利润率除外）。

**Non-Goals**：
- `src/lib/muse-bridge/**`（决定 A；间接影响见 proposal）。
- CHAIN-2e 的文件：`src/lib/tender-rfq/compare.ts`、`compare-service.ts`、`tracker.ts`、`tracker-pure.ts`、`src/app/api/projects/[id]/inquiries/[inquiryId]/compare/{matrix,analysis}/route.ts`、`src/components/inquiry/quote-analysis-panel.tsx`、`src/components/bids/rfq-tracker.tsx`、`src/app/api/projects/[id]/quote-engine/**`、`src/components/quote-engine/**`、`src/lib/quote-engine/**`（只 import `access.ts` 的 `resolveQuoteCapabilities` 与 `finance-hint.ts` 的句子，不改）。
- `src/lib/project-finance/access.ts`、`src/lib/project-finance/view-hint.ts`（只 import，不改判定与句子）。
- BIDPAGE 的文件：`src/lib/bid-page-v2/**`、`src/app/api/projects/[id]/bid-page/**`、`src/app/api/projects/[id]/bid-page-summary/route.ts`、`src/components/bid-page-v2/**`、`src/components/quote-engine/bid-quote-area.tsx`。
- `src/components/project-detail/version-history-drawer.tsx`、`src/components/project-detail/tabs/bid-tab.tsx`、`src/components/inquiry/project-inquiry-section.tsx`（链接与挂载不改）。
- `src/lib/inquiry/service.ts`（服务函数不改：Muse、回信入表、追踪页都在用；裁剪在路由层做）。
- `src/lib/ai/prompts/trade.ts`（提示词不改：有资格的人模型输入逐字不变，没资格的人不调模型）。
- `src/lib/agent-core/skills/static-bridge.ts`、`flow-runner.ts`（其余八个静态技能的口径不在本 change）。
- `src/app/api/suppliers/**`、`src/lib/supplier/**`、`src/app/api/org/**`、`src/lib/projects/supplier-performance.ts`（出口 #19 / #20）。
- `prisma/`、`vercel.json`、环境变量。

## Decisions

### D1：判定沿用 CHAIN-2e 的带兜底入口与报价能力公式，本 change 不写第二份

所有出口用 `resolveFinanceViewSafe(user, project.orgId, project.ownerId)` 得到财务能力，再用 `resolveQuoteCapabilities(access, { finance })` 得到 `canViewInternal` / `canEdit`；看不到或不能编辑时用 `resolveFinanceHintReason` 选句子（`unconfirmed` / `no_owner`），默认那句不带 `hintReason`。项目没有组织时按「不持组织键」算（只剩负责人与平台超级管理员）。旧报价单的「能编辑」与报价引擎同一公式（CHAIN-2e TASKFLOW 那一行写的「改状态要求与报价引擎同一口径」）。询价只用 `canViewInternal`。

- 备选 A：用 CHAIN-2b 的 `resolvePricingCostVisibility`。否决：只回一个布尔，没有「暂时无法确认」与特权位，编辑口径还得另写；CHAIN-2e 合并后两份兜底本来要收成一份。
- 备选 B：沿用项目读权限 + 项目角色 `project:cost:read`。否决：`viewer` 也带这项权限（`src/lib/rbac/permissions.ts:193`），等于不收。
- 备选 C：新增权限键「看旧报价单成本」。否决：多一套口径，要走岗位目录登记。
- 代价：依赖 CHAIN-2e 先合并（task 2 起）。CHAIN-2e 迟迟不合时的做法见 GATE ⑦。

### D2：旧报价单读取：裁剪而不是整接口 403；详情改为固定白名单

`src/lib/quote/finance-view.ts` 的纯函数：列表行 `profitMargin` 按能不能看置空；详情只拼旧报价单字段——`id`、`projectId`、`templateType`、`version`、`status`、`title`、`currency`、`tradeTerms`、`paymentTerms`、`deliveryDays`、`validUntil`、`moq`、`originCountry`、`subtotal`、`totalAmount`、`internalCost`、`profitMargin`、`internalNotes`、`aiGenerated`、`aiDraftJson`、`aiReviewJson`、`inquiryId`、`createdById`、`createdAt`、`updatedAt`，行项 `id`、`sortOrder`、`category`、`itemName`、`specification`、`unit`、`quantity`、`unitPrice`、`totalPrice`、`remarks`、`costPrice`、`isInternal`——不能看时把内部成本、利润率、内部备注、AI 草稿 / 审查原文、行 `costPrice` 置 `null`，加 `costHidden: true`。所有人多带 `capabilities: { canViewInternal, canEdit }`（+ 非默认时的 `hintReason`）。编辑器只读这些字段（`quote-editor.tsx:71-102`），白名单不丢它用的任何东西。

- 备选 A：没有财务查看权整接口 403。否决：卖价、条款、行项对项目读者本来开放（与报价引擎客户视图同理），403 让旧报价单区块与编辑器全空。
- 备选 B：删键而不是置 `null`。否决：编辑器与列表按键读，`null` + `costHidden` 更清楚、形状稳定。
- 备选 C：详情照旧原样返回整行、只把几个成本列置空。否决：引擎报价的 `summaryJson`、`engineJson`、`pricingRate` 等十几个键都含成本或毛利，逐个黑名单漏一个就是泄露；白名单一处定义。
- 备选 D：只对引擎报价裁剪。否决：旧报价单自己的 `internalCost` / `profitMargin` / `costPrice` 就是成本。

### D3：旧接口不处理报价引擎的报价

`orgId` 不为空的报价经 `GET` / `PATCH` / `DELETE …/quotes/{报价}` 与 `POST …/ai/review` → 409「这份报价是在报价页里做的，旧报价单不能打开或修改它；请到报价页查看和修改。」，带 `href: /projects/{项目}/quote-engine/{报价}`；不写库、不调模型。列表照旧列出引擎报价（版本历史抽屉要用），只按 D2 裁剪。判定顺序：项目读权限 → 报价不存在 404 → 引擎报价 409 → 编辑权 403（写）/ 财务查看权 403（审查）。

- 备选 A：旧接口照旧读写引擎报价、只做 D2 的裁剪。否决：旧 `PATCH` 带行项时先删掉这份报价的全部 `QuoteLineItem`（客户报价行，`[quoteId]/route.ts:72-73`），再按旧算法重算小计、总额、内部成本、利润率四列，覆盖引擎快照；`status` 不经状态机直接改（CHAIN-2e 报告 §5：只读成员能改成 `approved`，绕过 GATE ①）；BIDPAGE-3 逐行报价同样受影响。
- 备选 B：按 `calcVersion` 或 `quoteType` 区分。否决：旧报价单的 `quoteType` 默认就是 `CUSTOM`，与引擎的 CUSTOM 类型同值；`calcVersion` 要等引擎第一次快照才写。`orgId` 是建行时定的，旧路由从不写。
- 备选 C：旧编辑器遇到引擎报价自动跳转。否决：跳转是界面行为，接口仍得 409；编辑器写一句加链接就够（D9）。

### D4：旧报价单的写要「能编辑报价」

`POST …/quotes`、`PATCH` / `DELETE …/quotes/{报价}`、`POST …/quotes/save-ai-draft` 在 `canEdit` 为假时 403「没有改动：你不是本项目负责人，不能新建、修改、确认或删除报价单。要做报价，请项目负责人或组织管理员在项目成员里把你设为主负责人。」（没有真人负责人时后半句换成 CHAIN-2e 的「这个项目还没有指定负责人，请找组织管理员在项目成员里把做报价的同事设为主负责人。」；授权查询出错时整句换成「没有改动：暂时无法确认你的查看权限，请稍后刷新。」），不读请求体、不写库。`canEdit` 为假的人一定不是负责人（负责人是特权，CHAIN-2e D8 同一推理），所以「你不是本项目负责人」成立。能编辑的人行为不变；`PATCH` 返回按 D2（能编辑的人都能看，返回带成本）。守卫仍是处理函数第一步（`src/lib/projects/__tests__/project-routes-guard.test.ts`）。

- 备选 A：只拒「碰了成本」的保存（CHAIN-2b D3 式）。否决：旧编辑器每次保存与确认都整组带行项与成本价（`quote-editor.tsx:116`、`:147-150`），等于全拒；要放行「只改表头」就得改编辑器的保存逻辑，`status` 改成「已确认」也是表头。
- 备选 B：只要财务查看权（不看项目角色的成本写权限）。否决：与报价引擎口径不同（会计岗 + 只读项目角色能看不能改，CHAIN-2e D2）；两套「能改报价」的说法会让同一个人在两处得到不同答案。
- 备选 C：保持项目读权限可写。否决：只读成员能改价、确认、删草稿，与 FIX-21 的读 / 写分级相反。
- 代价：不是负责人的投标同事不能再建 / 改旧报价单（与 CHAIN-2e GATE ① 同一结论的延伸，GATE ② 请确认）。

### D5：PDF 永远是给客户的版本；内部版只有 Excel

新纯模块 `src/lib/quote/export-content.ts` 算出两种导出的内容，`export-pdf.ts` / `export-excel.ts` 只负责排版与下载。

PDF（所有人同一份）：标题「QUOTATION」→ 报价标题 → 「Project: 项目名 | Version n」→ 报价头八项（Template、Currency、Trade Terms、Payment Terms、Delivery、Valid Until、MOQ、Origin）→ 行项表（#、Category、Item、Spec、Unit、Qty、Unit Price、Total）→ 合计两行（Subtotal、Total Amount）→ 页脚「Generated by QingYan AI | 日期」。与今天相比只少「Profit Margin」一行；内部成本、成本价、内部备注今天本来就不印，继续不印。

Excel：有财务查看权 → 内部成本表：「报价信息」表首行由「报价单信息」改为「内部成本表（含成本和利润率，不要发给客户）」，其余（内部成本、利润率、「成本价（内部）」一列）不变；导出菜单写「导出内部成本表（Excel）」。没有 → 首行「报价单信息」，没有「内部成本」「利润率」两行与「成本价（内部）」一列；菜单写「导出 Excel」。PDF 菜单项写「导出客户报价单（PDF）」。

- 备选 A：PDF 分客户版 / 内部版两种，内部版给有财务查看权的人。否决：同一版式、同一文件名规则（`标题_v版本.pdf`），发错的代价就是今天这个问题；内部分析已有 Excel（GATE ④ 可以改判）。
- 备选 B：只对没有财务查看权的人去掉利润率。否决：PDF 是给客户的，负责人导出时同样不该印——今天最常导出的正是负责人。
- 备选 C：Excel 也只出客户版。否决：内部成本表是负责人核算要用的，今天就在用。

### D6：报价 AI：没有资格的人不调模型

`POST …/quotes/{报价}/ai/review`：报价存在且不是引擎报价之后，`canViewInternal` 为假 → 403「AI 审查用到的成本和利润率只给项目负责人和有全企业「查看项目结算」权限的人看；需要的话请找项目负责人。」（由 `financeHiddenHintZh("AI 审查用到的成本和利润率", reason)` 拼成），不调模型。`POST …/quotes/ai/generate-draft`：`canEdit` 为假 → 403「没有生成：你不是本项目负责人，不能用 AI 起草报价单。要做报价，请项目负责人或组织管理员在项目成员里把你设为主负责人。」（后半句与 D4 同样按原因换），不读请求体、不调模型。有资格的人：请求、提示词、模型输入与返回逐字不变。模板推荐不涉及成本，不改。

- 备选 A：裁剪输入照样调一次模型（CHAIN-2e D4 式）。否决：旧报价单审查与起草的用处是改报价，看不到成本、改不了报价的人用不上；还要另写一份「不提供成本」的提示词，模型仍会凭空说「利润率偏低」（GATE ③ 可以改判）。
- 备选 B：调模型后过滤输出里的数字。否决：不确定（硬纪律 7），过滤不掉转述。
- 备选 C：起草也只要财务查看权。否决：草稿只能应用到编辑器里，不能编辑的人应用不了。

### D7：智能体报价技能与问青砚工具按执行的人判

报价技能（`src/lib/agent/skills/quote.ts`）按 `ctx.userId` 读用户（id、平台角色）与项目（组织、负责人），用 D1 得到能不能看：
- review：传入的 `quoteId` 必须属于 `ctx.projectId`，否则「报价单不存在」（今天不核对，可跨项目、跨组织取报价）；没传时取本项目最新一份（照旧）。看不到时：不调模型（`aiReview: null`，与今天 AI 失败时的形状相同）、规则检查用「看不到成本」选项（不出利润率检查项）、结果带 `costHidden: true`；评分照规则检查算。
- draft：看不到时不调模型，返回 `success: false`、`summary`「没有起草：起草报价草稿要看供应商报价并填成本价，只给项目负责人和有全企业「查看项目结算」权限的人用。」。
- recommend：不涉及成本，照旧。

问青砚 `project_bid_quote`（工具包装 `project-skills.ts` 里只对它）与 `project_get_project_quotes` 先用 `probeProjectAccess({ orgId, userId }, projectId, "read")`（`src/lib/supplier-intel/access.ts:104-116`，文件头写明与 `requireProjectReadAccess` 判定树逐条一致）判项目读权限，不过时返回与「项目不在本组织」同一句「项目不存在或不属于当前组织」、不读报价。`project_get_project_quotes` 对看不到的人每份报价 `profitMargin: null`、带 `costHidden: true`，`subtotal` / `totalAmount` 照旧。企业微信 @青砚 的回复只给发起人（`mention-gateway/policy.ts:195-198`），按发起人判不会把利润率带给第三人。

- 备选 A：在 `runStaticSkill` 里统一加项目读权限。否决：九个静态技能都走它，其余八个的口径不在本 change（FIX-21 后续 10 一类另开）；cron 巡检给未分发项目建的任务也走它（FIX-23 后续 3），一并改会改变巡检结果。
- 备选 B：只在工具包装里判财务查看权、技能不判。否决：智能体任务与一键投标方案也调这个技能，不经工具包装。
- 备选 C：在 agent-core 里照抄一份项目读权限判定。否决：第二份规则；`probeProjectAccess` 已是服务层投影。

### D8：询价接口里的供应商报价（GATE ①，推荐 A）

推荐 A：供应商单价、总价、报价备注只给有财务查看权的人看，录入也要有。`src/lib/inquiry/finance-view.ts` 的纯函数把条目的 `unitPrice` / `totalPrice` / `quoteNotes` 置 `null`；列表与单轮明细在每个轮次上加 `priceHidden: true`（+ 非默认时的 `hintReason`），旧比价在每行加；其余字段（币种、交期、有效期、状态、是否选定、沟通备注、供应商）与顺序不变——响应仍是原来的数组 / 对象，有权限的人形状不变。写接口（改轮次、加供应商、标已发 / 已回 / 已拒 / 未回复、选定与取消选定）照常执行、返回同样裁剪。`record-quote` 在判定为看不到时 403「没有录入：供应商报价只给项目负责人和有全企业「查看项目结算」权限的人看和录入；需要的话请找项目负责人。」，在读请求体之前返回，不写库、不推 Muse 事件、不触发阶段自动前进。服务层（`src/lib/inquiry/service.ts`）不改。

- 备选 B：财务查看权或项目写权限可看。否决：组织管理员（不是成员、没有财务键）照样看到——正是 FIX-21 后续 8 点名要收的人。
- 备选 C：保留（CHAIN-2e D3「询价同事要据原价追问供应商」）。否决：供应商报 DDP 加元时原价就是落地价，与对项目读者可见的我方报价（FIX-25 D6）相减就是毛利，CHAIN-2b / FIX-25 收的就是这种两价反推；BIDPAGE-2 已定新页面「报价」列只给有成本与财务查看权的人；Evan 对 CHAIN-2e GATE ① 的答复是「谁做报价谁就是负责人」。
- 备选 D：允许首次录入、只拒覆盖已有报价。否决：录完自己看不到、核对不了；规则多一条例外（GATE ① 可以改判）。
- 已知不一致（本 change 合并后、FIX-26b 之前）：比价矩阵 `quoted`、AI 报价分析的模型输入、询价追踪页仍给项目读者原价（出口表 #17 / #18），因为那几个文件正被 CHAIN-2e 改；报告照实列出。

### D9：界面：一句白话，不空白、不转圈

「看不到」的句子都由 CHAIN-2e 的 `financeHiddenHintZh(对象, reason)` 拼（「X只给项目负责人和有全企业「查看项目结算」权限的人看；需要的话请找项目负责人。」；没有真人负责人、授权查询出错时按它换句）；「不能编辑」的句子与 CHAIN-2e `src/lib/quote-engine/finance-hint.ts` 的 `QUOTE_EDIT_HIDDEN_HINT_ZH` / `QUOTE_EDIT_NO_OWNER_HINT_ZH` 同一句式，只把「新建、修改或批准报价」换成「新建、修改、确认或删除报价单」。

旧报价单编辑器：
- 看不到成本：顶部一行「报价单的内部成本和利润率只给项目负责人和有全企业「查看项目结算」权限的人看；需要的话请找项目负责人。」；行项表没有「成本价」一栏；合计条只有「报价总额」；顶部摘要不显示利润率；规则检查不出利润率检查项（`runQuoteChecks` 加「看不到成本」选项；不传时结果与改动前逐字相同）；AI 面板「输出版本」不出「内部成本表」。
- 不能编辑：表单与行项只读；不出「保存草稿」「确认报价」、AI 起草、AI 深度审查、「AI 自动流」；顶部写 D4 那句（去掉「没有改动：」前缀）。两句都要出时各出一次。
- 读取失败：「打不开这个报价单：」+ 接口给的原因（如「无权查看该项目」「报价单不存在」）；409 时再给「去报价页」链接（`href`）。不再出现空白的默认表单；只有还在读取时转圈。
- 导出：见 D5。

报价管理区块（`project-quote-section.tsx`）：`canEdit` 为假时不出「新建报价」，换成 D4 那句（去掉前缀）；列表照旧显示标题、模板、行数、总额。

询价明细表（`inquiry-detail.tsx`）：轮次带 `priceHidden` 时总价、单价两栏写「—」，备注栏不显示报价备注（沟通备注照旧），表格上方一行「供应商报价（单价、总价和报价备注）只给项目负责人和有全企业「查看项目结算」权限的人看；需要的话请找项目负责人。」，不出「录入报价」「更新报价」。

- 备选 A：看不到成本的人不让打开旧报价单。否决：卖价、条款、行项对项目读者本来开放，不让打开只多一个「为什么打不开」。
- 备选 B：成本价一栏保留但置灰。否决：置灰的空格读起来像「还没填」（CHAIN-2b D4 同理）。
- 备选 C：句子各处自己写。否决：CHAIN-2b / 2e 已合并（或合并在即）的同一常量拼成，才保证句式不漂。

### D10：裁剪写在纯函数里，路由、技能、工具共用

`src/lib/quote/finance-view.ts`（报价单）、`src/lib/inquiry/finance-view.ts`（询价）、`src/lib/quote/export-content.ts`（导出内容）都不 import `next/server` 与数据库，客户端组件也能 import 句子；有权限时纯函数返回与输入逐字段相同（测试用 `JSON.stringify` 比）。

- 备选：各路由自己删字段。否决：十几个路由各写一遍，单测覆盖不到；白名单只能定义一次。

## 八条硬纪律

1. 零 schema：遵守。不改 `prisma/`；`capabilities`、`costHidden`、`priceHidden`、`hintReason`、`href` 只是响应里的键。
2. 出站先审批：不涉及。不新增任何出站；PDF / Excel 是浏览器里生成、由人自己发的文件，本 change 让 PDF 不再带利润率。`record-quote` 被拒时不推 Muse 事件（那是给负责人本人的站内推送，本来就不算对外发送）。
3. 禁止第三套队列：不涉及。
4. 脱敏：触碰，本 change 就是收口。网页旧报价单、导出、报价 AI、智能体报价技能、问青砚两个工具对没有财务查看权的人不出内部成本、成本价、利润率（规格「没有财务查看权时旧报价单不带出的内容」「报价单 PDF 只有给客户的内容」的 SHALL NOT）；GATE ① 选 A 时询价接口不出供应商单价、总价、报价备注（规格「没有财务查看权时询价接口不带出的内容」）。Muse 通道不改，决定 A（所选供应商落地价可出）不变。
5. 不爬登录页：不涉及。
6. 邮箱分离：不涉及。
7. 确定性优先：触碰。裁剪、白名单、判定都是代码；不新增模型调用——AI 审查、AI 起草、智能体报价技能的审查与起草对没有资格的人不调模型（比今天少），有资格的人仍是原来那一次调用、输入逐字不变；测试里的模型是本机假服务。
8. 测试注册：触碰。五个新测试：`src/lib/quote/__tests__/export-customer-pdf.test.ts`、`legacy-quote-finance-view.test.ts`、`src/lib/inquiry/__tests__/inquiry-price-view.test.ts` 进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`；`src/lib/quote/__tests__/legacy-quote-finance-db.isolated.test.ts`、`src/lib/inquiry/__tests__/inquiry-price-view-db.isolated.test.ts` 进 `scripts/test-all.sh`；`bash scripts/check-test-registry.sh` 通过，基线文件不加行。

## 验证方式

- PDF：`npx tsx src/lib/quote/__tests__/export-customer-pdf.test.ts`——利润率为 23.45、为 `null`、行项带成本价三种输入，PDF 内容里任何字符串都没有「Margin」「利润」「23.45」与成本价的数；合计只有 Subtotal、Total Amount；源码断言 `export-pdf.ts` 不读 `profitMargin` / `internalCost` / `costPrice` / `internalNotes`。
- 纯函数与界面：`npx tsx src/lib/quote/__tests__/legacy-quote-finance-view.test.ts`——有权限时列表行、详情视图与输入逐字段相同；没有时置空项逐个为 `null`；详情白名单不含任何引擎字段与 `sourceJson`；兜底两条（出错、没有组织）；规则检查默认调用与改动前 `JSON.stringify` 相同、「看不到成本」时没有 `low_margin` / `margin_warning` / `high_margin`；Excel 两种内容；编辑器、合计条、行项表、AI 面板、报价管理区块的静态渲染与源码断言（看不到成本 / 不能编辑 / 读取失败 / 409 四种）。
- 询价纯函数与界面：`npx tsx src/lib/inquiry/__tests__/inquiry-price-view.test.ts`——裁剪、形状不变、明细表渲染（`priceHidden` 时「—」与那句话、没有录入按钮）。
- 隔离库 + HTTP：`NODE_ENV=test npx tsx src/lib/quote/__tests__/legacy-quote-finance-db.isolated.test.ts`——八种身份（只读成员、不是负责人的项目管理员、operator、不是成员没有财务键的组织管理员、只在分配范围持 `project.finance.read` 的投标同事、持组织范围 `project.finance.read` 且项目角色 viewer 的成员、项目负责人、平台超级管理员）+ 不是项目成员的普通组织成员（工具）；授权查询出错用注入的判定测；旧报价单与引擎报价各一份（成本价 17.31、内部成本 91,234.56、利润率 23.45、`summaryJson.estimatedCost` 87,654.32）；列表、详情、写（403 / 409 后库不变）、AI 两个接口（本机假模型服务：被拒 0 次、有资格 1 次且请求正文与改动前相同）、报价技能 review / draft（跨项目 `quoteId` 被拒）、两个问青砚工具；没有财务查看权的每个响应 JSON 里搜不到这几个数。
- 询价隔离库：`NODE_ENV=test npx tsx src/lib/inquiry/__tests__/inquiry-price-view-db.isolated.test.ts`——同一组身份 × 列表 / 明细 / 旧比价 / 写接口返回 / `record-quote`（403 后库不变、没有 Muse 事件）；搜不到供应商单价 12.34、总价 4,567.89 与报价备注里的那句话。
- 守卫：`npx tsx src/lib/projects/__tests__/project-routes-guard.test.ts` 全过（改的路由第一步仍是项目读 / 写权限）。
- 全量：`npm test`（只有 main 上同样的既有失败）、`npm run test:ci`、`npm run typecheck`、`npm run lint:baseline`、`bash scripts/check-test-registry.sh`、`npx openspec validate quote-inquiry-cost-finance-gate --strict`、`git diff origin/main -- prisma/ vercel.json` 为空。

## Risks / Trade-offs

- **合并当天就收紧，没有开关**：不是负责人的投标同事（项目管理员、operator）、没有财务键的组织管理员看不到旧报价单的成本与利润率，不能再建 / 改 / 确认 / 删旧报价单、不能用报价 AI；GATE ① 选 A 时也看不到、录不了供应商报价。影响面要看生产数据（tasks 8.1 的只读查询：近 90 天旧报价单由谁建、谁改；谁录过供应商报价），GATE ② / ① 确认。
- 没有派发负责人的项目（负责人是导入用的系统账号）只有平台超级管理员与持组织范围财务键的人能看、能改；提示改为找组织管理员（CHAIN-2e D9 的同一句），合并前按 CHAIN-2e 的 `docs/acceptance/chain-2e/prod-check.sql` 补负责人。
- 没有组织的老项目：只有负责人与平台超级管理员能看能改（与 CHAIN-2e 同规则）。
- 已经发出去的 PDF 收不回来：PDF 在浏览器生成、不留痕，系统查不到哪些客户收到过带利润率的报价单——报告照实写，要不要通知业务由人定。
- 合并后、FIX-26b 之前，供应商原价仍从比价矩阵、AI 报价分析、追踪页、供应商履历出去（出口表 #17–#20）；「项目读者拿不到供应商报价」要等 FIX-26b 才成立。
- 每次旧报价单 / 询价请求多 2 次 `authorize`（与成本核算接口同代价），看不到时多一次查负责人账号（选句子）。
- 有财务查看权的人在问青砚里拿到的利润率会留在他自己的会话记录里；工具结果写进智能体运行记录后还有谁能读，没核实（见报告）。
- 行项「备注」是自由文本，AI 草稿可能写进「按供应商报价加价 30%」一类的话，裁剪不了；本 change 之后只有能编辑的人能应用 AI 草稿，已存的备注照旧显示。

## 与在审 / 并行 change 的关系

- **CHAIN-2e `finance-view-compare-quote-gate`（#556，`35e9ae91`）**：它管出口表 #17 的落地价、#18 的落地价、#22，以及新增 `resolveFinanceViewSafe`、`view-hint.ts`、`finance-hint.ts`、`resolveQuoteCapabilities` 新签名——本 change 只 import，不改它的任何文件，所以没有文本冲突；它的 Out of scope 与报告 §5 写的「legacy 报价接口……打开 `TENDER_QUOTE_ENGINE_ENABLED` 之前必须修」与「问青砚 `project_get_project_quotes`」就是本 change 的 #1–#11。它的 D3 有意保留供应商原价，与本 change D8 推荐 A 相反，交 GATE ①。顺序：CHAIN-2e 先合，本 change task 2 起再开工。
- **FIX-25 `target-margin-finance-gate`（`/home/user/wt/fix25`，实现中）**：改 `src/lib/tender-pricing/finance-view.ts`、`pricing-helper` 路由与卡、两个房间 JSON 接口；它的出口表 #7 / #8 就是本 change 的 #1–#11，写明「归 FIX-26」。没有共同文件，只有 `scripts/test-all.sh`、`scripts/test-ci-unit.sh` 各加几行（后合的一方变基即可）。`COST_ACCESS_HINT_ZH` 的文字 FIX-25 不改。
- **BIDPAGE（另一个会话）**：BIDPAGE-3（#564，已合并）的逐行报价存在 `ProjectQuote`（`orgId` 不为空），今天经旧报价单 `PATCH` 能被只读成员删客户行、覆盖成本列、改状态——本 change 的 D3 把它们挡在旧接口之外，不改 BIDPAGE 的任何文件。按 `docs/QINGYAN_BIDPAGE_HANDOFF.md` 与任务书，后面可能碰到同一批文件的有：BIDPAGE-2（把 `ProjectInquirySection` 等三块合成「本项目的供应商」一张表，「报价」列只给有成本与财务查看权的人；可能改 `src/components/inquiry/**`）、BIDPAGE-8（判断点 4「旧版报价单收进『更多』、名字去掉 legacy」，界面中文化；可能改 `src/components/quote/project-quote-section.tsx`）、BIDPAGE-7（内部项目分析 PDF，不是本 change 的文件）。BIDPAGE-4 / -5 / -6 只动 `src/lib/bid-page-v2/**`、`src/components/bid-page-v2/**` 与报价引擎，不碰旧报价单与询价文件。交叠写进 GATE ⑥。

## 留给 GATE

1. **询价里的供应商原价给谁（D8）**：A 只给有财务查看权的人看和录（推荐）／B 财务查看权或项目写权限／C 保留给所有项目读者（CHAIN-2e D3 原判）。推荐 A：原价与可见的我方报价相减就是毛利；BIDPAGE-2 已按 A 定新页面；「谁做报价谁就是负责人」。选 A 时 FIX-26b 在 CHAIN-2e 合并后收出口 #17–#20；选 C 时删掉本 change 的 task 5 与 task 6 里询价的部分、规格 `tender/inquiry-supplier-price-view`。附带：录入是否放行首次录入（D8 备选 D），推荐不放行。
2. **旧报价单谁能改（D4）**：与报价引擎同口径（推荐）／只要财务查看权／保持项目读权限可写。推荐同口径：CHAIN-2e GATE ①「不是负责人的投标同事不新建、编辑、批准报价」的延伸，一个人在两处得到同一个答案。
3. **AI 审查对没有财务查看权的人（D6）**：403 不调模型（推荐）／裁剪输入调一次（CHAIN-2e D4 式）。推荐 403：看不到成本的人改不了报价，审查结论用不上；不必另写提示词。
4. **要不要内部版 PDF（D5）**：不出，内部看 Excel（推荐）／给有财务查看权的人出一份带「INTERNAL — NOT FOR CLIENT」水印、文件名带 `_internal` 的内部版。
5. **拆分（推荐拆成三个 PR）**：
   - FIX-26a「报价单 PDF 不再印利润率」：只有 task 1（`export-pdf.ts` + 新纯模块的 PDF 部分 + 一个测试），不依赖 CHAIN-2e，当天可合；这是唯一从客户手里出去的口子。
   - FIX-26（本 change 其余）：出口 #1–#11，等 CHAIN-2e 合并。
   - FIX-26b（GATE ① 选 A 时）：把本 change 的 #12–#16 移过去，与 #17–#20 供应商原价的全部出口一次收（含 CHAIN-2e 的矩阵 `quoted`、AI 报价分析输入、追踪页，与供应商履历、组织汇总），避免「询价明细藏了、同一页的 AI 分析和追踪页还在」的半截状态；与 BIDPAGE-2 同步（它要重做询价表）。
   - 不拆也能做：8 条 task 已按这三块排，拆时把 task 1 拿出去、task 5 与 task 6 的询价部分移走。
6. **与 BIDPAGE 的交叠（协调会话与 BIDPAGE 会话定）**：本 change 改 `src/components/quote/project-quote-section.tsx`（不能编辑时的「新建报价」与一句话）与 `src/components/inquiry/inquiry-detail.tsx`（价格栏与录入按钮）；BIDPAGE-8 可能改前者、BIDPAGE-2 可能改或替换后者。推荐：本 change 先合，BIDPAGE-2 / -8 变基时保留这两处判断；BIDPAGE-2 的新表直接读本 change 接口的 `priceHidden`，不另判一遍。BIDPAGE 交接 §5 上线前置条件第 2 条（旧接口的金额口径）在本 change 与 FIX-26b 合并后才完全成立。
7. **依赖顺序**：CHAIN-2e 合并前不开 task 2（推荐）／CHAIN-2e 迟迟不合时先用 CHAIN-2b 的 `resolvePricingCostVisibility` 与本地句子，CHAIN-2e 合并后再改调（多一次返工）。
8. **开关**：不设，合并即生效（推荐）。理由：这是收口不是新功能；有权限的人行为不变；没权限的人今天拿到的本来就不该拿；CHAIN-2b / 2e 同样不设。
9. **顺手的小问题（另开小改动，不在本 change）**：版本历史抽屉与报价管理区块把引擎报价链到旧编辑器（本 change 之后会看到 409 那句和去报价页的链接）；旧报价单 `PATCH` 接受任意 `status`；AI 面板「输出版本」三个按钮没有接线。
