# Design：旧报价单、Excel、报价 AI 与报价工具里的内部成本和利润率只给有财务查看权的人（FIX-26）

## Context

### 口径现状

「财务查看权」= `src/lib/project-finance/access.ts` 的 `resolveFinancePrivilege(user, orgId, ownerId).canReadAll`：平台超级管理员、持组织范围 `project.finance.manage` 或 `project.finance.read` 的人、项目负责人（PERM-4c1 起不认 `org_admin`；`bids` 岗位的 `project.finance.read` 只在 ASSIGNED 范围，不算）。已按它收口的：成本核算 `bid-workspace/cost-sheet`、CHAIN-2 寻源卡、CHAIN-2b 报价表助手（#532）、BIDPAGE-1 / BIDPAGE-3 的金额门。CHAIN-2e（#556，分支 `claude/inspiring-johnson-o54xbt-chain-2e`，`35e9ae91`，已审完、等生产查询后合并）把报价引擎、比价矩阵 / AI 报价分析的落地价、询价追踪页的落地价也收到这个口径，并新增带兜底的入口 `resolveFinanceViewSafe`（出错只剩超级管理员与负责人，标 `unconfirmed`）、`resolveFinanceHintReason`、提示句 `financeHiddenHintZh`（`src/lib/project-finance/view-hint.ts`）、`src/lib/quote-engine/finance-hint.ts` 的句子与 `resolveQuoteCapabilities(access, { finance })`（能看 = `canReadAll`；能编辑 = 能看 ∧（`privileged` ∨ 项目角色有 `project:cost:write`））。本 change 叠在 CHAIN-2e 分支上实现，直接用这些。

旧报价单在生产上天天在用、没有开关：投标页签 `src/components/project-detail/tabs/bid-tab.tsx:51-53` → `BidQuoteArea`，报价引擎开关没开时只渲染旧报价单区块（`src/components/quote-engine/bid-quote-area.tsx:16`）。BIDPAGE 新页面把它挂在金额门里（`src/components/bid-page-v2/bid-page-v2.tsx:111-122`），但交接文档 §3 写明金额门「只决定挂不挂，不是数据保护」。

同一张表：报价引擎与逐行报价（BIDPAGE-3）建的报价也存在 `ProjectQuote`，`orgId` 不为空（`src/lib/quote-engine/service.ts:150-153`、`src/lib/bid-page-v2/quote-line/service.ts:170-173`）；引擎快照把估算成本、售价、毛利率写进 `internalCost` / `totalAmount` / `profitMargin` 三列，把估算成本、毛利、毛利率、加成、成本分解、情景写进 `summaryJson`（`service.ts:231-241`）。旧路由建报价从不写 `orgId`（`src/app/api/projects/[id]/quotes/route.ts:44-53`、`save-ai-draft/route.ts:30-44`），所以 `orgId` 是否为空就是「旧报价单 / 报价引擎的报价」的分界。

### 出口清单（2026-11-23 在 `c376be86` 上逐条核对）

「项目读者」= `requireProjectReadAccess`（`src/lib/projects/access.ts:116-166`）：平台超级管理员、负责人、项目所在组织的 `org_admin`（不必是项目成员）、任一 active 项目成员（含 `viewer`、`tester`）。「项目写者」= `requireProjectWriteAccess`（`:54-110`）：平台超级管理员、负责人、`org_admin`、`project_admin`。

本 change 处理（都没有开关，生产在跑）：

