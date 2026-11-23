# Design：目标毛利只给有财务查看权的人（FIX-25）

## Context

### 复现

CHAIN-2d #538 交叉验证 F4（探针只读参考：`/tmp/claude-0/-home-user--/891d033c-12f4-5755-b3e3-16f0d37fd093/scratchpad/chain2d-xc-probes/margin-reverse-probe.ts`）：隔离库里只读成员（项目角色 `viewer`、企业角色 `org_member`、没有岗位），房间 `pricingInputs` 存成本 87,654.32、目标毛利 23.7、报价引擎镜像的我方报价 114,881.15（= 87,654.32 ÷ (1 − 0.237)，舍入到分）。`GET …/bid-intelligence` 200，`room.summaryJson.pricingInputs.targetMarginPct = 23.7`、`ourPriceCad = 114881.15`；114,881.15 × (1 − 0.237) = 87,654.32，与成本逐分相同。报价正好按报价表助手的底价情景定（`src/lib/tender-pricing/calc.ts:213-215`：`floor = K / (1 − m/100)`）时精确反推；报价引擎的售价按自己的定价算、或人手填的报价，只能得到估计值。

任务书里写的 `src/lib/tender-intel/finance-view.ts:114` 实际路径是 `src/lib/tender-pricing/finance-view.ts:114`（`redactRoomSummaryCost` 只解构掉 `ourCostCad`、`ourCostSource`）。

### 目标毛利存在哪里

| 存放处 | 谁写 | 备注 |
|---|---|---|
| `BidIntelligenceRoom.summaryJson.pricingInputs.targetMarginPct` | 报价表助手保存（`src/app/api/projects/[id]/pricing-helper/route.ts:170-177`） | 0 ≤ m < 100；只用于「成本 + 目标毛利」底价情景（`calc.ts:213-215`），没有成本时不影响情景表 |
| `ProjectQuote.pricingRate`（`pricingMethod = MARGIN_ON_REVENUE` 时就是目标毛利）、`ProjectQuote.profitMargin`、`summaryJson.grossMarginPct` | 报价引擎（`src/lib/quote-engine/service.ts:239` 把引擎毛利率写进旧列 `profitMargin`）、旧报价单（`src/lib/quote/calculate.ts:43-46`） | 报价引擎开关 `TENDER_QUOTE_ENGINE_ENABLED` 生产未设；旧报价单生产在用 |
| 投标工作区成本草稿 `pricingRatePct` | 成本核算面板，存本人浏览器 `localStorage`（`src/lib/tender-bid-workspace/cost-draft.ts:13-14,41`） | 不进服务器；成本核算接口按请求现算、不落库、只给财务查看权（`src/app/api/projects/[id]/bid-workspace/cost-sheet/route.ts:23-24`） |

### 出口清单（逐条核对，main `2a0eb964`）

本 change 处理（都没有开关，生产在跑）：

| # | 出口 | 给谁 | 目标毛利 | 同一响应里的我方报价 |
|---|---|---|---|---|
| 1 | `GET /api/projects/{项目}/bid-intelligence` 的 `room.summaryJson.pricingInputs.targetMarginPct`（`bid-intelligence/route.ts:33` → `finance-view.ts:103-118`） | 项目读者（`requireProjectReadAccess`，含不是成员的组织管理员） | 有 | 有：`pricingInputs.ourPriceCad` / `ourPrice`（报价引擎镜像，`src/lib/quote-engine/tender-bid.ts:136`） |
| 2 | `GET /api/projects` 每个项目的 `intelligenceRoom.summaryJson.pricingInputs.targetMarginPct`（`src/app/api/projects/route.ts:105-111`） | 本组织任一 active 成员（已派发项目，`src/lib/projects/visibility.ts:57-61` 按组织成员身份列出），不必是项目成员、也不必有项目读权限（项目读权限只放行负责人、组织管理员、项目成员，`src/lib/projects/access.ts:152-163`）；项目行 `ourBidPrice` 同样给这些人 | 有 | 有：镜像价，外加项目行 `ourBidPrice`（`include` 带回全部标量字段，`:88-91`） |
| 3 | `GET /api/projects/{项目}/pricing-helper` 的 `inputs.targetMarginPct`（`pricing-helper/route.ts:97` → `finance-view.ts:74` 只把成本置空） | 项目读者 | 有 | 没有；另取 `GET /api/projects/{项目}`（`src/app/api/projects/[id]/route.ts:70-74`，`ourBidPrice`）即可 |
| 4 | `POST …/pricing-helper { action: "save" }` 返回的 `inputs.targetMarginPct`（`finance-view.ts:92-100`）；且没有财务查看权的编辑者能改目标毛利（`finance-view.ts:86-89` 不算「碰了成本」） | 项目编辑者 | 有 | 没有 |
| 5 | 报价表助手卡（工作台，`src/components/project-detail/tabs/workbench-tab.tsx:171`，没有开关）：目标毛利输入框显示已存的值（`pricing-helper-card.tsx:92`、`:242-264`），开关开着时「相当于成本加成 x%」（`:266`） | 项目读者（只读成员是禁用的输入框） | 有 | 没有（卡上没有我方报价） |

不在本 change（写明归属）：

