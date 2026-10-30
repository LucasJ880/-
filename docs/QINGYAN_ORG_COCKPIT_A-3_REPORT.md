# A-3 完成报告：首页替换为岗位视图（openspec change `org-cockpit-home`）

任务书：`docs/QINGYAN_ORG_COCKPIT_FDE_TASKBRIEF.md` §A-3
分支：`claude/org-cockpit-home`（叠在 A-2 `claude/org-cockpit-read-model` 之上；PR base = A-2 分支，A-2 合并后改回 `main`）
OpenSpec change：`openspec/changes/org-cockpit-home/`（proposal / `specs/cockpit/home-view/spec.md` / design / tasks，`openspec validate --strict` 通过）

---

## 1. 做了什么

| 文件 | 内容 |
|---|---|
| `src/app/(main)/page.tsx`（改） | 只把渲染的客户端组件从 `ManagementDashboardClient` 换成 `OrgCockpitHome`；登录检查与非管理层重定向（`resolveHomeRedirect`）原样保留 |
| `src/components/cockpit/org-cockpit-home.tsx`（新） | 客户端容器：首屏并发 `GET /api/cockpit/posts` 与 `GET /api/cockpit/timeline`，各自兜底（状态码、JSON 解析、网络错误、30 秒超时）、谁先到谁先渲染；"加载更多"按 `nextCursor` 追加；刷新；两块各自重试；页面时钟以服务端 `generatedAt` 为基准、每 60 秒走一次 |
| `src/lib/cockpit/home-state.ts`（新） | 取数状态的纯 reducer：每块只接受最近一次请求的响应；"加载更多"只在列表仍停在发请求那一页时拼接（按 id 去重），刷新 / 重试替换列表后旧游标结果丢弃；鉴权类错误收起整页、服务端错误只影响出错的那块 |
| `src/components/cockpit/org-cockpit-view.tsx`（新） | 无 hooks 的展示组件：页头（更新时间 / 时区 / "心跳与自动化次数为平台级" / 刷新）→ "等你拍板 N 件"横幅 → 七张岗位卡片 → company.log；加载骨架；需选择组织 / 无组织 / 无权限 / 账号停用 / 登录过期 / 服务端错误六种错误态 |
| `src/lib/cockpit/presentation.ts`（新） | 纯函数：健康度标签与色调、KPI 格式化（计数千分位 / 比率一位小数向下取 / 百分比字符串 / 分钟 / 得分）、窗口口径、KPI 状态文案、相对时间、`serverNow`、`errorKindFrom`、操作者、截断计数、岗位名、异常自动化排序 |
| `src/lib/cockpit/__tests__/presentation.test.ts`（新） | 59 条断言（错误文案对照 `workforceOrgFailureHttp` 与 `guards.ts` 原文核对） |
| `src/lib/cockpit/__tests__/home-state.test.ts`（新） | 21 条断言：首屏 / 翻页 / 去重 / 失败重试，以及刷新与加载更多的四种交错顺序 |
| `src/components/cockpit/__tests__/org-cockpit-view.test.tsx`（新） | 78 条断言：`renderToStaticMarkup` 夹具渲染 + 首页与容器源码静态断言 |
| `scripts/test-all.sh` / `scripts/test-ci-unit.sh` | 各注册 3 条 |

页面上每个元素的数据来源：

| 区块 | 字段（A-2 响应） | 跳转 |
|---|---|---|
| 页头 | `generatedAt`、`timezone`、`heartbeatScope` | — |
| 配额提示 | `quotaHit` | — |
| 等你拍板 N 件 | `waitingForYou.total / truncated / unattributed / items[≤5]` | "去审批" → `/capabilities/approvals`；每条 → 条目自己的 `href` |
| 岗位卡片 × 7 | `posts[]` 的 `name / health / heartbeat / nextDueAt / kpi / pendingApprovals / needsYou / actions7d / automations` | 整卡 → `nav`（`/revenue`、`/bids`、`/operations/growth`、`/service-inbox`、`/projects`、`/ai-activity`、`/operations/dashboard`） |
| company.log | `items[]` 的 `at / post / actor / actorName / summary / href`；`nextCursor` | 有 `href` 的条目可点 |

