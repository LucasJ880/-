# Proposal：旧报价单、报价导出、报价 AI 与询价里的内部成本、利润率和供应商报价只给有财务查看权的人（FIX-26）

TASKFLOW：FIX-26（原「待定」FIX-21 后续 8，`docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md:308`；FIX-25 design GATE ⑥ 定为紧接 FIX-25）。同时收掉 CHAIN-2e 报告 §5 登记的两行「编号待定」：「legacy 报价接口收口（打开 `TENDER_QUOTE_ENGINE_ENABLED` 之前必须修）」与「问青砚 `project_get_project_quotes` 返回毛利率、不查项目读权限与财务查看权」（这两行在 CHAIN-2e 分支的 TASKFLOW 里，#556 合并后才进 main）。核对基线：main `c376be86`。**开工前提**：task 1（报价单 PDF）不依赖任何在审 change；其余 task 等 CHAIN-2e（#556）合并后再做（用它的判定入口与提示句，design D1）。不改 `src/lib/muse-bridge/**`，受影响的 Muse 意图见下。**没有开关，合并即生效。**

## Why

能读项目的人（含只读成员、不是项目成员的组织管理员；问青砚报价工具是本组织任一成员）能从旧报价单接口、编辑器、Excel、AI 审查与起草、智能体报价技能拿到我方内部成本、每行成本价和利润率，报价单 PDF 还把「Profit Margin」印在给客户的报价单上；询价接口把每家供应商的单价、总价给所有项目读者。成本核算、报价表助手（CHAIN-2b）与报价引擎（CHAIN-2e）对同类数字早已只给有财务查看权的人，旧报价单与询价这条路没收。

## What Changes

- 改报价单 PDF：对所有人都不再印「Profit Margin」；PDF 只有报价头、行项表（序号、类别、品名、规格、单位、数量、单价、合计）、Subtotal 与 Total Amount；不提供带利润率的内部版 PDF。
- 判定财务查看权与报价编辑权：与成本核算、报价引擎（CHAIN-2e）同一口径——能看 = 平台超级管理员、持组织范围 `project.finance.manage` 或 `project.finance.read` 的人、项目负责人；能编辑 = 能看且（财务特权，或项目角色带成本写权限）；授权查询出错时只剩平台超级管理员与负责人，提示写「暂时无法确认」。
- 裁剪报价单列表 `GET /api/projects/{项目}/quotes`：没有财务查看权的人每份报价 `profitMargin` 为 `null`、响应带 `costHidden: true`；所有人多拿到 `capabilities`；总额照旧。
- 收窄报价单详情 `GET …/quotes/{报价}`：对所有人只返回旧报价单字段，不再带报价引擎的估算成本、毛利、加成、成本分解、情景、定价比例与行项内部溯源；没有财务查看权的人内部成本、利润率、内部备注、AI 草稿与审查原文、每行成本价为 `null`，带 `costHidden: true`。
- 拒绝旧接口处理报价引擎的报价：所属组织不为空的报价（报价引擎、逐行报价建的）经旧接口读详情、修改、删除、AI 审查 → 409 并给报价页地址，不写库、不调模型。
- 收紧旧报价单的写：新建、修改（含确认）、删除、保存 AI 草稿要能编辑报价，否则 403、不写库（今天只读成员也能改价、确认、删草稿）。
- 收紧报价 AI：AI 审查要有财务查看权，AI 起草要能编辑报价，否则 403、不调模型；有资格的人请求与模型输入不变。
- 改旧报价单编辑器与报价管理区块：没有财务查看权时不显示成本价一栏、内部成本、利润率，规则检查不出利润率检查项；不能编辑时只读，不出保存 / 确认 / 新建 / AI 起草 / AI 审查 / AI 自动流，写一句为什么、找谁；读取失败写原因，不再显示空白表单。
- 改 Excel 导出：有财务查看权的人导出「内部成本表」（首行写明含成本和利润率、不要发给客户）；没有的人导出的文件不含内部成本、利润率与成本价一列。
- 按执行的人改智能体报价技能：审查只认本项目的报价；没有财务查看权时审查不调模型、不出成本与利润率，起草不调模型并写明为什么。
- 收紧问青砚两个工具：`project_bid_quote` 与 `project_get_project_quotes` 先查项目读权限；后者对没有财务查看权的人 `profitMargin` 为 `null`、带 `costHidden`。
- 裁剪询价接口里的供应商报价（GATE ①，按推荐 A 写）：询价列表、单轮明细、旧比价与询价写接口的返回，对没有财务查看权的人每家供应商的单价、总价、报价备注为 `null`、轮次带 `priceHidden: true`；没有财务查看权的人录入供应商报价 → 403、不写库；询价明细表写一句为什么、找谁。
- 加测试：PDF 内容、裁剪与界面的不连库测试；隔离库按身份逐条核对每个出口、在响应里搜少见的数、本机假模型服务数调用次数。

## 受影响的 Muse 意图

不改 `src/lib/muse-bridge/**`，没有直接受影响的意图。间接影响：

- `compare` / `price_scenario`：照旧取比价矩阵（`src/lib/muse-bridge/router.ts:475-560`），带所选供应商落地价（决定 A），不经旧报价单与询价接口，行为不变。GATE ① 选 A 后，Muse 与网页对供应商价格的口径不同——由 CHAIN-2e 登记的「Muse compare / price_scenario 看项目读权限与财务查看权」一行处理。
- `quote.parsed` / `missing_fields` 事件：照旧把供应商总价或单价推给项目负责人（`src/lib/muse-bridge/events-pure.ts:85`，`userId: ownerId`）；负责人自带财务查看权，与本 change 口径一致。
- `next_step` / `status`：只数报价份数（`router.ts:594`）与询价状态，不读价格，不变。
- `rfq` / `chase` / `ask`：不读报价单与询价价格，不变。

