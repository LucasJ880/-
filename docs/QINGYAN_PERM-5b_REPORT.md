# PERM-5b 报告 — 数字员工岗位绑定与工具授权

change：`openspec/changes/perm-5b-digital-employee-positions/`（proposal / specs ×5 / design / tasks 8/8）
任务书：`docs/QINGYAN_PERM-5_ACCOUNTING_DIGITAL_EMPLOYEE_TASKBRIEF.md` PERM-5b 段（拍板见末尾"拍板结果 · PERM-5"）
零 schema：数字员工复用 `Agent`；绑定用既有 `PrincipalRoleBinding.principalType` 字符串；sponsor 用 `Agent.createdById`；审计标记落 `AuditLog.afterData._runtimeCorrelation`。

## 1. 做了什么

### 1.1 授权层（C8）
- **主体解析**：`resolveDigitalEmployeePrincipal({ agentId, orgId })`——Agent 须 active、所属项目在当前企业、创建人（sponsor）是该企业 active 成员；否则 `AGENT_NOT_FOUND / AGENT_INACTIVE / AGENT_ORG_MISMATCH / SPONSOR_NOT_MEMBER`。`resolvePrincipalRef` 对 `DIGITAL_EMPLOYEE` 无 sponsor → `SPONSOR_REQUIRED`；`authorize()` 去掉非 HUMAN 早退。
- **有效权限**：数字员工只读 `principalType = "DIGITAL_EMPLOYEE"` 的自身绑定——无平台管理员全权、无成员角色兼容回退、不继承 sponsor 岗位。没有绑定 = 和今天一样全拒。
- **数据范围（拍板 1）**：`PRINCIPAL` / `ASSIGNED` 按 sponsor 判——销售数字员工只碰 sponsor 名下的客户 / 报价；资源 owner = Agent id 本身不算。
- **禁区**：权限目录元数据统一标 HUMAN only，`authorize` 先判主体类型（`PRINCIPAL_TYPE_NOT_ALLOWED`），绑了也拒：

| 规则 | 命中键（当前） |
|---|---|
| 以 `.approve` 结尾 | `sales.quote.discount.over_limit.approve`、`sales.quote.signed_amount.approve`、`operations.content.approve` |
| `sales.quote.discount.*` | `…over_limit.submit` / `…over_limit.approve` |
| `identity.*` | `identity.member.read` / `.manage`、`identity.role.manage`、`identity.position.manage` |
| 精确键 | `sales.quote.pricing_close`、`sales.settings.manage`、`organization.settings.manage`、`authorization.policy.manage`、`install.task.assign`、`orders.cancel`、`inventory.manage`、`operations.manage` |

新加的 `*.approve` / `identity.*` / `sales.quote.discount.*` 键自动进禁区。
- **岗位映射**：`DIGITAL_EMPLOYEE_ROLES[].positionKey`——销售 → `sales_rep`、营销增长 → `ops_staff`、投标 → `bids`、数据分析 → `accounting`。
- **允许键集合**：`resolveAllowedPermissionKeys(principal)`（排除 DENY 与禁区），供工具授权用。

### 1.2 工具授权（C9）
`canInvokeTool` 新增可选 `principal: { type, permissionKeys }`；`ToolDefinition` 新增可选 `requiredPermission`：
- 声明了 `requiredPermission` 且给了权限键 → 以岗位权限为准（缺 → `permission_denied`），不再看 `allowRoles`；
- 数字员工调用未声明 `requiredPermission` 的工具 → `permission_required`（不回退角色白名单）；
- 数字员工调用 `l2_soft` / `l3_strong` → 一律需审批；`l0` / `l1` 按原规则；
- 不传 `principal` = 人类，结果与之前一致（5 个现有调用点都没改）。成员、企业禁用、模块、工作区、viewer 收紧照旧对数字员工生效（`orgRole` 填 sponsor 的）。

### 1.3 数字员工审批与审计
- `requestDigitalEmployeeApproval`（`src/lib/approval/digital-employee.ts`）：先解析主体（失败不建），PendingAction **归属与审批人都是 sponsor**，`actorType = agent`，`payload.metadata._digitalEmployee = { agentId, agentName, positionKey, sponsorUserId }`；只允许代四个数字员工岗位（否则 `POSITION_NOT_ALLOWED`）。批准前零出站（只建 PendingAction）。
- `AuditLogParams.correlation` 加 `actorKind / agentName / positionKey / sponsorUserId`；`digitalEmployeeCorrelation()` 构造。审计日志列表（`/api/audit-logs` 两条查询路径）为数字员工记录追加 `actorDisplay: "数字员工 X 代 岗位 Y"`，列表仍不返回 `afterData`。

### 1.4 绑定脚本
`scripts/bind-positions.ts --principal-type DIGITAL_EMPLOYEE`：文件键为 Agent id；只允许四岗；Agent 不存在 / 非 active / 跨企业 / 岗位未落地 → 退出 2；人类与数字员工绑定互不读取、互不停用；审计 `after` 带 `principalType` 与 Agent 名。占位配置 `config/positions/sunny-digital-employees.json`（4 条 `TODO:`，整文件拒绝直到填好）。

