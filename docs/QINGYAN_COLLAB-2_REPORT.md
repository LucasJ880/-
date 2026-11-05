# COLLAB-2 报告 — 协作通知（collab-notify）

> 任务书：`docs/QINGYAN_COLLAB_NOTIFY_TASKBRIEF.md` §5（含 §5.4 对纪律第 2 条的澄清）；OpenSpec change `collab-notify`；
> 分支 `collab-notify`，基于 origin/main `9f242788`（#378 合并后）。本 change 不加表、字段、迁移或 cron 条目，不调 LLM，不连任何数据库，不改 Vercel 设置。

## 1. 做了什么

**通知类型与偏好（task 1.1）**
- 新增五个类型：`mention`（@提及）、`task_assigned`（任务指派）、`task_status`（任务状态变化）、`task_comment`（任务新评论）、`order_stage`（工艺单阶段变化）。它们进了注册表、设置页名称表、两处图标表与 `TYPE_INTRODUCED_AT`。
- 名称表收进 `NOTIFICATION_TYPE_LABELS` 与 `notificationTypeLabel`，未登记的类型显示"其他通知"。
- 新类型对老用户默认开（D12）：偏好行记下保存时已登记的类型（`knownTypes`）；建行、修改、upsert、update 四处写入都物化生效清单。
- 邮件偏好按"是否明确选过"取生效值（D13，任务书决定 D3）：有 `emailChoiceAt` 时用 `emailEnabled`，否则按开。设置页开关改名为"未读提醒与每日汇总邮件"。
- 偏好行因此都带 `metadata`。主动扫描的自动化一轮原来按"`metadata` 非空"圈人，改为只圈存过自动化设置的人（`proactive/manager-notify.ts`，verify 后修正）。

**公共层（2.1）**
- 脱敏 `collab/redact.ts`：命中金额、电话、地址、Muse strict 词或驾驶舱财务词时，整段换成"（含敏感信息，请在青砚查看）"。
- 统一投递入口 `collab/recipients.ts` + `collab/deliver.ts`，按以下顺序处理：
  - 只保留在职账号、组织 active 成员，排除操作人并去重；
  - 逐人过既有门禁，再按去重键写入，`P2002` 当作已存在；
  - 任何一步出错只记日志，不向外抛，一个人出错不影响其他人。
- 共用跳转表 `notifications/href.ts`：铃铛、通知页、邮件链接用同一张表；新增讨论区锚点（`/projects/<id>?tab=workbench#project-discussion`）与项目文件两个目标。
- 登录回跳 `auth/safe-next.ts`：中间件未登录时跳 `/login?next=…`；`next` 只收站内路径（拒反斜杠、空白、控制字符）；登录页、选择组织页登录后接回锚点。接口请求仍是 401。

**讨论区 @（3.1）**
- 名单最多 20 人，按 userId 去重。被 @ 的人须在职、是组织 active 成员且能看讨论区；任一人不满足，整条 400 `MENTION_NOT_ALLOWED`，只回 id。@ 自己视为满足。
- 带 @ 的消息在事务里加锁 → 查最近 10 分钟的相同消息 → 创建。重发返回 200 + `replayed`，不产生第二条通知。

**任务（4.1）**
- 任务查看规则移到 `src/lib/tasks/access.ts`。
- 新通知：`task_assigned`（创建时指派、改派、取消指派）；`task_status`（含批量改状态）；`task_comment`（已被 @ 的人不再收）；评论里的 @ 发 `mention`。
- 评论 POST 先做查看校验，看不到 → 404。新增 `GET /api/tasks/[id]/mention-candidates`。
- @ 输入抽成纯函数 `mention-input.ts` 与 hook `use-mention-input.ts`，讨论区与任务评论框共用；评论 4xx 时在框下显示错误并保留草稿。

**工艺单与项目文件（5.1）**
- `order_stage` 覆盖四个阶段：已确认、开始生产、备货完成、已排期。
  - 收件人：创建人、商机负责人、下一阶段负责角色；操作人不收。
  - 挂在 `/transition` 与 `PUT /api/blinds-orders/[id]` 两个接口上，按写入前后的状态判断。
- 项目文件上传 → `project_update`，发给 active 项目成员与负责人。

