# Design：平台管理员「以岗位预览」（VIS-1e）

## Context

动机见 proposal.md。实现前核对（只读，origin/main a6908f9f）：

- **任务书写的落点不对。** 任务书要求改 `resolveWorkspaceContextFromCookies`（`src/lib/rbac/resolve-workspace-context.ts`）。它的 10 个调用方（`bids`、`install/**`、`ops/**`、`accounting` 页）都只用它判「没登录就去登录页」，返回的判定输入没人用。身份实际在下面几处产生：
  - **API 鉴权**：`getCurrentUser`（`src/lib/auth/index.ts:30-60`）按 `qy_session` 读库，返回库里的平台角色。`withAuth`（372 个路由）、`requireAuth`、`requireProject*Access`、`requireCostAccess` 都经它。代码里约 80 个文件按 `user.role` 判 super_admin 放行。
  - **权限判定**：`resolveEffectiveBindings`（`src/lib/authorization/resolve-effective-permissions.ts:110-157`）不信调用方，按 `principal.id` 重新读库里的平台角色，super_admin 直接拿全部权限。`authorize()`、`loadPermissionKeys`、路由门判定输入、`fulfillment` 都经它。
  - **路由门**：`src/proxy.ts`（Node 运行时）对页面请求调 `applyRouteGate`。super_admin 在 `route-gate.ts:173` 直接放行；否则经 `ROUTE_GATE_LOADER`（`context-server.ts`）读用户、可用企业与判定输入，按 `${userId}:${orgId}` 缓存 30 秒。`/api/**` 在代理里原样放过（`proxy.ts:106-108`）。
  - **侧栏**：客户端拿 `/api/auth/me`（平台角色、`effectiveRole`）与 `/api/auth/active-org`（判定输入；`resolvePreferredOrgId` 会写 `User.activeOrgId`）。通知类型开关与筛选也只在客户端按这两份判。
  - **直接读库判身份的可见层读取点**：
    - `loadApprovalViewer`（平台角色、企业所有者、成员角色）；
    - `posts-read-model`（成员角色、平台角色）；
    - `buildCapabilitiesAccess` / `getTenantContext`（成员角色、`isPlatformAdmin`）；
    - `/api/agent-core/tools`、`/api/search`；
    - `platform-admin-guard`、`autopilot/page-guard`（页面门，读库平台角色）。
- **企业解析**：`resolvePreferredOrgId`、`resolveTradeOrgId`、`resolveRequestOrgIdForUser`、`getTenantContext`、`resolveWorkforceApiOrgForUser`、`getOrgMembership` 都要求 active 成员。super_admin 走 `resolveTradeOrgId` 时必须显式传企业。另有 134 处（99 个文件）直接读 `OrganizationMember`。
- **没有服务端动作**（无 `"use server"`），一切写都走 `/api/**`。
  - 代理里公开路径（`proxy.ts:78`）在会话校验之前放行，含客户签字的 `POST /api/sales/quotes/share/[token]/sign`、visualizer 分享、`/api/trade/webhook/*`、登录 / 注册。
  - GET 里会写库的：
    - `resolvePreferredOrgId` 与 `ensureFixedUserActiveOrg`（写 `activeOrgId`）；
    - `GET /api/sales/daily-briefing`（调 LLM、建通知、覆盖当日缓存，`route.ts:74-83,159-171`）；
    - `GET /api/operations/market-intelligence`（`ensureMarketingSkill` 建或改 AgentSkill，`:43`）；
    - `GET /api/capabilities/approvals/[id]`（写审计，`:29`）；
    - 公开回调与分享链接。
  - 客户端浏览时会自动写：`active-org-hydrator` 的 PATCH、`header` 的标已读。AI 对话是 POST。