| # | 出口 | 谁能拿到（真实守卫） | 拿到什么 | 改成什么 |
|---|---|---|---|---|
| 1 | `GET …/quotes`（`quotes/route.ts:7-31`） | 项目读者 | 每份报价 `totalAmount` + `profitMargin`（`:22-23`），两数配对即成本 = 总额 ×（1 − 利润率）；查询不按来源过滤（`:12-13`），把报价引擎与逐行报价建的报价也列出来，点开进旧编辑器能导出旧版 PDF（引擎的可选行照印、算进 Subtotal、不算税，总额与报价页对不上） | 只列 `orgId` 为空的旧报价单（D3）；没有财务查看权：`profitMargin: null`，带 `costHidden`；所有人多带 `capabilities` |
| 2 | `GET …/quotes/{报价}`（`[quoteId]/route.ts:9-26`） | 项目读者 | 整行 + 行项：`internalCost`、`profitMargin`、`internalNotes`、`aiDraftJson`（AI 草稿，每行带 `costPrice`）、`aiReviewJson`；引擎报价还有 `pricingRate`、`pricingMethod`、`engineJson`、`summaryJson`、`customerJson`、`termsJson`，行项 `costPrice`、`sourceJson` | 对所有人只给旧报价单字段（D2）；没有财务查看权：内部成本、利润率、内部备注、AI 草稿 / 审查原文、行 `costPrice` 为 `null`，带 `costHidden`；引擎报价 409（D3） |
| 3 | `PATCH …/quotes/{报价}`（`:28-110`） | 项目读者（只读成员也能改价、把 `status` 改成任意值、整组替换行项并重算成本列；请求里的 `isInternal` 原样存下，`:88`） | 返回同 #2 的整行 | 要能编辑（D4），否则 403 不写库；引擎报价 409；每行一律存成非内部行（D10）；返回按 #2 |
| 4 | `POST …/quotes`、`DELETE …/quotes/{报价}`、`POST …/quotes/save-ai-draft` | 项目读者 | 建 / 删草稿；`save-ai-draft` 把整份 AI 草稿存进 `aiDraftJson` | 要能编辑；`DELETE` 引擎报价 409 |
| 5 | `POST …/quotes/{报价}/ai/review`（`ai/review/route.ts:9-81`） | 项目读者 | 每行成本价、内部成本、利润率交给模型（`:49`、`:53-54`；提示词 `src/lib/ai/prompts/trade.ts:212`、`:217-219`，「利润率 < 5% 必须标记 urgent」`:249`），审查结论原样回给调用者 | 没有财务查看权 403、不调模型；引擎报价 409（D6） |
| 6 | `POST …/quotes/ai/generate-draft`（`generate-draft/route.ts:11-104`） | 项目读者 | 本项目已报价供应商的单价 / 总价交给模型（`:31-45`、`:59-66`），返回的草稿每行带 `costPrice`（提示词「costPrice 是内部成本参考」`trade.ts:116`）、`internalNotes`、`reasoning`（定价依据） | 不能编辑 403、不调模型（D6） |
| 7 | 旧报价单编辑器（`src/components/quote/quote-editor.tsx`） | 能打开编辑器的人 = 项目读者 | 内部成本（`quote-summary-bar.tsx:52-60`）、利润率（`:62-70`；`quote-top-summary.tsx:44-47,85,116-119,143-155`）、成本价一栏（`quote-line-table.tsx:82,159-165`）、规则检查「利润率 X%，低于 5% 安全线」（`src/lib/quote/rules.ts:67-95`）；读取失败时 `if (!res.ok) return;`（`quote-editor.tsx:68`）留下空白默认表单 | 按 `capabilities` / `costHidden` 显示（D8） |
| 8 | Excel（`src/lib/quote/export-excel.ts:43-47,55,66`；`quote-editor.tsx:25,326`） | 能打开编辑器的人 | 「内部成本」「利润率」「成本价（内部）」 | 有财务查看权：内部成本表；没有：不含这三样（D5） |
| 9 | 智能体报价技能 `src/lib/agent/skills/quote.ts` | 问青砚 `project_bid_quote`（`src/lib/agent-core/tools/project-skills.ts:108-130`；工具角色 admin / sales，`_policy.ts:116`；`runStaticSkill` 只核对项目所属组织，`src/lib/agent-core/skills/static-bridge.ts:67-79`，不查项目读权限）；智能体任务里执行这一步的人（`flow-runner.ts:344-348`）；一键投标方案（项目写者，`run-step/route.ts:114-117`） | review：按传入的 `quoteId` 取报价、**不核对属于本项目**（`:179-187`）；成本价、内部成本、利润率交给模型（`:249`、`:253-254`）；规则检查带利润率（`:230`）。draft：供应商单价 / 总价交给模型（`:94-102`），返回带 `costPrice` 的草稿（`:148-152`） | 按执行的人判（D7）：`quoteId` 必须属于本项目；没有财务查看权时 review 不调模型、规则检查不评利润率，draft 不调模型；问青砚路径先查项目读权限 |
| 10 | 问青砚 `project_get_project_quotes`（`src/lib/agent-core/tools/enterprise-readonly.ts:516-557`） | 本组织任一 active 成员（`requireOrgMember` `:19-31`，不查项目读权限）；企业微信 @青砚 的项目上下文也能调（`src/lib/mention-gateway/policy.ts:33-42`，回复只给发起人 `:195-198`）；数字员工技能「投标废标风险检查」用它（`src/lib/agent-core/skills/tender-seed.ts:127`） | 每份报价 `subtotal`、`totalAmount`、`profitMargin`（`:548-550`） | 先查项目读权限；没有财务查看权 `profitMargin: null`、带 `costHidden`（D7） |
| 11 | 审计日志详情 `GET /api/audit-logs/{id}`（`src/app/api/audit-logs/[id]/route.ts:14-80`；界面 `src/app/(main)/admin/audit-logs/page.tsx:172`） | 平台超级管理员；本组织任一 active 组织管理员（任何一条，`:45-46`）；带项目的那几条另给该项目 active 的 `project_admin`（`:47-61`）——都不看财务查看权；没有开关。审计 id 从审计列表或项目动态拿得到（`src/lib/activity/formatter.ts:143`） | 整行 `beforeData` / `afterData` 原样解析返回（`:72-73`）。报价引擎另起新版时写进去的 `sourceCost`（估算成本）、`sourceMargin`（毛利率）（`src/lib/quote-engine/service.ts:351`，逐行报价另起新版也走这里）；项目财务预测的 `expectedRemainingCostCad`（`src/lib/project-finance/forecast-service.ts:45`）；Muse 账本行把整份回复（含所选供应商落地价）写进 `afterData`（CHAIN-2e 报告）。FIX-25 安全审查 S1 复现：不是负责人的项目管理员与组织管理员读到 `"sourceCost":100402.74,"sourceMargin":16.59`，只读成员 403；开关关掉后已写的行照样能读 | 读取侧裁剪（D11）：没有财务查看权的人，`beforeData` / `afterData` 里成本、毛利、落地价类键的值置 `null`，带 `costHidden` 与被藏的键路径；写入侧不再往另起新版的审计里写估算成本与毛利率（留给 GATE ④ 推荐 C） |

不在本 change（写明归属）：

| # | 出口 | 谁能拿到 | 拿到什么 | 归属 |
|---|---|---|---|---|
| 12 | 报价单 PDF（`src/lib/quote/export-pdf.ts:137-139`） | 能打开编辑器的人 | 「Profit Margin: x%」印在给客户的报价单上 | **FIX-26a**（`quote-pdf-no-margin`，已单独实施）：对所有人不印 |
| 13 | 询价列表 `GET …/inquiries`、单轮明细 `GET …/inquiries/{轮次}`、旧比价 `GET …/inquiries/{轮次}/compare`（`src/lib/inquiry/service.ts:176-202,438-462`）；询价写接口的返回；`record-quote`；询价明细表（`src/components/inquiry/inquiry-detail.tsx:186-203,326`） | 项目读者（写接口：项目写者） | 每家供应商单价、总价、报价备注 | **FIX-26b**（待 Lucas 答 GATE ①） |
| 14 | 比价矩阵 / AI 报价分析里的原价 `quoted` 与模型输入里的原价 | 项目读者 | 供应商原价（CHAIN-2e D3 有意保留；落地价 CHAIN-2e 已收） | FIX-26b |
| 15 | 询价追踪页「报价 CAD x / 件」（`src/lib/tender-rfq/tracker-pure.ts:232-233`） | 每行所在项目的读者 | 供应商原价 | FIX-26b |
| 16 | 供应商履历 `GET /api/suppliers/{供应商}/history`（`src/lib/supplier/service.ts:139-174`） | 本组织 active 成员，不看项目 | 跨项目每次询价的 `totalPrice` | FIX-26b |
| 17 | 组织项目智能的供应商平均单价（`src/lib/projects/supplier-performance.ts:21-41`） | 本组织 active 成员 | 跨项目、跨品类的平均单价 | FIX-26b |
| 18 | Muse `compare` / `price_scenario` | 有 Muse 身份的组织成员（只按组织取，`router.ts:480-481`） | 所选供应商落地价（决定 A）、矩阵 | CHAIN-2e 登记的「编号待定」 |
| 19 | 报价引擎 14 个路由文件、「报价与成本」卡、单个报价页 | 改动前：项目角色带 `project:cost:read`（含 viewer） | 估算成本、毛利率 | CHAIN-2e |
| 20 | 逐行报价 `bid-page/quotes/**` | 金额门（`src/lib/bid-page-v2/quote-line/api-gate.ts:20-27`） | 成本行、毛利 | BIDPAGE-3，已收；它的报价经 #1–#3 的旧接口仍可读写——本 change 用 D3 堵上 |
| 21 | 报价表助手的目标毛利、房间 JSON 的 `pricingInputs` / `bidDraft` | 项目读者；项目列表是组织成员 | 目标毛利、成本、镜像的我方报价 | CHAIN-2b / FIX-25 |