**未读升级邮件（6.1，`collab/escalation.ts`）**
- 触发：`mention`、`task_assigned` 创建满 15 分钟（24 小时内）仍未读 → 一封邮件。挂在 `sales-actions` 的最后一步（自动化 `notify-email-escalation`）。
- 不发的情况：账号停用、非成员、偏好关、免打扰、地址不可投递。原因记在通知 metadata 上，之后不再试。
- 防重：条件更新认领，两轮重叠也只发一封。失败记错误，最多试 3 次。
- 上限：单轮 100 封，截止时刻为路由开始后 285 秒。
- 候选：按创建时间倒序取最近 500 条，处理时从早到晚；取满时运行记录标 `candidatesTruncated`（verify 后修正，原来按升序取）。

**每日未读汇总（7.1，`collab/digest.ts`）**
- 挂在 `daily-brief` 末尾（自动化 `notify-email-digest`），用同一批当地 7 点的组织。
- 收件人是在职 active 成员，跨组织去重。两类简报不计入；不受免打扰影响；偏好关、地址不可投递的不发。
- 内容按类型分组（固定六组在前），组内从新到旧，最多列 50 条，超出加一行"另有 M 条"。
- 每人每天一封：事务里加锁 → 查当天审计 → 写审计 `notifications.email_digest`（不带组织 id），提交后再发。
- 上限：单轮 300 封，截止时刻同上。

**发信层（6.1，`collab/email.ts`）**
- 收件地址只取 `User.email`，过滤 `wechat.user`、`qingyan.internal` 与保留域名。
- 发件人 `青砚 <平台发件地址>`。
- 非生产未开 `QINGYAN_ALLOW_REAL_EMAIL_NON_PROD` 时只记日志（收件人 id 与主题），按已发处理。
- 链接根地址只用 `NEXT_PUBLIC_APP_URL`；真发环境缺它或 `RESEND_API_KEY` 时整轮跳过，并写明缺哪项。

**纪律第 2 条（7.1）**
- `openspec/config.yaml` 第 2 条末尾追加任务书 §5.4 原句。`grep -c '属于站内通知的补位，不算对外发送' openspec/config.yaml` 输出 `1`。

## 2. 改了哪些文件

