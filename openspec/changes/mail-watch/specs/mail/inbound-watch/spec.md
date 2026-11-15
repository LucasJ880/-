# Spec Delta

## Purpose

按成员本人的勾选观察其 Gmail 收件箱的新来信，把已建档客户的来信记到客户时间线并提醒邮箱主人：三道开关、增量读取与游标、确定性归类、账本与幂等、通知与推送、缺权限提醒，以及设置页与客户详情页的入口。只取元数据，不读、不存、不推送邮件正文。

## ADDED Requirements

### Requirement: 三道开关都开才读某个邮箱
系统 SHALL 只在三项同时成立时读取某位成员的邮箱：平台开关 `MAIL_WATCH_ENABLED` 已开；该成员所在组织的来信提醒开关已开；该成员本人已勾选「客户来信提醒」且是该组织的在职成员。三项缺省都为关 / 未勾选。任一项不成立 SHALL NOT 对该邮箱发起任何 Gmail 请求。

#### Scenario: 真值表
- **WHEN** 运行 `npx tsx src/lib/mail-watch/__tests__/mail-watch-pure.test.ts`，对三项开关的 8 种组合计算某个邮箱是否参与本轮
- **THEN** 只有三项全开的一种组合参与

#### Scenario: 成员离职或被停用
- **WHEN** 运行 `npx tsx src/lib/mail-watch/__tests__/mail-watch-db.isolated.test.ts`，一位已勾选的成员在组织里被停用
- **THEN** 下一轮不读他的邮箱，Gmail 假实现对该邮箱的调用次数为 0

### Requirement: 组织开关由企业管理员读取与保存
`GET /api/organizations/[orgId]/mail-watch-settings` SHALL 返回该组织的来信提醒开关与已勾选的成员数；`PUT` SHALL 只接受 `{ enabled: boolean }`（多一个字段或类型不对返回 400）。两个方法都只对持有销售设置管理权限（`sales.settings.manage`，与日历观察设置同一口径；平台 super_admin 视为持有）的成员开放，其他人返回 403。保存 SHALL 写一条审计 `mail.watch.settings`（保存前后的开关值）。平台开关关闭时两个方法都返回 404。保存 SHALL NOT 改动任何成员的勾选与游标。

#### Scenario: 销售不能开组织开关
- **WHEN** 同一隔离库测试以 `sales_rep` 身份 `PUT { enabled: true }`
- **THEN** 返回 403，设置未变

#### Scenario: 管理员保存
- **WHEN** 同一测试以老板岗位（持销售设置管理权限）的身份 `PUT { enabled: true }`
- **THEN** 返回 200，再次 `GET` 为开，审计里有一条 `mail.watch.settings`，已有成员的勾选与游标原样保留

### Requirement: 成员只能勾选自己的邮箱
`GET /api/sales/mail-watch/opt-in` SHALL 返回当前登录成员在当前组织的勾选状态、组织开关状态与本人邮箱的读信权限状态；`PUT` SHALL 只接受 `{ optedIn: boolean }` 并只改当前登录成员本人的勾选，请求体里的其它字段（含他人的用户标识）SHALL 被忽略。只有邮箱绑定页对其放行的成员可以调用，否则 403。取消勾选 SHALL 同时删除本人的游标。

#### Scenario: 不能替别人勾选
- **WHEN** 同一隔离库测试中 Lynn `PUT { optedIn: true, userId: <老板的 id> }`
- **THEN** 只有 Lynn 自己被勾选，老板的状态不变

#### Scenario: 取消勾选删游标
- **WHEN** 同一测试中 Lynn 已有游标，`PUT { optedIn: false }`
- **THEN** 设置里不再有 Lynn 的条目；下一轮不读她的邮箱；之后重新勾选从新的起点开始、不补发期间的来信

#### Scenario: 邮箱绑定页不放行的人
- **WHEN** 同一测试以安装工身份调用
- **THEN** 返回 403