核对后不是出口的：项目 AI 上下文只带报价标题、状态、总额（`src/lib/projects/project-ai-context.ts:84-88`，卖价）；问青砚 `project_get_project_inquiries` 只给轮次与条数（`enterprise-readonly.ts:478-514`）；AI 记忆只记供应商名与状态（`src/lib/ai/memory.ts:117-127`）；旧报价单路由不写审计、不发通知；项目动态只拼固定字段（`src/lib/activity/formatter.ts:232-247`）；审计列表不返回 `afterData`（`src/lib/audit/query.ts:23-27`；审计详情见 #11）；模板推荐 `quotes/ai/recommend-template` 只给项目资料。

## Goals / Non-Goals

**Goals**：出口表 #1–#11 里，没有财务查看权的人拿不到内部成本、成本价、利润率（含引擎写进同表的毛利率）；没有资格的人不能改旧报价单、不能触发报价 AI、不能经旧接口动报价引擎的报价；界面写一句为什么、找谁，不停在空白或转圈；有财务查看权且能编辑的人看到、改到、导出的一切与改动前相同。

**Non-Goals**：
- `src/lib/quote/export-pdf.ts`（FIX-26a）。
- 询价：`src/app/api/projects/[id]/inquiries/**`、`src/lib/inquiry/**`、`src/components/inquiry/**`、`src/app/api/suppliers/**`、`src/lib/supplier/**`、`src/app/api/org/**`、`src/lib/projects/supplier-performance.ts`（FIX-26b）。
- `src/lib/muse-bridge/**`（决定 A；间接影响见 proposal）。
- CHAIN-2e 的文件：`src/lib/tender-rfq/**`、`src/app/api/projects/[id]/inquiries/[inquiryId]/compare/**`、`src/components/bids/rfq-tracker.tsx`、`src/app/api/projects/[id]/quote-engine/**`、`src/components/quote-engine/**`、`src/lib/quote-engine/**`（只 import `access.ts` 的 `resolveQuoteCapabilities` 与 `finance-hint.ts` 的句子，不改；唯一例外是 `service.ts:351` 另起新版那条审计的写入内容，留给 GATE ④ 选 B 或 C 时才改）；`src/lib/project-finance/access.ts`、`src/lib/project-finance/view-hint.ts`（只 import）。
- FIX-25 的文件：`src/lib/tender-pricing/**`、`src/app/api/projects/[id]/pricing-helper/route.ts`、`src/components/tender/pricing-helper-card.tsx`、`src/app/api/projects/route.ts`、`src/app/api/projects/[id]/bid-intelligence/route.ts`。
- BIDPAGE 的文件：`src/lib/bid-page-v2/**`、`src/app/api/projects/[id]/bid-page/**`、`src/app/api/projects/[id]/bid-page-summary/route.ts`、`src/components/bid-page-v2/**`、`src/components/quote-engine/bid-quote-area.tsx`。
- `src/components/project-detail/version-history-drawer.tsx`、`src/components/project-detail/tabs/bid-tab.tsx`（链接与挂载不改；GATE ⑨ 登记「待定」）。
- `src/lib/ai/prompts/trade.ts`（提示词不改：有资格的人模型输入逐字不变，没资格的人不调模型）。
- `src/lib/agent-core/skills/static-bridge.ts`、`flow-runner.ts`（其余八个静态技能的口径不在本 change）。
- `prisma/`、`vercel.json`、`package.json`、环境变量。

## Decisions

### D1：判定沿用 CHAIN-2e 的带兜底入口与报价能力公式，本 change 不写第二份

所有出口用 `resolveFinanceViewSafe(user, project.orgId, project.ownerId)` 得到财务能力，再用 `resolveQuoteCapabilities(access, { finance })` 得到 `canViewInternal` / `canEdit`；看不到或不能编辑时用 `resolveFinanceHintReason` 选句子（`unconfirmed` / `no_owner`），默认那句不带 `hintReason`。项目没有组织时按「不持组织键」算（只剩负责人与平台超级管理员）。旧报价单的「能编辑」与报价引擎同一公式（GATE ② 已定；CHAIN-2e TASKFLOW 那一行写的「改状态要求与报价引擎同一口径」）。

- 备选 A：用 CHAIN-2b 的 `resolvePricingCostVisibility`。否决：只回一个布尔，没有「暂时无法确认」与特权位，编辑口径还得另写；CHAIN-2e 合并后两份兜底本来要收成一份。
- 备选 B：沿用项目读权限 + 项目角色 `project:cost:read`。否决：`viewer` 也带这项权限（`src/lib/rbac/permissions.ts:193`），等于不收。
- 备选 C：新增权限键「看旧报价单成本」。否决：多一套口径，要走岗位目录登记。
- 依赖：叠在 CHAIN-2e 分支上实现，CHAIN-2e 合并后变基到 main 再合（GATE ⑦ 已定）；CHAIN-2e 长期不合时由协调会话再定。

### D2：旧报价单读取：裁剪而不是整接口 403；详情改为固定白名单

`src/lib/quote/finance-view.ts` 的纯函数：列表行 `profitMargin` 按能不能看置空；详情只拼旧报价单字段——`id`、`projectId`、`templateType`、`version`、`status`、`title`、`currency`、`tradeTerms`、`paymentTerms`、`deliveryDays`、`validUntil`、`moq`、`originCountry`、`subtotal`、`totalAmount`、`internalCost`、`profitMargin`、`internalNotes`、`aiGenerated`、`aiDraftJson`、`aiReviewJson`、`inquiryId`、`createdById`、`createdAt`、`updatedAt`，行项 `id`、`sortOrder`、`category`、`itemName`、`specification`、`unit`、`quantity`、`unitPrice`、`totalPrice`、`remarks`、`costPrice`、`isInternal`——不能看时把内部成本、利润率、内部备注、AI 草稿 / 审查原文、行 `costPrice` 置 `null`，加 `costHidden: true`。所有人多带 `capabilities: { canViewInternal, canEdit }`（+ 非默认时的 `hintReason`）。编辑器只读这些字段（`quote-editor.tsx:71-102`），白名单不丢它用的任何东西。

- 备选 A：没有财务查看权整接口 403。否决：卖价、条款、行项对项目读者本来开放（与报价引擎客户视图同理），403 让旧报价单区块与编辑器全空。
- 备选 B：删键而不是置 `null`。否决：编辑器与列表按键读，`null` + `costHidden` 更清楚、形状稳定。
- 备选 C：详情照旧原样返回整行、只把几个成本列置空。否决：引擎报价的 `summaryJson`、`engineJson`、`pricingRate` 等十几个键都含成本或毛利，逐个黑名单漏一个就是泄露；白名单一处定义。
- 备选 D：只对引擎报价裁剪。否决：旧报价单自己的 `internalCost` / `profitMargin` / `costPrice` 就是成本。

### D3：旧接口不处理报价引擎的报价

