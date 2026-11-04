# Design

## Context

- 动机见 proposal.md「Why」。对外行为见本 change 的七个 specs 增量：
  - `notifications/{mentions,activity-events,email-reminders,preferences,click-targets}`
  - `cockpit/{post-registry,posts-overview}`
- 核对基于 origin/main `9f242788`（2026-11-04 fetch）。
  - 从任务书核对用的 `deccf844` 到它，只合入了 COLLAB-1（#377、#378）。
  - 下表涉及的文件里，只有 `src/app/(auth)/{layout.tsx,login/page.tsx}` 变过：微信入口抽成了组件，`next` 的处理没变。
- 本地 `.env` 直连生产库，所以本 change 的手工验收只在 staging 做，不在本地起服务。

### 任务书 §3 核对（与任务书的出入）

| 任务书写的 | main 上实际 | 本 change 怎么处理 |
|---|---|---|
| 站内通知：`sourceKey` 唯一（幂等）、`metadata` | `sourceKey String? @unique` 是单列唯一，不含 userId（`schema.prisma:1596-1624`）；`metadata` 是 JSON 文本（`String?`）；`createNotification` 先查后建，不是原子操作，出错就抛（`create.ts:27-44`） | 去重键末尾带收件人 id；并发写同一键时，唯一约束冲突当作"已存在"处理（D2） |
| 顶栏铃铛 | 一致；但点击跳转写了两份（`header.tsx:554-578`、`notifications/page.tsx:160-198`），分支已经不一致，两份都不认 `project_discussion` | 抽成一份共用规则（D11） |
| 通知类型注册表 | 21 个（`constants.ts:2-29`）；`approval`、`blinds_order_cancel_approved`、`process_order_generated` 等类型在用，但没登记；新类型还要进设置页名称表、两处图标表与 `TYPE_INTRODUCED_AT` | 只登记本次五个；没登记的类型维持原状（Out of scope） |
| 投递门禁 | 顺序：总开关 → 类型 → 只看高优先级 → 免打扰（`delivery-gate.ts:56-98`）；免打扰固定按 America/Toronto，high / urgent 穿透；新类型的 grandfather 比较的是偏好行的 `updatedAt`，任何写入都会刷新它；偏好行在每次轮询未读数时自动建（`preferences.ts:69-82`），清单取当时的注册表 | 修正 grandfather：清单记下保存时已登记的类型，每次写入物化生效清单（D12）；免打扰时区不改 |
| 邮件偏好：`emailEnabled`（默认 false），没有代码按它发信 | 一致；偏好行是自动建的，"没有偏好记录"几乎不会出现；设置页的开关在"站外通道（预留）"里，说明写着未接入 | 生效值按"是否明确选过"判定（D13） |
| 平台发件：`sendEmail` + `platformFromAddress`，非生产受 `QINGYAN_ALLOW_REAL_EMAIL_NON_PROD` 限制 | `sendEmail` 本身不查非生产门禁，也没有"只记日志"模式（`trade/email.ts:46`），门禁靠调用方调 `isRealEmailSendAllowed`（`env/runtime-isolation.ts:463`）；`platformFromAddress` 只返回地址，不带显示名（`email-sender.ts:100-104`） | 门禁与只记日志放在本 change 的发信层；显示名"青砚"在调用处拼（D16） |
| 讨论区 @：存进 metadata，不通知，不校验成员 | 一致；另外，`{userId,name}` 以外的形状被静默丢弃，名单不去重（`messages/route.ts:69-77`）；`canViewProjectDiscussion` 要传完整的 AuthUser（含角色，`access.ts:68`），它对组织所有者的口径与 `requireProjectReadAccess` 不同 | 不满足条件时整条 400，不再静默丢弃；按讨论区自己的查看规则校验（D3） |
| 任务评论：只有 content；指派 / 状态 / 评论都不通知 | 一致。另外： <br>· 评论 GET / POST 与活动 GET 只要求登录，不查任务访问权；<br>· `canAccessTask` 写在 `api/tasks/[id]/route.ts:14-30` 里，没导出；<br>· 批量改状态（`batch/route.ts:26-31`）绕过 `transitionTaskStatus`，不写活动记录，也不查访问权；<br>· 没有负责人选择界面，`assigneeId` 不校验 | 评论 POST 补访问校验（D5）；查看规则移到 `src/lib/tasks/access.ts`；批量路径只补通知；其余缺口不修（Out of scope） |
| 订单：状态机 + `OrderStatusLog`；确认 → 生产 → 备货 → 排期不通知 | 详情页"确认工艺单""标记完成"走 `PUT /api/blinds-orders/[id]`（`route.ts:137` 直接写 `status`），绕过状态机，不写 `OrderStatusLog`；只有取消与排期走 `/transition`；`OrderStatusLog` 另由安装完工与返修服务写入 | 两个接口都挂，按写入前后的状态判断（D6） |
| 定时任务：`sales-actions` 每 15 分钟；`daily-brief` 每小时跑一次，只处理当地 7 点的组织 | 一致。另外：<br>· `daily-brief` 路由有逐行源码断言（`daily-digest.test.ts:236-260`）；<br>· `sales-actions` 的三步之间没有隔离；<br>· 新自动化键要同时进注册表、调度表、岗位注册表与调度测试的门控清单；<br>· `daily-brief` 每天 7 点给每位成员写一条未读 `daily_briefing` | 两步都挂在路由末尾，各自收错（D14、D15）；汇总不计两类简报 |
| 项目上传：核对是否已调 `notifyProjectMembers`，没接就补 | 没有任何上传路径调它；它本身也不过门禁 | 只在 `POST /api/projects/[id]/files` 补，走协作通知入口（D8） |
| （任务书未列） | 账号邮箱里有占位地址：微信注册的 `wx_…@wechat.user`，以及 `system@qingyan.internal` | 收件地址过滤（D16） |
| （任务书未列） | 中间件跳登录时不带 `next`（`middleware.ts:60-90`）；登录页的 `safeNext` 只检查以 `/` 开头、不以 `//` 开头，`/\evil.example` 能通过 | 带上 `next`，并收紧校验（D11） |
| （任务书未列） | `resolveAppOrigin()`（`agent-runtime/workbench-link.ts:8`）回落到 `VERCEL_URL` 与 `https://qingyan.ai`；生产站点是 `https://qingyan.ca` | 邮件链接只用 `NEXT_PUBLIC_APP_URL`，缺了就不发（D16） |
| 微信入口 | 已由 COLLAB-1 处理 | 不涉及 |

