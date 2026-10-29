# 权限重设计 — 交接（HANDOFF）

> 任何新会话从这里进。先读本文件，再按"下一步"执行，不凭记忆重写。

| 项 | 值 |
|---|---|
| 最后更新 | 2026-10-28（会话 2：PERM-4b / 5b / 5a / 4c1–4c4 已合并并 archive；4c5 已合并并 archive（#298 / #299；含视觉方案跨企业泄露修复、写库闸门打开）；PERM-6 拆 6a / 6b / 6c，6a 已合并并 archive（#300 / #301）；6c 已合并并 archive（#302 / #303）；PERM-7 已合并并 archive（#305 / #306）；6b 已实施、PR #307 已开，**等 Lucas 确认已对梦馨跑 seed 后才合并**；7b（平台 admin 退役）已合并并 archive（#316 / #317）；2026-10-29 Lucas 已在生产改为 super_admin（SQL 查询确认）；现场续接见下一节；验收清单见文末） |
| 主线文档 | `docs/QINGYAN_PERMISSION_TASKFLOW.md`（状态列）、`docs/QINGYAN_PERMISSION_REDESIGN_DESIGN.md`（设计与已决定） |
| 任务书 | `docs/QINGYAN_PERM-1-2_POSITIONS_DISCOUNT_TASKBRIEF.md` |
| 工作分支 | 会话 1：`claude/youthful-davinci-8n1we3`；会话 2：`claude/amazing-goldberg-s89rlq`（每个 change 合并后从 main 重建同名分支） |
| OpenSpec CLI | 未装进依赖，用 `OPENSPEC_TELEMETRY=0 npx -y @fission-ai/openspec@1.15.0 <cmd>` |

## 现场续接（会话 2，2026-10-28，上下文压缩后从这里接）

用户授权："你负责合并和监测"——PR 绿灯即合并，archive 小 PR 同样合并；生产动作只写进验收清单，不代做。