| 范围 | 文件 |
|---|---|
| 通知类型与偏好 | `src/lib/notifications/{constants,delivery-gate,preferences}.ts`、`src/lib/proactive/{automation-prefs,manager-notify}.ts`、`src/app/(main)/settings/notifications/page.tsx`、`src/components/notification/{notification-list-item,notification-type-toggle-list}.tsx` |
| 公共层（新增） | `src/lib/notifications/collab/{redact,recipients,deliver,events}.ts`、`src/lib/notifications/href.ts`、`src/lib/auth/safe-next.ts` |
| 跳转与登录回跳 | `src/components/header.tsx`、`src/app/(main)/notifications/page.tsx`、`src/middleware.ts`、`src/app/(auth)/{login,select-org}/page.tsx`、`src/app/(main)/projects/[id]/page.tsx` |
| 讨论区 @ | `src/lib/notifications/collab/mentions.ts`（新增）、`src/lib/project-discussion/service.ts`、`src/app/api/projects/[id]/discussion/messages/route.ts`、`src/components/project-discussion/{project-discussion-composer,project-discussion-section}.tsx`、`src/components/project-detail/tabs/workbench-tab.tsx` |
| @ 输入（共用） | `src/lib/notifications/collab/mention-input.ts`、`src/components/project-discussion/use-mention-input.ts`（都是新增） |
| 任务 | `src/lib/tasks/access.ts`、`src/lib/notifications/collab/task-notify.ts`（都是新增）、`src/app/api/tasks/{route,batch/route}.ts`、`src/app/api/tasks/[id]/{route,comments/route}.ts`、`src/app/api/tasks/[id]/mention-candidates/route.ts`（新增）、`src/components/tasks/task-drawer.tsx` |
| 工艺单与项目文件 | `src/lib/notifications/collab/{order-notify,files-notify}.ts`（新增）、`src/app/api/blinds-orders/[id]/route.ts`、`src/app/api/blinds-orders/[id]/transition/route.ts`、`src/app/api/projects/[id]/files/route.ts` |
| 邮件 | `src/lib/notifications/collab/{email,escalation,digest}.ts`（新增）、`src/app/api/cron/sales-actions/route.ts`、`src/app/api/cron/daily-brief/route.ts` |
| 自动化登记 | `src/lib/automation/registry.ts`、`src/lib/cockpit/{schedule,posts}.ts` |
| 纪律 | `openspec/config.yaml` 第 2 条 |
| 测试 | 新增九个：`collab-preferences`、`collab-redact`、`collab-events`、`notification-href`、`collab-mentions`、`collab-mention-input`、`collab-wiring`、`collab-email-escalation`、`collab-email-digest`（`src/lib/notifications/__tests__/`），都注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`；`src/lib/cockpit/__tests__/schedule.test.ts` 加两个门控 / 间隔用例；`src/lib/proactive/__tests__/manager-notify.test.ts` 改一条源码断言（自动化一轮的圈人条件） |
| 文档 | 本报告、`docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md`、`openspec/changes/collab-notify/**` |

## 3. 怎么验

### 3.1 先失败，再实现

每条 task 先写测试并运行，确认失败后再实现到通过。下表"先失败"一列只列本次会话记录里留存的输出；1.1、2.1 的失败输出没有留存。

| task | 先失败 | 实现后 |
|---|---|---|
| 1.1 | 输出未留存 | `collab-preferences` 79 |
| 2.1 | 输出未留存 | `collab-redact` 63、`collab-events` 25、`notification-href` 87 |
| 3.1 | `collab-wiring: 3 passed, 12 failed` | `collab-mentions` 54、`collab-wiring` 15 |
| 4.1 | `Cannot find module '../collab/mention-input'`；`collab-wiring: 19 passed, 41 failed` | `collab-mention-input` 56、`collab-events` 72、`collab-wiring` 60 |
| 5.1 | `collab-wiring: 61 passed, 16 failed` | `collab-events` 104、`collab-wiring` 77 |
| 6.1 | `Cannot find module '../collab/email'`；`collab-wiring: 78 passed, 9 failed`；`schedule.test` 报 `TypeError: Cannot read properties of undefined (reading 'kind')` | `collab-email-escalation` 155、`collab-wiring` 87、`schedule` 197 |
| 7.1 | `Cannot find module '../collab/digest'`；`collab-wiring: 87 passed, 9 failed`；`schedule.test` 同上 | `collab-email-digest` 72、`collab-wiring` 96、`schedule` 202 |
| 8.2（verify 后） | `collab-email-escalation` 三条截断标记的断言失败；`collab-wiring` 一条失败（默认候选查询仍是 `orderBy: { createdAt: "asc" }`）；`manager-notify` 报 `AssertionError`（源码里仍是 `metadata: { not: null }`） | `collab-email-escalation` 159、`collab-wiring` 97、`manager-notify` 24、`collab-preferences` 80（新增的那条断言钉住既有行为，加上就通过） |

### 3.2 门禁

结果见下表，原始输出见附录。

| 命令 | 结果 |
|---|---|
| 九个新测试逐个 `npx tsx …` | `collab-preferences` 80、`collab-redact` 63、`collab-events` 104、`notification-href` 87、`collab-mentions` 54、`collab-mention-input` 56、`collab-wiring` 97、`collab-email-escalation` 159、`collab-email-digest` 72，全部 0 失败 |
| 既有：`manager-notify` | 24 passed（改了一条源码断言，见 §3.4 W2） |
| 既有：`delivery-gate` / `mark-all-read` | 通过 / 18 passed |
| 既有：`src/lib/cockpit/__tests__/{schedule,daily-digest,posts,posts-read-model}.test.ts` | 202 / 53 / 226 / 139，全部通过 |
| 既有：驾驶舱 `timeline` / `waiting` / `workload` / `org-cockpit-view` | 53 / 58 / 94 / 79，全部通过 |
| 既有：`status-transition` / `fulfillment` 的 `category`、`order-access` | 23 / 18 / 17，全部通过 |
| 既有：`marketing-middleware-access` / `wechat-entry-render` | 3 / 62，全部通过 |
| 既有：INSTALL-2b `balance.test.ts` | 56 passed。第一次全量时它的两条源码断言失败，已修，见 §3.3 |
| `action-loop-contract` | 3 过 1 败，与基线相同。失败项"第四阶段自动扫描…"在 `ci/test-registry-baseline.txt` 里，与本 change 无关 |
| `bash scripts/check-test-registry.sh` | 通过：已注册 535 个；历史欠账基线剩余 71 条，未增加 |
| `npm run typecheck` | 退出 0（先把本地 build 生成的 `.next/types` 挪开，原因见 §3.3） |
| `npm run lint:baseline` | PASS，无新增 error fingerprint |
| 改动的 60 个 ts / tsx 文件单独 `npx eslint` | 0 error、3 warning，都是 origin/main 上就有的：登录页与工作台 tab 各一处 `<img>`，`task-drawer.tsx` 未使用的 `TASK_STATUS` 导入 |
| `openspec validate collab-notify --strict` | `Change 'collab-notify' is valid` |
| `npm run build` | 退出 0，408 个页面生成完。两道部署前检查在本地按设计跳过（`VERCEL_ENV` 未设置）。编译警告都来自第三方包或既有模块（Sentry / Prisma instrumentation、`html-to-pdf.ts`、中间件里 jose 的 Edge Runtime 提示），在 origin/main 上就有 |
| 不动项 diff（命令见附录） | 输出为空。命令里 Bridge 接口的路径写错了，按真实路径补跑也为空，见附录后的更正 |
| `grep -c '属于站内通知的补位，不算对外发送' openspec/config.yaml` | `1` |

### 3.3 全量

环境与 COLLAB-1 报告 §3.2 相同：本机没有任何数据库（worktree 里没有 `.env`，`DATABASE_URL` 未设置；按要求不连生产库），shell 也没有导出 `NODE_ENV=test`。

| 命令 | 结果 |
|---|---|
| `npm test`（第一次，提交 `1ef09b92`） | 546 / 559，13 个失败：基线的 12 个，加上 INSTALL-2b「尾款口径 / 确认校验 / 通知落点」 |
| `npm test`（`61ed36a9` 之后） | 547 / 559，12 个失败（下表） |
| `npm test`（verify 修正后第一次） | 546 / 559：多出的一个是全量里的"TypeScript 类型检查"，被本地 build 留下的 `.next/types` 撑爆堆上限（见下文），与代码无关 |
| `npm test`（verify 修正后，挪开 `.next/types`，最终工作树） | **547 / 559**，12 个失败与 `61ed36a9` 那次逐条相同（下表）。559 = COLLAB-1 时的 550 + 本 change 新增 9 个。九个新测试与 `manager-notify` 在全量里都通过；全量里的"TypeScript 类型检查""测试注册校验"也通过 |
| `npm run test:ci` | `CI unit subset PASS`，退出 0。CI 子集导出 `NODE_ENV=test`；九个新测试在子集里的通过数与上面相同 |

INSTALL-2b 那一条是本 change 引起的，原因与修复如下：
- 它的源码断言要求 `header.tsx` 与通知页都直接调用 `installNotificationHref`，并从 `@/lib/install/balance` 导入。
- 2.1 把两处跳转收进了共用的 `notificationHref`。`notificationHref` 内部同样先查安装类规则，行为没变，但这条断言失效了。
- `src/lib/install` 属于不动项，测试不改。改为在两个调用处写 `installNotificationHref(item) ?? notificationHref(item)`，与 origin/main 上的写法一致（提交 `61ed36a9`）。

本地 typecheck 的一个坑（与本 change 的代码无关）：tsconfig 显式包含 `.next/types/**/*.ts`。本地跑过一次 `npm run build` 之后，那里有 905 个生成文件，再跑 `npm run typecheck`（以及全量里的"TypeScript 类型检查"）会在本机约 4 GB 的默认堆上限处崩溃，exit 134。verify 后第一次重跑全量就因此多了一个失败。把 `.next/types` 挪开后 typecheck 退出 0，峰值常驻约 3.4 GB。CI 在全新 checkout 上、build 之前跑 typecheck，不受影响。

剩下的 12 个失败，与 COLLAB-1 报告 §3.2 列的完全相同（当时已在 origin/main 干净快照上逐条确认同样失败）：

| 失败的测试 | 原因 |
|---|---|
| Agent Trace 只读查询；Phase3A-2 Ledger DB、Phase3A-2 Smoke Access；Phase3A-3 Approvals Smoke；Governance Hygiene Gate、Governance Hygiene Concurrency Gate；Phase3A-4 Governance Smoke、Phase3A-4 Acceptance；Phase3A-5 Settle DB、Phase3A-5 Overview Acceptance（10 条） | 测试库安全检查 `Mode: blocked (MISSING_DATABASE_URL)`：没有隔离库时按设计拒跑 |
| T4 授标情报真实 Postgres 矩阵 | `REFUSED: 需要 DATABASE_URL（隔离 DB）` |
| Gmail Draft OAuth Compose Scope | `AssertionError [ERR_ASSERTION]: GMAIL_DRAFT_ENABLED=true → 开启`：`test-all.sh` 跑它时不设 `NODE_ENV=test`（COLLAB-1 报告已说明） |

### 3.4 `/opsx:verify collab-notify`

8 条 task 全部完成之后跑的。结论：没有 CRITICAL，3 条 WARNING、4 条 SUGGESTION。逐条对照代码核实后，都按下表处理了（task 8.2）：

| 条目 | 核实结果 | 处理 |
|---|---|---|
| W1 邮件偏好"明确选过"的口径 | spec 没说上线前保存过的行怎么算；实现按开（`emailChoiceAt` 只由上线后的修改请求写入） | spec 写明"上线后的修改请求带过 `emailEnabled` 才算选过"，补场景"上线前保存过设置页"；`collab-preferences` 补一条断言；§7 补一条风险 |
| W2 自动化一轮的候选 | 属实。`manager-notify.ts` 以偏好 `metadata` 非空圈人（取 100 人），上线后人人的偏好行都带 `knownTypes`，开了自动化的人会被挤出前 100 | 改为 `metadata` 含 `"automation":`（design D12 实施细化）。已归档的 `cockpit/manager-proactive-notify` 写的是"处理完开了自动化偏好的用户之后"、自动化那一轮"行为 SHALL 不变"，这次修正是为了守住它，对外行为不变，所以没有 spec 增量 |
| W3 升级邮件候选饿死 | 属实。按升序取前 500 条，发过邮件仍未读的通知占满窗口后，新通知进不了候选 | 改为倒序取最近 500 条、处理时仍从早到晚；取满时标 `candidatesTruncated`（design D14、spec 新场景） |
| S1 提及通知的去重键 | activity-events 的通用格式与 mentions 的格式不一致 | 通用要求里注明提及除外 |
| S2 候选人接口的组织条件 | 代码是"项目属于组织"才取组织成员，spec 只写了"属于项目" | spec 按代码改 |
| S3 运行记录"每次都记" | 前面的既有步骤抛错时本步骤不跑 | spec 写明这个例外 |
| S4 design 与实现不同步 | 三处没写进 design | D9、D11、D15 补"实施细化" |

## 4. 与任务书的出入

**任务书 §3 的代码位置**：在 origin/main 上重新核对过，出入记在 design「任务书 §3 核对」表里。要点如下：

| 任务书 | main 上实际 | 处理 |
|---|---|---|
| `sourceKey` 唯一 | 单列唯一，不含 userId | 去重键末尾带收件人 id；并发冲突当作已存在（D2） |
| 铃铛跳转 | 铃铛与通知页各写一份，分支已不一致，都不认 `project_discussion` | 共用一张表（D11）。安装类在两个调用处仍直接先调 `installNotificationHref`，因为 INSTALL-2b 的 `balance.test.ts` 源码断言要求这样，而 `src/lib/install` 属于不动项（提交 `61ed36a9`） |
| 投递门禁 | 新类型的 grandfather 比较偏好行 `updatedAt`，任何写入都会刷新它 | 改为清单记 `knownTypes`（D12） |
| 邮件偏好 `emailEnabled` | 默认 false；偏好行自动建，"没有偏好记录"几乎不会出现 | 按 `emailChoiceAt` 取生效值（D13） |
| 平台发件 | `sendEmail` 不查非生产门禁，也没有只记日志模式 | 门禁与只记日志放在发信层（D16） |
| 讨论区 @ | 存进 metadata，不校验，不合规的形状被静默丢弃 | 整条 400（D3） |
| 任务评论 | 评论 GET / POST、活动 GET 不查访问权；批量改状态绕过状态机 | 评论 POST 补查看校验；批量只补通知；其余不修（Out of scope） |
| 订单阶段 | 详情页的确认 / 完成走 `PUT`，绕过状态机 | 两个接口都挂（D6） |
| 项目上传 | 没有任何路径调 `notifyProjectMembers` | 只在 `POST /api/projects/[id]/files` 补（D8） |
| （未列） | 账号邮箱里有 `wx_…@wechat.user`、`system@qingyan.internal` 等占位地址 | 收件地址过滤（D16） |
| （未列） | 中间件跳登录不带 `next`；`safeNext` 放过 `/\evil.example` | 带上 `next` 并收紧校验（D11） |
| （未列） | `resolveAppOrigin()` 回落到 `https://qingyan.ai`，生产站点是 `https://qingyan.ca` | 邮件链接只用 `NEXT_PUBLIC_APP_URL`，真发环境缺它就不发（D16） |

