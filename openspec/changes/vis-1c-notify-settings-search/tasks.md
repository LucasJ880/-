# Tasks

每条带验证；真实输出写进 `docs/QINGYAN_VIS-1c_REPORT.md`。

受影响测试基线（2026-11-09，origin/main 439a19a）：

| 测试 | 通过数 |
|---|---|
| collab-preferences | 104 |
| notification-href | 91 |
| entry-visibility | 56 |
| position-nav | 98 |
| route-gate | 141 |
| posts-read-model | 156 |
| waiting | 80 |
| timeline | 53 |
| org-cockpit-view | 86 |
| wechat-entry-render | 62 |
| residual-reads | 76 |
| navigation-workspace | 34 |

search-where（#409）的基线在 #409 合并、本分支变基后补记。

## 1. 通知类型可见性

- [ ] 1.1 按 design D1–D3 接通知类型对照：
  - 新增 `src/lib/notifications/type-visibility.ts`：
    - `NOTIFICATION_TYPE_ENTRIES`、`NOTIFICATION_FILTER_ENTRIES`；
    - `visibleNotificationTypes(canOpen)`、`visibleNotificationFilters(canOpen)`。
  - 无运行时副作用。逐个生产方核对 `entityType` 后定稿对照表，核对记录写进报告。
  - `notification-type-toggle-list.tsx`：取 `useNavigationAccess()`；未就绪显示占位；只渲染可见类型；增删照旧作用在完整 `enabledTypes` 上。
  - `notifications/page.tsx`：`TYPE_OPTIONS` 改由 `visibleNotificationFilters` 产出；选中项不可见时回到「全部类型」。
  - 先写 `src/lib/notifications/__tests__/type-visibility.test.ts`，覆盖：
    - 每个非隐藏类型有入口，且入口都命中门表；
    - 销售、招投标、会计、安装工、老板、super_admin 的可见类型；
    - 销售的筛选项；
    - 「保存不动隐藏类型」，用开关列表的增删函数验证；
    - 两处接线的源码断言。
  - 注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`。
  - verify：
    - 新测试全过；
    - `collab-preferences.test.ts`（104）不降；
    - `bash scripts/check-test-registry.sh` 通过。

## 2. 发信文案与设置页卡片

- [ ] 2.1 按 design D4、D5 改设置：
  - 新增 `src/lib/settings/sender-copy.ts`（`readSenderCopy`、`withSenderCopy`，纯函数）。
  - `api/organizations/route.ts` 两条分支加 `settingsJson` 查询与 `senderCopy` 响应字段；`use-organizations.ts` 的 `OrgSummary` 加 `senderCopy?: "platform_relay" | null`。
  - `settings/page.tsx`、`settings/email/page.tsx`：
    - 删 `MENGXIN_ORG_CODE`，按 `senderCopy` 判定；
    - 代发文案改为通用写法（标题「〈企业名〉发信通道」）；
    - 「邮箱绑定」卡按 `canOpen("/settings/email")` 渲染。
  - 新增 `scripts/set-org-sender-copy.ts`：参数、开关、super_admin 校验、`--dry-run` 与审计日志照 `scripts/bind-positions.ts` 的写法。
  - `scripts/seed-org-mengxin-home-textile.ts` 同步写入 `ui.senderCopy = "platform_relay"`。
  - 先写 `src/lib/settings/__tests__/sender-copy.test.ts`，覆盖：
    - 读写函数；
    - 企业列表响应只多 `senderCopy`（源码断言两条分支）；
    - 两页不再出现 `MENGXIN_ORG_CODE` 与 `mengxin-home-textile`；
    - 代发文案不含 `Cathy`、`QQ`、`@mengxinhometextile.com`、`Sunny`。
  - `entry-visibility.test.ts` 加设置页卡片用例（installer 无、sales_rep 有）。
  - `wechat-entry-render.test.tsx` 按新结构更新断言。
  - 注册新测试。
  - verify：
    - `sender-copy.test.ts`、`entry-visibility.test.ts`、`wechat-entry-render.test.tsx` 全过；
    - 脚本 `--dry-run` 在缺 `ALLOW_SENDER_COPY_UPDATE` 时拒绝，输出写进报告。

## 3. 全局搜索项目范围

- [ ] 3.1 按 design D6 收窄项目结果（前置：#409 已合并，本分支已变基到含 #409 的 main）：
  - `src/lib/search/where.ts` 加 `buildReadableProjectWhere(userId, adminOrgIds)`。
  - `api/search/route.ts`：
    - 查本人 org_admin / org_owner 的企业；
    - 判定输入用 `resolvePreferredOrgId` + `loadNavigationContextForOrg`；
    - 项目详情门不放行时 `projects: []`；
    - 项目条件改用可读条件；任务条件不变。
  - `search-where.test.ts` 加用例：
    - 普通成员只搜到参与的项目；
    - 负责人跨企业也搜得到自己负责的项目；
    - org_admin 搜到本企业全部已分发项目；
    - 未分发项目搜不到；
    - 「销售不搜项目」的门判定；
    - 路由源码断言（判定与可读条件都接上）。
  - verify：`search-where.test.ts` 全过（#409 的 10 条不变）。

## 4. AI 工具列表

- [ ] 4.1 按 design D7、D8 改工具列表：
  - `tool-auth.ts`：
    - 导出 `toolRequiredModules`，加 `marketing_` → `["marketing"]`；
    - 抽出并导出 `toolModulesSatisfied(tool, modulesJson)`，`canInvokeTool` 改调它，拒绝码与顺序不变。
  - `tool-registry.ts`：`RegistryFilters` 加 `modulesJson`、`entryGate`；`list` 按 D7、D8 过滤。
  - `engine.ts` 两处 `toOpenAITools` 传 `modulesJson`、`entryGate`（来自 options，缺省不限）；`AgentRunOptions` 加 `entryGate?`。
  - 三个人类入口传 `entryGate`（判定输入用该请求企业的 `loadNavigationContextForOrg`）：
    - `api/ai/threads/[threadId]/messages/route.ts`
    - `api/agent-core/chat/route.ts`
    - `GET /api/agent-core/tools`（它同时传 `modulesJson`）
  - 先写 `src/lib/agent-core/__tests__/tool-list-modules.test.ts`，覆盖：
    - 全部已注册工具 × 模块组合（未配置、只 `sales`、Sunny、梦馨、无 `marketing`），列表与执行期逐一相同；
    - `marketing_get_growth_summary` 在无 `marketing` 时以 `module_disabled` 拒绝；
    - Sunny 只持 `sales_rep` 的列表无 `marketing_*` / `trade_*`，只持 `ops_staff` 时有 `marketing_*`；
    - 三个入口传入 `entryGate` 的源码断言；
    - `agent-runtime/process.ts` 不传 `entryGate`。
  - 注册新测试。
  - verify：
    - 新测试全过；
    - 既有 `pre-execute-guard.test.ts`、`b1-tenant-context-static.test.ts`、`phase1-1-context-propagation.test.ts` 与 `tool-auth` 相关测试不降。

## 5. 营销卡片与「管理总览」

- [ ] 5.1 按 design D9、D11 改两个入口：
  - `digital-employee-workbench.tsx`：营销卡片按 `canOpen("/marketing/employee")`；删 `marketing/access.ts` 的 `canUseMarketingDigitalEmployee`。
  - `registry.ts`：`work-home` 加 `positionPermissions: [...POSITION_MGMT]`。
  - `mobile-tabs.ts`：首格按 `resolveLandingPage(ctx)` 取「总览」/「任务」/「会计」。
  - 改测试：
    - `entry-visibility.test.ts`：营销卡片身份表、底栏首格（accounting「会计」、fulfillment_vinyl 与无岗位「任务」、owner「总览」）；
    - `position-nav.test.ts`：非管理层侧栏无 `work-home`；
    - `navigation-workspace.test.ts:97-100`；
    - `residual-reads.test.ts:163`。
  - verify：
    - 四份测试全过；
    - `route-gate.test.ts`（141）页面快照不变。

## 6. 首页时间线与规格拆分

- [ ] 6.1 按 design D10 收口时间线：
  - `CompanyLogDeps` 加 `navContext`；时间线路由取 `resolveCockpitNavContext(viewer)`。
  - `timeline.ts`：
    - 过滤平台级自动化行（归属为空或岗位不可见）；
    - `workforce_job` 的 `href` 按显式工作域可读判定；
    - 审计行不动。
  - `org-cockpit-view.tsx`：岗位格只在 `post` 在 `posts` 里时显示名字。
  - 改测试：
    - `timeline.test.ts`：Sunny 老板看不到 `release-drift`，看得到 `tender-watch`；梦馨老板的投标域作业 `href` 为 null；super_admin 全部出现；分页与游标不变；
    - `org-cockpit-view.test.tsx`：不可见岗位不显示岗位名；
    - `posts-read-model.test.ts:308`：posts 与 timeline 组装判定输入，workload 不组装。
  - design D12 的规格拆分已在本 change 的 spec 增量里，代码与 `waiting.test.ts` 不动。
  - verify：
    - 三份测试全过；
    - `waiting.test.ts`（80）不变；
    - `openspec validate vis-1c-notify-settings-search --strict` 通过。

## 7. 门禁与独立审查

- [ ] 7.1 跑门禁并做独立代码审查：
  - 跑下列门禁：
    - `npm run test:ci`；
    - `npm test`，与 origin/main 对比环境类失败（基线 13 个）；
    - `NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck`；
    - `npm run lint:baseline`；
    - `bash scripts/check-test-registry.sh`；
    - `npx next build --webpack`。
  - 起独立审查子代理：只给 diff 与 spec 增量，不给本 design 的结论。修掉 Major 及以上的发现，修法与理由写进报告。
  - verify：
    - 全部门禁通过（或失败与 origin/main 相同）；
    - 审查发现逐条有处理记录。

## 8. 报告与 TASKFLOW

- [ ] 8.1 写 `docs/QINGYAN_VIS-1c_REPORT.md` 并同步 TASKFLOW：
  - 报告包含：
    - 改动清单；
    - 按身份的结果表（销售、合价、运营主管、运营、招投标、会计、出单、安装工、无岗位、老板、梦馨老板、梦馨外贸、super_admin），列可见通知类型数、搜项目与否、营销工具与卡片、底栏首格、侧栏「管理总览」；
    - 通知类型生产方核对记录；
    - 测试数（对照基线）；
    - 门禁输出；
    - 审查处理；
    - 上线步骤（先合 #409；部署前对梦馨跑 `ALLOW_SENDER_COPY_UPDATE=true npx tsx scripts/set-org-sender-copy.ts --org mengxin-home-textile --mode platform_relay --actor <平台管理员邮箱> --dry-run`，确认后去掉 `--dry-run`）；
    - 遗留项。
  - `docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md`：VIS-1c 状态改为 `[~]`（开 PR 时），合并并归档后改为 `[x]`。
  - verify：
    - 报告里每个数字都来自本次真实输出；
    - TASKFLOW 状态与 `git log --oneline --merges` 一致。
