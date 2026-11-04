# COLLAB-1 报告 — 开关隐藏不可用的微信入口（hide-wechat-entry）

> 任务书：`docs/QINGYAN_COLLAB_NOTIFY_TASKBRIEF.md` §4；OpenSpec change `hide-wechat-entry`；
> 分支 `worktree-hide-wechat-entry`，基于 origin/main `deccf844`。本 change 不加表 / 字段 / 迁移 / cron，不调 LLM，不连任何数据库。

## 1. 做了什么

- 新增服务端开关 `WECHAT_BINDING_ENABLED`（`src/lib/messaging/wechat-entry.ts`）：去首尾空白、不分大小写后为 `1` / `true` / `on` 才开；未设置、空串和其他任何值都为关。不是 `NEXT_PUBLIC_` 变量。
- `(auth)`、`(main)` 两个服务端 layout 读开关，用 `WechatEntryProvider` 交给客户端；客户端组件用 `useWechatEntryEnabled()` 读，没有上下文时为关。
- 开关关闭时：
  - **登录页**：没有"或"分隔线和"微信扫码登录"按钮（两者与微信图标原样抽到 `WechatLoginEntry`，点击回调仍由登录页传入）；邮箱密码登录、注册链接、`?wechat=error` 的错误提示不变。
  - **设置页**：没有"微信集成"卡片，页面上没有指向 `/settings/wechat` 的链接。
  - **侧边栏 / 手机抽屉**：没有"微信集成"（`/wechat`）。旧模式、岗位模式，任何平台角色、企业角色、岗位都一样。
  - **`/settings/wechat`、`/wechat`**：同目录新增的 layout 只渲染"暂未开放"，页面组件不挂载，所以不会请求绑定列表、二维码或消息记录。两个 `page.tsx` 一行没改。
  - **组织开通详情页**：微信步骤没有「设置 → 微信」提示和绑定表，改为一行"微信绑定暂未开放。"，保留"暂不绑定微信"确认框；步骤条上未完成的微信步骤，说明换成"微信绑定暂未开放，勾选「暂不绑定微信」即可完成本步"；邀请业务员步骤的成员表没有"微信"列。就绪判定和开通状态接口不变。
- 开关打开时：以上页面与改动前一致。成员表开时的 HTML 与 origin/main 上的版本逐字节相同（§3.4）。
- 不动：微信扫码登录与回调接口、微信 / 企业微信绑定接口、`wechat-push` 定时任务与 `vercel.json`、已有的 `WeChatBinding` 记录、`src/lib/organizations/**`、`prisma/`（§3.1 最后一行）。

## 2. 改了哪些文件

