# Proposal：路由级可见性门（VIS-1a）

TASKFLOW：VIS-1a（新增 Phase V「可见性收口」；任务书 `docs/QINGYAN_VIS-1_VISIBILITY_TASKBRIEF.md`，Lucas 2026-11-08 拍板：判断点 1–7 全取推荐）。

## Why

侧栏已按「岗位键 ∧ 模块」收干净（PERM-4c2 / PERM-7b），但 163 个 `(main)` 页面里有 94 个除登录外没有任何门，模块从未在页面层生效。结果是销售、安装工、老板直接敲 URL 就能进外贸、招投标、营销工作区，先看到整页骨架和业务术语。

## What Changes

- 新增服务端路由门：每个已登录的 `(main)` 页面请求（硬加载、站内软导航、预取）在渲染前判定，规则与侧栏的 `isNavItemVisible` 相同（含父入口），输入与侧栏同一份。
- 让不放行的请求 302 到该用户进入首页后最终停留的页面：管理层为 `/`，其余按首页落地规则，没有则 `/tasks`；页面不渲染，`Location` 不带原查询串，不加说明判定原因的响应头。
- 让判定输入取不到的请求（如数据库不可用）302 到 `/tasks`，不放行；会话有效但用户已停用或不存在的请求 302 到 `/login`。
- 让平台 super_admin 的页面请求一律放行，与改动前一致（任务书「Lucas 一切照旧」）；页面既有的平台管理员门与 Autopilot 门不变。
- 新增「路由 → 可见规则」登记表（代码常量，零 schema），覆盖 `(main)` 全部 163 个页面；门表之外的 `(main)` 路径一律拒绝（fail-closed）。
- 新增「登录即可」白名单：`/`、`/tasks/**`、`/notifications`、`/help`、`/settings`（索引）、`/settings/account`、`/settings/appearance`、`/settings/notifications`、`/settings/wechat`、`/wechat`。
- 跳过不需要判定的请求：`/api/**`、免登录路径、`public/` 静态文件、`/login`、`/register`、`/select-org`、`/monitoring`。静态文件的判法是：末段带扩展名，且第一段不是已登录区一级路径。
- 修正中间件 `matcher`：不再按图片扩展名整体排除，`/projects/a.png` 这类路径也要登录并经门。
- 提升 `public/sw.js` 的缓存版本，清掉门上线前离线缓存下的业务页。
- 新增源码断言测试：`src/app/(main)/**/page.tsx` 与「页面 → 规则」快照必须逐条一致，新页面即使落在已有前缀下也要显式登记；`(main)` 以外的 6 个页面必须在免登录或门外清单里，否则测试失败。
- 把 `src/middleware.ts` 切到 Node.js runtime 来承载路由门。理由与夹具实测见 design D1：layout 在软导航时不重渲染，`loading.tsx` 之下的门会先吐骨架。
- 收紧营销工作区（`/marketing/**`、`/operations/growth/**`），改按侧栏「品牌增长」口径判定。岗位模式下只放行运营键持有者与管理层，安装工、会计、出单、无岗位成员被拦，销售落 `/sales/home`（原来是 `/sales`）。**BREAKING**
- 收紧外贸角色的营销工作区（改动前只拦销售），与各自侧栏一致；梦馨老板 Cathy（`owner` + `trade_rep`）不受影响。**BREAKING**
  - 梦馨（岗位模式）只持 `trade_rep` 的外贸业务员不再能进；
  - 无行业包企业的平台角色 `trade` / `user` 不再能进。
- 删除被路由门取代的营销页面门：`src/lib/marketing/workspace-gate.ts`、两处 layout、中间件的营销页面分支。中间件对 `/api/marketing/**` 的旧模式拦截保留。
- 修正 `/sales/analytics`：改按 `sales.analytics.read` 判定（老板、合价、会计、销售模板都持此键），删除页面里只认平台 super_admin 的「无权限访问」块。
- 修正营收中心：`/revenue` 导航项与 `NAV_HREF_MODULES["/revenue"]` 只认 `trade` 模块，不再因 `sales` 模块出现。Sunny 未开外贸，老板敲 `/revenue/**`、`/trade/**` 会被 302 到 `/`；老板模板的外贸三键不动（判断点 4）。**BREAKING**
- 收紧岗位模式的招投标工作区（判断点 3）：只认 `project.create` / `project.update` 或管理层，不再因 `project.read` 或「是某项目成员」放行；项目列表、项目情报、供应商库三组入口同口径。会计与三个出单岗位因此失去：
  - 侧栏与路由：`/bids`、`/projects`（列表）、`/projects/intelligence/**`、`/suppliers/**`、`/operations/tender-profile`；
  - 手机底栏的「招投标」入口。
  
  会计看结算仍走 `/accounting`「项目结算」页签。**BREAKING**
- 放行对象详情页给被链接过去的人：
  - `/blinds-orders/[id]`：销售、出单、安装派工、管理层；
  - `/projects/[id]/**`：项目读写键、运营键、项目成员、管理层，平台管理员子页除外；
  - `/sales/customers/[id]`：销售、外贸、管理层；
  - `/capabilities/approvals/**`：全部企业成员。
  
  来源清单见 design D4。
- 保留既有承诺与入口：
  - 安装工仍能进 `/sales/calendar`（`installation/install-tasks`）；
  - 有查看权的会计仍能进 `/sales/website-bookings`（`calendar/website-booking-intake`）；
  - 外贸与招投标仍能进 `/settings/email`；
  - 没有企业成员身份的用户仍能进 `/organizations`。
