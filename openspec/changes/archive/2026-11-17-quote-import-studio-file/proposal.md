# Proposal

## Why

销售在 SUNNY SHUTTER 报价工具里报完价，成交后要在青砚详细订单里把同一单再录一遍；工具能导出 `.sunny-quote.json`，青砚没有入口能读它。QUOTE-1a（#456）已把详细订单的 Roller 罩型与实木百叶窗计价对齐，导入这条路现在能把工具里的行算对（任务书 `docs/QINGYAN_QUOTE-1_QUOTE_FILE_IMPORT_TASKBRIEF.md`「What · QUOTE-1b」）。

TASKFLOW：QUOTE-1b（`docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` Phase Q）。

规则只有一条：文件只告诉青砚「填了什么」，价格由青砚算；文件比青砚便宜的部分变成特别让利，走现有审批；导入不丢行、不静默改数，改了什么逐条列给销售看。

## What Changes

- 在报价工作台「详细订单」加「导入报价文件」按钮，接受 `.json`；文件只在浏览器里读，不上传原文件。
- 校验文件：只接受格式 `sunny-quote-studio`、`version` 为 1、行数 ≤ 500、附加项目 ≤ 200、大小 ≤ 35 MB、产品属于青砚的 11 个品类；不通过时给出中文原因，不进核对窗。
- 文件含多套方案时先让销售选一套；每次导入只填一套、对应一张报价。
- 把文件行映射成详细订单的表单行：数量 N 拆成 N 行；宽高取整到 1/16"；Shades 产品带 SKU 与文件里的面料档；Roller 的面料档拆成基础面料 + 行上 Valance；Shutters 按材质填、两种材质混用时阻断；Drapery / Sheer / Door Screen Sheer 填 Drapes 行。
- 让销售为褶皱率不是 1.8 / 2.3 的布帘、纱帘行逐行选 180 或 230（Lucas 2026-11-15 拍板：详细订单仍只有两档，落档由销售定）；全部选完才能填入表单。
- 处理文件里的行级折扣与成交价：折扣低于企业默认（价格更高）的保留到行上并随行提交；折扣高于企业默认或成交价低于青砚价的，差额累加进特别让利；成交价高于青砚价的只列提醒。
- 映射附加项目与费用：金额 ≥ 0 的附加项目进 Part B（名称与目录完全相同时用预设键，否则自定义行），金额 < 0 的累加进特别让利；Downtown 服务费用预设键；安装 / 送货组合映射为安装方式，运费差额进特别让利或自定义行；税率照填。
- 比对文件自带价表与青砚价表（只比本次用到的品类）；不一致时核对窗不显示文件金额并提示。
- 新增核对窗：逐行并排显示文件金额 / 青砚金额 / 差额 / 处理方式，底部并排显示两边合计与本次计入的特别让利；提示分「阻断」与「提醒」两级；无阻断时「填入表单」。
- 填入后按电话或邮箱在已加载的客户里找唯一匹配，找到才自动选中，否则停在选择 / 新建客户。
- 给详细订单 Shades 行加可选的定价面料与行级折扣、Drapes 行加可选的行级折扣（只落 `formDataJson`）；SKU 下拉在当前值不在目录里时把它显示为「目录外」选项。
- 在表单数据里写只读留痕 `formDataJson.importSource`；保存带留痕的报价时写一条审计 `quote_imported`（新建与修改两条路径，同一次导入只写一次）。
- 不新增页面路由、权限键、接口；能新建报价的人就能导入。无 BREAKING：不导入的报价金额与行为不变。

## Capabilities

### New Capabilities
- `sales/quote-file-import`：把报价工具导出的文件导入详细订单——入口与流程、文件校验、多方案选择、行与费用映射、褶皱率落档、折扣与成交价的处理、特别让利累加、价表比对、核对窗、客户匹配、留痕与审计、不上传与不留存的内容。

### Modified Capabilities
- `sales/price-list`：新增三条要求——详细订单行可带定价面料、详细订单行可带行级折扣、SKU 下拉显示目录外的当前值。既有要求不改。

## Impact

- 新增：`src/lib/sales/quote-import/`（类型、校验、映射、金额对照四个纯函数模块 + `__tests__/` 与样例夹具）、`src/app/(main)/sales/quote-sheet/import-review-dialog.tsx`（核对窗）。
- 修改：`quote-sheet/{page.tsx,types.ts,order-items.ts,pricing-helpers.ts,order-shades.tsx,order-drapes.tsx,sku-select.tsx,quote-draft.ts,quote-pdf.ts}`、`src/lib/blinds/order-form-pricing.ts`、`src/app/api/sales/quotes/route.ts` 与 `src/lib/sales/quote-update.ts`（各加一条审计）、`scripts/test-all.sh`、`scripts/test-ci-unit.sh`。
- 依赖：QUOTE-1a 已合并（#456）。实施的第一条 task 是拿到工具包与真实导出文件核对字段结构——本提案的文件结构来自任务书的描述，工具源码不在仓库里。
- 接口、权限键、路由门映射表、Prisma schema、`vercel.json`、企业设置键：无变化。新数据只落 `formDataJson` 与 AuditLog。
- 不触碰 muse-bridge：无受影响 Muse 意图。

## Out of scope

- 窗户照片、试装图、面料色样、画册页的导入与存储；文件里这些内容读到即丢弃，只提示数量。
- 多方案在青砚里的关联、对比与「签一套作废其余」；每套方案是互不相干的一张报价。
- 按面料系列的折扣；本期靠保留文件里的行级折扣兜住。
- 替换旧版快速报价 `public/sunny-quote.html`、`rough-quote-panel.tsx`。
- 旧格式 `sunny-owner-quote`、工具的完整备份 `sunny-workspace-backup`、Excel 报价模板的导入。
- 重复导入的拦截（只留痕与审计，不查重）；从青砚导出回工具。
- 把工具 SKU 补进青砚 SKU 目录；一张报价里混用两种百叶窗材质。
- Door Screen Sheer 的口径与详细订单的褶皱率两档（180 / 230）：Lucas 2026-11-15 拍板先不变，本 change 不改。
- 服务端对行级折扣加上限；在详细订单里手工录入行级折扣（本期行级折扣只来自导入，表单上只能清除）。
- 服务端接收或保存原文件；为导入新增任何接口。
