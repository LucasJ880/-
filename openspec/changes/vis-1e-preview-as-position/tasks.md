# Tasks

每条带验证；真实输出写进 `docs/QINGYAN_VIS-1e_REPORT.md`。

受影响测试基线（2026-11-11，origin/main a6908f9f）：

| 测试 | 通过数 |
|---|---|
| route-gate | 141 |
| entry-visibility | 73 |
| position-nav | 101 |
| platform-admin-scope | 43 |
| residual-reads | 76 |
| audience | 98 |
| posts-read-model | 162 |
| tenant-context | 28 |
| marketing-middleware-access | 4 |
| effective-platform-role | 63 |
| authorize | 174 |

要数据库的既有测试，在本机隔离库起好后先在 origin/main 上跑一次记基线：`effective-platform-role-db`、`platform-admin-scope-db`、`audience-db`、`residual-reads-db`、`position-binding-console-db`、`org-scoped-users-db`。

## 1. 预览核心

- [x] 1.1 按 design D4 / D5 新增预览核心：
  - `src/lib/preview/token.ts`（纯）：
    - 派生密钥：HMAC-SHA256(`JWT_SECRET`, `"qy-preview-v1"`)；
    - 签发与无库校验：签名、`aud: "qy-preview"`、过期、`sub` 等于会话用户、岗位 key 1–10 个。
  - `src/lib/preview/identity.ts`（纯）：
    - 由有库校验的结果构造预览身份：平台角色 `user`、成员角色 `org_member`、权限行、可用企业；
    - 代理拒写判定：方法、豁免请求（退出 / 登出 / 登录）。
  - `src/lib/preview/server.ts`：
    - `getRequestPreview(request)`、`getAmbientPreview(userId)`；
    - `withPreviewToken(token, fn)` / `withoutPreview(fn)`（AsyncLocalStorage 显式注入）；
    - `cookies()` 抛错先 `unstable_rethrow`；
    - 有库校验：本人仍是 super_admin、仍是该企业 active 成员、企业是岗位模式、岗位都是 active 的人类岗位；
    - 结果按「token + userId」缓存 30 秒，带出权限行、企业名与岗位名，失效时给出 `invalid` 状态；
    - 仅测试用的清缓存钩子。
  - 先写 `src/lib/preview/__tests__/preview.test.ts`，覆盖：
    - 编解码；篡改 / 过期 / 他人 / `aud` 不符；预览 cookie 当会话校验被拒、会话 token 当预览被拒；
    - 预览身份构造；拒写判定（各方法、豁免请求、无效 cookie 不拒写）；
    - `preview/token.ts` 与 `identity.ts` 不导入数据库与 `next/*`。
  - 注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`。
  - verify：新测试全过；`bash scripts/check-test-registry.sh` 通过。

## 2. 开启与退出

- [x] 2.1 按 design D2 / D4 / D7 / D8 新增开启与退出：
  - `src/app/api/admin/preview/route.ts`：
    - `POST`：只允许平台 super_admin（`PLATFORM_ADMIN_REQUIRED`）。按 spec「开启条件」的顺序校验（404，`PREVIEW_ORG_NOT_POSITION_MODE` / `PREVIEW_NOT_MEMBER` / `PREVIEW_POSITION_INVALID` 400）。成功写 `qy_preview`（httpOnly、生产 secure、lax、`path /`、2 小时），返回 `{ orgId, orgName, positions, expiresAt }`，写 `PREVIEW_STARTED` 审计。
    - `DELETE`：只需会话，清 cookie，返回 `{ ok: true }`；有有效预览时写 `PREVIEW_ENDED` 审计。
  - 登出：清 `qy_preview`，有有效预览时写 `PREVIEW_ENDED`。登录与微信回调：清 `qy_preview`，在 `withoutPreview` 中执行。
  - verify：
    - `preview.test.ts` 补源码断言：POST 经平台管理员要求；cookie 属性；审计不含 token；登出 / 登录 / 微信回调清预览 cookie；
    - typecheck 通过。

## 3. 鉴权、权限、成员与导航判定输入

- [x] 3.1 按 design D5 落点 1–3 改写：
  - `getCurrentUser`：有效预览时平台角色 `user`，带 `preview`。
  - `resolveEffectiveBindings`（HUMAN）：预览企业返回预览权限行（来源 `preview:<岗位>:<行>`），其他企业返回空，在读平台角色之前返回。
  - `getOrgMembership`：预览企业返回成员角色 `org_member` 的 active 成员，其他企业空。
  - 当前企业：
    - `resolvePreferredOrgId`、`ensureFixedUserActiveOrg` 返回预览企业、不写 `activeOrgId`；
    - `resolveTradeOrgId`、`resolveRequestOrgIdForUser`、`getTenantContext`、`resolveWorkforceApiOrgForUser` 非预览企业按非成员；
    - `getTenantContext` 的 `orgRole` 为 `org_member`、`isPlatformAdmin` false。
  - `loadOrgNavigationInputsDetailed`：预览企业时成员角色、`hasMembership`、`permissionKeys`、`positionMode` 按预览。
  - `getTeamApprovalAccessIds`：预览时企业范围空，项目范围只取预览企业内本人负责或任 project_admin 的。
  - `/api/auth/me`：`role`、`effectiveRole`、`activeOrgId` 按预览，另返回 `preview: { state, orgId, orgName, positions, expiresAt }`，不含 token。
  - `/api/auth/active-org`：判定输入按预览，不写当前企业。
  - 改测试：`authorize`（174）、`tenant-context`（28）、`effective-platform-role`（63）、`platform-admin-scope`（43）若断言调用形状则同步。
  - verify：
    - 上述测试不降；
    - `preview.test.ts` 补源码断言：每处都经 `src/lib/preview/server.ts`；`resolveEffectiveBindings` 预览时在读平台角色之前返回；`resolvePreferredOrgId` 预览时不调写 `activeOrgId` 的函数。

## 4. 路由门、代理、Autopilot 与 GET 写库

- [x] 4.1 按 design D5 落点 4、D6、D9 改写：
  - 路由门：
    - `RouteGateUser` 带预览；`ROUTE_GATE_LOADER` 的 `loadUser`、可用企业按预览；缓存键含预览指纹；
    - `page-context-server`、`platform-admin-guard`、`autopilot/page-guard` 按预览；
    - `autopilotAllowed`（判定输入与 `/api/auth/me`）预览中为 false。
  - `src/proxy.ts`：
    - 预览拒写：在公开路径放行之前判，不限路径，非 GET / HEAD / OPTIONS，有效会话 + 有效预览 cookie；豁免退出 / 登出 / 登录；返回 409 `PREVIEW_READONLY`；
    - 路由门判定在 `withPreviewToken` 中执行；
    - 营销 API 旧规则在预览中按 `user` 判。
  - GET 写库：
    - `daily-briefing` 预览中不生成、不建通知、不覆盖缓存；
    - `market-intelligence` 预览中不调 `ensureMarketingSkill`；
    - `preview.test.ts` 加 GET 写库扫描与登记表。
  - 改测试：`route-gate.test.ts` 补「预览期间按预览身份判定」；假加载器随类型补字段。
  - verify：
    - route-gate（141 + 新增）、entry-visibility（73）、position-nav（101）、marketing-middleware-access（4）全过；
    - `preview.test.ts` 经 `handleRequest` 断言拒写（业务 API、公开签字接口、页面路径）与豁免。

## 5. 其余可见层读取点与界面

- [x] 5.1 按 design D5 落点 5 与 D7 改写：
  - 读取点：
    - `loadApprovalViewer`：预览时 `isPlatformAdmin` / `isOrgHandler` / `isOrgAdminRole` 为 false；
    - `posts-read-model`、`buildCapabilitiesAccess`：成员角色、平台角色按预览；
    - `/api/agent-core/tools`、`/api/search` 按预览。
  - 界面：
    - `positions-section.tsx`：成员行「以 TA 的岗位预览」、编辑面板「按岗位组合预览」，成功后整页刷新到 `/`；
    - `app-shell.tsx`：横幅。`active` 显示企业 · 岗位、剩余分钟、退出；`invalid` 显示「预览已失效 · 退出」。退出后整页刷新到 `/`；
    - `active-org-hydrator.tsx`：预览中不 PATCH；`header.tsx`：预览中不标已读；AI 对话输入：预览中禁用并提示。
  - verify：
    - audience（98）、posts-read-model（162）、residual-reads（76）全过；
    - `preview.test.ts` 补源码断言：上述读取点都经 `src/lib/preview/server.ts`；客户端三处在预览中不发写请求；横幅两种状态的文案。

## 6. 隔离库测试

- [x] 6.1 新增 `src/lib/preview/__tests__/preview-db.isolated.test.ts` 并在本机 Postgres 16 上实跑：
  - 种子：
    - 虚构窗饰企业（与 Sunny 同一行业包，岗位模式）：含 `owner`、`bids`、`accounting` 岗位，另有一张他人让利审批卡、一张询价卡、一张质保邮件卡；
    - 虚构家纺企业（岗位模式）；
    - 虚构旧模式企业；
    - 虚构的 super_admin 不是成员的企业。
    - super_admin 是窗饰、家纺、旧模式三家的 active 成员，当前企业为家纺企业；另有平台 `admin` 与持 `owner` 岗位的 `user` 各一。
  - 用 `withPreviewToken` 注入 cookie 进入预览；每次改库后清预览校验缓存。
  - 断言 spec 的全部场景：
    - 开启：非 super_admin 被拒；开启成功；不满足条件（404、旧模式、非成员、空列表、11 个、停用岗位）。
    - 身份与可见：预览身份；平台特权不可用；会计 / 老板看到的。
    - 只读：GET 不写业务数据（当前企业、简报通知）。
    - 失效与退出：失效四种情形、退出。
    - 其他：审计两条；cookie 不出现在响应；不带 cookie 的请求照旧。
  - 不执行任何审批或出站：所有写请求都应被拒。
  - 注册进 `scripts/test-all.sh`（无库跳过）。
  - 用同一个库补跑开头列出的既有隔离库测试，与 origin/main 基线对照。
  - verify：隔离库测试在本机库上全过，输出写进报告；无库时跳过、退出码 0。

## 7. 门禁与独立审查

- [ ] 7.1 跑门禁并做独立代码审查：
  - 门禁：
    - `npm run test:ci`；
    - `npm test`，与 origin/main 对比环境类失败；
    - `NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck`；
    - `npm run lint:baseline`；
    - `bash scripts/check-test-registry.sh`；
    - `NODE_OPTIONS=--max-old-space-size=8192 npx next build --webpack`；
    - `openspec validate vis-1e-preview-as-position --strict`。
  - 起独立审查子代理：只给 diff 与 spec 增量，不给 design。重点：
    - 预览能否扩大权限；
    - 能否绕过拒写，含 GET 写库与间接写库；
    - 能否影响不带 cookie 的会话；
    - 预览 cookie 能否当会话。
  - 修掉 Major 及以上，处理写进报告。
  - verify：门禁全过（或失败与 origin/main 相同）；审查发现逐条有处理记录。

## 8. 报告与 TASKFLOW

- [ ] 8.1 写 `docs/QINGYAN_VIS-1e_REPORT.md` 并同步 TASKFLOW：
  - 报告包含：
    - 改动清单与 D5 落点清单（每处一行）、D9 的 GET 写库登记表；
    - 按岗位的预览结果表（Sunny 老板、会计、销售、招投标、运营、梦馨 Cathy），由真实实现计算；
    - 测试数（对照基线）、隔离库测试输出、门禁输出、审查处理；
    - 已知局限：记录级数据、直接读成员表的读取、用 POST 查询的接口；
    - 上线后生产核对清单（Lucas 以 Sunny 会计、销售预览各走一遍）。
  - `docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md`：VIS-1e 状态改为 `[~]`（开 PR 时），合并并归档后改为 `[x]`。
  - verify：报告里每个数字都来自本次真实输出；TASKFLOW 状态与 `git log --oneline --merges` 一致。
