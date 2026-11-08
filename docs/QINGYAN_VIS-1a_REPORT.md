# VIS-1a 报告：路由级可见性门

| 项 | 值 |
|---|---|
| TASKFLOW | VIS-1a（Phase V「可见性收口」） |
| 任务书 | `docs/QINGYAN_VIS-1_VISIBILITY_TASKBRIEF.md`（判断点 1–7 已拍板） |
| OpenSpec change | `openspec/changes/vis-1a-route-gate/`（`openspec validate --strict` 通过） |
| 拍板 | Lucas 2026-11-08：判断点按推荐；design「审核关注点」Q1–Q10「按推荐的走」 |
| 分支 | `claude/vis-1-taskflow-proposal-918h26` |
| 运行环境 | 云容器 Node 22.23.4（`.nvmrc` 要 24）；本地无隔离库、无 Chromium，`.env` 直连生产库不本地起应用 |

## 1. 用户现在会怎么看到

- 已登录用户请求任一已登录页面时，硬加载、站内点链接、链接预取都算，Node runtime 中间件在渲染前按导航注册表判定「模块已开 ∧ 岗位持键」。不满足就 302 到该用户进入首页后最终停留的页面，页面内容一个字节都不出，`Location` 不带原查询串。
- 判定口径与侧栏同源：侧栏与路由门共用同一个服务端输入构造器（`src/lib/navigation/context-server.ts`），规则就是侧栏的 `isNavItemVisible`（含父入口）。侧栏之外的放行只来自逐条登记的规则，见 design D4 / D5：
  - 登录即可的路由；
  - 没有侧栏入口的页面；
  - 对象详情页（工艺单 / 项目 / 客户 / 审批中心，避免被自己的站内链接与通知弹回）；
  - 平台 super_admin（一切照旧）。
- 门表之外的已登录区路径一律拒绝。163 个页面的「页面 → 规则」逐条写在测试快照里：新增页面或改动任一规则都会让测试失败。
- 以下几处行为变了：
  - 营收中心只随外贸模块，Sunny 里谁都不见、不能进；
  - `/sales/analytics` 改按 `sales.analytics.read`，老板能看了；
  - 招投标 / 项目列表 / 项目情报 / 供应商库在岗位模式只认 `project.create` / `project.update` 或管理层；
  - 营销工作区只放行运营键持有者。

## 2. 改了什么

| 文件 | 改动 |
|---|---|
| `src/lib/navigation/route-gate.ts`（新） | 门表（约 110 条）、请求分类、RSC 变体还原与解码校验、判定（复用 `isNavItemVisible`）、302 目标、TTL 缓存、`applyRouteGate` 请求处理（加载器可注入） |
| `src/lib/navigation/context-server.ts`（新） | `loadOrgNavigationInputs`（active-org 与中间件共用）；`createRouteGateLoader`：当前企业只读解析、30 秒缓存、降级不缓存、并发合并；`ROUTE_GATE_LOADER` |
| `src/middleware.ts` | `runtime: "nodejs"`；`matcher` 不再按图片扩展名排除；public 图片登录前放行；登录后 `/api/marketing/**` 旧模式分支保留，其余 API 放行；页面请求经 `applyRouteGate`；营销页面分支删除；`handleRequest(request, loader)` 可注入 |
| `src/lib/navigation/registry.ts` | `ROUTE_ONLY_NAV_ITEMS` 10 条；project 系 8 个入口改认 `project.create` / `project.update` / 管理层；`biz-revenue` 只认 `trade` 模块 |
| `src/lib/tenancy/modules.ts` | `NAV_HREF_MODULES["/revenue"] = ["trade"]` |
| `src/lib/rbac/workspace-policy.ts` | `canAccessBidWorkspace` 岗位模式只认 `project.create` / `project.update`（旧模式不变） |
| `src/app/api/auth/active-org/route.ts` | 改用 `loadOrgNavigationInputs`，响应 15 个键与取值不变 |
| `src/lib/marketing/route-access.ts` | 只留接口判定（`isMarketingApiPath` / `canAccessMarketingWorkspace`） |
| 删除 | `src/lib/marketing/workspace-gate.ts`、`src/app/(main)/marketing/layout.tsx`、`src/app/(main)/operations/growth/layout.tsx` |
| 页面 | `bids`、`accounting`、`ops`×3、`install`×5 去掉重复的工作区重定向（保留未登录跳转）；`sales/analytics` 去掉只认 super_admin 的判定与「无权限访问」块 |
| `public/sw.js` | `VERSION` qingyan-v3 → v4（清掉门上线前离线缓存的业务页） |
| 测试 | 新 `route-gate.test.ts`（132 项）；改 `position-nav`、`workspace-policy`、`residual-reads`、`route-access`、`marketing-middleware-access`；后两份从基线转为正式注册 |
| 测试注册 | `scripts/test-all.sh`、`scripts/test-ci-unit.sh` 注册；`ci/test-registry-baseline.txt` 71 → 69（只减不增） |