| 项 | 状态 |
|---|---|
| 4c1 | #290 合并；archive #291 合并 |
| 4c2 | #292 合并；archive #293 合并（specs 新增 `navigation/position-based-visibility`，`authorization/position-catalog`、`accounting/workspace` 增量） |
| 工作方式 | 工作树 `/home/user/p4c`（本地分支 `local/perm-4c`，`node_modules` 软链主仓库）；推送 `git push -f origin local/perm-4c:claude/amazing-goldberg-s89rlq`；PR 用 merge 方式；开 PR 后订阅 + `send_later` 兜底 |
| 4c3 | **#294 合并；archive #295 合并**（tasks 8/8；typecheck / lint:baseline / test:ci / registry 453 / validate --strict 全绿；纯 36/36、隔离库 38/38，窗饰相关既有 e2e 全过）；报告 `docs/QINGYAN_PERM-4c3_REPORT.md`、残留清单 `docs/QINGYAN_PERM-4c3_RESIDUAL_ROLE_READS.md`；TASKFLOW `[G]`。4c4 已接着做 |
| 4c4 | **#296 合并；archive #297**（tasks 8/8；typecheck / lint:baseline / test:ci / registry 455 / validate --strict 全绿；纯 63/63、隔离库 17/17；相关目录 88 个测试文件 87 过、1 个需 DB）；方案：岗位派生平台角色 `src/lib/rbac/effective-platform-role.ts`（owner→boss、销售键→sales、运营键→operations、其余 user；super_admin/admin/trade 与旧模式原样），接入 `runAgent`/`runAgentStream`、AI 线程路由、微信、runtime-v2、supervisor、Muse（岗位模式忽略 org_owner）、晨报、AI 上下文、营销数字员工；报告 `docs/QINGYAN_PERM-4c4_REPORT.md`；TASKFLOW `[G]`。4c5 已接着做 |
| 4c5 | **#298 合并；archive #299 合并**（tasks 8/8；typecheck / lint:baseline / test:ci / registry 457 / validate --strict 全绿；纯 76/76、隔离库 13/13——同一隔离库测试在 main 上 9 败，含泄露复现；受影响目录 137 个测试 133 过、4 个为本地缺双租户种子）。内容：任务 / 运营项目 / 交接上下文注入岗位信号（`loadWorkspaceSignals`）；审批、营销工作区（layout + 15 个 GET 守卫）、微信绑定、入职清单、开关白名单用派生角色；`/api/auth/me` 加 `effectiveRole`；**视觉方案跨企业泄露已修**（`resolveVisualizerViewer`）；**写库闸门 `PLATFORM_ROLE_COLLAPSE_READY = true`**。报告 `docs/QINGYAN_PERM-4c5_REPORT.md`；TASKFLOW `[G]`。之后 Lucas 按残留清单"生产执行压扁"执行；下一阶段 PERM-6（外贸，任务书 `docs/QINGYAN_PERM-6_TRADE_TASKBRIEF.md`） |
| 6a | **#300 合并；archive #301 合并**（tasks 6/6；typecheck / lint:baseline / test:ci / registry 459 / validate --strict 全绿；纯 127/127、隔离库 27/27；受影响目录 89 个测试文件全过）。内容：外贸三键 + `trade_rep` 模板（`org_owner` 三键、`org_admin` 只设置键、窗饰 `owner` 三键）；旧模式平台 `trade` 兼容回退 / seed 自动绑 `trade_rep`；`src/app/api/trade/**` 110 处 `requireRole` → `requireTradePermission`（GET 读键、其余写键、通道入口三键任一 + `canManageTradeChannels`、发件设置 → 设置键、删除发件人 → super_admin）；`resolveTradeOrgId` 显式企业只给 super_admin（平台 admin 收回）；派生角色 `trade` 档；岗位模式外贸入口认 `trade.read`。报告 `docs/QINGYAN_PERM-6a_REPORT.md`；TASKFLOW `[G]`。6b 需梦馨人员与邮箱，用户 2026-10-28 定先做 6c |
| 6c | **#302 合并；archive #303 合并**（tasks 6/6；typecheck / lint:baseline / test:ci / registry 461 / validate --strict 全绿；纯 68/68、隔离库 23/23；受影响目录 102 个测试文件全过）。拍板三点全按推荐。内容：营收中心 13 个路由按外贸键（GET 读、POST 写、策略 PUT 设置 / GET 三键任一），平台 sales 不再进；新 `src/lib/trade/recipients.ts`——工作收件人 = 持外贸读写键、管理层收件人 = 管理层且持外贸键、默认询盘负责人 = 派生角色 trade / sales 最早成员；`managementOf` / `inquiry-sla` / `notifyInquiryMembers` / `resolveInquiryOwner` 接入；压扁范围加 `trade`；侧栏外贸布局按 `effectiveRole`；入职清单业务员认 `trade.manage`；残留清单 D2–D4 收口、新增 F 组。报告 `docs/QINGYAN_PERM-6c_REPORT.md`；TASKFLOW `[G]`。下一个 6b（需梦馨人员与邮箱） |
| 7 | **#305 合并；archive #306**（tasks 6/6；typecheck / lint:baseline / test:ci / registry 463 / validate --strict 全绿；纯 30/30、隔离库 35/35；受影响目录 83 个测试文件全过）。内容：共用绑定服务 `position-binding-service.ts`（脚本改调，行为不变）；`/api/organizations/[orgId]/positions`（只认 super_admin，单主体完整集合、dryRun、400 / 409 `LAST_OWNER_BINDING`、`via: "console"`）；企业详情页"岗位"一节；成员增删改改为 `requirePlatformSuperAdmin`（原 `requirePlatformAdmin` 放行平台 admin，与 spec 不一致）。报告 `docs/QINGYAN_PERM-7_REPORT.md`；TASKFLOW `[G]`，新增 PERM-7b 行 |
| 6b | **#307 合并（2026-10-29，用户"合并吧"）；archive #314**。Cathy `trade_rep` 已在生产用 SQL 补绑；`owner` 那段 SQL（Cathy、Lucas 绑老板）合并后于 2026-10-29 补执行，查询确认 Cathy = `owner, trade_rep`（tasks 5/5；typecheck / lint:baseline / test:ci / registry 465 / validate --strict 全绿；纯 42/42、隔离库 25/25；受影响目录 142 个测试文件 138 过、4 个为本地缺双租户种子）。内容：家纺外贸行业包 `home_textile_trade_v1` 加 `owner`（= 系统 `org_owner` 键 + 企业读 + 管理层信号），业务员用系统 `trade_rep`，梦馨进入岗位模式（判定代码未改）；绑定文件 `config/positions/mengxin.json`（Cathy → `trade_rep` + `owner`——生产上她是平台 boss，用户定保持老板级；Lucas → `owner`）；生产 SQL `docs/QINGYAN_PERM-6b_MENGXIN_SQL.md`；实施中补充 D5：`ensureDefaultPositions`，入驻 / 交接负责人 / 企业邀请码注册后落模板与自动绑、给指定负责人绑 `owner`（否则新家纺工厂全员 403，`onboarding-db.isolated` 曾因此失败）。报告 `docs/QINGYAN_PERM-6b_REPORT.md`（§4 上线顺序）；TASKFLOW `[G]` |
| 7b | **#316 合并（2026-10-29，用户"合并吧，Lucas 权限我之后改"）；archive #317**。**Lucas 已改 super_admin**（2026-10-29 Neon SQL Editor 执行 UPDATE，查询确认 `lucas@sunnyshutter.ca` = `super_admin` / `active`；重新登录生效）——跨企业访问、入驻控制台、诊断、新建企业、邀请码、企业详情页"岗位"一节随之恢复（tasks 8/8；typecheck / lint:baseline / test:ci / registry 475 / validate --strict 全绿；纯 46/46、隔离库 23/23；全量登记测试 479 条 470 过，9 个失败在 6b 基线上同样失败）。拍板全按推荐（用户 2026-10-28："按推荐方法去实施7B"）。内容：三个共用判定 + 客户端同名函数只认 `super_admin`（61 个调用方随之收口）；`platformTier`（super_admin → admin 档、admin → user）接入 `requireRole` / `canAccessModule` / 工具注册表 / AI 能力矩阵 / 推送默认 / 提示词；约 25 处手写判断改调共用判定；旧模式导航 `admin` 归一为 `user`；派生角色只保留 `super_admin`（admin、trade 按键）；Muse 名单去 admin；邀请码 / 用户修改不再签发 admin，历史 admin 邀请码注册得 user；压扁纳入 admin。既有测试按 D7 改构造 / 断言，逐个列在报告 §3。报告 `docs/QINGYAN_PERM-7b_REPORT.md`（§4 上线顺序）；TASKFLOW `[G]`。工作树 `/home/user/p7b`（本地分支 `local/perm-7b`） |
| 顺带发现 | 视觉方案跨企业泄露——**4c5 已修**（用户拍板并入；原任务卡已被用户从卡片启动，开 4c5 PR 前查过无并行 PR）；`sunny-process/autogen-db.isolated` 在 main 上失败（NO_BINDING）——已提任务卡，未处理 |

续接要点：
- 每个 change：propose → 用户审四件套 → apply → typecheck（`NODE_OPTIONS=--max-old-space-size=8192`）/ `lint:baseline` / `test:ci` / `check-test-registry.sh` / `openspec validate <change> --strict` → 报告 + TASKFLOW `[G]` + 本文件 → PR → 绿灯合并 → archive 小 PR（`[x]`）→ 合并。
- 每次合并后从 `origin/main` rebase 工作分支（`git stash -u` → `git rebase origin/main` → `git stash pop`）。
- 全量 `npm test` 基线：450/463，13 条既有环境性失败（无 DB 时）；起本地库后用 `DATABASE_URL=postgresql://postgres@127.0.0.1:5433/qy_test?schema=public DIRECT_URL=同上 NODE_ENV=test DATABASE_ENVIRONMENT=isolated npm test`。
- 旧模式回归对比法（4c2 用过，改导航 / 工作区时复用）：`git worktree add --detach <dir> origin/main`、软链 `node_modules`，同一个 tsx 脚本分别 `require(<root>/src/lib/navigation/index)` 与 `workspace-policy`，对 平台角色 × 企业角色 × 键组 打印 `getDefaultWorkspace | resolveHomeRedirect | 可见 key 列表`，两边 diff。

## 当前进度