## Goals / Non-Goals

**Goals:**
- 所有协作通知走同一个入口：收件人过滤 → 投递门禁 → 写入（同一个键只留一条）→ 出错只记日志。业务接口在写库成功之后调用它一次。
- 两种邮件挂在既有 `sales-actions`、`daily-brief` 路由的末尾：
  - 各记一条自动化运行，各自收错；
  - 既有步骤的行为不变，源码断言照常通过。
- 设置页显示的类型开关与实际投递一致；任何写偏好的路径，都不会改变用户没有亲手关掉的类型。
- 铃铛、通知页、邮件三处的跳转用同一份规则。

**Non-Goals:**
- 数据与调度：`prisma/schema.prisma`、`prisma/migrations/**`、`vercel.json`。
- 既有的通知写入：
  - `src/lib/notifications/create.ts` 的 `createNotificationsForUsers`、`notifyProjectMembers`，以及它们的调用方（AI 标书包、招标阶段推进）；
  - `src/lib/install/**` 的安装类通知；
  - `task_due` 扫描与 `src/lib/notifications/filter.ts`（`passesGlobalPref`）。
- 免打扰：`src/lib/time/quiet-hours.ts`（仍按 America/Toronto）。
- 发信底层：
  - `src/lib/trade/email.ts`、`src/lib/trade/email-sender.ts`、`src/lib/env/runtime-isolation.ts` 只调用，不修改；
  - `src/lib/email/**` 与组织发件设置不碰。
- 任务：
  - `src/lib/tasks/transition.ts`（`transitionTaskStatus`）；
  - 评论 GET 与 `src/app/api/tasks/[id]/activities/route.ts`；
  - 其他写任务的路径：审批执行器、项目交接、招标阶段任务、投标流程、muse-bridge 询盘、招标自动分析、`/api/v1/projects`。
- 工艺单：
  - `src/lib/fulfillment/order-state-machine.ts`、`src/lib/fulfillment/order-access.ts`（`applyOrderTransition`）；
  - 安装完工与返修路径；
  - `PUT` 绕过状态机的问题本次不修。
- 讨论区访问规则：`src/lib/project-discussion/access.ts` 只调用，不修改。
- `src/lib/muse-bridge/**`、`src/app/api/muse-bridge/**`：只导入 `containsOutboundSensitive`，不修改。
- 驾驶舱公司日志 `src/lib/cockpit/timeline.ts`：汇总审计不带组织 id，本来就进不了公司日志，denylist 不改。
- 微信：`src/lib/messaging/**`、`src/app/api/cron/wechat-push/route.ts`。

## Decisions