- **请求级上下文**：只有 `withAuth` 里的 `requestContext`（AsyncLocalStorage）。库代码里读请求 cookie 的方式是 `next/headers` 的 `cookies()`（4 个文件），在路由处理函数、服务端组件与代理（Next 16.2 在代理里也建了请求存储）里可用；在请求之外（`npx tsx` 测试、脚本、cron 之外的进程）调用会抛错。
- **会话**：`qy_session` 是 jose HS256 JWT（`JWT_SECRET`），httpOnly、生产 secure、lax，8 小时。`verifySession`（`session.ts:45`）与代理的会话校验（`proxy.ts:54`）不校验 `aud`，同一密钥签的任何 HS256 token 都会被当作会话。没有当前企业 cookie；当前企业在 `User.activeOrgId` 与 localStorage。
- **另几处身份源**：
  - 企业导航判定输入的构造 `loadOrgNavigationInputsDetailed`（`context-server.ts:36-88`）自己读成员角色。路由门加载器与 `loadNavigationContextForOrg` 都经它；后者的调用方有首页岗位总览、AI 作业可读域（`job-scope-server.ts:32`）与 AI 入口门（`entry-gate-server.ts`）。
  - 团队审批处理人范围 `getTeamApprovalAccessIds`（`marketing/team.ts:98`）按 `Organization.ownerId` 与成员角色 `org_admin` 跨企业取，「待我确认」与红点用它。
  - Autopilot 入口 `evaluateAutopilotAccess`（`autopilot/access.ts:79-89`）只认环境变量里的 owner 名单；路由门判定输入与 `/api/auth/me` 的 `autopilotAllowed` 都由它算。
  - `/api/auth/me` 的 `activeOrgId` 与 `effectiveRole` 按库里的当前企业算（`me/route.ts:21-34`）。
- **岗位**：绑定用的是企业内 `RoleProfile.key`。`RoleProfile` 带 `status`，权限在 `RolePermissionBinding`（键、数据范围、ALLOW / DENY）。持岗位的人得到的就是这些行（`loadProfileBindings`）。
- **企业详情页「岗位」一节**（`organizations/[orgId]/positions-section.tsx`）：只对 super_admin 显示，列出企业可绑岗位与每位成员的岗位，已有勾选岗位的编辑面板。
- **Lucas 的成员身份**：`config/positions/sunny.json` 里 Lucas 持 `owner` + `bids`；`mengxin.json` 里持 `owner`。他是两家企业的成员。

## Goals / Non-Goals

**Goals：**
- super_admin 在本人是成员的岗位模式企业里，以一位成员的岗位组合或手选组合，只读看到导航、页面门、首页、通知、设置、搜索、审批与 AI 工具，与持同样岗位的成员相同。
- 预览期间零写入：代理层统一拒写，GET 不改当前企业。
- 预览状态只在一枚签名 cookie 里；退出、过期或条件不再满足即恢复本人身份。

**Non-Goals：**
- 执行器 `src/lib/pending-actions/executor.ts` 与 `canDecideTeamApproval`：不改（预览期间写全被拒，执行不到）。
- `src/lib/muse-bridge/**`、`src/lib/messaging/**`（微信）、`src/app/api/cron/**`：不改，它们的请求不带浏览器 cookie。
- 134 处直接读 `OrganizationMember` 的代码：不改，见 D3。
- 按「本人 / 被分配」的数据范围（`authorize.ts:52-55` 的 PRINCIPAL / ASSIGNED）：仍按本人 userId。
- `resolveWorkspaceContextFromCookies` 的 10 个页面调用方：不改调用形状。它内部调的 `resolvePreferredOrgId` 随 D5 变为预览感知。
- 岗位绑定接口 `PUT /api/organizations/[orgId]/positions` 与 `scripts/bind-positions.ts`：不改。
- 移动 App、Muse、微信里的预览入口：不做。

## Decisions

### D1 预览身份 = 岗位组合的成员，不是冒充某个人（Q1、Q3、Q5）

预览期间，系统把该用户当作：
- 平台角色 `user`；
- 预览企业的 active 成员，成员角色 `org_member`，不是企业所有者（`Organization.ownerId` 不算）；
- 有效权限 = 所选岗位在该企业的 `RoleProfile` 权限行，与持这些岗位的人逐行相同；
- 岗位模式；
- 对其他企业一律非成员、无权限。

