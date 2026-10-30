# Tasks

## 1. 引擎

- [x] 1.1 `pricing-types.ts` 加 `CordlessPolicy` 与 `QuoteItemInput.fullness`；`pricing-data.ts` 加 `DEFAULT_CORDLESS_POLICY`（0.30 / 159 / 129 / 1.15，从 `config/pricelist/2026-10-28-lucas-quote.json` `cordless` 节拷入）并删除 `CORDLESS_MAX_WIDTH/HEIGHT`；`pricing-engine.ts` 按 design D2 / D5 改 `priceFor`（统一无绳收尾、无尺寸上限、褶皱率查表宽与校验、错误文案带最大窗宽）与 `calculateQuoteTotal`（透传 `cordlessPolicy` 与行级 `fullness`）；黄金测试 `DEFERRED` 清空、调用透传 `fullness`；verify：`npx tsx src/lib/blinds/__tests__/pricelist-2026-10-golden.test.ts` 158 条全过、输出 DEFERRED 0，`sunny-motor` / `quote-fees` / `valance-options` 仍过（开工前先跑记基线）

## 2. 企业设置

- [x] 2.1 `discount-settings.ts`：`CORDLESS_SETTING_KEYS`、`readJsonCordless` / `mergeJsonCordless`（design D4）、DTO 三字段、`validateDiscountsInput` 分段校验（0–1 / 0–10000）、`saveDiscountsForOrg` 路由到 `pricing.cordless`、`dtoToCordlessPolicy`、`applyOrgDiscountDefaults` 跳过无绳行；`discount-settings-card.tsx` 加三格；`rough-quote-panel.tsx` 透传；verify：`cost-rates.test.ts` 扩 5 条（读默认 / 坏值 / 合并只动子键 / 跳过无绳行 / 策略转换）与 `quote-settings-approval.test.ts` 扩 1 条（描述含 `cordlessDiscount=0.25`）通过
- [x] 2.2 四个服务端入口（`quotes/route.ts`、`quote-update.ts`、`preview/route.ts`、`generate-quote/route.ts`）传 `cordlessPolicy`；`quote-settings-db.isolated.test.ts` 扩：老板 PUT `{cordlessDiscount:0.25, cordlessFloorZebra:169}` → 202 → 批准 → `pricing.cordless` 写入且 `pricing.discounts` / `sunnyWarranty` 原样；`{cordlessFloorRoller:-1}` → 400；super_admin 设 0.25 后预览 Zebra 48" × 60" 无绳行 `discountPct 0.25` 且成交 = max(MSRP × 0.75, 169) × 1.15；量房生成 Drapery 100" × 120" 查表宽 100；verify：该隔离库测试全过

- [x] 2.3 修复量房「生成报价」写库 500（design D8）：事务内先建报价、再建房间与行（显式 `quoteId` / `roomId`）；verify：`quote-settings-db.isolated.test.ts` 经真实路由：201、2 个房间 3 行且每行同时挂在报价与房间、布帘 100" × 120" 取档 100（褶皱率 2）、无绳 Zebra 按企业无绳策略、量房记录 → quoted

## 3. 报价单 UI

- [x] 3.1 `types.ts` `ShadeOrderLine.cordless?`；`order-shades.tsx` Cordless 开关列（仅 Zebra / Roller，切产品清掉）；`page.tsx` items `cordless: l.cordless === true`，窗帘 / Part A 行把 Fullness 180 / 230 作 1.8 / 2.3 放进 items；`pricing-helpers.ts` 对 Shades 传 `cordless` + 无绳行覆盖 `null` + 策略对象，对 Drapes / Part A 传 `fullness`；`part-a.tsx` 随之；verify：`NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck` 退出 0、`npm run build` 通过；黄金测试新增 2 条本地用例（Order Form 180 → 1.8 转换；无字段 → 关）通过

## 4. 工艺单

- [x] 4.1 `quote-mapping.ts` `BlindsItemDraft.controlType` 放宽为含 `"无绳"`，映射 Lift M → 电动、Cordless 开 → 无绳、否则普通（design D6）；verify：`npx tsx src/lib/sunny-process/__tests__/quote-mapping.test.ts` 扩 2 条（Cordless 开 + Lift R → 无绳 / R；Lift L 无开关 → 普通）通过，`blinds-oracle` 9488 与 `real-orders` 164 不变

## 5. 收口

- [ ] 5.1 全量门禁：typecheck、lint:baseline、test:ci、registry、`openspec validate pricelist-2026-10-cordless-fullness --strict`、`git diff --stat prisma/` 为空、隔离库 `npm test`（失败项逐个与 origin/main 对照）；隔离库 + `next start` + Playwright 走查：Zebra 24" × 36" 开 Cordless → $159、关 → 有绳价；Zebra 90" × 100" 开 → $557.10；布帘 100" × 120" 默认 180% → $831.41；保存后 `SalesQuoteItem.cordless` 为真且工艺单草稿操控方式"无绳"；verify：以上命令退出 0，截图与数字写进报告
- [ ] 5.2 写 `docs/QINGYAN_PRICE-2_REPORT.md`（做了什么 / 怎么验 / 对规划的调整：无企业默认褶皱率、BREAKING 两条 / 已知限制）+ 更新 `docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` PRICE-2 状态列 + `docs/QINGYAN_PRICELIST_HANDOFF.md` §0 流水线表；verify：三个文件在同一提交里，报告 §3 每条命令都有实际输出

## Workflow follow-up

- PR 合并后在最新 main 上 `openspec archive pricelist-2026-10-cordless-fullness --yes`（独立小 PR）。
- 归档后 PRICE-3 `pricelist-2026-10-addons` 接手。
