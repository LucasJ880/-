# Proposal：平台管理员「以岗位预览」（VIS-1e）

TASKFLOW：VIS-1e（Phase V「可见性收口」；任务书 `docs/QINGYAN_VIS-1_VISIBILITY_TASKBRIEF.md` §VIS-1e，Lucas 2026-11-08 拍板判断点 6「纳入本期，作为最后一个 PR」）。依赖 VIS-1a / 1b / 1c / 1d（#393、#400、#410、#432）。

## Why

VIS-1a–1d 按岗位收口了导航、路由门、首页、通知、设置、搜索、AI 工具与审批，但 Lucas 是平台 super_admin，看到的永远是全部，验收只能借同事账号。需要一个只读的「以岗位预览」，让 super_admin 在不改任何数据的前提下看到某个岗位组合看到的东西。

## What Changes

**开启与退出**
- 新增 `POST /api/admin/preview`：只允许平台 super_admin。传入企业与 1–10 个岗位 key（一位成员的全部岗位，或手选的组合），写一枚签名的 httpOnly cookie `qy_preview`（企业、岗位、本人 userId、2 小时过期），零 schema。只能预览本人是 active 成员的岗位模式企业，岗位须是该企业 active 的人类岗位。
- 新增 `DELETE /api/admin/preview`：清 cookie。
- 改登出与登录：都清掉预览 cookie。
- 写审计：开启、退出、带预览登出各一条 AuditLog。
- 在企业详情页「岗位」一节加入口：每位成员行「以 TA 的岗位预览」，另加「按岗位组合预览」（勾选岗位）。

**预览身份**
- 改写预览期间的身份：
  - 平台角色 `user`；
  - 该企业的 active 成员，成员角色 `org_member`，不是企业所有者；
  - 权限 = 所选岗位在该企业的权限；岗位模式；
  - 当前企业 = 预览企业；别的企业一律当作非成员。
  - 本人提交的记录、指定审批人、工作区与项目成员关系照旧是本人的。
- 在产生身份的统一落点改写：
  - `getCurrentUser`（API 鉴权的唯一入口）；
  - `resolveEffectiveBindings`；
  - 成员与当前企业解析；
  - 企业导航判定输入的构造；
  - 团队审批处理人范围；
  - 路由门加载器（缓存键带预览指纹）；
  - Autopilot 判定；
  - 直接读库判身份的可见层读取点：当前用户、当前企业、审批可见判定输入、首页岗位总览、审批中心访问上下文、AI 工具列表、全局搜索、平台管理员页门。
- 让导航、路由门、首页、通知、设置、搜索、审批、AI 工具、AI 作业全部按预览身份判定，其他能力里对平台 super_admin 的放行在预览期间不适用。

**只读**
- 在代理层拒写：预览期间任一路径上的非 GET / HEAD / OPTIONS 请求返回 409 `PREVIEW_READONLY`，在公开路径放行之前判，不进入处理函数；退出预览、登出、登录豁免。
- 停掉 GET 里的写：预览期间不写当前企业、不生成每日简报与通知、不建或改技能配置；审计照写。另加一条源码扫描测试，列出所有会写库的 GET 处理函数，新增的必须登记预览下的行为。
- 改代理层旧的「JWT 平台角色 sales 拦营销 API」规则：预览期间按平台角色 `user` 判。

**横幅与失效**
- 加应用顶部常驻横幅：正在以〈企业 · 岗位〉预览（只读）、剩余时间、「退出预览」；预览失效时显示「预览已失效 · 退出」。
- 停掉客户端在预览期间的自动写请求：不回写当前企业、不标已读；AI 对话输入框禁用并说明原因。
- 失效回退：本人已不是平台 super_admin、已不是该企业 active 成员、企业已不是岗位模式、所选岗位已停用时，读取恢复本人身份；签名不符、过期、不属于当前会话用户的 cookie 当作不存在。写拒绝只看签名、过期与会话用户。
- 用由 `JWT_SECRET` 派生的专用密钥签名，预览 cookie 不能当登录会话使用。

**规格**
- 改 `navigation/route-gate`「平台 super_admin 不受路由门限制」：预览期间不适用。
- 改 `authorization/platform-admin-authority`「平台管理员在企业内全权」：预览期间不适用。