| 文件 | 改动 |
|---|---|
| `src/lib/messaging/wechat-entry.ts` | 新增：`isWechatBindingEnabled(env = process.env)` |
| `src/components/wechat-entry/context.tsx` | 新增：`WechatEntryProvider` / `useWechatEntryEnabled()`（缺省 false） |
| `src/components/wechat-entry/not-open.tsx` | 新增：两个微信页面的"暂未开放"占位块 |
| `src/components/wechat-entry/login-entry.tsx` | 新增：从登录页原样抽出的"或"分隔线 + 微信图标 + "微信扫码登录"按钮 |
| `src/app/(auth)/layout.tsx`、`src/app/(main)/layout.tsx` | 用开关值包 `WechatEntryProvider`（`(main)` 包住 `AppShell`，侧边栏、抽屉、各页面都在其内） |
| `src/app/(main)/settings/wechat/layout.tsx`、`src/app/(main)/wechat/layout.tsx` | 新增：开关关闭时返回"暂未开放"，打开时原样返回页面 |
| `src/app/(auth)/login/page.tsx` | 删去本地的分隔线、按钮与图标，改为 `{wechatEnabled && <WechatLoginEntry onClick={handleWeChatLogin} />}` |
| `src/app/(main)/settings/page.tsx` | "微信集成"卡片包进 `{wechatEnabled && (…)}` |
| `src/lib/navigation/{types,registry,filter}.ts` | `NavigationItem.wechatEntry`、`NavigationFilterContext.wechatEntryEnabled`；`mgmt-wechat` 标 `wechatEntry: true`；过滤时先于角色 / 岗位判定，值不为 `true` 就不显示 |
| `src/components/sidebar.tsx`、`src/components/mobile-nav-drawer.tsx` | 从上下文取值放进导航过滤上下文（含 `useMemo` 依赖） |
| `src/app/(main)/admin/onboarding/[orgId]/members-table.tsx` | 新增：从开通页拆出的 `MembersTable`，加 `showWechat` |
| `src/app/(main)/admin/onboarding/[orgId]/page.tsx` | 微信步骤按开关渲染；步骤条替换说明；邀请步骤成员表传 `showWechat={wechatEnabled}` |
| `.env.example` | "微信集成"段补 `# WECHAT_BINDING_ENABLED=` 与说明（未设置 = 关） |
| 测试 | 新增 `wechat-entry-flag.test.ts`、`wechat-entry-nav.test.ts`、`wechat-entry-render.test.tsx`，三个都注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`；`position-nav`、`trade-layout` 两个测试的上下文补 `wechatEntryEnabled: true`，断言不变 |

## 3. 怎么验

每条 task 先写测试并运行确认失败（缺模块 / 断言失败），再实现到通过：

| 测试 | 先失败 | 实现后 |
|---|---|---|
| `wechat-entry-flag.test.ts` | `Cannot find module '../wechat-entry'` | 5 passed |
| `wechat-entry-render.test.tsx` 第 1 组（2.1） | `Cannot find module '@/app/(main)/settings/wechat/layout'` | 30 passed |
| 同上第 2 组（2.2） | `Cannot find module '../login-entry'` | 41 passed |
| `wechat-entry-nav.test.ts`（3.1） | 4 passed，15 failed（关闭 / 缺值时 boss、operations、岗位 owner 仍看得到 `/wechat`；注册表没有标记） | 19 passed |
| 渲染测试侧边栏 / 抽屉接线（3.1） | 43 passed，4 failed | 47 passed |
| `position-nav` / `trade-layout`（3.1，入口缺省隐藏后） | 侧栏快照"缺少：mgmt-wechat"；`/wechat 应在更多里` | 上下文补 `wechatEntryEnabled: true` 后 86 / 5 通过 |
| 渲染测试开通页（4.1） | `Cannot find module '@/app/(main)/admin/onboarding/[orgId]/members-table'` | 62 passed |

### 3.1 门禁

| 命令 | 结果 |
|---|---|
| `npx tsx src/lib/messaging/__tests__/wechat-entry-flag.test.ts` | 5 passed, 0 failed |
| `npx tsx src/lib/navigation/__tests__/wechat-entry-nav.test.ts` | 19 passed, 0 failed |
| `npx tsx src/components/wechat-entry/__tests__/wechat-entry-render.test.tsx` | 62 passed, 0 failed |
| 既有导航测试 `position-nav` / `trade-layout` / `navigation-ia` / `navigation-workspace` / `nav-active-matcher` | 86 / 5 / 63 / 34 / 21，与改动前基线相同 |
| 其他会解析导航树的测试 `accounting` / `platform-admin-scope` / `platform-admin-diagnostics-gate` / `trade-recipients` / `security-layers` | 38 / 46 / 70 / 70 / 37，全部通过 |
| `npx tsx src/lib/organizations/__tests__/onboarding-rules.test.ts` | 33 passed，与基线相同（就绪判定未变） |
| `bash scripts/check-test-registry.sh` | 通过：已注册 526 个；历史欠账基线 71 条不变 |
| `npm run typecheck` | 干净工作树、默认堆：退出 0（实施中跑过 3 次，最后一次在删掉 `.next` 之后）。注意：跑过 `npm run build` / `next dev` 后，`.next/types`、`.next/dev/types` 多出 907 个生成的类型文件（`tsconfig.json` 的 include 含这两处），默认堆会 `heap out of memory`（退出 134，与 PRICE-3 报告记录的现象相同）；这时加 `NODE_OPTIONS=--max-old-space-size=8192` 退出 0 |
| `npm run lint:baseline` | PASS（无新增 error fingerprint）；改动文件单独 `npx eslint` 0 error，唯一 warning 是登录页 logo 的 `<img>`（改动前就有） |
| `npm test` / `npm run test:ci` | 见 §3.2 |
| `npm run build` | 退出 0（两道部署前检查在本地按设计跳过：`VERCEL_ENV` 未设置）；`/login`、`/settings`、`/settings/wechat`、`/wechat` 都是静态页（○），`/admin/onboarding/[orgId]` 是动态页（ƒ）；编译警告只有 Sentry / Prisma instrumentation 的既有依赖警告 |
| `openspec validate hide-wechat-entry --strict` | `Change 'hide-wechat-entry' is valid` |
| `git diff --stat origin/main...HEAD -- src/app/api/auth/wechat src/app/api/messaging src/app/api/cron/wechat-push src/lib/messaging/binding.ts src/lib/messaging/push-service.ts src/lib/organizations vercel.json prisma` | 空 |

### 3.2 全量

本机没有任何数据库（worktree 里没有 `.env`，`DATABASE_URL` 未设置；按要求不连生产库），shell 也没有导出 `NODE_ENV=test`。

| 命令 | 结果 |
|---|---|
| `npm test` | **538 / 550**，12 个失败（下表）。550 = main 上的 547 + 本 change 新增 3 个。三个新测试在全量里通过（5 / 62 / 19），全量里的"TypeScript 类型检查""测试注册校验"也通过 |
| 同一环境下，在 origin/main `deccf844` 的干净快照（`git archive` 导出）上逐条重跑这 12 条命令 | 12 条全部同样失败，失败原因逐条相同 → 都不是本 change 引起 |
| `npm run test:ci` | `CI unit subset PASS`，退出 0（CI 子集导出 `NODE_ENV=test`；三个新测试在子集里同样 5 / 62 / 19 通过） |

| 失败的测试 | 原因 |
|---|---|
| Agent Trace 只读查询；Phase3A-2 Ledger DB、Phase3A-2 Smoke Access；Phase3A-3 Approvals Smoke；Governance Hygiene Gate、Governance Hygiene Concurrency Gate；Phase3A-4 Governance Smoke、Phase3A-4 Acceptance；Phase3A-5 Settle DB、Phase3A-5 Overview Acceptance（10 条） | 测试库安全检查 `Mode: blocked (MISSING_DATABASE_URL)`：没有隔离库时按设计拒跑 |
| T4 授标情报真实 Postgres 矩阵 | `REFUSED: 需要 DATABASE_URL（隔离 DB）` |
| Gmail Draft OAuth Compose Scope | 断言 `GMAIL_DRAFT_ENABLED=true → 开启` 失败：`isGmailDraftAllowed` 只在 `NODE_ENV=test` 或生产时放行，`test-all.sh` 跑它时不设 `NODE_ENV`。加 `NODE_ENV=test` 单独跑 30 / 30 通过。该测试只注册在 `test-all.sh`，不在 CI 子集里 |

与 PRICE-3 / STAT-2 报告记录的 10 项不同，是因为那两次在隔离库 + `NODE_ENV=test` 下跑：那边 DB 测试能连上库（其中几条因种子缺失失败），这边没有库，直接被安全检查拦下；另外全量里的类型检查这次通过（跑全量时还没执行 build，`.next` 下没有生成的类型文件，见 §3.1 typecheck 一行）。

### 3.3 真实构建 / 开发服务器上的开关两态

- 生产构建（开关未设置）的预渲染产物：`.next/server/app/wechat.html` 只有标题"微信消息"和"微信绑定与微信消息暂未开放"，没有原页面的"查看所有微信通道的对话记录"与"绑定微信"；`settings/wechat.html` 只有"暂未开放"，没有"扫码登录"和原页面说明。
- 登录页、设置页的表单在客户端渲染（`useSearchParams` 在 Suspense 内），静态 HTML 里只有加载占位；两页的 RSC 数据里 `WechatEntryProvider` 的值都是 `"enabled":false`。
- 开发服务器（`.claude/launch.json` 既有的 `start` 配置，未改）：`GET /login` 返回的 RSC 数据为 `"enabled":false`；在 worktree 临时放一个只含 `WECHAT_BINDING_ENABLED=1` 的 `.env.development.local`（已在 `.gitignore`），日志出现 `Reload env: .env.development.local` 后再请求，变为 `"enabled":true`；验完已删除该文件、停掉服务器。
- 没做浏览器走查：应用内浏览器面板处于隐藏状态，在面板里打开 localhost 失败；登录后的页面（设置页、侧边栏、两个微信页面、开通页）需要数据库，本机没有隔离库，按要求不连生产库。开 / 关两态的页面渲染由 §3.1 的渲染测试与源码断言覆盖。

### 3.4 开关打开时与改动前一致

- 登录页：`WechatLoginEntry` 里的微信图标与 origin/main 登录页上的 `WeChatIcon` 逐字节相同；分隔线 + 按钮的 JSX 除点击回调参数名外逐字节相同（脚本比对）。
- 成员表：用同一组成员数据分别渲染 origin/main 页面里的 `MembersTable` 与新文件的 `MembersTable showWechat`，`renderToStaticMarkup` 输出逐字节相同（1246 字符）。
- 导航：`wechat-entry-nav.test.ts` 断言开关关闭 / 缺值时的可见项 = 打开时的可见项去掉 `mgmt-wechat`；既有导航测试在打开状态下断言一条未改。

## 4. 与任务书的出入

| 任务书 | 实际 | 处理 |
|---|---|---|
| 设置页"微信"入口 | 卡片标题是"微信集成" | 按代码名称 |
| 未列 | 侧边栏 / 手机抽屉"微信集成"（`/wechat`） | 一并隐藏（design D4），否则留一个点进去只有"暂未开放"的入口 |
| 开通页去掉提示与绑定表 | 步骤条说明（服务端"先邀请业务员，再让其绑定微信"）与邀请步骤成员表"微信"列也在提示绑定 | 关时替换步骤条说明、隐藏成员表"微信"列；就绪判定不改（design D5） |
| 未列（只是文字） | 开通列表页流程说明"→ 微信绑定 →"、测试询盘结果"均未绑定微信"、交接提示"站内 / 微信通知" | 不改：不是入口（design Non-Goals） |

## 5. 开关恢复步骤

1. 在 Vercel 对应环境（Production / Preview）设 `WECHAT_BINDING_ENABLED=1`（`true` / `on` 也可）。
2. 重新部署。`/login`、`/settings`、`/settings/wechat`、`/wechat` 是静态页，开关值在构建时固定；开通详情页是动态页，请求时读。Vercel 的环境变量本来就只对新部署生效，所以只改变量、不重新部署，哪一页都不会变。
3. 检查：`/login` 出现"微信扫码登录"，设置页出现"微信集成"卡片，boss / operations 侧栏出现"微信集成"，`/settings/wechat` 显示连接设置。
4. 回滚本 change：回退本 PR，没有数据迁移。

本 change 不改 Vercel 设置；什么时候打开由 Evan 决定。

## 6. 已知限制

- 开关关闭期间，已绑定微信的成员不能在页面上自助解绑；推送照常（`wechat-push` 不动）。需要时临时打开开关。
- 直接访问 `/api/auth/wechat` 的行为与改动前相同（spec「开关不改微信接口与推送」）。

## 附：门禁命令原始输出（Node 24.22.0，最终工作树）

```
$ openspec validate hide-wechat-entry --strict
Change 'hide-wechat-entry' is valid
exit=0

