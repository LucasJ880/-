# Phase 3A-3 设计说明：统一审批中心与 Workspace RBAC 兼容层

分支：`feature/phase3a-3-approvals-workspace-rbac`  
基线：main @ `46a9574`（PR #9 Phase 3A-2 合入后）

## 1. 目标与边界

### 目标

1. 企业能力中台统一审批入口 `/capabilities/approvals`
2. 经 ApprovalPort + adapter 投影多套审批来源（不迁超级审批表）
3. **不重写** PendingAction executor
4. WorkspaceMember 角色接入后端权限与 `canInvokeTool`
5. 决策与执行前重新验证权限 / 规则 / 完整性
6. 防篡改、防重复、防跨租户

### 非目标

重写 executor、审批物理合表、完整 Quota、治理中心、BPMN 设计器、自动批准高风险、Agent Builder、Eval、删历史审批模型、按租户复制审批代码。

---

## 2. 当前审批来源盘点

### 2.1 PendingAction

| 项 | 现状 |
|---|---|
| 表 | `PendingAction` |
| 状态 | `pending \| approved \| rejected \| executed \| failed`（过期→failed） |
| 执行 | `executePendingAction` / `rejectPendingAction`（**本阶段不重写**） |
| 租户 | `orgId?`、`projectId?`、`approverUserId?`；**无 workspaceId 列**（可从 payload 读） |
| 入口 | ApprovalPort `pending_action`；`/api/ai/pending-actions` |
| 中台 | `orgId` 为空 **不投影** |

### 2.2 ApprovalRequest

| 项 | 现状 |
|---|---|
| 表 | `ApprovalRequest`（挂 AgentTask/Step） |
| 状态 | `pending \| approved \| rejected \| expired \| escalated` |
| 执行 | `resolveApproval` + `resumeFlowAfterApproval` |
| 租户 | **无 orgId**；经 `task.project.orgId` **可信 JOIN** |
| 缺口 | inbox 历史无 org 过滤 → 3A-3 列表强制 JOIN |

### 2.3 Product Content 审批

| 项 | 现状 |
|---|---|
| 表 | `ProductContentApproval`（有 `orgId`） |
| 状态 | `pending \| approved \| rejected \| auto_allowed` |
| 执行 | `decideApproval` / job approve-deliver |
| 缺口 | **未**接 ApprovalPort；无 workspaceId |

### 2.4 ApprovalPort（现状）

`src/lib/approval/port.ts`：`listApprovalInbox` / `approveApprovalItem` / `rejectApprovalItem`  
Kind 仅：`pending_action | approval_request`  
3A-3：扩展投影与能力中台决策网关，底层仍调用 Port / 现有 PC decide，**不复制副作用逻辑**。

### 2.5 租户债与 JOIN

| 源 | orgId | workspaceId | 3A-3 策略 |
|---|---|---|---|
| PendingAction | 可空列 | payload 可选 | 无 orgId 不展示；WS 从 payload/project |
| ApprovalRequest | 无 | 无 | `project.orgId` JOIN；伪造 id→404 |
| ProductContent | 有 | 无 | 按 orgId；WS 过滤弱化 |

---

## 3. WorkspaceMember 与 canInvokeTool

### 3.1 角色字段

`WorkspaceMember.role`（String）：`workspace_admin | manager | editor | member | viewer`  
历史别名映射到标准角色；未识别 → **最小权限（viewer）或拒绝写操作**。

### 3.2 新模块

`src/lib/tenancy/workspace-rbac.ts`：角色规范化、权限矩阵、`getWorkspaceRole`、`assertWorkspacePermission`。

### 3.3 canInvokeTool 扩展

在现有路径上增加：

- `workspaceRole`
- Workspace Tool Policy（可提高限制，**不可降低** Org hard policy）
- 返回兼容字段：`allowed` / `requiresApproval` / `reasonCode` / `appliedPolicies`
- CRITICAL / `l3_strong`：**不因** workspace_admin 免审批
- 平台 admin 无 membership 仍拒绝

ToolRegistry 调用处传入 `workspaceId`（若上下文可得）。

---

## 4. 统一审批 Read Model

