# P1-5 / P1-6 任务书：报价归一化 → 比价矩阵 → `compare` 意图

| 项 | 值 |
|---|---|
| 编号 | P1-5（归一化）、P1-6（比价 + 意图）；一个 PR 交付，分两个 commit |
| 目标 | 把各家报价换算成**同一口径的落地成本（CAD，到目的地）**，输出可逐项对比的矩阵与一句话结论；矩阵直接喂 `tender-pricing.buildScenarios`，让"按 B 的成本投 X 价格分多少"在 Muse 里一句话能答 |
| 依赖 | #234（P1-4）合并 |
| 执行者 | Claude Code |
| 审核 | Claude（chat）；本 PR 合并后进 **GATE-1** 验收 |

---

## 0. 先读

- `src/lib/inquiry/service.ts` `compareQuotes`（现状：按 totalPrice 排序，无归一化）与 `src/app/api/projects/[id]/inquiries/[inquiryId]/compare/analysis/route.ts`（现状：一次性 prompt）
- `src/lib/tender-pricing/calc.ts` — `PricingInputs { competitorPriceCad, ourCostCad, targetMarginPct }`、`buildScenarios`、`breakEvenPrice`
- `src/lib/tender-rfq/round-pure.ts` `readTenderRfqSettings` — 组织级设置的零 schema 写法，P1-5 的汇率/关税设置沿用同一个 `settingsJson.tenderRfq`
- `src/lib/tender-rfq/inbound-apply.ts` — 起订量/贸易条款目前只在 `quoteNotes` 里（§2.4），P1-5 要从 notes 的 `[auto …]` 段**解析回**结构化值（见 §2.3）
- `src/lib/muse-bridge/router.ts` `handleRfq` — `compare` 意图照这个写法接；`router-pure.ts` 的 `sanitizeOutbound`
- `src/lib/project-finance/fx-settlement-service.ts` — 仓库里已有的汇率语义（`fxRateSource: BANK_SETTLEMENT | MANUAL`）；**不要**复用它的结算逻辑，只对齐"汇率来源必须显式"的纪律

---

## 1. 范围

**P1-5 做：**
1. 纯函数 `normalizeQuote(item, ctx) → NormalizedQuote`：币种 → CAD、Incoterm → 落地成本（DDP 等价）、MOQ/阶梯价校验、交期对截标日、有效期对开标日。
2. 组织级设置：汇率表、默认运费/关税估算参数（零 schema，`settingsJson.tenderRfq.landedCost`）。
3. 每个换算步骤都带 `assumption`（用了什么汇率、什么运费估算），缺参数时该项 **null + 原因**，不猜。

**P1-6 做：**
4. `buildCompareMatrix(normalizedQuotes, tender) → CompareMatrix`：排序、标记（最便宜 / 全合规 / 交期超期 / 有效期不够 / MOQ 不满足 / 缺字段）、一句话结论。
5. `compare` 意图接入 Muse；`price_scenario` 意图接入（把选定供应商的落地成本喂 `buildScenarios`）。
6. 现有 `/compare/analysis` 路由改为先出矩阵再让 LLM 只写"解读"，不再让 LLM 看原始行自己算。

**不做：**
- 不自动选供应商（`isSelected` 仍由人点）；
- 不发任何邮件；
- 不改 `InquiryItem` schema，不新增 model；
- 不接实时汇率 API（汇率是组织维护的表 + 更新时间，见 §2.1）。

---

## 2. 设计决定

### 2.1 汇率：组织维护，带日期，缺了就不算
`settingsJson.tenderRfq.landedCost = { fxRates: { CNY: 0.19, USD: 1.36, … }, fxAsOf: "2026-10-20", fxSource: "MANUAL" }`。
- 换算时记录 `assumption: "汇率 CNY→CAD 0.19（2026-10-20，手工）"`。
- 没有该币种汇率 → `landedCad = null`，`blockers` 含 `"缺 CNY→CAD 汇率，请在组织设置填写"`。
- `fxAsOf` 超过 30 天 → 不阻断，但 `warnings` 含"汇率已 N 天未更新"。
- 提供 `PUT /api/organizations/[orgId]/tender-rfq-settings`（org_admin）写这些设置；GET 读。先不做 UI，Muse 和 curl 能改就行。

### 2.2 Incoterm → 落地成本
目标口径：**货到目的地、含关税、不含我方利润**（= `PricingInputs.ourCostCad` 的输入）。