| change | 状态 | PR |
|---|---|---|
| `perm-1-positions` | 已合并 main；已 archive（specs 合入 `authorization/platform-admin-authority`、`position-binding`、`position-catalog`） | #264 ✅ |
| `perm-2-discount-by-position` | 已合并 main；已 archive（specs 合入 `identity/member-management`、`sales/discount-tiering`、`sales/quote-delivery-gate`、`sales/quote-settings-approval`） | #265 ✅ |
| `perm-3-fulfillment-by-category` | 已合并 main；已 archive（specs 新增 `fulfillment/order-category-access`、`fulfillment/order-cancellation-approval`、`inventory/fabric-stock-access`，`authorization/position-catalog`、`sunny/process-order-autogen` 增量）；合并 main 时与 sunny-process 整合（报告 §5b / design D8） | #274 ✅；archive #276 ✅ |
| `perm-4a-sales-authorize` | 已合并 main；已 archive（specs 新增 `sales/record-access`、`sales/signed-quote-amount-approval`，`authorization/position-catalog` 增量）；报告 `docs/QINGYAN_PERM-4a_REPORT.md` | #279 ✅ |
| `perm-4b-ops-authorize` | 已合并 main（新键 `operations.content.draft / approve`；运营配置 12 路由、Playbook 12 路由、发布任务 3 路由按岗位；增长中心写 `operations.manage`；平台用户管理仅 super_admin；`/ops` 入口按岗位、ops API 注入权限键）；typecheck / lint:baseline / test:ci / registry 全绿；隔离库 e2e 32/32；全量 `npm test` 450/463（13 条为既有环境性失败，与基线一致）；报告 `docs/QINGYAN_PERM-4b_REPORT.md`；已 archive（specs 新增 `operations/config-access`、`operations/content-approval`、`marketing/growth-center-access`） | #283 ✅；archive 本 PR |
| `perm-5b-digital-employee-positions` | 已合并 main；已 archive（specs 新增 `authorization/digital-employee-principal`、`agents/tool-authorization`、`agents/digital-employee-approval`，`authorization/position-binding`、`position-catalog` 增量）（数字员工主体解析 / 自身绑定无回退 / sponsor 范围 / 禁区元数据；`canInvokeTool` 主体 + `requiredPermission`；数字员工审批归属与审批人 = sponsor；审计 `actorDisplay`；绑定脚本 `--principal-type DIGITAL_EMPLOYEE`）；typecheck / lint:baseline / test:ci / registry / 架构守卫全绿；authorize 120、纯测试 50/50、隔离库 e2e 34/34；报告 `docs/QINGYAN_PERM-5b_REPORT.md` | #285 ✅；archive 本 PR |
| `perm-5a-accounting-view` | 已合并 main；已 archive（specs 新增 `accounting/sales-commission-view`、`accounting/quote-process-view`、`accounting/project-settlement-view`、`accounting/workspace`，`authorization/position-catalog` 增量）（新键 `project.finance.read`；提成口径唯一 `summarizeCommission`；`/api/accounting/{sales-summary,quotes,projects}`；`/accounting` 三页签 + 导航 + 会计默认落地）；typecheck / lint:baseline / test:ci / registry 全绿；authorize 133、accounting 38/38、隔离库 e2e 27/27；报告 `docs/QINGYAN_PERM-5a_REPORT.md` | #287 ✅；archive 本 PR |
| `perm-4c1-project-finance` | 已合并 main；已 archive（specs 新增 `projects/finance-access`、`projects/handoff-access`，`authorization/position-catalog` 增量）（新键 `project.finance.manage` 只给 owner；财务 / 报价引擎特权不再认 `org_admin`；会计非成员只读进单项目财务；删 `canManageUsers`）；typecheck / lint:baseline / test:ci / registry 全绿；authorize 146、finance-access 27/27、隔离库 e2e 18/18；报告 `docs/QINGYAN_PERM-4c1_REPORT.md` | #290 ✅；archive #291 ✅ |
| `perm-4c2-nav-by-position` | 6/6 tasks；代码完成（新键 `organization.dashboard.read` 只给 owner；岗位模式 = 行业包有岗位模板；岗位模式下管理层 / 销售工作区 / 默认落地 / 侧栏 / 底栏全部按键，外贸入口按平台 `trade` 或管理层；平台用户管理两种模式只 super_admin；旧模式与 main 96 组合对比只差该入口）；typecheck / lint:baseline / test:ci / registry 全绿；authorize 150、position-nav 86/86；报告 `docs/QINGYAN_PERM-4c2_REPORT.md`；已 archive（specs 新增 `navigation/position-based-visibility`，`authorization/position-catalog`、`accounting/workspace` 增量） | #292 ✅；archive #293 ✅ |
| `perm-4c3-collapse-platform-roles` | 7/7 tasks；代码完成（压扁工具 `scripts/collapse-platform-roles.ts` + 规划 / 执行器 + `--restore`；写库闸门 `PLATFORM_ROLE_COLLAPSE_READY=false`；前置拒绝：非岗位模式 / 缺绑定 / 同时是旧模式企业成员；岗位模式企业关闭成员角色兼容回退；残留清单 `docs/QINGYAN_PERM-4c3_RESIDUAL_ROLE_READS.md`）；typecheck / lint:baseline / test:ci / registry 全绿；纯 36/36、隔离库 38/38；报告 `docs/QINGYAN_PERM-4c3_REPORT.md`；已 archive（specs 新增 `authorization/platform-role-collapse`，`authorization/position-binding`、`platform-admin-authority` 增量） | #294 ✅；archive #295 ✅ |
| `perm-4c4-ai-tools-by-position` | 8/8 tasks；代码完成（岗位派生平台角色；AI 工具 / 能力 / 微信域 / Muse 决定 B / 晨报 / AI 上下文 / 营销数字员工按岗位，压扁前后等价）；typecheck / lint:baseline / test:ci / registry 全绿；纯 63/63、隔离库 17/17；报告 `docs/QINGYAN_PERM-4c4_REPORT.md`；已 archive（specs 新增 `agents/position-derived-role`，`agents/tool-authorization` 增量） | #296 ✅；archive #297 ✅ |
| `perm-4c5-management-reads-by-position` | 8/8 tasks；代码完成（管理层 / 招投标交接 / 审批 / 视觉方案 / 管理总览 / 营销工作区 / 微信绑定 / 入职清单 / 开关白名单按岗位；视觉方案跨企业泄露修复；写库闸门打开）；typecheck / lint:baseline / test:ci / registry 全绿；纯 76/76、隔离库 13/13；报告 `docs/QINGYAN_PERM-4c5_REPORT.md`；已 archive（specs 新增 `authorization/position-mode-residual-reads`，`authorization/platform-role-collapse`、`projects/handoff-access`、`marketing/growth-center-access` 增量） | #298 ✅；archive #299 ✅ |
| `perm-6a-trade-keys` | 6/6 tasks；代码完成（外贸三键 + `trade_rep`；外贸接口 110 处按键；平台 admin 不再隐含外贸、企业解析显式 orgId 只给 super_admin；通道管理按设置键；派生角色 `trade` 档；岗位模式外贸入口认 `trade.read`）；typecheck / lint:baseline / test:ci / registry 全绿；纯 127/127、隔离库 27/27；报告 `docs/QINGYAN_PERM-6a_REPORT.md`；已 archive（specs 新增 `trade/access`，`agents/position-derived-role` 增量） | #300 ✅；archive #301 ✅ |
| `perm-6c-revenue-and-trade-recipients` | 6/6 tasks；代码完成（营收中心按外贸键；外贸收件人 / 默认询盘负责人按岗位；压扁纳入 `trade`）；typecheck / lint:baseline / test:ci / registry 全绿；纯 68/68、隔离库 23/23；报告 `docs/QINGYAN_PERM-6c_REPORT.md`；已 archive（specs 新增 `revenue/spine-access`、`trade/notification-recipients`，`authorization/platform-role-collapse`、`position-mode-residual-reads` 增量） | #302 ✅；archive #303 ✅ |
| `perm-7-position-binding-ui` | 6/6 tasks；代码完成（岗位绑定界面 + 共用服务 + 成员增删改只认 super_admin）；typecheck / lint:baseline / test:ci / registry 全绿；纯 30/30、隔离库 35/35；报告 `docs/QINGYAN_PERM-7_REPORT.md`；已 archive（specs 新增 `authorization/position-binding-console`，`identity/member-management` 增量） | #305 ✅；archive #306 ✅ |
| `perm-6b-mengxin-positions` | 5/5 tasks；代码完成（家纺外贸 `owner` + `trade_rep`，梦馨进入岗位模式；绑定文件；入驻 / 交接 / 邀请注册后落默认岗位）；typecheck / lint:baseline / test:ci / registry 全绿；纯 42/42、隔离库 25/25；报告 `docs/QINGYAN_PERM-6b_REPORT.md`；已 archive（specs 增量合入 `authorization/position-catalog`、`authorization/position-binding`） | #307 ✅；archive #314 ✅ |
| `perm-7b-retire-platform-admin` | 8/8 tasks；代码完成（平台特权只认 super_admin；`platformTier`；手写判断收口；派生角色只保留 super_admin；不再签发 admin；压扁纳入 admin）；typecheck / lint:baseline / test:ci / registry 全绿；纯 46/46、隔离库 23/23；报告 `docs/QINGYAN_PERM-7b_REPORT.md`；已 archive（specs 新增 `authorization/platform-admin-scope`，`agents/position-derived-role`、`authorization/platform-role-collapse` 增量） | #316 ✅；archive #317 ✅ |
| `install-1-installer-position` | 9/9 tasks；代码完成（权限键 / 岗位 / `src/lib/install` / 6 个 API / 文件代理前缀 / transition 校验 / `/install` 两页 / 底栏侧栏入口 / 工艺单详情安排安装 + 收口标签）；typecheck / eslint / lint:baseline / test:ci / registry 全绿；报告 `docs/QINGYAN_INSTALL-1_REPORT.md`；TASKFLOW `[G]` | #268 ✅；已 archive（specs 合入 `installation/install-tasks`、`installation/window-closeout`，`authorization/position-catalog` 增量） |

