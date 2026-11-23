# Proposal：报价做法一「逐行报价」，成本存进系统（BIDPAGE-3）

TASKFLOW：BIDPAGE-3（Phase F（续）— 标书与报价页改版；任务书 `docs/QINGYAN_BIDPAGE_BID_QUOTE_REDESIGN_TASKBRIEF.md`「BIDPAGE-3」、「不确定处」1 / 2 / 4 与附录 C 决定 A / C / H）。不触碰 muse-bridge，无受影响的 Muse 意图。

## Why

招标方有价格表、要逐行填单价的标，今天成本只记在这台电脑的浏览器里，报价还得到专业模式另做一遍、两边的数自己对。Evan 2026-11-22 拍板：成本存到系统里，换电脑、换人都能看到（拍板第 6 条）。

## What Changes

- 加报价配置的可选做法字段 `engineJson.entryMode = "LINE"`（`engineConfigSchema`；不认识的值只丢掉这个字段）；没有这个字段的报价（今天所有的报价）一律按专业模式打开。
- 加新建时的两问（新页面 ② 定报价，有编辑权限且看得到金额的人）：「这个标怎么交价？」（本 change 只有逐行报价；只报总价由 BIDPAGE-4 加）、「业务类型」（只供货（默认）/ 供货加安装 / 长期供货协议）。逐行 + 只供货 → 新建逐行报价；另两种业务照今天的模板建好，打开专业模式。
- 加逐行表，7 列「品名 | 数量 | 供应商报价（原币）| 到手单位成本（加元）| 我方单价 | 行合计 | 毛利率」；行来自投标工作区存下且校验通过的价格表，没有时从招标分析带入粘贴框（人核对后导入）、粘贴或手加行。
- 加供应商报价的两种来源：从本项目已报价的询价回复里点选一家，或手填并必选证据类别（已签报价 / 平台标价 / 零售价 / 估计）。
- 加共用参数（每种外币一个汇率、海运费、报关费、关税率、国内运费）与四项预置（资金使用 8% × 月数、管理费自含 3%、现金备用金 1%、提成 = 毛利 × 30%），值取自专业模式只供货模板，逐项可改、可关，旁边写真实算法；加目标毛利率（按售价）。
- 让顶部四个数（报价合计 | 成本合计 | 利润 | 毛利率）只取报价引擎 `computeQuote` 的结果；每行的到手成本、我方单价、毛利率按货值比例从引擎结果分摊（只用于显示与导出），单价取到分、行合计 = 单价 × 数量，逐行合计与报价合计不等时在顶部写明差多少、为什么（design D4）。
- 把逐行输入存进既有 `QuoteCostLine`（行身份放 `metadata.bidLine`，另起新版照抄）；不写 `QuoteLineItem`、浏览器本地存储与投标工作区。
- 加五个接口 `/api/projects/{id}/bid-page/quotes`（列表 / 新建）、`…/{quoteId}/line`（读 / 存）、`…/{quoteId}/export`（导出）：第一步报价权限守卫，读要内部成本权限、写要编辑权限，之后新页面开关与招投标项目（404）、财务查看权（403）。
- 加旧本地成本草稿的一次性提示：人点「导入」才填进表里、再由人保存；不上传、不删草稿（判断点 6）。
- 加 ② 底部「按招标方价格表导出」：我方报价已定且是逐行报价时可用，导出的单价、行合计与逐行表相同。
- 换掉新页面 ② 的内容：不再挂投标工作区面板与改版前的报价区；我方报价卡保留到 BIDPAGE-6；旧「外贸标准报价」折叠在最下面；逐行报价的「更多」与列表里的专业模式报价都有「专业模式」入口。
- 改「下一步」「已定 → 导出价格表 / 生成投标文件」的去处：我方报价是逐行报价时去 ②（导出在那里），否则照旧去 ③。

**与任务书的出入**（理由见 design）：