| 报价条款 | 需要加 | 来源 |
|---|---|---|
| EXW | 出口国内陆 + 国际运费 + 保险 + 关税 + 进口清关 | 运费/保险/清关用组织设置的估算参数；关税率用项目级 `dutyRatePct`（人工填，缺则 null） |
| FOB | 国际运费 + 保险 + 关税 + 进口清关 | 同上 |
| CIF / CIP | 关税 + 进口清关 | 同上 |
| DAP | 关税 + 进口清关 | 同上 |
| DDP | 无 | — |
| 未注明 | **不换算**，`blockers` 含"贸易条款未注明" | — |

估算参数（组织级，可缺）：`freightEstimate: { mode: "per_unit" \| "per_shipment" \| "pct_of_goods", value }`, `insurancePct`, `clearanceFlatCad`。每项用到就写进 `assumptions`。**任何一项缺失 → 该报价 `landedCad = null`，列出缺什么**；不要用"行业经验值"顶上。

### 2.3 从 `quoteNotes` 回读结构化值
P1-4 把 MOQ、贸易条款、多档价、强制项答复写在 `quoteNotes` 的 `[auto <iso> msg=<id>] …` 段里。P1-5 写一个纯函数 `parseAutoNotes(quoteNotes) → { moq, incoterm, tiers[], mandatoryAnswers[], lastAutoAt }`：
- 只解析 `[auto …]` 开头的段，人工手写的备注不碰；
- 多段取**最新**一段的值；
- 解析规则与 `inbound-apply.ts` 的写法一一对应（改一边必须改另一边——在两个文件头部互相注明）。
- 这是过渡方案：等 schema 升级后再迁列，本任务不加列。

### 2.4 交期与有效期的"合规"判断
- `deliveryOk`：`emailDate + deliveryDays ≤ tender.deliveryDeadline`（无截止则用 `closeDate + 30`，并写 assumption）；交期为 null → `unknown`。
- `validityOk`：`validUntil ≥ tender.closeDate`（没 closeDate → `unknown`）。
- `moqOk`：`moq ≤ 询价第一档数量`；没 MOQ → `unknown`（不算不合规）。
- `mandatoryOk`：强制项答复里没有"不满足"且没有"未答"→ true；有"不满足"→ false；有"未答"→ `partial`。

### 2.5 矩阵与结论
```ts
type CompareRow = {
  itemId; supplierId; supplierName;
  quoted: { unitPrice; totalPrice; currency; incoterm; moq; deliveryDays; validUntil };
  landedCad: { unit: number|null; total: number|null };
  checks: { deliveryOk; validityOk; moqOk; mandatoryOk };   // true | false | "unknown" | "partial"
  flags: Array<"cheapest"|"fully_compliant"|"delivery_late"|"validity_short"|"moq_unmet"|"mandatory_gap"|"missing_fields"|"not_normalized">;
  assumptions: string[]; warnings: string[]; blockers: string[];
};
type CompareMatrix = { rows: CompareRow[]; cheapestItemId: string|null; recommendedItemId: string|null; summaryZh: string; generatedAt: string };
```
- 排序：有 `landedCad.total` 的按它升序；null 的排最后并标 `not_normalized`。
- `recommendedItemId`：**最便宜的全合规**（四项 checks 都是 true）；没有 → null，`summaryZh` 说明为什么没有推荐（例如"最便宜的 A 交期超截标 10 天；全合规的 B 贵 8%"）。
- `summaryZh` 是纯代码拼的，不走 LLM，≤ 300 字，不含我方成本/利润词（走 `sanitizeOutbound` 再出 Muse）。

### 2.6 `compare` 与 `price_scenario` 意图
- `compare`：`{ projectId, inquiryId? }` → 没给 inquiryId 取最新一轮；回复 = `summaryZh` + `data.matrix`；`suggestedActions` = 对每个有 landedCad 的供应商一个「按 X 的成本算情景」→ `price_scenario`。
- `price_scenario`：`{ projectId, candidatePrice? , supplierItemId? }` → `ourCostCad = 该供应商 landedCad.total`，`competitorPriceCad` 来自项目已有的情报（`tender-intel` 授标记录；没有则 null），调 `buildScenarios`；回复里**只出**价格分、总分差、盈亏平衡价，**不出** `marginPct` 和 `ourCostCad` 数值（这两个是内部财务，Muse 通道脱敏）。
- 两个意图加入 `MUSE_INTENTS` 已有；只需在 `router.ts` 接 handler，并把默认白名单文档更新。

---

## 3. 文件清单