## 交叉测试结果

### 会话 2（2026-10-28 夜间，PERM-4b / 5b / 5a）
- 全量 `npm test`（起本地隔离库，PERM-4c2 分支）：461/470，9 个失败均与改动无关——TypeScript（`npm test` 内未设 `--max-old-space-size` 导致 OOM；单独 typecheck 通过）、报价 PDF 分页（无 Chromium）、Phase3A ×4 / T4 / Autopilot A2-P0（本地库缺 Sunny / 梦馨双租户种子）、`sunny-process/autogen-db.isolated`（main 上同样失败：签约一步 `NO_BINDING`——测试早于 PERM-4a 销售按岗位，未给报价创建人绑岗位；已另提任务）。
- 全量 `npm test`（无 DB，PERM-4b 合并前）：450/463，13 个失败与基线同一批环境性失败，无新增。
- 每个 change 合并前：typecheck / lint:baseline / `npm run test:ci` / registry 全绿；CI `validate-lint-typecheck-test-build` 绿。
- 隔离库（本地 Postgres 16）：`ops-authorize-db.isolated` 32/32、`digital-employee-db.isolated` 34/34、`accounting-db.isolated` 27/27（5a rebase 到含 5b 的 main 后三套一起复跑通过）。

### 会话 2（2026-10-28，PERM-4a 合并前）
- 全量 `npm test`（无 DB）：446/459，13 个失败与会话 1 同一批环境性失败（清单见 `docs/QINGYAN_PERM-4a_REPORT.md` §5），无新增。
- 隔离库（本地 Postgres 16 + pgvector）：`autogen-db.isolated` 41/41（PERM-3 × sunny-process 整合后）、`signed-quote-amount-db.isolated` 20/20、`sales-record-access-db.isolated` 15/15。

### 会话 1（2026-10-27）

- 全量 `npm test`：422/435，13 个失败与 `docs/QINGYAN_SDD-0_REPORT.md` §3 用例 4 的环境性基线完全一致（10 项 MISSING_DATABASE_URL、T4 需 DATABASE_URL、Gmail OAuth、PDF 页脚），无新增失败；TypeScript 检查通过。
- `npm run build`：见 `docs/QINGYAN_PERM-1-2_REPORT.md`（待写）。

## 下一步（按顺序）

