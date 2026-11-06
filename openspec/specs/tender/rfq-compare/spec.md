# tender/rfq-compare Specification

## Purpose
招标询价比价的 AI 解读：规定解读里的数字必须能追溯到代码算出的比价矩阵，找不到出处的数字如何标注与提示；矩阵、结论与推荐只来自代码。

## Requirements

### Requirement: 解读数字必须有矩阵出处
`/compare/analysis` 返回 AI 解读前，系统 SHALL 用确定性代码检查四段解读（价格、交期、风险、建议）里出现的每个金额、数量、百分比与日期，并以交给 LLM 的同一份输入（比价矩阵行、代码结论、推荐、项目、轮次、截标日）为唯一出处：普通数字按写法精度比较（含千分位与 万 / 千 / k 单位），百分比只与输入里的百分比比较，日期必须与输入里的日期完全一致（月日写法比较月与日）。系统 SHALL NOT 为此新增 LLM 调用，SHALL NOT 改变矩阵、一句话结论与推荐供应商。

#### Scenario: 引用矩阵数字通过
- **WHEN** 解读只引用矩阵里的落地价、交期天数、有效期与截标日
- **THEN** `numberCheck.ok` 为 true，正文不加任何标注；`npx tsx src/lib/tender-rfq/__tests__/interpretation-guard.test.ts` 覆盖

#### Scenario: 自己算的差额与编造的目标价
- **WHEN** 解读写了矩阵里没有的差额（如"贵 3,217 CAD"）、日期（"2026-12-02 到货"）、百分比（"上升 4%"）或目标价（"压价到 59,000"）
- **THEN** 这些数字逐个列入 `numberCheck.unverified`（含字段名），`numberCheck.ok` 为 false；同一测试覆盖

#### Scenario: 凑整也算不一致
- **WHEN** 矩阵落地价为 12,345.67，解读写"约 12,000"
- **THEN** 判为找不到出处；写"12,346"或"1.2万"判为一致；同一测试覆盖

### Requirement: 可疑数字的标注与提示
找不到出处的数字 SHALL 在原文中就地标注「［矩阵中无此数］」，原文其余内容 SHALL 保持不变；响应 SHALL 附 `numberCheck: { ok, unverified: [{ field, token }] }`；服务端 SHALL 记录一条只含项目、询价轮次与可疑数字的警告日志。报价分析面板在 `numberCheck.ok` 为 false 时 SHALL 显示提示："AI 解读里有 N 个数字在比价矩阵中找不到……金额与结论以上方矩阵为准"，最多列出 5 个数字。校验不通过 SHALL NOT 让整个分析失败。

#### Scenario: 就地标注
- **WHEN** 解读为"比乙公司贵 3,217 CAD"
- **THEN** 返回"比乙公司贵 3,217［矩阵中无此数］ CAD"，有出处的落地价不加标注；同一测试覆盖
