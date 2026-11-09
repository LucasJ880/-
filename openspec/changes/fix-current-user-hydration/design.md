# Design：当前用户状态在首屏水合时与服务端 HTML 一致

## Context

动机见 proposal.md「Why」。现状（main，`439a19a`）：

- 当前用户 hook 用模块级变量缓存 `/api/auth/me` 的结果，并在 `useState` 初值里直接读它：`useState(cachedUser)`、`useState(!cachedUser)`。服务端从不运行 effect，所以服务端渲染时缓存恒为空，HTML 一律是"加载中"。
- React 对服务端已输出内容的 Suspense 边界不在根水合这一遍里水合，而是根提交之后以低优先级再水合；外壳（侧栏 / 顶栏等）在根这一遍里水合，提交后其 effect 立即开始取当前用户。`(main)/loading.tsx` 已给所有页面套了一层 Suspense，`src/app/(main)/admin/users/page.tsx` 又为 `useSearchParams()` 自己包了一层，每多一层就多一轮延后水合。接口先于页面内容水合返回时，缓存就在页面水合之前被填上。是否赶上取决于时序：复现中有内层 `<Suspense>` 的页面每次都赶上，没有内层的页面（如 `/admin/invite-codes`）都没赶上，但后者同样存在这个竞态。
- 页面边界水合时，`useState(cachedUser)` 读到已填好的用户，首帧渲染出完整页面（`mx-auto max-w-5xl …`），服务端 HTML 却是加载转圈（`flex h-40 …`），React 报水合不一致并整块客户端重建。

复现结果（隔离 Postgres 16 + pgvector、`next dev`、Playwright Chromium，super_admin 登录并设好 `localStorage.qingyan_selected_org_id`）：

| 页面 | 改前 `pageerror` | 改后 |
|---|---|---|
| `/admin/users`（3 次） | 1 / 2 / 1 | 0 / 0 / 0 |
| `/admin/audit-logs` | 1 | 0 |
| `/settings` | 1 | 0 |
| `/sales` | 2 | 0 |
| `/admin/invite-codes`、`/organizations`、`/tasks`、`/register` | 0 | 0 |

React 给出的差异节点（`/admin/users`）：`<UsersContent>` 根 `<div>` 客户端为 `className="mx-auto max-w-5xl space-y-5"`、服务端为 `className="flex h-40 items-center justify-center"`，即 `userLoading` 分支不一致。`/admin/audit-logs` 同型；`/settings`、`/sales` 是按当前用户角色决定的入口不同。四个页面都是"页面自己的 `<Suspense>` 内用当前用户"。

已排除的嫌疑：

- `useSearchParams()` 初值：服务端与客户端拿到同一 URL，初值相同；
- 表格里的 `toLocaleString("zh-CN", { timeZone: "America/Toronto" })`：用户表只在客户端取数后渲染，服务端 HTML 不含该文本；
- `useCurrentOrgId()`：localStorage 走 `useSyncExternalStore`，服务端快照为 `""`，水合帧一致；它依赖的 `useOrganizations()` 无模块缓存；
- effect 里的 `router.replace`：只在水合提交之后运行。

## Goals / Non-Goals

**Goals:**

- 当前用户 hook 在服务端渲染与水合帧返回同一个值（无用户、加载中），水合后立即换成缓存里的用户。
- 客户端路由切换进入页面时，首帧仍直接用缓存（不出现加载态、不多发请求）。
- 修一处覆盖全部 26 个调用方，不逐页打补丁。

**Non-Goals:**

- `src/app/(main)/admin/users/page.tsx`、`src/app/(main)/admin/audit-logs/page.tsx`、`src/app/(main)/settings/page.tsx`、`src/app/(main)/sales/page.tsx` 不改。
- `src/lib/hooks/use-current-org-id.ts`、`src/lib/hooks/use-organizations.ts`、`src/components/header.tsx`（顶栏自己直接请求 `/api/auth/me`）不改。
- `src/app/(main)/sales/quote-sheet/rough-quote-panel.tsx` 的 `Date.now()` iframe 地址不改（另一个根因）。
- `/api/auth/me` 路由、会话、`src/lib/permissions-client.ts` 不改。

## Decisions

### D1：在 hook 内用 `useSyncExternalStore` 判定"是否已水合"，水合帧屏蔽缓存

`const hydrated = useSyncExternalStore(subscribeNever, () => true, () => false)`：服务端与水合帧取服务端快照 `false`，hook 返回 `user: null`、`loading: true`、`isSuperAdmin: false`；水合提交后 React 发现客户端快照不同，立即同步重渲染，取到 `true`，返回原有的 state（已用缓存初始化）。不经水合的挂载（客户端路由切换）直接取客户端快照 `true`，行为与改前相同。仓库里 `use-voice-input.ts`、`use-current-org-id.ts`、侧栏等已用同一做法（带服务端快照的 `useSyncExternalStore`）处理浏览器才有的值。

