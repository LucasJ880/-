# P1-5 / P1-6 完成报告：报价归一化 → 比价矩阵 → `compare` / `price_scenario`

任务书：`docs/QINGYAN_TENDER_P1-5-6_NORMALIZE_COMPARE_TASKBRIEF.md`
分支：`feature/tender-rfq-compare-p1-5-6`（基于合并后的 main：#232 + #234）

---

## 1. 做了什么

### P1-5 落地价归一化（commit 1）
| 文件 | 内容 |
|---|---|
| `src/lib/tender-rfq/landed-cost.ts` | `normalizeQuote`（币种 → CAD、Incoterm → 落地价）、`evaluateQuoteChecks`（§2.4 四项检查）、`readLandedCostSettings`、Incoterm 表、PUT 体 schema 与纯合并函数 `applyTenderRfqSettingsUpdate` |
| `src/lib/tender-rfq/notes-parse.ts` | `parseAutoNotes`：从 `quoteNotes` 的 `[auto …]` 段回读起订量 / 贸易条款 / 多档价 / 强制项答复；与 `inbound-apply.ts` 文件头互相注明 |
| `src/app/api/organizations/[orgId]/tender-rfq-settings/route.ts` | GET / PUT（org_admin，zod 校验，AuditLog），写 `settingsJson.tenderRfq.landedCost` 与 `fromName / fromEmail` |

### P1-6 比价矩阵 + Muse 意图（commit 2）
| 文件 | 内容 |
|---|---|
| `src/lib/tender-rfq/compare.ts` | `buildCompareMatrix`、`summarizeMatrixZh`（代码拼，≤300 字）、`projectScenariosForMuse`（Muse 脱敏投影）、`scoreCandidatePrice`、`buildMatrixInterpretationPrompt` |
| `src/lib/tender-rfq/compare-service.ts` | DB 取数：轮次 quoted items + 截标日 + 组织设置 + 询价第一档数量 / 强制编号 + `[auto]` 段 → 矩阵 |
| `src/app/api/projects/[id]/inquiries/[inquiryId]/compare/matrix/route.ts` | GET 矩阵（项目读权限，零 LLM） |
| `src/app/api/projects/[id]/inquiries/[inquiryId]/compare/analysis/route.ts` | 改：先出矩阵，LLM 只拿矩阵写解读；`summary` / `recommendedSupplier` 来自代码；响应结构与 `QuoteAnalysisPanel` 兼容，另附 `matrix` |
| `src/lib/muse-bridge/router.ts` / `router-pure.ts` | `handleCompare`、`handlePriceScenario`；`formatCompareResponse` / `formatPriceScenarioResponse` / `formatNoQuotesResponse` |
| `src/lib/muse-bridge/contract.ts` | `price_scenario` 加可选 `supplierItemId`；出站脱敏加 strict 模式 |
| `src/lib/tender-pricing/project-context.ts` | 从 `pricing-helper` 路由**原样抽出**评分模型 / 价格带 / 人工输入的取数（路由改为 import，纯改名，逻辑不变），供 `price_scenario` 复用同一口径 |
| `src/lib/muse-bridge/flags.ts`、`.env.example` | 意图白名单文档：Phase 1 按需打开 `rfq` / `compare` / `price_scenario` |

### 换算口径（§2.2）
- 落地价 = 货到目的地、含关税、不含我方利润。
- 每步一条 `assumption`（汇率含日期与来源；运费 / 保险 / 关税 / 清关含算式与金额）；缺任何参数 → `landedCad = null` + 一条 blocker 列出全部缺项。
- 关税基数：EXW / FCA / FOB 按货值（EXW 另加内陆），与加拿大 value for duty 口径一致（不含国际运保）；CIF / CIP / DAP 价已含运保无法拆出，按报价本身计，assumption 注明"偏保守"。
- 保险按（货值 + 内陆 + 运费）× 费率。
- §4-1 算式：货值 280 × 0.19 × 1500 = 79,800；运费 6 × 1500 = 9,000；保险 1% × 88,800 = 888；关税 6.5% × 79,800 = 5,187；清关 150 → **95,025.00 / 63.35 每个**（单测与本地真库两条路径都得到这个数）。

---

## 2. 没做什么（按任务书）

- 不自动设置 `isSelected`（推荐只是建议）；不发邮件；不改 schema、不新增 model；不接实时汇率。
- 没做设置 UI（任务书：先用 Muse / curl 改）。

---

## 3. 怎么验

```bash
npx tsx src/lib/tender-rfq/__tests__/landed-cost.test.ts   # 66 passed（§4-1…§4-5 + Incoterm × 汇率 × 运费参数 28 格表驱动 + 设置合并 + §2.4 检查）
npx tsx src/lib/tender-rfq/__tests__/notes-parse.test.ts   # 15 passed（§4-9 往返：inbound-apply 写 → parseAutoNotes 读 → 相等）
npx tsx src/lib/tender-rfq/__tests__/compare.test.ts       # 40 passed（§4-2、§4-6…§4-8、§4-10…§4-12）
```
回归：`inbound-apply` 45、`inbound-parse` 38、`build` 21、`round-pure` 25、`muse-bridge-pure` 43。本地 `npm run test:ci`、`typecheck`、`lint:baseline`、`build` 全部通过。

