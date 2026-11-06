# Proposal：比价解读数字校验（P1-6G）

TASKFLOW：P1-6G（Phase 1 询价 + 比价，P1-6 的遗留修补；来源 `docs/QINGYAN_TENDER_P1-5-6_REPORT.md` 遗留项"/compare/analysis 的 LLM 解读仍可能写出矩阵外的数字……没有做数字校验"）。

## Why

`/compare/analysis` 先用代码算落地价比价矩阵，再让 LLM 写四段中文解读（价格、交期、风险、建议）。提示词要求"不得计算、换算或给出矩阵里没有的任何数字"，但模型仍可能自己算差额、编目标价或写错日期，而这些数字会和代码算的矩阵并排显示在报价分析面板上，员工很难分辨哪个可信。比价结果直接影响选哪家供应商和我方报价，错数字的代价高。

## What Changes

- 新增纯函数 `src/lib/tender-rfq/interpretation-guard.ts`：从解读文字里取出金额 / 数量 / 百分比 / 日期，逐个到"交给 LLM 的那份输入"里找出处；按写法精度比较（`12,346` 对得上 `12,345.67`，`1.2万` 允许 ±500），百分比只与百分比比，日期必须完全一致。
- `compare.ts` 拆出 `buildInterpretationPayload`：提示词与校验用同一份数据，避免两边口径不一致。
- `/compare/analysis` 返回前校验：找不到出处的数字就地标注「［矩阵中无此数］」（原文保留），响应新增 `numberCheck: { ok, unverified[] }`，并记一条服务端警告日志。
- 报价分析面板在 `numberCheck.ok=false` 时显示提示条："AI 解读里有 N 个数字在比价矩阵中找不到……金额与结论以上方矩阵为准。"
- 矩阵、一句话结论、推荐供应商不变（仍只来自代码）；不新增 LLM 调用、不改提示词规则、不改 Muse 侧 compare / price_scenario。

## Capabilities

### New Capabilities
- `tender/rfq-compare`：比价解读的数字出处校验与标注。

### Modified Capabilities
- 无。

受影响的 Muse 意图：无（Muse 的 `compare` 回复用代码拼的结论，不含 LLM 解读）。

## Impact

- 新增：`src/lib/tender-rfq/interpretation-guard.ts`、`src/lib/tender-rfq/__tests__/interpretation-guard.test.ts`。
- 修改：`src/lib/tender-rfq/compare.ts`（拆出 payload，提示词内容不变）、`src/app/api/projects/[id]/inquiries/[inquiryId]/compare/analysis/route.ts`、`src/components/inquiry/quote-analysis-panel.tsx`、`scripts/test-all.sh`、`scripts/test-ci-unit.sh`。
- 硬纪律：零 schema、零出站、不新增 LLM 调用（只在已有调用之后加确定性校验）、无新队列；全部遵守。

## Out of scope

- 不自动删除或改写可疑句子（只标注，原文保留，避免改变语义）。
- 不检查中文数字（"三家"）与比较类措辞（"更便宜"）。
- 不改 Muse 回复、价格情景与报价引擎。