## Out of scope

- CHAIN-2e（#556）已管的，本 change 不重复：比价矩阵与 AI 报价分析的落地价及其模型输入、询价追踪页的落地价、报价引擎 14 个路由文件与「报价与成本」卡、投标页报价区、「我方报价」卡、单个报价页。
- 供应商原价在 CHAIN-2e 改动文件里的出口：比价矩阵行里的 `quoted`、AI 报价分析模型输入里的原价、询价追踪页「报价 CAD x / 件」（`src/lib/tender-rfq/tracker-pure.ts:232-233`）；以及供应商履历 `GET /api/suppliers/{供应商}/history`、组织项目智能的供应商平均单价。GATE ① 选 A 时由 FIX-26b 在 CHAIN-2e 合并后一起收（design 出口表 #17–#20）。
- 逐行报价 `src/app/api/projects/[id]/bid-page/quotes/**` 与 `src/lib/bid-page-v2/**`（BIDPAGE-3，已按金额门）；新页面挂哪些组件。
- 目标毛利、报价表助手、房间 JSON（CHAIN-2b / FIX-25）；我方报价 `ourBidPrice` 的可见范围（FIX-25 D6）。
- 判定规则本身（`src/lib/project-finance/access.ts`）；CHAIN-2b 与 CHAIN-2e 两份兜底判定合成一份（CHAIN-2e 登记的「编号待定」）。
- 旧报价单 PATCH 接受任意 `status` 字符串、PDF 的中文字体与「Template」一行。
- 版本历史抽屉与报价管理区块把报价引擎的报价链到旧编辑器（链接不改；打开后编辑器按 409 写去处）。
- AI 面板「输出版本」三个没有接线的按钮（只对没有财务查看权的人藏起「内部成本表」，不接线）。
- 销售域报价（`SalesQuote`、`src/app/api/sales/quotes/**`）、外贸报价（`TradeQuote`）。
- 项目财务接口、Muse 的权限与审计（CHAIN-2e 登记的「编号待定」）；智能体步骤输出经 `GET /api/agent/approvals` 的 `previewJson`（FIX-23 后续 1）。
- 不迁移、不清任何已存数据。

## Capabilities

### New Capabilities

- `projects/legacy-quote-finance-view`：旧报价单（列表、详情、写、AI 审查与起草、编辑器、PDF、Excel）、智能体报价技能与问青砚两个报价工具，谁能看内部成本与利润率、谁能改、被拒时返回什么、不输出什么、界面写什么。
- `tender/inquiry-supplier-price-view`：项目询价接口（列表、单轮明细、旧比价、写接口返回、录入报价）里的供应商单价、总价、报价备注给谁、不输出什么、询价明细表写什么。

### Modified Capabilities

无。

## Impact

- 新增：`src/lib/quote/export-content.ts`（PDF 与 Excel 的内容，纯函数）、`src/lib/quote/finance-view.ts`（报价单的裁剪、白名单、是否报价引擎的报价、固定文字）、`src/lib/inquiry/finance-view.ts`（询价条目的裁剪与固定文字）。
- 修改：`src/app/api/projects/[id]/quotes/route.ts`、`…/quotes/[quoteId]/route.ts`、`…/quotes/[quoteId]/ai/review/route.ts`、`…/quotes/ai/generate-draft/route.ts`、`…/quotes/save-ai-draft/route.ts`；`src/app/api/projects/[id]/inquiries/route.ts`、`…/[inquiryId]/route.ts`、`…/[inquiryId]/compare/route.ts`、`…/[inquiryId]/items/route.ts`、`…/items/[itemId]/{mark-sent,mark-replied,mark-declined,mark-no-response,select,record-quote}/route.ts`；`src/lib/quote/export-pdf.ts`、`export-excel.ts`、`rules.ts`；`src/lib/agent/skills/quote.ts`；`src/lib/agent-core/tools/project-skills.ts`、`enterprise-readonly.ts`；`src/components/quote/{quote-editor,quote-summary-bar,quote-top-summary,quote-line-table,quote-ai-panel,project-quote-section}.tsx`；`src/components/inquiry/inquiry-detail.tsx`。
- 测试：新增 `src/lib/quote/__tests__/export-customer-pdf.test.ts`、`legacy-quote-finance-view.test.ts`、`legacy-quote-finance-db.isolated.test.ts`，`src/lib/inquiry/__tests__/inquiry-price-view.test.ts`、`inquiry-price-view-db.isolated.test.ts`；不连库的进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`，隔离库的进 `scripts/test-all.sh`。
- 接口（合并即生效）：只读成员、operator、不是负责人的项目管理员、没有财务键的组织管理员、`bids` 岗位同事从旧报价单与询价接口拿不到成本、利润率与供应商报价，也不能再新建 / 修改 / 确认 / 删除旧报价单、录入供应商报价、用报价 AI；负责人、持组织范围财务键的人、平台超级管理员看到的数字与改动前相同。
- 零 schema、零依赖、不新增模型调用（被拒的 AI 请求不调模型）；文档 `docs/QINGYAN_FIX-26_REPORT.md`、`docs/acceptance/fix-26/prod-check.sql`，TASKFLOW 第 308 行改为 FIX-26。
