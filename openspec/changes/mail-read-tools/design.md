# Design：助手只读读信（MAIL-1）

## Context

动机见 proposal.md。本文只写做法、核对结果和需要拍板的地方。所有代码引用在 main `dd0e99d`（2026-11-12）上核对——与任务书用的是同一个提交，任务书里的路径和行号全部对得上；只读代码，没有运行应用，没有连 Google。

### 待拍板（两处，都已按推荐方案写进 specs 与 tasks；改选别的方案只动标出的那一条 Requirement 和那一条 task）

**待拍板 A · 助手的回复里带着邮件内容，回复本身是落库的**

- 核对结果（详见下文「核对一」）：读信工具返回的原文**不会**落库；但助手基于它写出的回复会原样存进 `AiMessage.content`，没有保留期限，而且可能被再抄两处（个人对话搜索索引、项目洞察）。用户说「把原文贴给我」时，整封正文会经回复落库。
- A1（推荐，已写进 specs「助手回复落库时省略长段邮件原文」、task 5.1）：回复照常保存；落库前把与本轮读到的邮件正文连续重合 120 字以上的段落换成「〔邮件原文已省略，需要时请让助手重新读取〕」，用户当时看到的流式内容不变；读过邮件的那一轮不做项目洞察抽取。代价：重新打开历史对话时，那一段显示为省略标记。
- A2：回复照常保存，只靠系统提示要求「转述为主、不整段粘贴」。实现最少，但不是确定性的，整封正文仍可能落库。
- A3：读过邮件的那一轮，回复不存正文，只存一句占位。最严，但历史对话里这一轮是空的，下一轮模型也看不到自己上一轮说了什么，追问体验明显变差。

**待拍板 B · 任务书的一个前提与代码不符：不是所有中高风险工具都先出审批卡**

- 任务书写「对话里可达的 `l2_soft` / `l3_strong` 工具仍全部经 PendingAction」。实际不是：网页助手的风险上限是 `l2_soft`，而 `sales_create_quote`（`tools/sales-quote.ts:182`）、`sales_create_appointment`（`tools/sales-interaction.ts:301`）、`trade_log_follow_up`（`tools/trade.ts:682`）都是 `l2_soft` 且直接写库，没有审批卡；`l1_internal_write` 的工具（如 `sales_record_coaching`）也直接写。
- 这对读信的意义：邮件正文进了模型上下文之后，只靠系统提示挡不住一封写着「给这个客户建一张报价」的邮件——模型一旦照做，同一轮里就会直接落库。
- B1（推荐，已写进 specs「读过邮件的同一轮不执行写入类工具」、task 4.1）：一轮运行里读信工具成功返回过内容之后，本轮所有非只读工具一律拒绝（`UNTRUSTED_CONTENT_WRITE_BLOCKED`），助手请用户另发一条消息。确定性，测试可以钉死，也让验收里「读带指令的邮件 → 没有工具调用、没有审批卡」不靠模型自觉。代价：「看看王总的邮件，然后把跟进时间改到周五」要分两条消息说。今天的邮件回复草稿走的是另一条路（服务端意图分流的 Gmail 草稿场景），不在这一轮里，不受影响。
- B2：只封直接落库的写工具，出审批卡的工具放行（需要一张「只出卡」工具清单和守卫测试）。同一轮能出草稿卡，但带指令的邮件仍可能让助手弹出一张卡。
- B3：按任务书原样，只靠系统提示。不建议：上面三个工具会在没有任何人确认的情况下写库。
- 不论选哪个，本 change 都不去改那三个工具本身（见 Non-Goals），只把这个事实报出来。

### 核对一：对话记录是否把工具返回的原文落库、保留多久

任务书点名的 `src/lib/agent-core/conversation` 是**项目会话**的适配层，不是网页助手。两条链路分开说：