## 2. 怎么验的

| # | 验证 | 结果 |
|---|---|---|
| 1 | 三个新测试单独运行 | presentation 59/59、home-state 21/21、渲染 78/78 |
| 2 | 局部 `tsc`（`src/lib/cockpit/**` + `src/components/cockpit/**` + 首页） | 0 错误 |
| 2b | `bash scripts/check-test-registry.sh` | 只列出 main 上既有的 2 个 trade 测试（与本分支无关） |
| 3 | `npm run typecheck`（全量） | 退出 0 |
| 4 | `npm run lint:baseline`；新文件 `npx eslint` | PASS（无新增 error，相对基线减少 14 处）；新文件 0 问题 |
| 5 | `npm test` 对比 `origin/main` 基线 | 基线 411/425 → 本分支 419/433：新增 8 项即 A-1（1）+ A-2（4）+ A-3（3）的测试，全 PASS；14 项失败清单与基线逐条一致（环境性既有问题，见 A-1 报告） |
| 6 | `npm run test:ci` | `CI unit subset PASS`，含 8 个驾驶舱测试 |
| 7 | `git diff --stat origin/main -- prisma/ vercel.json` | 空 |
| 8 | `openspec validate org-cockpit-home --strict`；`/opsx:verify` | valid；`/opsx:verify`：tasks 8/8，7/7 requirement、17/17 scenario 有测试覆盖，design D1–D6 一致，无 CRITICAL / WARNING |
| 9 | 视觉核对（见 §3） | 五档宽度无横向滚动，最小点击高度 44px |

## 3. 视觉核对

容器里没有数据库，无法登录看真页面。做法：用 A-2 响应形状的夹具离线渲染 `OrgCockpitView`，用 `@tailwindcss/postcss` 编译项目自己的 `src/app/globals.css`（真实主题 token），外面套一个与 `AppShell` 一致的 240px 深色侧栏和 `max-w-7xl px-6` 内容区，Playwright 截图。截图在会话 scratch 目录，不入库。

| 视口宽度 | 内容区约 | 卡片列数 | 结论 |
|---|---|---|---|
| 1440 | 1150px | 3 | 一屏看到页头、横幅、第一行卡片 |
| 1280 | 990px | 3 | 同上；KPI 三列、标签不截断 |
| 1024（iPad 横屏） | 740px | 2 | 卡片宽约 360px，KPI 三列宽松 |
| 820（iPad 竖屏） | 530px | 1 | 单列整宽卡片；侧栏收起到 60px 时内容区约 710px → 两列 |
| 390（手机，无侧栏） | 358px | 1 | 横幅条目标题截断、岗位与时间右对齐；时间线时间 / 岗位 / 操作者一行、摘要另起一行 |

审查中发现并修掉的两处视觉问题：
- 第一版按视口断点排列（`sm:grid-cols-2 xl:grid-cols-3`），没算侧栏：1280 宽时实际内容区不到 1000px 却排三列，820 宽时内容区 530px 却排两列、每个 KPI 只有约 70px。改为 container query（按内容区宽度）。
- `globals.css` 在 768–1024px 视口把 `.grid-cols-3` 用 `!important` 改成两列，KPI 行会被拆成 2+1。KPI 行和三列网格都改用任意值写法 `grid-cols-[repeat(3,minmax(0,1fr))]`，渲染测试断言不再出现 `grid-cols-3`。

## 4. 与任务书的偏差（请 GATE 逐条确认，详见 proposal）

