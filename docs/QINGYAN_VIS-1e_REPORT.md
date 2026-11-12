# VIS-1e 报告：平台管理员「以岗位预览」

OpenSpec change `vis-1e-preview-as-position`。
- 新能力 `authorization/position-preview`；
- 改 `navigation/route-gate`「平台 super_admin 不受路由门限制」与 `authorization/platform-admin-authority`「平台管理员在企业内全权」，都加预览期间的例外。

任务书 `docs/QINGYAN_VIS-1_VISIBILITY_TASKBRIEF.md` §VIS-1e；design Q1–Q9 Lucas 2026-11-11 全部按推荐。依赖 VIS-1a–1d（#393、#400、#410、#432）。

## 1. 用户现在会怎么看到

- **入口**：企业详情页「岗位」一节（只对平台 super_admin 显示）多两个入口：
  - 每位成员行的「以 TA 的岗位预览」，用该成员当前的全部岗位；
  - 「按岗位组合预览」，勾选 1–10 个岗位。
  - 开启后整页回到首页。
- **预览中看到的**，与持同样岗位的企业成员相同：侧栏与手机底栏、路由门、首页岗位卡与「等你 N 件」、通知类型开关与筛选、设置页卡片、全局搜索、审批中心与「待我确认」、AI 工具列表、AI 作业可读域。
  - 平台管理员页、平台控制台、跨企业访问、Autopilot 都不可用。
  - 本人提交的、本人是指定审批人的、本人所在工作区与项目照旧按本人算。
- **横幅**：顶部常驻横幅「正在以〈企业 · 岗位〉预览（只读）· 剩余 N 分钟 · 退出预览」。
  - 条件不再满足时（岗位停用、被移出企业、企业改旧模式、不再是平台 super_admin）改为「预览已失效 · 退出」，读取恢复本人身份。
- **只读**：预览中任一写请求（含客户分享链接的签字、AI 对话、标已读、切换企业）返回 409「预览中为只读，不能修改数据。退出预览后再操作。」。
  - 只有退出预览、登出、登录放行。
  - AI 对话输入框禁用并说明原因；客户端不再自动回写当前企业、不标已读。
  - 预览中的页面读取也不顺带写库：不同步通知、不建默认数据、不绑定 Google、打开客户报价链接不算客户查看（§3）。
- **结束**：2 小时自动失效；退出、登出、重新登录都清掉预览。开启与结束各留一条审计（平台动作，不进企业的驾驶舱时间线）。
- **只影响这一个浏览器**：同一账号在别的浏览器、手机、Muse、微信里照旧是本人身份。

## 2. 改了什么

