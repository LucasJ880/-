# Proposal

## Why

2026-10-28 价表带来 11 项结构化零售附加项目和 Excel `ADD ON参考` 40 行，青砚 Part B 只有 7 个预设，其余靠销售手写自定义行，名称和价格无从核对（任务书 `docs/QINGYAN_PRICE-1_PRICELIST_TASKBRIEF.md` §2 D7 / D8、§3.3）。另外报价单页面保存时不把 Part B 传给服务端（`page.tsx` 两处请求体都没有 `addons`），库里的报价金额不含附加项目，而"每个人报了多少钱 / 成交多少"的统计（KPI-1 / STAT-1）正是按库里金额加总，电机、轨道这类附加项目一张单可达数百到上千元，全部漏算。

TASKFLOW：PRICE-3（`docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` Phase P）。

## What Changes

- 附加项目目录扩为 36 项：零售表 11 项原样（新增 `motor_plugin` 350、`motor_battery_matter` 190、`drape_motor_battery` 650、`drape_motor_plugin_matter` 700，其余 7 项价格不变）+ Excel 独有的 24 项（20 项固定价、4 项按英尺）+ Downtown 服务费 150（Q6）；每项记录它在 `config/pricelist/2026-10-28-lucas-quote.json` 里的来源行。
- Excel 40 行逐行归类：进目录 24、与零售表重复 10、已由定价引擎计价 4（Door Screen Sheer 150 / 200、Open roll Valance 25 / 50）、旧值 1（SUNNY Hub 300，Q7）、本次不做 1（黑色方盒 +15%，Q8），新测试断言没有未归类的行。
- 新增按英尺计价单位：Motorized Drape Track $30/ft、U/H/L Channel $18/ft、Shutter Frame Vinyl $4/ft、Wood $7/ft；数量即英尺数，Part B 与客户 PDF 显示"/ft"。
- Part B 下拉按分组列出全部预设，显示企业价；客户 PDF 与分享页的附加项目名称用客户可见名（`printLabel`），不出现内部提示文字。
- **BREAKING** 报价单页面保存（新建与编辑）时把 Part B 每个已选行（预设或自定义、数量 > 0）作为附加项目传给服务端；服务端按销售填写的单价落库，没填单价的预设行按企业价；库里的附加项目小计与报价总额从此包含 Part B。
- 附加项目企业价：`Organization.settingsJson.pricing.addons.{key}`（零 schema），老板在驾驶舱折扣卡的附加项目表里改，走既有 `sales.update_quote_settings` 审批，批准只替换该子键；报价新建、编辑与 Part B 下拉统一按企业价。

## Capabilities

### New Capabilities
（无）

### Modified Capabilities
- `sales/price-list`：新增附加项目目录与来源、Excel 行归类、按英尺计价、Part B 计入报价金额、附加项目企业价落点、客户可见名称与不输出内部提示六条要求。
- `sales/quote-settings-approval`：新增要求——附加项目企业价经 PUT 折扣接口提交、进入审批、批准后只写 `pricing.addons` 子键。

## Impact

- 目录与计价：`src/lib/blinds/{pricing-types,pricing-addons,pricing-engine,discount-settings}.ts`
- 报价入口：`src/app/api/sales/quotes/route.ts`、`src/lib/sales/quote-update.ts`
- 企业设置：`src/app/api/sales/quote-settings/discounts/route.ts`、`src/app/(main)/sales/cockpit/discount-settings-card.tsx`
- 报价单 UI：`src/app/(main)/sales/quote-sheet/{part-b,page,quote-pdf,types}.tsx`
- 统计：`src/lib/sales/period/**` 不改代码；新保存的报价金额含 Part B 后，期间汇总自然包含附加项目
- 签约改价审批：已签约报价若有 Part B，第一次重新保存时库里总价会变化，触发既有 `sales.update_signed_quote` 审批（口径正确，见 design D6）
- 测试：新增 `src/lib/blinds/__tests__/pricelist-2026-10-addons.test.ts`（注册到 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`）；扩 `cost-rates`、`quote-settings-approval`、`quote-settings-db.isolated`、`ai-quote-parser`
- 不触碰 muse-bridge：无受影响 Muse 意图

## 待 Lucas 确认（四件套审核时一并回复；未回复按推荐实施）

| # | 问题 | 推荐 |
|---|---|---|
| P3-1 | Part B 计入库里报价金额（上面 BREAKING 一条），统计从此含附加项目 | 做（不做则按人统计持续漏算附加项目） |
| P3-2 | Excel 里 Sunny Motorized Drape Hub 300（零售表没有窗帘 Hub）要不要进目录 | 进，按 Excel 300；Q7 的"300 是旧值"只针对卷帘 SUNNY Hub |
| P3-3 | Excel 的 Sunny Motor Tube 6C RMT 40 与零售表 SUNNY Remote Control 40 是不是同一件 | 视为同一件，不重复列 |
| P3-4 | "加垫板"与"布帘弯轨"的英文客户名 | Spacer Board 6 / 8 / 10 / 12 ft；Curved Track – Flexible (per window)；Curved Track – Rigid (per bend) |

## Out of scope

- 报价单"特别让利"（Special Promotion）不从库里报价总额扣除，统计因此偏高，这是另一个口径问题，PRICE-3 之后单独立 change。
- 历史报价的金额回填（老报价下次保存时才含 Part B）。
- "卷帘斑马帘黑色方盒 + 黑底杆 +15%"（Q8，继续用自定义行）。
- 经销商附件成本表、附件成本率、附件进工艺单。
- "每单首根充电线免费"之类的自动规则（只做 Part B 提示文字）。
- 量房生成报价、AI 解析入口新增附加项目识别（AI 提示词里的目录列表随目录自动变长，不改解析逻辑）。
- `config/pricelist/2026-10-28-lucas-quote.json` 本身不改。
