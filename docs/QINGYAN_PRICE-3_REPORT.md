# PRICE-3 报告：附加项目目录 36 项 + Excel 逐行归类 + 按英尺 + 企业价审批 + Part B 计入库里报价金额

change：`openspec/changes/pricelist-2026-10-addons/`。规格增量：`sales/price-list` 新增 6 条，`sales/quote-settings-approval` 新增 1 条；design D1–D7；tasks 6 / 6。
来源：2026-10-28 价表（任务书 `docs/QINGYAN_PRICE-1_PRICELIST_TASKBRIEF.md` §2 D7 / D8、§3.3；Q6 / Q7 / Q8）。四件套 Lucas 2026-10-30 确认，P3-1 至 P3-4 按推荐。
零 schema：企业价存 `Organization.settingsJson.pricing.addons`；Part B 写既有 `SalesQuoteAddon` 行与 `addonsSubtotal` 列；`git diff origin/main -- prisma/` 为空。无出站、无新 cron、无新 LLM 调用。

## 1. 做了什么

| 场景 | 之前 | 现在 |
|---|---|---|
| Part B 预设 | 7 项（motor 150 / hub 240 / remote 40 / track 6–12 ft） | **36 项，分 5 组**。零售表 11 项（新增 `motor_plugin` 350、`motor_battery_matter` 190、`drape_motor_battery` 650、`drape_motor_plugin_matter` 700）；Excel 独有 24 项（Channel Rod、Spacer Board、弯轨、Shutter Valance / Track、窗帘遥控 / 充电器 / Hub 等）；Downtown 服务费 150 |
| 价格来源 | 代码里手写 | 每项的 `source` 指向 `config/pricelist/2026-10-28-lucas-quote.json` 中的一行，新测试逐项对照 |
| Excel 40 行 | 未进青砚 | 逐行归类：进目录 24、与零售表重复 10、已由引擎计价 4、旧值 1、本次不做 1；出现未归类行时测试失败 |
| 按英尺 | 无 | Motorized Drape Track $30/ft、U/H/L Channel $18/ft、Shutter Frame Vinyl $4/ft、Wood $7/ft。数量即英尺数；Part B 和 PDF 显示"13 ft"与"$30.00/ft" |
| **库里报价金额** | 报价单页面保存时**不传 Part B**，`SalesQuote.addonsSubtotal = 0`，`grandTotal` 不含附加项目。按人统计（KPI-1 / STAT-1）与签约改价比较都看不到 Part B | 报价单页面新建 / 编辑时，Part B 中已选且数量 > 0 的行作为附加项目提交。服务端按销售填写的单价落库，未填单价的预设行按企业价。`addonsSubtotal` 与落库行用同一函数计算。走查中库里 `grandTotal` 1253.59，与客户看到的 1253.60 只差四舍五入 |
| 企业价 | 无 | 驾驶舱折扣卡新增"附加项目价格"折叠表（36 项，按组）。存 `pricing.addons.{key}`，以 `addonPrice.<key>` 形式进入 `sales.update_quote_settings` 审批（老板提交、另一位老板批准），批准后只更新该子键 |
| 对客名称 | 落库与 PDF 用销售端名称（如 `TRACK 6 ft (72")`） | 用客户可见名（`Track 6 ft`），自定义行用销售填写的名称。内部提示（"每单首根免费，第二根起 40"）只在 Part B 下拉下方以灰字显示，不进 PDF、分享页、邮件和落库名称 |

## 2. 改了哪些文件