| # | 出口 | 给谁 | 毛利 / 目标毛利 | 我方报价 | 归属 |
|---|---|---|---|---|---|
| 6 | 报价引擎：列表 `grossMarginPct`（`quote-engine/route.ts:17`）、「我方报价」`pricingRate` / `grossMarginPct` / `markupPct`（`tender-bid.ts:77-91`）、卡片「Pricing Method … %」（`tender-our-bid.tsx:49-50`）、单个报价成本行 | main 上：特权或项目角色带 `project:cost:read`（`src/lib/quote-engine/access.ts:29-31`），五个项目角色都带，含 `viewer`（`src/lib/rbac/permissions.ts:193`） | 实际毛利与定价比例 | `sellingPrice` 对 read 级别都给 | CHAIN-2e #556：内部数字只认财务查看权；开关生产未设。#564 BIDPAGE-3（已合并）的逐行报价把目标毛利写进 `ProjectQuote.pricingRate`（`src/lib/bid-page-v2/quote-line/service.ts:346`），自己的接口按金额门（`src/lib/bid-page-v2/quote-line/api-gate.ts:20-26`），但旧报价单详情接口（#7）照样整行给出 |
| 7 | 旧报价单：`GET …/quotes`（`quotes/route.ts:22-23`，`totalAmount` + `profitMargin`）、`GET …/quotes/{报价}`（`quotes/[quoteId]/route.ts:14-25`，整行：`internalCost`、`profitMargin`、`pricingRate`、`summaryJson`、行项 `costPrice`）；编辑器显示内部成本与利润率（`src/components/quote/quote-summary-bar.tsx:58,68`、`quote-top-summary.tsx:153`）；报价单 PDF 打印「Profit Margin」（`src/lib/quote/export-pdf.ts:137-138`，给客户的报价单形态，最严重）、Excel 带内部成本与利润率（`src/lib/quote/export-excel.ts:45-46`），都由编辑器（`src/components/quote/quote-editor.tsx`）在浏览器里生成；AI 审查（`quotes/[quoteId]/ai/review/route.ts:11` 只要读权限，`:53-54` 把内部成本与利润率交给模型）；`src/lib/agent/skills/quote.ts:253-254`；报价引擎没开时投标页只渲染旧报价单（`src/components/quote-engine/bid-quote-area.tsx:16`） | 项目读者 | 实际利润率，且直接给内部成本 | 有 | **FIX-26**（GATE ⑥ 已定，原 TASKFLOW「待定」FIX-21 后续 8，第 308 行；PDF 单列优先） |
| 8 | 问青砚 `project_get_project_quotes`（`src/lib/agent-core/tools/enterprise-readonly.ts:517`，`:549-550` 取 `totalAmount`、`profitMargin`） | 组织 active 成员，不查项目权限（`:529`、`:19-31`） | 实际利润率 | 有 | **FIX-26**（GATE ⑥ 已定） |
| 9 | 投标策略备忘：编排把 `targetMarginPct` 交给模型（main `2a0eb964` 上 `src/lib/tender-intel/orchestrate.ts:425-439`；#538 已于 2026-11-23 合并（`fc321a7d`），改为只取对手价，`src/lib/tender-intel/memo-pricing.ts:66`），备忘经情报页签、工作台摘要、投标文件草稿、澄清问题文件给项目读者 | 项目读者 | 可能被模型转述 | 可能 | CHAIN-2d #538（`buildMemoPricingAnalysis` 只取对手价）。另：起草后写进房间的 `summaryJson.bidDraft.internalNotesZh`（`src/lib/tender-bid-draft/meta.ts:17`，起草模型写的内部注，起草输入含旧版备忘）原来也被两个房间 JSON 接口原样带出——本 change 顺手在这两个接口去掉整个 `bidDraft`（D5b）；草稿卡片自己的接口 `GET …/bid-draft`（`src/app/api/projects/[id]/bid-draft/route.ts:50`）照旧返回；生成的投标文件草稿文件本身也带「内部审阅注（提交前删除）」（`src/lib/tender-bid-draft/render.ts:68-70` 写进文件，`src/lib/projects/generate/generate-docs.ts:446-467` 存成项目文件，项目读者能看）——这两处属 CHAIN-2d「已存旧版草稿留作后续」 |
| 10 | 项目财务的实际利润（`/api/org/tender-portfolio`、`financial-performance-card`）与预算的利润百分比（`GET …/finance/budget`，`src/app/api/projects/[id]/finance/budget/route.ts:33` 用 `project:cost:read`，项目角色都带） | 组织成员 / 项目角色 | 实际利润率 | — | 开关 `TENDER_FINANCIAL_CONTROL_ENABLED` 生产关；CHAIN-2e Out of scope「另开任务」 |
| 11 | 审计日志详情 `GET /api/audit-logs/{id}`（`src/app/api/audit-logs/[id]/route.ts:46-55` 只查本组织组织管理员或该项目 `project_admin`，`:72` 原样返回 `beforeData` / `afterData`）：报价引擎另起新版时往审计写 `sourceSellingPrice`、`sourceCost`、`sourceMargin`（`src/lib/quote-engine/service.ts:351`）；审计 id 可从审计列表或项目动态（`src/lib/activity/formatter.ts:143`）拿到 | 本组织任一组织管理员、该项目 `project_admin`，不看财务查看权；接口本身没有开关，已写下的审计行在报价引擎开关关掉后照样能读 | 实际毛利率与估算成本 | 有（同一条审计里的 `sourceSellingPrice`） | **FIX-26 主体**（多审 S1：成本 / 利润率出口统一收，或审计详情对没有财务查看权的人裁掉 `beforeData` / `afterData` 里的成本与毛利键；FIX-26 四件套由协调会话另补） |