| 位置 | 改动 |
|---|---|
| `src/lib/preview/token.ts`（新，纯） | 派生密钥（HMAC-SHA256(JWT_SECRET, "qy-preview-v1")，用 WebCrypto 计算）签发与无库校验：签名、`aud`、过期、属于会话用户、岗位 1–10 个 |
| `src/lib/preview/identity.ts`（新，纯） | 预览身份常量与构造、横幅信息、代理拒写判定与 409 响应体 |
| `src/lib/preview/server.ts`（新） | 按请求取预览（显式注入优先，其次 `next/headers`），只认属于当前会话用户的 cookie；有库校验（仍是 super_admin、仍是成员、岗位模式、岗位 active 人类岗位）；30 秒缓存。另给落点用的 `isPreviewReadonly`（预览有效或已失效）、`listEffectiveMemberships`（预览中只有预览企业 org_member）、`effectivePlatformRole` |
| `src/lib/preview/cookie.ts`、`audit.ts`（新） | cookie 写清、预览结束审计 |
| `src/app/api/admin/preview/route.ts`（新） | `POST` 开启（平台 super_admin，按 spec 顺序校验）、`DELETE` 退出 |
| 登出 / 登录 / 注册 / 微信回调 | 清预览 cookie；登出带预览时记结束；登录选企业不带预览身份 |
| `src/proxy.ts` | 静态图片与公开路径放行之前按签名拒写（不限路径）；营销 API 旧规则预览中按 `user`；路由门在显式注入的预览 token 下执行 |
| 落点：鉴权与权限 | `getCurrentUser`（平台角色 user）、`resolveEffectiveBindings`（所选岗位的权限行，在读平台角色之前）、`getOrgMembership`（org_member） |
| 落点：当前企业 | `resolvePreferredOrgId` / `setUserActiveOrgId` / `getUserActiveOrgId` / `canUserUseOrg` / `listActiveOrgOptions`、`ensureFixedUserActiveOrg`、`resolveTradeOrgId`、`resolveRequestOrgIdForUser`、workforce 企业解析：只认预览企业；预览中（含已失效）不写 `activeOrgId`，失效的偏好也不清 |
| 落点：判定输入 | 企业导航判定输入（org_member + 所选岗位的键）；路由门加载器（平台角色 user、缓存键含预览指纹、Autopilot 关）；指定企业的判定输入 |
| 落点：可见层读取点 | 团队审批处理人范围与能批判定、审批可见判定输入、首页岗位总览成员角色、`/api/auth/me`（横幅信息、当前企业、无 Autopilot）、全局搜索、项目可见范围、首页提醒（平台角色）、企业列表、平台管理员页门、Autopilot 页门与接口 |
| GET 写库 | 见 §3：每日简报、市场情报、通知同步与偏好、采购默认规则、项目摘要、复盘草稿、讨论会话、外贸模板、内置技能、Google 绑定、客户报价链接查看 |
| 界面 | `positions-section.tsx` 两个入口；`preview-banner.tsx`（新）挂在 `app-shell.tsx`，退出时清本地记住的当前企业；`active-org-hydrator`、`header`（标已读）、四处 AI 对话输入（含外贸） |
| 测试 | `src/lib/preview/__tests__/preview.test.ts`（纯，127 条）、`preview-db.isolated.test.ts`（隔离库，44 条）；route-gate 补预览场景与一条源码断言随代理改写 |

零 schema（预览只在 cookie 里，审计落既有 AuditLog）；不新增权限键；零新增 LLM 调用（预览中每日简报不调 LLM）；不新增队列 / cron；不触碰出站（预览中所有写被拒）。

## 3. GET 写库登记（design D9，源码扫描测试逐条比对）

扫描范围：`src/app/api/**/route.ts` 导出的 GET、它调到的同文件辅助函数、它调到的 `@/lib` 导出函数（含该库文件内的辅助函数，只跟一层）。`cron/**` 不扫（Bearer 密钥，不带浏览器 cookie）。登记表与扫描结果不一致即失败；「预览中」一列都按 `isPreviewReadonly`（预览有效或已失效）判断，与代理拒写同口径。

| GET 路由 | 写什么 | 预览中 |
|---|---|---|
| `agent-core/tools`、`auth/active-org`、`ops/home`、`ops/projects`、`ops/projects/[id]`、`ops/sales-summary`、`tasks` | 解析当前企业时写 `activeOrgId` | 不写 |
| `sales/daily-briefing` | 生成简报（调 LLM）、建通知、覆盖缓存 | 不生成、不建通知、不覆盖；有当日缓存照常返回，没有返回空并标只读 |
| `operations/market-intelligence` | 建或改市场情报技能 | 只读已有技能，没有就 409 |
| `notifications`、`notifications/unread-count` | 同步提醒 / 审计 / 低评分通知；稍后提醒到期改回未读 | 不同步 |
| `notifications/preferences/me` | 建偏好行 | 不建，按默认值返回 |
| `procurement/rules` | 建默认规则 | 不建 |
| `projects/[id]/ai-summary` | 刷新结构化摘要 | 不刷新 |
| `projects/[id]/reviews` | 建复盘草稿 | 不建 |
| `projects/[id]/discussion`、`discussion/messages` | 建项目讨论会话 | 不建，没有会话返回空 |
| `trade/templates` | 建默认模板 | 不建 |
| `agent-core/skills` | 建内置技能 | 不建 |
| `auth/google/callback`、`auth/google-email/callback` | 绑定 Google 日历 / Gmail，写 OAuth token | 拒绝绑定，跳回并带 `reason=preview_readonly` |
| `sales/quotes/share/[token]` | 客户首次查看：记查看时间、报价改「已查看」、推进商机 | 带本人预览 cookie 打开不记 |
| `accounting/sales-summary`、`marketing/daily-brief`、`capabilities/approvals/[approvalId]` | 审计 | 照写（如实记录谁看了） |
| `calendar/google`、`calendar/google/calendars` | 刷新本人 Google token | 照写（凭据维护，与预览身份无关） |
| `auth/wechat/callback` | 登录 | 公开登录回调，清预览 cookie |
| `bridge/muse/events` | API token 最近使用时间 | Muse API token，不带浏览器 cookie |
| `trade/cron` | 定时任务 | CRON_SECRET，不带浏览器 cookie |

