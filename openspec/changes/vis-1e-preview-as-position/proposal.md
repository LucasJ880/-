# Proposal：平台管理员「以岗位预览」（VIS-1e）

TASKFLOW：VIS-1e（Phase V「可见性收口」；任务书 `docs/QINGYAN_VIS-1_VISIBILITY_TASKBRIEF.md` §VIS-1e，Lucas 2026-11-08 拍板判断点 6「纳入本期，作为最后一个 PR」）。依赖 VIS-1a / 1b / 1c / 1d（#393、#400、#410、#432）。

## Why

VIS-1a–1d 按岗位收口了导航、路由门、首页、通知、设置、搜索、AI 工具与审批，但 Lucas 是平台 super_admin，看到的永远是全部，验收只能借同事账号。需要一个只读的「以岗位预览」，让 super_admin 在不改任何数据的前提下看到某个岗位组合看到的东西。

## What Changes

**开启与退出**
- 新增 `POST /api/admin/preview`：只允许平台 super_admin。传入企业与岗位集合（一位成员的全部岗位，或手选的岗位组合），写一枚签名的 httpOnly cookie `qy_preview`（企业、岗位集合、本人 userId、2 小时过期），零 schema。只能预览：岗位模式企业、本人是该企业 active 成员、岗位都是该企业 active 岗位。
- 新增 `DELETE /api/admin/preview`：清 cookie。登出同时清预览 cookie。
- 开启与退出各写一条 AuditLog。
- 企业详情页「岗位」一节：每位成员行加「以 TA 的岗位预览」，另加「按岗位组合预览」（勾选岗位）。

**预览身份**
- 预览期间，系统把该用户当作：平台角色 `user`、该企业的 active 成员、成员角色 `org_member`、不是企业所有者、权限 = 所选岗位在该企业的权限、岗位模式；只在预览企业内，别的企业一律当作非成员。本人提交的记录、指定审批人、工作区与项目成员关系照旧是本人的。
- 改身份的统一落点：
  - `getCurrentUser`（API 鉴权的唯一入口）返回平台角色 `user`；
  - `resolveEffectiveBindings` 返回所选岗位的绑定；
  - 成员解析（`getOrgMembership`、当前企业解析、租户上下文）只认预览企业，成员角色为 `org_member`；
  - 路由门加载器（用户、可用企业、判定输入，缓存键带预览指纹）；
  - 直接读库判定身份的可见层读取点：`/api/auth/me`、`/api/auth/active-org`、页面判定输入、审批可见判定输入、首页岗位总览、审批中心访问上下文、AI 工具列表、全局搜索、平台管理员页门与 Autopilot 页门。
- 导航、路由门、首页、通知、设置、搜索、审批、AI 工具、AI 作业全部按预览身份判定。
- 预览期间，GET 请求不改当前企业（`activeOrgId` 不写）。

**只读**
- 预览期间，所有非 GET / HEAD / OPTIONS 的 `/api/**` 请求在代理层返回 409 `PREVIEW_READONLY`，不进入路由处理函数。退出预览与登出两个接口豁免。
- 代理层旧的「JWT 平台角色 sales 拦营销 API」规则在预览期间按平台角色 `user` 判。

**横幅**
- 应用顶部常驻横幅：正在以〈企业 · 岗位〉预览（只读）、剩余时间、「退出预览」。
- 客户端在预览期间不发自动写请求：不回写当前企业、不标已读；AI 对话输入框禁用并说明原因。

**失效**
- cookie 签名不符、已过期、不属于当前会话用户、本人已不是平台 super_admin、已不是该企业 active 成员、企业已不是岗位模式、所选岗位已停用：一律按无预览处理，读取恢复本人身份。
- 写拒绝只看签名与过期：签名有效、未过期、属于当前会话用户的 cookie 存在时一律拒写，直到退出或过期。

**规格**
- 改 `navigation/route-gate`「平台 super_admin 不受路由门限制」：预览期间不适用。
- 改 `authorization/platform-admin-authority`「平台管理员在企业内全权」：预览期间不适用。

**测试**
- 新增纯函数测试：cookie 编解码与校验、预览身份构造、写拒绝判定、各落点的源码断言。
- 新增隔离库测试：本机 Postgres 16。以 Sunny 会计、销售、老板岗位预览，断言：
  - 路由门与侧栏判定输入；
  - 审批可见；
  - 首页岗位卡；
  - 权限判定；
  - 写请求 409；
  - 失效回退；
  - `activeOrgId` 不被改写。
- 新测试注册进 `scripts/test-all.sh`（纯函数测试另进 `scripts/test-ci-unit.sh`）。

## Capabilities

### New Capabilities
- `authorization/position-preview`：平台 super_admin 以岗位组合只读预览一个企业：开启 / 退出、预览身份、跟随预览判定的面、只读、横幅、失效与审计。

### Modified Capabilities
- `navigation/route-gate`：「平台 super_admin 不受路由门限制」加预览期间的例外。
- `authorization/platform-admin-authority`：「平台管理员在企业内全权」加预览期间的例外。

不触碰 muse-bridge：Muse 与微信请求不带浏览器 cookie，不受预览影响。

## Impact

- 新增：
  - `src/lib/preview/`：cookie 编解码与校验（纯函数）、按请求取预览（服务端）、预览身份构造；
  - `src/app/api/admin/preview/route.ts`；
  - 横幅组件；
  - 对应测试。
- 修改：
  - 鉴权与权限：`src/lib/auth/index.ts`（`getCurrentUser`、`getOrgMembership`）、`src/lib/authorization/resolve-effective-permissions.ts`；
  - 企业解析：`src/lib/organizations/active-org.ts`、`src/lib/tenancy/context.ts`、`src/lib/trade/access.ts`（`resolveTradeOrgId`）、`src/lib/auth/resolve-request-org.ts`、`src/lib/workforce-runtime/read-model/api-org.ts`；
  - 路由门：`src/lib/navigation/context-server.ts`、`route-gate.ts`、`page-context-server.ts`、`src/proxy.ts`；
  - 可见层读取点：`src/app/api/auth/me/route.ts`、`src/app/api/auth/active-org/route.ts`、`src/lib/approval/audience-server.ts`、`src/lib/cockpit/posts-read-model.ts`、`src/lib/capabilities/access.ts`、`src/app/api/agent-core/tools/route.ts`、`src/app/api/search/route.ts`、`src/lib/auth/platform-admin-guard.ts`、`src/lib/autopilot/page-guard.ts`；
  - 登出：`src/app/api/auth/logout/route.ts`；
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
