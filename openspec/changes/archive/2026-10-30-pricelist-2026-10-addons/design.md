# Design

## Context

见 proposal.md「Why」。已核实的现状（2026-10-30，main @ `cb680ab`）：

- `src/lib/blinds/pricing-addons.ts`：`ADDON_CATALOG` 7 项（motor 150 / hub 240 / remote 40 / track6–12 60–120），`AddonDef = { key, displayName, printLabel, unitPrice, eligibleProducts }`；`calcAddonSubtotal` 按目录价 × `max(1, qty)`；`getEligibleAddons` 无调用方。
- Part B（`part-b.tsx`）下拉直接列 `ADDON_CATALOG`，选中后带入目录价，单价与数量（整数）都可改，另有"Custom item"自定义行；行存在 `PartBAddon { id, skuItem, customName?, qty, price, total }`，只随 `formDataJson` 保存。
- `page.tsx` 新建（POST）和编辑（PUT）请求体都没有 `addons`（约 1010–1040 行）→ 服务端 `calculateQuoteTotal` 的 `addonsSubtotal` 为 0，`SalesQuoteAddon` 无行，`grandTotal` 不含 Part B。对客金额另走 `formDataJson.displayGrandTotal`（`src/lib/sales/quote-display-amounts.ts`），所以客户看到的数字是对的，但期间汇总（`src/lib/sales/period/load.ts` 取 `grandTotal`）与签约改价比较（`quotes/[quoteId]/route.ts` 比 `grandTotal`）都看不到 Part B。
- 服务端已有附加项目落库链路：`quotes/route.ts` 与 `quote-update.ts` 把 `addons: { addonKey, qty }[]` 写成 `SalesQuoteAddon { addonKey, displayName, unitPrice, qty, subtotal }`，单价取目录价；目前只有"快速报价"面板与 AI 解析会传。
- 客户 PDF（`quote-pdf.ts` ~975 行）Part B 名称用 `displayName`；分享页（`src/app/quote/[token]/page.tsx`）在无 PDF 时列库里附加项目的 `displayName`。
- 企业设置：`discount-settings.ts` 已有 `pricing.discounts`（PRICE-1）与 `pricing.cordless`（PRICE-2）两套"读 / 只合并子键 / 校验 / 保存路由"；审批 payload 的 `numericPatch: Record<string, number>` 由执行器原样交给 `saveDiscountsForOrg`。
- 价表证据：`config/pricelist/2026-10-28-lucas-quote.json` 的 `retailAddonsCsv`（11 行）、`excelAddons`（40 行，`price` 为 null 的是按英尺或比例项，原文在 `rawPrice`）、`fees.downtown = 150`。
- 引擎已计价、不能再当附加项目的 Excel 行：Door Screen Sheer W≤25 / 25<W≤40（`DOOR_SCREEN_SHEER_RULES` MSRP 170.45 / 227.27，折后 150 / 200）；Open roll Valance 25 / 50（Roller 罩盒加价 `cassetteBump`，宽 ≥ 50 取 50）。

## Goals / Non-Goals

**Goals:**
- 目录每一项都能追溯到价表文件的一行，Excel 每一行都有归类，测试守住这两点（防止手敲价格）。
- 新保存的报价，库里的附加项目小计 = Part B 小计，统计与签约改价比较看到的总额包含附加项目。
- 企业可以改附加项目价，走同一条审批。

**Non-Goals（不动的东西）:**
- `config/pricelist/2026-10-28-lucas-quote.json`、`config/pricelist/2026-10-28-golden-cases.json`：只读契约。
- `src/lib/blinds/pricing-data.ts`、`priceFor` 与产品行定价；`DOOR_SCREEN_SHEER_RULES` 与 Roller 罩盒加价。
- `src/lib/sales/period/**`、`openspec/specs/sales/period-summary`：口径不改（仍取 `grandTotal`）。
- `src/lib/sales/quote-display-amounts.ts`：对客金额取数顺序不变。
- 特别让利（`specialPromotion`）进不进库里总额（Out of scope，单独立 change）。
- `src/app/api/sales/measurements/[id]/generate-quote/route.ts`、`src/lib/sales/ai-quote-parser.ts` 的解析逻辑（AI 提示词里的目录列表随目录自动变长）。
- `src/lib/sunny-process/**`：附加项目不进工艺单。
- `prisma/schema.prisma`、`SalesQuoteAddon` 列集合、`PendingAction` payload 类型。
- `src/lib/muse-bridge/**`。

## Decisions

