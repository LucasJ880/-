# Tasks

## 1. 定价键与行构造

- [x] 1.1 开工前记基线：跑 `valance-options` / `pricelist-2026-10-golden` / `quote-fees` / `cost-rates` / `sunny-process quote-mapping` 五个已注册测试并记下各自通过数。新建 `src/lib/blinds/order-form-pricing.ts`（design D1–D3：`effectiveShadeValance`、`shadeLinePricingFabric`、`shutterPricingFabric`、`ORDER_PRICING_REV`、`needsWoodRepriceNotice`）；`src/lib/sunny-process/quote-mapping.ts` 的罩型取值改为调用 `effectiveShadeValance`（输出不变）；新建 `src/lib/blinds/__tests__/order-form-pricing-parity.test.ts`（design D7 第 ①、④、⑤ 组：定价键矩阵、SKU 为完整键、定价 ⇔ 工艺单罩盒 12 组合、提醒判定），并在本 task 内注册进 `scripts/test-all.sh`（紧随「Blinds Valance 选项与定价联动」）与 `scripts/test-ci-unit.sh`；verify：`npx tsx src/lib/blinds/__tests__/order-form-pricing-parity.test.ts` 全过，`bash scripts/check-test-registry.sh` 退出 0，`quote-mapping.test.ts` 未改且通过数等于基线
- [x] 1.2 预览改用同一取值（design D4）：`pricing-helpers.ts` 的 `computeShadeLinePrice` / `sumShadeTotals` / `sumAllMsrp` 加末位参数 `formValance`（apply 中由「必填第二参数」更正，见 design D4），Shades 经 `shadeLinePricingFabric`、Shutters 经 `shutterPricingFabric` 取键，改掉 `:180` 的过时注释；调用方 `order-shades.tsx`、`page.tsx`、`quote-pdf.ts`（输入加 `shadeValanceType`）随之；对照测试加第 ② 组预览金额（Roller 49 / 50 / 55 × 行上 4 种 × 有无无绳的字面量；Wooden 1172.22 / Vinyl 701.29 × Panel 数 1 / 2；安装费）；verify：对照测试全过，`NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck` 退出 0
- [x] 1.3 保存改用同一取值（design D5）：新建 `src/app/(main)/sales/quote-sheet/order-items.ts` 的 `buildOrderFormItems`（从 `page.tsx` `handleSave` 原样搬出三段，仅两处取键改用 1.1 的函数），`page.tsx` 改为调用并删除对 `skuToPricingFabric` 的直接引用；对照测试加第 ③ 组（表单行 → `buildOrderFormItems` → `applyOrgDiscountDefaults` → `calculateQuoteTotal` 与预览逐行比，缺省折扣与 Roller 40% / Shutters 30% 各一轮，含 Zebra / Drapery / Sheer / Door Screen Sheer 行）与第 ⑥ 组源码断言；verify：对照测试全过；`npx tsx src/lib/blinds/__tests__/pricelist-2026-10-golden.test.ts` 158 条一致、DEFERRED 0；`git diff --stat origin/main -- config/pricelist/ src/lib/blinds/__tests__/pricelist-2026-10-golden.test.ts src/lib/blinds/pricing-engine.ts src/lib/blinds/discount-settings.ts` 为空

## 2. 口径标记与提醒

- [x] 2.1 `types.ts` 的 `QuoteFormState` 与 `quote-draft.ts` 的 `QuoteDraftV1` 加可选 `orderPricingRev`；`page.tsx` 持有「载入时的标记」（新建 = 2，`applyFormState` 载入时取值、缺省 1），保存写 2、保存成功后置 2，草稿原样带；按 `needsWoodRepriceNotice` 在表单顶部渲染提醒（文案见 design D6，含本单百叶窗金额与「知道了」按钮，不拦保存）；删除 `order-shutters.tsx` 的「set price manually in Part B」横幅；对照测试补「草稿 / 表单数据带标记往返」与「横幅文案已不在源码」两条；verify：对照测试全过，typecheck 退出 0，`git diff --stat origin/main -- prisma/` 为空

## 3. 收口

- [ ] 3.1 全量门禁与页面走查。命令：`npm run typecheck`、`npm run lint:baseline`、`npm run test:ci`、`bash scripts/check-test-registry.sh`、`npm test`（依赖数据库的失败项逐个与 origin/main 对照）、`openspec validate quote-order-form-pricing-parity --strict`、`git diff --stat origin/main -- prisma/ vercel.json` 为空。走查（隔离库 + `next start` + Playwright，截图存 `docs/acceptance/quote-1a/`）：① Roller `CABO-WHITE-BO` 55" × 72"，行上 None → $221.88、Cassette → $271.88、Fascia → $271.88；② 行上留空、表底部选 Cassette → $271.88，保存后库里该行 `fabric` 为 `Blackout w Cassette`，生成的工艺单草稿罩盒为「亮白插片圆盒」；③ 材质 Wooden 72" × 60" → $1,172.22、无旧横幅，保存后有一条 `fabric = Wood` 的 Shutters 报价行；切 Vinyl → $701.29；④ 用改动前的代码存一张 Wooden + Part B 自定义行的报价，换到本分支打开 → 顶部出现提醒且含百叶窗金额，库里金额未变；保存后 `formDataJson.orderPricingRev` 为 2、再打开无提醒；⑤ 导出 PDF，带罩 Roller 行与实木行金额与页面一致；⑥ 已签约报价再次保存仍进入签约后改金额的审批；verify：以上命令退出 0，六项走查的截图与数字齐全
- [ ] 3.2 写 `docs/QINGYAN_QUOTE-1a_REPORT.md`（做了什么 / 第 1 步复现输出 / 怎么验及每条命令的实际输出 / BREAKING B1–B5 与给销售的两条告知 / 对任务书的调整：罩型同口径、实木提醒取 B、Door Screen Sheer 未做 / 已知限制：design D3、默认材质 Wooden / 供上线前后执行的只读查询：材质 Wooden + 有百叶窗行 + Part B 有自定义行的已存报价数）+ 更新 `docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` QUOTE-1a 状态列；verify：两个文件在同一提交里，报告里每条命令都有实际输出

## Workflow follow-up

- 一个 change = 一个 PR；PR 合并后在最新 main 上 `/opsx:archive quote-order-form-pricing-parity --yes`（独立小 PR），同步把 TASKFLOW 的 QUOTE-1a 改为 `[x]`（带 PR 编号）。
- 判断点 1（Door Screen Sheer 是否套企业折扣）拍板后另起 change 或追加。
- 归档后 QUOTE-1b `quote-import-studio-file` 接手。
