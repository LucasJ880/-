# Spec Delta

## MODIFIED Requirements

### Requirement: 每张会话卡片都有回复按钮
对能回复的成员（见「回复能力标记」），询盘收件箱的每张会话卡片 SHALL 有回复按钮，SHALL NOT 以 AI 草稿存在为前提：未回复且有 AI 草稿时为「查看回复草稿」；未回复且草稿在生成中、生成失败或没有时为「写回复」；已回复时为「再写一封」。「写回复」与「再写一封」SHALL 打开回复窗口，正文为空，主题预填 `Re: ` 加最后一封来信的主题（来信没有主题时主题留空；主题本身以 `Re:` 开头时不重复加）。不能回复的成员看到什么，见「不能回复的成员看不到回复操作」。

#### Scenario: 按钮不依赖草稿
- **WHEN** 运行 `npx tsx src/lib/trade/__tests__/reply-entry.test.ts`
- **THEN** 源码断言通过：页面在没有 AI 草稿时渲染「写回复」，已回复时渲染「再写一封」，回复窗口的打开不再要求会话带 AI 草稿

#### Scenario: 主题预填
- **WHEN** 运行同一测试
- **THEN** 来信主题为 `Bedding inquiry` 时预填 `Re: Bedding inquiry`；为 `RE: Bedding inquiry` 时原样使用；为空时预填为空

## ADDED Requirements

### Requirement: 「我方已回复」的说法
询盘收件箱里，已由我方回复的会话卡片上的状态文字 SHALL 为「我方已回复」，SHALL NOT 单独显示「已回复」。同一张卡片上「买家来信了」与「我方回复了」两件事 SHALL NOT 用同一个词。

#### Scenario: 卡片上的两种说法
- **WHEN** 运行 `npx tsx src/lib/trade/__tests__/reply-clarity.test.ts`
- **THEN** 源码断言通过：会话已回复时卡片下方的状态文字是「我方已回复」；卡片上买家名字旁的阶段标签取自线索阶段的显示名

### Requirement: 回复能力标记
`GET /api/trade/inbox` 与 `GET /api/trade/inbox/focus` 的响应 SHALL 在 `capabilities` 里带布尔字段 `reply`：当前成员在该企业持 `trade.manage`、或是平台 super_admin 时为真，否则为假。两个接口的读权限（`trade.read` 或 `trade.manage`）、其余返回字段与只读性质 SHALL NOT 改变。回复接口 `POST /api/trade/inbox/[prospectId]/reply` SHALL 继续要求 `trade.manage`，SHALL NOT 以这个标记代替服务端校验。

#### Scenario: 能回复与只能查看的成员
- **WHEN** 在隔离库运行 `npx tsx src/lib/trade/__tests__/reply-entry-db.isolated.test.ts`，分别由持 `trade.manage` 的成员与只持 `trade.read` 的成员请求这两个接口
- **THEN** 前者得到 `capabilities.reply` 为真，后者为假；两人拿到的会话列表与单个会话内容相同；后者请求回复接口仍得到 403

### Requirement: 不能回复的成员看不到回复操作
`capabilities.reply` 为假时，询盘收件箱 SHALL NOT 显示「写回复」「再写一封」「已回复，标记」。有 AI 草稿的会话 SHALL 仍可点「查看回复草稿」打开窗口，窗口内主题与正文 SHALL 只读，SHALL NOT 出现「发送邮件」与「已在别处发送，标记」，并 SHALL 显示「你的岗位只能查看询盘，不能回复」。地址带线索 id 或商机 id 进入时，页面 SHALL NOT 打开空白的回复窗口，SHALL 提示「你的岗位只能查看询盘，不能回复」并照常显示列表。

#### Scenario: 只读成员的页面
- **WHEN** 运行 `npx tsx src/lib/trade/__tests__/reply-clarity.test.ts`
- **THEN** 源码断言通过：「写回复」「再写一封」「已回复，标记」三个按钮、回复窗口里的「发送邮件」「已在别处发送，标记」都以回复能力为真为出现条件；能力为假时深链分支给出上述提示而不打开窗口

#### Scenario: 能回复的成员不受影响
- **WHEN** 运行 `npx tsx src/lib/trade/__tests__/reply-entry.test.ts` 与 `npx tsx src/lib/navigation/__tests__/entry-visibility.test.ts`
- **THEN** 两个测试的通过数不低于改动前；使用说明「我想做什么」里引用的按钮名称仍都能在询盘收件箱页面源码里找到
