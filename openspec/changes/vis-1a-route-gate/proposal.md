# Proposal：路由级可见性门（VIS-1a）

TASKFLOW：VIS-1a（新增 Phase V「可见性收口」；任务书 `docs/QINGYAN_VIS-1_VISIBILITY_TASKBRIEF.md`，Lucas 2026-11-08 拍板：判断点 1–7 全取推荐）。

## Why

侧栏已按「岗位键 ∧ 模块」收干净（PERM-4c2 / PERM-7b），但 163 个 `(main)` 页面里有 94 个除登录外没有任何门，模块从未在页面层生效。结果是销售、安装工、老板直接敲 URL 就能进外贸、招投标、营销工作区，先看到整页骨架和业务术语。

## What Changes

- 新增「路由门」：每个已登录的 `(main)` 页面请求（硬加载与站内软导航都算）先在服务端按导航注册表判定「所属模块已开 ∧ 当前岗位持键」。判定输入与侧栏同一份，口径就是侧栏的 `isNavItemVisible`（含父项），不写第二套规则。不满足时 302 到该用户的默认工作区，页面不渲染；默认工作区本身不放行时落 `/tasks`。
- 新增「路由前缀 → 导航项」门表（代码常量，零 schema），覆盖 `(main)` 下全部 163 个页面。分三类：
  - 侧栏入口：按对应导航项判定。
  - 无侧栏入口的路由：在注册表里登记「只做门、不进侧栏」的条目，用同一函数判定。
  - 「登录即可」白名单：`/`、`/tasks/**`、`/notifications`、`/help`、`/settings`（索引）、`/settings/account`、`/settings/appearance`、`/settings/notifications`、`/settings/wechat`、`/wechat`。
  - 门表之外的 `(main)` 路径一律拒绝（fail-closed）。
- 新增源码断言测试：遍历 `src/app/(main)/**/page.tsx`，每个页面都要命中门表，否则测试失败；`(main)` 以外的页面都要在中间件免登录清单或门外清单里。
- 把 `src/middleware.ts` 切到 Node.js runtime 并承载路由门（理由与试验见 design D1：布局在软导航时不重渲染，`loading.tsx` 之下的门会先吐骨架）。
- **BREAKING**：营销工作区（`/marketing/**`、`/operations/growth/**`）改由路由门管辖，只对持 `operations.read` / `operations.manage` 的岗位与管理层放行。删除 `src/lib/marketing/workspace-gate.ts`、两处 layout 门和中间件的营销页面分支。安装工、会计、出单、无岗位成员不再能进营销工作区，被拦者落各自默认工作区（销售落 `/sales/home`，不再是 `/sales`）。中间件对 `/api/marketing/**` 的旧模式拦截保留（API 层不在本期）。
- 修正 `/sales/analytics`：页面不再只认平台 super_admin，改由路由门按 `sales.analytics.read` 判定（老板、合价、会计、销售模板都持此键），页面内的「无权限访问」块删除。
- 修正营收中心：`/revenue` 导航项与 `NAV_HREF_MODULES["/revenue"]` 只认 `trade` 模块，不再因 `sales` 模块出现；Sunny（未开外贸）里任何人都不见、不能进 `/revenue/**`。
- **BREAKING**：招投标工作区在岗位模式下不再因 `project.read` 或「是某项目成员」放行，只认 `project.create` / `project.update` 或管理层（判断点 3）。项目列表、项目情报、供应商库三组入口同口径。会计与三个出单岗位因此失去 `/bids`、`/projects`、`/projects/intelligence/**`、`/suppliers/**`、`/operations/tender-profile`；会计看结算仍走 `/accounting`「项目结算」页签。
- 让对象详情页按「谁会被链接过去」放行，不随列表收紧：
  - `/blinds-orders/[id]`：销售、出单、安装派工、管理层。
  - `/projects/[id]/**`：持项目读写键或运营键的岗位与管理层。
  - `/sales/customers/[id]`：销售与外贸。
  - `/capabilities/approvals/**`：全部企业成员。
  
  这样销售从报价单 / 客户页、通知点进工艺单，运营从交付项目点回源项目，招投标与运营从工作台点进审批中心都不被弹回（design D4 列出每条来源）。