| 文件 | 内容 |
|---|---|
| `src/lib/blinds/pricing-types.ts` | `AddonDef` 加 `unit` / `group` / `hint` / `source`；`QuoteAddonInput` 加 `unitPrice?` / `displayName?`；`QuoteTotalInput.addonPrices?` |
| `src/lib/blinds/pricing-addons.ts` | 36 项目录、`EXCEL_ADDON_DISPOSITION`、`effectiveAddonPrice`、`addonCustomerLabel`、`formatAddonUnitPrice`、`resolveAddonLines`、`normalizeAddonInputs`、`partBRowsToAddonInputs`；`calcAddonSubtotal` 接企业价 |
| `src/lib/blinds/pricing-engine.ts` | `calculateQuoteTotal` 透传企业价 |
| `src/lib/blinds/discount-settings.ts` | `readJsonAddonPrices` / `mergeJsonAddonPrices` / `validateAddonPricesInput`；DTO `addonPrices`；保存时把 `addonPrice.` 前缀的键写到 `pricing.addons` |
| `src/app/api/sales/quote-settings/discounts/route.ts` | PUT 接 `addonPrices` 并并入 numericPatch；super_admin 直改时审计 diff 含附加项目价 |
| `src/app/api/sales/quotes/route.ts`、`src/lib/sales/quote-update.ts` | 附加项目落库与小计同源（`resolveAddonLines`）；未知键的提示写进价格提示备注 |
| `src/app/(main)/sales/quote-sheet/{part-b,page,quote-pdf,rough-quote-panel}` | 分组下拉、企业价、"/ft"、内部提示；保存时提交 Part B；PDF 对客名称与按英尺显示；快速报价透传企业价 |
| `src/app/(main)/sales/cockpit/discount-settings-card.tsx` | 附加项目价格表；只提交改动的键 |
| 测试 | 新增 `src/lib/blinds/__tests__/pricelist-2026-10-addons.test.ts`（注册到 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`）；扩展 `cost-rates`、`quote-settings-approval`、`ai-quote-parser`、`quote-settings-db.isolated` |

## 3. 怎么验

| 项 | 结果 |
|---|---|
| `npx tsx src/lib/blinds/__tests__/pricelist-2026-10-addons.test.ts` | 14 条通过：36 项对照价表文件（零售 11 项逐字段一致，Excel 24 项等于来源行，按英尺项等于 `rawPrice` 中的数字）、40 行归类 24 / 10 / 4 / 1 / 1、重复项价格与零售表一致、`drape_track_extra_ft` × 13 = 390、对客名称不含中文且不含提示、企业价覆盖、`resolveAddonLines` 各种情形、Part B 行映射、`calculateQuoteTotal` 含 Part B（+768.40） |
| `cost-rates` / `quote-settings-approval` / `ai-quote-parser` | 通过 / 23 / 通过（"customer lives downtown" 不产生附加项目；"2 motor" 仍得 `motor` × 2） |
| 黄金对照 `pricelist-2026-10-golden` | 158 条、787 断言、0 失败（不变） |
| 隔离库 `quote-settings-db.isolated.test.ts` | **49 / 0**。老板 PUT `{addonPrices:{motor:160}}` → 202 → 另一位老板批准 → `pricing.addons = {motor:160}`，`pricing.cordless` / `discounts` / `sunnyWarranty` 原样；GET 返回 36 项；非法 → 400 且不建审批。真实路由新建报价带 Part B → `addonsSubtotal` 680、两行落库名称正确、未选行不提交、含税多出 768.40；企业价 160 下 `motor` × 2 未带单价 → 320；编辑改成 hub @200 → 200 |
| `NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck` | 退出 0（合并最新 main 前后各一次） |
| `npm run lint:baseline` | PASS（无新增 error fingerprint） |
| `npm run build` | 退出 0 |
| `bash scripts/check-test-registry.sh` | 合并最新 main 后已注册 522 个，欠账 71 不变 |
| `openspec validate pricelist-2026-10-addons --strict` | valid |
| `git diff origin/main --stat -- prisma/` | 空 |

### 3.1 浏览器走查（生产构建 + 隔离库 + Playwright，销售岗；截图 `docs/price-3-screenshots/`）

| 步骤 | 结果 |
|---|---|
| Part B 下拉 | 38 个选项 = 36 项 + 占位 + Custom item；5 组：Blinds motor 6、Drapery motor 6、Track & rod 15、Shutter 8、Service 1；按英尺项显示"$30/ft" |
| Motorized Drape Track 数量 13 | 行合计 $390.00，单价旁标 "/ft"，下方灰字"电动轨道超过 13 ft 的部分按英尺计" |
| Hub 改价 200、自定义 Extra bracket 2 × 15、充电线 1 | SUBTOTAL (B) $660.00；充电线下方显示内部提示 |
| Save | `POST /api/sales/quotes` 201，请求体 `addons` 共 4 行（单价为销售填写值，自定义带名称） |
| 落库 | `addonsSubtotal` 660；4 行名称为 Motorized Drape Track (over 13 ft) / Hub / Extra bracket / Sunny Motor Tube Charging cable；`preTaxTotal` 1109.375 = 产品 174.375 + 附加 660 + 安装补足 200 + 运费 75；`grandTotal` 1253.59，`formDataJson.displayGrandTotal` 1253.60 |
| 客户 PDF（下载到本地） | Part B 表 `Motorized Drape Track (over 13 ft) │ 13 ft │ $30.00/ft │ $390.00`、`Hub │ 1 │ $200.00`、`Extra bracket │ 2 │ $15.00`、`Sunny Motor Tube Charging cable │ 1 │ $40.00`；全文不含"免费 / 首根" |
| 390px | 无横向溢出 |

走查中"PDF 存档失败"弹窗是沙箱没有配 Vercel Blob token（`BLOB_READ_WRITE_TOKEN`），与本次改动无关。

### 3.2 全量（合并最新 main `856e4fe` 后，隔离库）

| 项 | 结果 |
|---|---|
| `NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck` | 退出 0 |
| `npm run test:ci` | 退出 0 |
| GitHub CI `validate-lint-typecheck-test-build`（#357 head） | success |
| `npm test` | **535 / 545**，10 个失败，全部不是本 change 引起（下表） |

| 失败的测试 | 结论 |
|---|---|
| TypeScript 类型检查（`npx tsc --noEmit`，默认堆） | 内存不够：合并 main 后代码量增加，默认约 2 GB 堆不够。在 origin/main 的 worktree 上执行同一条命令同样 `heap out of memory`（退出 134）。加 `--max-old-space-size=8192` 的 typecheck 和 GitHub CI 都通过 |
| Mention Gateway M2-A Identity DB | 既有：`db push` 不建三条 CHECK 约束（PRICE-1 / PRICE-2 报告同项） |
| Sunny 工艺单 签字→草稿→门禁→确认→导出 DB 端到端 | 既有：`mark-signed` 报 NO_BINDING（同上） |
| Phase3A-3 Approvals Smoke / 3A-4 Acceptance / 3A-4 Governance Smoke / 3A-5 Overview Acceptance | 既有：本地库无双租户种子 |
| T4 授标情报真实 Postgres 矩阵 | 既有环境性 |
| Quote Operations 客户报价 PDF 分页布局 | 既有：PDF 渲染环境（页脚） |
| Autopilot A2-P0 Isolated E2E | 既有：全量负载下偶发（PRICE-2 时单独重跑 96 / 0）；本次没有改 autopilot |

本 change 相关的测试在全量中全部通过：附加项目目录、黄金对照、`cost-rates`、`quote-settings-approval`、`ai-quote-parser`、`quote-settings-db.isolated`。

## 4. 实施中对规划的调整 / 发现（审核请重点看）

1. **Excel 有 4 行引擎已经算过，不能再当附加项目。** Door Screen Sheer W≤25" / 25<W≤40"（150 / 200）就是 `DOOR_SCREEN_SHEER_RULES` 的折后价；Open roll Valance 25 / 50 就是 Roller 罩盒加价。如果再做成附加项目，会重复收费。另外 Excel 写的是"≤ 50" 25"，引擎（与原工具 `price()`、黄金用例一致）是"宽 ≥ 50 取 50"，以引擎为准。
2. **预览接口不收附加项目，所以没改。** 设计原稿写的是"四个入口传企业价"；核对后只有新建和编辑两个入口会落库附加项目，规格和设计已在 propose 阶段改为"新建、编辑与 Part B 下拉"。
3. **落库名称改为对客名称。** 此前快速报价 / AI 入口落库的是销售端名称（如 `TRACK 6 ft (72")`），现在统一为 `printLabel`（`Track 6 ft`）。客户分享页在没有 PDF 时直接显示库里的名称，所以这样才对。
4. `rough-quote-panel` 的企业价通过它自己的设置请求透传给内嵌工具（tasks 4.1 原写"page 传给它"），效果相同；落库金额仍以服务端企业价为准。

## 5. 上线后要做 / 已知限制

- **BREAKING 1**：报价单页面保存后，库里报价金额从此包含 Part B。按人 / 按期间统计会比改动前高出附加项目部分（这才是正确口径）。
- **BREAKING 2**：已签约且有 Part B 的报价，第一次重新保存时库里总价会从"不含 Part B"变成"含 Part B"，会触发一次既有的签约改价审批（design D6）。此前 Part B 改价完全绕开了签约改价审批。
- 历史报价不回填，下次保存时才更新。
- **特别让利（Special Promotion）仍没有从库里报价总额扣除**，统计在有让利的单子上偏高。建议作为下一个 change 处理（proposal Out of scope）。
- "每单首根充电线免费"只是提示文字，不会自动减价。