**D1. 协作通知走统一入口 `src/lib/notifications/collab/deliver.ts`。** 对每个事件依次：
- 收件人过滤：账号在职；对象属于组织时，是该组织的 active 成员；排除操作人；去重。
- 逐人判门禁：`shouldDeliverInApp(userId, { type, priority })`。
- 写入：去重键已存在时返回旧行；遇到唯一约束冲突（P2002）时回读旧行。

整个调用包在 try/catch 里，出错只记 `console.error`。业务路由在写库成功之后 `await` 这个入口。
- 被否决：用 `after()` 放到响应之后发。GATE 1 要求请求一返回，铃铛里就能看到；`after` 里的失败没人看得见，测试也测不到。代价是请求多几十毫秒。
- 被否决：直接用 `createNotificationsForUsers`。它不过门禁；第一个错误就抛出，后面的人全被跳过。
- 被否决：与业务写入放进同一个事务。通知出错会回滚业务写入，违反"失败不影响业务"。

**D2. 去重键为 `<类型>:<对象 id>:<事件区分键>:<收件人 id>`。** 事件区分键按事件取：
- 任务、工艺单：写入后 `updatedAt` 的毫秒数；状态类事件在前面加新状态；
- 任务创建：`created`；
- 评论：评论 id；
- 上传：`upload.{第一个文档 id}`。

被否决的方案：
- 用 `OrderStatusLog` 或 `TaskActivity` 的 id 做区分键：`PUT` 路径不写 `OrderStatusLog`，批量改状态不写活动记录。
- 只先查后建：并发或重试时，第二个写入会抛 P2002，要么变成 500，要么连带同批其他人一起丢掉。

**D3. @ 校验（`src/lib/notifications/collab/mentions.ts`）。**
- 服务端只认 `userId`；`name` 只用于显示。保存 `{ userId, name }`，`name` 截到 50 个字符。
- 被 @ 的人要同时满足三个条件：
  - 账号在职；
  - 是对象所属组织的 active 成员；
  - 能看到对象：讨论区先把被 @ 的人加载成 AuthUser，再调 `canViewProjectDiscussion`；任务调 D5 导出的任务查看规则。
- 任一人不满足，返回 400 `MENTION_NOT_ALLOWED`，带 `invalidUserIds`，不带姓名和邮箱；一次最多 @ 20 人。
- 被否决：静默去掉不满足的人。任务书 §5.1 明确要求整条 400。
- 被否决：在错误里返回不满足者的姓名。调用方本来就知道这些 id；返回姓名，等于让人借此探测组织外的账号。
- 被否决：不设上限。一条消息 @ 几十个人就成了群发，而且每人要做一次权限查询。

**D4. 10 分钟内的重发。**
- 讨论区：同一人、同一讨论区、带 @，正文（去掉首尾空白）相同，@ 名单（去重后排序）相同。
- 任务评论：同一人、同一任务，正文相同，带不带 @ 都算。
- 命中时返回第一次创建的那条：HTTP 200，带 `replayed: true`。
- 并发：在事务里先拿 `pg_advisory_xact_lock(hashtext(<人>:<对象>:<正文>))`，再查最近 10 分钟，没有才创建（先例：`src/lib/install/balance-service.ts`）。
- 被否决：只靠通知的去重键。重放会新建第二条消息，新 id 带来新的去重键，而 GATE 3 要求"不产生第二条"。
- 被否决：客户端传幂等键请求头。要改两个前端与接口契约，存这些键还需要新字段或新表。
- 被否决：不带 @ 的讨论区消息也去重。"收到""好的"这类短回复连发两次是正常用法。

**D5. 任务评论与任务查看规则。**
- 查看规则：把 `canAccessTask` 从 `src/app/api/tasks/[id]/route.ts` 原样移到 `src/lib/tasks/access.ts` 并导出；详情路由改为导入它，行为不变。
- 评论接口：`POST /api/tasks/{id}/comments` 先按这条规则校验，不通过返回 404 `任务不存在`。原因：评论现在会给负责人和创建人发通知，不校验的话，任何登录用户都能借评论给任何人发通知。
- 候选人接口：新增 `GET /api/tasks/{id}/mention-candidates`。
  - 任务属于项目时，取项目所属组织的在职 active 成员，按姓名排序取前 200 人，再逐个按任务查看规则过滤。
  - 任务没有项目时，只看创建人与负责人。
- @ 输入：
  - 把 `project-discussion-composer.tsx:58-189` 里的逻辑抽成纯函数，放在 `src/lib/notifications/collab/mention-input.ts`：判断是否触发、按姓名过滤、在光标处插入、按正文算出提交名单。
  - 外面包一个 hook，讨论区与任务评论框共用；`MentionDropdown` 原样复用。