| 链路 | 工具结果原文 | 保留 | 读信工具能否到达 |
|---|---|---|---|
| 项目会话（`agent-core/conversation/adapter.ts`） | **落库**：每次工具调用存一条 `Message`（`content = JSON.stringify(结果)`，`:293`），并存 `ToolCallTrace.outputJson`（`observability.ts:98`，截 50,000 字）；下一轮还会把它截 4,000 字回放给模型 | 无期限，随会话 | **到不了**：它以 `tools: []` 运行（`:280`），不暴露注册表工具，只有会话绑定的 DB 工具和 `export_document` |
| 网页助手（`/api/ai/threads/[threadId]/messages` 的 Operator 分支） | **不落库**：只把助手最终文本存成 `AiMessage`（`route.ts:1163`）；浏览器收到的工具事件只有工具名和成功与否（`:1002–1004`）；该入口不传观测 hooks，不写 `AgentRunEvent` / `ToolCallTrace` | 工具结果只活在当轮内存里 | 能，这是读信工具唯一的入口 |
| 微信对话（`agent-runtime/process.ts`） | 不落库：hooks 只记工具名、耗时、成功与否 | — | 本 change 不开 |
| 技能运行（`agent-core/skills/runtime.ts`） | `SkillExecution` 存最终回复全文与工具入参（不存工具结果）| 无期限 | 本 change 不开 |
| Agent Core 对话（`/api/agent-core/chat`） | 不落库；响应里带工具名与入参 | — | 本 change 不开 |

结论与由此带出的三件事：

1. 读信工具只接进网页助手这一条链路，工具结果原文不落库。为防以后有人把注册表工具放进项目会话，测试用源码断言钉住「项目会话不暴露注册表工具」（specs「读信工具的结果不落库」）。
2. 任务书写「对话上下文内保留工具结果以便追问」——实际**不保留**：网页助手下一轮只带 user / assistant 文本（`route.ts:415–419`），工具结果不进下一轮。追问「他具体说了什么」时，模型在新一轮里重新搜索、重新读线程（一轮最多 5 次工具往返，够用）。这正好符合「读的时候实时从 Gmail 取」。
3. 助手的回复是落库的，且有下游拷贝：`MessageEmbedding`（个人对话搜索索引，抄前 5,000 字，`context/search-engine.ts:225`，由 legacy 分支或 `context_index_messages` 触发）；项目对话里 `extractInsightsFromAssistantReply` 把回复里命中关键词的 300 字片段写成 `ProjectInsight` 草稿（`projects/insight-extract.ts`，Operator 分支 `route.ts:1194` 会调用）——那是挂在项目上的数据，不是个人数据。这就是「待拍板 A」。
4. 模型服务商一侧：对话走的 Responses 调用带 `store: false`（`ai/responses-client.ts:220`），不在服务商处留存；`recordAiCall` 只记模型、耗时、token 数。

### 核对二：对话入口实际走哪套工具注册表

两套都在用，各管一段：

- **`agent-core/tool-registry`（`registry` + `tools/_policy.ts`）**：模型自由选工具的那一套。网页助手 Operator 分支、Agent Core 对话、微信对话、外贸对话、技能运行、提及网关（另加显式白名单）都从这里取工具列表并经 `registry.execute` 执行。
- **`agent-runtime-v2/tool-catalog`**：固定场景的那一套。网页助手每条消息先过服务端意图分流（`assistant/dispatch.ts` + `assistant/intent-router.ts`）：命中「今日简报 / 客户跟进 / Gmail 草稿」的走运行时 v2 的计划与执行，用这张目录；其余（`general_answer`）才进 Operator 分支。

结论：读信是自由问答，只登记进 `agent-core` 注册表，**不**登记 `tool-catalog`（运行时 v2 没有读信场景，目录里登记了规划器就可能选到一个没有执行路径的工具）。specs 里有一条 SHALL NOT。

另有两个与入口有关的事实，直接决定了下面的 D1、D3：

