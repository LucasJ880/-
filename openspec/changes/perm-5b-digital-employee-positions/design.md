# Design

## Context

- `authorize()` 对非 HUMAN 主体直接返回 `NOT_IMPLEMENTED`，`resolveEffectiveBindings` 对非 HUMAN 返回空；`resolvePrincipalRef` 对 `DIGITAL_EMPLOYEE` 同样 fail-closed（C8）。
- `PermissionDefinition.allowedPrincipalTypes` 已存在，但 `authorize()` 从不读它；只有三个键（`identity.position.manage`、`sales.quote.signed_amount.approve`、`operations.content.approve`）标了 HUMAN only。
- `PrincipalRoleBinding.principalType` 是字符串列，已能存 `DIGITAL_EMPLOYEE`；数字员工复用 `Agent`（`projectId` → `Project.orgId`，`createdById`，`status`）。
- `canInvokeTool` 是纯函数，按 `orgRole` / `allowRoles` / 工作区角色 / 风险判定（C9）；`ToolDefinition` 没有权限键字段。
- 现有所有运行时（agent-runtime-v2、agent-core 引擎、followup-task、workforce resume）都以发起人 HUMAN 为主体。没有任何调用点今天以数字员工为主体执行——本次补的是"通路 + 禁区 + 契约"，不是切换运行时。

## Goals / Non-Goals

**Goals**：数字员工可被解析为主体并按绑定岗位授权；禁区在授权层兜底；工具授权能按权限键判定且对数字员工收紧；数字员工审批的归属 / 审批人 / 审计标记固定下来；绑定脚本支持数字员工。

**Non-Goals**：
- 不改 `src/lib/agent-runtime-v2/executor.ts`、`src/lib/agent-core/engine.ts`、`src/lib/agent-core/tool-registry.ts`、`src/lib/assistant/followup-task.ts`、`src/lib/workforce-runtime/resume-freshness.ts` 中 `canInvokeTool` 的调用（不传主体 = 行为不变）。
- 不改 `src/lib/digital-employees/activation.ts`（env 开关）、`src/lib/agent-supervisor/**`。
- 不给现有 `ToolDefinition` 批量补 `requiredPermission`。
- 不改 `src/lib/pending-actions/executor.ts` 的批准资格判定。

## Decisions

### D1 禁区放进权限目录元数据，授权判定统一读 `allowedPrincipalTypes`
`permissions.ts` 新增 `DIGITAL_EMPLOYEE_DENIED`（键前缀 / 后缀 / 精确键规则），`def()` 按规则把命中键的 `allowedPrincipalTypes` 设为 `["HUMAN"]`。`decideFromBindings` 在看绑定之前查定义：主体类型不在允许列表 → `PRINCIPAL_TYPE_NOT_ALLOWED`。`grep 'principal.type !== "HUMAN"' src/lib/authorization` 只剩 `resolveEffectiveBindings` 对未知主体类型 fail-closed 那一处（sponsor 范围用 `=== "HUMAN"`）。
- 否决：在 `authorize()` 里另写一个硬编码 deny 列表——会与目录里已有的三个 HUMAN-only 键形成两套口径。
- 否决：从岗位模板里删掉禁区键（如 `accounting` 去掉 `install.task.assign`）——人类会计需要它，模板是人和数字员工共用的。

### D2 sponsor = Agent 创建人；PRINCIPAL / ASSIGNED 按 sponsor 判（拍板 1）
`resolveDigitalEmployeePrincipal({ agentId, orgId })` 读 Agent → 校验 active、`project.orgId === orgId`、创建人是该企业 active 成员，返回 `{ type: "DIGITAL_EMPLOYEE", id: agentId, orgId, sponsorUserId: createdById }`。`scopeMatchesResource` 用 `subjectId = principal.type === "HUMAN" ? principal.id : principal.sponsorUserId`。`resolvePrincipalRef` 对 `DIGITAL_EMPLOYEE` 无 sponsor → `SPONSOR_REQUIRED`。
- 否决：在绑定文件里另指定 sponsor——需要存 sponsor 的位置，`PrincipalRoleBinding` 无此列、违反零 schema；Agent 创建人已是既有字段。
- 否决：启用预留的 `SPONSOR` 数据范围——要改所有岗位模板的 scope，人类模板跟着受影响。
- 已知限制：Agent 由谁创建，sponsor 就是谁；要让 Alex 当 sponsor，Agent 需由 Alex 创建（报告写明）。

### D3 数字员工有效权限：只读自己的绑定，无回退
`resolveEffectiveBindings` 对 `DIGITAL_EMPLOYEE` 只查 `principalType = "DIGITAL_EMPLOYEE"` 的 active 绑定；不查 `User.role`（无平台管理员全权）、不走 `OrganizationMember.role` 兼容回退。另加 `resolveAllowedPermissionKeys(principal)`：把有效绑定压成"允许键集合"（去掉 DENY 与主体类型不允许的键），给工具授权用。
- 否决：数字员工权限 = sponsor 权限 ∩ 岗位——任务书要求"绑岗位"，sponsor 换岗会让数字员工权限隐式漂移。