### D1 目录项带来源，Excel 行逐行归类，测试对照价表文件
- 做法：`AddonDef` 增加 `unit: "each" | "ft"`、`group`（下拉分组：Blinds motor / Drapery motor / Track & rod / Shutter / Service）、`hint?`（内部提示）、`source`（`{ kind: "retail", key }` / `{ kind: "excel", id }` / `{ kind: "fee", path: "downtown" }`）。目录顺序：零售表按 `display_order`，其后 Excel 项按行号，最后 Downtown。另导出 `EXCEL_ADDON_DISPOSITION: Record<excelId, { kind: "catalog" | "duplicate" | "engine" | "superseded" | "skip"; ref?; reason }>`。新测试读价表 JSON：目录 36 项单价逐项等于来源；按英尺项单价等于 `rawPrice` 里的数字；40 个 Excel ID 全部出现在归类表中且分类计数为 24 / 10 / 4 / 1 / 1。
- 否决：运行时直接读 JSON 生成目录 —— 客户端包体要带整份价表文件，且 Excel 名称是中英混写，客户可见名仍需人工给。否决：只把零售表 11 项进目录、其余留自定义 —— Lucas 的诉求是"直接在青砚上报价"，Channel Rod / 垫板 / 百叶窗配件都是常用项。

### D2 目录内容（36 项）
- 零售表 11 项原样：`motor` 150、`motor_plugin` 350、`motor_battery_matter` 190、`hub` 240、`remote` 40、`drape_motor_battery` 650、`drape_motor_plugin_matter` 700、`track6/8/10/12` 60 / 80 / 100 / 120。
- Excel 进目录 24 项：`motor_charger` 40（excel-addon-2，提示"每单首根免费，第二根起 40"）、`drape_remote` 40（-10）、`drape_charger` 40（-11，同上提示）、`drape_hub` 300（-12，P3-2）、`channel_rod_6ft/8ft/10ft/12ft` 82.5 / 112 / 145 / 178（-15..-18）、`spacer_6ft/8ft/10ft/12ft` 60 / 80 / 100 / 120（-25..-28，客户名 Spacer Board，P3-4）、`curved_track_flexible` 150（-29，每窗）、`curved_track_rigid` 75（-30，每弯）、`shutter_valance_5ft/8ft/12ft` 110 / 150 / 200（-31..-33）、`shutter_track_5ft/8ft/12ft` 200 / 300 / 400（-38..-40）、按英尺 `drape_track_extra_ft` 30（-13，提示"超过 13 ft 的部分"）、`channel_uhl_ft` 18（-14）、`shutter_frame_vinyl_ft` 4（-23）、`shutter_frame_wood_ft` 7（-24）。
- 服务：`downtown_fee` 150（`fees.downtown`，Q6）。
- 归类为重复（10）：-3 → `remote`（P3-3）、-4 → `motor`、-5 → `motor_battery_matter`、-6 → `motor_plugin`、-8 → `drape_motor_plugin_matter`、-9 → `drape_motor_battery`、-19..-22 → `track6..12`。引擎计价（4）：-34、-35（Door Screen Sheer）、-42、-43（Open roll Valance）。旧值（1）：-7 SUNNY Hub 300（Q7）。不做（1）：-46 黑色方盒 +15%（Q8）。
- 新键一律含下划线：本地文字解析按键名正则匹配（`ai-quote-parser.ts` `parseLocalQuotePlan`），"downtown"之类的普通词不会误加费用。
- 否决：Open roll Valance 也进目录 —— 与 Roller 罩盒加价重复收费；注意 Excel 写"≤ 50" 25"，引擎（与原工具 `price()`、黄金用例一致）是"宽 ≥ 50 取 50"，以引擎为准，报告里记一笔。

### D3 按英尺单位
- 做法：`unit: "ft"` 的项小计 = 单价 × 数量（数量 = 英尺数，整数，沿用 Part B 数量框）；`calcAddonSubtotal` 不区分单位（同一算式），只影响显示：Part B 下拉显示"$30/ft"、数量框占位"ft"，PDF 单价列"$30.00/ft"、数量列"13 ft"。
- 否决：新增"长度"字段并允许小数英尺 —— Part B 行结构与 `SalesQuoteAddon.qty`（Int）都要变；价表按整英尺报。

### D4 Part B 计入报价金额（P3-1）
- 做法：`QuoteAddonInput` 增加可选 `unitPrice?`、`displayName?`。`page.tsx` 构造请求体时 `addons = partBAddons.filter(已选 && qty > 0).map(...)`：预设行 `{ addonKey: skuItem, qty, unitPrice: price }`，自定义行 `{ addonKey: "custom", qty, unitPrice: price, displayName: customName || "Custom item" }`。服务端统一用 `resolveAddonLines(addons, orgAddonPrices)` 得到落库行与小计：单价取提交值（有限且 0–100000），否则取企业价，键不在目录且无单价则单价 0 并写进价格提示；名称取客户可见名（自定义取提交名，截断 120 字）。`calculateQuoteTotal` 的 `addonsSubtotal` 与落库行用同一函数，保证一致。
- 否决：服务端忽略提交单价、一律按企业价 —— Part B 单价本来就可改且客户看到的是改后价，库里按目录价会与客户金额不一致，统计照样不准。否决：统计改读 `formDataJson.displayGrandTotal` —— 要改 KPI-1 / STAT-1 口径和全部汇总查询（JSON 解析不能进 SQL 聚合），影响面大得多。