1. 没有财务查看权的人在新页面上连「报价合计」也看不到（任务书验收 5 写「只看到报价合计」）——按附录 C 决定 C「新页面所有金额都要金额门」（design D7）。
2. 有编辑权、没有财务查看权的人在新页面上不能做报价——Evan 2026-11-22 对 CHAIN-2e 的答复 ①（design D7）；BIDPAGE-1 TASKFLOW 里记的「恢复」义务改判。
3. 「逐行」只配「只供货」；供货加安装、长期供货协议转去专业模式（design D1）。
4. 提交、批准、选为我方报价仍在专业模式里做（我方报价卡点进去也是专业模式；只有一份已批准时系统自动选中），一次定价是 BIDPAGE-6。
5. 生产上几乎没有存过的价格表（只有投标工作区面板能存，它的开关没开、新页面也不挂它），逐行表的行实际从「招标分析带入 → 人核对 → 导入」来；验收 5「行自动来自已确认的价格表」在预发要先有存过的价格表才能照原样验（design D5）。

## Out of scope

- 「只报总价」（BIDPAGE-4）、AI 毛利建议（BIDPAGE-5）、一次定价与「提交给负责人」（BIDPAGE-6）、第 ① 步（BIDPAGE-2）、第 ③ 步（BIDPAGE-7）、专业模式与模板说明的中文化、判断点 4（BIDPAGE-8）。
- 不改 `computeQuote`、`QUOTE_ENGINE_CALC_VERSION`、`QUOTE_TRANSITIONS`、成本类别与计算方式、预置比例的默认值；不新增类别。
- 不改既有接口（`/quote-engine*`、`/bid-workspace*`、`/inquiries*`）的行为与金额口径；不碰 CHAIN-2e（#556）在改的 `quote-engine/access.ts`、`quote-engine-contract.test.ts` 与专业模式组件；不改专业模式页面。
- 不打开、不依赖 `TENDER_BID_WORKSPACE_ENABLED` 与它的接口；只读它存下的价格表与招标分析带入的函数。
- 不做 MOQ / 整箱取整、多张价格表、多币种对比；逐行报价只按加元报价。
- 不改环境变量、不打开开关。

## Capabilities

### New Capabilities

- `tender/quote-line-mode`：逐行报价的对外行为——新建两问、逐行表与共用参数、存库与权限、接口与状态码、按引擎结果分摊的显示口径与差额说明、从询价回复选价、旧本地草稿导入、按招标方价格表导出、与专业模式改同一份报价时的行为。

### Modified Capabilities

- `tender/bid-page`：② 的内容换成新区块（不再挂投标工作区面板与改版前的报价区，旧版报价单进金额门）；「已定我方报价」的按钮在我方报价是逐行报价时去 ②；改版前投标工作区的 `#位置` 落到 ②。

## Impact

- 新增：`src/lib/bid-page-v2/quote-line/`（契约、成本行映射、分摊、草稿导入为纯函数；接口门与服务各一个）；`src/app/api/projects/[id]/bid-page/quotes/route.ts`、`…/[quoteId]/line/route.ts`、`…/[quoteId]/export/route.ts`；`src/components/bid-page-v2/quote-step.tsx`；测试三份（纯逻辑、渲染、隔离库端到端），在 `scripts/test-all.sh` / `scripts/test-ci-unit.sh` 注册。
- 修改：`src/lib/quote-engine/contract.ts`（`engineConfigSchema` 与 `EngineConfig` 加可选 `entryMode`）、`src/lib/quote-engine/service.ts`（导出既有的 `nextQuoteNumber`，不改行为）、`src/components/bid-page-v2/bid-page-v2.tsx`（② 的内容）、`src/lib/bid-page-v2/next-step.ts` 与 `service.ts`（「已定」的去处）。
- 开关关着时：旧页面、旧接口、专业模式行为不变；`engineConfigSchema` 对没有 `entryMode` 的配置解析结果不变（测试对照）。
- 零 schema；无新增模型调用、无出站、无队列 / 定时任务。