$ npm run typecheck          # 删掉 .next 后、默认堆
> qingyan-ai@0.1.0 typecheck
> tsc --noEmit
exit=0

$ npm run lint:baseline
> qingyan-ai@0.1.0 lint:baseline
> node scripts/check-eslint-baseline.mjs
[eslint-baseline] mode=check
[eslint-baseline] sourceCommit=2255f8da919c883bc9e2f210209782c40ee5eaae
[eslint-baseline] current errors=38 warnings=146 fingerprints=18
[eslint-baseline] baseline errors=53 warnings=111 fingerprints=24
[eslint-baseline] 信息：相对基线减少了 15 处 error 出现（允许）
[eslint-baseline] PASS（无新增 error fingerprint / 无 count 上升）
exit=0

$ npm test                   # 末尾
═══════════════════════════════════════════════════
  测试结果: 538/550 通过, 12 失败
═══════════════════════════════════════════════════
❌ 有测试失败
exit=1                       # 12 条失败见 §3.2，在 origin/main 干净快照上逐条同样失败

$ npm run test:ci            # 末尾
OK 测试注册校验通过：已注册 526 个；历史欠账基线剩余 71 条（只减不增）
CI unit subset PASS
exit=0

$ bash scripts/check-test-registry.sh
OK 测试注册校验通过：已注册 526 个；历史欠账基线剩余 71 条（只减不增）
exit=0

$ git diff --stat origin/main...HEAD -- src/app/api/auth/wechat src/app/api/messaging src/app/api/cron/wechat-push src/lib/messaging/binding.ts src/lib/messaging/push-service.ts src/lib/organizations vercel.json prisma
（空）
```
