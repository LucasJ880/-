# Design

## Context

- 动机见 proposal.md「Why」，对外行为见 `specs/identity/wechat-entry/spec.md` 与 `specs/navigation/position-based-visibility/spec.md`。
- 最新 origin/main 仍是 `deccf844`（2026-11-04 fetch），与任务书核对时是同一提交；下面的核对就在这个提交上做。
- 五处入口所在的页面都是客户端组件（首行 `"use client"`），读不到服务端环境变量：
  - 登录页 `src/app/(auth)/login/page.tsx:224-237`："或"分隔线 + "微信扫码登录"按钮（点击跳 `/api/auth/wechat?next=/select-org…`）。
  - 设置页 `src/app/(main)/settings/page.tsx:246-258`："微信集成"卡片 → `/settings/wechat`。
  - `/settings/wechat`（`page.tsx` 约 33 KB：个人微信 iLink 扫码登录 + 企业微信绑定）与 `/wechat`（约 11 KB：微信消息列表 + "绑定微信"按钮）；两个路由下都只有 `page.tsx`，没有子路由。
  - 组织开通详情页 `src/app/(main)/admin/onboarding/[orgId]/page.tsx`：微信步骤 `:446-466`（提示 + 销售成员 `MembersTable` + "暂不绑定微信"确认）；`MembersTable` 定义在 `:677-713`，有"微信"列，邀请步骤 `:443` 也用它；步骤条说明 `:662` 直接显示服务端返回的 `detail`。
- `(auth)`、`(main)` 两个路由组的 layout 是服务端组件；`agent-trace`、`memory` 两个路由段已有"在 layout 里做门禁"的写法（`PlatformAdminGate`）。
- 导航：侧边栏 `src/components/sidebar.tsx` 与手机抽屉 `src/components/mobile-nav-drawer.tsx` 都在客户端用 `resolveNavigationTree(NAVIGATION_REGISTRY, ctx)` 过滤；`autopilotOwnerOnly` 入口已经是"上下文里一个服务端算好的布尔值，不为 true 就不显示"的写法。
- 平台开关的写法参照 `src/lib/muse-bridge/flags.ts`：可注入 env 的纯函数，`1` / `true` / `on` 为开。
- `next.config.ts` 没有开 `cacheComponents` / PPR；服务端组件读 `process.env` 不会把页面变成动态渲染，静态页在构建时取值。

### 任务书 §3「微信入口」核对（与任务书的出入）

| 任务书写的 | main 上实际 | 本 change 怎么处理 |
|---|---|---|
| 登录页"微信扫码登录" | 一致（`login/page.tsx:224-237`，含"或"分隔线） | 按任务书 |
| 设置页"微信"入口 | 卡片标题是"微信集成"（`settings/page.tsx:254`） | 按任务书；名称以代码为准 |
| `/settings/wechat`、`/wechat` 页 | 一致；`/wechat` 是"微信消息"页，页内另有两个指向 `/settings/wechat` 的链接（`:128` "设置"、`:315` "绑定微信"） | 整页门禁，页内链接随页面一起不渲染 |
| 组织开通页"到设置 → 微信扫码绑定"提示 | 一致（`[orgId]/page.tsx:450`）；同一步还有绑定表与"暂不绑定微信"确认。另外：**步骤条说明**来自服务端规则（`onboarding-rules.ts:602-610`，如"先邀请业务员，再让其绑定微信"）；**邀请步骤的成员表**也有"微信"列；微信步骤是必做步骤 | 提示与绑定表按任务书去掉；另隐藏成员表"微信"列、关时替换步骤说明（D5）；保留确认框，不改就绪判定 |
| （任务书未列） | **侧边栏 / 手机抽屉"微信集成"** → `/wechat`（`navigation/registry.ts:893-902`；销售本来不显示，见 `nav-role-policy.ts:69`） | 一并隐藏（D4） |
| （任务书未列，只是文字） | 开通列表页流程说明"→ 微信绑定 →"（`admin/onboarding/page.tsx:107`）、测试询盘结果"均未绑定微信"（`onboarding-test-inquiry.ts:319`）、交接提示"站内 / 微信通知"（`[orgId]/page.tsx:569`） | 不改：不是入口，见 Non-Goals |

任务书 §3 其余各行（通知、投递门禁、发件、讨论区 @、任务、订单、定时任务）只与 change B 有关，核对结果写进 `collab-notify` 的 design。

## Goals / Non-Goals

**Goals:**
- 一个服务端开关同时控制登录页、设置页、侧边栏、手机抽屉、两个微信页面与组织开通页；关时入口组件不挂载，开时渲染结果与改动前一致。
- 开关值只在服务端读取，前端拿到的只是一个布尔值。
- 开关打开时，既有导航测试的断言一条不改。