经两层以上库函数间接写库的 GET 扫不到（§9）。

## 4. 按岗位的预览结果（按真实实现计算：预览身份 = 平台角色 user、成员角色 org_member、所选岗位的键）

| 预览的岗位 | 落地页 | /bids | /accounting | /install | /sales/quote-sheet | /revenue | /marketing | /admin/users | /ai/autopilot |
|---|---|---|---|---|---|---|---|---|---|
| Sunny 老板（owner + bids） | / | ✓ | ✓ | ✓ | ✓ | — | ✓ | — | — |
| 会计（accounting） | /accounting | — | ✓ | ✓ | — | — | — | — | — |
| 销售（sales_rep） | /sales/home | — | — | — | ✓ | — | — | — | — |
| 招投标（bids） | /bids | ✓ | ✓ | — | — | — | — | — | — |
| 运营（ops_staff） | /ops | — | — | — | — | — | ✓ | — | — |
| 梦馨 Cathy（owner + trade_rep） | / | — | — | — | — | ✓ | ✓ | — | — |

预览与持同样岗位的成员逐项相同，已由隔离库测试对照真实成员核对：
- 会计：判定输入、路由门、审批中心、「待我确认」、AI 工具、首页岗位总览、项目可见范围、全局搜索、首页提醒、企业列表；
- 老板 + 招投标：「待我审批」。

本人另一企业（测试里是家纺企业，本人是 org_admin）的项目与任务在预览中搜不到、不进提醒；不带预览照旧可见。

## 5. 门禁与测试

本机 Node 24。下表是 rebase 到 origin/main `d63dadbf`（含 #436、#437）之后在最终代码上跑的结果。

| 门禁 | 结果 |
|---|---|
| `npm run test:ci` | PASS |
| `npm test` | 612/625。13 个失败与 origin/main 逐条相同（rebase 前在 `beebdfa4` 上对照跑过：608/621），都是既有环境类（Postgres / Chromium / Gmail / Agent Trace） |
| `npm run typecheck` | 通过 |
| `npm run lint:baseline` | PASS（无新增 error fingerprint） |
| `bash scripts/check-test-registry.sh` | 通过（已注册 599 个） |
| `npx next build --webpack` | 通过（冷构建 3.7 分钟，`NODE_OPTIONS=--max-old-space-size=8192`；警告与 origin/main 相同，都是 Sentry / OpenTelemetry 既有的） |
| `openspec validate vis-1e-preview-as-position --strict` | 通过 |
| `/opsx:verify vis-1e-preview-as-position` | 8/8 任务；11 条 ADDED + 2 条 MODIFIED 需求、19 个场景都有实现与测试；0 critical / 0 warning（verify 时把审查后补的落点同步进了 design D5） |

新测试：
- `src/lib/preview/__tests__/preview.test.ts`：127 passed。纯函数（签发与无库校验、预览身份、横幅、拒写判定）、代理拒写（注入假加载器调 `handleRequest`，覆盖各方法、豁免路径、静态图片路径、无效 cookie 不拒写）、营销 API 旧规则、GET 写库扫描与登记表、各落点的源码断言。已进 `test-all.sh` 与 `test-ci-unit.sh`。
- `src/lib/preview/__tests__/preview-db.isolated.test.ts`：44 通过。在本机临时起的 Postgres 16 上实跑，无库时跳过。覆盖 spec 全部场景，并对照真实会计、真实老板 + 招投标成员逐项比对（§4）。
- `src/lib/navigation/__tests__/route-gate.test.ts`：145 passed（补预览场景）。