## 3. 放行 / 302 表（按真实实现计算，Sunny 模块 = `DEFAULT_SUNNY_MODULES`）

人名列按 `config/positions/sunny.json` 的岗位组合：Miki、Bob、Bill 都带 `owner`，所以都是管理层（design Q5）。「会计+合价」一列是任务书验收里假设的 Miki。

| URL | Lynn sales_rep | 安装工 | 会计+合价 | Miki owner+合价+会计 | Bob owner+布帘出单 | Bill owner+bids+vinyl | 梦馨 trade_rep |
|---|---|---|---|---|---|---|---|
| `/` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `/trade/prospects` | → `/sales/home` | → `/install` | → `/sales/home` | → `/` | → `/` | → `/` | ✓ |
| `/revenue` | → `/sales/home` | → `/install` | → `/sales/home` | → `/` | → `/` | → `/` | ✓ |
| `/projects` | → `/sales/home` | → `/install` | → `/sales/home` | ✓ | ✓ | ✓ | → `/tasks` |
| `/projects/x` | → `/sales/home` | → `/install` | ✓ | ✓ | ✓ | ✓ | → `/tasks` |
| `/projects/intelligence` | → `/sales/home` | → `/install` | → `/sales/home` | ✓ | ✓ | ✓ | → `/tasks` |
| `/bids` | → `/sales/home` | → `/install` | → `/sales/home` | ✓ | ✓ | ✓ | → `/tasks` |
| `/capabilities` | → `/sales/home` | → `/install` | → `/sales/home` | ✓ | ✓ | ✓ | → `/tasks` |
| `/capabilities/approvals` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `/workforce` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `/knowledge` | → `/sales/home` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `/suppliers` | → `/sales/home` | → `/install` | → `/sales/home` | ✓ | ✓ | ✓ | → `/tasks` |
| `/service-inbox` | → `/sales/home` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `/reports` | → `/sales/home` | → `/install` | → `/sales/home` | ✓ | ✓ | ✓ | → `/tasks` |
| `/marketing/employee` | → `/sales/home` | → `/install` | → `/sales/home` | ✓ | ✓ | ✓ | → `/tasks` |
| `/operations/growth` | → `/sales/home` | → `/install` | → `/sales/home` | ✓ | ✓ | ✓ | → `/tasks` |
| `/accounting` | → `/sales/home` | → `/install` | ✓ | ✓ | ✓ | ✓ | → `/tasks` |
| `/install` | → `/sales/home` | ✓ | ✓ | ✓ | ✓ | ✓ | → `/tasks` |
| `/inventory` | → `/sales/home` | → `/install` | → `/sales/home` | ✓ | ✓ | ✓ | → `/tasks` |
| `/blinds-orders` | → `/sales/home` | → `/install` | → `/sales/home` | ✓ | ✓ | ✓ | → `/tasks` |
| `/blinds-orders/x` | ✓ | → `/install` | ✓ | ✓ | ✓ | ✓ | → `/tasks` |
| `/sales/analytics` | ✓ | → `/install` | ✓ | ✓ | ✓ | ✓ | → `/tasks` |
| `/sales/calendar` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | → `/tasks` |
| `/settings/email` | ✓ | → `/install` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `/ai-activity` | → `/sales/home` | → `/install` | → `/sales/home` | → `/` | → `/` | → `/` | → `/tasks` |

几点说明：
- Lynn 的 `/workforce` 仍放行：侧栏还有「AI 任务」，VIS-1b 移除后自然 302（判断点 5）。
- 安装工的 `/knowledge`、`/service-inbox` 仍放行：侧栏公共项里有这两项（Q1 按推荐，1a 不动）。
- Lynn 的 `/sales/analytics` 放行：系统 `sales_rep` 模板持 `sales.analytics.read`，页面数据由接口按本人范围给。

## 4. 侧栏快照差异（`position-nav.test.ts`）

- `accounting`：去掉 `ws-bids` 与项目 / 情报 / 供应商组（`nav-projects`、`nav-project-intel`、5 个情报子项、`nav-suppliers`）。
- `fulfillment_vinyl` / `fulfillment_drapery` / `fulfillment_shades`：同上。
- 其余岗位（`owner`、`sales_rep`、`pricing_lead`、`ops_lead`、`ops_staff`、`bids`、`installer`、多岗、无岗位、旧模式抽样）快照不变。
- 新增断言：会计 / 出单即使是项目成员也不见招投标组；`bids` / `owner` 可见；启用 `sales` 未启用 `trade` 时，岗位模式老板与旧模式 `boss` 都不见营收中心。

