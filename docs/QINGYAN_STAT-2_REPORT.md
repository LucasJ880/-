# STAT-2 报告 — 特别让利计入库里报价金额；签约后改让利进改价审批

change：`openspec/changes/quote-total-net-of-promotion/`。规格增量：`sales/price-list` 新增 1 条，`sales/signed-quote-amount-approval` 新增 1 条；design D1–D4；tasks 4 条。
来源：PRICE-3 报告 §5 登记的口径问题；四件套 Lucas 2026-10-30 确认（#372 合并）。
零 schema：只改既有金额列的取值；`git diff origin/main -- prisma/` 为空。无出站、无 LLM、无新 cron。

## 1. 做了什么

| 场景 | 之前 | 现在 |
|---|---|---|
| 库里报价金额 | 税前合计 / 税额 / 含税总额**不扣**特别让利（让利只存在 `specialPromotion` 列）；对客金额（`displayGrandTotal`）却扣了 | 服务端税前直减让利（扣后最低 0），税额按扣后计算；库里金额与对客金额相差 ≤ 0.01；`specialPromotion` 照旧单独保存 |
| 按人 / 期间统计、折扣统计、客户详情报价列表、财务报价列表 | 有让利的单子偏高（多算让利 × 1.13） | 新保存的报价按扣让利后的金额计算（这些地方不改代码，读库里金额） |
| 已签约报价只改让利 | 总额不变 → 直接生效，绕过签约改价审批 | 总额变化 → 202，进 `sales.update_signed_quote` 审批，报价不变 |
| 预览 / 量房 / AI / agent-core 报价入口 | 不传让利 | 不变 |

实现只有一处：`calculateQuoteTotal` 接收 `specialPromotion`，结果新增 `promotionApplied`（实际扣掉的金额）。新建（`quotes/route.ts`）、编辑（`quote-update.ts`）、签约改价审批执行器（经 `prepareQuoteUpdate`）用的是同一算法。全仓 grep 过，没有地方自己再做 `grandTotal − specialPromotion`，不会重复扣。

## 2. 改了哪些文件

| 文件 | 内容 |
|---|---|
| `src/lib/blinds/pricing-types.ts` | `QuoteTotalInput.specialPromotion?`；`QuoteTotalResult.promotionApplied` |
| `src/lib/blinds/pricing-engine.ts` | 税前直减让利，最低 0，税额按扣后计算 |
| `src/app/api/sales/quotes/route.ts`、`src/lib/sales/quote-update.ts` | 把规范化后的让利传给引擎；引擎异常兜底对象补 `promotionApplied: 0` |
| 测试 | 扩 `quote-fees`、`quote-settings-db.isolated`、`signed-quote-amount-db.isolated`；不新增测试文件 |

## 3. 怎么验

| 项 | 结果 |
|---|---|
| `npx tsx src/lib/blinds/__tests__/quote-fees.test.ts` | 通过（新增：让利 100 → 税前 −100、总额 −113；让利超过税前 → 0 且 `promotionApplied` = 原税前；不传 / −50 / NaN / ∞ → 与改动前相同） |
| 黄金对照 / `pricelist-2026-10-addons` / `sunny-motor` | 158 条不变 / 14 条 / 通过 |
| 隔离库 `quote-settings-db.isolated.test.ts` | **54 / 0**。真实路由新建：产品 + Part B + 安装补足 + 运费 = 1109.375，让利 100，税率 0.13 → 库里 `preTaxTotal` 1009.375、`grandTotal` 1140.59，与报价单页面算式得出的对客金额 1140.60 相差 ≤ 0.01；编辑把让利改为 0 → 1109.375 / 1253.59 |
| 隔离库 `signed-quote-amount-db.isolated.test.ts` | **23 / 0**。已签约报价只把让利从 0 改为 50 → 202 + 审批 ID，报价的总额 / 让利 / 状态 / 签约时间不变；让利不变只改备注 → 200 |
| `NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck` | 退出 0 |
| `npm run lint:baseline` | PASS |
| `npm run build` | 退出 0 |
| `bash scripts/check-test-registry.sh` | 通过，欠账 71 不变 |
| `openspec validate quote-total-net-of-promotion --strict` | valid |
| `git diff origin/main --stat -- prisma/` | 空 |

### 3.1 浏览器走查（生产构建 + 隔离库 + Playwright，销售岗；截图 `docs/stat-2-screenshots/`）

| 步骤 | 结果 |
|---|---|
| Order Form：Zebra LF 48" × 60"；Part B：Hub 1 × 240；Special Promotion 100；保存 | `POST /api/sales/quotes` 201，请求体 `specialPromotion` 100；页面底部 Total **$666.00** |
| 落库 | `merchSubtotal` 174.375、`addonsSubtotal` 240、`preTaxTotal` **589.375**（= 174.375 + 240 + 安装补足 200 + 运费 75 − 100）、`grandTotal` **665.99**、`displayGrandTotal` 666.00。改动前库里会存 778.99 |
| 客户详情 → 报价记录 | 金额 **$665.99**，旁边小字"让利率 22.3% · $100" |
| 页面错误 / 弹窗 | 无 |

### 3.2 全量

（全量结果跑完后补。）

## 4. 实施中对规划的调整 / 发现

1. 无。四件套里的算式与场景数字（1109.375 → 1140.59 / 1253.59）在隔离库经真实路由逐一复现。
2. 引擎异常兜底对象（`quotes/route.ts`、`quote-update.ts` 的 `catch` 分支）因新增结果字段补了 `promotionApplied: 0`，行为不变。

## 5. 上线后要做 / 已知限制

- **BREAKING 1**：已签约报价只改特别让利会进入签约改价审批（此前直接生效）。
- **BREAKING 2**：带让利的老签约报价第一次重新保存时，总额从"未扣让利"变成"已扣让利"，同样触发一次改价审批。
- **历史不回填**：过渡期内统计是新旧混合（老单未扣让利，新单已扣）。只读核对方法：统计 `specialPromotion > 0` 且 `updatedAt` 早于上线时间的报价数量和让利合计，这就是统计偏高部分的上限（× 1.13）。
- 服务端税额仍不按分取整，库里与对客金额最多差 0.01（design D2）。
