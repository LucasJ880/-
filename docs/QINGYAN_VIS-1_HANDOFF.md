# VIS-1 可见性收口 · 交接（HANDOFF）

> 任何新会话从这里进。先读本文件，再按「下一步」执行，不凭记忆重写。本文件只记录**已核对过的事实**；未核对的写明「未核对」。

| 项 | 值 |
|---|---|
| 最后更新 | 2026-11-08（VIS-1a 四件套已产出并经三轮核对，见 §5；`openspec validate --strict` 通过；**待审核，未 apply**） |
| 任务书 | `docs/QINGYAN_VIS-1_VISIBILITY_TASKBRIEF.md`（判断点 1–7 已拍板，见「拍板结果 · VIS-1」） |
| 主线状态 | `docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` → Phase V（VIS-1a～1e 五行，状态全 `[ ]`） |
| 进行中的 change | `openspec/changes/vis-1a-route-gate/`（proposal / specs / design / tasks；tasks 7 条，全部未勾） |
| 另一个未归档 change | `rfq-tracking-notify`（T-1，#391 已合并，归档小 PR 未做；不属本线，TASKFLOW 已把 T-1 从 `[G]` 修为 `[x]（#391；待 archive）`） |
| 工作分支 | `claude/vis-1-taskflow-proposal-918h26` |
| OpenSpec CLI | 未装进依赖：`npm i -g @fission-ai/openspec@1.15.0`（或 `npx -y @fission-ai/openspec@1.15.0 <cmd>`），命令前加 `OPENSPEC_TELEMETRY=0` |
| 运行环境 | 云容器默认 Node 22（`.nvmrc` 要求 24）。仓库不带 `node_modules`：`npm ci --ignore-scripts` 后**必须** `npx prisma generate`，否则 `residual-reads` / `ops-access` 等测试报 `Cannot find module '.prisma/client/default'`。本地 `.env` 直连生产库，不在本地起应用 |

---

## 0. 下一步

1. **审核 VIS-1a 四件套**（Claude chat / Lucas）。重点看 design 末节「审核关注点」Q1–Q9，这些地方偏离或补充了任务书。最要紧的四条如下，Q5 见下面第 3 步：
   - **Q1**：收件箱（`/service-inbox`）与知识库（`/knowledge`）对安装工等岗位是否隐藏、用哪组键。任务书验收要安装工 302，但这两项当前对所有非纯销售岗位都在侧栏里，任务书没给岗位键。默认：1a 照侧栏现状不动。
   - **Q2**：门的位置从任务书写的 `(main)/layout.tsx` 改为 Node runtime 中间件。夹具实测见 §2。
   - **Q3**：对象详情页（`/blinds-orders/[id]`、`/projects/[id]`、`/sales/customers/[id]`、`/capabilities/approvals/**`）的放行面宽于列表页，避免销售、运营、招投标被自己的站内链接或通知弹回。
   - **Q4**：路由门对所有企业生效。**梦馨是岗位模式，不是旧模式**（`hasPositionTemplates("home_textile_trade_v1") === true`，见 `docs/QINGYAN_PERM-6b_REPORT.md`）。后果：梦馨只持 `trade_rep` 的外贸业务员失去营销工作区，Cathy（`owner` + `trade_rep`）不受影响。
2. 审核通过后：`/opsx:apply vis-1a-route-gate`。按 tasks.md 顺序做，开工先跑 10 个受影响测试记基线（§3）。
3. 合并前置（Lucas）：`config/positions/sunny.json` 的 9 个 `TODO:<姓名>` 占位填成真实邮箱并跑岗位绑定（第 5 行的 `TODO:` 是说明文字，不算）。
   - 同一文件显示 Bob = `owner` + `fulfillment_drapery`，Bill = `owner` + `bids` + `fulfillment_vinyl`，**Miki = `owner` + `pricing_lead` + `accounting`**。
   - 任务书验收把 Miki 当作只持 `accounting` + `pricing_lead`，写了「`/bids` 302」「审批中心不见 `tender.*`」；按这份绑定，Miki 是管理层，`/bids` 会放行。
   - 这是验收数据与岗位绑定不一致，不是门的问题，见 design「审核关注点」Q5。
4. VIS-1a 合并并归档后再 `/opsx:propose vis-1b-home-and-shell`。§4 列了调研中已发现、属于 1b–1e 的输入。

## 1. 已核对的现状（2026-11-08）