- @ 名单写进 `TaskActivity(action="comment.mentioned")`。`detail` 是纯文本列，所以存 JSON 字符串。
- 被否决：用 `buildTaskVisibilityWhere`（`tasks/query.ts:52`）。它对创建人的口径与详情页不同，会出现"能打开详情却不能评论"的情况。
- 被否决：顺手修评论 GET 与活动 GET 的访问缺口。这两个接口不发通知，另开 change。

**D6. 事件挂在接口上，比较写入前后的值。**

| 事件 | 接口 |
|---|---|
| 任务指派 | `PATCH /api/tasks/[id]`（`assigneeId` 前后不同）；`POST /api/tasks`（负责人不是创建人） |
| 任务状态 | `PATCH /api/tasks/[id]`（`transitionTaskStatus` 成功之后）；`POST /api/tasks/batch` 的 `status` 动作（逐条比较） |
| 任务评论 | `POST /api/tasks/[id]/comments` |
| 工艺单阶段 | `POST /api/blinds-orders/[id]/transition`、`PUT /api/blinds-orders/[id]`：新状态是已确认 / 开始生产 / 备货完成 / 已排期之一，且与原状态不同 |
| 文件上传 | `POST /api/projects/[id]/files` |
| 讨论区 @ | `POST /api/projects/[id]/discussion/messages` |

- 被否决：挂在 `transitionTaskStatus` / `applyOrderTransition` 里。批量改状态与 `PUT` 都绕过它们；而且审批执行器、项目交接等 Out of scope 的路径也会跟着发通知。
- 被否决：用 Prisma 扩展监听写入。拿不到操作人；导入、脚本等所有写入都会发通知。

**D7. 工艺单阶段的收件人。** 收件人是创建人、关联商机的负责人（`assignedToId`），以及下一阶段负责角色。负责角色按新状态取人：
- 已确认 / 开始生产：持该单任一品类键 `orders.fulfillment.update.<品类>` 的人，品类的取法同 `fulfillment/order-category-access`；
- 备货完成 / 已排期：持 `install.task.assign` 的人，即 GATE 5 说的"排期负责角色"。

取人用 `listUsersWithPermission(orgId, key)`（`src/lib/sales/approvers.ts:10`，返修通知也用它）；组织与该单访问判断所用的组织相同。
- 被否决：按全品类键 `orders.fulfillment.update` 发。老板与管理层持有这个键，按它发就等于每张单的每个阶段都通知老板。
- 被否决：排期时通知安装工（持 `install.task.read` 的人）。安装工打不开工艺单页面，点通知会得到 403；他们的入口是 `/install` 与日历。

**D8. 文件上传：只在 `POST /api/projects/[id]/files` 发。** 类型 `project_update`，新的 entityType `project_files`；走 D1 的入口。收件人是 active 项目成员与项目负责人，上传人除外。
- 被否决：调 `notifyProjectMembers`。它不过门禁，也不过滤组织成员。
- 被否决：报价导入、生成 PDF、费用票据、知识库等路径也发。这些是系统生成的文件或个人记账，通知只会成为噪音。

**D9. 事件文案（`src/lib/notifications/collab/events.ts`，纯函数）。**
- 写通知时一次算好：标题、摘要、去重键、`metadata.objectLabel`（邮件里的"对象"），以及 `metadata.dueAt`。
- 状态名用 `TASK_STATUS_META`（`src/lib/tasks/status.ts`）。
- 截止日期按组织时区取，缺省 America/Toronto。
- 被否决：发邮件时再回查对象、现拼对象名。一封汇总可能涉及几十种对象；对象改名后，邮件与站内通知就会对不上。

**D10. 脱敏（`src/lib/notifications/collab/redact.ts`）。**
- 四类规则：
  - 金额、电话、地址：本 change 新写的正则；
  - 内部财务词：复用 `containsOutboundSensitive(text, { strict: true })`（`muse-bridge/contract.ts:371`）与 `COCKPIT_SENSITIVE_PATTERNS`（`cockpit/waiting.ts:23`），只导入，不修改。
- 命中时，整段替换为 `（含敏感信息，请在青砚查看）`。
- 在两个时刻脱敏：
  - 写通知时：标题、摘要、对象名；
  - 发邮件时：其他功能写的通知标题。
- 被否决：局部遮盖（把数字打星号）。纪律 4 要求整段替换；数字格式变体多，遮不干净。
- 被否决：只用 Muse 通道的敏感词表。它不拦电话和地址，而这些邮件会进个人邮箱，被个人助理读取（任务书 §5.5）。

**D11. 跳转与登录回跳。**
- 跳转规则：`src/lib/notifications/href.ts`，纯函数，按 specs `click-targets` 的顺序取地址。
  - 铃铛与通知页都调它；"记住所选组织"的副作用留在各自的组件里。
  - 邮件也用这个函数，前面加站点根地址。