```ts
type ApprovalProjection = {
  id: string; // 合成：`${sourceType}:${sourceId}`
  sourceType: "PENDING_ACTION" | "APPROVAL_REQUEST" | "PRODUCT_CONTENT" | "OTHER";
  sourceId: string;
  orgId: string;
  workspaceId?: string;
  projectId?: string;
  traceId?: string;
  runId?: string;
  submittedById?: string;
  assignedApproverIds?: string[];
  actionType: string;
  resourceType?: string;
  resourceId?: string;
  riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  status: "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED" | "CANCELLED"
    | "EXECUTING" | "EXECUTED" | "EXECUTION_FAILED" | "EXECUTION_BLOCKED";
  decisionRequiredBy?: string;
  createdAt: string;
  decidedAt?: string;
  executedAt?: string;
  payloadSummary?: unknown;
  payloadVersion?: number;
  payloadHash?: string;
  executionStatus?: string;
  errorSummary?: string;
  capabilities: {
    canApprove: boolean;
    canReject: boolean;
    canCancel: boolean;
    canRetry: boolean;
  };
};
```

统一状态仅用于展示；底层状态机不变。

敏感字段：默认摘要；AGGREGATE_ONLY 无 payload；不返回密钥/解锁码/OAuth/API key。

---

## 5. 决策与执行职责边界

```
API 决策网关（capabilities）
  → TenantContext + membership + Workspace RBAC
  → 校验状态 / 过期 / payloadHash / policyVersion
  → 写审计 + decision idempotency
  → 调用 ApprovalPort / PC decide（不改 executor 内核）
  → 执行前再授权（Port 内 executor 已有部分校验；网关补 Workspace/规则）
  → EXECUTION_BLOCKED 映射为安全失败（权限移除 / Tool 停用 / 资源变化）
```

**批准 ≠ 无条件执行。** 前端传入的 orgId / workspaceRole / riskLevel / payload **不可信**；执行内容只从服务端已存版本读取。

---

## 6. 防篡改

创建/投影时固定（PendingAction 优先落库新可空列；历史可从 payload 计算）：

- `payloadVersion`
- `payloadHash`（canonical JSON SHA-256）
- `policyVersion`
- `resourceVersion?`

操作与执行前重算比对；不匹配 → 失效 / 要求重新提交。  
金额、收件人、文件、目标资源、Tool/规则风险升高、资源删除 → 原审批失效。

---

## 7. 并发与幂等

| 场景 | 方案 |
|---|---|
| 双人同时批准 | `updateMany` 条件 `status=pending`；仅 1 行生效 |
| 重复点击 / 重试 | `decisionIdempotencyKey` 唯一（新表或列） |
| 过期与批准竞态 | 过期条件更新优先；批准前再查 `expiresAt` |
| Worker 重复执行 | 已有 executor 状态门禁；网关不二次假装执行 |
| 响应丢失 | 幂等键重放返回同一结果 |

新表建议：`ApprovalDecisionIdempotency`（orgId + key UNIQUE，记录结果快照）。

---

## 8. Migration

名称：`20260722198000_phase3a3_approvals_integrity`（示例）

- `PendingAction` 可空：`workspaceId`, `payloadVersion`, `payloadHash`, `policyVersion`, `resourceVersion`
- 新表：`ApprovalDecisionIdempotency`
- **不改**历史 migration；**不删**旧审批表；不批量猜 orgId  
- 回滚：DROP 新表 + DROP 新列（说明文档）

WorkspaceMember.role 保持 String，兼容映射，不做破坏性 enum。

---

## 9. API / 页面

| Method | Path |
|---|---|
| GET | `/api/capabilities/approvals` |
| GET | `/api/capabilities/approvals/[approvalId]` |
| POST | `.../approve` `.../reject` `.../cancel` `.../retry` |

页面：`/capabilities/approvals`、`/capabilities/approvals/[approvalId]`  
标签：待我审批 / 我提交的 / 处理中 / 已批准 / 已拒绝 / 已执行 / 执行失败 / 已过期  

不支持的操作：adapter 返回 `capabilities.canX=false`，API 返回明确错误（勿假装全支持）。

---

## 10. Org Admin 可见性

沿用 AGGREGATE_ONLY / METADATA_ONLY / FULL。  
无目标 WS membership：可看数量与状态汇总；**默认不能**看完整 payload / 客户正文 / Tool 参数，**不能直接批准** Workspace 业务动作（除非显式配置为审批人并审计——本阶段用 `approverUserId` / org 级草稿既有规则，不新开「Org Admin 默认审批人」后门）。

---

## 11. 审计事件

`APPROVAL_*`、`WORKSPACE_ROLE_*`、`TOOL_AUTH_DENIED`  
经 `logAudit`；afterData 脱敏，无密钥/完整敏感 payload。

---

## 12. 明确不重写的执行器

- `src/lib/pending-actions/executor.ts`
- `src/lib/agent/approval.ts` 的副作用路径
- Product Content `jobs/runtime` / `approve-deliver` 内核

仅在其外包决策网关与投影层。