1. **"等你 N 件"跳 `/capabilities/approvals`，不跳 `/inbox`**：`/inbox` 是快速捕获页。GATE-A 第 3 条"数字与 `/inbox` 一致"相应改为"与 `/capabilities/approvals` 待我审批 + `/workforce` 需要你一致"。
2. **心跳与自动化次数标注平台级**：页头统一注明；卡片上 AI 运行数（本组织）与平台自动化运行数分开写、不相加。
3. **旧首页组件不在本 change 删除**：`src/components/dashboard/**` 变成未引用代码，已排队清理任务。原首页的简报 / 日历 / 任务入口在 `/assistant`、`/sales/calendar`、`/tasks` 仍可用。
4. **Lighthouse 首屏请求数**：容器内无法登录跑 Lighthouse，改为源码静态断言首屏只调用两个接口；Lighthouse 列为 staging 验证项。
5. **【GATE 决策项】主动提醒扫描随旧首页停止**：旧仪表盘的 AI 建议组件在首页挂载时及每 5 分钟 `POST /api/proactive/scan`（为当前用户生成主动提醒、写通知、执行该用户开启的自动动作），是这个接口唯一的调用方；定时任务 `/api/cron/proactive-scan` 只覆盖开了自动化偏好的用户（每次最多 100 人）。新首页按规格只读，不再发这个 POST，**所以没开自动化偏好的管理层不再收到主动提醒通知**。这与 GATE-A 第 4 条"任意既有页面行为零变化"有出入（代码没动，但触发源没了）。可选：
   - 接受：在本报告记录即可；
   - 后续 change：让定时任务也为管理层同步提醒通知（只写通知、不执行自动动作）。

## 5. 交叉审查（独立审查代理，只给代码与规格）

| # | 级别 | 发现 | 处理 |
|---|---|---|---|
| B1 | 阻塞 | 旧首页每 5 分钟 `POST /api/proactive/scan`，替换后未开自动化偏好的管理层不再收到主动提醒 | 不在只读页面补发；proposal 偏差 5、本报告 §4 列为 GATE 决策项，Impact 中"零变化"的说法改正 |
| S1 | 应修 | 刷新时还在路上的"加载更多"会把旧游标的条目拼到新列表 | 岗位总览 / 时间线各一个代数计数器，过期响应丢弃；渲染测试静态断言 |
| S2 | 应修 | `Promise.all` 里一个接口 JSON 解析失败会把两块都打成错误 | 每个接口单独兜底（`getJson`），各自到达各自渲染 |
| S3 | 应修 | 时间线的"重试"会重载整页 | 独立 `onRetryTimeline`，只重载时间线 |
| S4 | 应修 | spec 写"每张卡注明平台级"、异常列表口径与实现不一致 | spec 改为页头注明；异常列表写明"失败 / 迟到 / 未运行过，最多 3 个" |
| S5 | 应修 | "7 天 N 次动作"把本组织 AI 运行数和平台级自动化运行数相加 | 拆成"AI x 次 · 平台自动化 y 次"，计数千分位 |
| S6 | 应修 | 列数按视口算、没算 240px 侧栏 | container query；KPI 标签两行截断 + `title`；带侧栏重新截图 |
| S7 | 应修 | 错误映射写在组件里无法单测；夹具顺序与注册表一致，测不出"组件自行排序" | `errorKindFrom` 纯函数 + 测试；渲染测试用倒序夹具断言卡片跟随接口顺序 |
| S8 | 应修 | 相对时间用客户端时钟，偏差时会出现"x 分钟后"；页面停留后"更新于"不变 | `serverNow`（以 `generatedAt` 为基准）+ 每 60 秒走一次 |
| — | 小 | "加载更多"失败无提示；401 / 无组织没有专门提示；刷新按钮上 `sm:min-h-0` 被 `globals.css` 的 `button{min-height:44px}` 覆盖（死代码）；横幅条目无悬停底色；健康度标签会被挤换行；岗位区无读屏标题、加载中无 `aria-busy`；比率取整把 99.6% 显示成 100%；"去审批"用 `text-white` 而非 `--on-accent`；design D4 横幅底色描述与实现不符；`data-testid` 进了产品代码 | 全部修正（`data-testid` 换成 `data-waiting-count`） |
| — | 不改 | 用 localStorage 里的组织与响应 `orgId` 比对给出不一致提示 | `/api/cockpit/*` 按数据库活动组织解析，与 `/workforce` 同口径；组织切换器同时写两处，不一致只在异常情况下出现，staging 验证切换组织后的表现 |
| — | 记录 | KPI 标签"首响中位（分钟）"的单位与格式化后的"x 分钟 / x 小时 y 分"重复；"中标率"口径来自投标财务模块；A-2 时间线审计条目摘要显示原始动作码（如 `PENDING_ACTION_APPROVED`） | A-1 注册表 / A-2 读模型的文案，不在本 change 改；列为后续小改 |

