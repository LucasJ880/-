# Proposal：「标书与报价」页改版骨架——三步分区 + 「下一步」（BIDPAGE-1）

TASKFLOW：BIDPAGE-1（Phase F（续）— 标书与报价页改版；任务书 `docs/QINGYAN_BIDPAGE_BID_QUOTE_REDESIGN_TASKBRIEF.md`「BIDPAGE-1」与附录 C）。不触碰 muse-bridge，无受影响的 Muse 意图（只读取 `src/lib/tender-next-step/service.ts` 已有的取数，Muse 的查表与文案不变）。

## Why

「标书与报价」页把九块东西从上往下堆，做事的顺序（找供应商 → 询价 → 定报价 → 出文件）在页面上是反的，用户说「太复杂了」。本 change 先搭新页面的骨架与开关，后面七个 change 往三个分区里填内容；开关关着时页面与今天逐字节一致。

## What Changes

- 新增开关 `TENDER_BID_PAGE_V2_ENABLED` + `TENDER_BID_PAGE_V2_ORG_ALLOWLIST`（写法照 `src/lib/tender-bid-workspace/flags.ts`，名单为空 = 所有组织），默认关。
- 新增只读接口 `GET /api/projects/{id}/bid-page-summary`：总闸关时在任何鉴权与取数之前返回 404；组织不在名单、不是招投标项目时也返回 404；否则返回「下一步」、三个分区各一句状态与看的人能否看金额。金额只给同时有报价内部成本权限（`requireQuoteAccess` 的 `canViewInternal`）与财务查看权（`resolveFinancePrivilege(...).canReadAll`）的人；对任何人都不出成本、毛利、供应商报价。
- 新增「下一步」查表（纯函数，不调模型）：招标要求未批准且还没往下走 → 已定我方报价 → 有未定的报价（含已批准未选）→ 没有供应商 → 没发过询价（有待批询价卡时改说「等批准后发出」）→ 发了还在等 → 回复了没报价 → 开始做报价，每条带一个只导航的按钮。与任务书的出入见 design D3。
- 新增新页面：右上角「更多」里放「版本历史」；顶部「下一步」；下面三个可折叠分区「① 找供应商、询价」「② 定报价」「③ 出文件」，标题右侧一句状态，默认展开 `#位置` 所在或「下一步」指向的那一步。三个分区本 change 先挂既有组件（不改它们），由 BIDPAGE-2 / 3 / 4 / 6 / 7 替换；带金额的既有组件（询价区、我方报价卡、报价区、投标工作区）只给看得到金额的人挂，其余人看到一句说明（design D5）。
- 新增入口组件：项目页「标书与报价」页签改为渲染入口组件；入口没拿到「已开启」时原样渲染旧 `BidTab`，不在浏览器里记任何标记。`src/components/project-detail/tabs/bid-tab.tsx` 一个字不改（任务书附录 C 决定 B）。
- 在 `.env.example` 登记两个新开关。
- 新增「开关关 = 零变化」测试：开关关时入口组件的服务端渲染结果与旧 `BidTab` 逐字节相同；入口的旧分支原样渲染旧 `BidTab`、属性不变；入口在接口 404 / 出错 / 说没开时始终渲染旧页面。本 change 的 diff 里没有 `bid-tab.tsx`。

## Out of scope

- 不改三个分区里的既有组件（`TenderSourcingEntry`、`ProjectInquirySection`、`ProjectSupplierLinks`、`TenderOurBidCard`、`BidQuoteArea`、`ProjectGenerateMenu`、`BidWorkspacePanel`）；它们的合并、替换与中文化是 BIDPAGE-2 ～ 8 的事。
- 新页面不放 `ChinaSupplierBriefPanel`（去向以 #544 为准），也不删它。
- 不改项目页已有的「下一步」卡（FLOW-H1，`tender/web-next-step`）与 Muse 的 `next_step` 查表。
- 不改报价引擎、询价、审批、出站、生成文件的任何行为，不改任何既有接口；不改 `computeQuote` 与 `QUOTE_ENGINE_CALC_VERSION`。
- 不处理已结束 / 已提交 / 已中标的项目（任务书七条没有；项目页 FLOW-H1 卡照旧管）。
- 专业模式里的运行信息（漂移提示）不在本 change 收口，由 BIDPAGE-3 处理（design D5）。
- 不打开、不依赖 `TENDER_BID_WORKSPACE_ENABLED`。
- 不改环境变量、不打开开关（由 Evan / Lucas 本人操作）。

## Capabilities

### New Capabilities

- `tender/bid-page`：「标书与报价」页改版后的对外行为——开关与入口分流、三步分区、「下一步」查表、汇总接口与金额可见范围。BIDPAGE-2 ～ 8 在这份规格上继续增改。

### Modified Capabilities

无。

## Impact

- 新增：`src/lib/bid-page-v2/`（`flags.ts`、`next-step.ts`、`service.ts`）；`src/app/api/projects/[id]/bid-page-summary/route.ts`；`src/components/bid-page-v2/`（入口、新页面、分区、下一步横条）；测试三份（纯逻辑、渲染与零变化、隔离库端到端），在 `scripts/test-all.sh` 注册。
- 修改：`src/app/(main)/projects/[id]/page.tsx` 一处 import 与 `BidTab` 那一行（`BidTab` → 入口组件，属性不变）。该文件同时被 #539（CHAIN-2c）修改，改动处相距十几行，无文本冲突（附录 C 决定 B）。`scripts/test-all.sh`、`scripts/test-ci-unit.sh` 各加注册行；`.env.example` 加说明。
- 开关关着时每次进页签多一次 `GET …/bid-page-summary`（总闸关时不鉴权、不读库，直接 404），页面渲染结果不变。
- 零 schema；无新增模型调用、无出站、无队列 / 定时任务。