userId 仍是本人。所以本人提交的、本人是指定审批人的、本人所在的工作区与项目照旧算本人的。

被否决：
- 切成某个具体用户的 userId（真冒充）。记录级数据最像，但等于拿到别人的会话：能看别人的私人草稿、对话、邮箱绑定，要额外做一整套不可写、不可读私人数据的护栏。超出「验收可见性」的需要。
- 只换导航与路由门（任务书字面）。审批中心、首页「等你拍板」、AI 工具这些按身份判定的面会停在 super_admin 视角，正是要验收的部分。
- 保留本人的成员角色（如 org_admin）。岗位模式下仍有几处按成员角色给权（审批的企业处理人、审批中心能批判定），预览会比真实岗位看到更多。

### D2 预览单位是岗位集合（Q1）

开启接口收企业与岗位 key 列表（1–10 个）。界面两个入口：
- 成员行的「以 TA 的岗位预览」，直接用该成员当前的全部岗位；
- 「按岗位组合预览」，复用编辑面板的岗位勾选。

真实成员大多持组合（Sunny 11 人里 4 人持 `owner` + 别的岗位），只能单选一个岗位就看不到「Lynn 看到的」。

被否决：只允许单个岗位（任务书原文）。

### D3 只在本人是 active 成员的岗位模式企业里预览（Q2）

开启时要求企业是岗位模式、本人是该企业 active 成员。这样企业解析与成员读取都有真实成员记录可依；成员角色按 D1 在统一落点改写为 `org_member`。

被否决：
- 对任意企业预览（虚拟成员身份）。要让 134 处直接读成员表的代码都认一个不存在的成员，改动面与漏改风险都不可控。
- 旧模式企业：没有岗位可预览。

### D4 签名 cookie，2 小时，不续期（Q7）

`qy_preview` = jose HS256 JWT，密钥由 `JWT_SECRET` 派生（HMAC-SHA256(`JWT_SECRET`, `"qy-preview-v1"`)），另带 `aud: "qy-preview"`。派生密钥让会话校验（用 `JWT_SECRET` 本身、不查 `aud`）认不出它，预览 cookie 不能当登录会话用；会话 token 也通不过预览校验。
- 内容：`sub`（本人 userId）、`orgId`、`keys`、`exp`（签发后 2 小时）。
- 属性：httpOnly、生产 secure、`sameSite: lax`、`path: /`、`maxAge` 7200。

每个请求先做无库校验：签名、`aud`、未过期、`sub` 等于会话用户。再做有库校验：
- 本人平台角色仍为 `super_admin`；
- 仍是该企业 active 成员；
- 企业仍是岗位模式；
- 所选岗位都仍是 active 的人类岗位。

有库校验结果按 token 在进程内缓存 30 秒（与路由门判定输入的时效相同），并带出预览权限行与岗位名。任一校验不过即「无预览」。

被否决：
- 直接用 `JWT_SECRET` 签。会话校验不查 `aud`，把预览 cookie 的值放进 `qy_session` 就是一枚 2 小时的完整会话。
- 改会话校验去拒带 `aud` 的 token。要动登录全链路，且旧会话 token 的形状不受本次控制。
- 把预览存在 `User.settings`（JSON 位）。会作用到本人所有设备与会话，开启要写库，也不能自然过期。
- 不签名、只靠库校验。签名把 cookie 绑在本人会话上，篡改或拿到别人的 cookie 都不生效；代理层拒写也只能靠签名判（代理不读库）。

### D5 统一落点：按请求取预览，在产生身份的几处改写（Q6）