第二轮（只审本轮修复的 diff，另起审查代理）：无阻塞项。

| # | 级别 | 发现 | 处理 |
|---|---|---|---|
| R2-1 | 中 | 刷新在途时点"加载更多"：刷新响应先到、旧游标响应后到，代数没变 → 旧第 2 页拼到新第 1 页后面（新增事件会漏、再点会出现重复 id） | 状态转移抽成纯 reducer `home-state.ts`：只有列表仍停在发请求那一页时才拼接，并按 id 去重；四种交错顺序做成表驱动测试 |
| R2-2 | 中低 | 岗位总览 500（如 KPI 超时）时整个时间线也被收起，"重试"连时间线一起重置，与 spec"各自独立"不符 | 服务端错误只占岗位区；鉴权类错误才收起整页；两块各自重试 |
| R2-3 | 低 | 首屏的 `load` 晚于刷新结束时提前清掉"刷新中"，按钮提前可点 | `loadGen` 编号，只有最近一次刷新完成才清；请求加 30 秒超时，不会永远转圈 |
| R2-4 | 低 | 容器测试只数源码字符串，带着 R2-1 也能通过 | 行为由 `home-state.test.ts` 覆盖；源码断言只核对容器确实走 reducer |
| — | 小 | design D3 比率口径过时；横幅计数无千分位；停用账号的 403 被说成"只对组织管理员开放"；时间线鉴权类错误给了无效的"重试"；"无组织"文案字面耦合；岗位总览未到时时间线用客户端时钟 | 全部修正（文案做成常量并在测试里对照原函数 / 源码；时间线先用自己响应的 `window.to` 作基准） |

审查同时独立确认了：Tailwind 4.2.2 实际生成 `@container` / `@2xl:` / `@4xl:` 任意值类且不受 `.grid-cols-3 !important` 影响、`--on-accent` 两套主题都有定义、错误映射与真实响应体一致、`serverNow` 偏差与回拨处理正确、比率格式化对 0–1 每个千分位都正确、hooks 规则与 StrictMode 双挂载无问题、无水合风险、不可能发出非 GET 请求。

## 6. staging 待验项（GATE-A）

- 以 `seed:org:sunny-home-deco` 组织管理员登录 `/`：一屏可见 7 个岗位、心跳时间与健康色；"等你 N 件"与 `/capabilities/approvals` 待我审批 + `/workforce` 需要你人工对账。
- Lighthouse / 浏览器网络面板：首屏只有两个 `/api/cockpit/*` 请求，没有非 GET 请求。
- 多组织用户：切换组织后刷新，岗位视图跟随切换。
- 非管理层（销售、运营等）打开 `/` 仍按原规则重定向。
- 偏差 5 的决策结果。

## 7. 已知限制

- 心跳与自动化次数是平台级（A-2 已知限制）；页面已注明。
- 页面不轮询：数据停在加载时刻，"更新于 x 分钟前"会随时间变旧，需手动刷新。
- 视觉核对是离线渲染，不含真实数据量下的表现（例如很长的岗位异常列表、很长的时间线摘要）。
