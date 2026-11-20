# Design：投标策略备忘送进模型前去掉我方成本

## Context

- `src/lib/tender-intel/orchestrate.ts` 在外部情报运行时为备忘装配报价演算：读调查室 `summaryJson.pricingInputs`（`competitorPriceCad`、`ourCostCad`、`targetMarginPct`），调用 `buildScenarios`（`src/lib/tender-pricing/calc.ts`），再把 `{ model, inputs（含 ourCostCad、targetMarginPct）, breakEvenPriceCad, breakEvenNoteZh, ourOtherPts, competitorOtherPts, scenarios（含 marginPct）, assumptionsZh }` 交给 `synthesizeBidStrategyMemo`。
- `buildScenarios` 在有我方成本时多出「成本 + 目标毛利 m%」（`floor`）或「成本价（零毛利）」（`cost`）情景，每个情景带 `marginPct`；没有成本时这两个情景不生成、`marginPct` 为 null，并在假设里加「未填我方成本——毛利列为空；成本底价情景未生成」。打平价与跟价 / 让价 5% / 10% / 15% 四个情景只取决于评分模型与对手价。
- `src/lib/tender-intel/strategy.ts` 的 `MEMO_SYSTEM_PROMPT` 第 2 条要求「quote its numbers verbatim (… each scenario's price/total-score delta/margin …)」；备忘 `scoringAnalysisZh`、`pricingStrategyZh` 两段由此写出成本与毛利。
- 备忘存在调查室 `summaryJson.bidStrategyMemo`，读它的地方（src 下除编排与提示词外只有这五处，单测遍历核对）：情报页签 `GET /api/projects/{项目}/external-intel/award-history` 原样返回整份备忘（卡片 `org-award-intel-slots.tsx` 显示摘要、风险门、「报价策略：」前 160 字、数据缺口）；工作台摘要（摘要、风险门、数据缺口）；投标文件草稿的输入（`src/lib/tender-bid-draft/gather.ts`：摘要、风险门（含依据）、teaming 交给起草模型，RFI 只计条数）；澄清问题文件（`src/lib/projects/generate/generate-docs.ts`：RFI 原文进文件）。CHAIN-2b（#532）去掉了项目列表与调查室读取两个接口原样返回的备忘。
- 成本与毛利只给有财务查看权的人看（`resolveFinancePrivilege(...).canReadAll`，CHAIN-2b）。

## Goals / Non-Goals

**Goals**：送进备忘模型的输入里没有我方成本、目标毛利、成本底价情景与毛利；提示词不再要求、也禁止写成本与毛利；已存的旧版备忘在每一个读取的地方先裁剪再用。

**Non-Goals**：
- `src/lib/tender-pricing/calc.ts`（报价演算本身不改）、`src/components/tender/pricing-helper-card.tsx` 与报价表助手接口（CHAIN-2b）。
- 投标文件草稿与澄清问题文件的其它输入（`gather.ts` 里的 `pricingInputs.ourPriceCad` / `competitorPriceCad`、分析摘要等）——只在读备忘处加裁剪。
- `synthesizeBidStrategyAuto`（旧版自动策略草案，输入里没有报价演算）。
- 备忘的输出结构 `bidStrategyMemoSchema`（字段不变）。

## Decisions

### D1：给备忘算报价情景时就不传成本与目标毛利

新增纯函数 `buildMemoPricingAnalysis({ model, roomSummary, vendorPriceBenchmark })`：把原来在编排里读 `pricingInputs` 的代码搬进来，只取对手价（人工输入 > 联邦对标中位 > 现任价格带中位，与改动前同一顺序），不读 `ourCostCad`、`ourCostSource`、`targetMarginPct`、`ourPriceCad`；内部调用 `buildScenarios(model, { competitorPriceCad, ourCostCad: null, targetMarginPct: null })`，返回 `{ model（权重、公式、其它项、来源）, inputs: { competitorPriceCad }, breakEvenPriceCad, breakEvenNoteZh, ourOtherPts, competitorOtherPts, scenarios（key、labelZh、priceCad、ourTotal、competitorTotal、deltaPts，没有 marginPct）, assumptionsZh, costExcludedZh }`。再做一道兜底：情景里 `key` 为 `floor` / `cost` 的去掉，假设里「未填我方成本」那句去掉（成本不是没填，是不给），加一句 `costExcludedZh`：`我方成本、目标毛利与成本底价只给有财务查看权的人看，这里不提供；不要推测。`。编排改为调用它（评分模型的取得与首次推导落库仍在编排里）。测试的输入是带着成本、目标毛利、成本来源（少见的落地价）与我方报价的调查室 `summaryJson`——函数拿得到这些值，测试才有意义。

- 备选 A：照旧用含成本的演算，只在送进模型前删字段。否决：成本先进了演算再删，漏一个派生字段（如情景标签里的「目标毛利 m%」、成本底价的价格本身）就会带出去；不传成本，演算里根本没有。
- 备选 B：只改提示词让模型别写成本。否决：输入里有成本，模型仍可能写出来；提示词是软约束，规格要的是输入里就没有。
- 备选 C：有财务查看权的人看到含成本的备忘、其他人看到不含的（生成两份）。否决：多一次模型调用（违背第 7 条）；备忘还进投标文件草稿等非按人区分的产物。

### D2：提示词改第 2 条、加第 8 条，版本号各加一；读取端用导出的版本集合认旧版

第 2 条把「each scenario's price/total-score delta/margin」改为「each scenario's price and total-score delta」，其余（逐字引用、不重算、列出假设）不变；新增第 8 条：`The pricing analysis deliberately excludes our cost, our target margin and cost-floor scenarios (finance-restricted). Never state, estimate or infer our cost, our margin or a cost floor anywhere in the memo, and do NOT list our missing cost or margin as a data gap. pricingStrategyZh discusses price positioning against competitor / benchmark prices and total-score deltas only.`。`BID_STRATEGY_MEMO_PROMPT.version` 3 → 4；`BID_STRATEGY_MEMO_VERSION` 改为 `tender-bid-strategy-memo/v3`（类型名随之 `BidStrategyMemoV3`）。`memo-pricing.ts` 导出常量 `BID_STRATEGY_MEMO_NO_COST_VERSION` 与集合 `BID_STRATEGY_MEMO_NO_COST_VERSIONS`，`strategy.ts` 的版本号取自它；读取端只用这个集合判断旧版，不写死 `v3`。

先例：Lane 3（把报价演算接进备忘）时只把提示词版本从 2 加到 3、备忘版本没动——那次备忘的形状和输入口径都没变。这次输入口径变了（成本不再进来），读取端要靠一个判别字段区分旧版，所以备忘版本也要换。

- 备选：版本号不动、另加字段 `costExcluded: true`。否决：读取端需要一个判别字段，仓库的惯例是比版本常量（`version !== CONSTANT`，见 `src/lib/tender-intel/analyze.ts:161`、`src/lib/tender-bid-workspace/cost-draft.ts:58`）；另加布尔字段要在每个读取方另写一套判断，旧数据里还会出现「没有这个字段」与「false」两种情况。

### D3：旧版备忘在每一个读取的地方先过同一个裁剪

纯函数 `redactLegacyMemo(memo)`：不是对象、或版本在 `BID_STRATEGY_MEMO_NO_COST_VERSIONS` 里 → 原样（同一个对象）；否则返回副本：`scoringAnalysisZh`、`pricingStrategyZh` 置空串、加 `legacyCostRedacted: true`；`summaryZh`、`competitiveLandscapeZh`、`teamingAdviceZh`、`dataGapsZh` 与每条风险门的 `gateZh`、`basisZh`，碰到「成本 / 毛利 / 底价 / 利润 / 我方报价 / margin / cost」（不分大小写）的整段换成 `（旧版备忘的这一段可能提到我方成本或毛利，已隐藏。）`；碰到这些字眼的 RFI 整条去掉（RFI 会原样进对外提交的澄清问题文件，不能放占位句）。四个读取处（情报页签、工作台摘要、投标文件草稿的输入、澄清问题文件）都先过它（对所有人，不按财务权限分）。卡片在 `legacyCostRedacted` 时把「报价策略：…」一行换成 `报价策略：这份策略备忘是旧版生成的，可能含我方成本或毛利，已隐藏；请有编辑权限的同事重新检索外部情报，会生成新的。`（只读的人自己不能重跑）。

- 备选 A：不管旧版，等下次运行自然覆盖。否决：没重跑的项目会一直给所有读者看、交给起草模型含成本的段落。
- 备选 B：只隐藏「评分演算」「报价策略」两段。否决：旧版摘要与风险门依据也会复述成本，而且被交给投标文件草稿的模型（`gather.ts`）、显示在卡片上。
- 备选 C：旧版按财务查看权分人隐藏。否决：四个读取处里有两处是交给模型或写进文件，不是按人显示；一律裁剪最简单、确定。
- 备选 D：旧版整份不用。否决：竞争格局、teaming、不碰成本的风险门与 RFI 照旧有用。

## 与八条硬纪律的关系

1. 零 schema：遵守（只改调查室 `summaryJson` 里备忘的版本号取值与读取时的裁剪，不改 `prisma/`）。
2. 出站先审批：不涉及（没有新的对外发送）。
3. 禁止第三套队列：不涉及。
4. 脱敏：遵守——本 change 的目的：我方成本、毛利不进模型输入、不进备忘；旧版备忘里可能带的先裁剪。不触碰 Muse（muse-bridge 不改）；与 CHAIN-2b 同方向收紧。
5. 不爬登录页：不涉及。
6. 邮箱分离：不涉及。
7. 确定性优先：遵守（零新增模型调用；成本裁剪在纯函数里，模型调用次数不变）。
8. 测试注册：新测试 `memo-pricing.test.ts`、`memo-legacy-db.isolated.test.ts` 登记进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`。

## 验证方式

- `npx tsx src/lib/tender-intel/__tests__/memo-pricing.test.ts`：调查室 `summaryJson` 带我方成本 87654.32、目标毛利 23.7、成本来源（落地价 91234.56）、我方报价 96543.21；由 `calc.ts` 现算出的成本底价与各情景毛利（不手写）一并列为禁出数字。`buildMemoPricingAnalysis` 的结果里一个都搜不到；用假 invoker 调 `synthesizeBidStrategyMemo` 捕获每一次请求，模型只被调用一次，整段系统提示与用户输入里一个都搜不到；对照组（复刻改动前的装配）里搜得到；四个对手价情景与打平价等于不传成本时的结果；提示词逐字断言；`redactLegacyMemo` 对 v2 / 无版本 / v3 / 非对象各一例；源码断言编排不读成本、四个读取处都先裁剪、src 下读备忘的文件就这五个、卡片那句话、E2E 脚本认 v3。
- `NODE_ENV=test npx tsx src/lib/tender-intel/__tests__/memo-legacy-db.isolated.test.ts`（隔离库）：经真实 `GET` 情报页签与工作台摘要（只读成员）、真实 `gatherBidDraftInputs`，v2 备忘被裁剪、整个响应与草稿输入里搜不到成本数字，v3 原样。
- 既有：`bid-strategy-memo.test.ts`、`intel-auto-flow.test.ts`、`intel-slots-p1p2.test.ts`、`obs-p5-intel-loop.test.ts`、`intel-ops.test.ts`、`tender-detail-ia.test.ts`、`rfi-export.test.ts`、`import-leads.test.ts`、`pricing-helper.test.ts`、`bid-draft.test.ts`、隔离库 `room-summary-writers-db.isolated.test.ts` 原样通过。
- 全量：`npm test`、`npm run test:ci`、`npm run typecheck`、`npm run lint:baseline`。

## Risks / Trade-offs

- 有财务查看权的人也失去了「改我方成本 → 重跑外部情报 → 备忘随之更新」（Lane 3 的行为）：备忘不再引用成本底价与毛利；他们在报价表助手里看底价情景。
- 旧版备忘的裁剪按字眼匹配，宁可多换：不提成本但碰到「cost」等词的段落（如「cost scoring formula」）也会被换掉或去掉；下一次外部情报运行后备忘换成 v3 即恢复完整。没提这些字眼却在讲成本的写法（如只写一个数字）挡不住——对应段落（评分演算、报价策略）已整段置空。
- 新备忘不再给出「成本 + 目标毛利」底价，报价策略只讲相对对手价的位置。
- 对手价来自人工输入、联邦对标或现任价格带；它们不是我方成本，照旧进演算。
- 与 CHAIN-2b（#532）：业务代码没有重叠（#532 改项目列表与调查室读取两个接口、报价表助手；本 change 改编排、提示词与四个读备忘处），但都改了 `scripts/test-all.sh`、`scripts/test-ci-unit.sh`（不同位置）与 TASKFLOW（都在 CHAIN-2 行后加一行，后合并的保留两行，2b 在前）。