### D4 工具授权：`principal` 可选输入 + `requiredPermission`
`CanInvokeToolInput.principal?: { type; permissionKeys }`；`ToolDefinition.requiredPermission?: string`。判定顺序：成员 / 企业禁用 / 模块 / 工作区（原样）→ 若 `tool.requiredPermission` 且有 `permissionKeys`：不含 → `permission_denied`，含 → 跳过 `allowRoles`；若主体是数字员工且工具无 `requiredPermission` → `permission_required`；否则原 `orgRole` / `allowRoles` 判定 → 风险上限（原样）→ 需审批：原条件 ∪（数字员工 且 风险 ≥ `l2_soft`）。数字员工的 `orgRole` 由调用方填 sponsor 的企业角色，viewer / 工作区角色收紧照旧生效（只收不放）。
- 否决：数字员工 `l1_internal_write` 也必审——内部写（如建跟进待办）本身不出站，且多数写工具已经只产出 PendingAction；任务书写的是"≥ medium"，对应规范化风险 `sensitive_write` 即 `l2_soft`。
- 否决：改所有调用点传 `principal`——今天没有数字员工主体在跑，改调用点只增加回归面。

### D5 数字员工审批：归属与审批人都是 sponsor
新增 `src/lib/approval/digital-employee.ts` `requestDigitalEmployeeApproval({ agentId, orgId, positionKey, ...canonicalInput })`：先 `resolveDigitalEmployeePrincipal`（失败不建），再调 `requestApproval`，`principal = { userId: sponsorUserId, actorType: "agent" }`，`approver.approverUserId = sponsorUserId`，`payload._digitalEmployee = { agentId, agentName, positionKey, sponsorUserId }`。审批人恒为人类 sponsor；断言 `approverUserId !== agentId`。
- 否决：审批人 = `listUsersWithPermission(岗位对应键)` 全集——PendingAction 只有一个审批人列，多收件人要新表或新路由（违反零 schema / 不新增 approval registry）；且 sponsor 正是"该岗位、对该数字员工负责的人"，数据范围也落在 sponsor 名下。
- 否决：让 Agent id 进 `createdById`——PendingAction 的收件箱、执行器都按 user id 工作，会让审批无人可见。

### D6 审计：correlation 加字段，列表接口出展示文本
`AuditLogParams.correlation` 增加 `actorKind`、`agentName`、`positionKey`、`sponsorUserId`（仍合并进 `afterData._runtimeCorrelation`，零 schema）；`digitalEmployeeCorrelation(principal, agentName, positionKey)` 构造。`/api/audit-logs` 响应为 `actorKind = digital_employee` 的记录追加 `actorDisplay: "数字员工 <名> 代 岗位 <key>"`（纯函数 `describeAuditActor(afterData)`）。
- 否决：新增 AuditLog 列——违反零 schema。

### D7 绑定脚本加 `--principal-type`
`position-binding.ts` 新增 `validateDigitalEmployeeBindings({ file, knownProfileKeys, agentsById })`（TODO 占位 / Agent 不存在 / 非 active / 跨企业 / 岗位不在四岗或未落地）；`planBindingDiff` 复用（以 agentId 当主体 id）。脚本按主体类型过滤既有绑定，审计 `after` 带 `principalType` 与 Agent 名。`config/positions/sunny-digital-employees.json` 四条 `TODO:` 占位。
- 否决：另写一个 `bind-digital-employees.ts`——两套入口、两套保护条件，任务书要求扩展现有脚本。

## 与八条硬纪律的关系

1. 零 schema：触碰。只用既有 `PrincipalRoleBinding.principalType` 字符串、`Agent.createdById`、`AuditLog.afterData`、`PendingAction` 既有列；不加字段。
2. 出站先审批：触碰。数字员工中高风险工具必审；数字员工审批入口只建 PendingAction，批准前零出站。
3. 第三套队列：不涉及（不新增 queue / scheduler / approval registry；审批复用 `requestApproval`）。
4. 脱敏：不涉及（不改 Muse 通道）。
5. 不爬登录页：不涉及。
6. 邮箱分离：不涉及。
7. 确定性优先：触碰。禁区、映射、范围判定都是查表；不新增 LLM 调用。
8. 测试注册：触碰。新测试注册 `scripts/test-all.sh`，纯测试同时进 `scripts/test-ci-unit.sh`。

## Risks / Trade-offs

- 禁区规则写成前缀 / 后缀，新加的 `*.approve` 键自动进禁区（期望行为）；新加的 `identity.*` 同理。
- sponsor 绑在 Agent 创建人：平台管理员代建的 Agent sponsor 是平台管理员 → 其 PRINCIPAL 数据是平台管理员名下（通常为空），等价于收紧，不会放大。
- `allowedPrincipalTypes` 判定对 HUMAN 恒通过，人类路径零变化（`authorize.test` 全部回归）。

## 验证方式

- `npx tsx src/lib/authorization/__tests__/authorize.test.ts`（禁区元数据、数字员工判定）
- `npx tsx src/lib/authorization/__tests__/digital-employee.test.ts`（新，纯：禁区规则、sponsor 范围、`canInvokeTool` 主体分支、`describeAuditActor`、绑定校验、角色映射、助手主体契约）
- `src/lib/authorization/__tests__/digital-employee-db.isolated.test.ts`（新，隔离库：主体解析四种失败、绑定后授权、无回退、审批归属 / 审批人、审计 correlation、脚本校验）
- 既有回归：tool-auth / tenancy 相关测试、`position-binding.test`、`runtime-architecture` 守卫
- `npm run typecheck`、`npm run lint:baseline`、`npm run test:ci`、`bash scripts/check-test-registry.sh`、`openspec validate perm-5b-digital-employee-positions --strict`
- 验收 grep：`grep -rn 'principal.type !== "HUMAN"' src/lib/authorization`（非测试）只剩未知主体类型 fail-closed 一处