新增：
- `src/lib/preview/token.ts`（纯）：编解码与无库校验。
- `src/lib/preview/identity.ts`（纯）：由 viewer 输入构造预览身份，即平台角色、成员角色、权限行、可用企业。
- `src/lib/preview/server.ts`：
  - `getRequestPreview(request)`：路由处理函数用，读 `request.cookies`；
  - `getAmbientPreview(userId)`：没有 request 的库函数用。先看本模块的 AsyncLocalStorage 里有没有显式注入的 token（`withPreviewToken(token, fn)` / `withoutPreview(fn)`，代理、登录与测试用）；没有再读 `next/headers` 的 `cookies()`。`cookies()` 抛错时先 `unstable_rethrow`（放过 Next 内部的控制流错误），其余按无预览。
  - 两者都做 D4 的两层校验。结果按「token + userId」缓存 30 秒，含 JWT 校验结果，所以一个请求里多次调用只是一次 `cookies()` 加一次查表。另有仅测试用的清缓存钩子。

落点（每处在「有有效预览且 userId 是预览本人」时改写，否则原样）：
1. **API 鉴权** `getCurrentUser`（另把 `/api/auth/me` 的 `activeOrgId`、`effectiveRole` 改为按预览企业）：返回平台角色 `user`，另带 `preview`（企业、岗位 key 与名称、到期）。约 80 个文件里按 `user.role` 判的 super_admin 放行随之失效。
2. **权限判定** `resolveEffectiveBindings`（HUMAN 主体）：企业为预览企业时返回预览权限行（来源标 `preview:<岗位>:<行>`），其他企业返回空，不再按库里的平台角色给全权。
3. **成员、企业解析与处理人范围**：
   - `loadOrgNavigationInputsDetailed`：预览企业时成员角色 `org_member`、`hasMembership` true、`permissionKeys` 取预览权限行里的 ALLOW 键、`positionMode` true。路由门加载器与 `loadNavigationContextForOrg` 的三个调用方（首页、AI 作业可读域、AI 入口门）一处覆盖。
   - `getTeamApprovalAccessIds`：预览时企业范围为空（不是企业所有者、不是 org_admin），项目范围只取预览企业里本人负责或任 project_admin 的项目。
   - `getOrgMembership`：预览企业返回成员角色 `org_member` 的 active 成员，其他企业返回空。
   - `resolvePreferredOrgId`：返回预览企业，可选企业只有它，不写 `activeOrgId`。
   - `resolveTradeOrgId`、`resolveRequestOrgIdForUser`、`getTenantContext`、`resolveWorkforceApiOrgForUser`：目标企业不是预览企业即按非成员处理；`getTenantContext` 的 `orgRole` 为 `org_member`、`isPlatformAdmin` 为 false。
4. **路由门加载器与 Autopilot**：代理用 `withPreviewToken` 把请求里的 cookie 显式注入，路由门判定在其中执行，不依赖 `cookies()` 在代理里的行为。
   - `loadUser` 返回平台角色 `user`；可用企业只有预览企业。
   - 判定输入的 `permissionKeys` 取预览权限行里的 ALLOW 键，`orgRole` 为 `org_member`，`positionMode` 为 true。
   - 缓存键改为 `${userId}:${orgId}:${预览指纹}`，预览与非预览的结果互不串用。
   - `autopilotAllowed`（判定输入与 `/api/auth/me`）在预览中为 false；`autopilot/page-guard` 预览中拒绝。
5. **直接读库判身份的可见层读取点**：
   - `/api/auth/me`：`role` 与 `effectiveRole` 按预览，另返回 `preview` 供横幅；
   - `/api/auth/active-org`：判定输入按预览，不写当前企业；
   - 页面判定输入（`page-context-server`）；
   - `loadApprovalViewer`：`isPlatformAdmin` false，`isOrgHandler` / `isOrgAdminRole` false；
   - `posts-read-model`：成员角色、平台角色；
   - `buildCapabilitiesAccess`：成员角色；
   - `/api/agent-core/tools`、`/api/search`；
   - `platform-admin-guard`、`autopilot/page-guard`：预览中按非 super_admin。
6. **代理**：见 D6。

被否决：
- 把 `preview` 参数一路传进所有调用方。`authorize()` 一处就有 27 个调用文件，成员读取更多，漏传就是不一致。
- 按 userId 记一张进程内的「谁在预览」表。同一用户别的设备、并发请求会被一起改写，违反「只影响带 cookie 的浏览器会话」。
- 把预览塞进 `withAuth` 的 AsyncLocalStorage。只有 `withAuth` 设它，`requireAuth`、`requireProject*Access` 等路由拿不到。