### Requirement: 只读本人邮箱且只取元数据
来信观察 SHALL 只用被观察成员本人绑定的 Gmail 授权读取其收件箱，SHALL NOT 读取组织设置里的授权邮箱（`mailboxEmail`）。每封信 SHALL 只取发件人、主题、日期、标签、线程与 `Message-ID`；SHALL NOT 读取、保存或推送邮件正文与附件；SHALL NOT 对邮箱做任何改动（不标已读、不归档、不打标签、不删除、不发送）。

#### Scenario: 只调用读接口且只取元数据
- **WHEN** 运行 `npx tsx src/lib/mail-watch/__tests__/mail-watch-db.isolated.test.ts`，记录一轮运行期间 Gmail 假实现被调用的接口与参数
- **THEN** 只有历史增量、线程成员列表与邮件元数据三类读取；邮件读取的格式都是元数据；没有附件、修改、发送、草稿接口的调用

#### Scenario: 正文不出现在任何产物里
- **WHEN** 同一测试处理一封带正文的客户来信后，把正文在账本、客户互动、通知与微信推送文案里逐一查找
- **THEN** 都找不到

#### Scenario: 不碰组织授权邮箱
- **WHEN** 运行 `npx tsx src/lib/mail-watch/__tests__/mail-watch-pure.test.ts`，对来信观察模块的源码做断言
- **THEN** 其中没有对 `mailboxEmail` 的引用

### Requirement: 首次不回溯并按游标增量读取
某个邮箱没有游标时，系统 SHALL 只记下当前位置作为起点，SHALL NOT 处理此前已在收件箱里的邮件。有游标时 SHALL 只读取游标之后新到的邮件。游标 SHALL 只前进到已处理完的位置。Gmail 报告游标已过期时 SHALL 重建起点、不回溯，并写一条 `mail.watch.cursor_reset`。写回游标前 SHALL 重新确认该成员仍处于勾选状态，否则不写。

#### Scenario: 首次勾选
- **WHEN** 运行 `npx tsx src/lib/mail-watch/__tests__/mail-watch-db.isolated.test.ts`，Lynn 首次勾选时收件箱里已有一封已建档客户的旧信
- **THEN** 第一轮不产生通知、互动与来信账本，只保存起点；之后新到的信在下一轮被处理

#### Scenario: 游标过期
- **WHEN** 同一测试中 Gmail 假实现对历史增量返回 404
- **THEN** 本轮写一条 `mail.watch.cursor_reset`、保存新的起点，不产生通知与互动

#### Scenario: 运行途中取消勾选
- **WHEN** 同一测试中某一轮读完增量之后、写回游标之前 Lynn 取消了勾选
- **THEN** 游标没有被写回，设置里没有 Lynn 的条目

### Requirement: 在既有定时任务中运行
来信观察 SHALL 作为既有 `sales-actions` 定时任务里的一个步骤 `mail-watch` 运行，排在日历观察之后；SHALL NOT 新增定时任务、队列或认领机制。平台开关关闭、或没有任何邮箱满足三道开关时，该步骤 SHALL 记为跳过并写明原因。超过本步骤的截止时刻后 SHALL NOT 开始读新的邮箱。该步骤出错 SHALL NOT 影响同一任务里其它步骤的结果与响应。

#### Scenario: 开关关闭
- **WHEN** 运行 `npx tsx src/lib/mail-watch/__tests__/mail-watch-db.isolated.test.ts`，平台开关关闭时执行来信观察
- **THEN** 结果为跳过、原因为平台开关未开，Gmail 假实现调用次数为 0

#### Scenario: 定时任务配置未变
- **WHEN** 在仓库根运行 `git diff --stat main -- vercel.json`
- **THEN** 输出为空

#### Scenario: 截止时刻
- **WHEN** 同一隔离库测试以已过期的截止时刻执行，有两个满足条件的邮箱
- **THEN** 两个邮箱都没有被读取，结果里写明因截止而未处理的邮箱数