`orgId` 不为空的报价经 `GET` / `PATCH` / `DELETE …/quotes/{报价}` 与 `POST …/ai/review` → 409「这份报价是在报价页里做的，旧报价单不能打开或修改它；请到报价页查看和修改。」，带 `href: /projects/{项目}/quote-engine/{报价}`；不写库、不调模型。列表 `GET …/quotes` 同一口径：查询加 `orgId: null`，只列旧报价单（留给 GATE ③ 的推荐 A）；报价管理区块、版本历史抽屉随之只显示旧报价单，引擎报价在报价引擎区块与新页面的报价列表里看。判定顺序：项目读权限 → 报价不存在 404 → 引擎报价 409 → 编辑权 403（写）/ 财务查看权 403（审查）。

- 备选 A：旧接口照旧读写引擎报价、只做 D2 的裁剪。否决：旧 `PATCH` 带行项时先删掉这份报价的全部 `QuoteLineItem`（客户报价行，`[quoteId]/route.ts:72-73`），再按旧算法重算小计、总额、内部成本、利润率四列，覆盖引擎快照；`status` 不经状态机直接改（CHAIN-2e 报告 §5：只读成员能改成 `approved`，绕过 GATE ①）；BIDPAGE-3 逐行报价同样受影响。
- 备选 B：按 `calcVersion` 或 `quoteType` 区分。否决：旧报价单的 `quoteType` 默认就是 `CUSTOM`，与引擎的 CUSTOM 类型同值；`calcVersion` 要等引擎第一次快照才写。`orgId` 是建行时定的，旧路由从不写。
- 备选 C：旧编辑器遇到引擎报价自动跳转。否决：跳转是界面行为，接口仍得 409；编辑器写一句加链接就够（D8）。
- 备选 D（列表）：照旧列出引擎报价，每行标 `engineQuote: true` 与 `href`，报价管理区块与版本历史抽屉把这些行链到报价页。否决为默认（留给 GATE ③ 可改判）：要多改版本历史抽屉；老页面开着报价引擎时报价管理区块与引擎区块重复列同一批报价；BIDPAGE-8 判断点 4「项目没有旧报价单就不显示旧版报价单」要按旧报价单数，列表混着引擎报价数不准。代价是版本历史抽屉里不再有引擎报价那几行。

### D4：旧报价单的写要「能编辑报价」（GATE ② 已定 A）

`POST …/quotes`、`PATCH` / `DELETE …/quotes/{报价}`、`POST …/quotes/save-ai-draft` 在 `canEdit` 为假时 403「没有改动：你不是本项目负责人，不能新建、修改、确认或删除报价单。要做报价，请项目负责人或组织管理员在项目成员里把你设为主负责人。」（没有真人负责人时后半句换成 CHAIN-2e 的「这个项目还没有指定负责人，请找组织管理员在项目成员里把做报价的同事设为主负责人。」；授权查询出错时整句换成「没有改动：暂时无法确认你的查看权限，请稍后刷新。」），不读请求体、不写库。`canEdit` 为假的人一定不是负责人（负责人是特权，CHAIN-2e D8 同一推理），所以「你不是本项目负责人」成立。能编辑的人行为不变；`PATCH` 返回按 D2（能编辑的人都能看，返回带成本）。守卫仍是处理函数第一步（`src/lib/projects/__tests__/project-routes-guard.test.ts`）。

- 备选 A：只拒「碰了成本」的保存（CHAIN-2b D3 式）。否决：旧编辑器每次保存与确认都整组带行项与成本价（`quote-editor.tsx:116`、`:147-150`），等于全拒；要放行「只改表头」就得改编辑器的保存逻辑，`status` 改成「已确认」也是表头。
- 备选 B：只要财务查看权（不看项目角色的成本写权限）。否决：与报价引擎口径不同（会计岗 + 只读项目角色能看不能改，CHAIN-2e D2）；两套「能改报价」的说法会让同一个人在两处得到不同答案。
- 备选 C：保持项目读权限可写。否决：只读成员能改价、确认、删草稿，与 FIX-21 的读 / 写分级相反。
- 代价：不是负责人的投标同事合并当天就不能再建 / 改旧报价单——CHAIN-2e GATE ①（「不是项目负责人的投标同事不能新建、编辑、批准报价」，Lucas 已答）的延伸。

### D5：Excel 按财务查看权分两种；不出内部版 PDF（GATE ④ 已定）

`export-excel.ts` 把两张表的内容抽成同文件里的纯函数（下载仍由原函数做），按能不能看成本选内容。有财务查看权 → 内部成本表：「报价信息」表首行由「报价单信息」改为「内部成本表（含成本和利润率，不要发给客户）」，其余（内部成本、利润率、「成本价（内部）」一列）不变；导出菜单写「导出内部成本表（Excel）」。没有 → 首行「报价单信息」，没有「内部成本」「利润率」两行与「成本价（内部）」一列；菜单写「导出 Excel」。导出菜单的 PDF 项写「导出客户报价单（PDF）」（PDF 内容本身由 FIX-26a 定：对任何人不印利润率）。

- 备选 A：再出一份带利润率的内部版 PDF。否决：GATE ④ 已定不出——同一版式、同一文件名规则，发错的代价就是 FIX-26a 修的那个问题。
- 备选 B：Excel 也只出客户版。否决：内部成本表是负责人核算要用的，今天就在用。
- 备选 C：Excel 内容照旧，只靠接口不给成本。否决：没有成本时 `calculateTotals` 把卖价当成本，Excel 会写出「内部成本 = 小计」「利润率 0%」，读起来像真数字。

### D6：报价 AI：没有资格的人不调模型（GATE ③ 已定）

`POST …/quotes/{报价}/ai/review`：报价存在且不是引擎报价之后，`canViewInternal` 为假 → 403「AI 审查用到的成本和利润率只给项目负责人和有全企业「查看项目结算」权限的人看；需要的话请找项目负责人。」（由 `financeHiddenHintZh("AI 审查用到的成本和利润率", reason)` 拼成），不调模型。`POST …/quotes/ai/generate-draft`：`canEdit` 为假 → 403「没有生成：你不是本项目负责人，不能用 AI 起草报价单。要做报价，请项目负责人或组织管理员在项目成员里把你设为主负责人。」（后半句与 D4 同样按原因换），不读请求体、不调模型。有资格的人：请求、提示词、模型输入与返回逐字不变。模板推荐不涉及成本，不改。

- 备选 A：裁剪输入照样调一次模型（CHAIN-2e D4 式）。否决：旧报价单审查与起草的用处是改报价，看不到成本、改不了报价的人用不上；还要另写一份「不提供成本」的提示词，模型仍会凭空说「利润率偏低」。
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

### D8：界面：一句白话，不空白、不转圈