1. ~~PERM-2 PR~~ 已合并（#265）。
2. ~~archive 小 PR~~ 已合并（#267）：7 个新能力已在 `openspec/specs/**`。
3. ~~INSTALL-1~~ 已合并（#268）并 archive（本 PR）。
4. 生产动作（Lucas 本机）：对 Sunny 跑 `seedOrgAuthorizationProfiles` 落地模板（含 installer）；补 `config/positions/sunny.json` 邮箱（含 `TODO:安装工`）；`--dry-run` 后执行绑定脚本（命令见 `docs/QINGYAN_PERM-1_REPORT.md` §4）；查 `User.role='admin'` 账号（PERM-2 报告 §4-1）。
5. ~~PERM-3 / PERM-4 / PERM-5 任务书~~ 已写：`docs/QINGYAN_PERM-3_FULFILLMENT_BY_CATEGORY_TASKBRIEF.md`、`docs/QINGYAN_PERM-4_PLATFORM_ROLE_CLOSEOUT_TASKBRIEF.md`、`docs/QINGYAN_PERM-5_ACCOUNTING_DIGITAL_EMPLOYEE_TASKBRIEF.md`。每份末尾有「判断点」，**先让 Lucas 拍板再 propose**。
6. ~~PERM-3~~ 已合并（#274）并 archive（#276）。**生产动作**：对 Sunny 重跑 `seedOrgAuthorizationProfiles`（出单模板变了），并确认工厂人员已绑定对应 `fulfillment_*` 岗位——自动生成工艺单的草稿核对（改参数 / 挪行 / 确认）现在要求本单全部品类键（报告 §5b）。
7. ~~PERM-4a~~ 已合并（#279）并 archive（本 PR）。**生产动作**：合并前应已查平台 `admin` 账号补岗位（平台 admin 在销售区不再有隐含权限）——若未做，尽快补；对 Sunny 重跑 `seedOrgAuthorizationProfiles`（owner +5 键）。Sunny 若只有一位老板，签约单改总价会 409 `NO_APPROVER`，只能 Lucas 直接改。
8. ~~PERM-4b~~ 已合并（#283）并 archive（本 PR）。**生产动作**：对 Sunny 重跑 `seedOrgAuthorizationProfiles`（ops_staff / ops_lead / owner 模板变了），确认 Marty（`ops_lead`）/ Maggie（`ops_staff`）绑定生效，否则 Maggie 进不了运营中心。老板改不了运营配置 / 增长中心（只看 + 批内容）。
9. ~~PERM-5~~ 已完成（用户 2026-10-28："5a 和 5b 都按推荐做"，拍板见任务书末尾"拍板结果 · PERM-5"）。顺序：5b 先（只依赖 PERM-1），5a 后（自带 `project.finance.read` 一个键，不等 4c）。4c 排在 5 之后。
   - ~~PERM-5b~~ 已合并（#285）并 archive（#286）。**生产动作**：无（没有数字员工绑定 = 和今天一样全拒）。启用某个数字员工：填 `config/positions/sunny-digital-employees.json` 的 Agent id（sponsor = Agent 创建人），`--principal-type DIGITAL_EMPLOYEE --dry-run` 后执行。已知：今天没有运行时以数字员工为主体执行；现有工具都没声明 `requiredPermission`，数字员工调用会 `permission_required`（报告 §4）。
   - ~~PERM-5a~~ 已合并（#287）并 archive（本 PR）。**生产动作**：合并后对 Sunny 重跑 `seedOrgAuthorizationProfiles`（accounting / owner / bids 加了 `project.finance.read`），确认 Miki 绑了 `accounting`。项目结算页签在生产显示"项目财务控制未启用"（`TENDER_FINANCIAL_CONTROL_ENABLED` 默认关）；会计仍进不了单项目财务页（不是项目成员，属 4c，报告 §3 D4）。
10. 进行中：**PERM-4c**（拆为 4c1 / 4c2 / 4c3，拍板见任务书"拍板结果 · PERM-4c"）。~~4c1~~ 已合并（#290）并 archive（#291）：**生产动作**——合并后对 Sunny 重跑 `seedOrgAuthorizationProfiles`（owner 加 `project.finance.manage`）；只靠 `org_admin` 的人失去项目财务 / 报价引擎特权（两功能生产默认关，当前无线上影响），启用前给需要的人（含梦馨）绑 `owner`。原计划（判断点已拍板：先压 Sunny、梦馨不动、Sunny 无人用 `manager`）——项目财务 `project.finance.*` 收口（含会计进单项目财务页、`requireProjectReadAccess` 口径）、导航 `requiredPermissions` 铺开删 `requiredPlatformRoles / NAV_ROLES_*`、默认工作区去平台角色、平台角色压扁脚本、删除 `canManageUsers`（含 `src/lib/projects/handoff/access.ts`）。先 `/opsx:propose perm-4c-nav-by-position`，四件套回传审核。
   - ~~4c2~~ 已合并（#292）并 archive（#293）（导航 / 落地 / 底栏按岗位）。**生产动作**：合并后对 Sunny 重跑 `seedOrgAuthorizationProfiles`（owner 加 `organization.dashboard.read`）；确认 Sunny 老板都绑了 `owner`、Sunny `industryPackId = window_covering_services_v1`——否则老板合并后落到各自岗位工作区、看不到企业经营。平台 admin / boss / manager 在任何企业都不再看到"平台用户管理"入口（接口自 4b 起就只认 super_admin）。下一个 4c3（压扁脚本 + 窗饰企业关闭兼容回退），先 propose。
   - ~~4c3~~ 已合并（#294）并 archive（#295）（压扁工具 + 写库闸门 + 岗位模式企业关闭兼容回退 + 残留清单）。**生产动作**：合并即生效的只有兼容回退收口——合并前后对 Sunny 跑 `bind-positions --dry-run` 确认全员有 active 绑定（`config/positions/sunny.json` 的 `TODO:` 先填）；可跑 `ALLOW_ROLE_COLLAPSE=true npx tsx scripts/collapse-platform-roles.ts --org <sunny> --actor <lucas> --dry-run` 核对名单与阻断（尤其有没有人同时在梦馨）。**不要**执行真正压扁（闸门会拒绝）。
   - ~~4c4~~ 已合并（#296）并 archive（#297）（AI 一侧按岗位：岗位派生平台角色）。**生产动作**：合并即生效——Sunny 的 AI 工具 / Muse / 晨报按岗位；没绑 `owner` 的 `org_owner` 在 Muse 失去全组织与金额；核对生产 `*_ROLE_ALLOWLIST` 环境变量（见 4c4 报告 §4）。
   - ~~4c5~~ 已合并（#298）并 archive（#299）（残留读点收口 + 视觉方案泄露修复 + 打开写库闸门）。**生产动作**：合并即生效——平台 boss 未绑 owner 失去团队任务 / 运营项目 / 审批执行的管理范围；平台 admin / boss 不再看到其他企业的视觉方案（安全修复）。合并后可执行压扁（见验收清单 B 第 6 步）。