- 讨论区锚点：项目页读到 `#project-discussion` 时打开工作台，等讨论区渲染出来再 `scrollIntoView`。
- 中间件：未登录的页面请求跳到 `/login?next=<路径+查询串>`，原路径为 `/` 时不带 `next`；接口请求仍返回 401。
- `next` 校验：抽成 `src/lib/auth/safe-next.ts`，登录页与选择组织页共用。合法的 `next` 以 `/` 开头、不以 `//` 开头，不含反斜杠、空白或控制字符；其他值一律当作 `/`。
- 锚点保留：重定向地址不带锚点时，浏览器会把原地址的锚点带过去。登录页与选择组织页读 `location.hash`（只接受 `#` 后跟字母、数字、`-`、`_`），接到 `next` 后面。
- 被否决：在两份跳转表里各补两行。两份已经漂移，邮件再抄一份就成了三份，还会继续漂。
- 被否决：在服务端把锚点编码进 `next`。浏览器不把锚点发给服务端，中间件拿不到它。

**D12. 类型偏好：清单记下保存时已登记的类型，每次写入都物化生效清单。**
- 写入：偏好行的四处写入，每处都把写入前的生效清单写回 `enabledTypesJson`，并在 `metadata.knownTypes` 记下写入时的注册表。
  - 四处写入是：`src/lib/notifications/preferences.ts` 的建行与修改，`src/lib/proactive/automation-prefs.ts` 的 upsert 与 update。邮件选择走修改那一处。
  - 设置页 PATCH 带了 `enabledTypes` 时，以用户提交的清单为准。
- 门禁判定：
  - 已登记的类型在清单里 → 开；
  - 不在清单里、偏好行有 `knownTypes` → 只有不在 `knownTypes` 里的才开；
  - 不在清单里、偏好行没有 `knownTypes`（本次上线前写入）→ 按既有的时间规则。
- 五个新类型登记进 `TYPE_INTRODUCED_AT`（任务书 §5.2），取远未来的哨兵时间。理由：
  - 上线后的写入都带 `knownTypes`，不走时间规则；
  - 时间规则只剩给上线前写入的行用，而这些行都没见过这五个开关。
- `GET /api/notifications/preferences/me` 返回生效清单，所以设置页如实显示为开启。
- 被否决：只在 `TYPE_INTRODUCED_AT` 里加真实日期（任务书字面）。设置页把新类型显示为关，保存时又原样回传，老用户一保存就把它们关掉了；改自动化偏好也会刷新 `updatedAt`，新类型随之被判为关。INSTALL-2b 的九个类型现在就有这个问题。
- 被否决：引入时间取合并日或预计部署日。部署晚于这个日期时，中间这段时间里旧代码写入的清单会把新类型判为关，还要有人记得去改日期。
- 被否决：加一个"清单保存时间"字段。违反纪律 1。

**D13. 邮件偏好：用 `metadata.emailChoiceAt` 标记"明确选过"。**
- 设置页 PATCH 带了 `emailEnabled` 时，照旧写这一列，同时在偏好行的 `metadata` 里记 `emailChoiceAt`。
- 生效值：有 `emailChoiceAt` 时取 `emailEnabled`，没有时为开。GET 返回生效值，两种邮件也都读它。
- 被否决：按"有没有偏好行"判断（任务书 D3 字面）。偏好行在第一次轮询未读数时就自动建好，`emailEnabled = false`，几乎人人"有记录且为关"，D3 的"默认开"就落空了。
- 被否决：把这一列的默认值改成 true 并回填。改默认值要 migration，回填是对生产库的数据写入，都不允许。
- 被否决：沿用已经存下的值。旧开关旁写着"当前未连接发信"，存下的值不代表对真实邮件的选择。

**D14. 未读升级邮件（`src/lib/notifications/collab/escalation.ts`）。**
- 挂点：`sales-actions` 路由的最后一步，即 `runTrackedAutomation("notify-email-escalation", …)`，自带 `.catch`。截止时刻为路由开始后 285 秒（`maxDuration` 是 300）；单轮最多 100 封。
- 候选：类型为 `mention` 或 `task_assigned`、状态未读、创建于 [now − 24h, now − 15min]。按创建时间升序取前 500 条，再在内存里按 `metadata` 过滤掉：已发、已跳过、尝试满 3 次、10 分钟内正在发送。
- 认领：`updateMany({ where: { id, status: "unread", metadata: <读到的原文> } })`，写入 `emailSendingAt` 与 `emailAttempts + 1`；更新到 1 行才发送。发完以同样的条件写入 `emailedAt` 或 `emailError`。两轮重叠时，只有一轮能认领成功。
- 跳过并记下原因（之后不再试）：
  - 邮件偏好的生效值为关；
  - 收件人在免打扰时段内：用同一个 `isInQuietHoursToronto`，不论通知优先级；
  - 账号停用，或不是 active 成员；
  - 地址不可投递。