- `(main)` 共 163 个 `page.tsx`；`(main)` 外 6 个（`(auth)/login`、`(auth)/register`、`(auth)/select-org`、`display`、`quote/[token]`、`sales/share/visualizer/[token]`）。
- 现有门：57 个页面有硬门（41 个经中间层 layout，16 个页面自带），12 个只在接口 403 后显示错误，94 个除登录外无门。`/ai-activity` 无任何门。`/sales/analytics` 只在客户端认 `isSuperAdmin`（`page.tsx:133-143`）；它的两个接口本身按键判定（`customer-matrix` 用 `sales.analytics.read`，`reps` 要求组织级 `sales.customer.read`）。
- 页面自带的服务端门（`bids`、`accounting`、`ops/**`、`install/**`）都在 `(main)/loading.tsx` 的 Suspense 之内，重定向前骨架已经吐出。
- 侧栏判定输入来自 `/api/auth/active-org`（有行业包模块兜底 `withIndustryPackModules`、有 `workspaceIds`）。服务端页面用的 `resolveWorkspaceContextFromCookies` 两者都没有，两份输入不一致。
- 岗位键（`mergedProfileBindings(WINDOW_COVERING_INDUSTRY_PACK, p)` 的 ALLOW 键）要点：
  - `owner`：持 `trade.read/manage/settings.manage`、`project.read`、`sales.analytics.read`、`operations.read`，**不持** `project.create/update`。
  - `sales_rep`（系统模板）持 `sales.analytics.read`、`sales.order.create`。
  - `accounting` 持 `project.read`、`install.task.assign`、`install.balance.confirm`、`sales.analytics.read`。
  - 三个出单岗位持 `project.read`、`orders.fulfillment.read`、`install.task.read`。
  - `installer` 只有 `install.task.read/update`、`install.window.complete`。
  - `bids` 持 `project.create/update`。
- 位置模式侧栏的公共项（`position-nav.test.ts` 的 `COMMON`）含 `work-inbox`（收件箱）、`mgmt-knowledge`（知识库）、`work-ai-jobs`、`work-assistant`、`mgmt-wechat`，所以安装工、会计、出单、无岗位成员都看得见收件箱和知识库（Q1 的来源）。
- 站内深链（由 Explore 代理清点，关键几条已逐行核对，见 design D4 表）：
  - 销售会被带进 `/blinds-orders/[id]`：报价单 `quote-sheet/page.tsx:2147`、客户页 `orders-list.tsx:22`、订单阶段 / 安装 / 维修通知。
  - 招投标与运营会被带进 `/capabilities/approvals`（两个工作台 shell、RFQ 抽屉、运营看板）。
  - 运营会被带进 `/projects/[id]`（交付项目详情、运营项目查询）。
  - 销售日历与 Google OAuth 回调会落到 `/settings`。
  - 任务通知会落到 `/tasks?open=`。
- 通知跳转只走 `src/lib/notifications/href.ts` 的 `notificationHref()`；Notification 上存的 `metadata.href` 无人读取。
- `src/lib/permissions-client.ts` 的 `canAccessModule`（一张旧的路由 → 平台角色表）无任何调用方。
- **梦馨（`home_textile_trade_v1`）是岗位模式**；真正走旧模式（平台角色规则）的只有无行业包的企业。梦馨 `owner` 模板含 `organization.dashboard.read`、`operations.read`、三个外贸键；`trade_rep`（系统模板）只有 `trade.read`、`trade.manage`，进入首页后落 `/tasks`。梦馨模块是 `DEFAULT_MENGXIN_MODULES`（无 `bids`、`window_covering`）。
- `resolvePreferredOrgId` 很重：会列出全部成员关系并计数，对 super_admin 一次载入最多 200 家企业，还可能写回 `activeOrgId`，不能放进中间件每个请求跑。轻量读法见 `/api/auth/me`：`activeOrgId`，为空时取唯一成员关系。
- 中间件 `matcher` 现在按图片扩展名整体排除，`/projects/a.png` 这类路径连登录检查都跳过（既有问题，1a 一并修）。
- `public/sw.js` 对页面导航离线时回落缓存（`VERSION = "qingyan-v3"`）。
- `scripts/public-route-auth-contracts.test.ts` 直接 import 并调用 `middleware`；`notification-href.test.ts` 读中间件源码，断言登录回跳。
- 仓库无 `"use server"`（无 server actions），无 `prefetch={true}`，无 `staleTimes` 设置；`public/` 下文件全部带扩展名。

## 2. 夹具实测（Q2 的依据，可复现）

在 scratchpad 建最小 Next 16.2 应用：`node_modules` 软链到本仓库，`next.config.mjs` 设 `typescript.ignoreBuildErrors`。用 `node node_modules/next/dist/bin/next build --webpack && … next start -p 3917` 起服务。