11. 进行中：**PERM-6**（外贸，拆 6a / 6b / 6c，拍板见任务书 `docs/QINGYAN_PERM-6_TRADE_TASKBRIEF.md`"拍板结果 · PERM-6"；owner 界面绑岗位另立 PERM-7）。
   - ~~6a~~ 已合并（#300）并 archive（#301）。**生产动作**：合并后对梦馨与 Sunny 重跑 `seedOrgAuthorizationProfiles`（梦馨外贸业务员自动绑 `trade_rep`；`org_owner` / `org_admin` / 窗饰 `owner` 拿到外贸键）；查 `User.role='admin'` 的账号——需要外贸又不是 `org_owner` 的绑 `trade_rep` 或改 super_admin；平台 admin 不能再用显式 orgId 进非成员企业。
   - 6c `perm-6c-revenue-and-trade-recipients`（用户定先于 6b）：已合并（#302）并 archive（#303）。**生产动作**：无数据动作；合并即生效——营收中心不再认平台 sales / boss / manager / admin（不是企业负责人、无外贸岗位的人），他们也不再收外贸提醒 / 早报 / 展会小结；只持设置键的 `org_admin` 不再收外贸管理层提醒。梦馨两人不变。压扁 `trade` 要等 6b 后梦馨成为岗位模式。
   - ~~PERM-7~~ 已合并（#305）并 archive（#306）：岗位绑定界面（只认 super_admin）+ 成员增删改只认 super_admin。**生产动作**：无；之后调岗在企业详情页"岗位"一节完成。平台 admin 不能再增删改成员。
   - ~~6b~~ 已合并（#307）并 archive（#314）。**生产动作**：~~`docs/QINGYAN_PERM-6b_MENGXIN_SQL.md` 第 3 段（`owner` → Cathy、Lucas）~~ 已做（2026-10-29 补执行，查询确认 Cathy = `owner, trade_rep`）。之后是 7b。
   - ~~PERM-7b~~ 已合并（#316）并 archive（#317）。**生产动作**：~~Lucas 改 super_admin~~ 已做（2026-10-29，Neon SQL Editor：`UPDATE "User" SET role = 'super_admin' WHERE lower(email) = 'lucas@sunnyshutter.ca';`，查询确认；需重新登录）；还要查其余平台 `admin` 账号并补岗位（SQL 见 7b 报告 §4）。PERM 系列到此收尾。
   - ~~`fix-taskflow-status-drift` 未 archive~~：提交已在 main，2026-10-28 补 archive（specs 新增 `qa/taskflow-status`，`qa/test-registry` 增量）。

## 环境注意

- 沙箱 Node 是 22，仓库要 24：`source ~/.nvm/nvm.sh && nvm use 24`（若 nvm 不在，`node -v` 为 22 也能跑 tsx，但 `tsc` 要 `NODE_OPTIONS=--max-old-space-size=8192`）。
- 沙箱无 Postgres 服务，但装有 Postgres 16：`apt-get install -y postgresql-16-pgvector` 后以 postgres 用户 `initdb` + `pg_ctl`（数据目录放 postgres 可写处，如 `/var/tmp/qy-pg`），`prisma migrate deploy` 后可用 `DATABASE_ENVIRONMENT=isolated NODE_ENV=test` 跑 `*.isolated.test.ts`。未起库时带 DB 的测试在 `npm test` 里因 MISSING_DATABASE_URL 失败，属环境性；CI 子集 `npm run test:ci` 不含它们。
- `openspec validate --specs --strict` 有 4 条 WARNING（`authorization/position-catalog`、`sunny/process-order-autogen` 需求文本 >500 字；`inventory/fabric-stock-access`、`accounting/workspace` Purpose 过短——中文少于 50 字符，PERM-5a 引入）。规格只从 change 归档进来，下次碰这些能力的 change 顺手拆分。
- 生产库迁移是手工受控的（见 `docs/DEPLOY_VERCEL.md`）；本主线零 schema，不应再有迁移。
- 沙箱访问不到 qingyan.ca 与 Neon；线上核对由 Lucas 做。

## 已知陷阱

- `resolveEffectiveBindings` 无绑定时按 `OrganizationMember.role` 兼容回退；PERM-1 绑定后 Sunny 全员应走绑定，别再依赖回退。
- `seedOrgAuthorizationProfiles` 会把 org_owner / org_admin / 平台 sales 自动绑到系统模板；新模板加入后要确认它不会给梦馨绑 Sunny 岗位。
- 工艺单读写判定只有一处：`src/lib/fulfillment/service.ts` `resolveOrderAccess`（`canViewBlindsOrder` / `blindsOrderAccess` 都委托它）；品类含 sunny 参数行（`specCategories`）。新增工艺单写接口必须判 `access.edit.allowed`。
- 报价保存只有一处实现：`src/lib/sales/quote-update.ts`（PUT 与签约改价执行器共用）；超限折扣审批收口写在 `src/lib/pending-actions/quote-promotion-settle.ts`。改报价保存逻辑改这两处，不要在路由里再写一份。
- drafts 层（`requestApproval`）按幂等键去重**不看状态**：新审批的幂等键要能区分"被拒后再提交"，否则会拿回已终结的审批（PERM-4a 用"该报价已有审批条数"）。
- 隔离库 e2e 本地跑法：容器重启后 Postgres 会停，`su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D /var/tmp/qy-pg/data -o '-p 5433 -k /var/tmp/qy-pg' -l /var/tmp/qy-pg/log start"`；若数据目录没了按"环境注意"重建（`initdb` → `create database qy_test` → `prisma migrate deploy`）。
- 运营 / 增长中心权限判定只有一处：`src/lib/operations/access.ts`（`requireOpsPermission` / `selfApprovalBlocked`）；Playbook 权限函数是异步的，**漏 await 会把 Promise 当真值放行**（`ops-access.test` 有源码断言兜底）。
- 工作区上下文的权限键用 `src/lib/rbac/permission-keys.ts` `loadPermissionKeys`；新写的 `/api/ops/*` 之类按工作区放行的 API 必须注入，否则按岗位放行的人会被拦。
- **岗位模式（PERM-4c2）**：企业行业包有岗位模板（`hasPositionTemplates`，目前只有窗饰）→ 管理层 / 销售工作区 / 默认落地 / 侧栏 / 底栏只看权限键；否则旧模式（平台角色，梦馨）。客户端从 `/api/auth/active-org` 的 `positionMode` 拿；服务端用 `loadPositionMode(orgId)`。新写自建 wsCtx 的 API 要和 `permissionKeys` 一起注入 `positionMode`。
- 导航字段语义：`positionPermissions` 只在岗位模式生效；`requiredPermissions` 两种模式都生效（旧模式命中即放行，**不要拿它给旧模式入口加门槛**，会改梦馨菜单）；`tradeEntry` = 岗位模式下平台 `trade` 或管理层；`superAdminOnly` 两种模式都只 super_admin。新增导航入口在岗位模式下要配 `positionPermissions`，否则对所有成员可见。
- 岗位模式管理层信号只有 `organization.dashboard.read`（只绑窗饰 `owner`）。**不要挂到系统模板 `org_owner` / `org_admin`**——seed 会把这两类成员自动绑过去（4c1 踩过）。"销售专职"用 `sales.quote.create` / `sales.quote.pricing_close`，不用读键（会计、出单岗也有读键）；安装落地用 `install.task.update`（出单岗也有 `install.task.read`）。
- 平台 super_admin 在任何企业持全部键（`platformAdminBindings`），岗位模式菜单完整；平台 admin / boss / manager 没有任何隐含键。
- **外贸（PERM-6a）**：外贸接口一律 `requireTradePermission(request, TRADE_*_KEYS)`（`src/lib/trade/access.ts`）；新写外贸路由按方法选键（GET 读键、其余写键），`trade-access.test` 的路由表断言会拦漏写或写错。通道管理再经 `canManageTradeChannels`（设置键）。`resolveTradeOrgId` 被销售 / 租户上下文 / 秘书 / 营收共用，显式 orgId 只对 super_admin 开放。
- 唯一 org_owner 保护在 `organizations/[orgId]/members/[memberId]/route.ts`；老板做成岗位 `owner`，不改这条保护。

