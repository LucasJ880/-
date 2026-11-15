# Tasks

## 1. 前置核对与文件校验

- [ ] 1.1 拿到工具包（`index.html`，记录 SHA-256）与 Lucas 从工具界面导出的 2–3 份真实报价（含一份多方案、一份带照片），放在仓库外的空目录里只读使用。对照 design「Context」的结构表核对字段：税率、备注、多方案（`plans[]` / `planWindows`）、照片、文件价表版本、文件合计的字段名与形状；用任务书附录 A 的脚本从该工具包生成 16 行样例（不含照片）存为 `src/lib/sales/quote-import/__tests__/fixtures/sample-16.sunny-quote.json`。把核对结果追加到 design D2；与规格增量有出入且改变对外行为时，先改规格增量并告知审核人再继续。verify：design D2 有「核对结果」小节（工具包哈希、每个未知字段的实际名称、与任务书的出入清单）；样例夹具用附录 A 的脚本重跑得到 `C.totals(quote).grand === 8224.5`；`openspec validate quote-import-studio-file --strict` 通过
- [ ] 1.2 `src/lib/sales/quote-import/types.ts` 与 `validate.ts`（design D1、D11）：格式 / 版本 / 大小 / 行数 / 附加项目数 / 产品品类 / 非 JSON 的拒绝与中文原因；原型污染键丢弃；多方案清单；照片只计数。新建 `__tests__/validate.test.ts` 并在本 task 内注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`。verify：`npx tsx src/lib/sales/quote-import/__tests__/validate.test.ts` 全过；`bash scripts/check-test-registry.sh` 退出 0

## 2. 表单配套

- [x] 2.1 开工前记基线（`order-form-pricing-parity` 72、黄金 158 条、`quote-mapping` 55、`valance-options` 13）。按 design D7、D12：`types.ts` 加 `pricingFabric`、`lineDiscountPct`、`drapeLineDiscountPct`、`sheerLineDiscountPct`、`importSource`（`quote-draft.ts` 同步）；`order-form-pricing.ts` 的取键支持行上定价面料；`order-items.ts` 与 `pricing-helpers.ts`（含 PDF 经由的预览）带行级折扣；`order-shades.tsx` / `order-drapes.tsx` 显示并可清除行级折扣、换产品或 SKU 时清定价面料；`sku-select.tsx` 用 `skuSelectOptions` 显示「目录外」。`order-form-pricing-parity.test.ts` 加三组（定价面料、行级折扣含预览 = 保存与无绳行、SKU 选项）。verify：该测试既有 72 条不变、新增全过；`npm run typecheck` 退出 0；黄金 158 条一致；`git diff --stat origin/main -- src/lib/blinds/pricing-engine.ts src/lib/blinds/discount-settings.ts config/pricelist/` 为空

## 3. 映射、对照与核对窗

- [ ] 3.1 `map.ts`（design D6–D9）：行映射（数量拆行、1/16" 取整、三张表、SKU 与定价面料、Roller 罩型、无绳、Shutters 材质与混用阻断、Drapes、褶皱率 1.8 / 2.3 直填与待选清单）、行级折扣与成交价、附加项目与负数项、Downtown、安装 / 送货组合、税率、客户四项与 `matchCustomer`、`importSource`、提示清单。新建 `__tests__/map.test.ts`（规格里映射相关的每个场景至少一例 + 源码断言：导入模块无网络调用、产出不含照片与面料键），本 task 内注册。verify：`npx tsx src/lib/sales/quote-import/__tests__/map.test.ts` 全过；注册校验退出 0
- [ ] 3.2 `compare.ts`（design D3–D5、D8）：价表比对、文件金额重算、青砚金额（`buildOrderFormItems` → `applyOrgDiscountDefaults` → `calculateQuoteTotal`）、逐行处理方式、两边合计、特别让利累加与取整。新建 `__tests__/compare.test.ts`（16 行样例逐行与合计：文件 8224.50、青砚 8134.62、让利 29.38 / 236.94；价表改一格；未用品类不同；企业运费 75；负数附加项目；填入后与手填等价），本 task 内注册。verify：`npx tsx src/lib/sales/quote-import/__tests__/compare.test.ts` 全过；注册校验退出 0
- [ ] 3.3 核对窗 `quote-sheet/import-review-dialog.tsx` 与 `page.tsx` 的入口：选文件（只读、先判大小）→ 校验失败显示原因 → 多方案选择 → 核对窗（逐行四列 + 处理方式、待选褶皱率的两档选项、底部两边合计与让利明细、阻断 / 提醒两级清单）→「填入表单」经 `applyFormState` 灌入并执行客户匹配、填特别让利。verify：`npm run typecheck` 退出 0；`npm run lint:baseline` 通过；`map.test.ts` 的源码断言覆盖核对窗文件（无网络调用）

## 4. 留痕、门禁与走查

- [ ] 4.1 `quotes/route.ts` 与 `quote-update.ts` 按 design D10 写审计 `quote_imported`；新建 `src/lib/sales/__tests__/quote-import-audit-db.isolated.test.ts`（新建写一条、同一次导入再保存不重复、修改路径、无留痕不写、内容不含电话邮箱）并注册进 `scripts/test-all.sh`。全量门禁：`npm run typecheck`、`npm run lint:baseline`、`npm run test:ci`、`bash scripts/check-test-registry.sh`、`npm test`（失败项逐个与 origin/main 同环境对照）、`openspec validate quote-import-studio-file --strict`、`git diff --stat origin/main -- prisma/ vercel.json` 为空。走查（本机隔离库 + Playwright，截图存 `docs/acceptance/quote-1b/`）：① 导入样例：17 行、第 12 行选 180 前「填入表单」不可用、选后让利 29.38、保存后库里合计 8134.62、`importSource` 与一条 `quote_imported`；② 第 12 行改选 230：让利 236.94、合计不变；③ 企业运费设 75：让利多 25；④ 第 3 行表单里 Cassette 271.88、改 None 221.88；⑤ 第 6 行 SKU 显示「目录外」；⑥ 第 11 行改 `Wood` 再导：材质 Wooden、1172.22；⑦ 反例：Zebra 改一格 MSRP、Vinyl + Wood 混用、带 3 张照片（保存后 `formDataJson` 无图片数据）、改 `format` / `version`、600 行、非 JSON；⑧ 让利审批：只留第 16 行且成交价 100 的文件，销售账号保存的行为与手填同额让利一致；⑨ 用 1.1 的真实导出文件各导一次。verify：隔离库测试全过；以上命令退出 0（`npm test` 列出与 main 相同的既有失败）；九项走查的截图与数字齐全
  - 进度（2026-11-15，先于 1.1 完成的部分）：审计已接入两条保存路径（`src/lib/sales/quote-import/audit.ts`）；`audit.test.ts` 19 / 0 与 `quote-import-audit-db.isolated.test.ts` 12 / 0 已注册并通过。全量门禁与九项走查待 1.1–3.3 完成后做，本条不打勾。
- [ ] 4.2 写 `docs/QINGYAN_QUOTE-1b_REPORT.md`（做了什么 / 改了哪些文件 / 文件结构核对结果 / 怎么验及每条命令的实际输出 / 走查九项 / 对任务书的调整：Door Screen Sheer 与褶皱率两项拍板后的差异、合计 8134.62 而非 8224.51 / 已知限制：客户列表 200 位、行级折扣无上限、不查重、回滚后的金额变化 / 上线前事项：核对企业运费）+ 更新 `docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` QUOTE-1b 状态列。verify：两个文件在同一提交里，报告里每条命令都有实际输出

## Workflow follow-up

- 一个 change = 一个 PR；PR 合并后在最新 main 上 `/opsx:archive quote-import-studio-file --yes`（独立小 PR），同步把 TASKFLOW 的 QUOTE-1b 改为 `[x]`（带 PR 编号）。
- 任务书附录 B 的后续队列（QUOTE-2 起）不属于本 change。