核对后不是出口的：Muse `price_scenario` 传 `targetMarginPct: null`（`src/lib/muse-bridge/router.ts:543-549`），`loadProjectPricingContext`（`src/lib/tender-pricing/project-context.ts:96-111`）只有它调用；BIDPAGE 汇总接口规格写明不返回毛利率、加成率（主规格 `tender/bid-page`「汇总接口对任何人都不出成本」），我方报价只给能看金额的人（`bid-page-summary/route.ts:39-43`）；投标文件草稿输入只取 `ourPriceCad` 与对手价（`src/lib/tender-bid-draft/gather.ts:149,210-211`）；官方价格表导出六列不含毛利（`src/lib/tender-price-schedule/official-export.ts:5`）；内部项目分析 PDF 写我方报价与中标价、不写毛利（`src/lib/projects/generate/generate-docs.ts:80,235`，BIDPAGE-7 另管）；`src/lib/projects/generate/analyst-memo-html.ts` 的「价格演算」「报价引擎快照」没有调用方；投标工作区读取不含金额（`bid-workspace/route.ts:8`）；通知（`src/lib/notifications/**` 没有毛利字段）；项目动态只拼固定字段（`src/lib/activity/formatter.ts:232-247`），审计日志**列表**不返回 `afterData`、不取 `beforeData`（`src/lib/audit/query.ts:23-27,60-68`），但审计日志**详情**原样返回，是出口（#11，归 FIX-26 主体）。

`pricingInputs` 的读取者（`grep -rn "pricingInputs\|PRICING_INPUTS_KEY" src`，不含测试）：报价表助手路由、`finance-view.ts`、`compare-cost-source.ts`（成本来源）、`project-context.ts`（Muse）、`gather.ts`（我方报价与对手价）、`orchestrate.ts`（备忘，CHAIN-2d）、`tender-bid.ts`（写镜像）。界面上读房间 `summaryJson` 的只有项目列表页（`src/app/(main)/projects/page.tsx:78-80,787`，只读 `majorBlockers`）与调查室区块（`src/components/bid-workflow/project-intel-sections.tsx:297-345`，只读旧版几个键）；读 `targetMarginPct` 的界面只有报价表助手卡。`scripts/quote-ops-golden-e2e.ts` 直接读库，不走这两个接口。

### 判定口径

沿用 CHAIN-2b 报价表助手已有的判定（`pricing-helper/route.ts:61-67` → `finance-view.ts:35-47`）：`resolveFinancePrivilege(user, orgId, ownerId).canReadAll`（`src/lib/project-finance/access.ts:50-65`）= 平台超级管理员、持组织范围 `project.finance.manage` 或 `project.finance.read`、项目负责人；判定抛错或项目没有组织时只剩负责人与平台超级管理员。`bids` 岗位的 `project.finance.read` 只在 `ASSIGNED` 范围，不算；组织管理员本身不算。

### 我方报价现在给谁

`Project.ourBidPrice` 对项目读者到处可见：项目列表与详情（全部标量字段）、提交页签手填（`src/components/project-detail/tabs/submission-tab.tsx:272-293,359`）、情报页（`src/app/(main)/projects/intelligence/page.tsx:473,589`）、相似项目 / 价格趋势 / 复盘 / 对标（`src/lib/projects/similarity.ts`、`price-trends.ts`、`review.ts`、`src/app/api/projects/[id]/tender-benchmark/route.ts:115,145`）、问青砚上下文（`src/lib/projects/project-ai-context.ts:141-142`）与工具（`enterprise-readonly.ts:49,604`）、交接（`src/lib/projects/handoff/**`）。报价引擎售价对 read 级别都给（`quote-engine/route.ts:17`）。唯一按财务权藏我方报价的是 BIDPAGE 新页面（BIDPAGE 交接文档：金额门「只决定新页面挂不挂带金额的旧组件，不是数据保护」）。

### 界面现在怎样、改完怎样

现在：工作台「报价表助手」卡的「我方假设」里，目标毛利输入框对所有项目读者显示已存的值（只读成员看到禁用的框，编辑者能改并保存），开关开着时下面有「相当于成本加成 x%」，没有财务查看权时再多一句「目标毛利只用于按成本算的底价情景；你这里改了，情景表不会变。」。改完：没有财务查看权的人在那一格只看到标签和「需要财务查看权才能看目标毛利。」，没有成本加成提示与那句说明；对手价、评分模型、打平价与四个对手价情景照旧——没有成本时情景表本来就不按目标毛利算，数字不变。有财务查看权的人看到的与改动前相同。

## Goals / Non-Goals

**Goals**：没有财务查看权的人在报价表助手读、写接口与两个房间 JSON 接口都拿不到目标毛利，也改不了它；有财务查看权的人在报价表助手看到与保存的一切照旧；隔离库按复现数据证明反推不成立。

