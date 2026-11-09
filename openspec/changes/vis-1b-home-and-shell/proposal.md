# Proposal：首页、底栏、索引页按同一张表（VIS-1b）

TASKFLOW：VIS-1b（Phase V「可见性收口」；任务书 `docs/QINGYAN_VIS-1_VISIBILITY_TASKBRIEF.md`，Lucas 2026-11-08 拍板判断点 1–7）。依赖 VIS-1a（#393 已合并，归档 #395）：路由门 `src/lib/navigation/route-gate.ts` 与共享判定输入 `src/lib/navigation/context-server.ts`。

## Why

路由门已经让看不见的页面敲 URL 也进不去，但首页、手机底栏、`/operations` 索引、`/help` 和若干站内链接仍各写一套规则，或者干脆不判定。老板首页第一张卡是梦馨的「询盘销售」，点进去被 302；「AI 任务」对每个人列全组织的招标与外贸作业；各处链接把人带到路由门会拦的页面。

## What Changes

**首页岗位卡**
- 判定岗位卡可见：跳转页对当前用户经路由门放行才出现。例如 `inbound_sales` 跳 `/revenue`，随 `trade` 模块；`ops_knowledge` 跳 `/ai-activity`，只对平台 super_admin。
- 要求「客服」卡另看微信入口开关。
- 只为可见卡读取 KPI 与自动化，接口只返回可见卡。
- 合并落地页计算：管理层一张可见卡都没有时，首页与路由门都落 `/tasks`，一次跳转到位。
- 去掉首页副标题与加载骨架里写死的「七个岗位」。

**「等你拍板」**
- 给审批按类型配专属落点：
  - 超限折扣 / 签约改价 → 报价单（`/sales/quote-sheet?mode=order&quoteId=…`）；
  - 折扣设置变更 → 销售驾驶舱（`/sales/cockpit`）；
  - 质保邮件 → 会计待收尾款页签（`/accounting?tab=balance&order=…`）；
  - 返修邮件 → 维修单；
  - 取消订单 → 工艺单；
  - 询价 / 催单 → 项目的该轮询价；
  - 营收脊柱 → 营收中心；
  - 其余 → 审批详情（`/capabilities/approvals/<编码后的「来源类型:来源 id」>`，与审批中心列表同写法）。
- 只列落点对当前用户放行的审批。这里不按任务书写的「与可见岗位卡取交集」：Sunny 原生审批（折扣、签约改价）按既有归属算在「询盘销售」卡下，这张卡在 Sunny 不可见，取交集会把老板自己的折扣审批藏掉（design Q1）。
- 明确截断时的总数：已取到且放行的条数加上未取到的条数，并标 `truncated`。

**workforce 作业**
- 新增「工作域 → 导航入口」对照（代码常量）：
  - 投标域随「招投标中心」；
  - 交付域随「运营中心」或「项目列表」；
  - 销售域随「销售首页」或「外贸」；
  - 通用域与解析不出的作业只对管理层（design Q8）。
- 过滤 `/workforce` 列表：服务端分批扫描、跳过不可读作业凑满一页，一次至多扫 5 批。
- 隐藏不可读的作业详情：返回 404。
- 过滤首页「需要你」作业，与列表同一函数。
- 收窄「AI 任务」入口：只对至少可读一个工作域的人出现。会计、安装工、出单与无岗位成员不再看到它，`/workforce/**` 对他们 302 到各自落地页（design Q8）。**BREAKING**

**侧栏、底栏与站内链接**
- 去掉 `work-ai-jobs`（AI 任务）与 `work-assistant`（数字员工）的 `salesWorkspaceVisible`（判断点 5）。纯销售侧栏不再有这两项，经路由门同步失去 `/workforce/**`、`/assistant`、`/inbox`。**BREAKING**
- 拆出客户端可用的路由门判定与落地页函数（纯模块，不依赖 `next/server`）。
- 新增判定输入拼装函数：把 active-org 响应拼成与路由门相同的输入，服务端与客户端共用。
- 新增客户端钩子：回答「这个地址对我放行吗」与「我的落地页」，平台 super_admin 一律放行。
- 按钩子显示手机底栏每个页签：「招投标」与侧栏「招投标中心」同口径；「AI」只在 AI 工作中心放行时出现；「助手」只在数字员工放行时出现。底栏布局（销售 / 通用）的判定不变。
- 隐藏指向不放行页面的站内链接：工艺单详情里的维修单链接、数字员工工作台的「客户」「创建报价」「打开销售工作区」按钮、`/tasks` 的「进入协同空间」。
- 改写工艺单详情 / 编辑页的返回链接与删除后跳转：`/blinds-orders` 不放行时，先退到客户详情（放行时），再退到当前用户的落地页。