- 工具定义没有「渠道」字段，微信对话与网页助手用的是同一张注册表、同样会传入口门（`process.ts` 的 `loadToolEntryGate`）。「只开 web」必须另找落点。
- Operator 分支受灰度控制（`AI_OPERATOR_ENABLED` 与白名单 / 百分比，`feature-flags.ts:45`）。灰度没命中的用户走 legacy 分支，那里没有任何工具。生产上 Sunny 成员的灰度状态代码里看不到。

### 与任务书对不上的地方（以代码为准）

| 任务书 | 代码现状 | 本设计的处理 |
|---|---|---|
| 路径与行号 | 全部对得上（同一提交） | — |
| 「对话上下文内保留工具结果以便追问」 | 不保留，见核对一第 2 点 | 追问靠重新调用工具 |
| 「l2 / l3 工具仍全部经 PendingAction」 | 三个 `l2_soft` 工具直接写库 | 待拍板 B；守卫测试改为「清单冻结」，不断言「全部经审批」 |
| `allowRoles` 与邮箱绑定页受众一致（销售、招投标、外贸、管理员） | `allowRoles` 用平台角色词表，没有「招投标」；`boss` 在列表过滤时被归成 `user`（`tool-registry.ts:29–42`）；执行期对企业成员只看「白名单里有没有非 admin 标签」（`tool-auth.ts:112`）。它表达不了这个受众 | D1：`allowRoles: "*"`，受众由入口门用 `/settings/email` 的同一个放行判定决定 |
| 「渠道只开 web」 | 没有渠道字段 | D1：入口门 |
| `searchMailbox` 返回 `hasAttachments` | Gmail 的 `format=metadata` 只返回 id、标签、头，没有分段，判断不了有没有附件；要判断就得逐封取全文，与「搜索只取元数据」矛盾 | 搜索结果不带 `hasAttachments`；附件在读线程时列出 |
| 「`MAIL_READ_ENABLED` 写法同 `GMAIL_DRAFT_ENABLED`」 | 后者在非生产环境还要第二个开关 `QINGYAN_ALLOW_GMAIL_DRAFT_NON_PROD` | D6：同一处解析、同样要求运行环境隔离评估通过，但不加第二个开关 |
| Impact 文件清单 | 入口门、列表过滤、执行上下文、消息接口都要动 | proposal「Impact」已补全 |
| `tool-catalog.ts` 是否登记「实现时确认」 | 见核对二 | 不登记 |

## Goals / Non-Goals

**Goals:**

- 读信工具只在网页助手里出现，列表与执行期用同一个判定，其它入口 fail-closed。
- 工具没有任何能指向他人邮箱的参数，授权只按调用者 `userId` 取。
- 邮件原文除当轮交给模型外不写到任何地方；审计只有元数据。
- 开关关闭时，工具列表、消息路由、系统提示、状态接口、设置页都与改动前逐项相同。
- 全部测试不连 Google、不依赖数据库（工具通过依赖注入拿 Gmail、客户查询、审计写入）。

**Non-Goals:**

- 不改 `src/lib/agent-core/approval-gate.ts`、`src/lib/agent-core/pre-execute-guard.ts`。
- 不改发信：`src/lib/agent-core/tools/sales-interaction.ts`、`src/lib/assistant/scenarios/gmail-draft.ts`、`src/lib/google-email.ts` 里的 `sendGmail` / `createGmailDraft` / `EMAIL_SCOPES`。
- 不改 `src/lib/tender-rfq/inbound-sync.ts` 及它用到的 `listThreadReplies` / `listThreadMessages` / `getMessageWithAttachments`（读接口只加新函数，不改旧函数的行为）。
- 不改 `src/lib/agent-runtime-v2/**`、`src/lib/agent-runtime/process.ts`、`src/lib/mention-gateway/**`、`src/lib/agent-core/conversation/**`、`src/lib/agent-core/skills/**`、`src/lib/trade/chat-assistant.ts`、`src/app/api/agent-core/**`。
- 不改 `sales_create_quote`、`sales_create_appointment`、`trade_log_follow_up` 等既有写工具的行为与风险等级。
- 不改 `src/lib/context/search-engine.ts`、`src/lib/projects/insight-extract.ts` 本身（只在消息接口里决定这一轮调不调用洞察抽取）。
- 不动 `vercel.json`、`prisma/schema.prisma`、`src/lib/navigation/registry.ts`（受众沿用现有 `route-email-settings` 规则）、`src/lib/feature-flags.ts`。
- MAIL-2 的任何内容（`src/lib/mail-watch/**`、通知类型、客户详情页入口）。

