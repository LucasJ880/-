# Proposal：用开关隐藏不可用的微信入口

TASKFLOW：COLLAB-1（Phase C 协作通知；任务书 `docs/QINGYAN_COLLAB_NOTIFY_TASKBRIEF.md` §4、§7 change A、§9 D4）

## Why

青砚的微信绑定和微信扫码登录目前不可用（CEO 2026-11-04 确认"只是做了一个名称"），登录页、设置页、侧边栏和组织开通页却仍把它们当作可用入口展示，员工点进去走不通。

## What Changes

- 新增服务端开关 `WECHAT_BINDING_ENABLED`：去掉首尾空白、不分大小写后等于 `1` / `true` / `on` 为开；未设置、空串和其他任何值（含 `false`）为关；默认关。
- 隐藏登录页的"微信扫码登录"按钮和它上方的"或"分隔线（开关关闭时；邮箱密码登录与注册链接不变）。
- 隐藏设置页的"微信集成"入口卡片（开关关闭时）。
- 隐藏侧边栏与手机导航抽屉里的"微信集成"（`/wechat`）入口（开关关闭时，不论平台角色、企业角色或岗位）。
- 拦截直接访问 `/settings/wechat` 与 `/wechat`：开关关闭时只显示"暂未开放"，不渲染绑定 / 扫码 / 消息组件，不发起这些组件的接口请求。
- 精简组织开通详情页的"微信绑定"步骤：开关关闭时去掉前往「设置 → 微信」扫码绑定的提示和业务员绑定表，步骤说明改为"微信绑定暂未开放"，成员表不显示"微信"列；保留"暂不绑定微信"确认，就绪判定不变。
- 保持开关打开时以上各处与改动前一致。
- 新增测试：开关解析（未设置 / `false` / `true` 等）、导航可见性、各入口开 / 关两态的静态渲染与源码断言；三个测试文件都注册进 `scripts/test-all.sh`，同时进 `scripts/test-ci-unit.sh`。

## Capabilities

### New Capabilities

- `identity/wechat-entry`：微信扫码登录与微信绑定入口的平台开关——开关取值规则，开关关闭时登录页、设置页、侧边栏、两个微信页面、组织开通页各自的表现；开关只管页面入口，不改微信接口、回调与推送任务。

### Modified Capabilities

- `navigation/position-based-visibility`：两种模式下"微信集成"入口都先受平台开关约束——"岗位模式判定"的旧模式例外与"岗位模式的导航入口"的判定口径各补上这一条例外。

## Impact

- 代码：
  - 新增 `src/lib/messaging/wechat-entry.ts`（开关解析）；
  - 新增 `src/components/wechat-entry/`：开关上下文、"暂未开放"块、登录页微信入口（从登录页原样抽出）；
  - 新增 `src/app/(main)/settings/wechat/layout.tsx`、`src/app/(main)/wechat/layout.tsx`（开关关闭时只渲染"暂未开放"）；
  - 改 `src/app/(auth)/layout.tsx`、`src/app/(main)/layout.tsx`（把服务端开关值下发给入口组件）；
  - 改 `src/app/(auth)/login/page.tsx`、`src/app/(main)/settings/page.tsx`、`src/app/(main)/admin/onboarding/[orgId]/page.tsx`（成员表拆到同目录 `members-table.tsx`）；
  - 改 `src/lib/navigation/{types,registry,filter}.ts`、`src/components/sidebar.tsx`、`src/components/mobile-nav-drawer.tsx`；
  - `.env.example` 补一行开关说明。
- 测试：新增 3 个测试文件；既有 `position-nav`、`trade-layout` 两个导航测试的过滤上下文补"开关打开"，原有断言不变。
- 部署：生产没有设置这个变量，合并部署后入口即隐藏；要恢复，在 Vercel 设 `WECHAT_BINDING_ENABLED=1` 后重新部署。本 change 不改任何 Vercel 设置。
- 零 schema；不碰 muse-bridge；不新增 LLM 调用、队列、cron 或出站动作。

## Out of scope

- 修复微信绑定或扫码登录本身；给入口改名（任务书 D4：改名后仍然点不通）。
- 微信相关接口、回调与推送：`/api/auth/wechat`（含 callback）、`/api/messaging/*`、`/api/trade/webhook/wechat`、`/api/cron/wechat-push` 与 `vercel.json` 里它的 cron 条目、`src/middleware.ts` 的公开路径、已有的微信绑定记录。
- 组织开通的就绪判定（`src/lib/organizations/onboarding-rules.ts`）与开通状态接口的返回内容。
- 只是提到微信、不是绑定 / 扫码入口的文字：开通列表页的流程说明、测试询盘结果里的"已绑定微信"统计、交接提示里的"站内 / 微信通知"。
- 客户沟通渠道里的"微信"（客户来源、互动记录类型、外贸消息通道等）。
- 按组织设置的开关（`settingsJson`）。
