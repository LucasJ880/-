# Tasks

每条先写失败测试、运行确认失败，再实现到通过。

## 1. 开关

- [ ] 1.1 先写 `src/lib/messaging/__tests__/wechat-entry-flag.test.ts`（未设置、空串、`false`、`0`、`off`、`yes` → 关；`true`、`TRUE`、` 1 `、`on` → 开），注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`，运行确认失败；再新增 `src/lib/messaging/wechat-entry.ts`（`isWechatBindingEnabled(env = process.env)`），在 `.env.example` 的"微信集成"段补 `# WECHAT_BINDING_ENABLED=` 与一行说明（未设置 = 关）；verify：`npx tsx src/lib/messaging/__tests__/wechat-entry-flag.test.ts` 全过，`bash scripts/check-test-registry.sh` 通过

## 2. 开关下发与入口页面

- [ ] 2.1 先写 `src/components/wechat-entry/__tests__/wechat-entry-render.test.tsx` 的第一组用例：上下文缺省为关、`WechatEntryProvider enabled` 时为开；`/settings/wechat`、`/wechat` 两个 layout 在开关关闭时渲染出"暂未开放"且不含 children，打开时原样返回 children；源码断言 `src/app/(auth)/layout.tsx`、`src/app/(main)/layout.tsx` 用 `isWechatBindingEnabled()` 的值包上下文。注册进两个脚本，运行确认失败；再新增 `src/components/wechat-entry/{context,not-open}.tsx`、`src/app/(main)/settings/wechat/layout.tsx`、`src/app/(main)/wechat/layout.tsx`，改两个根 layout；verify：该测试全过，`git diff --stat origin/main -- 'src/app/(main)/settings/wechat/page.tsx' 'src/app/(main)/wechat/page.tsx'` 输出为空
- [ ] 2.2 先在同一测试文件加用例：`WechatLoginEntry` 渲染出"或"分隔线与"微信扫码登录"按钮；源码断言登录页只在 `useWechatEntryEnabled()` 为真时渲染 `WechatLoginEntry`，设置页指向 `/settings/wechat` 的"微信集成"卡片只在为真时渲染。运行确认失败；再把登录页的分隔线、按钮与微信图标原样抽到 `src/components/wechat-entry/login-entry.tsx`（点击回调仍由登录页传入），登录页与设置页按上下文渲染；verify：该测试全过

## 3. 导航

- [ ] 3.1 先写 `src/lib/navigation/__tests__/wechat-entry-nav.test.ts`：开关关闭或上下文缺值时，旧模式 `boss`、`operations` 企业成员与岗位模式 `owner` 都看不到 `/wechat`，其余可见项与打开时相同；打开时 `boss`、`operations` 与岗位模式 `owner` 可见，`sales` 仍不可见。注册进两个脚本，运行确认失败；再按 design D4 给 `NavigationItem` 加 `wechatEntry`、`NavigationFilterContext` 加 `wechatEntryEnabled`，`mgmt-wechat` 标 `wechatEntry: true`，在角色 / 岗位判定之前拦截；侧边栏与抽屉从上下文传值（渲染测试加这两处接线的源码断言）；`position-nav`、`trade-layout` 两个测试的上下文补 `wechatEntryEnabled: true`；verify：新测试、渲染测试与 `position-nav`、`trade-layout`、`navigation-ia`、`navigation-workspace`、`nav-active-matcher` 全过

## 4. 组织开通页

- [ ] 4.1 先在渲染测试加用例：`MembersTable` 在 `showWechat=false` 时没有"微信"表头与"已绑定 / 未绑定"，`true` 时有；源码断言开通页在开关关闭时微信步骤不渲染 `/settings/wechat` 提示与绑定表、显示"微信绑定暂未开放"并保留"暂不绑定微信"确认框，步骤条在关闭且该步待办时使用替换说明，邀请步骤的成员表按开关传 `showWechat`。运行确认失败；再把 `MembersTable` 拆到 `src/app/(main)/admin/onboarding/[orgId]/members-table.tsx`，按 design D5 改开通页；verify：该测试全过，`npx tsx src/lib/organizations/__tests__/onboarding-rules.test.ts` 仍全过

## 5. 收尾

- [ ] 5.1 不动项与门禁：提交后执行 `git diff --stat origin/main...HEAD -- src/app/api/auth/wechat src/app/api/messaging src/app/api/cron/wechat-push src/lib/messaging/binding.ts src/lib/messaging/push-service.ts src/lib/organizations vercel.json prisma`，并跑 `bash scripts/check-test-registry.sh`、`npm run typecheck`、`npm run lint:baseline`、`npm test`、`openspec validate hide-wechat-entry --strict`；verify：diff 输出为空，其余命令全部通过，真实输出贴进报告
- [ ] 5.2 写 `docs/QINGYAN_COLLAB-1_REPORT.md`（改动、与任务书的出入、测试与门禁输出、开关恢复步骤）+ 更新 TASKFLOW COLLAB-1 状态列为 `[G]`；verify：报告文件存在，`grep -n 'COLLAB-1' docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 显示该行状态为 `[G]`

## Workflow follow-up

- 开 PR 前贴出 `openspec validate hide-wechat-entry`、`npm run typecheck`、`npm run lint:baseline`、`npm test` 的真实输出；一个 change = 一个 PR，任务书副本 `docs/QINGYAN_COLLAB_NOTIFY_TASKBRIEF.md` 与 TASKFLOW「Phase C」随本 PR 提交；不自动合并。
- 合并后看合并提交上 Vercel 生产与 staging 两个构建状态。
- 合并后 `/opsx:archive hide-wechat-entry --yes`（独立小 PR）：specs 增量合入 `openspec/specs/identity/wechat-entry/` 与 `openspec/specs/navigation/position-based-visibility/`，TASKFLOW COLLAB-1 改为 `[x]`。
