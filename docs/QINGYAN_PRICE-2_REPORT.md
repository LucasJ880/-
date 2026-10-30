# PRICE-2 报告 — 无绳显式开关 + 独立折扣 / 最低价 / 取消 75" 上限 + 布帘纱帘褶皱率

change：`openspec/changes/pricelist-2026-10-cordless-fullness/`（proposal / specs：`sales/price-list` 新增 5 条、修改「黄金用例对照」，`sales/quote-settings-approval` 新增 1 条，`sunny/process-order-autogen` 修改「报价到工艺字段的映射」/ design D1–D7 / tasks 7/7）
来源：2026-10-28 价表（任务书 `docs/QINGYAN_PRICE-1_PRICELIST_TASKBRIEF.md` §2 D3–D6）；Q4 Lucas 2026-10-30 选 A（无绳改为显式开关）；四件套 Lucas 2026-10-30 确认。
零 schema：无绳开关与褶皱率随 `SalesQuote.formDataJson`，无绳设置存 `Organization.settingsJson.pricing.cordless`；`git diff origin/main -- prisma/` 为空。无出站、无新 cron、无 LLM。

## 1. 做了什么

| 场景 | 之前 | 现在 |
|---|---|---|
| 哪些行算无绳 | Order Form：Lift 选 L 或 R 的行一律算无绳（服务端 ×1.15）；客户端预览从不按无绳算；工艺单把同一行当普通拉绳 | Order Form 每行一个 **Cordless** 勾选（只对 Zebra / Roller 可用，换产品自动清掉）；Lift L/R 只表示拉杆位置；预览、落库、工艺单三处同一来源 |
| 无绳折扣 | 用产品折扣（Zebra / Roller 45%） | 独立无绳折扣 30%（企业可改）；行级手动折扣仍优先 |
| 无绳最低价 | 100（与有绳相同），且在 ×1.15 之前比较 | Zebra 159 / Roller 129（企业可改），在 ×1.15 **之后**比较（与原工具 `price()` 一致） |
| 无绳尺寸 | 宽或高 > 75" 报错 | 无独立上限，只受矩阵范围（Zebra 90" × 100" 无绳 = $557.10） |
| 布帘 / 纱帘 | 按实际窗宽查表 | 查表宽 = 实际窗宽 × 褶皱率 ÷ 2；Order Form / Part A 的 Fullness 180 / 230 作 1.8 / 2.3（与工艺单同一字段）；量房 / AI 入口按 2；褶皱率不在 1–4 整行报错；超范围提示此褶皱率下的最大窗宽；安装费仍按实际窗宽；Door Screen Sheer 不受影响 |
| 企业设置 | — | 驾驶舱折扣卡新增「无绳 Cordless」折扣与「无绳最低价 Zebra / Roller」；存 `pricing.cordless` 子键，修改走 `sales.update_quote_settings` 审批（老板改、另一位老板批），批准只替换该子键 |
| 工艺单 | Lift L/R → 普通 | Cordless 开（Zebra / Roller）→ 操控方式「无绳」（Blinds 引擎已有无绳减尺表）；Lift M 仍优先为电动 |
| 黄金对照 | 158 条中 48 条比对、110 条留给 PRICE-2 | **158 条全部比对**，`DEFERRED` 为空 |

价格变化示例（同一张 2026-10 价表，企业折扣为默认）：

| 行 | 改前 | 改后 |
|---|---|---|
| Zebra LF 24" × 36"，Lift L，不勾 Cordless | $115.00（被当成无绳：100 × 1.15） | $100.00（有绳，最低价） |
| Zebra LF 24" × 36"，勾 Cordless | 预览 $100.00 / 落库同上（需选 L/R） | $159.00 |
| Zebra LF 48" × 60"，勾 Cordless | $200.54（45% 折扣 × 1.15） | $255.22（30% 折扣 × 1.15） |
| Zebra LF 90" × 100"，勾 Cordless | 报错（> 75"） | $557.10 |
| Drapery Without liner 110" × 120"，Fullness 180 | $936.00（取档 112.5） | $831.41（查表宽 99 → 取档 100） |