- 被否决：新增 cron 条目或单独的路由。违反纪律 3 与任务书 §5.3。
- 被否决：通知创建时排一个 15 分钟后的延迟任务。Serverless 没有常驻进程，这等于新建一个队列。
- 被否决：在 SQL 里用字符串包含筛 `metadata`。它是 JSON 文本，按键名做字符串匹配不可靠；候选集有"24 小时 + 两种类型"的上界，在内存里过滤就够了。
- 被否决：先发后记、不认领。手动触发与定时触发重叠时，会发出两封。

**D15. 每日未读汇总（`src/lib/notifications/collab/digest.ts`）。**
- 挂点：`daily-brief` 路由的末尾。
  - 先照旧算出响应（简报 → 岗位日结），再跑 `runTrackedAutomation("notify-email-digest", …)`，自带 `.catch`，结果并入响应的 `notifyEmailDigest` 字段。
  - 组织沿用同一个 `orgs`（`orgsAtLocalHour(activeOrgs, now, [7])`）。
  - `daily-digest.test.ts` 断言的各行逐字保留。
- 收件人：这些组织的在职 active 成员，跨组织去重。
  - 每人列出名下全部计入汇总的未读，不论通知属于哪个组织；`daily_briefing`、`sales_daily_briefing` 不计入。
  - 单轮最多 300 封；截止时刻为路由开始后 285 秒。
- 每人每天一封：
  - 在事务里先拿 `pg_advisory_xact_lock(hashtext('notify-email-digest:<userId>:<本地日期>'))`；
  - 再查 `AuditLog`：`action = notifications.email_digest`、`targetType = user`、`targetId` 为收件人，内容含该本地日期，走 `[targetType, targetId]` 索引；
  - 没有记录才写审计占位，提交后再发送。
  - 发送失败不补发，计入运行记录的失败数。
  - 审计不带 `orgId`，进不了公司日志。
- HTML 用 `renderPlainEmailHtml`（`src/lib/revenue-spine/email-layout.ts:315`），品牌名为"青砚"。
- 被否决：在 `daily-brief` 按组织的循环里发。属于多个组织的成员会收到多封；而且要改受源码断言约束的循环。
- 被否决：用 `AutomationRun` 判断今天发过没有。它按轮记录，不按人记录。
- 被否决：先发后写审计。两个组织同时到 7 点时，会并发发出两封。

**D16. 发信层（`src/lib/notifications/collab/email.ts`）。**
- 收件地址：只取 `User.email`，按 spec 过滤占位域名与保留域名。
- 发件：`sendEmail({ from: "青砚 <" + platformFromAddress() + ">", … })`。
- 非生产门禁：`isRealEmailSendAllowed()` 为假时只记日志（收件人 id 与主题），按已发处理，并标 `emailDryRun`。
- 链接根地址：只用 `NEXT_PUBLIC_APP_URL`。两个自动化在注册表里声明 `requiredEnv: ["RESEND_API_KEY", "NEXT_PUBLIC_APP_URL"]`；真发环境缺任一项时，整轮记为跳过，不动任何通知。
- 内容：主题、正文、事项行按 specs `email-reminders` 拼。截止日期取 `metadata.dueAt`；没有时，`entityType = task` 的通知取任务当前的截止时间，每轮批量查一次。
- 被否决：用 `resolveAppOrigin()`。它回落到 `VERCEL_URL`（带部署保护的预览地址）与 `https://qingyan.ai`，都不是生产站点。
- 被否决：用组织的 `fromEmail` / `mailboxEmail` 或 Gmail 授权发。这些是对外邮件的设置（纪律 6）；系统通知用平台地址，不以销售个人邮箱的名义给同事发信。
- 被否决：缺站点地址时发不带链接的邮件。邮件的用处就是让人点回青砚。

**D17. 两个自动化键。**

| 键 | 名称 | 类别 | 节奏 / 时区 | 调度 | 岗位 |
|---|---|---|---|---|---|
| `notify-email-escalation` | 未读升级邮件 | operations | 每 15 分钟 / UTC | cron：`/api/cron/sales-actions`，`*/15 * * * *` | `ops_knowledge` |
| `notify-email-digest` | 每日未读汇总邮件 | operations | 每日 7:00（组织时区）/ 组织时区 | 本地时刻门控：`/api/cron/daily-brief`，`0 * * * *`，`[7]`，组织时区 | `ops_knowledge` |

