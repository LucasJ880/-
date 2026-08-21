# 报价表助手实施报告（tender-pricing/v1）

日期：2026-08-20 · 分支 `feature/tender-pricing-helper` · base = main `10218b38` · SCHEMA_CHANGE = NONE

## 1. 目标

把「报多少」从直觉变成可核算的情景：评分公式（批次二抽到的 evaluation_criteria）+ 对手/现任
价格带（情报室 incumbentLead / 联邦合同对标）+ 我方成本与目标毛利 → 情景表与**打平价**
（与对手总分持平的我方最高报价）。HRM-2026-0395 实测：价格 70% / 最低价满分其余按
最低价/本标价折算 / 新供应商绩效默认 60% / 美国供应商国籍项 0 分。

## 2. 结构（AI 只做结构化，算术纯函数，人工覆盖最高优先）

- **`src/lib/tender-pricing/calc.ts`** — 纯计算：`priceScore`（两种公式）、`otherPoints`
  （未知得分率按 60 中性并记假设）、`breakEvenPrice`（领先→可高于对手价；落后→须更便宜；
  落后超过价格满分→null 不伪造）、`buildScenarios`（跟价/让价 5-10-15%/打平价/成本底价，
  毛利列，假设清单）。RFQ p8 自带算例 90×(100k/130k)=69 作为探针基准。
- **`src/lib/tender-pricing/derive.ts`** — 评分模型推导：① 启发式（零花费，正则抓
  「Cost 70%」与公式措辞，负向前瞻排除「60% of the available points」类非权重百分比——
  真实措辞实测踩坑后加）；② LLM 结构化（仅手动「重新推导」触发，文档接地，数字逐字，
  未知 null，失败回退启发式）。绩效默认 60%、我方国籍满分作为可改默认值。
- **`POST/GET /api/projects/[id]/pricing-helper`** — GET 零模型花费（人工模型 > 已推导 >
  即时启发式）+ 价格带 + 输入 + 情景；POST save（输入/人工模型覆盖 source=HUMAN）、
  derive（60s 频控；**人工覆盖不被自动推导覆盖**）。全部落 `room.summaryJson`。
- **`pricing-helper-card.tsx`**（工作台，TenderBenchmarkCard 之下）— 模型摘要（来源徽标
  人工确认/AI 推导·待核/规则抓取·待核）、价格带、三输入、情景表、打平价、假设清单；
  卡片明示「假设驱动 · 不是报价决定」，无 GO/NO-GO。

## 3. 测试证据

- 纯平面 **pricing-helper 13/13**（已注册 test-all + test-ci-unit）：RFQ 算例 / 领先与落后
  两向打平价 / 无解不伪造 / 情景完整与排序 / 无对手价零情景 / 假设显式 / AI 成功与
  回退 / 路由频控与人工覆盖优先 / 卡片禁 GO/NO-GO 反例守卫。
- **真实 E2E 8/8**（隔离生产快照 + 真实模型，`e2e-pricing-helper` 分支已删）：Halifax 真实
  run 19 条评分事实 → 启发式与 LLM 均推出 70% / lowest_over_bid / 三项 10% / 绩效默认 60%
  （LLM 2s 一次调用）；叠加房间真实价格带 $40k–76k → 对手中位 $58,079 时**打平价 $61,599**
  （我方国籍满分领先 4 分 → 可高 6% 仍打平）；模型与输入落库回读一致。
- tsc：tender-pricing 零错（本机 autopilot 两处报错为共享 prisma client 陈旧，与本分支无关）；
  eslint 零新告警。

## 4. 使用与边界

- 工作台打开即见（有已完成分析的 tender 项目）；对手价默认取价格带中位，可改；
  对手国籍/绩效得分率默认未知→60 中性——**若判断现任为美国供应商，把其国籍得分率改 0**
  会显著改变打平价（这是人工判断，系统不代填）。
- 成本来源当前为人工输入；T2 预算基线（flag dark）接入留待财务栈激活后。
- 无新 env / 无 schema / 无 cron；回滚 = revert PR。

## 5. Gate

```
PRICING_SCHEMA_CHANGE  = NONE
PRICING_MATH_PROBES    = 13/13（含 RFQ 自带算例 + 无解不伪造）
PRICING_REAL_E2E       = PASS 8/8（隔离快照 + 真实模型；Halifax 打平价 $61,599）
PRICING_AI_BOUNDARY    = 仅结构化评分规则（AI_INFERRED 标注）；算术纯函数；人工覆盖最高；无 GO/NO-GO
PRICING_ISOLATED_LEFT  = 0
PRICING_STATUS         = READY_FOR_FINAL_REVIEW（Draft PR，不 merge）
```