「看不到」的句子都由 CHAIN-2e 的 `financeHiddenHintZh(对象, reason)` 拼（「X只给项目负责人和有全企业「查看项目结算」权限的人看；需要的话请找项目负责人。」；没有真人负责人、授权查询出错时按它换句）；「不能编辑」的句子与 CHAIN-2e `src/lib/quote-engine/finance-hint.ts` 的 `QUOTE_EDIT_HIDDEN_HINT_ZH` / `QUOTE_EDIT_NO_OWNER_HINT_ZH` 同一句式，只把「新建、修改或批准报价」换成「新建、修改、确认或删除报价单」。

旧报价单编辑器：
- 看不到成本：顶部一行「报价单的内部成本和利润率只给项目负责人和有全企业「查看项目结算」权限的人看；需要的话请找项目负责人。」；行项表没有「成本价」一栏；合计条只有「报价总额」；顶部摘要不显示利润率；规则检查不出利润率检查项（`runQuoteChecks` 加「看不到成本」选项；不传时结果与改动前逐字相同）；AI 面板「输出版本」不出「内部成本表」。
- 不能编辑：表单与行项只读；不出「保存草稿」「确认报价」、AI 起草、AI 深度审查、「AI 自动流」；顶部写 D4 那句（去掉「没有改动：」前缀）。两句都要出时各出一次。
- 读取失败：「打不开这个报价单：」+ 接口给的原因（如「无权查看该项目」「报价单不存在」）；409 时再给「去报价页」链接（`href`）。不再出现空白的默认表单；只有还在读取时转圈。
- 导出：见 D5。

报价管理区块（`project-quote-section.tsx`）：`canEdit` 为假时不出「新建报价」，换成 D4 那句（去掉前缀）；列表照旧显示标题、模板、行数、总额。

- 备选 A：看不到成本的人不让打开旧报价单。否决：卖价、条款、行项对项目读者本来开放，不让打开只多一个「为什么打不开」。
- 备选 B：成本价一栏保留但置灰。否决：置灰的空格读起来像「还没填」（CHAIN-2b D4 同理）。
- 备选 C：句子各处自己写。否决：用 CHAIN-2b / 2e 的同一常量拼，才保证句式不漂。

### D9：裁剪写在纯函数里，路由、技能、工具共用

`src/lib/quote/finance-view.ts` 不 import `next/server` 与数据库，客户端组件也能 import 句子；有权限时纯函数返回与输入逐字段相同（测试用 `JSON.stringify` 比）。

- 备选：各路由自己删字段。否决：五个路由、一个技能、一个工具各写一遍，单测覆盖不到；白名单只能定义一次。

### D10：旧报价单的行都是客户行：PATCH 一律存 `isInternal = false`（留给 GATE ② 的推荐 A）

旧编辑器没有「内部行」这个概念：界面不会写 `true`，合计（`src/lib/quote/calculate.ts:28-37`）、PDF、Excel 都把全部行当客户行；成本写在每行的成本价里。可是 PATCH 把请求里的 `isInternal` 原样存下（`[quoteId]/route.ts:88`），报价引擎修订复制时也保留（`src/lib/quote-engine/service.ts:331`），于是有人用接口标了内部行，这一行照样印进客户 PDF、算进 Subtotal。改为：PATCH 写行项时每行 `isInternal: false`，不看请求；其余字段照旧。

为什么 PDF / Excel 不需要排除内部行、按印出的行重算客户小计：本 change 之后旧报价单（`orgId` 为空）再也写不进内部行；真正用「内部行」的是报价引擎（`src/lib/quote-engine/customer-view.ts:76` 按它过滤客户视图），它的报价经旧接口一律 409（D3），客户报价单走报价引擎自己的 PDF（`src/lib/quote-engine/quotation-pdf.ts`）。旧报价单里若已有 `isInternal = true` 的行（只能是有人直接调接口写的），下次保存时变成客户行——今天它们在编辑器、PDF、合计里本来就当客户行显示与计算，只是标记跟着对齐；有多少要先查生产（tasks 6.1 的只读查询），不为零时由负责人逐份看。

- 备选 B：请求里有任何一行 `isInternal: true` 就 400。否决：编辑器把读到的 `isInternal` 原样回传，已有内部行的旧报价单会永远存不进去。
- 备选 C：保留内部行语义——PDF / Excel 排除内部行、按印出的行重算客户小计，合计与编辑器分开算内部行。否决：旧报价单的总额（`totalAmount`）今天是全部行之和，改算法会让已存的总额与 PDF 对不上；编辑器要加内部行的开关与显示；要改 `calculate.ts`、编辑器、两种导出与接口，范围比收口大，且旧编辑器没人用这个功能。
- 备选 D：不改，只在报告里提示。否决：内部行印给客户是 FIX-26a 审查点名的口子，接口写得进去就是口子。

### D11：审计日志详情按财务查看权裁剪成本与毛利（留给 GATE ④ 推荐 C）

审计详情接口今天对组织管理员与项目管理员原样返回 `beforeData` / `afterData`，不看财务查看权；报价引擎另起新版的审计把估算成本与毛利率写在里面（出口 #11）。

**读取侧（必做）**：`GET /api/audit-logs/{id}` 在原有权限检查之后判财务查看权——审计带项目时按项目（`resolveFinanceViewSafe(user, log.orgId, 项目负责人)`），不带项目时只按组织键（负责人位为空）。没有的人：新纯函数 `src/lib/audit/redact-finance.ts` 递归扫 `beforeData` / `afterData`（对象与数组），命中的键值置 `null`，响应加 `costHidden: true` 与 `redactedPaths`（如 `beforeData.sourceCost`）；其余键、动作、操作人、时间、目标照旧。有财务查看权的人返回与改动前逐字节相同。

键名判定 = **写死的清单 + 兜底规则**：
- 清单（2026-11-23 全仓扫 `logAudit` / `writeAuditLog` 调用与它们可能带进去的对象）：`sourceCost`、`sourceMargin`、`estimatedCost`、`grossProfit`、`grossMarginPct`、`markupPct`、`pricingRate`、`calculatedCost`、`calculatedMargin`、`unitCost`、`internalCost`、`profitMargin`、`costPrice`、`costLines`、`breakdown`、`scenarios`、`ourCostCad`、`ourCostSource`、`targetMarginPct`、`marginPct`、`landedCad`、`landedCadTotal`、`landedCadUnit`、`landedCost`、`expectedRemainingCostCad`。
- 兜底：键名（不分大小写）含 `cost`、`margin`、`markup`、`profit`、`landed` 的也置空——以后新加的 `xxxCost` 一类键不登记也藏住；`costHidden` 一类布尔键被一起置空无害。
- 不藏：卖价类 `sellingPrice`、`sourceSellingPrice`、`ourBidPrice`、`total`（我方报价对项目读者可见，FIX-25 D6）；供应商原价 `unitPrice` / `totalPrice` 跟 FIX-26b（GATE ① 现在是 C，维持可见；Lucas 选 A 时 FIX-26b 把它们加进清单）。