调度测试的组织门控清单加 `notify-email-digest`；最长间隔用例补两条（15 分钟、1440 分钟）。
- 被否决：归"询盘与销售"岗位。`posts-read-model.test` 断言该岗位恰好 9 个自动化；而邮件补位属于平台运维职能。
- 被否决：不记自动化运行，只打日志。驾驶舱看不到失败；任务书也要求用 `runTrackedAutomation`。

**D18. 纪律第 2 条的澄清。** 把任务书 §5.4 的原句追加到 `openspec/config.yaml` 中 `context` 第 2 条的末尾，一字不改。
- 被否决：另起第 9 条。任务书 §5.4 指定写在"第 2 条末尾"；而且八条硬纪律的编号被 GATE 与 design 规则引用。

**D19. 测试。** 新增九个测试文件，都放在 `src/lib/notifications/__tests__/`：
- 纯逻辑（时间、偏好、数据读取都从参数注入）：`collab-redact`、`collab-events`、`collab-mentions`、`collab-mention-input`、`collab-preferences`、`notification-href`、`collab-email-escalation`、`collab-email-digest`。
- 源码断言：`collab-wiring`，断言以下几点：
  - 各接口在写库成功之后才调用入口，调用不向外抛错；
  - 两个 cron 步骤自带 `.catch`；
  - 新文件不导入 LLM 客户端，也不导入 `EmailProvider`。
- 部分纯逻辑测试顺带断言接线：铃铛与通知页共用跳转函数，评论框按共用逻辑接线。

全部注册进 `scripts/test-all.sh`，纯逻辑的同时注册进 `scripts/test-ci-unit.sh`。
- 被否决：写隔离库测试（`*.isolated.test.ts`）。CI 没设 `DATABASE_ENVIRONMENT=isolated`，本地也会跳过，写了等于没验证。
- 被否决：写浏览器端到端测试。仓库没有浏览器测试框架。

## 硬纪律

1. 零 schema：遵守。不加 model、字段，不写迁移。新数据只落在以下位置：
   - `Notification`：五个新类型；`metadata` 里的 `objectLabel`、`dueAt` 与邮件处理记录；
   - `AuditLog`：汇总的占位记录；
   - 用户设置 JSON `UserNotificationPreference.metadata`（`automation-prefs` 已在用）：`knownTypes`、`emailChoiceAt`；
   - 既有的 `ProjectMessage.metadata.mentions`；`TaskActivity` 的新 `action` 值（任务书 §5.1 指定）。

   验证：`git diff --stat origin/main...HEAD -- prisma` 输出为空。
2. 出站先审批：触碰。按任务书 §5.4（本 change 把它写进 config 第 2 条），这两种邮件属于站内通知的补位，不建 PendingAction。守住边界的做法：
   - 收件地址只取收件人自己的青砚账号邮箱，从不取请求或通知内容里的地址；
   - 收件人必须是在职账号，并且是相应组织的 active 成员；
   - 客户与组织外地址一律不发。

   验证：`collab-email-escalation`、`collab-email-digest` 断言地址来源与成员校验。
3. 禁止第三套队列：遵守。
   - 不新增 cron、队列、调度器、worker 或 lease 表。
   - 两步挂在既有 `sales-actions`、`daily-brief` 上，用既有的 `runTrackedAutomation` 记录。
   - 升级邮件的"认领"只是对这一条通知的条件更新。

   验证：`git diff origin/main...HEAD -- vercel.json` 输出为空；`daily-digest.test` 的"vercel.json 不新增条目"仍然通过。
4. 脱敏：触碰。通知标题、摘要，以及邮件主题、正文，命中金额、电话、地址或内部财务词时整段替换（D10）。这比 Decision A 对 Muse 通道的要求更严（落地价在这里也不出），因为邮件会进个人邮箱。验证：`collab-redact`；`collab-events` 与两个邮件测试都有含金额、电话的用例。
5. 不爬登录页：不涉及。
6. 邮箱分离：不涉及。系统邮件用平台发件地址，不读组织的 `fromEmail` / `mailboxEmail`，也不经 `EmailProvider` 或 Gmail。验证：`collab-wiring` 断言 `collab/email.ts` 不导入它们。
7. 确定性优先：遵守。收件人、跳转、脱敏、分组全部是查表与规则，没有 LLM 调用；偏好里不存金额。验证：`collab-wiring` 断言新文件不导入 LLM 客户端。
8. 测试注册：九个新测试文件注册进 `scripts/test-all.sh`，纯逻辑的同时注册进 `scripts/test-ci-unit.sh`；`bash scripts/check-test-registry.sh` 通过，`ci/test-registry-baseline.txt` 不新增条目。

