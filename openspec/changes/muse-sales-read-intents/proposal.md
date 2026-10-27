# Proposal: muse-sales-read-intents

**TASKFLOW：** S1（Phase S — Sales Pilot，只读销售意图）。上位文档：`LucasJ880/Muse--Bridge-bot` 的 `docs/prd/sales-pilot-prd.md` 批次 Q1。
**受影响的 Muse 意图：** 新增 `sales_overview`、`opportunity_status`；既有 12 个意图的行为不变。

## Why

管理者要在自己的助理里问"最近 30 天哪些客户该推进、某个商机现在怎样"，而 `muse-bridge/v1` 目前只认招投标项目（`projectId`），销售商机完全查不到。这一步只读，先让 Sales Pilot 能引用青砚里真实的商机记录并给出可解释的优先级。

## What Changes

- 在 `muse-bridge/v1` 契约里追加两个意图：`sales_overview`（`days?` 1–90、`assigneeUserId?`、`limit?` 1–20）与 `opportunity_status`（`opportunityId`）；追加两个错误码 `PERMISSION_DENIED`、`OPPORTUNITY_NOT_FOUND`。只加不改，契约版本字面量不变。
- 新增销售读范围规则：管理角色（平台 admin / super_admin / boss / manager，或组织 org_owner / org_admin）看本组织全部商机；销售角色（平台 sales / trade）只看分配给自己的商机；其他角色一律 `PERMISSION_DENIED`。
- 新增确定性优先级排序：只排开放态商机（含 Sunny 历史阶段的投影），每条输出命中的规则作为理由；不调用 LLM。
- `sales_overview` 返回：结论 + 前三条商机的理由 + "看第 1 条详情"的下一步；`data` 带统计（进行中、停滞、跟进日已过、客户在等回复、窗口内新建 / 成交 / 丢单）与排序列表（CRM 事实、理由、未核实字段）。
- `opportunity_status` 返回：单个商机的 CRM 事实（含记录 ID 与 `updatedAt`）、最近 5 条互动、未结束的跟进行动、系统建议的下一步、优先级理由、未核实字段；`employeeConfirmations` 先返回空数组，供 S2 填充。
- 决定 B：商机金额只对管理角色输出（`data` 里的 `amount` 字段与理由文字），销售角色的响应里不出现金额；招投标的决定 A（毛利率、项目估值、我方最终报价不出）不变。写进 `openspec/config.yaml` 第 4 条与 TASKFLOW "已决定"。
- `docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 新增 Phase S 表（S1–S4）；`.env.example` 与开关注释写明两个新意图默认不开。
- 新增纯逻辑测试与隔离库端到端测试并注册；写 `docs/QINGYAN_S1_REPORT.md`。

## Capabilities

### New Capabilities

- `muse-bridge/sales-intents`：Muse 通道上的销售协作意图——读范围、可解释优先级、商机状态视图、金额可见性。后续 S2（询问与回复）、S3（跟进引擎）在同一能力上追加。

### Modified Capabilities

（无。`openspec/specs/` 里只有 `qa/test-registry`，本 change 只按它的规则注册新测试，不改它的要求。）

## Impact

- `src/lib/muse-bridge/contract.ts`：意图表、阶段表、两段 args、错误码表各追加若干项。
- 新文件 `src/lib/muse-bridge/sales-pure.ts`（纯函数）、`src/lib/muse-bridge/sales.ts`（取数）；`router.ts` 分发表加两个 case；`router-pure.ts` 的未开放意图标签表加两项。
- 新测试 `src/lib/muse-bridge/__tests__/sales-pure.test.ts`、`sales-db.isolated.test.ts`；`muse-bridge-pure.test.ts` 的意图数量断言 12 → 14。
- `scripts/test-all.sh` 加两条 `run_test`；`scripts/test-ci-unit.sh` 加纯逻辑那一条。
- `openspec/config.yaml` 第 4 条补决定 B；`docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 加 Phase S；`.env.example`、`flags.ts` 注释。
- 生产行为零变化：两个意图不在默认放行集里，必须显式写进 `MUSE_BRIDGE_INTENTS` 才可用。

## Out of scope

- 不写任何业务数据：不建询问、不建跟进、不改 `SalesOpportunity` 任何字段（S2 / S3 再做）。
- 不加 Prisma model / 字段 / migration；不加新的 cron、队列、调度器。
- 不改既有 12 个意图的参数、响应与权限；不改事件出站（`events*.ts`、`hooks.ts`）。
- 不改青砚网页（销售页、驾驶舱、`/revenue`）；不碰 org-cockpit 在途 PR 涉及的文件。
- 不改 Revenue Spine 的评分（`scoring.ts`）与下一步引擎（`next-action.ts`）本身，只读它们已写入商机的字段。
- 不做按金额以外的新脱敏规则；不改 `containsOutboundSensitive` 的模式表。
