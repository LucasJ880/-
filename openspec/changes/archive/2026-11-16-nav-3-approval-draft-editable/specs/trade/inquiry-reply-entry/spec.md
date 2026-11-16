# Spec Delta

## MODIFIED Requirements

### Requirement: 审批面到询盘收件箱的出路
今日询盘与商机详情里每张待批回复草稿卡 SHALL 带一行链接「想改一改再发？去询盘收件箱改这份草稿（发出后这份草稿自动作废）」，指向该商机在询盘收件箱的回复窗口并带上这份草稿的 id。今日询盘上这行链接 SHALL 只在草稿已展开查看时出现。商机详情在没有草稿时 SHALL 显示链接「去询盘收件箱写回复」。这些链接 SHALL 只在询盘收件箱对当前用户放行时出现。商机详情记录来信的输入框占位文字 SHALL 为「把买家在别处发来的内容贴到这里，AI 会重新起草回复」。

#### Scenario: 链接与占位文字
- **WHEN** 运行 `npx tsx src/lib/trade/__tests__/reply-entry.test.ts`
- **THEN** 源码断言通过：两个页面的链接文字、指向与放行条件同本要求；商机详情的占位文字为新文字，不再含 `CUSTOMER_REPLIED` 与 `FDE`

#### Scenario: 链接带草稿 id，今日询盘上先看草稿才出现
- **WHEN** 运行 `npx tsx src/lib/trade/__tests__/approval-draft-edit.test.ts`
- **THEN** 两个页面的链接地址都同时带商机 id 与这份草稿的 id；今日询盘上这行链接位于展开草稿的区块之内；两个页面里不再有旧链接文字「不想用这份？去询盘收件箱自己写」

## ADDED Requirements

### Requirement: 从待批草稿进入时预填这份草稿
询盘收件箱页面的地址同时带商机 id 与待批草稿 id、且这份草稿可用时，回复窗口 SHALL 预填这份草稿的主题与正文，标题为「改草稿再发 · 〈公司〉」，并写明「这是等审批的那份 AI 草稿，改好后点「发送邮件」。发出后那份草稿自动作废，不用再去批准；从这里发出的是普通文本邮件。」。草稿不可用时页面 SHALL 提示「这份待批草稿已经处理过或已失效，可以直接在下面写回复」，回复窗口 SHALL 照常打开、正文为空、主题按来信预填。草稿原定的收件邮箱与这位买家在收件箱里的邮箱不同时，窗口 SHALL 同时写出两个邮箱并说明从这里发送会发给后者。从这个窗口提交的回复 SHALL 声明正文来自 AI 草稿。当前成员不能回复时 SHALL 按「不能回复的成员看不到回复操作」处理：不打开窗口。

#### Scenario: 预填、提示与标记
- **WHEN** 运行 `npx tsx src/lib/trade/__tests__/approval-draft-edit.test.ts`
- **THEN** 源码断言通过：深链读到草稿 id 时把它带给单会话接口；取到草稿时用它的主题与正文打开窗口、提交时声明来自 AI 草稿；没取到时给出上述提示并打开空白窗口；收件邮箱不同的提示以两者不相等为出现条件

#### Scenario: 不带草稿 id 的入口不变
- **WHEN** 运行 `npx tsx src/lib/trade/__tests__/reply-entry.test.ts` 与 `npx tsx src/lib/trade/__tests__/reply-clarity.test.ts`
- **THEN** 两个测试的通过数不低于改动前：从客户时间线、卡片按钮进入的窗口仍按原规则打开

### Requirement: 单会话接口按待批草稿 id 返回草稿原文
`GET /api/trade/inbox/focus` 的请求带 `approvalId` 时，响应 SHALL 带 `approvalDraft`：同时满足「该审批记录属于本企业、类型是询盘回复、状态为待批、未过期、它关联的商机就是这次请求解析到的这位买家的商机、该商机的买家不是入驻测试询盘的测试买家、主题与正文都非空」时，为 `{ pendingActionId, subject, body, to }`；任一条件不满足时为空，SHALL NOT 用不同的响应区分原因。`approvalDraft` SHALL NOT 含 HTML 版、内部元数据或其他字段。请求不带 `approvalId` 时响应 SHALL NOT 带这个字段，其余行为不变。接口 SHALL 保持只读，SHALL NOT 改变审批记录的状态或内容。

#### Scenario: 可用与不可用
- **WHEN** 在隔离库运行 `npx tsx src/lib/trade/__tests__/reply-entry-db.isolated.test.ts`，对一位有待批回复草稿的买家，按商机 id 加这份草稿的 id 请求该接口
- **THEN** `approvalDraft` 的主题、正文、收件邮箱与草稿载荷逐项相等，且只有这四个字段；换成别的企业的草稿 id、另一位买家的草稿 id、已作废的草稿 id、不存在的 id、买家带入驻测试标记的草稿 id，`approvalDraft` 都为空且响应其余部分相同；请求前后审批记录的状态与内容不变

#### Scenario: 判定规则
- **WHEN** 运行 `npx tsx src/lib/trade/__tests__/approval-draft-edit.test.ts`
- **THEN** 七个条件逐一不满足时结果都为空，全部满足时返回四个字段

### Requirement: 改后发出不经过审批执行
从预填了待批草稿的回复窗口发送 SHALL 走既有的询盘收件箱回复接口（成员本人点「发送邮件」或「已在别处发送，标记」），SHALL NOT 批准或执行这份待批草稿，SHALL NOT 把改过的文字写回这份草稿。发出后这份草稿 SHALL 按既有规则由系统作废。本能力 SHALL NOT 新增任何对外发送的路径；打开带草稿 id 的地址、请求单会话接口 SHALL NOT 发送任何邮件或消息，SHALL NOT 调用模型。

#### Scenario: 改后发出，原草稿作废
- **WHEN** 在隔离库运行 `npx tsx src/lib/trade/__tests__/reply-entry-db.isolated.test.ts`，把取到的草稿正文改动后经回复接口提交（声明来自 AI 草稿）
- **THEN** 留底的出站消息正文是改后的文字、「AI 草稿」标记为真；这份待批草稿变为系统作废，载荷里的正文仍是原文；它没有被批准，也没有经审批执行发出

### Requirement: 回复正文上限
询盘收件箱回复接口 SHALL 接受不超过 10000 字的正文（与待批草稿的正文上限一致），超出部分截断。

#### Scenario: 长草稿不被截短
- **WHEN** 在隔离库运行 `npx tsx src/lib/trade/__tests__/reply-entry-db.isolated.test.ts`，提交一段 9500 字的正文
- **THEN** 留底的出站消息正文长度为 9500 字（另加「已在系统外发送」的留底说明）
