# Tasks

## 1. 目录

- [x] 1.1 `pricing-types.ts` 扩 `AddonDef`（`unit` / `group` / `hint?` / `source`）与 `QuoteAddonInput`（`unitPrice?` / `displayName?`）；`pricing-addons.ts` 按 design D2 写 36 项目录（单价从 `config/pricelist/2026-10-28-lucas-quote.json` 拷，不手敲）、`EXCEL_ADDON_DISPOSITION`、`addonCustomerLabel`、`resolveAddonLines`，`calcAddonSubtotal` 接企业价；新建 `src/lib/blinds/__tests__/pricelist-2026-10-addons.test.ts` 并注册到 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`；verify：该测试通过（36 项来源对照、40 行归类 24 / 10 / 4 / 1 / 1、`drape_track_extra_ft` × 13 = 390、对客名称、`resolveAddonLines` 四种情形），`bash scripts/check-test-registry.sh` 通过，黄金对照 158 条不变（开工前先跑 `quote-fees` / `sunny-motor` / 黄金对照记基线）

## 2. 企业价

- [x] 2.1 `discount-settings.ts`：`readJsonAddonPrices` / `mergeJsonAddonPrices` / `validateAddonPricesInput`、DTO `addonPrices`、`saveDiscountsForOrg` 把 `addonPrice.` 前缀键路由到 `pricing.addons`；折扣接口 PUT 接 `addonPrices` 并并入 numericPatch；`discount-settings-card.tsx` 加附加项目价格折叠表；verify：`cost-rates.test.ts` 扩（读默认 / 坏值回目录价 / 未知键丢弃 / 合并只动提交键 / 校验非法键与负数）与 `quote-settings-approval.test.ts` 扩（描述含 `addonPrice.downtown_fee=180`）通过

## 3. Part B 进服务端

- [x] 3.1 `quotes/route.ts` 与 `quote-update.ts` 改用 `resolveAddonLines(addons, 企业价)` 落库并算小计（`calculateQuoteTotal` 同源）；`page.tsx` 新建 / 编辑请求体加 Part B 行（design D4）；verify：`quote-settings-db.isolated.test.ts` 扩——老板 PUT `{ addonPrices: { motor: 160 } }` → 202 → 批准 → `pricing.addons.motor` 160 且 `pricing.cordless` / `sunnyWarranty` 原样；`{ addonPrices: { hub: -1 } }` → 400；真实路由新建报价带 `drape_motor_battery` × 1 + 自定义 "Extra bracket" × 2 @ 15 → 附加项目小计 680、两行落库名称正确、总额含之；编辑改 Part B → 小计更新；企业价 160 下 `motor` × 2 未带单价 → 320

## 4. 报价单 UI 与客户输出

- [x] 4.1 `part-b.tsx` 分组下拉显示企业价与"/ft"、按英尺行数量占位"ft"、内部提示灰字；`page.tsx` 把 DTO `addonPrices` 传给 Part B 与 `rough-quote-panel.tsx`；`quote-pdf.ts` Part B 名称用 `addonCustomerLabel`、按英尺行显示"13 ft"与"$30.00/ft"；`ai-quote-parser.test.ts` 扩 2 条（"customer lives downtown, 2 zebra 48x60" 无附加项目；"2 motor" 仍得 `motor` × 2）；verify：`NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck` 退出 0、`npm run build` 通过、`ai-quote-parser.test.ts` 通过

## 5. 收口

- [x] 5.1 全量门禁：typecheck、lint:baseline、test:ci、registry、`openspec validate pricelist-2026-10-addons --strict`、`git diff origin/main --stat -- prisma/` 为空、隔离库 `npm test`（失败项逐个与 origin/main 对照）；隔离库 + `next start` + Playwright 走查：Part B 下拉 36 项分组、选 `drape_track_extra_ft` 数量 13 → $390、保存后库里 `addonsSubtotal` 等于 Part B 小计、客户 PDF 名称为客户可见名、390px 无溢出；verify：以上命令退出 0，截图与数字写进报告
- [x] 5.2 写 `docs/QINGYAN_PRICE-3_REPORT.md`（做了什么 / 怎么验 / 对规划的调整：Excel 归类结果、Open roll Valance 边界以引擎为准、BREAKING：Part B 计入库里金额与签约报价首次重存进审批 / 已知限制：特别让利未扣、历史不回填）+ 更新 `docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` PRICE-3 状态列 + `docs/QINGYAN_PRICELIST_HANDOFF.md` §0 流水线表；verify：三个文件在同一提交里，报告 §3 每条命令都有实际输出

## Workflow follow-up

- PR 合并后在最新 main 上 `openspec archive pricelist-2026-10-addons --yes`（独立小 PR）。
- 特别让利是否从库里报价总额扣除：PRICE-3 之后单独立 change（proposal Out of scope）。