- `app/(main)/layout.tsx` 渲染 `{gate}{children}`，另有 `app/(main)/loading.tsx`，页面 `home` / `open` / `secret` / `secret/sub` 都是 `"use client"`。
- 方案一：`app/(main)/@gate/[...path]/page.tsx` 对 `/secret` 调 `redirect("/home")`。结果：`curl -i /secret` 为 **200**，正文含 `SECRET-CONTENT`，末尾才有 `<meta http-equiv="refresh">`。`loading.tsx` 也包住了 `@gate` 槽。**否决**。
- 方案二：`middleware.ts` 加 `export const config = { runtime: "nodejs", matcher: [...] }`，里面用 `node:fs` 读文件证明跑在 Node 上，对 `/secret*` 做 `NextResponse.redirect(url, 302)`。结果：
  - 硬加载与带 `RSC: 1` 的请求都直接 **302** `Location: /home`，正文无页面内容。
  - Playwright 从 `/home`、`/open` 点链接进 `/secret`，都落在 `/home`；`MutationObserver` 全程没看到 `SECRET`。
  - 预取请求同样经过中间件，且中间件里看不到预取头，无法区分（D3 缓存的来由）。
  - 构建输出 `ƒ Proxy (Middleware)`，并有 `middleware` 文件名弃用告警。

## 3. 测试基线（VIS-1a 受影响，2026-11-08，Node 22）

| 测试 | 通过数 |
|---|---|
| `src/lib/navigation/__tests__/position-nav.test.ts` | 86 |
| `src/lib/navigation/__tests__/navigation-ia.test.ts` | 63 |
| `src/lib/navigation/__tests__/navigation-workspace.test.ts` | 34 |
| `src/lib/rbac/__tests__/workspace-policy.test.ts` | 26 |
| `src/lib/authorization/__tests__/residual-reads.test.ts` | 76 |
| `src/lib/marketing/__tests__/route-access.test.ts` | 3 |
| `src/lib/operations/__tests__/ops-access.test.ts` | 21 |
| `src/lib/navigation/__tests__/wechat-entry-nav.test.ts` | 19 |
| `scripts/public-route-auth-contracts.test.ts` | 164 |
| `src/lib/notifications/__tests__/notification-href.test.ts` | 91 |

`openspec validate --specs --strict` 在 main 上已有 4 个失败（`accounting/workspace`、`authorization/position-catalog`、`inventory/fabric-stock-access`、`sunny/process-order-autogen`），非本线引入。在 scratchpad 拷贝里对本 change 做 archive 演练：合并后新增 / 修改的 4 份规格全部通过，失败数仍是这 4 个。

## 4. 留给 VIS-1b～1e 的已知输入

- 1b：
  - 门上线后仍会被弹回的站内链接要收掉，例如工艺单详情里的「维修单」链接（`blinds-orders/[id]/page.tsx:721`）对销售。
  - `mobile-tab-bar.tsx:249` 的「招投标」底栏用 `canAccessBidWorkspace`，1a 改了这个函数的岗位模式口径，底栏会随之变化（会计 / 出单不再见），1b 再统一到侧栏判定。
  - Lynn 在 1b 之前仍能进 `/workforce`、`/assistant`。
- 1c：
  - `/settings` 索引页对所有人放行（1a 白名单），卡片可见性归 1c。
  - 系统 `sales_rep` 模板持 `sales.analytics.read`，Lynn 能进 `/sales/analytics`（本人范围数据）；如不希望，属岗位模板问题（PERM 线），不是门的问题。
- 1d：审批中心 `/capabilities/approvals/**` 在 1a 对全部企业成员放行（列表本就按本人提交 / 被指派过滤），可见集合由 1d 收口。
- 1e：预览 cookie 要接到 `src/lib/navigation/context-server.ts`（1a 新增的共享判定输入），中间件与侧栏就会一起变。

## 5. 核对记录（2026-11-08）

| 轮次 | 做法 | 结果 |
|---|---|---|
| 1 | 规划期探针：用真实注册表与 `isNavItemVisible` 模拟门表，覆盖 Sunny 各岗位、梦馨两种身份与无行业包抽样，算出放行 / 302 矩阵 | 163 页全覆盖；落地页全部放行、无环；spec 每条可算的场景与矩阵一致 |
| 2a | 独立审查（规则 / 一致性），1 blocker、8 major、11 minor | 全部改掉，主要有：302 目标改为首页最终落地；补取输入失败、查询串、`/monitoring`；安装工日历；网站预约；项目成员；项目平台管理员子页；底栏招投标与营收规格声明；每条要求都有测试场景；Q6–Q9 |
| 2b | 独立审查（代码事实 / 技术），5 major、6 minor | 全部改掉，主要有：梦馨是岗位模式；中间件不调 `resolvePreferredOrgId`；页面 → 规则快照；super_admin 不受门限制；停用用户回 `/login`；静态文件判法收窄并改 `matcher`；SW 版本；补两份读中间件的既有测试 |
| 3 | `openspec validate --strict`；scratchpad 拷贝里 archive 演练（RENAMED + MODIFIED 合并正常）；探针复算新规则；再起一次只查「修订引入的问题」的独立核对 | 见提交记录与本节后续更新 |

夹具与探针脚本都在会话 scratchpad，不进仓库。复现方法见 §2；探针逻辑就是 tasks 2.1 要写进 `route-gate.test.ts` 的内容。
