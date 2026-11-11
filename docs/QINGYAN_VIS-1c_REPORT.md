# VIS-1c 报告：通知、设置、搜索、AI 工具按同一张表收口

change：`vis-1c-notify-settings-search`（任务书 `docs/QINGYAN_VIS-1_VISIBILITY_TASKBRIEF.md`；并入 VIS-1b 遗留的首页时间线、「总览」入口与「等你 N 件」规格拆分）。design「审核关注点」Q1–Q9 由 Lucas 2026-11-10 全部按推荐拍板。分支 `claude/vis-1c-notify-settings-search`，依赖 VIS-1a / 1b（#393、#400）与搜索修复 #409。

## 1. 用户现在会怎么看到

- **通知设置与通知页筛选**：只列你打得开其处理页面的通知类型。
  - 销售（Lynn / Alex）不再看到「供应商报价了」「催单待批」等 4 个询价开关，通知页筛选没有「项目分发」。
  - 询价通知只对招投标与老板列出；会计、运营、出单不再看到。
  - 安装工、无岗位成员不再看到「项目与配置变更」「报价让利审核」等。
  - 被藏起来的类型照旧按你原来的开关投递，保存设置不会改动它们。
- **`/settings`**：
  - 梦馨的发信说明改由企业设置决定，标题是「〈企业名〉发信通道」，界面上不再写 Cathy、QQ 与询盘邮箱。
  - 「邮箱绑定」卡只给打得开 `/settings/email` 的人：安装工、运营、会计、出单、无岗位成员不再看到它（他们本来就打不开）。
- **全局搜索**：项目结果只给你打得开的项目——本人负责的、你管理的企业里的、你参与的。不是项目成员的销售搜不到项目；普通成员不再搜到全企业项目名。
- **AI 助手工具**：
  - 企业没开的模块，它的工具不再递给模型（以前列表里有、执行时被拒）。
  - 营销工具改为需要「营销」模块，且网页助手、Agent Core、微信对话里只给能进「品牌增长」的人。销售对话里不再出现营销工具。
- **数字员工工作台**：「营销增长数字员工」卡片只给能打开营销数字员工页的人（运营、运营主管、老板）。
- **侧栏「管理总览」**：只对管理层（老板岗位与平台管理员）出现。
- **手机底栏首格**：会计是「会计」，出单、无岗位、梦馨外贸是「任务」，老板仍是「总览」。
- **首页时间线**：
  - 平台级自动化只列你看得到的岗位的。Sunny 老板不再看到「运维与知识」「询盘销售」下的运行，例如发布漂移检查。
  - 作业行只在你读得了该作业时带链接；不可见岗位的名字不显示。

## 2. 改了什么

- **通知类型**：
  - 新增 `src/lib/notifications/type-visibility.ts`：类型 → 处理页面对照、通知页筛选对照、`visibleNotificationTypes` / `visibleNotificationFilters` / `toggleEnabledType`。
  - `notification-type-toggle-list.tsx` 与 `notifications/page.tsx` 按它过滤；判定输入未就绪时不列，取失败时提示并可重试；通知页只认最新一次请求的响应。
- **发信文案**：
  - 新增 `src/lib/settings/sender-copy.ts`（读写 `settingsJson.ui.senderCopy`、通用代发文案）。
  - `GET /api/organizations` 两条分支多一个 `senderCopy`（不透出 `settingsJson`）；`OrgSummary` 加同名字段。
  - `/settings`、`/settings/email` 去掉 `MENGXIN_ORG_CODE`；「邮箱绑定」卡按 `canOpen("/settings/email")`。
  - 新增 `scripts/set-org-sender-copy.ts`；梦馨种子脚本同步写入 `platform_relay`。
- **搜索**：`src/lib/search/where.ts` 加 `buildReadableProjectWhere`、`shouldSearchProjects`；`api/search/route.ts` 项目结果 = 项目详情门 ∧ 详情页读判定，判定输入取路由门同一份（30 秒缓存、不写库）；任务范围不变。
- **AI 工具**：
  - `tool-auth.ts` 导出 `toolRequiredModules`（`marketing_*` → `marketing`）与 `toolModulesSatisfied`，`canInvokeTool` 改调后者。
  - `registry.list` 加 `modulesJson`、`entryGate` 过滤；`engine.ts` 两处转给列表；新增 `entry-gate.ts` / `entry-gate-server.ts`。
  - 入口门接在网页助手对话、Agent Core 对话、`GET /api/agent-core/tools` 与微信对话（`agent-runtime/process.ts`）。