**实施中定下的细节**：下表是实施时定下的做法。跳转、已排期日期、偏好圈人、升级邮件、运行状态与汇总几项已写进 design（D9、D11、D12、D14、D15 的"实施细化"）；其余是实现层面的细节，只记在这里。

| 项 | 做法 |
|---|---|
| tasks.md 之外的新文件 | `task-notify.ts`、`order-notify.ts`、`files-notify.ts`、`email.ts`、`use-mention-input.ts`：把接口里的通知调用与发信层拆出来，路由只多一两行 |
| 偏好接口 | `PATCH /api/notifications/preferences/me` 不用改：生效清单与 `emailChoiceAt` 在 `preferences.ts` 里写 |
| 铃铛"记住所选组织" | 与通知页此前的规则一致 |
| 选择组织页 | 401 时保留 `next` |
| @ 摘要脱敏 | 按完整正文判断，不按截断后的 80 字 |
| 没有组织的项目 | 候选人回落到创建人与负责人（D5 修订） |
| 任务查看 | `canUserViewTask` 对创建人 / 负责人直接放行 |
| 已排期摘要 | 安装日期取 `expectedInstallDate`，按组织时区 |
| 阶段名称 | 通知里用任务书的四个阶段名，与 `STATUS_LABELS` 的字面不同 |
| 工艺单编号 | 创建通知时不单独脱敏；邮件里对象会再脱敏一次，10 位以上数字的编号可能被整段替换 |
| 项目文件通知 | `entityId` 是项目 id（落到项目页） |
| 工艺单收件人 | 访问判断在写入后重算；已确认 / 开始生产的负责角色按该单品类的履约推进键找，不按全品类键（只持全品类键的人不收） |
| 任务 @ 候选人 | 按任务查看规则逐个过滤，每批并发 20 人 |
| 评论重放 | 返回 200 + `{ ...comment, replayed: true }` |
| 升级邮件 | 认领时清掉上次的错误；结果写入只以认领时的 metadata 为条件（读了也照记）；metadata 不可读的通知不处理、不覆盖；成员口径：通知有组织 → 该组织的 active 成员，没有组织 → 任一在用组织的 active 成员 |
| 运行状态 | 没有发出也没有失败 → `skipped`；有单封失败 → `partial`；整步抛错 → `failed` |
| 只记日志的环境 | 不要求 `RESEND_API_KEY` / `NEXT_PUBLIC_APP_URL`；没设站点地址时链接是相对地址，只出现在不出站的日志正文里 |
| 主题截断 | 对象取前 40 个字符，不加省略号（与项目里其他主题一致） |
| 汇总 | 先按显示顺序（组顺序、组内从新到旧）排好再取前 50 条；每人最多取 1000 条来排版；审计的 `userId` 与 `targetId` 都是收件人；固定六组之外的组按 `zh-Hans-CN` 排序（拉丁字母排在汉字之后） |