## Decisions

### D1 用入口门实现「只在网页助手、只给邮箱绑定页的受众」

`ToolEntryGate` 增加可选的 `mail`。只有网页助手的消息接口在取入口门时声明自己是网页助手入口，此时 `mail = 读信开关开 ∧ canOpenHref("/settings/email")`（与侧栏、路由门、设置页卡片同一个函数，平台 super_admin 放行、输入缺失不放行）。`registry.list` 在 `mail !== true` 时剔除 `mail_*`。与营销那一项相反，读信是「不传即不给」：微信对话、Agent Core 对话、工具列表接口调用同一个加载函数但不声明网页助手入口，提及网关、技能运行、外贸对话根本不传入口门，都拿不到。`_policy.ts` 里两个工具登记为 `l0_read`、`allowRoles: "*"`。

- 否决：按任务书在 `allowRoles` 里写角色。平台角色词表里没有「招投标」，老板在列表过滤时被归成 `user`，会把任务书点名的受众挡在外面；而执行期对企业成员几乎不看这张白名单，起不到限制作用。
- 否决：给 `ToolDefinition` 加渠道字段。要改所有入口的列表调用并给每个既有工具定默认值，面太大，且和已有的入口门是同一件事的第二种表达。
- 否决：新开一个工具域 `mail`。不传 `domains` 的入口（Agent Core 对话、技能运行）会把所有域都列出来，挡不住。
- 否决：让 Agent Core 对话接口也能读信。它接受调用方自带的系统提示（`chat/route.ts:77`），不可信内容规则无法保证在场。

### D2 执行期由工具自己按同一判定拒绝

`ToolExecutionContext` 增加只读的 `entryGate`，由引擎从服务端的运行选项原样带入（`buildToolContextBase` 加一行）。读信工具执行的第一步检查「开关开 ∧ `ctx.entryGate?.mail === true`」，不满足返回 `MAIL_READ_UNAVAILABLE`，不查客户、不碰 Gmail。这样模型凭空喊出工具名、或别的入口误调，都和列表结论一致。

- 否决：在 `pre-execute-guard.ts` 里加一条「`mail_*` 需要入口门」。任务书明确不改这个文件，而且它是所有工具共用的守卫，不该知道某一类工具。
- 否决：执行期重新查一遍导航上下文。多一次数据库读取，而且列表和执行用两次查询，结论可能不同步；带入同一个已算好的值更稳。
- 否决：读 `runtimeContext.channel`。类型注释写明权限决策不读这个字段，且 Agent Core 对话不传它。

### D3 读信意图的路由：入口门放行时才生效

消息接口在分流之后先算读信入口门（开关关时不算，零额外查询）。`mail === true` 且消息提到邮件 / 邮箱 / 来信 / 回信 / 收件箱（或 email、inbox、gmail）时：本轮走 Operator 分支并带工具，做法与现有的日历意图一致（`route.ts:346–351` 的 `requestedCalendarAction`）。`mail !== true` 时这些词不参与任何判断。

- 否决：把这些词直接加进全局的 `BUSINESS_TRIGGERS`。开关关着的时候也会把「帮我润色这封邮件」从直答改成带工具运行，改变了所有人的现有行为。
- 否决：不强制 Operator，要求运维先把灰度对全员打开。读信能不能用就取决于一组与它无关的环境变量，验收也没法在代码里保证。日历已有「独立执行边界的能力不受灰度影响」的先例。