## Lucas 验收清单（2026-10-28 夜间：PERM-4b / 5b / 5a 全部合并并 archive）

### A. 已合并的 PR（按顺序）
| PR | 内容 |
|---|---|
| #283 / #284 | PERM-4b 运营 / 增长中心 / 平台用户管理按岗位（+ archive） |
| #285 / #286 | PERM-5b 数字员工岗位绑定与工具授权（+ archive） |
| #287 / #288 | PERM-5a 会计视图（+ archive） |
| #290 / #291 | PERM-4c1 项目财务 / 报价引擎按岗位（+ archive） |
| #292 / #293 | PERM-4c2 导航 / 默认落地 / 底栏按岗位（+ archive） |
| #294 / #295 | PERM-4c3 平台角色压扁工具（闸门关闭）+ 窗饰企业关闭兼容回退（+ archive） |
| #296 / #297 | PERM-4c4 AI 一侧按岗位（岗位派生平台角色）（+ archive） |
| #298 / #299 | PERM-4c5 管理层与残留读点按岗位、视觉方案跨企业泄露修复、打开压扁写库闸门（+ archive） |
| #300 / #301 | PERM-6a 外贸接口按岗位权限键；平台 admin 不再隐含外贸（+ archive） |
| #302 / #303 | PERM-6c 营收中心按外贸键；外贸收件人 / 默认询盘负责人按岗位；压扁纳入 trade（+ archive） |
| #305 / #306 | PERM-7 岗位绑定界面；成员增删改只认 super_admin（+ archive） |
| #307 / #314 | PERM-6b 梦馨落岗位、进入岗位模式；入驻后落默认岗位（+ archive） |
| #316 / #317 | PERM-7b 平台 admin 退役，平台特权只认 super_admin（+ archive） |

每个 PR：CI `validate-lint-typecheck-test-build` 绿；本地 typecheck / lint:baseline / test:ci / registry 全绿；隔离库 e2e：4b 32/32、5b 34/34、5a 27/27（5a rebase 后三套一起复跑通过）；`openspec validate --strict` 通过。

### B. 生产动作（只能你在本机 / 线上做，按顺序）
1. 对 Sunny 重跑 `seedOrgAuthorizationProfiles`——一次覆盖 4b（ops_staff / ops_lead / owner）与 5a（accounting / owner / bids 加 `project.finance.read`）的模板变化。
2. 确认岗位绑定：Marty = `ops_lead`、Maggie = `ops_staff`（否则 Maggie 进不了运营中心）、Miki = `accounting`（`config/positions/sunny.json` 里仍是 `TODO:` 的先补邮箱，`--dry-run` 后执行）。
3. 查 `User.role='admin'` 的平台账号：4a / 4b 后平台 admin 不再有销售区、运营配置、平台用户管理的隐含权限，需要的补岗位。
4. 4c1 / 4c2 / 4c3 合并后再对 Sunny 重跑一次 `seedOrgAuthorizationProfiles`（owner 加 `project.finance.manage`、`organization.dashboard.read`），并 `bind-positions --dry-run` 确认 Sunny 全员有 active 绑定（4c3 起窗饰企业无绑定 = 无权限）；确认每位老板绑了 `owner`。
5. 数字员工（5b）：**不需要动作**。真要启用时再填 `config/positions/sunny-digital-employees.json`。
6. **执行平台角色压扁（4c5 合并后）**：按 `docs/QINGYAN_PERM-4c3_RESIDUAL_ROLE_READS.md` 末节"生产执行压扁"——先 `bind-positions --dry-run`（全员有绑定）→ `ALLOW_ROLE_COLLAPSE=true npx tsx scripts/collapse-platform-roles.ts --org <sunny> --actor <lucas> --dry-run`（核对名单、无阻断，尤其没人同时在梦馨）→ 去掉 `--dry-run` 执行 → 通知被压扁的人重新登录 → 出问题 `--restore`。

7. **PERM-6a 合并后**：对梦馨与 Sunny 重跑 `seedOrgAuthorizationProfiles`；查 `User.role='admin'` 的账号，需要外贸又不是 `org_owner` 的绑 `trade_rep`（或按需改 super_admin，例如 `lucas@sunnyshutter.ca`）。

8. **PERM-6c 合并后**：无数据动作。确认需要收外贸提醒（询盘通知 / 早报 / 展会小结 / SLA 升级）的人是 `org_owner` 或绑了外贸岗位 / 老板岗位；平台 sales 不再进营收中心。