## 5. 测试与门禁（实际运行）

| 测试 | 改动前基线 | 改动后 |
|---|---|---|
| `position-nav.test.ts` | 86 | 96 |
| `navigation-ia.test.ts` | 63 | 63 |
| `navigation-workspace.test.ts` | 34 | 34 |
| `workspace-policy.test.ts` | 26 | 35 |
| `residual-reads.test.ts` | 76 | 76（3 条营销断言改为新口径） |
| `route-access.test.ts` | 3（未注册） | 3（改为只测接口，正式注册） |
| `ops-access.test.ts` | 21 | 21 |
| `wechat-entry-nav.test.ts` | 19 | 19 |
| `scripts/public-route-auth-contracts.test.ts` | 164 | 164 |
| `notification-href.test.ts` | 91 | 91 |
| `marketing-middleware-access.test.ts` | 1/3（未注册；改动后旧断言失效） | 4（改为新口径，注入加载器，正式注册） |
| `route-gate.test.ts`（新） | — | 132 |

门禁：
- `npm run test:ci`：PASS（`CI unit subset PASS`）。
  - 第一次跑时 `marketing-middleware-access.test.ts` 失败：它锁着旧的 307 → `/sales`，且经中间件连真实库，已改为新口径。
- `npm test`（全量，`NODE_OPTIONS=--max-old-space-size=8192`）：558/571 通过，13 个失败，均与本 change 无关：
  - 这 13 个在 `origin/main`（`1c9ea12`，本分支的基线）的工作树里逐个复跑，同样失败（退出码 1）。
  - 原因都是环境：10 个 capabilities / agent-trace 库测试的「DATABASE SAFETY CHECK」拒跑（无隔离库）；授标情报 Postgres 矩阵需 `DATABASE_URL`；Gmail Draft OAuth 依赖环境变量；客户报价 PDF 分页需 Chromium。
  - 第一次全量用默认堆，「TypeScript 类型检查」因内存溢出失败（共 14 个）；加大堆后通过。
- `npm run typecheck`：容器默认堆下 `tsc` 内存溢出，`NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit` 退出 0。之前本地构建留下的 `.next/types` 会让 tsc 报已删 layout，删掉 `.next` 后通过；CI 无此目录。
- `npm run lint:baseline`：PASS（无新增 error fingerprint，相对基线少 15 处 error）。
- `bash scripts/check-test-registry.sh`：通过，已注册 547，基线剩 69。
- `npx next build --webpack`：退出 0，构建输出含 `ƒ Proxy (Middleware)`。中间件 nft 追踪 142 个文件，含 `.prisma/client` 查询引擎。最终代码共构建 3 次，均成功。
- `openspec validate vis-1a-route-gate --strict`：valid。

变异检查（各自改一处后测试变红，再恢复）：
- 把 `/inventory` 的规则指向错的入口 → 快照断言与场景断言失败；
- 新增一个落在 `/projects/*` 之下却未登记的页面 → 快照断言失败；
- 去掉 `/projects/*` 的项目成员放行 → 场景断言失败。

## 6. 独立审查与处理

规划期三轮（见 `docs/QINGYAN_VIS-1_HANDOFF.md` §5）。实现后另起一次独立代码审查：只给任务书、spec 增量与 diff，不给 design。结论与处理如下：

| # | 级别 | 问题 | 处理 |
|---|---|---|---|
| 1 | major | 百分号编码的路径段可绕过门表（Next 生产环境按解码后的路径查静态路由），如会计经 `/projects/%69ntelligence` 进项目情报 | 原样与解码一次后的路径都须放行，解码失败不放行；补 spec 要求与 7 条测试（design D16） |
| 2 | minor | 中间件直接信 `activeOrgId`，被移出 / 企业归档时与侧栏选的企业不同 | 当前企业按 `resolvePreferredOrgId` 对非平台管理员的选法只读解析（可用企业 = active 成员 ∧ 未归档）；纯函数 `pickGateOrgId` 有测试 |
| 3 | minor | 「项目成员也放行」没要求模块 | 新增只做门条目 `route-project-member`（模块 + 成员身份）；梦馨项目成员不进项目详情有测试 |
| 4 | minor | 岗位键解析失败静默且结果被缓存 30 秒；预取并发重复取数 | 记日志、降级结果不缓存、同键并发合并；`createRouteGateLoader` 依赖可注入，用假依赖测 |
| 5 | minor | 任务书验收里安装工的 `/service-inbox`、`/knowledge` | Q1 已拍板按推荐（1a 照侧栏），不改 |
| 6 | minor | `marketing-middleware-access.test.ts` 失效；缓存测试偏同义反复；无编码 / 大写 / 双斜杠测试 | 测试改为新口径并注册；加载器行为测试、编码 / 大写 / 双斜杠测试已补 |
| 7 | nit | Vercel 可能把 `/x.prefetch.rsc`、`/x.segments/…` 交给中间件，被当静态文件放过 | RSC / 预取变体先还原为页面路径再判定；测试覆盖；合并后在 Preview 上核一次 |
| 8 | nit | 无窗饰模块企业的管理层失去 `/install` | 不改：安装是窗饰功能 |