**Non-Goals:**
- 微信接口与回调：`src/app/api/auth/wechat/route.ts`、`src/app/api/auth/wechat/callback/route.ts`、`src/app/api/messaging/{bindings,gateway,messages}/route.ts`、`src/app/api/messaging/wecom/callback/route.ts`、`src/app/api/trade/webhook/wechat/route.ts`。
- 推送：`src/app/api/cron/wechat-push/route.ts`、`vercel.json`、`src/lib/messaging/{binding,binding-proof,gateway,push-service,platform-wecom}.ts`、`src/lib/messaging/adapters/*`。
- 访问控制：`src/middleware.ts`（`/api/auth/wechat` 公开路径）、`src/lib/permissions-client.ts`（两个微信页面的路由权限）、`src/lib/rbac/nav-role-policy.ts`（销售不看"微信集成"）。
- 两个微信页面本身：`src/app/(main)/settings/wechat/page.tsx`、`src/app/(main)/wechat/page.tsx` 不改，由同目录新增的 layout 门禁。
- 组织开通的数据与规则：`src/lib/organizations/{onboarding,onboarding-rules,onboarding-test-inquiry}.ts`、`src/app/api/admin/onboarding/**`；开通列表页 `src/app/(main)/admin/onboarding/page.tsx`。
- 登录页 `?wechat=error` 的错误提示（`WECHAT_ERROR_MAP`）：只有走完微信回调才会出现，保留。
- 数据：`prisma/schema.prisma`、已有的 `WeChatBinding` 记录。

## Decisions

**D1. 开关：新增 `src/lib/messaging/wechat-entry.ts`，导出 `isWechatBindingEnabled(env = process.env)`；值去空白、不分大小写后为 `1` / `true` / `on` 时为开，其余为关。**
- 被否决：`NEXT_PUBLIC_WECHAT_BINDING_ENABLED`。任务书要服务端开关；`NEXT_PUBLIC_` 变量在构建时内联进前端包，变量名也与任务书不一致。
- 被否决：组织级开关（`Organization.settingsJson`）。微信不可用是平台层的问题；组织级开关还要配管理界面，超出任务书。
- 被否决：同时接受 `yes`（`src/lib/feature-flags.ts` 的 `envBool` 接受）。与同类平台开关 `MUSE_BRIDGE_ENABLED` 的取值保持一致，取值越少越不容易误开。

**D2. 开关怎么到前端：`(auth)` 与 `(main)` 两个服务端 layout 调 `isWechatBindingEnabled()`，把结果交给客户端上下文 `WechatEntryProvider`；入口组件用 `useWechatEntryEnabled()` 读，没有上下文时为关。**
- 被否决：前端调接口取开关。每次进页面多一个请求，按钮会先出现再消失（或反过来）。
- 被否决：把每个页面拆成"服务端外壳 + 客户端组件"。登录页、设置页、开通页三个客户端页面合计约 66 KB 要整体搬进新文件，diff 大、容易与其他分支冲突；上下文只需两个 layout 各包一层。
- 说明：静态页面在构建时取值。Vercel 的环境变量本来就只对新部署生效，改开关后要重新部署，与其他环境变量相同。

**D3. 两个微信页面：在 `src/app/(main)/settings/wechat/`、`src/app/(main)/wechat/` 各加一个服务端 `layout.tsx`。开关关闭时返回"暂未开放"块、不渲染 `children`，页面组件不挂载，也就不会请求绑定列表、二维码或消息记录；开关打开时原样返回 `children`。**
- 被否决：在页面组件里按上下文提前 return。两个页面开头就有多个 hooks，提前 return 要重排 hooks；改动落在 33 KB 的页面里，容易碰到其他逻辑。
- 被否决：`notFound()` 或重定向。任务书要求显示"暂未开放"；404 会让人以为链接坏了。

**D4. 导航：`NavigationItem` 加 `wechatEntry?: boolean`（只标在 `mgmt-wechat` 上），`NavigationFilterContext` 加 `wechatEntryEnabled?: boolean`；过滤时带 `wechatEntry` 的项在 `wechatEntryEnabled !== true` 时不可见，判断放在角色与岗位判定之前，两种模式都生效。侧边栏与抽屉从上下文取值传入。写法与 `autopilotOwnerOnly` / `autopilotAllowed` 相同（缺省即不显示）。**
- 被否决：不隐藏导航项。点进去只看到"暂未开放"，等于留了一个点不通的入口；任务书写的是"**直接访问** `/wechat` 显示暂未开放"，说明它预期页面没有别的入口。
- 被否决：从注册表删除该项。任务书要求代码保留、开关打开即恢复。
- 被否决：缺省显示（只在 `wechatEntryEnabled === false` 时隐藏）。这样不用动既有测试，但新调用方忘了传值就会露出入口；跟随 autopilot 的"缺省不显示"更稳。代价是 `position-nav`、`trade-layout` 两个测试的上下文补 `wechatEntryEnabled: true`，断言不变。