**与 TASKFLOW 的冲突**：Phase S 的 S4 写着"签发 Connector Token"，任务书 D6 定为"Muse--Bridge-bot 的 Connector 永久冻结"。本 change 不涉及 Connector，S4 那一行没改，请 Evan 定夺是否把 S4 标为作废。

## 5. 运维前置（Evan 操作；本 change 不改 Vercel 设置）

1. 生产（Vercel 项目 `-`，Production）确认 `NEXT_PUBLIC_APP_URL=https://qingyan.ca`，并确认已有 `RESEND_API_KEY`。
2. 改了环境变量要重新部署，Vercel 的环境变量只对新部署生效。
3. 设好之前：两个邮件自动化在驾驶舱显示"未配置"，每轮记为跳过，并写明"缺少发信配置：…"。站内通知、@ 校验与跳转不受影响。
4. 设好之后：
   - 升级邮件在下一轮（15 分钟内）开始。
   - 汇总在各组织的下一个当地 7 点开始。老用户第一封汇总会带积压的未读，最多列 50 条。
5. 紧急停发：回退本 PR。本 change 没有单独的邮件总开关（任务书未要求）。

## 6. 在 staging 走 GATE 1–8

本地 `.env` 直连生产库，不在本地跑。在本 PR 的 qingyan-staging 预览部署上，用两个测试账号 A、B 验收。