### D5 企业价（`pricing.addons`）与审批
- 做法：`readJsonAddonPrices(settingsJson)` → 36 项完整价表（坏值、缺键回目录价，未知键丢弃）；`mergeJsonAddonPrices(settingsJson, patch)` 只改 `pricing.addons` 下提交的键。PUT 体 `addonPrices: { key: n }` 由 `validateAddonPricesInput` 校验后转成 numericPatch 键 `addonPrice.<key>`，与现有数值 diff 一起进审批 payload；执行器不改，`saveDiscountsForOrg` 遇 `addonPrice.` 前缀的键路由到 `pricing.addons`。DTO 加 `addonPrices: Record<string, number>`；新建与编辑两个服务端入口传企业价（预览接口不收附加项目，不动）；Part B 下拉与 `rough-quote-panel` 用 DTO 里的价。驾驶舱折扣卡加"附加项目价格"折叠表（分组显示，改动的格子随现有"保存"一并提交）。
- 否决：整表 `addonPrices` 作为 payload 新字段（像 `costRates` 那样整表替换）—— 要改 `SalesUpdateQuoteSettingsPayload` 类型、执行器与幂等键；按键进 numericPatch 不动这三处，审批描述也能逐项显示。

### D6 已签约报价与历史数据
- 已签约报价含 Part B 的，第一次重新保存时库里总价会从"不含 Part B"变为"含 Part B"，按既有 `signed-quote-amount-approval` 进入改价审批。这是正确口径（此前 Part B 改价完全绕开了签约改价审批），在报告 BREAKING 写明。
- 不做历史回填：老报价下次保存时自然更新；回填需要逐份解析 `formDataJson` 并改动已签约报价金额，风险大于收益。
- 否决：签约报价重存时把"仅因 Part B 首次入库"的差额豁免审批 —— 需要判断差额来源，规则复杂且给改价留后门。

### D7 对客名称与内部提示
- 做法：`addonCustomerLabel(def | custom)` 统一给 PDF 与落库 `displayName` 用：目录项取 `printLabel`，自定义取销售填写名。`hint` 只在 Part B 下拉下方以灰字显示，不进 `displayName`、PDF、分享页、邮件。
- 否决：落库 `displayName` 仍存内部名、分享页再映射 —— 分享页对历史行无从映射，且邮件也读库里名称。

## 八条硬纪律

1. 零 schema：触碰。企业价进 `Organization.settingsJson.pricing.addons`；Part B 进既有 `SalesQuoteAddon` 行与 `addonsSubtotal` 列；验证 `git diff origin/main -- prisma/` 为空。
2. 出站先审批：不涉及对外发送；企业价修改走既有 `sales.update_quote_settings` PendingAction。
3. 禁止第三套队列：不涉及，无新 cron / 队列 / worker。
4. 脱敏：触碰（对客输出）。内部提示文字不进客户 PDF / 分享页 / 邮件（spec「附加项目对客名称与不输出内部提示」）；不输出成本（附加项目本次无成本数据）。
5. 不爬登录页：不涉及。
6. 邮箱分离：不涉及。
7. 确定性优先：价格全查表，无新 LLM 调用；AI 解析的提示词目录列表随目录变长，调用次数不变。
8. 测试注册：新增 `src/lib/blinds/__tests__/pricelist-2026-10-addons.test.ts`，注册到 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`；`scripts/check-test-registry.sh` 通过，`ci/test-registry-baseline.txt` 不增。

## 验证方式

- `npx tsx src/lib/blinds/__tests__/pricelist-2026-10-addons.test.ts`：36 项来源对照、40 行归类计数、按英尺小计 390、对客名称、企业价覆盖下的小计、`resolveAddonLines`（提交单价优先 / 预设缺单价取企业价 / 自定义名 / 未知键）。
- `npx tsx src/lib/blinds/__tests__/cost-rates.test.ts`：`readJsonAddonPrices` / `mergeJsonAddonPrices` / `validateAddonPricesInput`。
- `npx tsx src/lib/sales/__tests__/quote-settings-approval.test.ts`：描述含 `addonPrice.downtown_fee=180`。
- `npx tsx src/lib/sales/__tests__/ai-quote-parser.test.ts`：文本"customer lives downtown, 2 zebra 48x60"不产生附加项目；"2 motor"仍得 `motor` × 2。
- 隔离库 `NODE_ENV=test npx tsx src/lib/sales/__tests__/quote-settings-db.isolated.test.ts`：老板改价 → 202 → 批准 → 只写 `pricing.addons`；真实路由新建报价带 Part B 两行 → 附加项目小计 680、总额含之；编辑报价改 Part B → 小计更新；企业价 160 下新建报价 `motor` × 2 未带单价 → 320。
- 黄金对照 `pricelist-2026-10-golden.test.ts` 158 条不变；typecheck、lint:baseline、test:ci、registry、`openspec validate pricelist-2026-10-addons --strict`、`npm run build`。
- 浏览器走查（生产构建 + 隔离库 + Playwright）：Part B 分组下拉、"$30/ft"、保存后库里 `addonsSubtotal`、客户 PDF 名称；390px 无溢出。