## 2. 改了哪些文件

| 文件 | 内容 |
|---|---|
| `src/lib/blinds/pricing-types.ts` | `CordlessPolicy`；`QuoteItemInput.fullness`；`QuoteTotalInput.cordlessPolicy` |
| `src/lib/blinds/pricing-data.ts` | `DEFAULT_CORDLESS_POLICY`（0.30 / 159 / 129 / 1.15，从 `config/pricelist/2026-10-28-lucas-quote.json` 拷入）、`DEFAULT_FULLNESS` / `FULLNESS_MIN` / `FULLNESS_MAX`；删除 `CORDLESS_MAX_WIDTH/HEIGHT` |
| `src/lib/blinds/pricing-engine.ts` | `priceFor` 新增策略与褶皱率参数，三条分支统一 `settlePrice`（先倍率后最低价）；`usesFullness` / `isValidFullness` / `fullnessFromPercent`；`calculateQuoteTotal` 透传 |
| `src/lib/blinds/discount-settings.ts` | `CORDLESS_SETTING_KEYS`、`readJsonCordless` / `mergeJsonCordless` / `dtoToCordlessPolicy`；DTO 三字段；校验（0–1 / 0–10000）；保存路由到 `pricing.cordless`；`applyOrgDiscountDefaults` 跳过 Zebra / Roller 无绳行 |
| `src/app/api/sales/quotes/route.ts`、`src/lib/sales/quote-update.ts`、`src/app/api/sales/quotes/preview/route.ts`、`src/app/api/sales/measurements/[id]/generate-quote/route.ts` | 传企业无绳策略 |
| `src/app/(main)/sales/quote-sheet/{types,order-shades,pricing-helpers,page,part-a,quote-pdf,rough-quote-panel}` | `ShadeOrderLine.cordless`；Cordless 勾选列；预览按无绳 / 褶皱率计价；items 带 `cordless` 与 `fullness`；PDF 金额同源；内嵌工具透传无绳设置 |
| `src/app/(main)/sales/cockpit/discount-settings-card.tsx` | 无绳折扣与两个最低价 |
| `src/lib/sunny-process/quote-mapping.ts` | `controlType` 含「无绳」；Cordless 开 → 无绳 |
| 测试 | `pricelist-2026-10-golden`（全部 158 条 + Order Form 本地用例 8 条）、`cost-rates`（+13 断言）、`quote-settings-approval`（20 → 21）、`quote-settings-db.isolated`（20 → 31）、`quote-mapping`（51 → 55）；无新测试文件 |
| 规格 / 设计 | apply 中按黄金用例更正无绳收尾顺序（原稿写成先最低价后倍率），见 §4.1 |
| 文档 | 本报告；`docs/price-2-screenshots/`（2 张）；TASKFLOW PRICE-2 → `[G]`；HANDOFF |

## 3. 怎么验

| 项 | 结果 |
|---|---|
| `npx tsx src/lib/blinds/__tests__/pricelist-2026-10-golden.test.ts` | 158 条全部 MUST_MATCH、787 断言、0 失败；DEFERRED 0 |
| `cost-rates` / `quote-settings-approval` / `quote-mapping` | 通过 / 21 / 55 |
| 隔离库 `quote-settings-db.isolated.test.ts` | 31 / 0（含：老板改无绳 → 202 → 另一位老板批 → `pricing.cordless` 写入、`pricing.discounts` / `leadMaxPct` / `sunnyWarranty` 原样；非法 → 400；预览无绳行 `discountPct 0.25` 且成交 = max(MSRP × 0.75 × 1.15, 169)、有绳行仍 0.45；布帘 1.8 → 831.41；量房计价不带褶皱率 → 按 2） |
| 回归 | `blinds-oracle` 9488、`drapes-oracle` 11267、`real-orders` 164、`sunny-motor`、`quote-fees`、`valance-options` 13 全过（与开工前基线相同） |
| `NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck` | 退出 0 |
| `npm run lint:baseline` | PASS |
| `npm run test:ci` | 退出 0 |
| `bash scripts/check-test-registry.sh` | 已注册 499，欠账 71 不变 |
| `openspec validate pricelist-2026-10-cordless-fullness --strict` | valid |
| `npm run build` | 退出 0 |
| 浏览器走查（生产构建 + 隔离库 + Playwright，销售岗） | 见 §3.1 |
| 全量 `npm test`（隔离库） | __FULL__ |