### Requirement: 每轮上限与单封失败
每轮每个邮箱 SHALL 至多处理 50 封新到的邮件，其余 SHALL 留到下一轮继续，不丢失。处理单封邮件出错时 SHALL 写一条 `mail.watch.failed`（Gmail 邮件 id 与错误类别，不含主题与发件人）、继续处理后面的邮件，SHALL NOT 重试该封。

#### Scenario: 超过 50 封
- **WHEN** 运行 `npx tsx src/lib/mail-watch/__tests__/mail-watch-db.isolated.test.ts`，一轮之间某邮箱新到 70 封客户来信
- **THEN** 第一轮处理 50 封，第二轮处理其余 20 封，共 70 条通知，没有重复也没有遗漏

#### Scenario: 一封出错
- **WHEN** 同一测试中 3 封新信里第 2 封读取元数据时出错
- **THEN** 第 1、3 封正常处理，第 2 封有一条 `mail.watch.failed`，下一轮不再处理第 2 封

### Requirement: 不属于客户来信的邮件被跳过
系统 SHALL 跳过以下邮件且不提醒、不写客户：不在收件箱的；带已发送、垃圾邮件、已删除标签的；属于促销、社交、论坛分类的；发件地址就是邮箱主人本人的；所在线程属于本组织在途询价的（由既有询价回信入站处理）。

#### Scenario: 跳过标签表
- **WHEN** 运行 `npx tsx src/lib/mail-watch/__tests__/mail-watch-pure.test.ts`，对各标签组合判定
- **THEN** 只有「在收件箱且不带上述任何标签」的邮件进入归类

#### Scenario: 在途询价的供应商回信
- **WHEN** 运行 `npx tsx src/lib/mail-watch/__tests__/mail-watch-db.isolated.test.ts`，一封线程属于在途询价的回信进了已勾选的邮箱，且发件地址恰好也是某位客户的邮箱
- **THEN** 没有 `mail_inbound` 通知、没有客户互动，本轮汇总里记为跳过

### Requirement: 来信按确定性规则归类
对未被跳过的邮件，系统 SHALL 按固定顺序查表归类、先中先得，SHALL NOT 调用任何模型：（1）发件地址等于本组织某个未归档客户档案的邮箱 →「客户来信」；（2）同一线程里有青砚发出过的邮件（客户互动记录里记着它的邮件 id）→「客户回信」；（3）其余 →「未匹配」。归类 SHALL NOT 依据收件地址：发到公共地址再进入个人邮箱的信按同样规则处理。

#### Scenario: 归类表
- **WHEN** 运行 `npx tsx src/lib/mail-watch/__tests__/mail-watch-pure.test.ts`，对「发件地址命中客户」「线程命中已发邮件」「都不命中」及其组合归类
- **THEN** 结果依次为客户来信、客户回信、未匹配；两条都命中时取规则 1

#### Scenario: 客户用另一个地址回复报价邮件
- **WHEN** 运行 `npx tsx src/lib/mail-watch/__tests__/mail-watch-db.isolated.test.ts`，客户用档案之外的邮箱回复了青砚发出的报价邮件
- **THEN** 按规则 2 命中该客户，产生通知与互动

#### Scenario: 发到公共地址的信
- **WHEN** 同一测试中一封收件人为 `sales@` 的客户来信进了 Lucas 的邮箱
- **THEN** 与直接发给 Lucas 的信同样处理

#### Scenario: 发件人显示名不参与匹配
- **WHEN** 同一纯函数测试中发件人显示名写成某位客户的名字、地址却不是该客户的
- **THEN** 归为未匹配

### Requirement: 客户对邮箱主人可见才算命中
规则 1 与规则 2 命中的客户 SHALL 属于邮箱主人所在的组织且对邮箱主人可见（与销售只读工具同一可见性判定，按邮箱主人在该组织的岗位派生角色计算）。不可见的客户 SHALL 视同未命中：不提醒、不写客户，归「未匹配」。同一地址对应多个可见客户时 SHALL 取邮箱主人自己建档的那个，没有则取最早建档的那个。