| 文件 | 内容 |
|---|---|
| `src/lib/tender-rfq/landed-cost.ts` | `normalizeQuote`、`readLandedCostSettings`、Incoterm 表、全部纯函数 |
| `src/lib/tender-rfq/notes-parse.ts` | `parseAutoNotes`（与 `inbound-apply.ts` 互相注明） |
| `src/lib/tender-rfq/compare.ts` | `buildCompareMatrix`、`summarizeMatrixZh`、纯函数 |
| `src/lib/tender-rfq/compare-service.ts` | DB：取轮次 items + 项目截标/交付截止 + 组织设置 + 询价第一档数量 → 矩阵 |
| `src/app/api/organizations/[orgId]/tender-rfq-settings/route.ts` | GET/PUT（org_admin），zod 校验，写 `settingsJson.tenderRfq.landedCost` 与 `fromName/fromEmail` |
| `src/app/api/projects/[id]/inquiries/[inquiryId]/compare/matrix/route.ts` | GET 矩阵（项目读权限） |
| `src/app/api/projects/[id]/inquiries/[inquiryId]/compare/analysis/route.ts` | 改：先矩阵，LLM 只写解读 |
| `src/lib/muse-bridge/router.ts` | `handleCompare`、`handlePriceScenario` |
| `src/lib/tender-rfq/__tests__/landed-cost.test.ts` | ≥ 20 例表驱动：每种 Incoterm × 有/无汇率 × 有/无运费参数 |
| `src/lib/tender-rfq/__tests__/notes-parse.test.ts` | 与 `inbound-apply` 的 notes 输出做**往返测试**（写 → 读 → 相等） |
| `src/lib/tender-rfq/__tests__/compare.test.ts` | §4 用例 |
| `docs/QINGYAN_TENDER_P1-5-6_REPORT.md` | 完成报告 |

---

## 4. 验收用例（测试里逐条出现）

1. A 报 CNY 280/个 FOB，汇率 0.19，运费 per_unit 6 CAD，保险 1%，关税 6.5%，清关 150 CAD，数量 1500 → `landedCad.unit` 与 `total` 数值正确（把算式写在测试注释里），`assumptions` 5 条。
2. 同 A 但无 CNY 汇率 → `landedCad=null`，`blockers=["缺 CNY→CAD 汇率…"]`，`flags` 含 `not_normalized`，排最后。
3. B 报 CAD 61,000 DDP → 不加任何项，`assumptions=[]`。
4. 贸易条款未注明 → `landedCad=null`，blocker "贸易条款未注明"。
5. 汇率 `fxAsOf` 45 天前 → 照常换算，`warnings` 含"45 天未更新"。
6. A 最便宜但交期 = 截标后 10 天 → `flags` 含 `cheapest` 和 `delivery_late`，`recommendedItemId` 不是 A。
7. B 贵 8% 但四项全 true → `recommendedItemId=B`，`summaryZh` 同时提到 A 为什么没推荐。
8. 所有家都有问题 → `recommendedItemId=null`，summary 说明。
9. `parseAutoNotes` 往返：`inbound-apply` 生成的 notesAppend（含 MOQ、DDP、两档价、强制项 R-01 满足/R-05 未答）→ 解析结果字段相等；人工在前面手写的一行备注不影响解析。
10. `summaryZh` 含"毛利"/"成本" 字样时被 `sanitizeOutbound` 整段替换（反向用例：正常 summary 不会误触）。
11. `price_scenario` 响应 JSON 里**不存在** `marginPct`、`ourCostCad` 两个键。
12. `compare` 意图：轮次里 0 家 quoted → 回"还没有报价入表"，不是空矩阵。

---

## 5. 禁止事项

- 不用任何"默认汇率"或"经验运费"；缺参数 = null + blocker。
- 不让 LLM 参与任何数值计算；LLM 只在 `/compare/analysis` 写解读，且输入是矩阵不是原始行。
- Muse 通道不出 `marginPct` / `ourCostCad` / 关税率以外的内部财务；`summaryZh` 走 `sanitizeOutbound`。
- 不改 `InquiryItem` / `ProjectInquiry` schema，不新增 model。
- 不自动设置 `isSelected`。
- `parseAutoNotes` 不解析人工备注；只认 `[auto …]` 段。

---

## 6. 提交方式

分支 `feature/tender-rfq-compare-p1-5-6`，基于合并后的 main。两个 commit：`feat(tender-rfq): P1-5 landed-cost normalization` / `feat(tender-rfq): P1-6 compare matrix + muse compare/price_scenario`。PR 描述贴三个测试文件通过数与完成报告链接。