**D5. 组织开通页：只改页面展示，不改规则与接口。开关关闭时：**
- 微信步骤：去掉 `/settings/wechat` 提示与销售成员绑定表，换成一行"微信绑定暂未开放。"，保留"暂不绑定微信"确认框；
- 步骤条：微信步骤为待办时，说明显示"微信绑定暂未开放，勾选「暂不绑定微信」即可完成本步"，覆盖服务端的"先邀请业务员，再让其绑定微信"；已确认 / 已完成时照常显示服务端说明；
- 成员表：`MembersTable` 拆到同目录 `members-table.tsx`，加 `showWechat` 参数，关时不渲染"微信"列（邀请步骤里也用这张表）。Next.js 的 page 文件不能导出页面以外的组件，要单独测试就必须拆到独立文件。
- 被否决：关时把微信步骤判为"跳过"、不计入必做（与"邮件转发入口"平台未开通时的处理相同）。界面更干净，但改变就绪判定，超出任务书；而且 `onboarding-db.isolated.test.ts` 断言了微信步骤的状态，隔离库测试在本地与 CI 都会跳过（CI 没设 `DATABASE_ENVIRONMENT=isolated`），改了也无法验证。
- 被否决：只去掉提示与绑定表（任务书字面）。步骤条仍写着"再让其绑定微信"，成员表仍有一整列"未绑定"，等于还在提示人去绑定。

**D6. 测试分三层，新增三个文件：**
- 纯函数：`src/lib/messaging/__tests__/wechat-entry-flag.test.ts`（取值表）；`src/lib/navigation/__tests__/wechat-entry-nav.test.ts`（旧模式 / 岗位模式 × 开 / 关 / 缺省，含销售）。
- 服务端静态渲染 + 源码断言：`src/components/wechat-entry/__tests__/wechat-entry-render.test.tsx`。渲染部分：两个门禁 layout（关 → "暂未开放"，开 → 原样返回 children）、上下文缺省为关、登录页微信入口组件（"或" + "微信扫码登录"）、成员表开 / 关两态的列。源码断言部分：两个根 layout 用服务端开关值包上下文；登录页、设置页、开通页、侧边栏、抽屉按上下文接线。写法同 `src/components/revenue/__tests__/v2-readiness-panel.test.tsx`。
- 被否决：只写源码断言。看不到真实渲染结果，开 / 关两态是否一致只能靠肉眼。
- 被否决：浏览器端到端测试。仓库没有浏览器测试框架，引入新依赖超出本 change。

## 硬纪律

1. 零 schema：不涉及——开关在环境变量；不加 model、字段、迁移（`git diff --stat origin/main...HEAD -- prisma` 为空）。
2. 出站先审批：不涉及——没有任何对外发送；微信推送任务不动。
3. 禁止第三套队列：不涉及——不新增 scheduler / queue / cron；`wechat-push` 与 `vercel.json` 不动。
4. 脱敏：不涉及——不输出金额、报价或毛利。
5. 不爬登录页：不涉及。
6. 邮箱分离：不涉及——不碰 EmailProvider 与发件设置。
7. 确定性优先：遵守——纯开关判断，没有 LLM 调用。
8. 测试注册：三个新测试文件注册进 `scripts/test-all.sh`，同时进 `scripts/test-ci-unit.sh`；`bash scripts/check-test-registry.sh` 通过，`ci/test-registry-baseline.txt` 不新增条目。

## Risks / Trade-offs

- [开关在构建时固定] → 改开关要重新部署（Vercel 环境变量本就只对新部署生效）；报告写明恢复步骤。
- [已绑定微信的成员在开关关闭期间无法自助解绑] → 推送照常（`wechat-push` 不动）；需要时临时打开开关。CEO 确认绑定目前不可用，影响面预计为零。
- [有人直接访问 `/api/auth/wechat`] → 接口不动，行为与改动前相同；spec「开关不改微信接口与推送」写明开关只管页面入口。
- [导航项缺省隐藏，可能误伤其他调用方] → 目前只有侧边栏与抽屉两个调用方，都显式传值；新导航测试覆盖缺省场景。
- [源码断言随重构失效] → 只断言接线点（导入与条件渲染），实际输出由渲染测试覆盖。

## 验证

- `npx tsx src/lib/messaging/__tests__/wechat-entry-flag.test.ts`
- `npx tsx src/lib/navigation/__tests__/wechat-entry-nav.test.ts`
- `npx tsx src/components/wechat-entry/__tests__/wechat-entry-render.test.tsx`
- 既有测试：导航 `position-nav`、`trade-layout`、`navigation-ia`、`navigation-workspace`、`nav-active-matcher`；开通规则 `onboarding-rules`（确认就绪判定未变）。
- `bash scripts/check-test-registry.sh`、`npm run typecheck`、`npm run lint:baseline`、`npm test`。
- `openspec validate hide-wechat-entry --strict`。
- `git diff --stat origin/main...HEAD -- src/app/api/auth/wechat src/app/api/messaging src/app/api/cron/wechat-push src/lib/messaging/binding.ts src/lib/messaging/push-service.ts src/lib/organizations vercel.json prisma` 输出为空。

## Migration Plan

- 合并部署即生效：变量是本 change 新增的，生产与 staging 都不会已设置，入口随部署隐藏。
- 恢复：在 Vercel 对应环境设 `WECHAT_BINDING_ENABLED=1` 并重新部署（本 change 不改 Vercel 设置，何时打开由 Evan 决定）。
- 回滚：回退本 PR；没有数据迁移。