**准备**
- 测试组织里 A、B 都是 active 成员；A 要有把任务指派给别人的权限（如组织管理员）。
- 一个测试项目，A、B 是项目成员；另有一个不是项目成员的账号 C。
- 一张测试工艺单，状态为"备货完成"。
- 要收到真实邮件：
  - Evan 在 qingyan-staging 的 Preview 环境临时设 `QINGYAN_ALLOW_REAL_EMAIL_NON_PROD=1`、`NEXT_PUBLIC_APP_URL=<该预览地址>`，确认有 `RESEND_API_KEY`，然后重新部署。
  - A、B 的账号邮箱要能收信。
  - 不开真发时，函数日志里只有一行 `[collab-email] 非生产只记日志，未发送：收件人 <id>，主题「…」`。
- 定时任务只在生产部署上自动触发；预览上手动调，并带 `Authorization: Bearer <CRON_SECRET>`。预览开了访问保护时，还要带 bypass 头。

**步骤**
1. A 把一条任务指派给 B → B 的铃铛出现未读"任务指派"，点开落到 `/tasks?open=<任务 id>`；A 没有新通知。
   - 页面上没有负责人选择界面，指派要走接口：A 登录后在浏览器开发者工具里执行 `fetch("/api/tasks/<任务 id>", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ assigneeId: "<B 的用户 id>" }) })`。