**Non-Goals**：
- `src/lib/muse-bridge/**`（`price_scenario` 已不传目标毛利）。
- `src/lib/tender-bid-draft/**`、`src/app/api/projects/[id]/bid-draft/route.ts`（草稿与它的读取接口；本 change 只在两个房间 JSON 接口不带 `bidDraft`）。
- `src/lib/tender-intel/orchestrate.ts`、`strategy.ts`、`memo-pricing.ts`（CHAIN-2d 分支）、`src/app/api/projects/[id]/workbench-summary/route.ts`、`src/app/api/projects/[id]/external-intel/award-history/route.ts`（投标策略备忘）。
- `src/lib/quote-engine/**`、`src/app/api/projects/[id]/quote-engine/**`、`src/components/quote-engine/**`、`src/app/api/projects/[id]/inquiries/[inquiryId]/compare/matrix/**` 与 `compare/analysis/**`、`src/lib/tender-rfq/**`（CHAIN-2e）；`src/app/api/projects/[id]/inquiries/**` 的其余接口与 `src/lib/inquiry/**`（供应商报价原价，FIX-26）。
- `src/app/api/projects/[id]/quotes/**`、`src/components/quote/**`、`src/lib/quote/**`、`src/lib/agent/skills/quote.ts`、`src/lib/agent-core/tools/enterprise-readonly.ts`（FIX-26；`project_get_tender_summary` 是 FIX-21 后续 10）。
- `src/app/api/projects/[id]/bid-page-summary/route.ts`、`src/app/api/projects/[id]/bid-page/**`、`src/lib/bid-page-v2/**`、`src/components/bid-page-v2/**`（BIDPAGE，含 #564 BIDPAGE-3 逐行报价）。
- `src/app/api/projects/[id]/bid-workspace/**`、`src/lib/tender-bid-workspace/**`、`src/lib/tender-bid-cost/**`（成本核算已按财务查看权，草稿只在浏览器）。
- `src/lib/project-finance/access.ts`、`src/lib/project-finance/view-hint.ts`（CHAIN-2e 新增）、`src/lib/tender-pricing/calc.ts`、`compare-cost-source.ts`、`compare-cost-source-load.ts`、`project-context.ts`、`derive.ts`。
- `Project.ourBidPrice` 及其全部读取处；`src/app/api/projects/[id]/route.ts`。
- `finance-view.ts` 里 `COST_ACCESS_HINT_ZH`、`COST_HIDDEN_FIELD_ZH`、`COST_HIDDEN_NOTE_ZH`、`NO_COST_ASSUMPTION_ZH` 四句文字（CHAIN-2e 的 `view-hint.ts:9` 拼 `COST_ACCESS_HINT_ZH`）。
- `prisma/`、`vercel.json`、环境变量。

## Decisions

### D1：判定沿用报价表助手现有的财务查看权，房间 JSON 不按人判定

报价表助手的读取与保存照旧在路由里算一次 `canSeeCost`（CHAIN-2b D1），目标毛利跟着它走，不新加判定入口。两个房间 JSON 接口对所有人去掉（D5），不需要判定。

- 备选 A：改用 CHAIN-2e 的 `resolveFinanceViewSafe`。否决：它在 #556 里、还没合并；CHAIN-2e 已把「两份兜底收成一份」列为合并后另开整理，本 change 再动会和那次整理撞车。
- 备选 B：新增权限键「看目标毛利」。否决：多一套口径，要走岗位目录登记；目标毛利与成本一起用（底价情景），分开授权没有用处。
- 备选 C：按项目角色的 `project:cost:read`。否决：五个项目角色都带，含只读 `viewer`，等于不收。

### D2：读取与保存返回：置 `null`，与成本共用 `costHidden`

没有财务查看权时，读取视图与保存返回把 `inputs.targetMarginPct` 和 `inputs.ourCostCad` 一起置 `null`；情景按两者都为 `null` 计算（与只把成本置空的结果逐字节相同，因为没有成本时目标毛利不参与计算；测试核对）；不论填没填都是同一个结果。有财务查看权时原样返回（同一个对象）。

- 备选 A：新加 `marginHidden` 标记。否决：它和 `costHidden` 永远同真同假，卡片要多判一个状态，测试要多一倍组合。
- 备选 B：去掉 `targetMarginPct` 这个键。否决：`inputs` 的形状由「保存的对外行为」固定为三项；`null` + `costHidden` 与成本的做法一致。
- 备选 C：只在项目有我方报价时才藏。否决：我方报价随时会出现（报价引擎镜像、提交页手填、开标后公开），按条件藏要在每个读取处都判断一次，且「先看目标毛利、后出报价」照样能反推。

### D3：保存：带了目标毛利就 403，与成本共用一句话

「碰了受限的键」= 请求 `inputs`（按对象读）里有 `ourCostCad` 或 `targetMarginPct` 这个键（不论值），或请求顶层有 `ourCostSource` 这个键。没有财务查看权且碰了 → 403，不写库；判定位置与顺序不变（锁外、409 之后、锁内 400 之前）。「请求里有没有这个键」只写一处（`finance-view.ts` 导出一个判断），403 判定与路由里的保存（三项输入「请求里带了就取请求的值」、成本来源的 `costInBody`）都用它，两处不会对同一个请求得出不同结论；对 JSON 解析出来的普通对象，它与原来的 `in` 判断结果相同，有财务查看权的人保存行为不变。403 那句改为「没有保存：页面已更新，目标毛利现在和我方成本一样，只给有财务查看权的人改。请刷新页面，重新填写后再保存。」——上线前打开的卡片（CHAIN-2b 版本）每次保存都带目标毛利；先说「没有保存」（不让人扫成「存上了」），再说页面已更新、目标毛利现在和成本同一个门（只改了对手价的人也看得懂为什么被拒），再叫人刷新（文案审查 X1）。不碰时照常保存，已存的成本、来源与目标毛利原样保留（`buildSave` 对请求里没有的键沿用原值，不改）。