#### Scenario: 别的销售的客户
- **WHEN** 运行 `npx tsx src/lib/mail-watch/__tests__/mail-watch-db.isolated.test.ts`，另一位销售名下、Lynn 看不到的客户给 Lynn 发信
- **THEN** 没有通知、没有互动，本轮汇总里记为未匹配

#### Scenario: 老板的邮箱
- **WHEN** 同一测试中同一位客户给已勾选的老板发信
- **THEN** 老板收到通知，客户时间线多一条入站互动

### Requirement: 命中的来信记账本并以邮件 id 幂等
每封命中的来信 SHALL 写一条账本 `mail.watch.observed`，内容只有 Gmail 邮件 id、线程 id、发件地址、主题（至多 120 字）、客户 id 与命中规则。同一个邮箱里的同一封邮件（Gmail 邮件 id 只在一个邮箱内唯一，按邮箱主人加邮件 id 认）SHALL 只处理一次：重放、中断后重跑 SHALL NOT 产生第二条账本、互动或通知；两轮运行重叠时每位收件人仍 SHALL 至多一条通知。账本 SHALL NOT 含邮件正文。

#### Scenario: 重放
- **WHEN** 运行 `npx tsx src/lib/mail-watch/__tests__/mail-watch-db.isolated.test.ts`，把同一批来信用旧游标再处理一遍
- **THEN** 账本、客户互动、通知的条数都不变，微信推送次数不变

#### Scenario: 建好通知后中断
- **WHEN** 同一测试中某封信的通知已建好、账本还没写时运行中断，下一轮重跑
- **THEN** 不新增通知与互动，补写账本，不再推微信

#### Scenario: 两个邮箱里邮件 id 相同的两封信
- **WHEN** 同一测试中老板的邮箱里出现一封与 Lynn 邮箱里某封已处理的信邮件 id 相同、内容不同的客户来信
- **THEN** 它不被当成已处理，老板照常收到通知

#### Scenario: 主题截断
- **WHEN** 运行 `npx tsx src/lib/mail-watch/__tests__/mail-watch-pure.test.ts`，主题长 300 字且含换行与控制字符
- **THEN** 账本里的主题为 120 字以内的单行文本

### Requirement: 未匹配与跳过的邮件只计数
未匹配与被跳过的邮件 SHALL NOT 逐封留痕：系统 SHALL NOT 保存它们的发件人、主题或邮件 id。每轮每个被读取的邮箱 SHALL 写一条汇总 `mail.watch.run`，内容为本轮读到的封数与客户来信、客户回信、未匹配、跳过、失败各自的数量。

#### Scenario: 供应商与促销邮件
- **WHEN** 运行 `npx tsx src/lib/mail-watch/__tests__/mail-watch-db.isolated.test.ts`，一轮里有 1 封客户来信、2 封供应商来信、1 封促销邮件
- **THEN** 汇总为客户来信 1、未匹配 2、跳过 1；把两封供应商来信的发件地址与主题在全部审计里查找，都找不到

### Requirement: 命中的来信写入客户时间线
每封命中的来信 SHALL 在该客户的时间线上建一条互动：类型与渠道为邮件、方向为收到、标题为固定文字「客户来信（邮件）」、内容为「主题：」加主题、记录人为邮箱主人、带 Gmail 邮件 id。该互动 SHALL NOT 挂到任何商机，SHALL NOT 含邮件正文，SHALL NOT 进入销售知识库的分析与索引。同一封信（同一 `Message-ID`）进入本组织两个已勾选的邮箱时，同一客户 SHALL 只有一条互动。

#### Scenario: 互动的字段
- **WHEN** 运行 `npx tsx src/lib/mail-watch/__tests__/mail-watch-db.isolated.test.ts`，一位已建档客户给 Lynn 发信
- **THEN** 客户时间线多一条收到的邮件互动，标题为「客户来信（邮件）」、内容为「主题：〈主题〉」、不挂商机、记录人为 Lynn

