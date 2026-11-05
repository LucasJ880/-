## Purpose

项目讨论区与任务评论里的 @ 提及：服务端校验被 @ 的人能否接收，给被 @ 的人发站内提及通知，防止重发同一条内容产生重复通知，并让任务评论框也能 @ 人。

## ADDED Requirements

### Requirement: 提及名单的格式
讨论区发消息接口 `POST /api/projects/{id}/discussion/messages` 与任务评论接口 `POST /api/tasks/{id}/comments` SHALL 接受可选的 `mentions` 数组，每项为 `{ userId }`，可带 `name`（只用于显示）。服务端 SHALL 按 `userId` 去重。以下三种情况 SHALL 返回 400 `{ error, code: "MENTION_INVALID" }`，不创建消息或评论、不发通知：`mentions` 不是数组；某一项没有字符串 `userId`；去重后超过 20 人。讨论区消息不带 `mentions` 或为空数组时，讨论区接口的行为 SHALL 与本次之前相同。

#### Scenario: 同一人出现两次
- **WHEN** 请求的 `mentions` 是 `[{ userId: "A" }, { userId: "A" }]`，A 满足接收条件
- **THEN** 创建成功，A 只收到一条提及通知

#### Scenario: 某一项缺 userId
- **WHEN** 请求的 `mentions` 是 `[{ name: "张三" }]`
- **THEN** 返回 400，`code` 为 `MENTION_INVALID`，没有新消息，也没有通知

#### Scenario: 超过 20 人
- **WHEN** 请求一次 @ 了 21 个不同的人
- **THEN** 返回 400，`code` 为 `MENTION_INVALID`

#### Scenario: 不带 @
- **WHEN** 讨论区消息不带 `mentions`
- **THEN** 返回 201，响应与本次之前相同

#### Scenario: 测试
- **WHEN** 运行 `npx tsx src/lib/notifications/__tests__/collab-mentions.test.ts`
- **THEN** 全部断言通过，退出码 0

### Requirement: 被 @ 的人必须能接收
被 @ 的每个人 SHALL 同时满足三个条件：
- 账号在职；
- 对象属于某个组织时，是该组织的 active 成员；
- 能看到对象：讨论区按查看该项目讨论区的规则判断，任务按查看该任务详情的规则判断。

任一人不满足时，接口 SHALL 返回 400 `{ error, code: "MENTION_NOT_ALLOWED", invalidUserIds }`，不创建消息或评论，也不发任何通知；SHALL NOT 悄悄去掉不满足的人后照常发送。@ 自己视为满足。错误信息 SHALL NOT 含不满足者的姓名或邮箱。

#### Scenario: 讨论区 @ 非项目成员
- **WHEN** 在项目讨论区 @ 一个既不是项目成员、也不是该组织管理员的同组织员工
- **THEN** 返回 400，`code` 为 `MENTION_NOT_ALLOWED`，`invalidUserIds` 含此人；讨论区没有新消息，没有任何通知

#### Scenario: @ 已离开组织的人
- **WHEN** 被 @ 的人仍是 active 项目成员，但在该组织的成员状态已是 inactive
- **THEN** 返回 400，`code` 为 `MENTION_NOT_ALLOWED`

#### Scenario: @ 停用账号
- **WHEN** 被 @ 的人账号状态不是在职
- **THEN** 返回 400，`code` 为 `MENTION_NOT_ALLOWED`

#### Scenario: 任务评论 @ 看不到任务的人
- **WHEN** 在没有项目的任务下 @ 一个既不是创建人、也不是负责人的同事
- **THEN** 返回 400，`code` 为 `MENTION_NOT_ALLOWED`，没有新评论

#### Scenario: @ 自己
- **WHEN** 发送人在消息里 @ 自己
- **THEN** 创建成功，发送人不收到提及通知