### D6 只读在代理层统一拒（Q4）

`src/proxy.ts` 在最前面（静态资源之后、公开路径放行之前）判：
- 请求方法不是 GET / HEAD / OPTIONS（不限路径，含页面路径，防将来的服务端动作）；
- 不是豁免请求：`DELETE /api/admin/preview`、`POST /api/auth/logout`、`POST /api/auth/login`；
- 有通过校验的会话 cookie，且有通过无库校验（签名、`aud`、过期、`sub` 等于会话用户）的预览 cookie。

三条都满足即返回 409 `{ error: "预览中为只读，不能修改数据。退出预览后再操作。", code: "PREVIEW_READONLY" }`，不进入任何处理函数。客户分享链接的签字等公开写接口在预览中同样被拒（预览的浏览器不该替客户签字）。

另外，代理里旧的「JWT 平台角色 sales 拦营销 API」规则在预览中按平台角色 `user` 判。

被否决：
- 放在会话校验之后（公开路径之后）。公开路径先放行，客户签字等写接口会漏过。
- 在 `withAuth` / `getCurrentUser` 里拒写。覆盖不到不经它们的路由，也要在 756 个路由文件里确认没有漏网。
- 写操作白名单（如放行 AI 对话、标已读）。AI 对话会写会话、可能起草审批卡，而起草卡的处理人判定按预览身份，结果没有意义；标已读改的是本人数据。一刀切最好验证。

### D7 客户端：开启 / 退出整页刷新，横幅常驻（Q8）

- 「岗位」一节：成员行加「以 TA 的岗位预览」；编辑面板旁加「按岗位组合预览」，勾选后开启。开启成功后 `window.location.assign("/")`，整页刷新，丢掉客户端缓存（当前用户、判定输入、模块）。
- `AppShell` 顶部横幅：读 `/api/auth/me` 的 `preview`（`state`、企业名、岗位名、到期）。
  - `state: "active"` 时显示企业名、岗位名、剩余分钟数（每分钟刷新显示）与「退出预览」；
  - `state: "invalid"`（签名有效、库校验不过）时显示「预览已失效 · 退出」，避免横幅消失而写仍被拒、找不到退出入口。
  - 退出调 `DELETE /api/admin/preview` 后同样整页刷新到 `/`。
- 登录（`login`、微信回调）时清掉 `qy_preview`，重新登录后预览不会静默复活。
- `active-org-hydrator`：预览中不发 PATCH。`header` 标已读：预览中不发。AI 对话输入框：预览中禁用，提示「预览中为只读」。
- 预览中 super_admin 本人平台角色为 `user`，「岗位」一节随之不显示，不能在预览里再开新的预览。要换岗位得先退出。

被否决：开启后局部刷新。侧栏、模块、当前用户分散在多个客户端缓存里，漏刷一处就是半预览状态。

### D8 审计（Q9）

开启、退出、带有效预览时登出各写一条审计记录，经既有 `logAudit`：
- `action`：`PREVIEW_STARTED` / `PREVIEW_ENDED`；
- `targetType`：`organization`，`targetId` 为企业；
- `afterData`：岗位 key 与到期时间；不含 token。

退出接口允许在预览中调用（豁免拒写）；它只需会话，不判平台角色，因为预览中平台角色已是 `user`。到期自然失效与重新登录（清 cookie）不写。

被否决：不留痕。预览会让 super_admin 临时失去平台权限，留痕便于事后核对「那段时间为什么批不了」。

### D9 GET 写库：已知的逐个停写，另加扫描测试（Q4）

预览期间（`getAmbientPreview` 有效）：
- `resolvePreferredOrgId`、`ensureFixedUserActiveOrg`：不写 `activeOrgId`（D5）。
- `GET /api/sales/daily-briefing`：不生成、不建通知、不覆盖缓存；有当日缓存就照样返回，没有就返回空并标 `previewReadonly: true`。
- `GET /api/operations/market-intelligence`：不调 `ensureMarketingSkill`；技能已存在就照常读，不存在就返回空。
- `GET /api/capabilities/approvals/[id]` 的审计：照写。审计如实记录「谁在什么时候看了」。