- **营销卡片**：工作台按 `canOpen("/marketing/employee")`；`canUseMarketingDigitalEmployee` 保留给营销员工接口与微信路由。
- **「管理总览」与底栏**：`NavigationItem.managementOnly`（岗位模式按 `isManagementWorkspaceUser`），`work-home` 标上；`mobile-tabs.ts` 首格按落地页，`mobile-tab-bar.tsx` 补「任务」「会计」图标与高亮。
- **首页时间线**：`CompanyLogDeps.navContext`（与岗位总览共用 `resolveCockpitNavContext`）；自动化来源在查询里按 `visibleAutomationKeys` 过滤（super_admin 不限）；作业链接按 `canReadJobByExplicitDomain`；`CompanyLog` 只显示可见岗位的名字。
- **规格**：12 份增量（3 个新 capability，9 份改既有规格），含 `cockpit/posts-overview`「等你 N 件」拆成四条（只改规格）。
- **测试**：新增 `type-visibility`、`sender-copy`、`tool-list-modules`（均已注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`）与共享身份夹具 `src/lib/navigation/__tests__/identity-fixtures.ts`（非测试文件）。
- **硬纪律**：零 schema（发信文案落在既有 `Organization.settingsJson`）、不新增权限键、零 LLM 调用、不触碰出站、不新增队列 / cron。

## 3. 按身份的结果（按真实实现计算；Sunny / 梦馨默认模块，岗位模式，微信开关关）

| 身份 | 看不到的通知类型 | 筛选里看不到 | 搜项目 | 邮箱绑定卡 | 营销工具 / 卡片 | 底栏首格 | 侧栏「管理总览」 |
|---|---|---|---|---|---|---|---|
| 销售 `sales_rep`（Lynn / Alex，非项目成员） | rfq_* | 项目分发 | 否 | 有 | 无 / 无 | 销售底栏 | 无 |
| 是项目成员的销售 | rfq_* | — | 是 | 有 | 无 / 无 | 销售底栏 | 无 |
| 合价 `pricing_lead` | rfq_* | 项目分发 | 否 | 有 | 无 / 无 | 销售底栏 | 无 |
| 老板 `owner`（Bill / Miki / Lucas / Bob） | — | — | 是 | 有 | 有 / 有 | 总览 | 有 |
| 招投标 `bids`（蒋晨） | quote_signed、sales_daily_briefing、order_stage | 报价让利审核 | 是 | 有 | 无 / 无 | 招投标 | 无 |
| 运营主管 `ops_lead`（Marty） | rfq_*、quote_signed、sales_daily_briefing | 报价让利审核 | 是 | 无 | 有 / 有 | 运营 | 无 |
| 运营 `ops_staff`（Maggie） | rfq_*、install_*、quote_signed、sales_daily_briefing、order_stage | 报价让利审核 | 是 | 无 | 有 / 有 | 运营 | 无 |
| 会计（只持 `accounting`） | rfq_*、quote_signed、sales_daily_briefing | 报价让利审核 | 是 | 无 | 无 / 无 | 会计 | 无 |
| 安装工 `installer` | rfq_*、project_update、agent_task、quote_signed、sales_daily_briefing、order_stage | 项目分发、项目更新、报价让利审核 | 否 | 无 | 无 / 无 | 安装 | 无 |
| 出单 `fulfillment_vinyl` | rfq_*、quote_signed、sales_daily_briefing | 报价让利审核 | 是 | 无 | 无 / 无 | 任务 | 无 |
| 出单 `fulfillment_shades`（yee） | rfq_*、quote_signed、sales_daily_briefing | 报价让利审核 | 是 | 无 | 无 / 无 | 任务 | 无 |
| 无岗位成员 | rfq_*、install_*、project_update、agent_task、quote_signed、sales_daily_briefing、order_stage | 项目分发、项目更新、报价让利审核 | 否 | 无 | 无 / 无 | 任务 | 无 |
| 梦馨 Cathy（`owner` + `trade_rep`） | rfq_*、install_*、quote_signed、order_stage | 项目分发、报价让利审核 | 否 | 有 | 有 / 有 | 总览 | 有 |
| 梦馨外贸 `trade_rep` | rfq_*、install_*、project_update、agent_task、quote_signed、sales_daily_briefing、order_stage | 项目分发、项目更新、报价让利审核 | 否 | 有 | 无 / 无 | 任务 | 无 |
| 平台 super_admin（未绑岗位） | — | — | 是 | 有 | 有 / 有 | 总览 | 有 |

说明：
- 「搜项目」为「是」时只搜得到可读的项目：普通成员（会计、运营、出单等 org_member）只搜到自己负责或参与的项目；老板（org_admin）搜到本企业已分发项目。
- 「营销工具」指人类对话（网页助手、Agent Core、微信）的工具列表；数字员工与后台运行不受入口门影响。
- 侧栏「管理总览」只在岗位模式按管理层判定；纯销售走销售侧栏，改动前就没有这一项。

## 4. 通知类型生产方核对

按「生产方写的 `entityType` 经跳转表落到哪」逐类核对（grep 生产方 + Muse 桥 `muse-bridge/events.ts` 的类型映射），处理页面取落点，无跳转的取其工作区：

| 类型 | 生产方写的 entityType / 落点 | 处理页面 |
|---|---|---|
| `task_due`、`calendar_event`、`mention`、`task_assigned`、`task_status`、`task_comment`、`followup`、`system` | 任务、项目讨论、采购记录请求、销售客户 / 商机 / 外贸线索、提醒；部分无链接 | `/tasks`（登录即可，对所有成员可见） |
| `project_update` | 项目、项目文件、询价轮次、情报监控、采购扫描、标书分析；Muse 询问事件 `muse_inquiry`（发给销售） | 项目详情、情报监控、询盘回复页 |
| `agent_approval` | 项目审批 `approval_request`；Muse 审批事件（发给审批人或提交人） | 审批详情（对全体成员放行） |
| `agent_task` | 标书包 `agent_task`；效果图高清渲染 `visualizer_session`（发给销售） | 项目详情、效果图 |
| `rfq_*` | 询价轮次 `tender_rfq_round`（只发给投标项目负责人） | 招投标中心 |
| `quote_signed` / `sales_daily_briefing` | 报价单 / 销售简报（部分无链接） | 报价单 / 销售首页、客户与商机 |
| `install_*` | 按收件人落会计待收尾款、维修单或工艺单 | 安装、会计、工艺单详情 |
| `order_stage` | 工艺单 `blinds_order` | 工艺单详情 |

已知例外：不是招投标岗位的人当了投标项目负责人时，会收到 `rfq_*` 但看不到其开关（通知照常投递）。

## 5. 测试与门禁（实际运行）

受影响测试（基线 2026-11-09 origin/main 439a19a，2026-11-10 变基到 c70a0ca 后复跑数值不变 → 改动后，均 `npx tsx <file>` 实跑）：

| 测试 | 基线 | 改动后 |
|---|---|---|
| `type-visibility.test.ts`（新，已注册） | — | 45 |
| `sender-copy.test.ts`（新，已注册） | — | 35 |
| `tool-list-modules.test.ts`（新，已注册） | — | 37 |
| `search-where.test.ts`（#409） | 10 | 28 |
| `entry-visibility.test.ts` | 56 | 73 |
| `position-nav.test.ts` | 98 | 101（非管理层快照去掉 `work-home`） |
| `posts-read-model.test.ts` | 156 | 162 |
| `timeline.test.ts` | 53 | 63 |
| `org-cockpit-view.test.tsx` | 86 | 91 |
| `collab-preferences.test.ts` / `notification-href.test.ts` | 104 / 91 | 104 / 91 |
| `route-gate.test.ts` | 141 | 141（页面 → 规则快照不变） |
| `waiting.test.ts` | 80 | 80（规格拆分，代码不动） |
| `wechat-entry-render.test.tsx` | 62 | 62（「微信集成」仍在「邮箱绑定」位置之后） |
| `residual-reads.test.ts` | 76 | 76（营销入口断言改为「不再按派生角色」） |
| `navigation-workspace.test.ts` / `navigation-ia.test.ts` | 34 / 64 | 34 / 64 |
| `sales-digital-employee-access.test.ts` / `effective-platform-role.test.ts` | 3 / 63 | 3 / 63 |
| `pre-execute-guard` / `b1-tenant-context-static` / `phase1-1-context-propagation` | 38 / 20 / 24 | 38 / 20 / 24 |
| 其余工具授权相关（`b1-tenant-authz`、`phase2a-rules-tools`、`t5-execution-policy`、`digital-employee`、`m1-tool-policy`、`m2c-tool-policy`、`m1-gateway`、`platform-admin-scope`、`phase3a3-approvals-rbac`） | — | 全部通过，与改动前相同 |

门禁（最终提交上实跑）：
- `npm run test:ci`：PASS。
- `npm test`：574/587。13 个失败都是环境类，与 VIS-1b 记录的同一批：10 个要真实 Postgres（DATABASE SAFETY CHECK 拒跑），1 个要 Chromium（客户报价 PDF 分页），1 个要 Gmail 环境（OAuth compose scope），1 个 Agent Trace 只读查询（要数据库）。本次改动不触及这些模块。
- `npm run typecheck`：通过。
- `npm run lint:baseline`：PASS（无新增 error fingerprint，error 比基线少 15 处）。
- `bash scripts/check-test-registry.sh`：通过（563 个，欠账基线 68 条不增）。
- `npx next build --webpack`：成功（exit 0）。
- `openspec validate vis-1c-notify-settings-search --strict`：通过。
- `/opsx:verify vis-1c-notify-settings-search`：27 条 ADDED / MODIFIED 需求都有实现与测试，1 条 REMOVED 是拆分（行为由 4 条 ADDED 原样承接）。一处缺口当场补上：「底栏首格指向落地页」写明「岗位模式与旧模式相同」，原测试只覆盖岗位模式，已在 `entry-visibility.test.ts` 补旧模式断言。
- 回填脚本拒绝路径实跑：不设 `ALLOW_SENDER_COPY_UPDATE` 时 `--dry-run` 也直接拒绝（退出码 1、不连库）；未知模式退出码 2。

## 6. 独立审查与处理

三轮独立审查：两轮四件套审查、一轮代码审查。代码审查只给规格增量与 diff，不给 design。

**四件套第一轮**：1 个 Blocker、5 个 Major，全部改完才开工。主要几条：
- 原计划删除 `canUseMarketingDigitalEmployee`，它另有营销员工接口与微信路由在用（会破坏构建），改为只改工作台；
- Muse 桥把审批与询问事件记成 `agent_approval` / `project_update` 发给销售，通知入口按落点补全；
- 询价通知原取项目详情，会计 / 运营 / 出单都会看到，改走招投标中心；
- 时间线原计划查出来再过滤，会让游标跳过可见条目，改在查询里过滤；
- 「管理总览」原用岗位键，未绑岗位的 super_admin 会丢失，改用 `managementOnly`。

**四件套第二轮**：1 个 Blocker、3 个 Major，都是「本 change 让既有规格字面不再成立」：补了 5 份 MODIFIED（`position-mode-residual-reads`、`wechat-entry`、`rfq-notifications`、`activity-events`、`position-based-visibility`「岗位模式判定」），搜索对 super_admin 不判定门，时间线高频场景加 super_admin 前提。

**代码审查**：无 Blocker / Major。处理如下。

| # | 问题 | 处理 |
|---|---|---|
| 1 | 微信对话（`executeConversationRun`）是人类入口，却按后台运行没传入口门，销售在微信里仍拿到营销工具 | 已修：传入口门（按平台角色判定）；规格与测试改为把微信对话列为人类入口 |
| 2 | 判定输入取失败时通知类型列表一直转圈 | 已修：钩子加 `failed` / `retry`，列表提示「通知类型加载失败」并可重试 |
| 3 | 搜索每次输入多约 14 次查询，且 `resolvePreferredOrgId` 可能写库 | 已修：改用路由门同一份判定输入（30 秒缓存、不写库）。时间线与人类对话每次各一次未缓存的判定输入查询，列入 §9 |
| 4 | 同持销售与运营岗位的人：营销卡片出现，营销员工接口仍按派生角色返回 403 | 未改：接口层收口在 Out of scope，列入 §9 |
| 5 | 通知页筛选回到「全部类型」后，旧请求的响应可能后到覆盖 | 已修：只认最新一次请求 |
| 6 | 一条时间线断言用被测函数算期望值 | 已修：直接断言 |
| 7 | `canReadWorkDomain` 的注释被挤到新函数上 | 已修 |
| 8 | 回填脚本在事务外读 settingsJson、失败退出码说明不全 | 已修：事务内重读再写，补退出码说明 |
| 9 | `/settings` 代发说明指向本页没有的区块；`/settings/email` 说明重复 | 已修 |

## 7. 拍板结果（design「审核关注点」）

Q1–Q9 全部按推荐执行（Lucas 2026-11-10）：
- Q1：通知类型按处理页面判定；`rfq_*` 走招投标中心；销售仍看得到会收到的 `agent_*` 与项目更新。
- Q2：隐藏类型保留偏好、照常投递。
- Q3：发信文案用企业设置的一个枚举值加通用文案；上线前回填梦馨。
- Q4：搜索项目 = 项目详情门 ∧ 详情页读判定。
- Q5：营销工具需 `marketing` 模块；人类对话另要「品牌增长」入口；执行期不加门。
- Q6：营销卡片按营销数字员工页判定；接口层不动。
- Q7：时间线自动化按可见岗位在查询里过滤；审计行只藏岗位名；无显式工作域的作业只对可读全部工作域的人带链接。
- Q8：「管理总览」只对管理层（BREAKING：非管理层侧栏少一项）；底栏首格改指落地页。
- Q9：「等你 N 件」规格拆四条。

## 8. 上线步骤与生产核对清单

上线步骤：
1. 先合 #409（搜索任务范围修复），再合本 PR。本分支以 merge 提交并入了 #409 的提交 `65e11c6`，#409 合入 main 后本 PR 的差异只剩 VIS-1c。
2. 部署前在生产对梦馨跑回填脚本，先试运行：
   ```bash
   ALLOW_SENDER_COPY_UPDATE=true npx tsx scripts/set-org-sender-copy.ts --org mengxin-home-textile --mode platform_relay --actor <平台管理员邮箱> --dry-run
   ```
   确认输出为「ui.senderCopy （未设置） → platform_relay」后去掉 `--dry-run` 再跑一次。没跑的话梦馨会显示标准的 Gmail 绑定文案（不影响发信）。
3. `vercel --prod`。

生产核对：
1. Lynn：`/settings/notifications` 没有「供应商报价了」等 4 项询价开关；通知页筛选没有「项目分发」；顶栏搜项目名搜不到项目；AI 助手问「营销增长简报」时不会调用营销工具。
2. installation（安装工）：`/settings` 没有「邮箱绑定」卡；通知开关没有「项目与配置变更」；手机底栏首格是「安装」。
3. 只持会计的账号：手机底栏首格是「会计」；侧栏没有「管理总览」。yee（出单）：首格是「任务」。
4. Maggie（运营）：工作台有「营销增长数字员工」；Lynn 没有。
5. Bob / Bill（老板）：侧栏有「管理总览」；首页时间线没有「发布漂移检查」等平台运行、没有「运维与知识」「询盘销售」字样。
6. 梦馨 Cathy：`/settings` 显示「梦馨…发信通道」通用说明，没有 Gmail / SMTP 绑定区块。
7. Lucas（super_admin）：以上入口全部照旧可见。

## 9. 已知局限

- 营销数字员工卡片按页面判定，营销员工接口仍按派生平台角色（`canUseMarketingDigitalEmployee`）。同时持 `sales_rep` 与 `ops_staff` 的人派生角色为 `sales`：卡片出现、`/marketing/employee` 的接口返回 403。接口层按模块拦截在 Out of scope，建议随 API 层收口一并改。
- 人类对话执行期不检查工具是否在本次列表里：模型若调用列表外的营销工具，仍按平台角色执行（正常不会发生）。建议另立「执行期白名单」。
- 首页时间线、人类对话每次请求各多一次 `loadNavigationContextForOrg`（不缓存）；搜索已改用路由门缓存。
- 任务搜索结果的范围不变：本企业项目里的任务照旧搜得到，结果带项目名，即使该项目本人打不开。
- 零可见岗位卡的管理层：侧栏仍有「管理总览」，点进去落 `/tasks`（VIS-1b Q6）。
- 主规格 Purpose 里「七个岗位」的说法仍在（归档不改 Purpose）。