- **BREAKING（岗位模式老板）**：老板模板里的外贸三键不动（判断点 4），但 `trade` 模块未开时老板敲 `/trade/**`、`/revenue/**` 一律 302 到 `/`。
- 去掉 `bids` / `ops/**` / `accounting` / `install/**` 页面里重复的工作区重定向，改由路由门承担。判定函数保留，侧栏与底栏仍在用。
- 新增表驱动测试：4 个岗位（`sales_rep` / `installer` / `accounting` / `owner`）及其余岗位 × 全部一级路由的放行 / 302 目标，外加旧模式抽样。断言「侧栏可见 ⇔ 路由放行」、默认工作区必放行、重定向无环；新测试注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`。

## Capabilities

### New Capabilities
- `navigation/route-gate`：已登录页面请求的服务端可见性门。涵盖门表覆盖面、判定口径（与侧栏同源）、未授权的 302 目标与防环、登录即可白名单、对象详情页放行规则、fail-closed、源码断言。

### Modified Capabilities
- `navigation/position-based-visibility`：「岗位模式的导航入口」中，招投标、项目列表、项目情报、供应商库四组入口从「要求 `project.read`」改为「要求 `project.create` 或 `project.update` 或管理层」；「外贸与平台管理入口例外」补上「营收中心只随外贸模块出现」。
- `marketing/growth-center-access`：「岗位模式下销售不能读增长中心」改为「营销工作区页面由路由门管辖」。页面门从「派生角色不是销售」改为「持运营键或管理层」，被拦者落默认工作区；只读接口的拦截口径不变。

受影响的 Muse 意图：无（不触碰 muse-bridge）。

## Impact

- 新增：
  - `src/lib/navigation/route-gate.ts`：门表、`resolveRouteGate` 纯函数、重定向目标。
  - `src/lib/navigation/context-server.ts`：服务端构造导航判定输入，`/api/auth/active-org` 与路由门共用。
  - `src/lib/navigation/__tests__/route-gate.test.ts`：表驱动测试 + 源码断言。
- 修改：
  - `src/middleware.ts`：Node.js runtime + 路由门；删营销页面分支。
  - `src/lib/navigation/registry.ts`：`ROUTE_ONLY_NAV_ITEMS`、project 系入口键、`biz-revenue` 模块。
  - `src/lib/tenancy/modules.ts`：`/revenue`。
  - `src/lib/rbac/workspace-policy.ts`：`canAccessBidWorkspace` 岗位模式口径。
  - `src/app/api/auth/active-org/route.ts`：改用共享构造器，响应字段不变。
  - `src/lib/marketing/route-access.ts`：删页面路径函数，保留 API 判定。
  - 页面：`src/app/(main)/sales/analytics/page.tsx`、`bids/page.tsx`、`accounting/page.tsx`、`ops/**/page.tsx`、`install/**/page.tsx`。
  - layout：`marketing/layout.tsx`、`operations/growth/layout.tsx`。
  - 测试：`position-nav.test.ts`、`workspace-policy.test.ts`、`residual-reads.test.ts`、`route-access.test.ts` 的受影响断言。
  - 脚本：`scripts/test-all.sh`、`scripts/test-ci-unit.sh`。
- 删除：`src/lib/marketing/workspace-gate.ts`。
- 运行时：中间件从 Edge 改为 Node.js runtime，页面请求（含预取）多一次权限解析（进程内 30 秒缓存，design D3）；`/api/**`、静态文件、免登录路径不走路由门。
- 硬纪律：零 schema、不新增权限键、零新增 LLM 调用、不触碰出站、不新增队列 / cron。
- 合并前置（Lucas）：`config/positions/sunny.json` 的 `TODO:` 邮箱占位填实并跑岗位绑定，否则无岗位成员在本 change 之后敲任何业务 URL 都会被弹回默认工作区。

## Out of scope

- 首页岗位卡、「等你拍板」、手机底栏、`/operations` 索引页、`/help` 功能地图、销售侧栏的「AI 任务」「数字员工」、`/workforce` 按可读域过滤：留给 VIS-1b。本 change 后 Lynn 仍能进 `/workforce`、`/assistant`，因为侧栏里还有这两项，路由门与侧栏保持一致。
- 通知类型开关、`/settings` 索引卡片、全局搜索、AI 工具表：留给 VIS-1c。审批中心可见集合：留给 VIS-1d。以岗位预览：留给 VIS-1e。
- 「收件箱」（`/service-inbox`）与「知识库」（`/knowledge`）对哪些岗位可见：本 change 照侧栏现状放行（安装工、会计、出单、无岗位成员当前侧栏都有这两项）。任务书验收里「安装工敲这两个 302」需要先定岗位键口径，见 design「待拍板」Q1。
- API 层按模块拦截（任务书 Out of scope），包括 `/api/marketing/**` 旧模式拦截的去留。
- 页面内指向对方不可进区域的链接（如工艺单详情里的「维修单」链接对销售）在本 change 里只会被路由门弹回，不改链接本身；清单见 design D4，随 VIS-1b 收。
- `src/middleware.ts` 改名为 Next 16 的 `proxy.ts`、`src/lib/permissions-client.ts` 里无调用方的 `canAccessModule` 表、项目详情的招投标五页签（判断点 7）、`BlindsOrder` / `FabricInventory` 租户隔离、免登录页（`/display`、`/quote/[token]`、`/sales/share/visualizer/[token]`）。