往返测试也做过反向验证：把 `inbound-apply` 的 `起订量=` 改成 `起订量：`，§4-9 立即失败。

本地 Postgres 端到端（`handleMuseCommand` 真实入口，只种数据不 mock）：
- 0 家 quoted 的轮次 → `compare` 回"第 1 轮询价还没有报价入表。"，无 `data.matrix`；
- A（CNY 280 FOB）落地价 95,025、B（CAD 103,000 DDP）→ 矩阵、推荐、结论正确；
- `price_scenario` 响应 JSON 里无 `marginPct` / `ourCostCad` 键，落地价数值不出现；跨组织请求 → `PROJECT_NOT_FOUND`。

---

## 4. 判断点（请审）

1. **`price_scenario` 在 Muse 里与选哪家供应商无关。** `buildScenarios` 里只有毛利（`marginPct`）和"成本底价"情景依赖 `ourCostCad`；价格分、总分差、打平价只取决于报价与对手价。任务书要求 Muse 只出后三者、且不出前两者，所以按 A 算和按 B 算，Muse 看到的内容相同（落地价仍作为 `ourCostCad` 喂给 `buildScenarios`，按任务书接线）。"成本底价"情景的价格 = 成本 /（1 − 目标毛利）能直接反推成本，也一并不出。若希望 Muse 能看到"低于该供应商落地价会亏"之类的提示，需要先定一个不泄露成本的说法。
2. **起订量 unknown 不挡推荐。** §2.4 说"没 MOQ → unknown（不算不合规）"，§2.5 又要求"四项 checks 都是 true"。照字面，绝大多数不写 MOQ 的供应商永远不会被推荐（本地端到端第一次跑就出现了：唯一合规的一家因没写 MOQ 未被推荐）。实现为：交期 / 有效期 / 强制项必须 true，起订量只在明确超出（false）时挡；推荐语注明"（起订量未注明）"。
3. **项目级 `dutyRatePct` / `deliveryDeadline` 存在组织设置里**：`settingsJson.tenderRfq.landedCost.projects[projectId]`，经同一个 PUT 写（校验项目属于该组织）。没放 BidIntelligenceRoom，是因为那里要等分析后才有记录、且没有现成写入口。
4. **出站脱敏 strict 模式。** 默认 `sanitizeOutbound` 不拦单独的"成本"（status / ask 的招标原文常有"成本评分""成本标"，全局加会误伤）。`compare` / `price_scenario` 用 `{ strict: true }`，另拦"成本 / 利润 / ourCost / profit"；§4-10 两个方向都有测试。对应地，结论里用"落地价"而不是"落地成本"，建议动作文案是「按 X 的落地价算情景」（任务书写的是「按 X 的成本算情景」）。
5. **汇率没有日期或来源 → 不用（blocker），不只是 warning。** "来源必须显式"按硬闸实现；PUT 也拒绝只有数字的汇率表。
6. **EXW 需要一个任务书没列的参数** `exportInlandEstimate`（出口国内陆运费，同 `freightEstimate` 结构）；缺则 EXW 报价 blocker。另外支持 FCA（同 FOB 口径）；CPT 等其它条款 → blocker"暂不支持换算"，不猜。
7. **"部分满足"算 `partial`**（任务书只定义了"不满足"与"未答"）；RFQ 里有、回信没提的强制编号按"未答"计。
8. **`parseAutoNotes` 多段时按字段取最新**：最新一段提到的字段用它，没提到的沿用更早的段（例如后来一封"收到"不会把起订量清空）。任务书原文"多段取最新一段的值"，按整段替换会丢信息。
9. **询价数量来自已发出的 RFQ 正文**（P1-1 没有单独落库数量阶梯）。手工建的轮次没有 `tender.send_rfq` 记录 → 只有单价的报价换算不出总价，blocker"缺询价数量"，结论里点名。
10. **贸易条款只来自 `[auto]` 段**；人工录的报价没有贸易条款列 → blocker"贸易条款未注明"。等 schema 迁列后可改。

---

## 5. 已知限制

- `getQuoteAnalysisPrompt`（`src/lib/ai/prompts.ts`）在 `/compare/analysis` 改写后已无调用方，未删除以免扩大 diff。
- `/compare/analysis` 的 LLM 解读仍可能写出矩阵外的数字：prompt 明确禁止，但没有做数字校验；`summary` 与 `recommendedSupplier` 来自代码，不受影响。
- `compare` / `price_scenario` 不在默认意图白名单里，需在 `MUSE_BRIDGE_INTENTS` 显式打开（与 `rfq` 一致）。