### D4 Gmail 读接口与查询拼装

`google-email.ts` 的 `GmailReadApi` 补 `messages.list`，并把 `threads.get` 的返回类型补上完整邮件（现有调用只用 `minimal`，不受影响）。新增两个函数：搜索（`messages.list` 取至多 10 个 id，逐封 `messages.get(format=metadata)`）；读线程（一次 `threads.get(format=full)`，沿用现有的「纯文本优先、只有 HTML 时去标签」，附件只读分段上的文件名与大小，不调用附件下载接口）。两个函数入口都先校验授权含读信权限。

查询串由纯函数拼：时间范围、未读、客户地址条件由服务端生成；`query` 按空白切词，每个词去掉引号后加双引号，作为字面关键词。搜索不传 `includeSpamTrash`，Gmail 默认就不含垃圾邮件与已删除邮件。

截断：单封 6,000 字；整线程 20,000 字的额度从最新一封往前分，分不到的旧邮件只留元数据并标 `bodyOmitted`，输出仍按时间正序。

- 否决：允许 `query` 里写 Gmail 运算符（`from:`、`has:attachment`）。任务书要求「模型不自己拼地址」，而且运算符能把范围扩到 `in:spam`、`in:trash`；常用的客户、时间、未读三个条件已经有结构化参数。
- 否决：读线程复用 `getMessageWithAttachments`。它会下载附件。
- 否决：搜索时逐封取全文以得到「是否有附件」。等于每次搜索读 10 封正文。

### D5 工具通过依赖注入拿外部依赖，审计先于返回

`tools/mail.ts` 用一个工厂函数生成两个工具，依赖（Gmail 读函数、授权查询、客户查询、审计写入、开关）可注入，默认接真实实现。执行顺序：入口判定 → 参数校验 → 授权状态（未绑 / 缺读信权限）→ 客户解析与可见性（沿用 `enterprise-readonly.ts:221–232` 的判定与 `resolveEffectiveCustomerId`）→ 读 Gmail → 写审计 → 返回。审计写失败返回 `MAIL_AUDIT_FAILED`，不给内容。错误一律放在返回的 `data` 里（`code`、`message`、`settingsHref`），因为引擎只把 `data` 交给模型。

审计：`action` 为 `mail.read.search` / `mail.read.thread`，`targetType` 为 `mailbox`，读线程时 `targetId` 为线程 id；`afterData` 只有查询条件、命中封数、返回字数。

- 否决：审计失败只记日志、照常返回。读别人写给本人的信是这个功能里最需要留痕的动作，留不下痕就不该读出去。
- 否决：隔离库测试。作用域与审计都能用注入的假实现断言，不需要数据库，CI 里也能跑。

### D6 开关

`isMailReadEnabled(env)` 放在 `env/runtime-isolation.ts`，与 `isGmailDraftAllowed` 同一处、同一个 `envFlag` 解析（`1 / true / yes / on` 为开），并要求运行环境隔离评估通过；不加非生产环境的第二个开关。

- 否决：照搬 Gmail 草稿的双开关。草稿是写 Gmail，非生产环境误连真实邮箱有后果；读信不写任何外部系统，而任务书的上线顺序就是先在 staging 开这一个开关验收，且只新增两个环境变量。

### D7 不可信内容：标记 + 固定提示 +（待拍板 B）写入封锁

成功返回统一包成 `{ untrusted: true, source: "gmail", ... }`，沿用 `agent-runtime-v2/adapters.ts:1196` 的字段名。`buildOperatorSystemPrompt` 增加一个可选入参，读信可用时追加一节固定文字；不可用时输出与现在逐字相同。