- 去掉 `bids` / `ops/**` / `accounting` / `install/**` 页面里重复的工作区重定向，改由路由门承担；判定函数保留，侧栏与底栏仍在用。
- 新增表驱动测试，并注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`：
  - 覆盖 Sunny 11 种与梦馨 2 种岗位身份、4 个无行业包企业抽样 × 全部登记路由，断言放行结果与 302 目标；
  - 断言「侧栏可见 ⇔ 路由放行」、落地页必放行、一跳即停。

## Capabilities

### New Capabilities
- `navigation/route-gate`：已登录页面请求的服务端可见性门。包括：
  - 判定口径（与侧栏同源）、两种模式、判定时效；
  - 302 目标与防环、取不到输入时拒绝、停用用户回登录、不泄露；
  - super_admin 放行、登录即可白名单、无侧栏入口与对象详情页的放行规则；
  - fail-closed、全页登记快照、不经门的请求。

### Modified Capabilities
- `navigation/position-based-visibility`：
  - 「岗位模式判定」：旧模式例外清单补上「营收中心只随外贸模块」。
  - 「岗位模式的导航入口」：招投标、项目列表、项目情报、供应商库从「要求 `project.read`」改为「要求 `project.create` 或 `project.update` 或管理层」。
  - 「外贸与平台管理入口例外」：补上营收中心只随外贸模块。
  - 新增「手机底栏的招投标入口与招投标中心同口径」。
- `marketing/growth-center-access`：「岗位模式下销售不能读增长中心」更名为「营销工作区页面与只读接口的门槛」。页面门改由路由门按「品牌增长」口径判定（岗位模式运营键或管理层；旧模式 super_admin / boss / manager / operations），只读接口口径不变。
- `revenue/spine-access`：「营收中心导航与接口一致」补上「两种模式下只随 `trade` 模块出现，不可见时直接访问被 302」。

受影响的 Muse 意图：无（不触碰 muse-bridge）。

## Impact

- 新增：
  - `src/lib/navigation/route-gate.ts`：门表、请求分类、`resolveRouteGate`、302 目标、TTL 缓存。
  - `src/lib/navigation/context-server.ts`：服务端构造判定输入，`/api/auth/active-org` 与中间件共用。
  - `src/lib/navigation/__tests__/route-gate.test.ts`。
- 修改：
  - `src/middleware.ts`。
  - `src/lib/navigation/registry.ts`：新增 `ROUTE_ONLY_NAV_ITEMS`，改 project 系入口键与 `biz-revenue` 模块。
  - `src/lib/tenancy/modules.ts`。
  - `src/lib/rbac/workspace-policy.ts`。
  - `src/app/api/auth/active-org/route.ts`。
  - `src/lib/marketing/route-access.ts`。
  - 页面：`src/app/(main)/sales/analytics/page.tsx`、`bids/page.tsx`、`accounting/page.tsx`、`ops/**/page.tsx`、`install/**/page.tsx`。
  - 静态资源：`public/sw.js`（`VERSION`）。
  - 测试：`position-nav.test.ts`、`workspace-policy.test.ts`、`residual-reads.test.ts`、`route-access.test.ts`；`scripts/public-route-auth-contracts.test.ts` 与 `notification-href.test.ts` 读或调用中间件，须仍通过。
  - 测试注册：`scripts/test-all.sh`、`scripts/test-ci-unit.sh`；`ci/test-registry-baseline.txt` 删掉 `route-access.test.ts` 一行，改为正式注册。
- 删除：`src/lib/marketing/workspace-gate.ts`、`src/app/(main)/marketing/layout.tsx`、`src/app/(main)/operations/growth/layout.tsx`。
- 运行时：中间件从 Edge 改为 Node.js runtime。需判定的页面请求（含预取）多一次权限解析，企业侧字段在进程内缓存 30 秒（design D3）。
- 硬纪律：零 schema、不新增权限键、零新增 LLM 调用、不触碰出站、不新增队列 / cron。
- 合并前置（Lucas）：`config/positions/sunny.json` 的 9 个 `TODO:<姓名>` 邮箱占位填实并跑岗位绑定，否则无岗位成员在本 change 之后敲任何业务 URL 都会被弹回。

## Out of scope

- 留给 VIS-1b：
  - 首页岗位卡、「等你拍板」、手机底栏的统一判定、`/operations` 索引页、`/help` 功能地图；
  - 销售侧栏的「AI 任务」「数字员工」与 `/workforce` 按可读域过滤。本 change 后 Lynn 仍能进 `/workforce`、`/assistant`，因为侧栏里还有这两项，路由门与侧栏保持一致。
- 留给后续：通知类型开关、`/settings` 索引卡片、全局搜索、AI 工具表（VIS-1c）；审批中心可见集合（VIS-1d）；以岗位预览（VIS-1e）。
- 「收件箱」（`/service-inbox`）与「知识库」（`/knowledge`）对哪些岗位可见：本 change 照侧栏现状放行，见 design「审核关注点」Q1。
- API 层按模块拦截（任务书 Out of scope），包括 `/api/marketing/**` 旧模式拦截与 `canAccessMarketingWorkspace`（API 判定）的去留。
- 页面内指向对方不可进区域的链接（如工艺单详情里的「维修单」链接对销售）：本 change 里只会被路由门弹回，不改链接本身；清单见 design D4，随 VIS-1b 收。
- 其他不在本期的：把 `src/middleware.ts` 改名为 Next 16 的 `proxy.ts`；`src/lib/permissions-client.ts` 里无调用方的 `canAccessModule`；项目详情的招投标五页签（判断点 7）；`BlindsOrder` / `FabricInventory` 租户隔离；免登录页（`/display`、`/quote/[token]`、`/sales/share/visualizer/[token]`）。
