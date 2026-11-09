# Proposal：首页、底栏、索引页按同一张表（VIS-1b）

TASKFLOW：VIS-1b（Phase V「可见性收口」；任务书 `docs/QINGYAN_VIS-1_VISIBILITY_TASKBRIEF.md`，Lucas 2026-11-08 拍板判断点 1–7）。依赖 VIS-1a（#393 已合并，归档 #395）：路由门 `src/lib/navigation/route-gate.ts` 与共享判定输入 `src/lib/navigation/context-server.ts`。

## Why

路由门已经让看不见的页面敲 URL 也进不去，但首页、手机底栏、`/operations` 索引、`/help` 和若干站内链接仍各写一套规则，或者干脆不判定。老板首页第一张卡是梦馨的「询盘销售」，点进去被 302；销售侧栏里的「AI 任务」列的是全组织的招标与外贸作业；各处链接把人带到路由门会拦的页面。

## What Changes

- 让首页岗位卡按路由门判定：卡片的跳转页对当前用户放行才出现（`inbound_sales` 跳 `/revenue` 随 `trade` 模块，`ops_knowledge` 跳 `/ai-activity` 只对平台 super_admin）；「客服」卡另要求微信入口开关打开。接口只返回、只取数可见卡，首页一张可见卡都没有时 302 到 `/tasks`。
- 让「等你拍板」的每条审批按类型跳专属落点，且落点对当前用户放行才列出：
  - 超限折扣 / 签约改价 → 报价单（`/sales/quote-sheet?mode=order&quoteId=…`）；
  - 质保邮件 → 会计待收尾款页签（`/accounting?tab=balance&order=…`）；
  - 返修邮件 → 维修单；
  - 取消订单 → 工艺单；
  - 询价 / 催单 → 项目的该轮询价；
  - 营收脊柱 → 营收中心；
  - 其余 → 审批详情（`/capabilities/approvals/<id>`）。

  需要你的 workforce 作业只列当前用户可读工作域的。这里不按任务书写的「与可见岗位卡取交集」：Sunny 原生审批（折扣、签约改价）按既有归属算在「询盘销售」卡下，而这张卡在 Sunny 不可见，取交集会把老板自己的折扣审批藏掉（design Q1）。
- 新增「工作域 → 导航入口」对照（代码常量）：
  - 投标域随「招投标中心」；
  - 交付域随「运营中心」或「项目列表」；
  - 销售域随「销售首页」；
  - 通用域随「AI 任务」入口本身。

  作业的工作域沿用既有解析（显式标记 > 所属项目 > 历史销售工具证据），解析不出的只对管理层可见。`/workforce` 列表、作业详情与「等你拍板」的作业都按它过滤。