另加源码扫描测试：列出 `src/app/api/**/route.ts` 里导出 GET 且含写库调用（`.create(` / `.update(` / `.upsert(` / `.delete(` / `createNotification(` 等）的文件，与测试里的登记表逐个比对。登记表每条写明预览下的行为（停写 / 照写审计 / 公开路径不带会话）；新增未登记的 GET 写库会让测试失败。

被否决：
- 用 Prisma 扩展在数据库层统一拦写。`db` 是普通 `PrismaClient`（`src/lib/db.ts`），`$extends` 会改掉全站 `db` 的类型；登录、退出与审计又要逐个开口子，改动面比收益大。
- 只靠代理拒写，不管 GET。按预览范围生成的简报会落进本人通知，退出后不带 cookie 的会话当天仍读到预览版，违反「只影响带 cookie 的会话」。

## 与八条硬纪律的关系

1. **零 schema**：预览状态只在 cookie；审计落既有 AuditLog；不改 Prisma。
2. **出站先审批**：预览期间所有写请求在代理层被拒，不会建卡、不会执行、不会出站。审批流程与执行器不改。
3. **禁止第三套队列**：不涉及，不新增队列或 cron。
4. **脱敏**：不涉及字段级输出。预览只收窄可见范围；cookie 值不出现在任何响应里。
5. **不爬登录页**：不涉及。
6. **邮箱分离**：不涉及。
7. **确定性优先**：全部是查表与签名校验，零 LLM 调用。
8. **测试注册**：两个新测试注册进 `scripts/test-all.sh`。纯函数测试另进 `scripts/test-ci-unit.sh`；隔离库测试在 CI 无库时跳过。

## Risks / Trade-offs

- **[记录级数据不等于那位同事看到的]** → 数据范围按本人 userId（D1）。例如以销售岗位预览时，销售列表里是 Lucas 自己的客户（多半为空），不是 Lynn 的。报告与横幅说明「预览的是岗位能看到哪些入口与页面」。
- **[直接读成员表的 134 处看到的是本人真实成员角色]** → 这些读取多在写接口或业务明细里，写已全拒。读的差异只会让预览比真实岗位多看或少看个别明细，不影响 D5 列出的面。报告列出已改写的落点，验收以这些面为准。
- **[用 POST 做查询的接口在预览中被拒]** → 如 AI 对话、个别导出。横幅说明只读，界面提示「预览中为只读」。本次不加白名单。
- **[`next/headers` 的隐式读取在请求之外不可用]** → 抛错时按无预览，所以脚本、测试默认不受影响。测试、代理与登录用 `withPreviewToken` / `withoutPreview` 显式注入，不依赖它在请求之外的行为。
- **[判定缓存串用]** → 路由门缓存键带预览指纹，预览校验缓存按 token。开启 / 退出整页刷新，丢掉客户端缓存。
- **[预览中失去平台权限，忘了退出]** → 横幅常驻并显示剩余时间，2 小时自动失效，登出也清。
- **[cookie 被盗]** → httpOnly、派生密钥签名、绑定本人会话，且不能当会话用。被盗也只是在本人会话上收窄权限。
- **[GET 写库清单不全]** → D9 的扫描测试按源码列出，未登记即失败。按函数名匹配是近似：经多层辅助函数间接写库的 GET 可能漏网，独立审查时专门再查一遍。
- **[预览失效后仍被拒写]** → 横幅显示「预览已失效 · 退出」，409 文案带「退出预览后再操作」；登出、重新登录也清。

## Migration Plan

- 合并后照常部署，无回填、无开关。
- 回滚：回退代码即可。旧代码不认 `qy_preview`，残留的 cookie 被忽略，2 小时内自然过期。

## 验证方式