构建中发现并修掉的一处（不是审查发现）：
- 几个客户端页面引了服务端的汇总导出（任务、销售首页、安装），经鉴权与权限库间接打包到预览模块。预览模块里静态的 `node:` 导入让客户端构建报 `UnhandledSchemeError`。
- 本机前几次构建都被 SIGKILL，原因是构建缓存涨到 6 GB；清掉缓存冷构建才看到真实错误。
- 修法：`token.ts` 派生密钥改用 WebCrypto（同一份 HMAC-SHA256 字节，既有的伪造 token 测试按 `node:crypto` 派生签名，照样通过）；`server.ts` 经 `process.getBuiltinModule` 取 `AsyncLocalStorage`，取不到退化为空作用域（浏览器里不会调用）；任务工作台直接引纯模块。源码断言防止再出现静态 `node:` 导入。

**隔离库**：本机临时起的 PostgreSQL 16（装 pgvector），origin/main（`beebdfa4`）与本分支各用一个库，迁移相同（零 schema）。既有隔离库测试选经过本次改动入口的 23 个，结果逐个相同：

| 既有隔离库测试 | origin/main | 本分支 |
|---|---|---|
| phase3a3-approvals-smoke | 27 / 1 失败 | 27 / 1 失败 |
| b2-approval-cas.isolated | 23 | 23 |
| durable-followup-m1.isolated | 61 | 61 |
| booth-cards-db.isolated | 69 | 69 |
| website-inquiry-async-db.isolated | 58 | 58 |
| revenue-spine-db.isolated | 166 | 166 |
| onboarding-db.isolated | 82 | 82 |
| owner-today-db.isolated | 39 | 39 |
| phase2c1-pause-resume | 26 | 26 |
| phase2c1-expiry-races | 7 | 7 |
| p0-execution-alignment | 51 | 51 |
| warranty-db.isolated | 52 | 52 |
| repair-visit-email-db.isolated | 26 | 26 |
| followup-auto-db.isolated | 28 | 28 |
| wechat-binding-confirm-db.isolated | 25 | 25 |
| audience-db.isolated | 44 | 44 |
| effective-platform-role-db.isolated | 17 | 17 |
| platform-admin-scope-db.isolated | 23 | 23 |
| residual-reads-db.isolated | 13 | 13 |
| position-binding-console-db.isolated | 35 | 35 |
| org-scoped-users-db.isolated | 36 | 36 |
| procurement-records-db.isolated | 158 | 158 |
| autogen-db.isolated | 18 条失败（`NO_BINDING`） | 18 条失败（`NO_BINDING`） |

rebase 到 `d63dadbf` 后，本分支另跑 #436 带进来的 `settings-write-db` 27 通过（要 `JWT_SECRET` 环境变量）、`onboarding-db` 82、`preview-db` 44。

两边一致的既有失败：`phase3a3-approvals-smoke` 的一条与 VIS-1d 时相同；`autogen-db` 是测试种子没给出单岗位绑定（报 `NO_BINDING`），逐条相同，与本 change 无关。

新隔离库测试的输出（逐条，44 通过）：