### Requirement: 被 @ 的人收到提及通知
消息或评论创建成功后，系统 SHALL 给每个被 @ 的人写一条站内通知（发送人自己除外），字段如下：
- 类型 `mention`，优先级 `high`，组织为对象所属组织；
- 讨论区消息：`entityType = project_discussion`，`entityId` 为消息 id，`projectId` 为项目 id；
- 任务评论：`entityType = task`，`entityId` 为任务 id，任务属于项目时带 `projectId`。

去重键 SHALL 为 `mention:<消息或评论 id>:<被 @ 人 id>`。提及通知还 SHALL 遵守 `notifications/activity-events` 的通用规则：收件人范围、投递门禁、失败隔离、脱敏。

#### Scenario: 任务评论里 @ 人
- **WHEN** B 在任务评论里 @A，A 能看到该任务
- **THEN** A 收到一条 `mention` 通知，`entityType` 为 `task`；点开打开的是这个任务

#### Scenario: 讨论区里 @ 人
- **WHEN** B 在项目讨论区 @A
- **THEN** A 收到一条 `mention` 通知，`entityType` 为 `project_discussion`，`entityId` 为这条消息的 id

### Requirement: 提及通知的标题与摘要
提及通知的标题 SHALL 为以下之一：
- 讨论区：`{发送人} 在项目「{项目名}」讨论区 @ 了你`
- 任务评论：`{评论人} 在任务「{任务标题}」的评论里 @ 了你`

摘要 SHALL 为正文去掉首尾空白后的前 80 个字符，并按 `notifications/activity-events` 的规则脱敏。

#### Scenario: 长正文截断
- **WHEN** 正文有 120 个字符且不含敏感内容
- **THEN** 摘要是正文的前 80 个字符

#### Scenario: 正文含电话
- **WHEN** 正文是"@张三 客户电话 416-555-0199 记得回"
- **THEN** 摘要是"（含敏感信息，请在青砚查看）"

### Requirement: 10 分钟内重发不产生新记录
两种情况视为重发：
- 同一人 10 分钟内向同一项目讨论区再发一条正文相同、@ 名单相同、且带 @ 的消息；
- 同一人 10 分钟内向同一任务再发一条正文相同的评论（带不带 @ 都算）。

重发时接口 SHALL 返回第一次创建的那条：HTTP 200，响应体与创建时同形，并带 `replayed: true`；SHALL NOT 新建消息、评论或活动记录，也 SHALL NOT 产生新通知。正文比较前先去掉首尾空白。两个相同请求同时到达时，SHALL 只创建一条。不带 @ 的讨论区消息不做重发判断。

#### Scenario: 重放一条带 @ 的任务评论
- **WHEN** B 发出"@A 明早复尺"的任务评论后，同一请求原样再发一次
- **THEN** 第二次返回 200，`replayed` 为 true，`id` 与第一次相同；任务下只有一条该评论，A 只有一条提及通知

#### Scenario: 超过 10 分钟
- **WHEN** 同一人 11 分钟后再发同样的任务评论
- **THEN** 新建一条评论（201）

#### Scenario: 讨论区不带 @ 的相同消息
- **WHEN** 同一人 1 分钟内在同一讨论区发了两次"收到"，都不带 @
- **THEN** 两条都创建（201）

#### Scenario: 并发的相同请求
- **WHEN** 两个完全相同、带 @ 的讨论区请求同时到达
- **THEN** 只创建一条消息；一个请求返回 201，另一个返回 200 且 `replayed` 为 true

### Requirement: 任务评论记下 @ 名单
带 @ 的任务评论创建成功时，系统 SHALL 写一条任务活动记录：`action = comment.mentioned`，`detail` 为 JSON 字符串 `{"commentId":"<评论 id>","userIds":["<被 @ 人 id>", …]}`，`userIds` 为去重后的 @ 名单。原有的 `comment` 活动记录 SHALL 照常写。系统 SHALL NOT 为此新增字段。

