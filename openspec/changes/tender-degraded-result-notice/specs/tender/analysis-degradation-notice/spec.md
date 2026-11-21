# Spec Delta

## Purpose

规定招标分析在没有完整跑完时（页面段落没读完、综合解读没生成、AI 复核没跑完、澄清检查没来得及做）记下什么、在分析面板、通知与 Muse 消息里用什么话告诉用户，使降级的分析不会被当成完整的分析。

## ADDED Requirements

### Requirement: 分析结果带一份结构化的降级记录

分析完成时，系统 SHALL 在分析结果里存一份降级记录，包含：没读完的页面段落（文件名与页码范围）、综合解读是否生成及未生成的原因类别、AI 复核是否跑完、没来得及做的澄清检查条数。没有任何降级时这份记录 SHALL 为空。运行详情接口 SHALL 返回这份记录。

#### Scenario: 两段页面三次都没读完
- **WHEN** 一次分析里有两段页面（文件 A 第 5–8 页、文件 B 第 1–4 页）三次尝试都以调用截止结束
- **THEN** 降级记录里「没读完的页面段落」有这两段，各带文件名与页码范围
- **AND** 测试 `npx tsx src/lib/tender-auto-analysis/__tests__/degradation-notice.test.ts` 通过

#### Scenario: 完整跑完
- **WHEN** 一次分析所有段落都读完、综合解读与复核都完成、澄清检查都做了
- **THEN** 降级记录为空

#### Scenario: 旧的分析
- **WHEN** 打开一份本次改动之前完成的分析
- **THEN** 接口返回的降级记录为空，界面不显示降级说明

### Requirement: 分析面板用白话显示每一种降级

降级记录不为空时，分析面板 SHALL 在顶部显示降级说明，每一种降级一句：
- 页面段落没读完：「有 N 段页面 AI 没有读完：〈文件名〉第 x–y 页…；这些页的要求不在下面的结果里，请人工看一遍或重新分析。」
- 综合解读没生成：「这份分析没有 AI 综合解读（模型两次都没在时限内完成）；下面是逐条的要求原文。」
- AI 复核没跑完：「AI 复核这次没有跑完，下面的结论没有经过二次审校。」
- 澄清检查没做完：「有 N 条澄清问题没来得及核对文件里是否已有答案。」

这些句子 SHALL NOT 出现英文错误码，SHALL NOT 使用「窗口」一词。降级记录为空时 SHALL NOT 显示降级说明。

#### Scenario: 页面段落没读完
- **WHEN** 降级记录里有两段没读完的页面
- **THEN** 面板顶部出现「有 2 段页面 AI 没有读完：…」一句，列出两段的文件名与页码
- **AND** 测试 `npx tsx src/lib/tender-auto-analysis/__tests__/degradation-notice.test.ts` 通过

#### Scenario: 句子里没有内部用语
- **WHEN** 生成任何一种降级的句子
- **THEN** 句子不含 `CALL_DEADLINE_EXCEEDED`、`TRANSIENT_MODEL_ERROR` 等英文错误码，也不含「窗口」
- **AND** 测试 `npx tsx src/lib/tender-auto-analysis/__tests__/degradation-notice.test.ts` 通过

### Requirement: 复核没跑完与没通过分开说

AI 复核因模型调用失败或截止而没有跑完时，系统 SHALL 显示「AI 复核这次没有跑完，下面的结论没有经过二次审校。」，SHALL NOT 显示「部分结论未通过 AI 质检」。复核跑完并指出问题时 SHALL 照旧显示「部分结论未通过 AI 质检，需人工重点复核」。

#### Scenario: 复核被截止
- **WHEN** 复核那一遍以调用截止结束
- **THEN** 横幅是「AI 复核这次没有跑完…」，不是「未通过 AI 质检」
- **AND** 测试 `npx tsx src/lib/tender-auto-analysis/__tests__/degradation-notice.test.ts` 通过

#### Scenario: 复核指出问题
- **WHEN** 复核跑完并标出两处问题
- **THEN** 横幅照旧是「部分结论未通过 AI 质检，需人工重点复核（详见 QA 记录 2 条）。」

### Requirement: 没来得及核对的澄清问题带注明

澄清检查因模型调用失败或截止而没有结果的澄清问题，系统 SHALL 在该问题上注明「没来得及核对文件里是否已有答案」。检查做了并判定文件里没有答案的问题 SHALL NOT 带这句注明。

#### Scenario: 一条检查被截止
- **WHEN** 三条澄清问题里有一条的检查以调用截止结束
- **THEN** 只有这一条带「没来得及核对文件里是否已有答案」
- **AND** 测试 `npx tsx src/lib/tender-auto-analysis/__tests__/degradation-notice.test.ts` 通过

### Requirement: 有降级时通知与 Muse 消息不按正常完成来写

分析完成的站内通知与 Muse 消息，在降级记录不为空时 SHALL NOT 使用「可以开始确认招标要求」「分析完成」这两种正常完成的写法，SHALL 写明有降级并请先看说明（例如「〈项目〉分析完成，但有 2 段页面没读完，请先看分析页顶部的说明」），站内通知的优先级 SHALL 为高。这些消息 SHALL NOT 包含文件正文、价格、毛利率或供应商信息，SHALL NOT 包含英文错误码。

#### Scenario: 有段落没读完
- **WHEN** 一次有两段页面没读完的分析完成
- **THEN** 站内通知与 Muse 消息都写明「有 2 段页面没读完」，站内通知优先级为高
- **AND** 测试 `npx tsx src/lib/tender-auto-analysis/__tests__/alerts.test.ts` 通过

#### Scenario: 没有降级
- **WHEN** 一次完整的分析完成
- **THEN** 通知与 Muse 消息的文字与以前相同

### Requirement: 分析面板显示覆盖说明

覆盖清单带有说明（例如「2 个可分析文件尚未纳入本次分析」）时，分析面板 SHALL 在「上传 · 纳入分析 · 排除」那一行下面显示这句说明。解析失败的说明 SHALL 写成「N 个文件解析失败」，不重复「文件」二字。

#### Scenario: 有文件等着重新分析
- **WHEN** 项目上传 6 个文件，当前分析只纳入了 4 个，另外 2 个可以分析但不在这次分析里
- **THEN** 面板上「上传 6 · 纳入分析 4」下面显示「2 个可分析文件尚未纳入本次分析」
- **AND** 测试 `npx tsx src/lib/tender-auto-analysis/__tests__/package-coverage.test.ts` 通过