写入封锁放在引擎里（`runAgent` 与 `runAgentStream` 各自的一轮运行状态）：某次工具调用成功且工具名以 `mail_` 开头，则把本轮标记为「已读入外部邮件」；此后本轮要执行的工具若风险不是 `l0_read`，直接回 `UNTRUSTED_CONTENT_WRITE_BLOCKED`，不进入授权与审批闸。标记只在内存里，随这一轮结束。

- 否决：只靠系统提示。见待拍板 B。
- 否决：把封锁做进 `approval-gate.ts`。任务书不改它；而且被封的大多数工具根本不经过审批闸。
- 否决：按返回里的 `untrusted` 字段触发。附件证据等既有工具也带这个字段，会改变它们所在运行的行为；按工具名前缀触发只影响读信。

### D8（待拍板 A）回复落库前省略长段原文

消息接口在本轮流式过程中把读信工具返回的各封正文留在内存里。写 `AiMessage` 之前，用一个纯函数把回复里与任一封正文连续重合 120 字以上（空白归一后比较）的段落换成省略标记；本轮调用过读信工具时不调用项目洞察抽取。流给用户的内容不动。

- 否决：A2、A3，理由见「待拍板 A」。
- 否决：给消息加一个「来自邮件」的标记，让搜索索引和洞察抽取跳过它。`AiMessage` 没有可放标记的位置（`workSuggestion` 会被前端当建议卡读取），加列违反零 schema。

### D9 状态接口与设置页

`email-status` 的响应由一个纯函数生成：开关关时与现在逐字段相同；开时 `gmail` 多 `hasReadScope`，顶层多 `mailRead: { enabled: true }`。设置页只在 `mailRead.enabled` 时渲染「读信权限」一项，「重新授权」沿用页面上已有的按钮与 `/api/auth/google-email?reauth=1`。

- 否决：开关关着也返回 `hasReadScope`。暗合并期间不该让前端或别的调用方看到新字段。

## 与八条硬纪律的关系