```
开启与开启条件
  ✓ 平台 admin、持 owner 岗位的 user：403 PLATFORM_ADMIN_REQUIRED，不写 cookie
  ✓ 不满足条件：404、旧模式、非成员、空列表、11 个、含停用岗位依次被拒，都不写 cookie
  ✓ 开启成功：企业、岗位、到期，Set-Cookie 带 HttpOnly
预览身份
  ✓ 当前用户接口：平台角色 user、当前企业为预览企业、无 Autopilot、带预览信息
  ✓ 鉴权：平台角色 user
  ✓ 权限：与持 accounting 的成员逐个相同，不持报价让利审批键
  ✓ 成员解析：预览企业 org_member，另一企业非成员
  ✓ 另一企业：无权限
  ✓ 权限判定：预览中只取所选岗位、另一企业拒绝；不带预览 cookie 照旧全权
平台特权
  ✓ 路由门加载器：平台角色 user、当前企业为预览企业
  ✓ 平台管理员页：预览中被拒
  ✓ Autopilot：预览中关闭（不带预览照旧开）
  ✓ 平台管理员接口（岗位绑定）：预览中 403
  ✓ 另一企业的资源：预览中被拒
会计看到的
  ✓ 路由门：/bids 302、/accounting 放行
  ✓ 侧栏判定输入：与真实会计相同（成员角色、岗位模式、键、模块）
  ✓ 审批中心：与真实会计相同——看得到质保邮件卡，看不到他人的让利审批与询价卡
  ✓ 「待我确认」：与真实会计相同，不含让利审批与询价卡
  ✓ AI 工具列表：与真实会计相同
  ✓ 首页岗位总览：与真实会计相同（是否管理层）
老板看到的
  ✓ 路由门：/bids 放行
  ✓ 「待我审批」：与持 owner + bids 的成员相同
  ✓ 审批中心：老板岗位看得到询价与让利审批
  ✓ 首页岗位总览：老板岗位是管理层
GET 不写业务数据
  ✓ 每日简报：预览中不生成、不建通知（没有当日缓存时返回空并标只读）
  ✓ 客户分享链接：预览中打开不记客户查看、不改报价状态（不带预览照旧记）
  ✓ 库里的当前企业仍是家纺企业（预览中的 GET 都没有改写）
其他读取点（与真实会计相同）
  ✓ 项目可见范围：与真实会计相同，不含本人另一企业的项目
  ✓ 全局搜索：与真实会计相同，搜不到本人另一企业的任务（不带预览照旧搜得到）
  ✓ 首页提醒：平台角色按 user、与真实会计相同，不含本人另一企业的任务（不带预览照旧含）
  ✓ 企业列表：只有预览企业、成员角色 org_member，与真实会计相同
  ✓ 通知列表、未读数、通知偏好：预览中不同步、不建偏好行（不带预览照旧建）
  ✓ 预览只认当前会话：别人的会话带着本人的预览 cookie 不生效
  ✓ 已失效的预览：失效的当前企业偏好不清空（不带预览照旧清空）
只读
  ✓ 代理拒写：409，不含 cookie 值
  ✓ 当前用户、当前企业接口的响应体不含 cookie 值
失效与退出
  ✓ 停用岗位 / 移出企业 / 企业改旧模式：state invalid，判定恢复本人身份
  ✓ 撤掉平台 super_admin：state invalid，按本人当前平台角色判定
  ✓ 条件恢复后：预览重新生效
  ✓ 退出：清 cookie，返回 ok
  ✓ 退出后：不带预览，平台角色恢复，路由门放行
  ✓ 登出：同时清掉会话与预览 cookie
审计
  ✓ 开启两次、退出一次 + 带预览登出一次：各有审计，带企业与岗位，不含 cookie 值、不进企业时间线
不带 cookie
  ✓ 同一用户不带预览 cookie：平台角色 super_admin、全权、平台管理员页放行
VIS-1e 以岗位预览 DB 端到端：44 通过，0 失败
```

## 6. 独立审查

两轮，都由只读子代理做，不看实现者的结论。

**第一轮：四件套（实现前）。** 1 Blocker、5 Major，全部修进了 design「审核关注点」末尾，见 §7。

**第二轮：代码（实现后）。** 没有越权（Blocker 为 0）。2 Major、6 Minor，处理如下：

| 编号 | 发现 | 处理 |
|---|---|---|
| M1 | 预览身份没注入全：全局搜索、项目可见范围、首页提醒、企业列表、营销团队审批的「能批」仍按本人真实身份，预览中能看到本人另一企业的项目与任务 | 修。新增 `listEffectiveMemberships`、`effectivePlatformRole`，这几处都改走它们；团队审批能批判定在预览中不认企业所有者与 org_admin。隔离库测试补预览对照真实会计的项目可见范围、搜索、提醒、企业列表 |
| M2 | GET 写库没拦全：扫描只看路由文件本身，经库函数的写全漏掉（通知同步、偏好、模板、采购规则、项目摘要、复盘、Google 绑定）；已有守卫只认「有效」预览，失效后又开始写 | 修。所列各处加守卫；守卫统一改用 `isPreviewReadonly`（有效或已失效）；扫描改为跟一层 `@/lib` 导入。新扫描又找出项目讨论会话与客户报价链接查看两处，一并加守卫（§3） |
| m1 | 代理里静态图片放行在拒写之前，`POST /api/.../x.png` 会绕过 409 | 修。拒写挪到静态图片放行之前，源码断言覆盖顺序 |
| m2 | 库层预览没核对会话用户：浏览器留着 A 的预览 cookie、登录的是 B 时，涉及 A 的判定会按预览算；注册不清预览 cookie | 修。库函数与路由处理函数取预览都核对 `qy_session` 的用户；注册清预览 cookie。隔离库测试补「别人的会话带着本人预览 cookie 不生效」 |
| m3 | 退出后浏览器本地记住的当前企业是预览企业，可能被回写成本人当前企业 | 修。退出预览时清本地记住的当前企业 |
| m4 | 外贸 AI 对话输入没禁用；`/api/autopilot/*` 预览中仍可读 | 修。外贸输入禁用；Autopilot 接口预览中 403 |
| m5 | 隔离库测试两条断言是空的（简报接受 403；当前企业的偏好本来就有效） | 修。简报断言收紧为 200 + 返回空 + 标只读；补「已失效的预览中，失效的当前企业偏好不清空（不带预览照旧清空）」 |
| m6 | 校验缓存 30 秒：撤销 super_admin 或移出企业后最多 30 秒内仍按预览岗位读（只读） | 接受。与路由门缓存同量级；期间写一律被拒 |