9. **PERM-7 合并后**：无数据动作。之后调岗在企业详情页"岗位"一节（只有 super_admin 可见）完成，不必再本机跑 `bind-positions`；平台 admin 账号不能再增删改成员（`lucas@sunnyshutter.ca` 需先改为 super_admin）。

10. **PERM-6b（BREAKING，合并即对梦馨生效）**，按 `docs/QINGYAN_PERM-6b_REPORT.md` §4：
    1. 生产侧没有可用的本地仓库：在 Neon SQL Editor（项目「青砚-AI工作助手」→ 分支 `production` → `neondb`）执行 `docs/QINGYAN_PERM-6b_MENGXIN_SQL.md` 的 SQL。
    2. **已完成（2026-10-29）**：第 2 段（落 `trade_rep` 并绑 Cathy）。核对发现 Cathy 是平台 `boss`、此前无任何绑定、梦馨缺 `trade_rep`（6a 后未 seed）。
    3. ~~第 3 段~~（落家纺 `owner` 并绑 Cathy、Lucas；用户定 Cathy = 外贸业务员 + 老板）：合并后于 2026-10-29 补执行，第 1 段查询确认 Cathy = `owner, trade_rep`。Lucas 已是 super_admin，在任何企业持全部键，`owner` 绑定对他不再必要。
    4. 合并后无需再跑 seed；两人可用功能与合并前相同（6b 报告 §2a）。可选：Lucas 改 super_admin（第 4 段，7b 前必须）；压扁 Cathy `boss → user`。
    5. 漏了第 3 段就合并：Cathy 失去老板级功能、Lucas 不是管理层；补执行即恢复，不用回滚。

11. **PERM-7b（BREAKING，合并即生效）**，按 `docs/QINGYAN_PERM-7b_REPORT.md` §4：
    1. **已合并（#316）**。~~`lucas@sunnyshutter.ca` 改 super_admin~~ 已做（2026-10-29 Neon SQL Editor，查询确认 `super_admin` / `active`；Lucas 需重新登录）。**待做**（SQL 见 7b 报告 §4）：查其余平台 `admin` 账号，业务人员确认有岗位绑定。
    2. ~~6b 先合并~~：已合并（#307 / #314）。
    3. 合并后可选：两家企业压扁 `--dry-run`，`admin → user` 无阻断后执行，通知相关人重新登录。
    4. 漏了第 1 步：Lucas 会失去企业列表与入驻控制台，SQL 改 super_admin 即恢复，不用回滚。

### C. 线上点验（5 分钟）
- 用 Maggie 登录：能进 `/ops`、能起草提交内容、批准按钮 403；改品牌档案 403。
- 用 Marty 登录：能改运营配置、能批 Maggie 的发布任务、不能批自己建的（403 `SELF_APPROVAL`）。
- 用老板账号：运营配置只读、能批 Marty 的内容；`/admin/users` 看不到（只剩平台 super_admin）。
- 用 Miki 登录：首页落到 `/accounting`；"成交与提成"按人列出本月签约 / 提成（与 Alex 业绩页本人数字一致）；"导出 CSV"能下载；"报价过程"看到超限审批的批准人与时间、没有客户电话邮箱；"项目结算"显示"项目财务控制未启用"（生产开关默认关，属正常）。
- 用 Alex 登录：导航里没有"会计视图"；业绩页提成数字与之前一致。
- 4c2 合并后：老板账号首页停在管理总览、侧栏有企业经营 / AI 能力；Alex（销售岗）落 `/sales/home`、侧栏只有销售条目、手机底栏是销售布局；Maggie 落 `/ops`、看不到销售中心；Miki 落 `/accounting`；安装工落 `/install`。
- 压扁后（4c5）：老板首页管理总览含销售模块、Muse 能看金额、团队任务可见；Alex 落 `/sales/home`、AI 有销售工具、打开 `/operations/growth` 被带回 `/sales`；Marty 能看运营项目列表；Bill（招投标）能预览交接；平台 admin 的视觉方案列表只剩本企业。

- 6a 合并后：梦馨老板与外贸业务员照常进外贸（询盘 / 线索 / 报价 / 消息通道列表）；业务员改消息通道仍提示"仅企业负责人或企业管理员"；不是 `org_owner` 的平台 admin 打开外贸 403。

- 6c 合并后：梦馨老板照常收老板早报 / 展会小结 / 24 小时升级，业务员照常收新询盘与首次提醒，默认询盘负责人仍是业务员；两人都能进营收驾驶舱，老板能改营收策略、业务员改不了。

- 6b 合并后：Cathy 登录照常落 `/tasks`、外贸布局、外贸读写与营收驾驶舱正常、改营收策略 403；企业详情页"岗位"一节显示 Cathy = `trade_rep`、Lucas = `owner`；Lucas 照常收老板早报 / 展会小结 / 24 小时升级。

- 7b 合并后：用 super_admin（Lucas）照常看到全部企业、入驻控制台、能力运行记录；任一平台 `admin` 账号（若还有）只看到自己所在企业，打开入驻控制台 / 新建企业 403，在本企业按岗位工作；邀请码页没有"平台管理员"选项。

- 7 合并后：用 super_admin 打开 Sunny 企业详情页，"岗位"一节列出每人岗位；给某人改岗位先"预览差异"再"确认保存"，审计里有 `authorization.position.bind`（via console）；试图停掉唯一老板岗位会被拦。

### D. 需要你知道的取舍
- 5a 没改单项目财务页授权（会计不是项目成员仍进不去）——这属 PERM-4c 的 `project.finance.*` 收口（5a 报告 §3 D4）。
- 5b 今天没有运行时以数字员工身份执行；交付的是授权通路 + 禁区 + 审批入口 + 审计标记（5b 报告 §4）。
- 5b 审批人 = 数字员工的 sponsor（Agent 创建人），不是"该岗位所有人"——PendingAction 只有一个审批人列（5b 报告 §3）。

### E. 下一个
PERM 系列全部合并并 archive：4a–4c5、5a / 5b、6a / 6b / 6c、7（#305 / #306）、7b（#316 / #317）。平台层只剩 `super_admin` 与 `user`（压扁后），业务能力全看岗位。**你还要做的**：~~Lucas 改 super_admin~~（2026-10-29 已做）；~~梦馨 `owner` SQL~~（2026-10-29 已做）；Sunny 9 人邮箱 → 补 `config/positions/sunny.json` 或在企业详情页绑岗位；可选压扁。可另立：平台角色枚举清理、"平台管理员操作"审计标记。