- 备选 A：静默忽略请求里的目标毛利。否决：人以为存上了。
- 备选 B：允许「只写不读」。否决：能改掉负责人定的目标毛利，负责人的底价情景随之变化，而改的人看不见改了什么。
- 备选 C：成本与目标毛利各一句。否决：多一个分支；旧卡片的请求两项都可能带，选哪句都不全；合成一句已经说清两项都要财务查看权。
- 备选 D：值与库里相同就放行（旧卡片原样回传就不报错）。否决：人可以换着值保存，按 200 / 403 试出已存的目标毛利。

### D4：卡片：目标毛利格换成一句话，提示与说明都不渲染

`costHidden` 时目标毛利那一格与成本格同一写法：固定标签「目标毛利」（不再按开关写「目标毛利率 %（按售价）」或「目标毛利 %」，文案审查 X2）加「需要财务查看权才能看目标毛利。」；不渲染成本加成提示；去掉「目标毛利只用于按成本算的底价情景；你这里改了，情景表不会变。」（常量删掉）；保存请求只带对手价（与评分模型）。卡片的数据在 `useEffect` 里取；多审 T7 后保存请求体抽成纯函数 `buildPricingSaveBody`（`finance-view.ts`），展示部分抽成纯组件 `PricingHelperCardView`（同一个卡片文件），两者都有行为测试（纯函数断言、`renderToStaticMarkup`），源码断言只留接线。

- 备选 A：保留输入框但禁用。否决：禁用的空框读起来像「还没填」（CHAIN-2b D4 同理）。
- 备选 B：只藏数值，保留成本加成提示。否决：提示由目标毛利算出（m ÷ (1 − m)），等于把目标毛利换个写法给出去。

### D5：房间 JSON：对所有人去掉整个 `pricingInputs`

`redactRoomSummaryCost` 改为去掉整个 `pricingInputs`（备忘照旧去掉；`bidDraft` 见 D5b），三者都没有时返回同一个对象、不改入参。两个接口的界面都不读 `pricingInputs` 的任何一键（见 Context），报价表助手的输入只经报价表助手接口按财务查看权给。

- 备选 A：只再去掉 `targetMarginPct`。否决：CHAIN-2b 去了两个键、这次补第三个，以后往 `pricingInputs` 再加键（比如别的定价参数）还会漏；没有读者需要剩下的对手价与镜像价。
- 备选 B：按财务查看权逐个项目判定、有权的人照旧带。否决：项目列表每页多几十次授权查询；有权的人在报价表助手拿得到，这里没有读者。

### D5b：两个房间 JSON 接口顺带去掉整个 `bidDraft`（审查 F6）

`summaryJson.bidDraft` 是起草后写的元信息（`src/lib/tender-bid-draft/meta.ts:8-20`：版本、时间、几个计数与 `internalNotesZh`——起草模型写的内部注，起草输入含旧版备忘，可能转述成本）。核对读者：两个接口的界面（项目列表页、调查室区块）都不读它；读它的只有草稿卡片自己的接口 `GET …/bid-draft`（`bid-draft/route.ts:50`，卡片 `src/components/tender/bid-draft-card.tsx:60` 与生成菜单 `src/components/project-generate/project-generate-menu.tsx:76` 调用）。所以与 `pricingInputs` 同样整块去掉，代价是零；草稿卡片照旧。

- 备选 A：只去 `bidDraft.internalNotesZh`。否决：要在裁剪里改写嵌套对象；其余几个键在这两个接口也没有读者，整块去掉更简单，以后往 `bidDraft` 加键也不会漏。
- 备选 B：不管，留给 CHAIN-2d 的后续。否决：本 change 已经在同一个函数里去掉两个键，再加一个没有额外代价；`GET …/bid-draft` 本身仍归 CHAIN-2d 后续。

### D6：我方报价不收（GATE ① 已定）

本 change 不改 `Project.ourBidPrice`、报价引擎售价与镜像价在别处的可见范围。理由：① 反推要两个数，目标毛利（本 change）、实际毛利率（报价引擎归 CHAIN-2e，旧报价单归 FIX-21 后续 8）拿不到时，单有报价算不出成本；② 我方报价是递给买方的投标价，公开招标开标后通常公布，项目团队要用它填提交记录、做复盘、看相似项目与价格趋势；③ 它在 20 多个读取处（Context「我方报价现在给谁」），收口要改提交页签、情报页、相似项目、价格趋势、问青砚上下文等，是另一种产品决定，不是本 change 的规模。

- 备选：按财务查看权收 `ourBidPrice`、报价引擎售价与镜像价（与 BIDPAGE 新页面的金额门一致）。否决（本 change 内）：范围与风险都大一个量级，且旧报价单还直接给内部成本时收报价没有意义；要做另立 change。

### D7：没有开关，合并即生效

这是收口，不是新功能。