2. 升级邮件：
   1. B 不读，过 15 分钟后调一次 `GET /api/cron/sales-actions` → B 收到主题为 `【青砚】任务指派 · 任务「…」` 的邮件，响应里 `notifyEmailEscalation` 有 `sent: 1`（只记日志时是 `dryRun: 1`）。
   2. 再调一次 → 不重发。
   3. 另指派一条，B 先在青砚点开 → 15 分钟后调 → 不发。
   - 时间条件另由 `collab-email-escalation` 的注入时间单测覆盖。
3. B 在该任务的评论里 @A → A 收到"@提及"，点开是该任务。用浏览器开发者工具把同一个评论 POST 原样重放 → 返回 200 且 `replayed: true`，A 没有第二条。
4. 在项目讨论区 @C（C 不是项目成员）→ 发送失败，`400 MENTION_NOT_ALLOWED`，输入框保留草稿；讨论区没有新消息，C 没有通知。
5. A 把测试工艺单从"备货完成"转到"已排期" → 创建人、商机负责人、排期负责角色各收到一条"工艺单阶段变化"（工艺单有预计安装日期时，摘要带上日期）；A 作为操作人不收。
6. 每日汇总：
   - 由 `collab-email-digest` 的注入时间单测代替（模拟组织当地 7 点：分组、50 条上限、无未读不发、每人每天一封）。
   - 可选：在测试组织当地 7 点那一小时调 `GET /api/cron/daily-brief` → 有未读的人收到 `【青砚】今日未读 N 条`，没有未读的人不收；同一天再调不重发。这一调也会照常生成当天的简报。
7. B 在 设置 → 通知 关掉"未读提醒与每日汇总邮件"，重复第 1、2 步 → B 只有站内通知；响应里 `notifyEmailEscalation.skippedByReason.email_off` 为 1，没有邮件。
8. 在讨论区或任务评论里写一段含金额、电话或地址的内容，并 @ 对方 → 通知摘要与邮件里那段换成"（含敏感信息，请在青砚查看）"。另外检查：
   - 邮件主题以 `【青砚】` 开头；
   - 正文每条一行，格式为 `类型｜对象｜截止 日期｜链接`。

**收尾**：Evan 删掉 Preview 上临时加的 `QINGYAN_ALLOW_REAL_EMAIL_NON_PROD`。

## 7. 已知限制与风险

