# Proposal

TASKFLOW：PERM-5b（`docs/QINGYAN_PERMISSION_TASKFLOW.md`）；任务书 `docs/QINGYAN_PERM-5_ACCOUNTING_DIGITAL_EMPLOYEE_TASKBRIEF.md` PERM-5b 段（判断点见末尾"拍板结果 · PERM-5"，2026-10-28 已定）

## Why

设计稿 §4-10 定的是"数字员工是独立主体、绑定岗位、永不审批、对外动作由该岗位的人审批"，而现在授权层对数字员工一律 fail-closed（`NOT_IMPLEMENTED`），工具授权只认企业角色 / 工作区角色，数字员工既拿不到岗位权限、也没有"禁区"兜底（C8 / C9）。本次把授权层、工具授权、绑定脚本与对外审批的数字员工通路补齐，人类用户路径不变。

## What Changes

- 解析数字员工主体：数字员工 = 既有 `Agent`；主体解析要求 Agent 存在、`status = active`、所属项目在当前企业，sponsor 取 Agent 创建人且须是该企业 active 成员，任一不满足即拒绝（fail-closed）。
- 读取数字员工的有效权限：只读 `PrincipalRoleBinding(principalType = "DIGITAL_EMPLOYEE")`，**无兼容回退、无平台管理员全权**；没有绑定 = 一切拒绝。
- 数字员工的 `PRINCIPAL` / `ASSIGNED` 范围按 sponsor 判定（资源 owner / 被分配人 = sponsor 才命中，拍板 1）；无 sponsor 时这两种范围永不命中。
- 在权限目录元数据里把数字员工禁区键标成"只允许人类"：所有 `*.approve`、`sales.quote.discount.*`、`sales.quote.pricing_close`、`sales.settings.manage`、`organization.settings.manage`、`authorization.policy.manage`、`identity.*`、`install.task.assign`、`orders.cancel`、`inventory.manage`、`operations.manage`；授权判定对不在键允许主体类型内的主体一律拒绝（`PRINCIPAL_TYPE_NOT_ALLOWED`），即使已绑定岗位。
- 为四类数字员工角色登记岗位映射：销售 → `sales_rep`、营销增长 → `ops_staff`、投标 → `bids`、数据分析 → `accounting`。
- 扩展绑定脚本 `scripts/bind-positions.ts`：新增 `--principal-type DIGITAL_EMPLOYEE`，绑定文件键为 Agent id；只允许绑上述四个岗位；Agent 不存在 / 非 active / 不属于该企业即退出码 2；审计记录标主体类型。新增占位配置 `config/positions/sunny-digital-employees.json`（`TODO:` 占位，整文件拒绝直到填好）。
- 工具授权接受主体输入：工具可声明 `requiredPermission`，声明了就以岗位权限为准；数字员工调用未声明 `requiredPermission` 的工具一律拒绝；数字员工调用 `l2_soft` 及以上风险的工具一律需要审批。人类调用未声明 `requiredPermission` 的工具仍按原企业角色规则（过渡回退）。
- 数字员工发起的审批：新增统一入口，创建的 PendingAction 归属 sponsor、指定审批人为 sponsor、标记 `actorType = agent`，审批人永远不是数字员工本身；审计 correlation 记录 `actorKind = digital_employee`、Agent id / 名称、岗位、sponsor，审计日志列表接口为这类记录返回"数字员工 X 代 岗位 Y"的展示文本。
- 锁住助手模式：主助手与运行时 v2 的执行主体仍是发起操作的人（HUMAN），加契约测试。

## Capabilities

### New Capabilities
- `authorization/digital-employee-principal`: 数字员工主体解析、有效权限来源、sponsor 数据范围、禁区与岗位映射
- `agents/tool-authorization`: 工具授权按主体与 `requiredPermission` 判定、数字员工的审批与回退规则、助手模式主体不变
- `agents/digital-employee-approval`: 数字员工发起的审批归属与审批人规则、审计标记与展示

### Modified Capabilities
- `authorization/position-binding`: 绑定脚本支持数字员工主体类型（参数、校验、审计）
- `authorization/position-catalog`: 禁区键只允许人类主体的登记

## Out of scope

- 数字员工的技能包、调度、预算与 workforce runtime 本身（不改 `src/lib/workforce-runtime/**` 的调度 / lease）；不新建员工表或任何 Prisma 字段。
- 把现有运行时（`agent-runtime-v2`、`agent-core` 引擎、跟进任务）改为以数字员工为主体执行：今天它们都以发起人（HUMAN）为主体，本次只加主体输入通路与契约，不切换任何现有调用点。
- owner 在界面上绑数字员工（拍板 4，留 PERM-6）；外贸模块工具；数字员工 env 开关 `src/lib/digital-employees/activation.ts` 不改。
- 现有工具定义不批量补 `requiredPermission`（本次只给类型与判定；逐工具补键随工具切到数字员工时做）。

## Impact

- `src/lib/authorization/`：`permissions.ts`（禁区元数据）、`authorize.ts`、`resolve-principal.ts`、`resolve-effective-permissions.ts`、`position-binding.ts`、新 `digital-employee.ts`；`__tests__/authorize.test.ts`
- `src/lib/agent-core/skills/digital-employee-roles.ts`（岗位映射）、`src/lib/agent-core/types.ts`（`requiredPermission`）
- `src/lib/tenancy/tool-auth.ts`（主体输入；现有调用点不传 → 行为不变）
- `src/lib/approval/`（数字员工审批入口）、`src/lib/audit/logger.ts`（correlation 字段）、`src/app/api/audit-logs/route.ts`（展示文本）
- `scripts/bind-positions.ts`、`config/positions/sunny-digital-employees.json`
- 新测试：`src/lib/authorization/__tests__/digital-employee.test.ts`（纯）、`src/lib/authorization/__tests__/digital-employee-db.isolated.test.ts`（隔离库）
- 零 schema；人类用户路径不变；生产上线前不需要任何数据动作（没有数字员工绑定 = 和今天一样全拒）
