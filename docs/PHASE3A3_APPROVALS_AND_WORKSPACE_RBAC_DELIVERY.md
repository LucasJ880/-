# Phase 3A-3 交付说明：统一审批中心与 Workspace RBAC

## 摘要

| 项 | 值 |
|---|---|
| 分支 | `feature/phase3a-3-approvals-workspace-rbac` |
| 基线 | main @ `46a9574`（PR #9） |
| Migration | `20260722198000_phase3a3_approvals_integrity` |
| Commit | （见 PR） |

## Schema / Migration

- `PendingAction` 可空：`workspaceId`, `payloadVersion`, `payloadHash`, `policyVersion`, `resourceVersion`
- 新表：`ApprovalDecisionIdempotency`（`orgId + idempotencyKey` UNIQUE）
- **未**删除旧审批表；**未**物理合表；**未**改 WorkspaceMember 为 enum

回滚：DROP `ApprovalDecisionIdempotency`；DROP PendingAction 新列。

## Approval adapters

| 源 | 文件 | org 策略 |
|---|---|---|
| PENDING_ACTION | `approvals/adapters.ts` | 无 orgId 不投影 |
| APPROVAL_REQUEST | 同上 | `task.project.orgId` JOIN |
| PRODUCT_CONTENT | 同上 | 直接 orgId |

统一状态仅展示；执行仍走 ApprovalPort / `decideApproval` / PendingAction executor（**未重写**）。

## RBAC 权限矩阵

`src/lib/tenancy/workspace-rbac.ts`：viewer / member / editor / manager / workspace_admin  
历史别名映射；未识别→viewer；Org Admin 无 WS membership 默认不能批准业务动作。

## canInvokeTool 变化

- 新增 `workspaceRole` / `workspaceToolPolicy`
- 返回 `allowed` / `requiresApproval` / `reasonCode` / `appliedPolicies`（保留 `ok`/`needsApproval` 兼容）
- Workspace 只能收紧；`l3_strong` 不因 workspace_admin 免审
- ToolRegistry 传入 `workspaceId` / `workspaceRole`

## 页面与 API

- `/capabilities/approvals`、`/capabilities/approvals/[approvalId]`
- `GET/POST /api/capabilities/approvals...`（approve/reject/cancel/retry）
- 不支持的操作返回 `capability_denied`

## 审计

`APPROVAL_CREATED/APPROVED/REJECTED/CANCELLED/EXECUTION_*`、`APPROVAL_VIEWED_SENSITIVE`、`TOOL_AUTH_DENIED`  
不写完整敏感 payload。

## 并发与幂等

- 条件更新 cancel
- `ApprovalDecisionIdempotency` 防重复决定
- payloadHash 变更阻断执行

## 测试

- `phase3a3-approvals-rbac.test.ts`
- 既有 3A-1 / 3A-2 / smoke 需保持通过

## 已知限制

1. ApprovalRequest 无原生 orgId 列（JOIN 封堵）
2. PC / AR 的 cancel/retry 能力有限（如实声明）
3. Org Admin「显式配置为审批人」仅复用既有 approverUserId，无新政策 UI
4. 完整 multi-approver / Quota / 治理中心未做
5. createDraft 新字段写入；历史草稿可能无 hash（校验时跳过缺失）

## Phase 3A-4 建议

- 治理中心最小面（政策版本、runVisibility 配置 UI）
- ApprovalRequest.orgId 可空列回填
- 审批补偿队列与 EXECUTION_BLOCKED 标准化
- Workspace 成员管理 API + 审计完整接线
