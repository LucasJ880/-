# VIS-1 可见性收口 · 交接（HANDOFF）

> 任何新会话从这里进。先读本文件，再按「下一步」执行，不凭记忆重写。本文件只记录**已核对过的事实**；未核对的写明「未核对」。

| 项 | 值 |
|---|---|
| 最后更新 | 2026-11-08（VIS-1a 四件套已产出，`openspec validate --strict` 通过，经两轮独立审查修订；**待审核，未 apply**） |
| 任务书 | `docs/QINGYAN_VIS-1_VISIBILITY_TASKBRIEF.md`（判断点 1–7 已拍板，见「拍板结果 · VIS-1」） |
| 主线状态 | `docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` → Phase V（VIS-1a～1e 五行，状态全 `[ ]`） |
| 进行中的 change | `openspec/changes/vis-1a-route-gate/`（proposal / specs / design / tasks；tasks 7 条，全部未勾） |
| 另一个未归档 change | `rfq-tracking-notify`（T-1，#391 已合并，归档小 PR 未做；不属本线，TASKFLOW 已把 T-1 从 `[G]` 修为 `[x]（#391；待 archive）`） |
| 工作分支 | `claude/vis-1-taskflow-proposal-918h26` |
| OpenSpec CLI | 未装进依赖：`npm i -g @fission-ai/openspec@1.15.0`（或 `npx -y @fission-ai/openspec@1.15.0 <cmd>`），命令前加 `OPENSPEC_TELEMETRY=0` |
| 运行环境 | 云容器默认 Node 22（`.nvmrc` 要求 24）。仓库不带 `node_modules`：`npm ci --ignore-scripts` 后**必须** `npx prisma generate`，否则 `residual-reads` / `ops-access` 等测试报 `Cannot find module '.prisma/client/default'`。本地 `.env` 直连生产库，不在本地起应用 |

---

## 0. 下一步

1. **审核 VIS-1a 四件套**（Claude chat / Lucas）。重点看 design 末节「审核关注点」Q1–Q5，这五处偏离或补充了任务书（Q5 见下面第 3 步）：
   - **Q1**：收件箱（`/service-inbox`）与知识库（`/knowledge`）对安装工等岗位是否隐藏、用哪组键。任务书验收要安装工 302，但这两项当前对所有非纯销售岗位都在侧栏里，任务书没给岗位键。默认：1a 照侧栏现状不动。
   - **Q2**：门的位置从任务书写的 `(main)/layout.tsx` 改为 Node runtime 中间件。夹具实测见 §2。
   - **Q3**：对象详情页（`/blinds-orders/[id]`、`/projects/[id]`、`/sales/customers/[id]`、`/capabilities/approvals/**`）的放行面宽于列表页，避免销售、运营、招投标被自己的站内链接或通知弹回。
   - **Q4**：路由门对梦馨（旧模式）同样生效。
2. 审核通过后：`/opsx:apply vis-1a-route-gate`。按 tasks.md 顺序做，开工先跑 8 个受影响测试记基线（§3）。
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