**防以后漏**：新增不连库的守卫测试 `src/lib/audit/__tests__/audit-detail-redaction.test.ts`——用 TypeScript 语法树扫 `src/**` 里每个 `logAudit(` / `writeAuditLog(` 调用，取 `beforeData` / `afterData` 对象字面量里的全部键；键名像钱（含 `price`、`amount`、`total`、`cost`、`margin`、`markup`、`profit`、`landed`、`rate`、`budget`、`fee`）的，必须要么被上面的清单或兜底规则藏住，要么在测试里写明理由的「可见」名单里（如 `sellingPrice`：卖价）；新加一个两边都不在的键，测试失败、逼着写的人决定。传变量而不是字面量的调用（如 `src/lib/quote-engine/import/import-service.ts:78`、`tender-bid.ts:270` 的 `before`）列成名单，测试核对名单与实际一致，名单变了也失败。

**写入侧（推荐一并做）**：`src/lib/quote-engine/service.ts:351` 另起新版的审计 `beforeData` 只留 `sourceQuoteId`、`sourceVersion`、`sourceSellingPrice`，不再写 `sourceCost` 与 `sourceMargin`。理由：原版报价不删（只改成 superseded），它的估算成本与毛利率在原版的 `summaryJson` 里随时能按 `sourceQuoteId` 查到，审计里这两个数是重复的；少写一份，以后别的读审计的地方（Muse 证据、活动流、导出）就不必每处都记得裁剪。已写进去的历史行靠读取侧藏。

对审计功能本身的影响：组织管理员看审计是查「谁在什么时候对哪份报价做了什么」——动作、操作人、时间、目标、版本号、状态变化、改价原因、卖价都照旧看得到；看不到的只是那份报价当时的估算成本与毛利率，这本来就只给有财务查看权的人（组织管理员要看，组织给他组织范围的「查看项目结算」）。有财务查看权的人（含平台超级管理员）看到的审计详情与今天相同（写入侧改动之后新写的行少两个重复的数）。

- 备选 A：只做读取侧。可行（GATE ④ 可选），代价是审计里继续存一份重复的成本，其它读审计的地方要各自记得裁剪。
- 备选 B：只做写入侧。否决：已经写进去的历史行照样能读；Muse 账本行、财务预测等其它写入方不受影响。
- 备选 D：审计详情对没有财务查看权的人整条 403。否决：组织管理员审计的是动作，不是成本；整条拿走会让他看不到谁批准、谁另起新版。
- 备选 E：只按清单、不加兜底规则。否决：清单要靠人记得更新，漏一个就是泄露；兜底规则加守卫测试两道防线。

与 CHAIN-2e 的关系：写入这条审计的报价引擎属 CHAIN-2e 范围，但审计详情接口 `src/app/api/audit-logs/[id]/route.ts` 不在 CHAIN-2e 的改动里（`git -C /home/user/wt/chain-2e diff origin/main...HEAD --stat` 没有它），所以归本 change；写入侧那一行在 CHAIN-2e 的文件里，本 change 叠在 CHAIN-2e 上做、CHAIN-2e 合并后才合，不会撞车。与 FIX-25 的关系：FIX-25 安全审查 S1 发现、FIX-25 不改审计接口，归本 change。

## 八条硬纪律