被否决的备选：

- **在 `/admin/users` 页加 `mounted` 状态（`useEffect(() => setMounted(true))`）**：只修一页，`/admin/audit-logs`、`/settings`、`/sales` 照样报错；而且客户端路由切换时也会先渲染一帧加载态，改变现有行为。
- **`useState` 初值一律用 `null` / `true`，不读缓存**：水合不一致消失，但每次客户端路由切换都会闪一帧加载态，并让依赖 `loading` 的 effect 晚一帧，退化现有体验。
- **去掉页面上的 `<Suspense>`**：Next 要求读 `useSearchParams()` 的客户端组件放在 Suspense 里（否则静态预渲染时报错或整段回退到客户端渲染）；也只修一页。
- **把当前用户放进服务端渲染（RSC 里取用户、作为 props / Context 下发）**：根上消除差异，但要改布局、会话读取与 26 个调用方的数据来源，远超"最小修复"。

### D2：测试用服务端渲染断言水合快照，浏览器点验用手动脚本

React 水合时调用的正是服务端快照，所以"服务端渲染时即使缓存已有用户也输出加载中"可以在无 DOM 的 `react-dom/server` 渲染测试里断言（仓库已有 `org-cockpit-view.test.tsx` 等同类测试）。填缓存走 hook 公开的 `reload()`：在服务端渲染里拿到 `reload`，渲染结束后调用；服务端的 setState 是空操作，`fetchUser()` 用替换的 `globalThis.fetch` 返回 super_admin 并写进模块缓存。改前代码在第二次渲染时会输出该用户，测试因此能区分改前改后。

被否决的备选：

- **为测试导出缓存写入函数**：多一个只为测试存在的导出，调用方可能误用。
- **引入 jsdom / Testing Library 做真实 `hydrateRoot`**：新增依赖；真实水合时序已由浏览器点验覆盖。
- **把 Playwright 点验放进 CI**：需要隔离库、种子账号和运行中的 dev server，CI 现在没有这套环境。

## 硬纪律

1. 零 schema：不涉及（不碰 Prisma，无 model、字段、迁移）。
2. 出站先审批：不涉及（纯前端渲染，无对外发送）。
3. 禁止第三套队列：不涉及（无 scheduler / queue / worker）。
4. 脱敏：不涉及（不输出新的业务数据；当前用户对象内容不变）。
5. 不爬登录页：不涉及。
6. 邮箱分离：不涉及。
7. 确定性优先：遵守——无 LLM 调用，行为由 React 快照规则确定。
8. 测试注册：新测试 `src/lib/hooks/__tests__/use-current-user-hydration.test.tsx` 注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`；`bash scripts/check-test-registry.sh` 通过，`ci/test-registry-baseline.txt` 不新增条目。点验脚本在 `scripts/` 下，不属于 `src/lib/**/__tests__`，不需注册。

## Risks / Trade-offs

- [与外壳同一遍水合的调用方（侧栏等）多一次重渲染] → 这些组件水合时缓存本来就空，hook 返回值前后都是"加载中"；`useSyncExternalStore` 的强制重渲染只发生一次，组件树小，可以接受。
- [晚水合的页面在水合后多一次同步重渲染，从"加载中"直接换成完整页面] → 用户看到的首屏本来就是服务端 HTML 的加载转圈，改后不会更慢；改前是整块丢弃 HTML 后客户端重建，代价更大。
- [调用方的 effect 在水合帧看到"无用户 / 非管理员"后做了不可逆动作] → 已逐个检查 26 个调用方：会跳转的（`admin/invite-codes`、`settings/digital-employees`、`settings/agent-skills`）和会取数的（`admin/users`、`admin/audit-logs`、`admin/project-intake`、`sales/quote-sheet`）都先判 `loading` 或 `user` 非空；只有两处不判 `loading`——`sales/page.tsx` 把锁定销售名重置为 `""`、`projects/[id]/conversations/[conversationId]/page.tsx` 把页签重置为 `"messages"`，两者都是把 state 设回初值，水合后的重渲染会按真实角色再跑一次。其余调用方只在渲染或点击处理里读用户。
- [与 LucasJ880/-#404（USR-1）同改 `scripts/test-all.sh`、`scripts/test-ci-unit.sh`] → 只是各加一行，冲突时两边都保留。

## 验证方式

- `npx tsx src/lib/hooks/__tests__/use-current-user-hydration.test.tsx`：全部断言通过；临时撤回 hook 改动再跑，渲染断言失败（证明测试能区分改前改后）。
- `bash scripts/check-test-registry.sh`、`npm run typecheck`、`npm run lint:baseline`、`npm test`。
- 隔离库 + `next dev` 上跑 `node scripts/current-user-hydration-smoke.mjs`，退出码 0；撤回 hook 改动再跑，退出码非 0。
- `openspec validate fix-current-user-hydration` 通过。