- 从 `work-ai-jobs`（AI 任务）与 `work-assistant`（数字员工）去掉 `salesWorkspaceVisible`（判断点 5）。纯销售侧栏不再有这两项，经路由门同步失去 `/workforce/**`、`/assistant`、`/inbox`。**BREAKING**
- 拆出客户端可用的路由门判定（纯模块，不依赖 `next/server`），并新增客户端钩子：用与侧栏相同的输入回答「这个地址对我放行吗」，平台 super_admin 一律放行。
- 让手机底栏每个页签都按这个判定出现。「招投标」与侧栏「招投标中心」同口径；「AI」只在 AI 工作中心放行时出现；「助手」只在数字员工放行时出现。底栏布局（销售 / 通用）的判定不变。
- 收掉指向不放行页面的站内链接：工艺单详情里的维修单链接、工艺单详情 / 编辑页回列表与删除后跳转（回列表不放行时改回客户页或上一页）、数字员工工作台的「客户」「创建报价」「打开销售工作区」按钮、`/tasks` 的「进入协同空间」。
- 把 `/operations` 索引页改为从可见入口生成，只列当前用户放行的卡片。
- 把 `/help` 功能地图改为从当前用户可见的导航树生成。`NavigationItem` 新增可选 `description` 字段，导航注册表 72 项各写一句；删除静态 `ROUTES` 表与 `docs/PROJECT_AUDIT.md` 引用。
- 新增与更新表驱动测试：岗位卡可见集（Sunny 各岗位、梦馨、平台 super_admin）、「等你拍板」的过滤与落点、工作域对照、底栏页签、帮助地图、索引页。新测试注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`。

## Capabilities

### New Capabilities
- `navigation/entry-visibility`：客户端与服务端页面上的入口（手机底栏页签、`/operations` 索引卡片、`/help` 功能地图、站内跳转链接与按钮）只在路由门对当前用户放行时出现。
- `agents/workforce-job-scope`：workforce 作业（`/workforce` 列表与详情、首页「需要你」作业）只对当前用户可读的工作域可见，工作域按导航入口判定。

### Modified Capabilities
- `cockpit/posts-overview`：「响应按岗位注册表顺序返回七个岗位」更名并改为返回当前用户可见的岗位；「等你 N 件…」改为按类型给落点、只列落点放行的审批、作业按可读工作域。
- `cockpit/home-view`：「首页对管理层展示岗位视图」补「无可见卡片时 302 到 `/tasks`」；「七个岗位卡片」改为按接口返回的可见卡片显示。
- `cockpit/post-registry`：新增「岗位卡片的可见条件」（跳转页放行 ∧ 客服另要求微信开关）。
- `navigation/position-based-visibility`：「岗位模式的底栏」与「手机底栏的招投标入口与招投标中心同口径」改为每个页签按路由门判定；新增「纯销售侧栏不含 AI 任务与数字员工」。

受影响的 Muse 意图：无（不触碰 muse-bridge）。

## Impact

- 新增：`src/lib/navigation/route-gate-core.ts`（从 `route-gate.ts` 拆出的纯判定）、`src/lib/navigation/use-navigation-access.ts`（客户端钩子）、`src/lib/workforce-runtime/readable-domains.ts`（工作域 → 导航入口）、对应测试。
- 修改：
  - `src/lib/cockpit/posts.ts`、`posts-read-model.ts`、`waiting.ts`、`src/app/(main)/page.tsx`、`src/components/cockpit/*`；
  - `src/app/api/workforce/jobs/route.ts`、`jobs/[id]/route.ts`；
  - `src/lib/navigation/registry.ts`（两项 `salesWorkspaceVisible`、72 条 `description`）、`types.ts`、`route-gate.ts`；
  - `src/components/mobile-tab-bar.tsx`、`src/app/(main)/operations/page.tsx`、`src/app/(main)/help/page.tsx`；
  - `src/app/(main)/blinds-orders/[id]/page.tsx`、`blinds-orders/[id]/edit/page.tsx`、`assistant/digital-employee-workbench.tsx`、`tasks/tasks-classic.tsx`；
  - 测试与 `scripts/test-all.sh`、`scripts/test-ci-unit.sh`。
- 硬纪律：零 schema、不新增权限键、零新增 LLM 调用、不触碰出站、不新增队列 / cron。

## Out of scope

- 通知类型开关、`/settings` 索引卡片（含无条件的「邮箱绑定」卡）、全局搜索的项目结果、AI 工具表：VIS-1c。审批中心可见集合：VIS-1d。以岗位预览：VIS-1e。
- 「收件箱」「知识库」对安装工等岗位是否隐藏（VIS-1a Q1 已按推荐保持现状）；本 change 只让「客服」岗位卡随微信开关，不改「收件箱」侧栏入口。
- 首页时间线（company.log）与工作量面板的按岗位过滤；岗位日报（post-daily-digest）。
- 把侧栏、抽屉菜单改用新客户端钩子（它们已用同一判定函数与同一输入，行为一致；统一取数留给以后）。
- API 层按模块拦截；项目详情招标五页签；`middleware.ts` 改名。