- 备选：加开关、默认关。否决：开关关着就是继续把目标毛利给项目读者；CHAIN-2b、FIX-21、FIX-23 同类收口都没有开关。

### D8：范围只收报价表助手这一组出口

同类出口按 Context 表格各归各的 change：报价引擎（CHAIN-2e）、旧报价单（含 PDF / Excel / AI 审查）、询价与旧比价的供应商报价与问青砚报价工具（FIX-26）、备忘（CHAIN-2d）。

- 备选：把旧报价单与 `project_get_project_quotes` 并进来。否决：旧报价单的问题是直接给内部成本与行项成本价（不是反推），要改列表 / 详情两个接口、编辑器三处显示，以及它用读权限做的 `PATCH`（`quotes/[quoteId]/route.ts:28-30`）与 `POST`（`quotes/route.ts:34-36`）；只改工具里的 `profitMargin` 而接口照旧给 `internalCost`，收不住；合起来超过 8 条 task。

## 与在审 / 将合并 change 的关系

- **CHAIN-2e** `finance-view-compare-quote-gate`（PR #556，分支 `claude/inspiring-johnson-o54xbt-chain-2e`，`35e9ae91`，与 main 的合并基点 `f9c73ba2`）：`git -C /home/user/wt/chain-2e diff origin/main --stat` 显示 149 个文件，是因为分支落后 main（删掉的都是 main 后来合入的）；`git diff origin/main...HEAD --stat` 才是它自己的 40 个文件。与本 change 重叠的只有 `scripts/test-all.sh`、`scripts/test-ci-unit.sh`（都是加登记行）与 `docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md`；它不碰 `src/lib/tender-pricing/**`、`pricing-helper-card.tsx`、`pricing-helper/route.ts`、`projects/route.ts`、`bid-intelligence/route.ts`。约束两条：它的 `src/lib/project-finance/view-hint.ts:9` import `COST_ACCESS_HINT_ZH`（本 change 不改这句）；它的 `src/lib/tender-rfq/__tests__/tracker-pure.test.tsx:323-324` 断言 `view-hint.ts → finance-view.ts → calc.ts` 这条链不引用 `node:`、`@/lib/db`、`next/`（本 change 的 `finance-view.ts` 照旧只 import `./calc` 与类型，也不 import `src/lib/project-finance/access.ts`）。顺序（GATE ⑦ 已定）：不等 CHAIN-2e（它卡在生产查询）；两边没有共同业务文件，谁后合谁先把 main 合进来重跑门禁，上面两条约束照写。两者都合并后，报价引擎的毛利率 / 定价比例与报价表助手的目标毛利是同一个门。
- **CHAIN-2d** `strategy-memo-cost-strip`（PR #538，2026-11-23 已合并 `fc321a7d`，本分支已合入并重跑它的三个测试）：它的 `buildMemoPricingAnalysis`（分支上 `src/lib/tender-intel/memo-pricing.ts:93,105`）直接读库里的 `pricingInputs.competitorPriceCad`，成本与目标毛利传 `null`，送模型的只有对手价。本 change 不改库里存的东西（只改两个接口的返回与报价表助手的返回），不影响它。业务文件不重叠（它改 `orchestrate.ts`、`strategy.ts`、`memo-pricing.ts`、`award-history`、`workbench-summary`、`generate-docs.ts`、`rfi-export.ts`、`tender-bid-draft/gather.ts` / `contract.ts`、`org-award-intel-slots.tsx`、`scripts/bid-strategy-memo-e2e.ts`）。约束一条：它的 `memo-pricing.test.ts:286-297` 遍历 `src`（不含 `__tests__`），找含 `bidStrategyMemo` 字样的文件，只放行 `src/lib/tender-pricing/finance-view.ts`——本 change 去备忘的代码留在 `finance-view.ts`，别的非测试文件不得出现这个字样。它的 design D1 写「目标毛利按 CHAIN-2b 对所有项目读者可见」（解释备忘里那句为什么不提财务查看权），本 change 合并后这个理由过时，但那句「我方成本、成本底价与毛利不在这里提供；不要推测。」仍然成立，不用改。#538 先合并，TASKFLOW 的 FIX-25 行按 tasks 4.3 改它带进来的那一行。
- **BIDPAGE**（另一个会话）的 `bid-page-summary` 金额门：本 change 不碰它。它的规格已写明不返回毛利率、加成率；它只在新页面按财务查看权藏我方报价（CHAIN-2e 改签名后门只看 `canReadAll`）。BIDPAGE 交接文档 §4 把「旧接口仍给金额（含 `GET /api/projects/{id}` 的 `ourBidPrice`）」记为留给 CHAIN-2e，但 CHAIN-2e 没有收 `ourBidPrice`——本 change 也不收（D6，GATE ① 已定）。#564 BIDPAGE-3 已合进 main：它的逐行报价接口按同一个金额门，本 change 不碰 `src/app/api/projects/[id]/bid-page/**`。

## 与八条硬纪律的关系

