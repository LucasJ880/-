# Tasks

## 1. 授权层

- [ ] 1.1 `permissions.ts` 加禁区规则（D1），命中键 `allowedPrincipalTypes = ["HUMAN"]`；`authorize.ts`：`decideFromBindings` 先判主体类型（`PRINCIPAL_TYPE_NOT_ALLOWED`），`scopeMatchesResource` 按 sponsor 判 PRINCIPAL / ASSIGNED（D2），去掉 `authorize()` 的非 HUMAN 早退；`authorize.test.ts` 的"数字员工未实现"用例改为新语义并加禁区元数据用例。verify：`npx tsx src/lib/authorization/__tests__/authorize.test.ts` 通过；typecheck。
- [ ] 1.2 主体解析与有效权限（D2 / D3）：`resolvePrincipalRef` 对 `DIGITAL_EMPLOYEE` 要求 sponsor（否则 `SPONSOR_REQUIRED`）；新建 `src/lib/authorization/digital-employee.ts`（`resolveDigitalEmployeePrincipal`、`DIGITAL_EMPLOYEE_POSITION_KEYS`、`describeAuditActor`、`digitalEmployeeCorrelation`）；`resolveEffectiveBindings` 对数字员工只读自身绑定、无回退；新增 `resolvePermissionKeys(principal)`；`DIGITAL_EMPLOYEE_ROLES[].positionKey`。verify：`grep -rn 'principal.type !== "HUMAN"' src/lib/authorization --include=*.ts | grep -v __tests__` 只剩一处；typecheck。

## 2. 工具授权

- [ ] 2.1 `ToolDefinition.requiredPermission?`；`canInvokeTool` 加可选 `principal`（D4）：`requiredPermission` 判定、数字员工无 `requiredPermission` 拒绝、数字员工 `l2_soft+` 必审；不传主体行为不变。verify：tenancy 已注册测试（`b1-tenant-authz`、`phase2a-rules-tools`、`phase2b-semantics`）通过；typecheck。

## 3. 审批与审计

- [ ] 3.1 新建 `src/lib/approval/digital-employee.ts` `requestDigitalEmployeeApproval`（D5）；`AuditLogParams.correlation` 加 `actorKind` / `agentName` / `positionKey` / `sponsorUserId`；`/api/audit-logs` 响应追加 `actorDisplay`（D6）。verify：`npx tsx src/lib/runtime-architecture/__tests__/*.test.ts` 中守卫测试通过（不新增 PendingAction 直写）；typecheck。

## 4. 绑定脚本

- [ ] 4.1 `position-binding.ts` 加 `validateDigitalEmployeeBindings`；`scripts/bind-positions.ts` 加 `--principal-type`（D7），既有绑定按主体类型过滤、审计带主体类型与 Agent 名；新建 `config/positions/sunny-digital-employees.json`（`TODO:` 占位）。verify：`npx tsx src/lib/authorization/__tests__/position-binding.test.ts` 通过；`ALLOW_POSITION_BINDING=true npx tsx scripts/bind-positions.ts --org x --file config/positions/sunny-digital-employees.json --actor a@b --principal-type GROUP` 退出码 2。

## 5. 测试与收尾

- [ ] 5.1 新建 `src/lib/authorization/__tests__/digital-employee.test.ts`（纯：禁区、sponsor 范围、工具授权主体分支、审计展示、绑定校验、角色映射、助手主体契约）注册 test-all 与 test:ci；新建 `src/lib/authorization/__tests__/digital-employee-db.isolated.test.ts`（隔离库：主体解析失败四种、绑定后授权、无回退、审批归属与审批人、审计 correlation）注册 test-all。verify：本地 Postgres 隔离库跑通；`bash scripts/check-test-registry.sh` 通过。
- [ ] 5.2 `npm run typecheck`、`npm run lint:baseline`、`npm run test:ci`、`bash scripts/check-test-registry.sh` 全通过；`openspec validate perm-5b-digital-employee-positions --strict` 通过；写 `docs/QINGYAN_PERM-5b_REPORT.md`；`docs/QINGYAN_PERMISSION_TASKFLOW.md` PERM-5b 改 `[G]`；更新 `docs/QINGYAN_PERMISSION_HANDOFF.md`。verify：四条命令退出 0；`grep -c "PERM-5b .*\[G\]" docs/QINGYAN_PERMISSION_TASKFLOW.md` 为 1。

## Workflow follow-up

- PR 合并后 `/opsx:archive perm-5b-digital-employee-positions --yes`（独立小 PR），TASKFLOW PERM-5b 改 `[x]`；确认 `openspec list --specs` 出现 `authorization/digital-employee-principal`、`agents/tool-authorization`、`agents/digital-employee-approval`。
- 生产：无需数据动作；真要启用某个数字员工时，平台管理员填 `config/positions/sunny-digital-employees.json` 后跑脚本。