## 2. 怎么验

| 项 | 结果 |
|---|---|
| `npm run typecheck` | 0 error |
| `npm run lint:baseline` | PASS（改动文件 eslint 0 warning） |
| `npm run test:ci` | PASS（CI unit subset，含新 `digital-employee.test`、runtime-architecture 守卫） |
| `bash scripts/check-test-registry.sh` | OK（446） |
| `bash scripts/test-runtime-architecture.sh` | PASS（未新增 PendingAction 直写） |
| `openspec validate perm-5b-digital-employee-positions --strict` | valid |
| `authorize.test` | 88 → **120**：禁区元数据 16 键 + 全部 `*.approve`；数字员工绑 accounting 不能安排安装、人类可以；永不审批；sponsor 范围命中 / 越界 / Agent 自身不算；无 sponsor 无可用范围；无绑定 `NO_BINDING`；`SPONSOR_REQUIRED` 不读库 |
| `digital-employee.test`（新，纯） | **50 / 50**：主体解析决策 6 种；角色映射；工具授权主体分支 12 条（不传主体不变、人类按键、数字员工无键 / 未声明 / 缺键拒、l2 / l3 必审、l0 / l1 不强制、viewer / 无成员收紧）；审批映射（归属 / 审批人 = sponsor）；审计展示（对象 / 落库字符串 / 人类无）；绑定校验 7 条；助手模式主体 = 操作者（运行时 v2 / 引擎 / registry / 跟进任务不以数字员工执行） |
| `digital-employee-db.isolated.test`（新，本地 Postgres 16） | **34 / 34**：主体解析 5 种；无绑定全拒（sponsor 有岗也不继承、平台管理员建的也无全权）；绑定 sales_rep 后读 sponsor 客户 PRINCIPAL 命中、读他人 403、超限折扣禁区；允许键集合；accounting 数字员工 `install.task.assign` 禁区、人类会计放行；审批 PendingAction 归属 = 审批人 = sponsor、metadata、停用 Agent / 代 owner 不建；审计 `actorDisplay`；脚本（占位 / 绑 owner / 跨企业 退 2；合法写入 + 审计 + 幂等；人类 `--prune` 不动数字员工绑定） |
| 回归 | tenancy（b1 23、phase2a 23、phase2b 25、tenant-context 28）、phase3a3-approvals-rbac 34、t5-execution-policy 41、m2c-tool-policy 105、m1-gateway 70、position-binding 18 |
| 验收 grep | `grep -rn 'principal.type !== "HUMAN"' src/lib/authorization`（非测试）只剩 `resolveEffectiveBindings` 对未知主体类型 fail-closed 一处 |

## 3. 判断点（拍板，2026-10-28）

1. 销售数字员工的 PRINCIPAL 范围落在 sponsor 名下（sponsor = Agent 创建人）。
4. 数字员工绑定只由平台管理员跑脚本；owner 界面绑定留 PERM-6。

（2、3 属 5a。）实施中补的设计选择：审批人 = sponsor（PendingAction 只有一个审批人列，多收件人要新表；sponsor 就是对该数字员工负责、数据范围所在的人，design D5）；数字员工 `l1_internal_write` 不强制审批（任务书"≥ medium"对应规范化 `sensitive_write` = `l2_soft`，design D4）。

## 4. 已知限制与上线顺序

- **今天没有任何运行时以数字员工为主体执行**：主助手、运行时 v2、跟进任务、workforce resume 都以发起人（HUMAN）为主体，本次没切换它们。本次交付的是授权通路、禁区、工具授权分支、审批入口与审计标记；第一个以数字员工身份跑的调用点接入时，传 `resolveDigitalEmployeePrincipal` 的主体、`resolveAllowedPermissionKeys` 的键，走 `requestDigitalEmployeeApproval`。
- sponsor 绑在 Agent 创建人：要让 Alex 当销售数字员工的 sponsor，Agent 需由 Alex 创建；平台管理员代建的 Agent，其 PRINCIPAL 数据落在平台管理员名下（通常为空，等价于收紧）。
- 现有 `ToolDefinition` 都没有 `requiredPermission`，所以数字员工今天调用任何工具都会 `permission_required`——逐工具补键随工具开放给数字员工时做。
- **上线**：无需数据动作（没有数字员工绑定 = 与今天一样全拒）。真要启用：填 `config/positions/sunny-digital-employees.json` 的 Agent id → `--dry-run` → 执行。

## 5. 合并后

`/opsx:archive perm-5b-digital-employee-positions --yes` 独立小 PR；`openspec list --specs` 应出现 `authorization/digital-employee-principal`、`agents/tool-authorization`、`agents/digital-employee-approval`；TASKFLOW PERM-5b → `[x]`。