1. 零 schema：遵守。不改 `prisma/`；目标毛利仍存 `BidIntelligenceRoom.summaryJson.pricingInputs`，不清、不迁移。
2. 出站先审批：不涉及。没有对外发送。
3. 禁止第三套队列：不涉及。
4. 脱敏：触碰。第 4 条对 Muse 通道的做法（`price_scenario` 不传目标毛利，避免用两价反推）扩到项目读者：没有财务查看权的人在报价表助手与两个房间 JSON 接口都拿不到目标毛利；规格「目标毛利只给有财务查看权的人」「没有财务查看权时不带出的内容」「调查室 JSON 不带出我方成本」写明 SHALL NOT。Muse 不改。
5. 不爬登录页：不涉及。
6. 邮箱分离：不涉及。
7. 确定性优先：遵守。零新增模型调用；裁剪在纯函数里；`derive` 不变。
8. 测试注册：触碰。`target-margin-finance-view.test.ts`、`target-margin-finance-db.isolated.test.ts` 同一 task 里登记进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`（隔离库那个照 CHAIN-2b 的写法，没有隔离库时跳过），`scripts/check-test-registry.sh` 通过。

## 验证方式

- 不连库：`npx tsx src/lib/tender-pricing/__tests__/target-margin-finance-view.test.ts`——没有财务查看权时读取视图与保存返回的目标毛利为 `null`、成本为 `null`、`costHidden`；填了 / 没填 / 只填目标毛利三种读取结果逐字节相同；情景与「两项都为 null」直接计算相同；有权限时与直接计算逐字节相同、返回同一个对象；「碰了受限的键」含 `targetMarginPct`（数字与 `null`）、不含只带对手价或模型；房间 JSON 去掉整个 `pricingInputs` 与备忘、其它键原样、入参不变、没有可去的键时返回同一个对象；固定文字逐字；接线源码断言（路由仍经读取视图、保存返回、403 判定；两个房间 JSON 接口仍经裁剪；卡片目标毛利格、不渲染成本加成提示、保存请求不带 `targetMarginPct`、删掉那句说明）；`finance-view.ts` 不 import `node:`、`@/lib/db`、`next/`。
- 隔离库：`NODE_ENV=test npx tsx src/lib/tender-pricing/__tests__/target-margin-finance-db.isolated.test.ts`——复现数据（成本 87,654.32、目标毛利 23.7、镜像我方报价与 `ourBidPrice` 114,881.15）；只读成员、项目编辑者、没有财务键的 `org_admin`、分配范围持 `project.finance.read` 的投标同事读调查室、项目列表、报价表助手、项目详情：四个响应都没有目标毛利，`summaryJson` 没有 `pricingInputs` 与 `bidDraft`，整组响应搜不到 `23.7`、`87654.32` 与草稿内部注（去掉时间戳后搜）；本组织普通成员（不是项目成员）：项目列表列出该项目、带 `ourBidPrice`、没有 `pricingInputs`，另外三个接口 403；负责人、组织范围 `project.finance.read`、平台超级管理员读报价表助手：`targetMarginPct = 23.7` 且三人逐字节相同；编辑者保存的五次（成本 / 来源 / 目标毛利数字 / 目标毛利 `null` / 只带对手价）与判定顺序 409 → 403 → 400；库里的 `summaryJson` 在被拒时不变。
- 改动前对照：把 `finance-view.ts`、`src/app/api/projects/[id]/pricing-helper/route.ts`、`pricing-helper-card.tsx` 三个文件换回 `origin/main` 版本只跑两个新测试（只换前两个时隔离库测试会因 `hasKey is not a function` 整个抛错），记下失败条数写进报告，跑完还原（`git status` 核对）。
- 既有：`finance-view.test.ts`、`pricing-helper-finance-db.isolated.test.ts`、`compare-cost-source.test.tsx` 按 tasks 1.2 / 2.1 / 3.1 列出的几条更新后通过；`pricing-helper.test.ts`、`pricing-helper-save-db.isolated.test.ts`、`pricing-helper-lock-db.isolated.test.ts`、`compare-cost-source-db.isolated.test.ts`、`src/lib/tender-room/__tests__/room-summary-merge-db.isolated.test.ts` 原样通过（它们用项目负责人读写，或直接读库；只读成员只测写权限 403）。改动前基线（本机，main `2a0eb964`）：`finance-view.test.ts` 47 过、`compare-cost-source.test.tsx` 83 过、`pricing-helper.test.ts` 13 过。
- 全量：`npm test`、`npm run test:ci`、`npm run typecheck`、`npm run lint:baseline`、`npx openspec validate target-margin-finance-gate --strict`、`git diff origin/main -- prisma/ vercel.json` 为空。

## Risks / Trade-offs

- 不是负责人的投标同事看不到、也改不了目标毛利（与 CHAIN-2b 的成本同一批人）。他们本来就看不到成本，目标毛利在他们的情景表里不起作用（CHAIN-2b 卡片上那句说明就是这个意思），没有实际损失；有财务查看权的人照旧。
- 上线前打开的报价表助手卡，没有财务查看权的编辑者点保存会得到 403（旧卡片每次都带目标毛利），那句话写明刷新页面。
- 两个房间 JSON 接口不再带对手价与镜像价：仓库里没有读者（Context），仓库外的调用方无法从代码确认。
- 本 change 合并后，项目读者仍能拿到我方成本或供应商报价的地方：询价列表、询价明细与旧比价接口给供应商报价原价（`src/lib/inquiry/service.ts:191-201`、`src/app/api/projects/[id]/inquiries/[inquiryId]/compare/route.ts:6-11`，CHAIN-2e 只改了 `compare/matrix` 与 `compare/analysis`；FIX-26）；旧报价单接口、编辑器、报价单 PDF 与 Excel 直接给内部成本与利润率（生产在用，出口 #7）、问青砚 `project_get_project_quotes`（出口 #8，组织成员即可）、CHAIN-2e 合并前的报价引擎（开关生产未设）、CHAIN-2d 合并前的旧版备忘。「项目读者拿不到成本」要等这几处都收口才成立，报告里照实写。
- 负责人是导入系统账号的项目，卡片上「需要的话请找项目负责人」没人可找（CHAIN-2b 已有）。
- 不新增授权查询：报价表助手每次读取与保存的 2 次 `authorize` 是 CHAIN-2b 已有的。

## GATE（已定）

协调会话 2026-11-23 按推荐定（Lucas 2026-11-22 授权「都按照你的推荐来」）；独立审查没有阻断项，审查意见 F1–F11 已改进四件套。

1. **我方报价收不收——已定 A：不另收**（D6）。本 change 只是让两个房间 JSON 接口顺带不再带镜像价；项目行 `ourBidPrice`、报价引擎售价等照旧给项目读者。报告留一份「与我方报价配对即可反推成本的字段」清单（目标毛利、报价引擎毛利率 / 定价比例 / 加成率、旧报价单利润率、问青砚报价工具的利润率、项目预算的利润百分比），每条写明本 change 后的状态与归属。
2. **没有财务查看权的人能不能改目标毛利——已定 A：不能，写请求带了目标毛利就 403**（D3）。
3. **房间 JSON 去整个 `pricingInputs` 还是只去目标毛利——已定 A：去整个**（D5）；同一处顺手去掉 `bidDraft`（D5b，审查 F6）。
4. **文案——已定按推荐，措辞按文案审查调整（Lucas 2026-11-22 授权按推荐）**：403「没有保存：页面已更新，目标毛利现在和我方成本一样，只给有财务查看权的人改。请刷新页面，重新填写后再保存。」（多审 X1；原句「页面已更新，没有保存：需要财务查看权才能修改我方成本和目标毛利。请刷新页面，重新填写后再保存。」先说「页面已更新」易被扫成存上了，「修改我方成本和目标毛利」让只改了对手价的人困惑）；目标毛利格是固定标签「目标毛利」加「需要财务查看权才能看目标毛利。」（多审 X2），与成本格同一写法。
5. **开关——已定 A：不加开关，合并即生效**（D7）。
6. **范围外同类出口——已定另开 FIX-26，紧接本 change**：旧报价单（原 FIX-21 后续 8；报价单 PDF 打印「Profit Margin」单列优先，另有 Excel、AI 审查、`src/lib/agent/skills/quote.ts`）、询价列表 / 明细 / 旧比价接口的供应商报价（审查 F4）、问青砚 `project_get_project_quotes`。本 change 不改它们（D8）。
7. **合并顺序——已定调整：不等 CHAIN-2e**（它卡在生产查询）。两边没有共同业务文件，谁后合谁先把 main 合进来重跑；约束照写：`src/lib/project-finance/view-hint.ts:9` 用的 `COST_ACCESS_HINT_ZH` 不改；`finance-view.ts` 不引用 `node:`、`@/lib/db`、`next/`，也不 import `src/lib/project-finance/access.ts`；CHAIN-2d 的 `memo-pricing.test.ts:286-297` 只允许 `finance-view.ts` 这一个非测试文件出现 `bidStrategyMemo` 字样。CHAIN-2d 先后不限；TASKFLOW 的 FIX-25 行按 tasks 4.3 处理。

需要生产数据或人确认（实现会话连不上生产库）：

```sql
-- 只读：存了目标毛利的房间里，同时有我方报价的、能精确反推的各有多少
WITH pi AS (
  SELECT (r."summaryJson"->'pricingInputs'->>'targetMarginPct')::numeric AS m,
         (r."summaryJson"->'pricingInputs'->>'ourCostCad')::numeric AS cost,
         COALESCE((r."summaryJson"->'pricingInputs'->>'ourPriceCad')::numeric, p."ourBidPrice"::numeric) AS price
  FROM "BidIntelligenceRoom" r JOIN "Project" p ON p.id = r."projectId"
  WHERE jsonb_typeof(r."summaryJson"->'pricingInputs'->'targetMarginPct') = 'number'
)
SELECT count(*) AS with_margin,
       count(*) FILTER (WHERE price IS NOT NULL) AS with_margin_and_price,
       count(*) FILTER (WHERE price IS NOT NULL AND cost IS NOT NULL AND abs(price * (1 - m / 100) - cost) < 0.01) AS exact_reverse
FROM pi;
-- 只读：生产里有没有报价引擎写过的报价（有的话旧报价单详情接口会把它的定价比例与内部成本给项目读者）
SELECT count(*) AS engine_quotes FROM "ProjectQuote" WHERE "calcVersion" IS NOT NULL OR "quoteType" <> 'CUSTOM';
```

- `TENDER_QUOTE_ENGINE_ENABLED` 在生产确实没设（CHAIN-2e 依据文档，未从生产核实）。
- 仓库外有没有调用方读 `GET /api/projects` 或 `…/bid-intelligence` 返回的 `pricingInputs`（代码里没有，看不到服务端日志）。