- **批量改状态不查访问权**：`POST /api/tasks/batch` 原本就不查（Out of scope），所以能对任意任务 id 触发 `task_status` 通知。评论 GET 与活动 GET 同样不查。
- **升级邮件的候选窗口**：每轮按创建时间倒序取最近 500 条，其中包括已发过、仍未读的（design 否决了在 SQL 里按 metadata 过滤）；取满时运行记录标 `candidatesTruncated`。新到的通知总在前 500 条之内；只有全平台 15 分钟内涌入 500 条以上这两类通知，或连续几轮每轮都超过 100 封可发时，最早的那部分可能一直轮不到，只能靠当天的每日汇总兜住。
- **`sales-actions` 前几步没有隔离**：前一步整体抛错时，这一轮的升级邮件不跑；下一轮补上（spec 已写明这个例外）。`daily-brief` 同理，简报整步抛错时当天不发汇总。
- **上线前关过邮件开关的人也会开始收邮件**：旧设置页的邮件开关旁写着"当前未连接发信"，存下的值不算选择（任务书 D3、design D13）。上线前在设置页把它关掉的人，上线后要再关一次才不收。
- **改派时也会升级**：发给原负责人的那条 `task_assigned`（medium）同样会升级成邮件，这是按任务书 §5.2 的字面。只想提醒新负责人的话，把升级条件限定为 high 即可。
- **免打扰固定按多伦多时间**：与站内门禁一致，属于既有问题。
- **紧急停发**：只能回退 PR。

## 附：门禁命令原始输出（Node 24.22.0，最终工作树）

```
$ openspec validate collab-notify --strict
Change 'collab-notify' is valid
exit=0

$ npm run typecheck
> qingyan-ai@0.1.0 typecheck
> tsc --noEmit
exit=0

$ npm run lint:baseline
> qingyan-ai@0.1.0 lint:baseline
> node scripts/check-eslint-baseline.mjs
[eslint-baseline] mode=check
[eslint-baseline] sourceCommit=2255f8da919c883bc9e2f210209782c40ee5eaae
[eslint-baseline] current errors=38 warnings=146 fingerprints=18
[eslint-baseline] baseline errors=53 warnings=111 fingerprints=24
[eslint-baseline] 信息：相对基线减少了 15 处 error 出现（允许）
[eslint-baseline] PASS（无新增 error fingerprint / 无 count 上升）
exit=0

$ bash scripts/check-test-registry.sh
OK 测试注册校验通过：已注册 535 个；历史欠账基线剩余 71 条（只减不增）
exit=0

$ git diff --stat origin/main...HEAD -- prisma vercel.json src/lib/trade/email.ts src/lib/trade/email-sender.ts src/lib/env/runtime-isolation.ts src/lib/time/quiet-hours.ts src/lib/project-discussion/access.ts src/lib/fulfillment src/lib/install src/lib/muse-bridge src/app/api/muse-bridge src/lib/messaging
（无输出）
exit=0

$ grep -c '属于站内通知的补位，不算对外发送' openspec/config.yaml
1

$ npm test        # 最终工作树（verify 修正后，.next/types 已挪开）
…
manager-notify: 24 passed
collab-preferences: 80 passed, 0 failed
collab-redact: 63 passed, 0 failed
collab-events: 104 passed, 0 failed
notification-href: 87 passed, 0 failed
collab-mentions: 54 passed, 0 failed
collab-mention-input: 56 passed, 0 failed
collab-wiring: 97 passed, 0 failed
collab-email-escalation: 159 passed, 0 failed
collab-email-digest: 72 passed, 0 failed
…
═══════════════════════════════════════════════════
  测试结果: 547/559 通过, 12 失败
═══════════════════════════════════════════════════
❌ 有测试失败
exit=1            # 12 个都是 §3.3 表里的基线失败

$ npm run test:ci
…
runtime-architecture guards PASS
OK 测试注册校验通过：已注册 535 个；历史欠账基线剩余 71 条（只减不增）

CI unit subset PASS
exit=0
```

**更正（2026-11-05）**：上面附录里"不动项"那条命令写的 `src/app/api/muse-bridge` 在仓库里不存在，Bridge 接口的真实路径是 `src/app/api/bridge/muse`，所以那条命令没有覆盖到 Bridge 接口。归档的 `openspec/changes/archive/2026-11-05-collab-notify/design.md` 第 62、336 行是同样的写法，归档文件不改。下面按真实路径补跑，范围从 #379 合并前的 main（`9f242788`）到 #380 合并后的 main（`ed6f609b`）。两条都没有输出，说明 COLLAB-2 没有改动 Bridge 接口：

```
$ git diff --stat 9f242788 ed6f609b -- src/app/api/bridge/muse
（无输出）
exit=0

$ git log --oneline 9f242788..ed6f609b -- src/app/api/bridge/muse
（无输出）
exit=0
```