1. 零 schema：遵守。不加表、不加列、不写迁移；审计用既有 `AuditLog`；不新增 settingsJson 键。
2. 出站先审批：不涉及。本 change 零出站；读过邮件的一轮反而不允许任何写入类工具执行。发信路径一行不改。
3. 禁止第三套队列：不涉及。没有定时任务、队列、lease、worker；`vercel.json` 无 diff。
4. 脱敏：遵守。读信工具不上微信 / Muse 通道（D1），所以邮件正文不会进入那条脱敏口径没有覆盖的通道；不触碰 `muse-bridge`。
5. 不爬登录页：不涉及。只经用户本人授权的 Gmail API 读取。
6. 邮箱分离：遵守。只按调用者 `userId` 取个人 `EmailProvider`；不读、不写组织设置里的 `mailboxEmail` / `fromEmail`；测试用源码断言钉住。
7. 确定性优先：遵守。零新增模型调用；查询拼装、截断、原文省略、入口判定、写入封锁都是纯函数或查表；总结由当轮对话本身完成。
8. 测试注册：遵守。四个新测试文件都在 `src/lib/**/__tests__/` 下，同一 task 内注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`。

## 借鉴来源与许可证

本设计没有参考任何外部仓库的代码或实现细节，全部沿用仓内已有样板（询价回信的读接口、营销工具的入口门、日历意图的路由、附件证据的 `untrusted` 字段）。不引入新依赖。没有复制、引入 `elie222/inbox-zero` 的任何代码或依赖。实现时若参考了 MIT 仓库的具体实现，在 PR 描述里写明仓库、文件与许可证。

## 验证方式

- 四个新测试：
  - `npx tsx src/lib/mail-read/__tests__/mail-read-pure.test.ts`（查询拼装、截断、开关解析、原文省略、状态响应、设置页源码断言）
  - `npx tsx src/lib/agent-core/__tests__/mail-tool-visibility.test.ts`（开关 × 入口 × 受众 × 模块，列表与执行逐格一致；各入口源码断言）
  - `npx tsx src/lib/agent-core/tools/__tests__/mail-tools.test.ts`（参数表、客户作用域、错误码、附件不下载、审计内容、源码断言）
  - `npx tsx src/lib/agent-core/__tests__/mail-untrusted-guard.test.ts`（固定提示、写入封锁、中高风险清单冻结、路由判定、消息接口源码断言）
- 既有测试不改断言仍通过：`tool-list-modules.test.ts`（其中「入口传入入口门」的源码正则跟着新签名改，其余不动）、`pre-execute-guard.test.ts`、`intent-router.test.ts`、`google-email-oauth.test.ts`、`tool-descriptor.test.ts`、`m2c-tool-policy.test.ts`。
- `npm run test:ci`、`npm run typecheck`、`npm run lint:baseline`、`bash scripts/check-test-registry.sh`、`openspec validate mail-read-tools --strict`。
- `git diff --stat main -- vercel.json prisma/` 为空；`git grep -nE "gmail\.modify|mail\.google\.com" -- src` 的结果与 main 相同。
- staging 手工验收（开 `MAIL_READ_ENABLED`，一个测试邮箱）：任务书「验收」里 Lynn、缺权限成员、老板三组。

## Risks / Trade-offs

- [提示注入跨轮残留] 助手上一轮的摘要文字会进入下一轮上下文，里面可能带着邮件里的指令 → 固定提示规则覆盖；下一轮由用户的新消息触发；外发动作仍须审批卡。写入封锁只保证同一轮，这一点在报告里写明。
- [原文省略不等于零内容] 120 字以下的引用和转述仍会随回复落库 → 这是「摘要可存、原文不存」的取舍，由待拍板 A 决定；阈值是一个常量。
- [体验] 读信与写入不能在同一条消息里完成 → 助手在被拒时用一句话说明并请用户再发一条；若试点反馈强烈，按 B2 放开「只出卡」的工具。
- [受众比任务书字面更宽或更窄] 受众完全跟随 `/settings/email` 的放行规则，包括规则以后的变化 → 这是「与邮箱绑定页一致」的字面实现；测试逐岗位比对两者结论。
- [Gmail 配额与耗时] 一次搜索最多 11 次 Gmail 请求，读线程 1 次 → 远低于单用户配额；出错不重试，直接回 `MAIL_PROVIDER_ERROR`。
- [授权状态] OAuth 应用处于「测试中」时刷新令牌约 7 天失效 → 表现为 `MAIL_REAUTH_REQUIRED` 并指向设置页；根因在 Google Cloud Console，属运维前置。
- [可见性规则的既有口径] 客户可见性沿用现有只读工具的判定（创建人 / 全局角色），与页面上的可见范围若有出入，读信跟随工具口径 → 与 `sales_get_customer_interactions` 一致，不在本 change 里另立口径。

## Migration Plan

1. 合并时 `MAIL_READ_ENABLED` 不设（关）。此时线上零变化，由「开关默认关」的三个场景保证。
2. staging：设 `MAIL_READ_ENABLED=true`，用一个测试邮箱跑任务书验收。
3. 生产：确认运维前置四项后设开关并重新部署。
4. 回滚：去掉环境变量并重新部署，立即回到合并前的行为；没有数据需要清理（只多出若干条 `mail.read.*` 审计）。

## Open Questions

以下三项不改变 specs、做法与任务拆分，实现或上线时确认即可：

- `messages.get(format=metadata)` 的响应里是否带 `snippet`：按 Google 文档的理解是带的；实现时用一次真实响应确认。若不带，搜索结果的 `snippet` 为空串，在报告里写明。
- 生产上 Sunny 成员是否已绑 Gmail、授权里有没有只读权限、助手灰度的现状：代码里看不到，上线前由运维核对。
- Google OAuth 同意屏幕的状态（内部 / 外部、测试中 / 已发布）：在 Console 里，上线前确认。
