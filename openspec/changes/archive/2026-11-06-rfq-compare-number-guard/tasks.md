# Tasks

每条带测试与验证命令；结果写进报告。

## 1. 校验核

- [x] 1.1 先写 `src/lib/tender-rfq/__tests__/interpretation-guard.test.ts`（取数：千分位 / 万 / k / 百分比 / ISO 与中文日期 / 月日、字母后的数字不取；精度：12,346 与 1.2万 对得上 12,345.67、12,000 对不上、百分比不与小数互换、日期完全一致；真实矩阵：引用矩阵数字全过、自算差额 / 矩阵外日期 / 百分比 / 编造目标价逐个标出、就地标注且原文保留、提示词输入与校验 payload 为同一份），注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`；新增 `src/lib/tender-rfq/interpretation-guard.ts`，`compare.ts` 拆出 `buildInterpretationPayload`（提示词文字不变）；verify：该测试全过，`npx tsx src/lib/tender-rfq/__tests__/compare.test.ts` 仍全过，`bash scripts/check-test-registry.sh` 通过

## 2. 接口与面板

- [x] 2.1 `/compare/analysis` 返回前校验：解读正文换成标注版，响应加 `numberCheck`，不通过时 `console.warn`（不含正文）；`QuoteAnalysisPanel` 在 `numberCheck.ok=false` 时显示提示条（最多列 5 个数字）；verify：`npm run typecheck` 与 `npm run lint:baseline` 通过

## 3. 收尾

- [x] 3.1 门禁：`bash scripts/check-test-registry.sh`、`npm run typecheck`、`npm run lint:baseline`、`openspec validate rfq-compare-number-guard --strict`，以及 tender-rfq 全部纯测试；verify：全部通过，真实输出写进报告
- [x] 3.2 写 `docs/QINGYAN_P1-6G_REPORT.md` + TASKFLOW 新增 P1-6G 行（状态 `[G]`）；verify：报告存在，`grep -n 'P1-6G' docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 显示该行

## Workflow follow-up

- 一个 change = 一个 PR；不自动合并；合并后 `/opsx:archive rfq-compare-number-guard --yes`（独立小 PR）。