### 3.1 浏览器走查（`docs/price-2-screenshots/`）

| 步骤 | 结果 |
|---|---|
| Zebra LF 24" × 36"，不勾 Cordless | $100.00 + 安装 $18 |
| 同一行勾 Cordless | $159.00 + 安装 $18 |
| Zebra LF 90" × 100" 勾 Cordless | $557.10 + 安装 $26（不再报 75" 错误） |
| SHANGRILA 行 | Cordless 勾选框禁用 |
| Drapes：Without liner 100" × 120"，Fullness 默认 180 | 行显示 $921.41（成交 $831.41 + 安装 $90） |
| Part B 定金 1000 → Save | `POST /api/sales/quotes` 201；无弹窗；无页面错误；390px 无横向溢出 |
| 落库 | 两行 Zebra `cordless = true`、折扣 0.30、成交 159 / 557.10（取档 90 × 102）；布帘取档 100 × 120、成交 831.41、安装 90；工艺单映射两行 Zebra 均为「斑马帘 / 无绳 / R」 |

## 4. 实施中对规划的调整 / 发现（审核请重点看）

1. **无绳最低价在 ×1.15 之后比较。** 规格与设计原稿写成"先最低价、最后 ×1.15"；黄金用例（Zebra 24" × 36" 无绳 = 159，不是 182.85）证明原工具是先倍率再最低价。已按原工具实现并改回规格 / 设计，`validate --strict` 通过。
2. **量房「生成报价」在 main 上本来就 500。** `src/app/api/sales/measurements/[id]/generate-quote/route.ts` 把报价行嵌在 `rooms.create.items.create` 里并写 `quoteId: undefined as any`，Prisma 拒绝（"Argument `quote` is missing"），与定价无关、改动前就如此。本 change 只给它加了无绳策略参数，隔离库测试改为验证它写库前的计价步骤。建议另开一个小修复。
3. **Door Screen Sheer 的折扣字段**：原工具对 Door Screen Sheer 报的 `discount` 是产品默认 35%，实际按 0 计价；黄金测试对所有 Door Screen Sheer 行只比金额（PRICE-1 已有同样处理，本次扩到 `door-screen-no-fullness`）。
4. **客户 PDF 没有加 "Cordless" 字样**：属于新的对客可见行为，规格未覆盖，没做；金额已与无绳一致。需要的话另提。
5. 没有新增企业默认褶皱率设置（design D5 已说明）。

## 5. 上线后要做 / 已知限制

- **BREAKING 1**：已保存的老报价里，原来按 Lift L/R 判成无绳的 Zebra / Roller 行，编辑重算时变成有绳价（不再 ×1.15）；确为无绳的需销售打开 Cordless 再保存。已落库金额不回填。
- **BREAKING 2**：Order Form 布帘 / 纱帘默认 Fullness 180% 的行，查表宽从 1.0× 变 0.9×，部分尺寸掉一档变便宜（例：110" × 120" 由 $936.00 变 $831.41）。这是原工具规则；要按 2 倍报价请选 230 或按需调整。
- 无绳行的价格总体比之前高（30% 折扣替代 45%），这是新价表的规则。
- 「快速报价」内嵌的旧 HTML 工具仍用它自己的无绳规则；青砚只把企业无绳设置透传过去，它是否读取取决于那个工具。
- 量房生成报价的既有 500（§4.2）。
