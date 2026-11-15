# QUOTE-1a 报告 — 详细订单定价口径对齐（Roller 罩型进定价 / 实木百叶窗能算价）

change：`openspec/changes/quote-order-form-pricing-parity/`。规格增量：`sales/price-list` 新增 7 条；design D1–D7（含 D4a）；tasks 7 / 7。
任务书：`docs/QINGYAN_QUOTE-1_QUOTE_FILE_IMPORT_TASKBRIEF.md`（Why 表 a、c；判断点 3）。拍板：判断点 3「做」；罩型「与工艺单同口径」、实木旧报价「取 B（提醒）」、PDF 显示生效罩型（Lucas 2026-11-15）；判断点 1（Door Screen Sheer）未拍板，本次未做。
零 schema：新数据只有 `formDataJson.orderPricingRev`；`git diff --stat origin/main -- prisma/ vercel.json` 为空。无出站、无 LLM、无新 cron / 队列。

## 1. 做了什么

| 场景 | 之前 | 现在 |
|---|---|---|
| 详细订单 Roller 行，行上 Valance = Cassette / Fascia | 定价键只按 SKU 后缀取，按 Open Roll 计价（55" × 72" 遮光 $221.88） | 定价键 = 基础面料 + 罩型，带罩加 25（宽 < 50"）/ 50（宽 ≥ 50"）（$271.88） |
| 行上 Valance 留空、表底部 Valance Type 选了 Cassette / Fascia | 工艺单做罩盒，报价按无罩 | 定价与工艺单读同一个取值（行上 → 表底部 → 无），同样加价 |
| 百叶窗材质 Wooden | 表单材质原样当价表键，报「Pricing … is not set yet」，该行不计价、不落库；页面提示「去 Part B 手填」 | 按价表 `Wood` 表计价（72" × 60" 为 $1,172.22 + 安装 $54）；提示横幅已删；表单 / PDF / 工艺单仍写 Wooden |
| 报价 PDF 的 Shades 表 Valance 列 | 只显示行上的值；行上留空、靠表底部加价的行显示「—」而金额含罩盒加价 | 显示生效罩型（行上 → 表底部），两处都空才是「—」 |
| 取键的地方 | 页面保存（组件里内联）、页面预览、PDF 各自从 SKU / 材质推 | 一个纯函数模块取键；保存时的行构造抽成一个纯函数；预览、PDF、保存都经它们 |
| 打开改动前保存的实木报价 / 草稿 | — | 表单顶部提醒「实木百叶窗现已自动计价（本单百叶窗 $X）…请检查 Part B，删除手填的百叶窗价格」，不拦保存；按新口径保存一次后不再提醒 |
| 已存报价 | — | 不重算、不回填；打开时预览按新口径，库里金额在再次保存前不变 |
| Door Screen Sheer | 套纱帘企业折扣 35%（宽 25" $110.80 / 宽 30" $147.73） | **未改**（判断点 1 未拍板） |

## 2. 改了哪些文件

