# PERM-4c5 报告：管理层与其余残留读点按岗位；修复视觉方案跨企业泄露；打开压扁写库闸门

- change：`openspec/changes/perm-4c5-management-reads-by-position/`（proposal / specs ×4 / design / tasks 8/8）
- 清单：`docs/QINGYAN_PERM-4c3_RESIDUAL_ROLE_READS.md`（B / C / D 组与 A 组余项，现已逐条标状态）
- 拍板：任务书"拍板结果 · PERM-4c5"（2026-10-28："按照你推荐的方式开始生成，并且修复泄露"）
- 零 schema

## 1. 做了什么

| 读点 | 改动 |
|---|---|
| B1 团队任务（`/api/tasks` GET / POST，`/api/tasks/[id]` PATCH / DELETE） | 上下文注入 `loadWorkspaceSignals`（新，`permission-keys.ts`：`permissionKeys` + `positionMode`） |
| B2 运营项目（`/api/ops/projects`） | 同上 |
| B3 招投标交接（记录 / 预览 / 执行） | 同上；`bids.handoff.*` 键可达，岗位模式管理层按老板岗位 |
| B4 审批 | 以下入口传岗位派生平台角色，执行器 `canSeeResource(ctx.role…)` 与压扁前等价：<br>• `/api/ai/pending-actions/[id]`（决策 / 批准 / 拒绝）；<br>• agent 任务步骤批准 / 拒绝；<br>• 微信确认。<br>能力中台审批传企业成员角色，不受影响；Muse 审批 4c4 已派生 |
| B5 视觉方案 + **跨企业泄露修复** | 新 `resolveVisualizerViewer(user)`：按"在哪些企业看全部"（企业内派生角色 `dataScope=all`）判定；平台 super_admin 仍全部。<br>修复：列表 `all` 只在这些企业内；详情 / 新建校验核对客户企业。<br>未解析的查看者只看本人（fail-closed）。<br>覆盖 19 个视觉方案路由、文件代理和智能体视觉方案工具（`visualizerViewerForOrg`，限当前企业） |
| C1 管理总览 | `/api/auth/me` 加 `effectiveRole`（`role` 不变），管理总览按它显示销售 / 项目 / 外贸模块 |
| A6 营销工作区 | 新 `src/lib/marketing/workspace-gate.ts` + `/marketing`、`/operations/growth` 两个服务端 layout：派生角色为 `sales` → 重定向 `/sales`。<br>`requireMarketingReadAccess` 接到 15 个增长中心 GET（`/api/marketing/employee` 4c4 已处理）。<br>中间件原判定保留（旧模式）。工作台营销入口读 `effectiveRole` |
| A8 功能开关 | `/api/agent-supervisor/runs` 的 `isSupervisorEnabled`、持久跟进、workforce job 传派生角色 |
| D1 微信绑定 | 新绑定默认推送按派生角色 |
| D5 入职清单 | 岗位模式"业务员" = 持 `sales.quote.create` / `sales.quote.pricing_close`（或平台 `trade`） |
| **写库闸门** | `PLATFORM_ROLE_COLLAPSE_READY = true`；残留清单补"生产执行压扁"步骤 |

保留不改：
- B6 / B7（`manager`）：Sunny 无人用，派生不产生。
- E1 seed 自动绑。
- D2–D4：外贸，归 PERM-6。

## 2. 怎么验

| 项 | 结果 |
|---|---|
| `npm run typecheck` | 0 error |
| `npm run lint:baseline` | PASS |
| `npm run test:ci` | PASS（含新 `residual-reads.test`） |
| `bash scripts/check-test-registry.sh` | OK（457） |
| `openspec validate perm-4c5-management-reads-by-position --strict` | valid |
| `residual-reads.test`（新，纯） | **76 / 76**，覆盖见下方说明 |
| `residual-reads-db.isolated.test`（新，本地 Postgres 16，真实路由） | **13 / 13**，覆盖见下方说明 |
| **反证**：同一隔离库测试放到 main 代码上跑 | 4 过 9 败，含"旧模式平台 boss 列出了 A、B 两家企业的方案"——**泄露在 main 上可复现，本 change 修复** |
| 回归：test-all 中受影响目录 137 个测试文件（起本地隔离库） | 133 过。4 个 `capabilities/phase3a*` 失败，均为本地库缺 Sunny / 梦馨双租户种子（基线同样失败） |
| `platform-role-collapse`（纯 36 / 隔离库 38） | 闸门打开后全过（隔离库测试用执行器参数控制闸门） |

`residual-reads.test` 覆盖：
- 注入后的团队任务 / 运营项目 / 管理层 / 交接判定，含反例：不注入时压扁老板看不到团队任务；
- 审批执行可见性；
- 营销读守卫规则（岗位 / 旧模式）；
- 视觉方案范围：本企业 / 跨企业 / super_admin / sales / 未解析 fail-closed；
- 闸门为 true；
- 接入点源码断言。

`residual-reads-db.isolated.test` 覆盖：
- owner 团队任务 200、平台 boss + sales_rep 403、ops_lead 200；
- ops_lead 运营项目 200、sales_rep 403；
- 压扁销售 GET 增长中心 403、ops_staff 200；
- me：`role=user` / `effectiveRole=sales`、owner `boss`；
- owner 看本企业方案、看不到其他企业；ops_staff 只看本人；旧模式平台 boss 看不到其他企业。

## 3. 判断与实施中的变更

- **视觉方案泄露修复的口径**：查看者在其 **active 成员企业**中、按该企业派生角色判"看全部"。多企业的人在两家都看全部，各自限本企业。智能体工具只认当前企业。
- 路由的查看者解析由脚本统一插入每个处理器开头（`const viewer = await resolveVisualizerViewer(user)`）。6 处查询补选 `customer.orgId`，类型改为必填，漏选即编译失败。
- **入职清单**按 spec 用销售工作键判定，没有用派生角色：老板兼合价也算业务员。
- **`/api/tasks/[id]`** 的"改他人任务"用 `isManagementWorkspaceUser`。岗位模式下，企业 `org_owner` 本身不再算管理层（与 4c2 一致）。团队视图仍认 `org_owner` / `org_admin`（`isPlatformOrOrgManager`，未改）。

## 4. 已知限制与上线

- **BREAKING（Sunny，合并即生效）**：
  - 平台 `boss` 未绑 `owner` 的人失去团队任务 / 运营项目 / 审批执行的管理范围（企业角色仍按原规则）；
  - 平台 `sales` 但岗位非销售的人可进营销工作区。
- **视觉方案（所有企业，合并即生效）**：平台 `admin` / `boss` 不再看到其他企业的方案（安全修复）；平台 super_admin 不变。
- **闸门已打开**：可以在生产执行压扁。步骤见 `docs/QINGYAN_PERM-4c3_RESIDUAL_ROLE_READS.md`"生产执行压扁"：
  1. 先 `bind-positions --dry-run`；
  2. 再 `collapse-platform-roles --dry-run`；
  3. 执行；
  4. 通知重新登录；
  5. 出问题 `--restore`。
- 外贸（PERM-6）读点仍按平台角色；Sunny 暂不用外贸。启用前先做 PERM-6。

## 5. 合并后

- `/opsx:archive perm-4c5-management-reads-by-position --yes`，独立小 PR；TASKFLOW PERM-4c5 → `[x]`。
- 之后：Lucas 在生产执行压扁；下一阶段 PERM-6（外贸）。