**测试**
- 新增纯函数测试：cookie 编解码与校验（含不能当会话）、预览身份构造、代理拒写判定、GET 写库清单、各落点的源码断言。
- 新增隔离库测试（本机 Postgres 16）：以窗饰企业的会计、老板岗位预览，覆盖 spec 全部场景。
- 注册新测试进 `scripts/test-all.sh`（纯函数测试另进 `scripts/test-ci-unit.sh`）。

## Capabilities

### New Capabilities
- `authorization/position-preview`：平台 super_admin 以岗位组合只读预览一个企业：开启 / 退出、预览身份、跟随预览判定的面、只读、横幅、失效与审计。

### Modified Capabilities
- `navigation/route-gate`：「平台 super_admin 不受路由门限制」加预览期间的例外。
- `authorization/platform-admin-authority`：「平台管理员在企业内全权」加预览期间的例外。

不触碰 muse-bridge：Muse 与微信请求不带浏览器 cookie，不受预览影响。

## Impact

- 新增：
  - `src/lib/preview/`：cookie 编解码与校验（纯函数）、按请求取预览（服务端，含测试与代理用的显式注入）、预览身份构造；
  - `src/app/api/admin/preview/route.ts`；
  - 横幅组件；
  - 对应测试。
- 修改：
  - 鉴权与权限：`src/lib/auth/index.ts`（`getCurrentUser`、`getOrgMembership`）、`src/lib/authorization/resolve-effective-permissions.ts`、`src/lib/marketing/team.ts`（团队审批处理人范围）、`src/lib/autopilot/access.ts`；
  - 企业解析：`src/lib/organizations/active-org.ts`、`src/lib/tenancy/context.ts`、`src/lib/trade/access.ts`（`resolveTradeOrgId`）、`src/lib/auth/resolve-request-org.ts`、`src/lib/workforce-runtime/read-model/api-org.ts`；
  - 路由门与导航判定输入：`src/lib/navigation/context-server.ts`、`route-gate.ts`、`page-context-server.ts`、`src/proxy.ts`；
  - GET 写库：`src/app/api/sales/daily-briefing/route.ts`、`src/app/api/operations/market-intelligence/route.ts`、`src/lib/organizations/org-access.ts`（`ensureFixedUserActiveOrg`）；
  - 可见层读取点：`src/app/api/auth/me/route.ts`、`src/app/api/auth/active-org/route.ts`、`src/lib/approval/audience-server.ts`、`src/lib/cockpit/posts-read-model.ts`、`src/lib/capabilities/access.ts`、`src/app/api/agent-core/tools/route.ts`、`src/app/api/search/route.ts`、`src/lib/auth/platform-admin-guard.ts`、`src/lib/autopilot/page-guard.ts`；
  - 登出与登录：`src/app/api/auth/logout/route.ts`、`login/route.ts`、`wechat/callback/route.ts`；
  - 界面：`src/app/(main)/organizations/[orgId]/positions-section.tsx`、`src/components/app-shell.tsx`、`src/components/active-org-hydrator.tsx`、`src/components/header.tsx`（标已读）、AI 对话输入框；
  - 测试与 `scripts/test-all.sh`、`scripts/test-ci-unit.sh`。
- 硬纪律：
  - 零 schema（预览状态只在 cookie 里，审计落既有 AuditLog）；
  - 不新增权限键；零新增 LLM 调用；不新增队列 / cron；
  - 不触碰出站：预览期间一切写请求被拒，不会多出任何出站。

## Out of scope

- 以某个具体用户的身份冒充（记录级数据范围）：预览仍是本人 userId。按「本人 / 被分配」的数据范围（如销售只看自己的客户）在预览里按本人计算，不等于那位同事看到的记录。
- 非岗位模式（旧模式）企业的预览：旧模式没有岗位。
- 本人不是成员的企业的预览：需要在 134 处直接读成员表的代码里虚拟成员身份。
- 预览期间放行任何写操作，含 AI 对话与标已读。
- 预览续期：到期即失效，需重新开启。
- 移动端底栏以外的原生 App、Muse、微信通道里的预览。