| 文件 | 内容 |
|---|---|
| `src/lib/blinds/order-form-pricing.ts`（新） | `effectiveShadeValance`、`shadeLinePricingFabric`、`shutterPricingFabric`、`ORDER_PRICING_REV`、`readOrderPricingRev`、`needsWoodRepriceNotice`、`woodRepriceNoticeText` |
| `src/app/(main)/sales/quote-sheet/order-items.ts`（新） | `buildOrderFormItems`：从 `page.tsx` `handleSave` 原样搬出的行构造，只改两处取键 |
| `quote-sheet/pricing-helpers.ts` | Shades / Shutters 预览经同一取值；`computeShadeLinePrice` / `sumShadeTotals` / `sumAllMsrp` 加末位参数 `formValance`；改掉过时注释 |
| `quote-sheet/page.tsx` | 保存改为调 `buildOrderFormItems`；小计 / MSRP / PDF 输入带表底部罩型；口径标记读写；提醒横幅 |
| `quote-sheet/order-shades.tsx`、`quote-pdf.ts` | 计价调用带表底部罩型；PDF 的 Valance 列显示生效罩型 |
| `quote-sheet/order-shutters.tsx` | 删除「set price manually in Part B」横幅 |
| `quote-sheet/types.ts`、`quote-draft.ts` | 可选字段 `orderPricingRev` |
| `src/lib/sunny-process/quote-mapping.ts` | 罩型取值改为调 `effectiveShadeValance`（输出不变） |
| `src/lib/blinds/__tests__/order-form-pricing-parity.test.ts`（新） | 72 条断言；已注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh` |

未动（`git diff --stat origin/main` 为空）：`config/pricelist/**`、`pricelist-2026-10-golden.test.ts`、`pricing-engine.ts`、`pricing-data.ts`、`discount-settings.ts`、`sku-catalog.ts`、`quotes/route.ts`、`quote-update.ts`、`part-a.tsx`、`rough-quote-panel.tsx`、`prisma/`、`vercel.json`。

## 3. 第 1 步复现输出（修之前，main @ `0b46a74`）

脚本原样抄了 `handleSave` 的三句行构造并先断言源码未变；「预览」调真实的 `compute*LinePrice`，「保存」走 `applyOrgDiscountDefaults` → `calculateQuoteTotal`，缺省企业折扣。

```
[源码] page.tsx:901  const pricingFabric = skuToPricingFabric(l.sku, l.product);
[源码] page.tsx:927  fabric: shutterMaterial,
[源码] page.tsx:959  fabric: l.sheerFabricSku,

a. Roller 55×72 CABO-WHITE-BO（期望：Cassette / Fascia = 271.88，None = 221.88）
  Valance=None     定价键="Blackout (Open Roll)"  保存=221.88  预览=221.88
  Valance=Cassette 定价键="Blackout (Open Roll)"  保存=221.88  预览=221.88
  Valance=Fascia   定价键="Blackout (Open Roll)"  保存=221.88  预览=221.88
  对照：引擎直接用 "Blackout w Cassette" = 271.88

b. Door Screen Sheer 30×48，无行级折扣（工具 227.27）
  applyOrgDiscountDefaults 后 discountOverridePct=0.35
  保存=147.73  预览=147.73  （引擎不带折扣=227.27）

c. Shutters 72×60（价表键 Wood 期望 1172.22）
  材质=Wooden 保存=报错「Pricing for fabric "Wooden" under "Shutters" is not set yet.」  预览=报错「Pricing for fabric "Wooden" under "Shutters" is not set yet.」
  材质=Vinyl  保存=701.29  预览=701.29
  对照：引擎直接用 "Wood" = 1172.22
```

## 4. 怎么验

基线在合并 main `a747467` 之后、动代码之前记录。

| 命令 | 基线 | 结果 |
|---|---|---|
| `npx tsx src/lib/blinds/__tests__/order-form-pricing-parity.test.ts` | （新） | `结果：72 通过，0 失败` |
| `npx tsx src/lib/blinds/__tests__/pricelist-2026-10-golden.test.ts` | `MUST_MATCH 158 条（断言 787，失败 0）；DEFERRED 0 条` | 相同 |
| `npx tsx src/lib/blinds/__tests__/valance-options.test.ts` | 13 通过 | 13 通过 |
| `npx tsx src/lib/blinds/__tests__/quote-fees.test.ts` / `cost-rates.test.ts` | 通过 | 通过 |
| `npx tsx src/lib/sunny-process/__tests__/quote-mapping.test.ts`（文件未改） | 55 通过 | 55 通过 |
| `npm run typecheck` | — | 退出 0 |
| `npm run lint:baseline` | — | `PASS（无新增 error fingerprint / 无 count 上升）` |
| `npm run test:ci` | — | `CI unit subset PASS`，退出 0（含新测试） |
| `bash scripts/check-test-registry.sh` | — | `OK 测试注册校验通过：已注册 617 个；历史欠账基线剩余 68 条（只减不增）` |
| `openspec validate quote-order-form-pricing-parity --strict` | — | `Change 'quote-order-form-pricing-parity' is valid` |
| `git diff --stat origin/main -- prisma/ vercel.json config/pricelist/ src/lib/blinds/__tests__/pricelist-2026-10-golden.test.ts src/lib/blinds/pricing-engine.ts src/lib/blinds/discount-settings.ts` | — | 空 |
| `npm test`（无数据库，依赖库的项自行跳过） | — | `测试结果: 629/642 通过, 13 失败`；新测试在其中通过（当时 71 / 0；PDF 罩型一条是之后加的，单独重跑 72 / 0）。13 项失败逐项在 main `a747467` 的工作树里用同样的环境重跑，**全部同样失败**，都不涉及本次改动的文件（清单见下） |
| 隔离库（本机 Postgres 16）`signed-quote-amount-db.isolated.test.ts` | — | 23 通过，0 失败 |
| 隔离库 `quote-settings-db.isolated.test.ts` | — | 54 通过，0 失败 |

`npm test` 的 13 项失败（本机无 `DATABASE_URL`、无 OAuth 配置；main 上同样失败）：Agent Trace 只读查询；Gmail Draft OAuth Compose Scope；Governance Hygiene Gate / Concurrency Gate；Phase3A-2 Ledger DB / Smoke Access；Phase3A-3 Approvals Smoke；Phase3A-4 Governance Smoke / Acceptance；Phase3A-5 Settle DB / Overview Acceptance；T4 授标情报真实 Postgres 矩阵；Quote Operations 客户报价 PDF 分页布局（`scripts/quotation-pdf-layout-e2e.ts`，页脚断言 S-4 / M-2，是另一套对客报价 PDF，不是详细订单的 `quote-pdf.ts`）。

对照测试的六组：① 定价键（Roller 两个真实 SKU × 行上 4 种 × 表底部 3 种 = 24 键；SKU 本身是完整键；非 Roller 不随罩型变；Wooden → Wood）；② 预览金额（宽 49 / 50 / 55 × 行上 4 种 × 有无无绳 24 行字面量；实木 / Vinyl × Panel 数 1 / 2；超范围仍报错；MSRP 合计）；③ 表单行 → `buildOrderFormItems` → `applyOrgDiscountDefaults` → `calculateQuoteTotal` 与预览逐行比，缺省折扣与 Roller 40% / Shutters 30% 各一轮、每轮 158 行；④ 行上 4 种 × 表底部 3 种 12 组合「含罩盒加价 ⇔ 工艺单罩盒不是单轨无盒」；⑤ 口径标记、提醒判定与文案、草稿往返；⑥ 源码断言 10 条。

没有跑：`npm run build`（`next build`）。类型检查通过，页面在 `next dev` 下实际跑过（见下节）。

## 5. 页面走查

环境：本机 Postgres 16 隔离库（全部迁移已应用）+ `next dev` + Playwright，虚构企业 Fixture Blinds Co.、虚构客户。截图在 `docs/acceptance/quote-1a/`。与 tasks 3.1 的出入如实列在本节末。

| # | 操作 | 页面 / 库里看到的 | 截图 |
|---|---|---|---|
| ① | Roller `CABO-WHITE-BO` 55" × 72"，行上依次点 None / Cassette / Fascia | $221.88 / $271.88 / $271.88，安装 $18.00 | `01-roller-row-*.png` |
| ② | 行上清空、表底部 Valance Type 选 Cassette | 行上留空且表底部未选时 $221.88；选 Cassette 后 $271.88。保存 201 `full`，提交的行为 `Roller / Blackout w Cassette / CABO-WHITE-BO`，库里该行 271.88。同一份落库的 `formDataJson` 交给工艺单映射：`卷帘 / 亮白插片圆盒` | `02-roller-row-empty-footer-cassette.png` |
| ③ | 材质 Wooden，72" × 60" | $1,172.22，安装 $54.00；旧横幅不在；新建报价不出现实木提醒。保存后库里有 `Shutters / Wood / Wooden / 1172.22`。切 Vinyl → $701.29 | `03-shutters-wooden.png`、`03b-shutters-vinyl.png` |
| ④ | 一张改动前口径的实木报价（Part B 自定义行「Wood shutters (manual price)」$1,200） | 存下时：`shell`，报错「Pricing for fabric "Wooden" under "Shutters" is not set yet.」，库里商品 0.00、附加 1200.00、合计 1356.00、无口径标记、无报价行。打开：顶部出现提醒，含「$1,172.22」与「Part B」；库里未变。点「知道了」本次不再显示；不保存重新打开再次提醒。不删 Part B 直接保存：库里商品 1172.22 + 附加 1200.00、合计 2991.35（**这就是 B5 说的重复计价**），标记为 2；本页提醒消失，重新打开不再提醒 | `04-old-wooden-quote-notice.png`、`04b-after-resave-no-notice.png` |
| ④′ | 一张改动前口径的带罩 Roller 报价（库里 `Blackout (Open Roll)` 221.88） | 打开：页面预览 $271.88，库里未变，不出现实木提醒。保存后库里 `Blackout w Cassette` 271.88，合计 561.47 → 617.97 | — |
| ⑤ | 用 Q1 落库的 `formDataJson` 生成报价 PDF | Roller 行 `Merch $271.88 / Install $18.00 / Line $289.88`（当时 Valance 列是「—」，已按 §7 改为显示 `Cassette`）；Shutters（WOODEN）行 `$1172.22 / $54.00 / $1226.22` | — |
| ⑥ | 把一张改动前口径的带罩 Roller 报价标成已签约，打开后直接保存 | 页面发出的 PUT 带 `Roller / Blackout w Cassette`；交给真实路由：`202 {"pending":true,"message":"改价已提交审批，批准后生效"}`，库里仍是 signed / 221.88，生成审批卡 `sales.update_signed_quote / pending` | — |

与 tasks 3.1 字面的出入：
- 用的是 `next dev`，不是 `next start`（没有跑生产构建）。
- 「改动前保存的报价」不是用旧代码存的：在页面上照常填表点 Save，把发出的请求体改写成旧页面会提交的样子（Roller 定价键退回 Open Roll、百叶窗 `fabric` 用表单材质、去掉 `orderPricingRev`），服务端与库里的结果与旧页面相同。
- ② 的工艺单没有走「签字 → 自动生成」，而是把落库的 `formDataJson` 交给签字时用的同一个映射函数。
- ⑤ 的 PDF 没有从页面按钮下载（那条路径要先发送或签字），而是用页面的同一个 PDF 模块在 Node 里生成后抽文字核对。
- ⑥ 在 `next dev` 下返回 500「创建待确认草稿失败」：运行环境隔离守卫在开发模式连本机库时不允许建审批草稿（`DB_PLANE_MISMATCH`），与本次改动无关。因此抓下页面实际发出的 PUT 请求体，在 `NODE_ENV=test` 下交给真实路由（与仓库隔离库测试同一方式）。

## 6. BREAKING（金额）与给销售的告知

只影响新建的报价与再次保存的已存报价。

| # | 什么变了 | 之前 | 之后 |
|---|---|---|---|
| B1 | Roller 行，行上 Valance = Cassette / Fascia | 按 Open Roll | 每行 +25（宽 < 50"）/ +50（宽 ≥ 50"）；无绳行 +28.75 / +57.50 |
| B2 | Roller 行，行上留空、表底部 Valance Type = Cassette / Fascia | 按 Open Roll | 同 B1（任务书原范围之外，来自「同口径」） |
| B3 | 百叶窗材质 Wooden | 行不计价、不落库；整单只有这类行时存空壳，不收运费与最低安装费差额 | 按 `Wood` 表计价，计入小计、安装费、最低安装费与运费 |
| B4 | 派生数 | — | 产品小计、MSRP 合计与成交折扣率、特别让利占比（分母变大）、定金占比、PDF 行金额 |
| B5 | 再次保存旧的实木报价 | Part B 手填价是唯一的百叶窗金额 | 不删 Part B 手填行就会重复计价（走查 ④：1356.00 → 2991.35） |

上线前告知销售两条：
1. Roller 选了 Cassette / Fascia（行上，或行上没选而表底部选了）每行加 25 / 50。
2. 实木百叶窗现在自动出价，Part B 不要再手填；打开旧报价看到黄色提醒时，先到 Part B 删掉手填的百叶窗价格再保存。

## 7. 对任务书 / 四件套的调整

- 生效罩型 = 行上 → 表底部 Valance Type → 无（任务书只写了行上）。
- 实木旧报价提醒 + 口径标记 `orderPricingRev`（任务书没有）。
- Door Screen Sheer 不套企业折扣：未做，等判断点 1。对照测试里只断言它的预览 = 保存，不钉口径。
- 报价 PDF 的 Valance 列显示生效罩型（走查后追加，design D4a、tasks 2.2）。走查 ⑤ 时该列对「行上留空 + 表底部 Cassette」的行显示「—」而金额含罩盒加价；拍板后改为显示生效罩型。用页面的同一个 PDF 模块生成三份 PDF、`pdftotext` 抽出的 Roller 行：

  ```
  [行上留空 + 表底部 Cassette]  1 Living Roller CABO-WHITE-BO 55 72 Cassette $271.88 $18.00 $289.88
  [行上 None + 表底部 Cassette] 1 Living Roller CABO-WHITE-BO 55 72 None $221.88 $18.00 $239.88
  [两处都空]                    1 Living Roller CABO-WHITE-BO 55 72 — $221.88 $18.00 $239.88
  ```
- design D4 在 apply 中更正：表底部罩型由「必填的第二个参数」改为末位参数。原因是 `pricelist-2026-10-golden.test.ts` 末尾的本地用例按旧参数顺序调 `computeShadeLinePrice` / `sumAllMsrp`，而测试目录不参加类型检查——插在第二位会让它运行时错位（实测 `sumAllMsrp` 抛错）。黄金测试文件不许动，所以改为末位参数，5 个调用点由源码断言 SRC-05 守住。

## 8. 已知限制与待定

- SKU 本身是完整定价键且两处 Valance 都空的 Roller 行（只在 SKU 目录加载失败时出现）：定价带罩、工艺单是单轨无盒，保留现状（design D3）。
- 百叶窗默认材质仍是 Wooden：忘了切 Vinyl 时现在会按更贵的 Wood 表出价而不再报错。
- 打开旧报价时预览已是新金额，期间看板在该报价再次保存前按旧金额统计。
- 没有跑 `next build`。
- 与本次无关、在 main `a747467` 上同样失败的：§4 列出的 `npm test` 13 项；以及隔离库下 `src/lib/sunny-process/__tests__/autogen-db.isolated.test.ts` 第一步 mark-signed 返回 `NO_BINDING`（无库时自动跳过，所以 `npm test` 看不到）。

## 9. 上线前后可执行的只读查询

列出「改动前保存、材质 Wooden、有填了宽高的百叶窗行、Part B 有自定义行」的报价——这些再次保存前需要人看一眼 Part B。本 change 不连生产库；查询在本机隔离库上验证过（能查出走查 ④ 的那张）。`pg_input_is_valid` 需要 Postgres 16 及以上。

```sql
WITH f AS (
  SELECT q.id, q."orgId", q."orderNumber", q.status, q."updatedAt", q."formDataJson"::jsonb AS form
  FROM "SalesQuote" q
  WHERE q."formDataJson" IS NOT NULL AND pg_input_is_valid(q."formDataJson", 'jsonb')
)
SELECT f."orgId", f."orderNumber", f.status, f."updatedAt"::date
FROM f
WHERE f.form->>'shutterMaterial' = 'Wooden'
  AND coalesce((f.form->>'orderPricingRev')::numeric, 1) < 2
  AND jsonb_typeof(f.form->'shutterOrders') = 'array'
  AND EXISTS (SELECT 1 FROM jsonb_array_elements(f.form->'shutterOrders') s
              WHERE coalesce(s->>'widthWhole','') <> '' AND coalesce(s->>'heightWhole','') <> '')
  AND jsonb_typeof(f.form->'partBAddons') = 'array'
  AND EXISTS (SELECT 1 FROM jsonb_array_elements(f.form->'partBAddons') a WHERE a->>'skuItem' = '__custom')
ORDER BY f."updatedAt" DESC;
```

## 10. 回滚

revert 该 PR。期间按新口径保存的报价带 `orderPricingRev: 2`，旧代码忽略该字段，金额保持保存时的值。