#### Scenario: 标题里没有外部文字
- **WHEN** 同一测试中来信主题为任意文字，随后读取销售只读工具与 Muse 销售意图会取用的互动标题
- **THEN** 取到的是固定文字，不含主题

#### Scenario: 不进知识库分析
- **WHEN** 同一测试执行销售知识库的互动回填
- **THEN** 这条互动没有被分析，没有产生知识片段

#### Scenario: 同一封信进了两个邮箱
- **WHEN** 同一测试中一封信同时发给 `sales@`（进 Lucas 的邮箱）与 Lynn 本人，两人都已勾选且都看得到这位客户
- **THEN** 两人各收到一条通知，客户时间线上只有一条互动

### Requirement: 来信通知只发给邮箱主人
每封命中的来信 SHALL 给邮箱主人发一条 `mail_inbound` 通知：标题「客户来信：〈客户名〉」，摘要为主题，点开到该客户的详情页。同一封邮件同一收件人 SHALL 至多一条。通知 SHALL NOT 发给其他成员（判断点 8 未定前；收件人由单独一处规则决定）。标题与摘要 SHALL 只由客户名与主题组成，系统 SHALL NOT 往里加入邮件正文、客户电话、地址或金额字段。

#### Scenario: 只有邮箱主人收到
- **WHEN** 运行 `npx tsx src/lib/mail-watch/__tests__/mail-watch-db.isolated.test.ts`，客户给 Lynn 发信，该客户的建档人是另一位对 Lynn 可见范围内的同事
- **THEN** 只有 Lynn 有一条 `mail_inbound` 通知，其他成员没有

#### Scenario: 收件人规则可切换
- **WHEN** 运行 `npx tsx src/lib/mail-watch/__tests__/mail-watch-pure.test.ts`，分别以「只提醒邮箱主人」与「同时提醒客户负责人」两种方式计算收件人
- **THEN** 前者只有邮箱主人；后者为邮箱主人加客户建档人（去重）

#### Scenario: 点开到客户详情
- **WHEN** 同一纯函数测试对该通知计算跳转地址
- **THEN** 为 `/sales/customers/{客户 id}`

### Requirement: 客户来信是一种通知类型
`mail_inbound` SHALL 登记为通知类型，中文名「客户来信」。它在通知设置的开关列表与通知页的类型筛选里 SHALL 只对客户详情页放行的成员出现；隐藏时不改其偏好、不停投递（沿用通知类型的既有规则）。

#### Scenario: 销售看得到、安装工看不到
- **WHEN** 运行 `npx tsx src/lib/notifications/__tests__/type-visibility.test.ts`
- **THEN** `sales_rep` 的可见类型里有 `mail_inbound`，安装工没有，测试通过

### Requirement: 新通知推送微信且不走 Muse
每新建一条来信通知后 SHALL 用销售域微信推送发给该收件人，每条通知至多推一次（建好通知后、推送前中断的不补推），每轮至多 30 条且只在截止时刻前推，超出的不推、通知照建。推送 SHALL NOT 建 PendingAction（发给本组织成员本人，不算出站）。推送失败 SHALL NOT 影响账本、互动、游标与其它收件人。来信提醒 SHALL NOT 发 Muse 事件：已绑定 Muse 的成员同样收到 `mail_inbound` 站内通知与微信。

#### Scenario: 已绑定 Muse 的成员
- **WHEN** 运行 `npx tsx src/lib/mail-watch/__tests__/mail-watch-db.isolated.test.ts`，Muse 开启且 Lynn 已绑定
- **THEN** Lynn 收到一条 `mail_inbound` 通知，没有 `muse_bridge` 分类的记录

#### Scenario: 每轮上限
- **WHEN** 同一测试以注入的额度 1 处理 3 封客户来信
- **THEN** 3 条通知都建好，只推 1 条微信

#### Scenario: 推送失败
- **WHEN** 同一测试中微信推送抛错
- **THEN** 账本、互动、通知照常，运行结果里微信失败数为 1

