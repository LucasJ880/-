# Proposal：报价做法一「逐行报价」，成本存进系统（BIDPAGE-3）

TASKFLOW：BIDPAGE-3（Phase F（续）— 标书与报价页改版；任务书 `docs/QINGYAN_BIDPAGE_BID_QUOTE_REDESIGN_TASKBRIEF.md`「BIDPAGE-3」、「不确定处」1 / 2 / 4 与附录 C 决定 A / C / H）。不触碰 muse-bridge，无受影响的 Muse 意图。

## Why

招标方给了价格表、要逐行填单价的标（只供货居多），今天要在浏览器里的成本卡上逐行算（成本只存在这台电脑上，换电脑、换人就看不到），再到报价引擎的「专业模式」里另做一遍报价，两边的数还得自己对。Evan 2026-11-22 拍板：成本数据存到系统里，换电脑、换人都能看到（拍板第 6 条）。

## What Changes

- **新建报价先问两句**（新页面 ② 定报价，有编辑权限且看得到金额的人）：「这个标怎么交价？」——逐行报价（本 change；「只报总价」由 BIDPAGE-4 加上）；「业务类型」——只供货（默认）/ 供货加安装 / 长期供货协议。逐行 + 只供货 → 新建一份逐行报价；另两种业务照今天的模板建好，从专业模式打开。选择存在 `ProjectQuote.engineJson.entryMode`（`engineConfigSchema` 加一个可选字段 `"LINE"`）；没有这个字段的报价（今天所有的报价）一律按专业模式打开。
- **逐行表**：7 列「品名 | 数量 | 供应商报价（原币）| 到手单位成本（加元）| 我方单价 | 行合计 | 毛利率」。行来自投标工作区已保存且校验通过的价格表；没有时可从招标分析带入到粘贴框、由人核对后导入，或直接粘贴、手加行。「供应商报价」可从第 ① 步已回的询价里点选一家，也可手填；手填必须选证据类别（已签报价 / 平台标价 / 零售价 / 估计）。
- **共用参数**：汇率（每种币一个）、海运费、报关费、关税率、国内运费；四项预置——资金使用（年化 8% × 月数）、管理费（自含 3%）、现金备用金 1%、提成（毛利 × 30%）——值与专业模式的模板相同，逐项可改、可关，旁边一句话写出真实算法；目标毛利率（按售价）。
- **只有一套算法**（不确定处 1 / 4）：逐行表就是报价引擎成本行的另一种排法（一个价格表行 = 一条货品成本行，共用参数与预置各一条成本行），顶部四个数（报价合计 | 成本合计 | 利润 | 毛利率）一律取 `computeQuote` 的结果。每行的到手成本、我方单价、毛利率按货值比例从引擎结果分摊（只用于显示与导出）；我方单价取到分、行合计 = 单价 × 数量，逐行合计与报价合计差几分钱时在顶部写明差多少、为什么（design D4）。
- **成本存库**：逐行输入与选择写进既有 `QuoteCostLine`（行身份放 `metadata.bidLine`，另起新版时随引擎照抄），不写 `QuoteLineItem`（附录 C 决定 H），不写浏览器本地存储，不写投标工作区。新增接口在 `/api/projects/{id}/bid-page/quotes/…`：第一步过 `requireQuoteAccess`，再要财务查看权（金额门，附录 C 决定 C），读要 `internal_cost`、写要 `edit`；开关关、组织不在名单、不是招投标项目时 404。
- **旧的本地成本草稿**：这台电脑上有 `costDraftStorageKey` 的草稿时，在逐行报价上提示一次「发现这台电脑上有未保存到系统的成本草稿，导入到这份报价？」，人点了才填进表里（再由人保存）；不自动上传，不导入也不删（判断点 6）。
- **导出**：② 底部「按招标方价格表导出」（`official-export.ts`），只在我方报价已定且是逐行报价时可用；导出的单价、行合计与逐行表一致。
- **②「定报价」换成新区块**：不再挂投标工作区面板（它把成本写在浏览器里，且依赖投标工作区的开关与接口）与旧报价区；我方报价卡保留到 BIDPAGE-6；旧「外贸标准报价」折叠在最下面（判断点 4 的完整处理在 BIDPAGE-8）。每份不是逐行做的报价、以及逐行报价的「更多」里，都有「专业模式」入口（原 `PricingControlCenter` 页，完整保留）。
- **「下一步」**：「已定 → 导出价格表 / 生成投标文件」的按钮改为去 ②（导出就在 ② 底部，③ 紧接在下面）。