审查确认没问题的：派生密钥与 `aud` 让会话 token 和预览 token 不能互用；预览中开不了新预览；cookie 是 httpOnly + Lax；豁免只认精确的方法 + 路径；缓存键不串身份；不带 cookie 时不查库、行为与改动前一致；审计与响应都不含 token。

## 7. 拍板结果与实现中的落地

design Q1–Q9 Lucas 2026-11-11 全部按推荐。实现前对四件套做过一轮独立审查（1 Blocker、5 Major），修订已写进 design「审核关注点」末尾：派生密钥、拒写挪到公开路径之前、GET 写库、失效横幅与登录清预览、四处补充落点、spec 的定义性条款。

实现中按 design 落地、值得记一笔的：
- 审计按平台动作写（`orgId` 为空，企业在 `targetId` 与 `afterData`），不进企业的驾驶舱时间线。
- `getCurrentUser` 只改写平台角色，不往用户对象里加预览字段（`/api/auth/me` 会把用户对象整体返回，避免其他接口顺带带出预览信息）。横幅信息只由 `/api/auth/me` 的顶层 `preview` 给出。
- 测试与代理用 `withPreviewToken` 显式注入预览 token；生产的路由处理函数与服务端组件经 `next/headers` 读取。

## 8. 上线步骤与生产核对清单

上线：合并后照常 `vercel --prod`。零 schema，无回填、无开关。

上线后核对（Lucas）：
1. 打开 Sunny 企业详情页「岗位」一节，对一位会计成员点「以 TA 的岗位预览」：
   - 首页落到 `/accounting`，顶部出现横幅；
   - 侧栏只有会计相关入口；
   - 直接敲 `/bids` 回到落地页；审批中心只有质保 / 返修邮件卡。
2. 预览中随手点一个保存按钮：提示「预览中为只读…」，数据不变；AI 助手输入框是禁用的。
3. 点「退出预览」：回到首页，横幅消失，侧栏恢复平台管理员视角。
4. 对一位销售成员重复 1：首页落到 `/sales/home`。注意：销售的客户、商机列表按 Lucas 本人计算（多半为空），不是那位销售的数据（见 §9）。
5. 用另一台设备登录同一账号：不受预览影响。

## 9. 已知局限

- **记录级数据按本人**：预览改的是岗位与企业身份，userId 仍是本人。按「本人 / 被分配」范围的列表（销售的客户、商机、本人提交的审批）显示的是 Lucas 自己的记录。预览验收的是「这个岗位能看到哪些入口与页面」。
- **直接读成员表的读取**：除 §2 列出的落点外，代码里还有约 130 处直接读 `OrganizationMember` 的地方，在预览中看到的是本人真实的成员角色。这些多在写接口与业务明细里；写已全拒，读的差异只影响个别明细。
- **用 POST 做查询的接口**在预览中被拒（如 AI 对话、个别导出），界面提示只读。
- **GET 写库扫描是近似**：跟到路由文件与一层库函数；经两层以上库函数间接写库的扫不到，独立审查专门查过一遍。
- **只在本人是成员的岗位模式企业里预览**；旧模式企业没有岗位可预览。