#### Scenario: 不触碰 Muse 事件契约
- **WHEN** 运行 `npx tsx src/lib/mail-watch/__tests__/mail-watch-pure.test.ts`，对来信观察模块与 Muse 事件类型清单的源码做断言
- **THEN** 来信观察模块没有调用 Muse 事件的发出函数，事件类型清单里没有邮件相关的类型

### Requirement: 推送文案只有客户名与主题
微信推送的标题 SHALL 为「客户来信：〈客户名〉」、正文 SHALL 为主题，SHALL NOT 含邮件正文、发件地址或任何邮箱地址；主题里形如邮箱地址的串 SHALL 替换为 `[邮箱]`。

#### Scenario: 文案
- **WHEN** 运行 `npx tsx src/lib/mail-watch/__tests__/mail-watch-pure.test.ts`，对一封主题里带邮箱地址的客户来信生成推送文案
- **THEN** 标题为「客户来信：〈客户名〉」，正文是替换掉邮箱之后的主题，没有发件地址

### Requirement: 缺读信权限时提醒本人重新授权
已勾选的成员没有绑定 Gmail、授权不含读信权限或授权已失效时，本轮 SHALL 跳过该邮箱，并给该成员发一条站内提醒，文字写明到邮箱绑定页重新授权；同一成员 24 小时内 SHALL 至多一条。该提醒 SHALL NOT 推微信。

#### Scenario: 旧授权
- **WHEN** 运行 `npx tsx src/lib/mail-watch/__tests__/mail-watch-db.isolated.test.ts`，一位已勾选的成员只有撰写权限的旧授权，连续跑两轮
- **THEN** 两轮都没有对其邮箱发起 Gmail 请求，他只收到一条提醒

### Requirement: 邮箱绑定页的来信提醒设置
平台开关开启时，`/settings/email` SHALL 显示「客户来信提醒」勾选项（成员本人，默认不勾），并写明只读取本人邮箱、只提醒已建档客户的来信、不读取正文；组织开关未开时勾选项 SHALL 可见但不可勾并说明原因。持有销售设置管理权限的成员 SHALL 另见组织开关。平台开关关闭时这两项 SHALL NOT 显示。企业的发信方式为平台代发、页面不显示 Google 连接时，这两项也 SHALL NOT 显示（成员在这类企业里没有连接本人 Gmail 的入口）。

#### Scenario: 页面按状态渲染
- **WHEN** 运行 `npx tsx src/lib/mail-watch/__tests__/mail-watch-pure.test.ts`，对页面源码与页面状态函数做断言
- **THEN** 平台开关关闭不渲染；组织开关关闭时勾选项不可勾并带说明；组织开关只在有管理权限的状态里出现

#### Scenario: 成员勾选
- **WHEN** 平台与组织开关都开，Lynn 在 `/settings/email` 勾选「客户来信提醒」
- **THEN** 刷新后仍为已勾选；一位已建档客户给她发信后 15 分钟内她收到「客户来信：〈客户名〉」

### Requirement: 客户时间线上的「让助手读这封信」
客户详情页里由来信观察建的入站邮件互动 SHALL 带「让助手读这封信」入口：打开助手并预填一句话（含客户名与来信日期；日期取 Gmail 记的收信时间，不取发信人写的 `Date` 头），由用户自己发送。预填的话 SHALL NOT 含邮件主题或其它来自邮件的文字。读信开关关闭时 SHALL NOT 显示该入口。助手页（`/assistant`）对当前用户不放行时（与页面路由门同一套判定，例如岗位模式下只有销售岗位的成员）SHALL NOT 显示该入口。其它来源的互动 SHALL NOT 显示它。

#### Scenario: 预填的话不含主题
- **WHEN** 运行 `npx tsx src/lib/mail-watch/__tests__/mail-watch-pure.test.ts`，对主题为任意文字的来信生成预填文字
- **THEN** 文字里有客户名与日期，没有主题

#### Scenario: 只在读信可用时显示
- **WHEN** 同一测试对入口的显示条件做断言
- **THEN** 读信开关关闭、助手页对本人不放行、或互动不是来信观察建的，都不显示
