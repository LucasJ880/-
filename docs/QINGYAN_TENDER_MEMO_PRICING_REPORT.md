# 评分演算进策略备忘录实施报告（Lane 3）

日期：2026-08-21 · 分支 `feature/tender-memo-pricing` · base = main `6bbbfb2d` · SCHEMA_CHANGE = NONE

## 1. 问题

备忘录 v2 的「评分演算」节只能让 LLM 自己就评分权重做算术——同一输入每次算出的数字可能不同，
也无法与工作台报价表助手（#143）对齐。

## 2. 改动

- **orchestrate**：备忘录生成前装配 `pricingAnalysis`——评分模型取 人工/已推导 `room.pricingModel`
  > 启发式（用**英文原文 contentOriginal**，不受 Lane 1 中文化影响）；对手价取 人工输入 >
  联邦对标中位 > 现任价格带中位；`buildScenarios` 纯函数出情景表/打平价/假设；首次启发式推导
  的模型**落库** `room.pricingModel`（卡片与备忘录同源）。失败温和，不阻塞备忘录。
- **strategy.ts**：输入新增 `pricingAnalysis`；prompt 新节「SCORING MODEL & DETERMINISTIC PRICE
  SCENARIOS」；规则 2 改为**逐字引用演算数字并解读、禁止自行重算**（算术留在纯函数）；
  备忘录 prompt 版本 2 → 3。

## 3. 证据

- 纯平面 bid-strategy-memo **12/12**（新增 MEMO-07 装配守卫 / MEMO-08 禁重算反例守卫）；
  intel-ops 11/11、intel-auto-flow 16/16、intel-slots 13/13、obs-p5 14/14；tsc/eslint 零。
- **真实 E2E 4/4**（生产只读 + 真实模型，零写入）：Halifax 真实事实 → 70% / lowest_over_bid，
  对手 $58,079 → 备忘录评分演算节逐字引用「break-even CAD 61,598.94」「跟价领先 4 分 / 让价 5%
  领先 7.5 分」「我方非价格项 22 vs 对手 18」并列出中性假设告诫；无 GO/NO-GO。

## 4. 上线后

下一次情报编排（分析完成自动 / 情报 tab「立即检索外部情报」）生成的备忘录即带演算；工作台
报价表助手改了成本/毛利/对手价后再点一次检索，备忘录同步更新。

## 5. Gate

```
MEMO_PRICING_SCHEMA_CHANGE = NONE
MEMO_PRICING_SOURCE        = room.pricingModel 共用（首次启发式落库）；算术纯函数；LLM 仅引用解读
MEMO_PRICING_PURE_SUITES   = memo 12/12 + 四情报套件全绿
MEMO_PRICING_REAL_E2E      = PASS 4/4（逐字引用打平价 61,598.94）
MEMO_PRICING_STATUS        = READY_FOR_FINAL_REVIEW（Draft PR，不 merge）
```
