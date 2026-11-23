# Proposal：最近任务接口只给还能打开项目的人，检查报告只给平台管理员

TASKFLOW：FIX-23（「Phase F（续）— 情报串联」表，排在 FIX-21 之后）
来源：2026-11-23 审查 FIX-21（`project-intel-bidpackage-access`）时，两位审查员各自核实：`GET /api/agent/tasks/recent` 是同一张任务表上最后一个不按项目权限筛、也不经安全投影的读接口。
依赖：代码上不依赖 FIX-21（本 change 只动 `src/app/api/agent/tasks/` 与 `src/lib/agent-tasks/`，FIX-21 不动这两处）；TASKFLOW 一行排在 FIX-21 之后。

## Why

`GET /api/agent/tasks/recent` 只按「是不是你建的」筛任务，并原样返回每一步的检查报告：不是平台管理员的人能从这里读到检查报告原文——步骤原始报错（可能夹带模型原文与报价单价）、报价审查写进去的利润率，已被移出项目、或从别的企业建过任务的人也一直能读到那个项目的名字、步骤摘要与检查报告。同一张任务表的列表与详情接口早就只给能打开项目的人、只给平台管理员看检查报告（`src/lib/agent-tasks/dto.ts:1-9`），FIX-21 也把一键投标方案改成了同一口径（GATE 1 = C），只剩这个接口例外。

## What Changes

- 让 `GET /api/agent/tasks/recent` 只返回调用者现在仍能打开所属项目的任务，口径与项目读权限守卫（`/api/agent/tasks/:taskId` 用的那一个）相同：项目已分发，且调用者是项目负责人、项目所在组织 active 的所有者或管理员、或项目的 active 成员；平台 super_admin 不受限（含未分发项目）。
- 把这个范围写进同一次任务查询的条件里，在取最近 N 条之前筛：每次请求固定多一次成员身份查询（岗位预览中多两次），与任务条数无关，不逐个项目查。
- 让不是平台管理员的调用者（含以岗位预览身份访问的 super_admin）拿到的每一步 `checkReportJson` 为 `null`，键保留，与 `/api/agent/tasks/:taskId` 业务视图同口径；平台管理员照旧拿原文。
- 在 `src/lib/agent-tasks/dto.ts` 的列表视图部分加一个列表步骤的投影（不是平台管理员时把步骤上出现的内部字段置 `null`），路由直接导入它。`recent/route.ts` 在冻结面内部，引用 `dto.ts` 不算新消费者（design D3）。
- 在授权布线契约测试 `src/app/api/agent/tasks/__tests__/authz-contract.test.ts` 里登记 `recent/route.ts`，并加一条检查：`src/app/api/agent/tasks/` 下每个 `route.ts` 都已登记，漏登记就失败并点名文件；这个测试同时进 `scripts/test-ci-unit.sh`。
- 在 `src/lib/agent-tasks/__tests__/dto.test.ts` 加列表步骤投影的用例；新增隔离库 + HTTP 测试 `src/lib/agent-tasks/__tests__/recent-view-db.isolated.test.ts`，逐个夹具用户把接口返回的任务集合与「对每个项目直接调读权限守卫」的结果对照，两者不一致即失败。
- 保持其余不变：响应形状 `{ tasks }` 与每个任务、每一步的字段名，`triggerType` 过滤，`limit`（默认 10、上限 20），按建任务时间倒序。

## 受影响的 Muse 意图

无。不改 `src/lib/muse-bridge/` 下任何文件。

## Out of scope

- `GET /api/agent/approvals` 的 `approvals` 字段原样带 `riskReason`（审查未通过时拼进了原始报错）与 `previewJson`（步骤原始输出）：另一个接口，另开任务（tasks 3.2 后续任务第 1 条）。
- 旧仪表盘的「自动巡检」卡（`src/components/dashboard/dashboard-auto-inspections.tsx`）：它是本接口唯一的界面调用方，但它所在的 `ManagementDashboardClient` 在 main 上没有任何页面挂载（design Context）。本次不改卡片、不删卡片，删还是改造另开任务（后续第 2 条）。
- cron 巡检对未分发的项目也建任务（`src/app/api/cron/inspect/route.ts:30-45` 只按 `status: "active"` 选项目）：本次不改 cron，只是这些任务从不是 super_admin 的负责人列表里消失，与详情接口一致；另开任务（后续第 3 条）。
- `limit` 参数不是数字或为负数时不校验（`recent/route.ts:12`）：现状如此，另开任务（后续第 4 条）。
- 步骤失败时把原始报错写进检查报告与 `error`（`src/lib/agent/checker.ts:22-40`、`src/lib/agent-core/skills/flow-runner.ts:367-371`、`src/app/api/projects/[id]/ai-bid-package/run-step/route.ts:127-131`）：库里照旧存原文，平台管理员要看；本次只改这个接口给谁看。
- 项目读权限的判定本身（`src/lib/projects/access.ts`，含 FIX-21 后续第 4 条「已离开组织的负责人与成员仍过读权限」）：照现状用，不改。
- 界面：不改。
- schema 变更、新的队列 / 调度、新的模型调用、新开关：没有。**没有开关，合并即在生产生效。**

## Capabilities

### New Capabilities

- `agents/agent-tasks-recent-view`：`GET /api/agent/tasks/recent` 返回哪些任务、不是平台管理员的人看到的步骤内容、不返回什么，以及 `/api/agent/tasks/` 目录下每个路由都登记在授权布线契约测试里。

### Modified Capabilities

无。

## Impact

- 代码：
  - `src/app/api/agent/tasks/recent/route.ts`：查询条件加项目可读范围；步骤经列表投影。
  - `src/lib/agent-tasks/dto.ts`：列表视图部分加一个投影函数（不加文件）。
- 测试：
  - 改：`src/app/api/agent/tasks/__tests__/authz-contract.test.ts`、`src/lib/agent-tasks/__tests__/dto.test.ts`；
  - 新：`src/lib/agent-tasks/__tests__/recent-view-db.isolated.test.ts`，注册进 `scripts/test-all.sh`（隔离库执行，否则跳过）；
  - `scripts/test-ci-unit.sh` 加授权布线契约与 dto 两个不用库的测试。
- 接口：`GET /api/agent/tasks/recent`
  - 不是 super_admin 的调用者：自己建的、但现在打不开项目的任务不再出现（被移出项目、别的企业的项目、同企业但不是项目成员也不是组织管理员、项目未分发）；
  - 不是平台管理员的调用者：每一步 `checkReportJson` 变成 `null`；
  - 平台管理员：不变。
  - 界面上没有人受影响：唯一的界面调用方没有挂载。
- 依赖、数据库、环境变量、runtime-architecture baseline：不变。
- 文档：`docs/QINGYAN_FIX-23_REPORT.md`、`docs/acceptance/fix-23/prod-check.sql`；TASKFLOW 情报串联表在 FIX-21 之后加 FIX-23 一行。