#### Scenario: 活动记录
- **WHEN** B 发表一条 @A、@C 的任务评论
- **THEN** `GET /api/tasks/{id}/activities` 里多出一条 `comment.mentioned`，其 `detail` 解析后 `commentId` 为该评论 id，`userIds` 为 A 与 C

### Requirement: 评论人必须能看到任务
`POST /api/tasks/{id}/comments` SHALL 只允许能查看该任务详情的人发表评论。任务不存在或调用人看不到时，SHALL 返回 404 `{ error: "任务不存在" }`，不创建评论、活动记录或通知。

#### Scenario: 看不到任务的人发评论
- **WHEN** 一个已登录、但看不到某个无项目任务的用户向它发评论
- **THEN** 返回 404，任务下没有新评论

#### Scenario: 负责人发评论
- **WHEN** 任务负责人发评论
- **THEN** 返回 201

### Requirement: 讨论区消息保存的提及名单
讨论区消息创建成功时，消息的 `metadata.mentions` SHALL 是去重后的被 @ 名单，每项只含 `userId` 与 `name`：
- 请求里带了字符串 `name` 时用它，超过 50 个字符截断；
- 没带时用该账号的姓名。

请求中每一项的其他字段 SHALL NOT 存入。

#### Scenario: 多余字段不保存
- **WHEN** 请求的一项是 `{ userId: "A", name: "张三", role: "x" }`
- **THEN** 返回的消息 `metadata.mentions` 为 `[{ userId: "A", name: "张三" }]`

### Requirement: 任务评论 @ 的候选人接口
系统 SHALL 提供 `GET /api/tasks/{id}/mention-candidates`，只对能查看该任务详情的人开放，否则返回 404。返回 `{ members: [{ userId, name, avatar }] }`，不含调用人自己，按姓名排序，最多 200 人：
- 任务属于项目、且项目属于某个组织时：该组织中满足「被 @ 的人必须能接收」三个条件的人；
- 任务没有项目，或项目不属于任何组织时：任务的创建人与负责人中满足条件的人。

#### Scenario: 项目任务的候选人
- **WHEN** 已派发项目下的任务，所属组织有 5 名在职 active 成员，调用人是其中之一
- **THEN** 返回另外 4 人

#### Scenario: 看不到任务
- **WHEN** 调用人看不到该任务
- **THEN** 返回 404

### Requirement: 任务评论框支持 @
任务详情抽屉的评论框 SHALL 支持 @：
- 在行首或空白后输入 `@`，弹出候选列表；候选来自候选人接口，按姓名包含关系过滤。
- 上下键移动选择，回车或 Tab 选中，Esc 关闭；选中后在光标处插入 `@姓名 `。
- 候选列表打开时，回车 SHALL 选中候选，不发送评论。
- 发送时 SHALL 只提交正文里仍出现 `@姓名` 的人。
- 接口返回 4xx 时，SHALL 在评论框下方显示返回的错误信息，并保留草稿。

#### Scenario: 选中候选
- **WHEN** 在评论框输入"请 @张"，候选列表里有"张三"，按回车
- **THEN** 正文变为"请 @张三 "，评论没有发出

#### Scenario: 删掉 @ 后发送
- **WHEN** 选中张三后又删掉了正文里的"@张三"，然后发送
- **THEN** 请求不带张三

#### Scenario: 测试
- **WHEN** 运行 `npx tsx src/lib/notifications/__tests__/collab-mention-input.test.ts`
- **THEN** 触发、过滤、插入、发送名单的断言全部通过，评论框接线的源码断言通过，退出码 0

### Requirement: 成员卡片的头像 @ 只对 active 成员
项目工作台成员卡片上，点头像在讨论区插入 @ 的操作 SHALL 只对 active 项目成员提供，非 active 成员 SHALL NOT 被插入讨论区草稿。

#### Scenario: 非 active 成员
- **WHEN** 项目成员中有一人状态为 inactive
- **THEN** 他的头像不提供 @ 操作，讨论区草稿里不会出现他