## Risks / Trade-offs

- [老用户的邮件默认开启，第一个 7 点会收到积压的未读] → 汇总最多列 50 条，外加一行计数；上线说明提醒可在设置页关闭；按试点度量（任务书 §10）看每人每天收到的封数。
- [改派时，发给原负责人的那条 `task_assigned`（medium）也会升级成邮件] → 这是按任务书 §5.2 字面（`task_assigned` 一律升级）。如果只想提醒新负责人，把升级条件限定为 high 即可，不影响其他部分。
- [升级邮件的候选查询没有对口的索引] → 查询有"24 小时 + 两种类型"的上界，并且限 500 条；数据量上来后再加索引（需要 migration，另开 change）。
- [认领之后进程中断] → `emailAttempts` 已经加一，`emailSendingAt` 10 分钟后失效，下一轮会重试。最坏情况是同一条通知发出两封（邮件已发出，但没来得及记 `emailedAt`），总数不超过 3 封。
- [免打扰固定按多伦多时间] → 与站内门禁一致；不在多伦多时区的用户，免打扰时段会错位（既有问题，Out of scope）。
- [中间件改动影响所有未登录时的页面跳转] → 只加 `next` 参数，接口的 401 不变；`next` 校验与跳转地址都有单测。
- [`canViewProjectDiscussion` 与 `requireProjectReadAccess` 对组织所有者的口径不一致] → 被 @ 的人按讨论区自己的规则判断，与谁能看讨论区保持一致；口径差异另行处理。
- [两个 cron 的时间预算] → 两步都有截止时刻与封数上限，超出就停下，并记进运行记录。升级邮件在 24 小时窗口内由下一轮接着扫；汇总当天不补。
- [源码断言随重构失效] → 只断言接线点，行为由纯逻辑测试覆盖。
- [`TYPE_INTRODUCED_AT` 里的哨兵时间看起来像笔误] → 代码注释写明含义；`collab-preferences` 覆盖三种情况：上线前写入的清单、上线后写入的清单、上线后主动关闭。
- [需要紧急停发邮件] → 回退本 PR；本 change 没有单独的邮件总开关（任务书未要求）。

## 验证

- 新测试：九个文件逐个运行 `npx tsx src/lib/notifications/__tests__/<名称>.test.ts`。
- 既有测试保持通过：
  - `src/lib/notifications/__tests__/delivery-gate.test.ts`；
  - `src/lib/cockpit/__tests__/{schedule,daily-digest,posts,posts-read-model}.test.ts`；
  - `src/lib/sales/__tests__/action-loop-contract.test.ts`。
- 门禁命令：`bash scripts/check-test-registry.sh`、`npm run typecheck`、`npm run lint:baseline`、`npm test`。
- `openspec validate collab-notify --strict`。
- 不动项：执行 `git diff --stat origin/main...HEAD -- prisma vercel.json src/lib/trade/email.ts src/lib/trade/email-sender.ts src/lib/env/runtime-isolation.ts src/lib/time/quiet-hours.ts src/lib/project-discussion/access.ts src/lib/fulfillment src/lib/install src/lib/muse-bridge src/app/api/muse-bridge src/lib/messaging`，输出为空。
- GATE 1–8（任务书 §7）：
  - 在 staging 预览上用两个测试账号走一遍；本地 `.env` 直连生产库，不在本地跑。
  - GATE 2、6 的时间条件，用注入时间的单测代替。
  - 要在 staging 收到真实邮件，需要临时开 `QINGYAN_ALLOW_REAL_EMAIL_NON_PROD`，并带 `CRON_SECRET` 手动调一次对应的 cron（Evan 操作）。

## Migration Plan

- 合并部署之后：
  - 站内协作通知、@ 校验、跳转与登录回跳立即生效。
  - 偏好不做数据迁移：老的偏好行在下一次被写入时物化清单、记下 `knownTypes`；在此之前按时间规则判定。
  - 邮件需要生产环境有 `NEXT_PUBLIC_APP_URL=https://qingyan.ca` 与 `RESEND_API_KEY`。
    - 缺任一项时，两个自动化记为"未配置"并跳过。
    - 补齐并重新部署后：升级邮件在下一轮（15 分钟内）开始；汇总在各组织的下一个当地 7 点开始。
    - 本 change 不改 Vercel 设置，什么时候设置由 Evan 决定。
- 回滚：回退本 PR，不需要回滚数据。已写入的通知、`metadata` 里的新键与审计记录可以留着，旧代码不读它们；物化后的清单只多不少，旧门禁照常工作。