**索引页与帮助**
- 过滤 `/operations` 索引卡片：只列放行的卡片，super_admin 看全部，全不放行时显示空态。卡片清单仍是页内静态表，不按任务书改为从导航生成（design Q9）。
- 按可见导航树生成 `/help` 功能地图。
- 新增 `NavigationItem.description`（可选），导航注册表与系统底栏 72 项各写一句。
- 删除 `/help` 的静态 `ROUTES` 表与 `docs/PROJECT_AUDIT.md` 引用。

**测试**
- 新增与更新表驱动测试：岗位卡可见集（Sunny 各岗位、梦馨、平台 super_admin）、落地页、「等你拍板」的落点与截断、工作域对照与分页、「AI 任务」入口、底栏页签、帮助地图、索引页、判定输入拼装。新测试注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`。

## Capabilities

### New Capabilities
- `navigation/entry-visibility`：客户端与服务端页面上的入口（手机底栏页签、`/operations` 索引卡片、`/help` 功能地图、站内跳转链接与按钮）只在路由门对当前用户放行时出现。
- `agents/workforce-job-scope`：workforce 作业（`/workforce` 列表与详情、首页「需要你」作业）只对当前用户可读的工作域可见，工作域按导航入口判定。

### Modified Capabilities
- `cockpit/posts-overview`：「响应按岗位注册表顺序返回七个岗位」更名并改为返回当前用户可见的岗位；「等你 N 件…」改为按类型给落点、只列落点放行的审批、写明截断时的总数、作业按可读工作域。
- `cockpit/home-view`：「首页对管理层展示岗位视图」补「无可见卡片时 302 到 `/tasks`」，与路由门共用落地页函数；「七个岗位卡片」改为按接口返回的可见卡片显示，副标题与骨架不写死个数。
- `cockpit/post-registry`：新增「岗位卡片的可见条件」（跳转页放行 ∧ 客服另要求微信开关）。
- `navigation/route-gate`：「不放行时 302 到落地页」里管理层的落地页在零可见卡时改为 `/tasks`。
- `navigation/position-based-visibility`：「岗位模式的底栏」与「手机底栏的招投标入口与招投标中心同口径」改为每个页签按路由门判定；新增「纯销售侧栏不含 AI 任务与数字员工」「AI 任务只对有可读工作域的人出现」。

受影响的 Muse 意图：无（不触碰 muse-bridge）。

## Impact

- 新增：
  - `src/lib/navigation/route-gate-core.ts`（从 `route-gate.ts` 拆出的纯判定）；
  - `src/lib/navigation/landing.ts`（岗位卡可见判定、落地页、重定向目标）；
  - `src/lib/navigation/filter-context.ts`（判定输入拼装）；
  - `src/lib/navigation/use-navigation-access.ts`（客户端钩子）；
  - `src/lib/workforce-runtime/readable-domains.ts`（工作域 → 导航入口）；
  - 对应测试。
- 修改：
  - `src/lib/cockpit/posts.ts`、`posts-read-model.ts`、`waiting.ts`、`src/app/(main)/page.tsx`、`src/components/cockpit/org-cockpit-view.tsx`；
  - `src/app/api/workforce/jobs/route.ts`、`jobs/[id]/route.ts`、`src/lib/workforce-runtime/read-model/list-service.ts`、`src/app/(main)/workforce/page.tsx`；
  - `src/lib/navigation/registry.ts`（两项 `salesWorkspaceVisible`、`work-ai-jobs` 岗位键、72 条 `description`）、`types.ts`、`route-gate.ts`、`context-server.ts`；
  - `src/components/mobile-tab-bar.tsx`、`src/app/(main)/operations/page.tsx`、`src/app/(main)/help/page.tsx`；
  - `src/app/(main)/blinds-orders/[id]/page.tsx`、`blinds-orders/[id]/edit/page.tsx`、`assistant/digital-employee-workbench.tsx`、`tasks/tasks-classic.tsx`；
  - 测试与 `scripts/test-all.sh`、`scripts/test-ci-unit.sh`。
- 硬纪律：零 schema、不新增权限键、零新增 LLM 调用、不触碰出站、不新增队列 / cron。

## Out of scope

- 通知类型开关、`/settings` 索引卡片（含无条件的「邮箱绑定」卡）、全局搜索的项目结果、AI 工具表：VIS-1c。审批中心可见集合：VIS-1d。以岗位预览：VIS-1e。
- 「收件箱」「知识库」对安装工等岗位是否隐藏（VIS-1a Q1 已按推荐保持现状）；本 change 只让「客服」岗位卡随微信开关，不改「收件箱」侧栏入口。
- 首页时间线（company.log）与工作量面板的按岗位过滤；岗位日报（post-daily-digest）。
- 把侧栏、抽屉菜单改用新客户端钩子（它们已用同一判定函数与同一输入，行为一致；统一取数留给以后）。
- 工作域解析规则（`work-domain.ts`）与批量化；旧作业的工作域回填。
- API 层按模块拦截；项目详情招标五页签；`middleware.ts` 改名。
