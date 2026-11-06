# Design：比价解读数字校验（P1-6G）

## Context

- `/compare/analysis`（`src/app/api/projects/[id]/inquiries/[inquiryId]/compare/analysis/route.ts`）：`loadCompareMatrix` → `buildMatrixInterpretationPrompt` → `createCompletion` → 读出四段解读 → 与代码结论一起返回给 `QuoteAnalysisPanel`。
- 提示词已规定"引用数字必须与矩阵完全一致"，但没有任何代码复核。

## Goals / Non-Goals

- Goals：每个出现在解读里的数字都能追到矩阵；追不到的让人一眼看出来。
- Non-Goals：不改写模型输出的语义；不阻断返回（矩阵与结论本来就可用）；不处理中文数字。

## Decisions

### D1 出处 = 交给 LLM 的那份输入
校验的"允许集合"取自 `buildInterpretationPayload(matrix, ctx)`——与提示词 `userPrompt` 是同一个对象（测试断言 `userPrompt === JSON.stringify(payload, null, 1)`）。数值字段直接收；字符串字段（结论、warnings、blockers、日期、项目名）按同一抽取规则收。这样"代码结论里写过的百分比 / 天数"也可以被引用。
否决：只用矩阵行的数值字段——会把结论里代码算好的"贵 3.4%"误判为编造。

### D2 精度匹配
写法精度决定容差：整数容差 0.5，一位小数 0.05；`万` / `千` / `k` 乘到单位（`1.2万` 容差 500）。因此凑整后与矩阵不一致的（`12,000` vs `12,345.67`）会被标出——与提示词"完全一致"一致。百分比单独成类，不与小数互换；日期 `YYYY-MM-DD` / `YYYY年M月D日` 必须完全一致，`M月D日` 与某个输入日期的月日一致。

### D3 标注而不删除
在可疑数字后面插入「［矩阵中无此数］」，原文保留；`numberCheck.unverified` 列出 `{ field, token }`。面板显示提示条，最多列 5 个。服务端 `console.warn` 记一条（只含 projectId / inquiryId / 可疑数字，不含正文）。
否决：直接删句子——会改变语义且可能删掉正确内容；否决：校验失败返回 502——矩阵与结论仍然有用，不该让整个分析失败。

## Risks / Trade-offs

- 模型写"约 12,000"这类合理近似也会被标出：这是有意的（与规则一致），代价是偶尔多一个提示。
- 中文数字不检查：已在 Out of scope 写明。

## Migration Plan

无数据变更；纯代码，随部署生效；回滚即还原这几个文件。