1. 零 schema：遵守。不改 `prisma/`；`capabilities`、`costHidden`、`hintReason`、`href` 只是响应里的键。
2. 出站先审批：不涉及。不新增任何出站；Excel 是浏览器里生成、由人自己发的文件，本 change 让没有财务查看权的人导出的文件不带成本。
3. 禁止第三套队列：不涉及。
4. 脱敏：触碰，本 change 就是收口。网页旧报价单、Excel、报价 AI、智能体报价技能、问青砚两个工具、审计日志详情对没有财务查看权的人不出内部成本、成本价、利润率（规格「没有财务查看权时旧报价单不带出的内容」「审计详情不给没有财务查看权的人看成本与毛利」的 SHALL NOT）。Muse 通道不改，决定 A 不变。
5. 不爬登录页：不涉及。
6. 邮箱分离：不涉及。
7. 确定性优先：触碰。裁剪、白名单、判定都是代码；不新增模型调用——AI 审查、AI 起草、智能体报价技能的审查与起草对没有资格的人不调模型（比今天少），有资格的人仍是原来那一次调用、输入逐字不变；测试里的模型是本机假服务。
8. 测试注册：触碰。`src/lib/quote/__tests__/legacy-quote-finance-view.test.ts`、`src/lib/audit/__tests__/audit-detail-redaction.test.ts` 进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`；`src/lib/quote/__tests__/legacy-quote-finance-db.isolated.test.ts` 进 `scripts/test-all.sh`；`bash scripts/check-test-registry.sh` 通过，基线文件不加行。

## 验证方式

- 纯函数与界面：`npx tsx src/lib/quote/__tests__/legacy-quote-finance-view.test.ts`——有权限时列表行、详情视图与输入逐字段相同；没有时置空项逐个为 `null`；详情白名单不含任何引擎字段与 `sourceJson`；兜底两条（出错、没有组织）；规则检查默认调用与改动前 `JSON.stringify` 相同、「看不到成本」时没有 `low_margin` / `margin_warning` / `high_margin`；Excel 两种内容；编辑器、合计条、行项表、AI 面板、报价管理区块的静态渲染与源码断言（看不到成本 / 不能编辑 / 读取失败 / 409 四种）。
- 隔离库 + HTTP：`NODE_ENV=test npx tsx src/lib/quote/__tests__/legacy-quote-finance-db.isolated.test.ts`——八种身份（只读成员、不是负责人的项目管理员、operator、不是成员没有财务键的组织管理员、只在分配范围持 `project.finance.read` 的投标同事、持组织范围 `project.finance.read` 且项目角色 viewer 的成员、项目负责人、平台超级管理员）+ 不是项目成员的普通组织成员（工具）；授权查询出错用注入的判定测；旧报价单与引擎报价各一份（成本价 17.31、内部成本 91,234.56、利润率 23.45、`summaryJson.estimatedCost` 87,654.32）；列表、详情、写（403 / 409 后库不变）、AI 两个接口（本机假模型服务：被拒 0 次、有资格 1 次且请求正文与改动前相同）、报价技能 review / draft（跨项目 `quoteId` 被拒）、两个问青砚工具；列表里没有引擎报价与逐行报价；PATCH 时请求里标 `isInternal: true` 的行库里与返回都是 `false`；没有财务查看权的每个响应 JSON 里搜不到这几个数。改动前的代码上跑一次，记下失败条数。
- 守卫：`npx tsx src/lib/projects/__tests__/project-routes-guard.test.ts` 全过（改的路由第一步仍是项目读权限）。
- 审计：`npx tsx src/lib/audit/__tests__/audit-detail-redaction.test.ts`——清单与兜底规则逐个键、嵌套对象与数组、有权限时原样；扫全仓审计写入调用，像钱的键都已分到「藏」或「可见」名单。隔离库测试里补：报价引擎另起新版后，不是负责人的项目管理员与组织管理员读这条审计 200、`sourceCost` / `sourceMargin` 为 `null`、带 `costHidden`，项目负责人与持组织范围财务键的人读到原值；只读成员仍 403；写入侧改动后新写的那条没有这两个键。
- 既有：`quote-engine-contract.test.ts`、`finance-access.test.ts`、`m2c-tool-policy.test.ts`、`bid-page-v2.test.tsx`、FIX-26a 的 `export-customer-pdf.test.ts` 原样通过。
- 全量：`npm test`（失败清单与 CHAIN-2e 分支基线逐条相同）、`npm run test:ci`、`npm run typecheck`、`npm run lint:baseline`、`bash scripts/check-test-registry.sh`、`bash scripts/test-runtime-architecture.sh`、`npx openspec validate legacy-quote-finance-gate --strict`、`git diff <CHAIN-2e 分支> -- prisma/ vercel.json package.json` 为空。

## Risks / Trade-offs

- **合并当天就收紧，没有开关**：不是负责人的投标同事（项目管理员、operator）、没有财务键的组织管理员看不到旧报价单的成本与利润率，不能再建 / 改 / 确认 / 删旧报价单、不能用报价 AI。影响面看生产数据（tasks 6.1 的只读查询：近 90 天旧报价单由谁建、谁改；带成本价的行数；`orgId` 不为空的报价份数）。
- 没有派发负责人的项目（负责人是导入用的系统账号）只有平台超级管理员与持组织范围财务键的人能看、能改；提示改为找组织管理员（CHAIN-2e D9 的同一句），合并前按 CHAIN-2e 的 `docs/acceptance/chain-2e/prod-check.sql` 补负责人。
- 没有组织的老项目：只有负责人与平台超级管理员能看能改（与 CHAIN-2e 同规则）。
- 本 change 合并后、FIX-26b 之前，供应商原价仍从询价接口、比价矩阵、AI 报价分析、追踪页、供应商履历出去（出口表 #13–#17）；「项目读者拿不到成本」要等 FIX-26b 才成立（原价 ≈ 成本时）。
- 每次旧报价单请求多 2 次 `authorize`（与成本核算接口同代价），看不到时多一次查负责人账号（选句子）。
- 有财务查看权的人在问青砚里拿到的利润率会留在他自己的会话记录里；工具结果写进智能体运行记录后还有谁能读，没核实（见报告）。
- 行项「备注」是自由文本，AI 草稿可能写进「按供应商报价加价 30%」一类的话，裁剪不了；本 change 之后只有能编辑的人能应用 AI 草稿，已存的备注照旧显示。
- 旧报价单列表只列旧报价单（D3，留给 GATE ③ 推荐 A）：报价管理区块与版本历史抽屉（老页面的「版本历史」、新页面「更多 → 版本历史」）不再显示报价引擎与逐行报价建的报价；它们在报价引擎区块与新页面的报价列表里照常有。
- 旧报价单里已有 `isInternal = true` 的行（只能是有人直接调接口写的）下次保存后变成客户行（D10）；今天它们在编辑器、PDF、合计里本来就当客户行，生产里有多少先查（tasks 6.1）。
- 审计详情（D11）：不是负责人、没有财务键的组织管理员与项目管理员在审计详情里看不到成本、毛利、落地价类的值（显示为空并写一句为什么）；这些审计行的动作、操作人、时间、卖价照旧。兜底规则按键名藏，键名碰巧含 cost / margin 的非金额值也会被藏（如布尔标记），不影响审计用途。
- 叠在未合并的 CHAIN-2e 上：CHAIN-2e 合并前若再改 `resolveFinanceViewSafe` / `resolveQuoteCapabilities` 的签名或句子，本 change 要跟着变基改。

## 与在审 / 并行 change 的关系

- **CHAIN-2e `finance-view-compare-quote-gate`（#556，`35e9ae91`）**：本 change 的实现基线。它管出口表 #19、比价与追踪页的落地价，以及新增的判定入口、句子与 `resolveQuoteCapabilities` 新签名——本 change 只 import，不改它的文件——唯一例外是 `src/lib/quote-engine/service.ts:351` 另起新版那条审计的内容（D11，留给 GATE ④ 选 B 或 C 时改；本 change 叠在 CHAIN-2e 上、它合并后才合，不撞车）；审计详情接口不在 CHAIN-2e 的改动里，归本 change；它报告 §5 写的「legacy 报价接口……打开 `TENDER_QUOTE_ENGINE_ENABLED` 之前必须修」与「问青砚 `project_get_project_quotes`」就是本 change 的 #1–#10（#11 审计详情是 FIX-25 安全审查补的）。顺序：CHAIN-2e 先合，本 change 变基到 main 再合。
- **FIX-26a `quote-pdf-no-margin`（分支 `claude/zen-turing-azudvx-fix26a`）**：只改 `src/lib/quote/export-pdf.ts` 与一个新测试；本 change 不碰这两个文件，只改导出菜单的文字（`quote-summary-bar.tsx`）。两者谁先合都行，没有文本冲突（只有 `scripts/test-all.sh`、`scripts/test-ci-unit.sh` 各加行）。
- **FIX-26b（待 Lucas 答 GATE ①）**：询价与供应商原价的全部出口（#13–#17）。本 change 不碰 `src/lib/inquiry/**`、`src/components/inquiry/**` 与询价路由；初稿里的询价规格与设计在本分支提交 `180eeda9` 里，FIX-26b 开工时可以从那里取。
- **FIX-25 `target-margin-finance-gate`（`/home/user/wt/fix25`，实现中，基于 main）**：边界——FIX-25 管报价表助手（`src/lib/tender-pricing/finance-view.ts`、`pricing-helper` 路由与卡）的目标毛利与两个房间 JSON 接口（`GET /api/projects`、`GET …/bid-intelligence`）的 `pricingInputs` / `bidDraft`；本 change 管旧报价单与报价工具（`ProjectQuote` / `QuoteLineItem` 的读写）。FIX-25 出口表 #7 / #8 就是本 change 的 #1–#10（#11 审计详情是 FIX-25 安全审查补的），写明「归 FIX-26」；它的 Out of scope 里写的报价单 PDF 现归 FIX-26a、询价现归 FIX-26b（FIX-25 报告写到时按此更正）。两者没有共同源文件；`view-hint.ts`（CHAIN-2e）从 `tender-pricing/finance-view.ts` 取 `COST_ACCESS_HINT_ZH`，FIX-25 改那个文件但不改这条常量的文字（已核对它的 diff）——本 change 变基后要再核一次。共同改动只有两个测试脚本各加行。
- **BIDPAGE（另一个会话）**：BIDPAGE-3（#564，已合并）的逐行报价存在 `ProjectQuote`（`orgId` 不为空），今天经旧报价单 `PATCH` 能被只读成员删客户行、覆盖成本列、改状态——本 change 的 D3 把它们挡在旧接口之外，不改 BIDPAGE 的任何文件。BIDPAGE-8（判断点 4「旧版报价单收进『更多』、名字去掉 legacy」与中文化）可能改 `src/components/quote/project-quote-section.tsx`：GATE ⑥ 已定本 change 先合，BIDPAGE 变基时保留「不能编辑时不出新建报价、写那句话」的判断（协调会话通知 BIDPAGE 会话）。询价相关的交叠（BIDPAGE-2）随 FIX-26b 走。

## GATE（协调会话 2026-11-23 定，Lucas 2026-11-22 授权按推荐；① 例外）

1. 询价里的供应商原价：**暂不改（维持现状 C）**，整体移出本 change 记为 FIX-26b，交 Lucas 定（见下「留给 GATE」）。
2. 旧报价单谁能改：**A 与报价引擎同口径**（D4）。
3. AI 审查对没有财务查看权的人：**403、不调模型**（D6）。
4. 内部版 PDF：**不出**；Excel 给有财务查看权的人导「内部成本表」（D5）。
5. 拆分：**拆**——PDF 为 FIX-26a（已单独实施），本 change 为旧报价单其余部分，询价为 FIX-26b。
6. 与 BIDPAGE 的交叠：**本 change 先合**；BIDPAGE 变基时保留判断（协调会话通知 BIDPAGE 会话）。
7. 依赖：**叠在 CHAIN-2e 分支上做**（`claude/inspiring-johnson-o54xbt-chain-2e`，`35e9ae91`），CHAIN-2e 合并后再合；CHAIN-2e 长期不合时协调会话再定。
8. 开关：**不设**，合并即生效。
9. 顺手的小问题：**登记「待定」**（tasks 6.1 写进 TASKFLOW）——版本历史抽屉与报价管理区块把引擎报价链到旧编辑器（留给 GATE ③ 选 A 时随列表过滤一并消失，不再登记）；旧报价单 `PATCH` 接受任意 `status`；AI 面板「输出版本」三个按钮没有接线。
10. FIX-26a 审查（2026-11-23）后补的两条：`isInternal` 与旧报价单列表的口径，见下「留给 GATE」② ③（四件套按推荐写）。
11. FIX-25 安全审查 S1（2026-11-23）后补的一条：审计日志详情，见下「留给 GATE」④（四件套按推荐写）。

## 留给 GATE

1. **FIX-26b：询价里的供应商原价给谁（待 Lucas 答）**。与 CHAIN-2e design D3（Lucas 已批的 CHAIN-2e GATE ③）冲突：CHAIN-2e D3 明确否决过「连原价一起藏」，理由是询价同事要据原价追问供应商，且原价已经经询价明细与旧比价两个接口对项目读者返回。三个选项的后果：
   - **A 只给有财务查看权的人看和录**：原价与对项目读者可见的我方报价（FIX-25 D6）相减就是毛利，A 堵住这种两价反推，与 BIDPAGE-2 已定的「新页面『报价』列只给有成本与财务查看权的人」一致。代价：推翻 CHAIN-2e D3；不是负责人的询价同事（项目管理员、组织管理员）看不到、也录不了供应商报价，只能交给负责人；要同时改 CHAIN-2e 改过的比价矩阵 `quoted`、AI 报价分析输入与追踪页（出口 #14 / #15），以及供应商履历、组织汇总（#16 / #17）；录入改由负责人做后，回信自动入表照常。
   - **B 有财务查看权或项目写权限可看**：询价同事里有编辑权的照常看和录；只读成员、tester、operator 看不到。代价：不是项目成员的组织管理员仍能看（FIX-21 后续 8 点名要收的人）；两价反推对有编辑权的人照旧成立；口径与报价表助手、报价引擎都不同，要新写一份判定。
   - **C 维持现状（当前状态）**：不改任何东西，CHAIN-2e D3 照旧。代价：所有项目读者（含只读成员与不是成员的组织管理员）都能看到每家供应商原价；供应商报 DDP 加元时原价就是落地价，CHAIN-2e 对落地价的收口对这类报价等于没收；本 change 与 FIX-25 之后「项目读者拿不到我方成本」仍不成立。
   - 初稿（本分支提交 `180eeda9` 的 `specs/tender/inquiry-supplier-price-view/spec.md` 与 design D8）按 A 写过一版，FIX-26b 选 A 或 B 时可从那里改起。
2. **旧报价单的「是否内部行」（D10；FIX-26a 两位审查员都提）**：A PATCH 一律存 `false`、不看请求（推荐）／B 请求里有 `true` 就 400／C 保留内部行语义，PDF / Excel 排除内部行并按印出的行重算客户小计。推荐 A：旧编辑器没有内部行功能，合计、PDF、Excel 本来就把全部行当客户行；真正用内部行的报价引擎经旧接口一律 409、有自己的客户 PDF；B 会让已有内部行的旧报价单存不进去；C 要改算法、编辑器、两种导出与接口，且会让已存总额与 PDF 对不上。选 A 时 PDF / Excel 不需要排除内部行（D10 写明理由），新增一条「请求里标内部行，库里与返回都是否」的隔离库用例。
3. **旧报价单列表要不要列报价引擎的报价（D3；FIX-26a 审查提）**：A 只列 `orgId` 为空的旧报价单（推荐）／B 照旧列出、每行标 `engineQuote: true` 与 `href`，报价管理区块与版本历史抽屉把这些行链到报价页。推荐 A：与旧接口对引擎报价 409 同一口径，一处 `where` 改动；老页面开着报价引擎时不再在两处重复列；BIDPAGE-8 判断点 4 按旧报价单数才准；GATE ⑨ 第一条小问题随之消失。代价：版本历史抽屉里不再有引擎报价那几行（引擎区块与新页面报价列表里有）。选 B 要多改 `src/components/project-detail/version-history-drawer.tsx` 与报价管理区块，并通知 BIDPAGE 会话（新页面「更多 → 版本历史」用同一个抽屉）。
4. **审计日志详情里的成本与毛利（D11；FIX-25 安全审查 S1）**：A 只在读取侧裁剪／B 只在写入侧不写／C 两者都做（推荐）。推荐 C：读取侧是必须的（历史行、Muse 账本行、财务预测都靠它），写入侧只动 `src/lib/quote-engine/service.ts:351` 一处、去掉的两个数在原版报价里查得到；裁剪按写死清单加键名兜底规则，并用扫全仓审计写入调用的守卫测试防以后漏。对审计功能的影响：组织管理员照样看得到动作、操作人、时间、版本、状态、原因与卖价，看不到当时的估算成本与毛利率；要看就给组织范围的「查看项目结算」。选 A 时不改 CHAIN-2e 的文件。
