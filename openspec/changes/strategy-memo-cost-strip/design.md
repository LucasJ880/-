# Design：投标策略备忘送进模型前去掉我方成本

## Context

- `src/lib/tender-intel/orchestrate.ts` 在外部情报运行时为备忘装配报价演算：读调查室 `summaryJson.pricingInputs`（`competitorPriceCad`、`ourCostCad`、`targetMarginPct`），调用 `buildScenarios`（`src/lib/tender-pricing/calc.ts`），再把 `{ model, inputs（含 ourCostCad、targetMarginPct）, breakEvenPriceCad, breakEvenNoteZh, ourOtherPts, competitorOtherPts, scenarios（含 marginPct）, assumptionsZh }` 交给 `synthesizeBidStrategyMemo`。
- `buildScenarios` 在有我方成本时多出「成本 + 目标毛利 m%」（`floor`）或「成本价（零毛利）」（`cost`）情景，每个情景带 `marginPct`；没有成本时这两个情景不生成、`marginPct` 为 null，并在假设里加「未填我方成本——毛利列为空；成本底价情景未生成」。打平价与跟价 / 让价 5% / 10% / 15% 四个情景只取决于评分模型与对手价。
- `src/lib/tender-intel/strategy.ts` 的 `MEMO_SYSTEM_PROMPT` 第 2 条要求「quote its numbers verbatim (… each scenario's price/total-score delta/margin …)」；备忘 `scoringAnalysisZh`、`pricingStrategyZh` 两段由此写出成本与毛利。
- 备忘存在调查室 `summaryJson.bidStrategyMemo`，给人看的地方：情报页签 `GET /api/projects/{项目}/external-intel/award-history` 原样返回整份备忘（卡片 `org-award-intel-slots.tsx` 显示摘要、风险门、「报价策略：」前 160 字、数据缺口）；工作台摘要（摘要、风险门、数据缺口）；投标文件草稿（摘要、风险门、teaming、RFI）；澄清问题文件（RFI）。CHAIN-2b（#532）去掉了项目列表与调查室读取两个接口原样返回的备忘，其余路径不动。
- 成本与毛利只给有财务查看权的人看（`resolveFinancePrivilege(...).canReadAll`，CHAIN-2b）。

## Goals / Non-Goals

**Goals**：送进备忘模型的输入里没有我方成本、目标毛利、成本底价情景与毛利；提示词不再要求、也禁止写成本与毛利；已存的旧版备忘里最可能带成本与毛利的两段不再给出。

**Non-Goals**：
- `src/lib/tender-pricing/calc.ts`（报价演算本身不改）、`src/components/tender/pricing-helper-card.tsx` 与报价表助手接口（CHAIN-2b）。
- `src/app/api/projects/[id]/workbench-summary/route.ts`、`src/lib/tender-bid-draft/gather.ts`、`src/lib/projects/generate/generate-docs.ts`（旧版备忘的其它段落照用，见 Risks）。
- `synthesizeBidStrategyAuto`（旧版自动策略草案，输入里没有报价演算）。
- 备忘的输出结构 `bidStrategyMemoSchema`（字段不变）。

## Decisions

### D1：给备忘算报价情景时就不传成本与目标毛利

新增纯函数 `buildMemoPricingAnalysis({ model, competitorPriceCad })`：内部调用 `buildScenarios(model, { competitorPriceCad, ourCostCad: null, targetMarginPct: null })`，返回 `{ model（权重、公式、其它项、来源）, inputs: { competitorPriceCad }, breakEvenPriceCad, breakEvenNoteZh, ourOtherPts, competitorOtherPts, scenarios（key、labelZh、priceCad、ourTotal、competitorTotal、deltaPts，没有 marginPct）, assumptionsZh, costExcludedZh }`。再做一道兜底：情景里 `key` 为 `floor` / `cost` 的去掉，假设里「未填我方成本」那句去掉（成本不是没填，是不给），加一句 `costExcludedZh`：`我方成本、目标毛利与成本底价只给有财务查看权的人看，这里不提供；不要推测。`。编排改为调用它，不再读 `pricingInputs.ourCostCad` 与 `targetMarginPct`。

- 备选 A：照旧用含成本的演算，只在送进模型前删字段。否决：成本先进了演算再删，漏一个派生字段（如情景标签里的「目标毛利 m%」、成本底价的价格本身）就会带出去；不传成本，演算里根本没有。
- 备选 B：只改提示词让模型别写成本。否决：输入里有成本，模型仍可能写出来；提示词是软约束，规格要的是输入里就没有。
- 备选 C：有财务查看权的人看到含成本的备忘、其他人看到不含的（生成两份）。否决：多一次模型调用（违背第 7 条）；备忘还进投标文件草稿等非按人区分的产物。

### D2：提示词改第 2 条、加第 8 条，版本号各加一

第 2 条把「each scenario's price/total-score delta/margin」改为「each scenario's price and total-score delta」，其余（逐字引用、不重算、列出假设）不变；新增第 8 条：`The pricing analysis deliberately excludes our cost, target margin and cost-floor scenarios (finance-restricted). Never state, estimate or infer our cost, our margin or a cost floor anywhere in the memo; pricingStrategyZh discusses price positioning against competitor / benchmark prices and score deltas only.`。`BID_STRATEGY_MEMO_PROMPT.version` 3 → 4；`BID_STRATEGY_MEMO_VERSION` 改为 `tender-bid-strategy-memo/v3`，v3 的含义是「输入里没有我方成本」，读取端据此认旧版。

- 备选：版本号不动、另加字段 `costExcluded: true`。否决：版本号本来就是备忘的形状 / 来源标识，换版本对所有读取方都一目了然；字段要改 schema。

### D3：旧版备忘的「评分演算」「报价策略」两段在情报页签读取时不给出

纯函数 `redactLegacyMemoCost(memo)`：备忘的 `version` 不是 `tender-bid-strategy-memo/v3` 时，返回把 `scoringAnalysisZh`、`pricingStrategyZh` 置为空串、加 `legacyCostRedacted: true` 的副本；是 v3 或不是对象时原样返回。`GET …/external-intel/award-history` 返回备忘前调用它（对所有人，不按财务权限分）。卡片在 `legacyCostRedacted` 时把「报价策略：…」一行换成 `报价策略：这份策略备忘是旧版生成的，可能含我方成本或毛利，已隐藏；重新检索外部情报后会生成新的。`。

- 备选 A：不管旧版，等下次运行自然覆盖。否决：没重跑的项目会一直给所有读者看含成本的报价策略。
- 备选 B：旧版按财务查看权分人隐藏。否决：情报页签接口要多做一次财务判定，而旧版下一次运行就会被替换；简单、确定地对所有人隐藏两段即可，有财务查看权的人在报价表助手里能看到成本与情景。
- 备选 C：旧版整份不显示。否决：摘要、风险门、RFI、数据缺口不是由成本写成的，照旧有用。

## 与八条硬纪律的关系

1. 零 schema：遵守（只改调查室 `summaryJson` 里备忘的版本号取值与读取时的裁剪，不改 `prisma/`）。
2. 出站先审批：不涉及（没有新的对外发送）。
3. 禁止第三套队列：不涉及。
4. 脱敏：遵守——本 change 的目的：我方成本、毛利不进模型输入、不进备忘。
5. 不爬登录页：不涉及。
6. 邮箱分离：不涉及。
7. 确定性优先：遵守（零新增模型调用；成本裁剪在纯函数里，模型调用次数不变）。
8. 测试注册：新测试 `memo-pricing.test.ts` 登记进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`。

## 验证方式

- `npx tsx src/lib/tender-intel/__tests__/memo-pricing.test.ts`：用少见的成本 87654.32、目标毛利 23.7 构造输入，`buildMemoPricingAnalysis` 的结果里没有成本、毛利数字与 `marginPct`、`floor`、`cost` 情景；四个对手价情景与打平价等于 `buildScenarios` 不传成本时的结果；用假 invoker 调 `synthesizeBidStrategyMemo` 捕获整段 `userPrompt` 与 `systemPrompt`，里面搜不到这两个数字；提示词第 2 条不再含 `margin`、含第 8 条；`redactLegacyMemoCost` 对 v2 置空两段、对 v3 原样；源码断言编排不再把 `ourCostCad`、`targetMarginPct` 交给演算、情报页签接口调用 `redactLegacyMemoCost`、卡片在标记时写那句话。
- `npx tsx src/lib/tender-intel/__tests__/bid-strategy-memo.test.ts`：MEMO-07 / MEMO-08 随接线更新后通过。
- 全量：`npm test`、`npm run test:ci`、`npm run typecheck`、`npm run lint:baseline`。

## Risks / Trade-offs

- 旧版备忘的摘要、风险门、teaming、数据缺口、RFI 仍在工作台摘要、投标文件草稿、澄清问题文件里照用；提示词从没要求这些段落写成本或毛利，但模型可能顺带提到。下一次外部情报运行后备忘换成 v3 即消除；要彻底可以在 GATE 定后批量重跑。
- 新备忘不再给出「成本 + 目标毛利」底价，报价策略只能讲相对对手价的位置；有财务查看权的人在报价表助手里看底价情景。
- 对手价来自人工输入、联邦对标或现任价格带；它们不是我方成本，照旧进演算。
- 与 CHAIN-2b（#532）没有文件重叠：#532 改项目列表与调查室读取两个接口、报价表助手；本 change 改编排、提示词与情报页签读取。TASKFLOW 两边都在 CHAIN-2 行后加一行，后合并的保留两行。