## Out of scope

- 「只报总价」（BIDPAGE-4）、AI 毛利建议（BIDPAGE-5）、一次定价与「提交给负责人」（BIDPAGE-6）、第 ① 步（BIDPAGE-2）、第 ③ 步（BIDPAGE-7）、专业模式与模板说明的中文化和判断点 4（BIDPAGE-8）。逐行报价的提交 / 批准 / 选为我方报价本 change 仍走专业模式与我方报价卡。
- 不改 `computeQuote`、`QUOTE_ENGINE_CALC_VERSION`、`QUOTE_TRANSITIONS`、成本类别与计算方式、预置比例的默认值；不新增类别。
- 不改既有接口（`/quote-engine*`、`/bid-workspace*`、`/inquiries*`）的行为与金额口径（CHAIN-2e #556 在改 `quote-engine/access.ts` 与专业模式组件，本 change 不碰这些文件）；不改专业模式页面。
- 不恢复「有编辑权、没有财务查看权」的人在新页面上编辑报价：按 Evan 2026-11-22 对 CHAIN-2e 的答复 ①（谁做报价谁就是负责人，负责人有财务特权），新页面的报价区只给看得到金额的人（design D7）。
- 不打开、不依赖 `TENDER_BID_WORKSPACE_ENABLED` 与它的接口；只读它存下的价格表与招标分析带入的纯函数。
- 不做 MOQ / 整箱取整（引擎没有，tender-bid-cost 那一套不进逐行表，design D4）；不做多张价格表、多币种对比。
- 不改环境变量、不打开开关。

## Capabilities

### New Capabilities

- `tender/quote-line-mode`：逐行报价的对外行为——新建时的两问、逐行表与共用参数、存库与权限、按引擎结果分摊的显示口径与差额说明、从询价回复选价、旧本地草稿导入、按招标方价格表导出、与专业模式的关系。

### Modified Capabilities

- `tender/bid-page`：② 定报价分区的内容换成新区块（不再挂投标工作区面板与旧报价区）；「已定我方报价」的按钮去处改为 ②。

## Impact

- 新增：`src/lib/bid-page-v2/quote-line/`（契约、成本行映射、分摊、草稿导入为纯函数；服务一个）；`src/app/api/projects/[id]/bid-page/quotes/route.ts`（列表 / 新建）、`…/[quoteId]/line/route.ts`（读 / 存）、`…/[quoteId]/export/route.ts`（导出）；`src/components/bid-page-v2/` 下 ② 的新组件；测试（纯逻辑、渲染、隔离库端到端），在 `scripts/test-all.sh` / `scripts/test-ci-unit.sh` 注册。
- 修改：`src/lib/quote-engine/contract.ts`（`engineConfigSchema` 加可选 `entryMode`）、`src/lib/quote-engine/service.ts`（导出既有的 `nextQuoteNumber`，不改行为）、`src/components/bid-page-v2/bid-page-v2.tsx`（② 的内容）、`src/lib/bid-page-v2/next-step.ts`（一条去处）。
- 开关关着时：旧页面、旧接口、专业模式行为不变；`engineConfigSchema` 对没有 `entryMode` 的配置解析结果不变（测试逐条对照）。
- 零 schema；无新增模型调用、无出站、无队列 / 定时任务。