## 7. 与任务书的偏差（design「审核关注点」，均按推荐执行）

- Q1：收件箱 / 知识库照侧栏现状，安装工仍可进。
- Q2：门放在 Node runtime 中间件，不在 `(main)/layout.tsx`（夹具实测：layout 软导航不重渲染，`loading.tsx` 之下的门先吐骨架）。
- Q3：对象详情页放行面宽于列表页。
- Q4：所有企业都生效；梦馨是岗位模式，只持 `trade_rep` 的外贸业务员失去营销工作区，Cathy 不受影响。
- Q5：Miki 在 `sunny.json` 带 `owner`，`/bids` 放行；验收以绑定为准。
- Q6：白名单比任务书宽（`/`、`/tasks/**`、`/settings` 索引、两个微信页）。
- Q7：会计与出单的侧栏快照变化（判断点 3 的直接结果）。
- Q8：API 层的 `canAccessMarketingWorkspace` 与中间件 `/api/marketing/**` 分支保留（API 在任务书 Out of scope）；页面层按平台角色拦截的残留为零。
- Q9：`inventory/fabric-stock-access` 按「接口」理解，Lynn 的 `/inventory` 页面 302。
- Q10：Bob 作为管理层底栏保留招投标（按判断点 3）。

## 8. 已知仍会弹回的站内链接（留给 VIS-1b / 1c 收掉链接本身）

- 工艺单详情里的「维修单」链接对销售（`blinds-orders/[id]/page.tsx:721`）。
- 工艺单详情 / 编辑页回列表的链接与删除后跳转对销售（`blinds-orders/[id]/page.tsx:300,316,355`、`edit/page.tsx:70`）。
- 手机底栏「AI」页签 → `/capabilities` 对出单与无岗位成员（`mobile-tab-bar.tsx:316-321`）。
- 数字员工工作台「客户」「创建报价」按钮对非销售岗位（`assistant/digital-employee-workbench.tsx:78,285`）。
- `/settings` 索引页上无条件显示的「邮箱绑定」卡片对安装工、会计等（`settings/page.tsx:235`，VIS-1c）。
- 头部全局搜索的项目结果（`header.tsx:190`，VIS-1c）。
- 首页岗位卡 → `/revenue`、`/ai-activity`（VIS-1b）。
- 招投标交接 → `/ops/**`、微信推送里的 `/agent-trace`：今天已被页面门弹回，行为不变。

## 9. 合并前置与生产核对清单

合并前（Lucas）：
- 把 `config/positions/sunny.json` 的 9 个 `TODO:<姓名>` 填成真实邮箱并跑岗位绑定，否则无岗位成员敲业务 URL 都会落 `/tasks`。
- PR 的 Vercel Preview 部署必须成功：中间件改为 Node runtime 并打进了 Prisma。

合并后在生产用真实账号核对（VIS-1e 合并后可改用岗位预览）：
1. Lynn 敲 §3 表里的 URL，302 目标与表一致；从报价单点开工艺单正常；`/tasks?open=…` 正常。
2. Lynn 在 `/sales/home` 点任一指向 `/projects` 的站内链接，落 `/sales/home`，不出现项目页内容（spec「站内导航同样判定」）。
3. 安装工：`/marketing/employee` → `/install`；`/sales/calendar` 正常。
4. Bob / Miki / Bill（都带 `owner`）：`/sales/analytics` 有数据、不出现「仅管理员」；`/revenue`、`/trade/prospects` → `/`。
5. 只持 `accounting` 的账号若存在：`/bids`、`/projects/intelligence` → `/accounting`；`/accounting` 四页签正常。
6. Lucas（super_admin）：所有页面照旧，包括别家企业的成员页。
7. 在 Preview 上用浏览器开发者工具看一次预取请求：路径形如 `/x.prefetch.rsc` 或 `/x.segments/…` 时，被拦的入口不返回页面载荷（审查 #7）。
8. Vercel 日志里看中间件耗时，写回本报告。

## 10. 已知局限

- Next 16 对 `middleware.ts` 打弃用告警（建议改名 `proxy.ts`），本期不改名。
- 判定滞后最多 30 秒（spec「判定时效」）；切换企业立即生效。
- 路由门只管页面入口；接口仍按键与成员身份判定（任务书 Out of scope）。
- `/display`、`/quote/[token]`、`/sales/share/visualizer/[token]` 等免登录页不在门内。