- 纯函数测试 `src/lib/preview/__tests__/preview.test.ts`：
  - cookie 编解码与无库校验：篡改、过期、他人、`aud` 不符；
  - 预览身份构造；
  - 代理拒写：注入假加载器调 `handleRequest`，覆盖各方法、豁免路径、无效 cookie 不拒写；
  - 营销 API 旧规则按 `user` 判；
  - 预览 cookie 当会话 token 校验被拒；会话 token 当预览校验被拒；
  - GET 写库扫描与登记表一致（D9）；
  - 源码断言：D5 的每个落点都经 `src/lib/preview/server.ts`；`resolveEffectiveBindings` 在预览时不读库里的平台角色；`resolvePreferredOrgId` 预览时不写 `activeOrgId`；路由门缓存键含预览指纹；代理拒写在公开路径放行之前；登录与微信回调清预览 cookie。
- 路由门测试 `src/lib/navigation/__tests__/route-gate.test.ts` 补「预览期间按预览身份判定」。
- 隔离库测试 `src/lib/preview/__tests__/preview-db.isolated.test.ts`，在本机 Postgres 16 上实跑，覆盖 spec 的全部场景：
  - 开启与开启条件（含 404、空列表、11 个岗位）；预览身份；平台特权不可用；
  - 会计 / 老板看到的（含「待我确认」）；GET 不写业务数据（当前企业、简报通知）；
  - 失效四种情形与退出；审计；cookie 不出现在响应；不带 cookie 的请求照旧。
  - 用 `withPreviewToken` 注入 cookie 进入预览，每次改动库后清预览校验缓存。
- 补跑受影响的既有测试并对照基线：route-gate、entry-visibility、position-nav、platform-admin-scope、residual-reads、audience、posts-read-model、tenant-context、`effective-platform-role-db.isolated`、`platform-admin-scope-db.isolated`、`audience-db.isolated`。
- 门禁：
  - `npm run test:ci`；
  - `npm test`，与 origin/main 对比环境类失败；
  - `NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck`；
  - `npm run lint:baseline`；
  - `bash scripts/check-test-registry.sh`；
  - `NODE_OPTIONS=--max-old-space-size=8192 npx next build --webpack`；
  - `openspec validate vis-1e-preview-as-position --strict`。

## 审核关注点（偏离或补充任务书之处，请拍板）

拍板结果（Lucas 2026-11-11）：Q1–Q9 全部按推荐执行。

- **Q1（D1 / D2）预览单位**：按岗位集合，一位成员的全部岗位或手选组合。任务书写的是单个岗位。
- **Q2（D3）预览范围**：只在本人是 active 成员的岗位模式企业里预览。Lucas 是 Sunny 与梦馨的成员，够用。
- **Q3（D1）成员角色**：预览中视同 `org_member`、不当企业所有者，不保留本人的 org_admin / org_owner。
- **Q4（D6）只读一刀切**：含 AI 对话、标已读、用 POST 做查询的接口；只豁免退出与登出。
- **Q5（D1）记录级数据**：仍按本人，列入局限，不做冒充具体用户。
- **Q6（D5）落点偏离任务书**：任务书写的 `resolveWorkspaceContextFromCookies` 只做登录检查，改为 D5 的统一落点。
- **Q7（D4）cookie**：签名 JWT、专用 `aud`、2 小时、不续期。
- **Q8（D7）开启与退出**：都整页刷新回到首页；预览中不能再开新的预览，要先退出。
- **Q9（D8）审计**：开启、退出各一条，到期失效不写。
- 实现期独立审查后补入（四件套第一轮审查，未改变 Q1–Q9 的结论）：
  - 预览 cookie 改用派生密钥（D4）；
  - 拒写挪到公开路径之前、不限路径、登录豁免（D6）；
  - GET 写库停写与扫描测试（D9）；
  - 失效横幅与登录清预览（D7）；
  - 导航判定输入、团队审批处理人范围、Autopilot、当前用户接口的当前企业四处落点（D5）；
  - spec 增加「其他能力中的平台 super_admin 规定」。
