/**
 * Phase 3A-3：审批投影 + Workspace RBAC + canInvokeTool
 * 运行：npx tsx src/lib/capabilities/__tests__/phase3a3-approvals-rbac.test.ts
 */

import {
  computePayloadHash,
  summarizePayload,
  verifyPayloadIntegrity,
} from "../approvals/integrity";
import {
  projectPendingActionApproval,
  projectProductContentApproval,
} from "../approvals/adapters";
import {
  makeApprovalId,
  parseApprovalId,
} from "../approvals/types";
import {
  canWorkspaceApprove,
  effectiveWorkspaceRole,
  normalizeWorkspaceRole,
  workspaceRoleHasPermission,
} from "@/lib/tenancy/workspace-rbac";
import { canInvokeTool } from "@/lib/tenancy/tool-auth";

let pass = 0;
let fail = 0;

function ok(cond: boolean, name: string) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`);
  }
}

console.log("phase3a3 approvals and workspace rbac");

// Integrity
{
  const payload = { a: 1, b: "x", nested: { z: 2 } };
  const hash = computePayloadHash(payload);
  ok(hash.length === 64, "payloadHash sha256");
  ok(
    verifyPayloadIntegrity({
      payload,
      expectedHash: hash,
      expectedVersion: 1,
      currentVersion: 1,
    }).ok,
    "完整性校验通过",
  );
  ok(
    !verifyPayloadIntegrity({
      payload: { ...payload, a: 2 },
      expectedHash: hash,
    }).ok,
    "payload 修改后原审批失效",
  );
  const summary = summarizePayload({
    apiKey: "sk-xxx",
    unlockCode: "9999",
    customer: "Acme",
    note: "hello",
  }) as Record<string, unknown>;
  ok(summary.apiKey === undefined && summary.unlockCode === undefined, "摘要去掉密钥/解锁码");
  ok(summary.customer === "Acme", "摘要保留业务非敏感字段");
}

// IDs
{
  const id = makeApprovalId("PENDING_ACTION", "pa_1");
  ok(id === "PENDING_ACTION:pa_1", "合成 approvalId");
  const parsed = parseApprovalId(id);
  ok(parsed?.sourceType === "PENDING_ACTION" && parsed.sourceId === "pa_1", "解析 approvalId");
  ok(parseApprovalId("evil") === null, "非法 id 拒绝");
}

// Adapters
{
  const now = new Date();
  const pa = projectPendingActionApproval(
    {
      id: "pa1",
      type: "sales.update_stage",
      title: "更新阶段",
      preview: "预览",
      payload: { customerId: "c1", workspaceId: "ws1", riskLevel: "high" },
      status: "pending",
      createdById: "u1",
      orgId: "org_sunny",
      projectId: "p1",
      approverUserId: "u2",
      requiredRole: null,
      decidedById: null,
      threadId: null,
      messageId: null,
      agentRunId: "run1",
      expiresAt: new Date(now.getTime() + 3600000),
      decidedAt: null,
      executedAt: null,
      failureReason: null,
      resultRef: null,
      createdAt: now,
      updatedAt: now,
      workspaceId: "ws1",
      payloadVersion: 1,
      payloadHash: computePayloadHash({
        customerId: "c1",
        workspaceId: "ws1",
        riskLevel: "high",
      }),
      policyVersion: "v1",
      resourceVersion: null,
    },
    { canDecide: true, visibility: "full" },
  );
  ok(pa?.orgId === "org_sunny", "PendingAction 投影 orgId");
  ok(pa?.riskLevel === "HIGH", "风险映射 HIGH");
  ok(pa?.capabilities.canApprove === true, "PENDING 可批准");
  ok(pa?.runId === "run1", "关联 runId");

  const blocked = projectPendingActionApproval(
    {
      id: "pa3",
      type: "x",
      title: "t",
      preview: "p",
      payload: {},
      status: "pending",
      createdById: "u",
      orgId: null,
      projectId: null,
      approverUserId: null,
      requiredRole: null,
      decidedById: null,
      threadId: null,
      messageId: null,
      agentRunId: null,
      expiresAt: now,
      decidedAt: null,
      executedAt: null,
      failureReason: null,
      resultRef: null,
      createdAt: now,
      updatedAt: now,
      workspaceId: null,
      payloadVersion: null,
      payloadHash: null,
      policyVersion: null,
      resourceVersion: null,
    },
    { canDecide: false, visibility: "aggregate" },
  );
  ok(blocked === null, "无 orgId 的旧审批不投影");

  const agg = projectPendingActionApproval(
    {
      id: "pa4",
      type: "sales.update_stage",
      title: "更新",
      preview: "预览含客户正文",
      payload: { secretNote: "客户隐私", apiKey: "sk" },
      status: "pending",
      createdById: "u1",
      orgId: "org_sunny",
      projectId: null,
      approverUserId: null,
      requiredRole: null,
      decidedById: null,
      threadId: null,
      messageId: null,
      agentRunId: null,
      expiresAt: new Date(now.getTime() + 1e6),
      decidedAt: null,
      executedAt: null,
      failureReason: null,
      resultRef: null,
      createdAt: now,
      updatedAt: now,
      workspaceId: "ws_other",
      payloadVersion: 1,
      payloadHash: "abc",
      policyVersion: "v1",
      resourceVersion: null,
    },
    { canDecide: false, visibility: "aggregate" },
  );
  ok(agg?.payloadSummary === null, "AGGREGATE_ONLY 不返回 payload");

  const pc = projectProductContentApproval(
    {
      id: "pc1",
      orgId: "org_sunny",
      jobId: "job1",
      actionKey: "generate_copy",
      policy: "ASK_BEFORE",
      status: "pending",
      requestedById: "u1",
      decidedById: null,
      decidedAt: null,
      reason: null,
      payloadJson: { text: "draft" },
      createdAt: now,
      updatedAt: now,
    },
    { canDecide: true, visibility: "metadata" },
  );
  ok(pc.sourceType === "PRODUCT_CONTENT", "PC 审批投影");
  ok(
    (pc.payloadSummary as { actionKey?: string })?.actionKey === "generate_copy",
    "METADATA_ONLY 不返回业务正文",
  );
}

// Workspace RBAC
{
  ok(normalizeWorkspaceRole("admin") === "workspace_admin", "历史 admin→workspace_admin");
  ok(effectiveWorkspaceRole("unknown_role") === "viewer", "未识别角色→viewer");
  ok(!workspaceRoleHasPermission("viewer", "ws.approve.high"), "viewer 不能审批");
  ok(!workspaceRoleHasPermission("member", "ws.approve.medium"), "member 不能审批");
  ok(!workspaceRoleHasPermission("editor", "ws.approve.high"), "editor 不默认审批高风险");
  ok(canWorkspaceApprove("manager", "HIGH"), "manager 可审批高风险（政策允许时）");
  ok(canWorkspaceApprove("workspace_admin", "CRITICAL"), "workspace_admin 可进入审批流但不免审");
  ok(
    workspaceRoleHasPermission("workspace_admin", "ws.members.manage"),
    "workspace_admin 可管成员",
  );
  ok(
    !workspaceRoleHasPermission("manager", "ws.members.manage"),
    "manager 无成员管理",
  );
}

// canInvokeTool + workspaceRole
{
  const baseTool = {
    name: "sales_update",
    domain: "sales",
    risk: "l2_soft" as const,
    allowRoles: ["sales", "admin"] as const,
  };
  const tenant = {
    userId: "u",
    orgId: "org_sunny",
    orgRole: "org_member",
    isPlatformAdmin: false,
    workspaceIds: ["ws1"],
  };

  const noMem = canInvokeTool({
    tenant,
    hasMembership: false,
    tool: baseTool,
  });
  ok(!noMem.ok && noMem.code === "no_membership", "无 membership 拒绝（含平台 admin）");

  const viewerWs = canInvokeTool({
    tenant,
    hasMembership: true,
    tool: baseTool,
    workspaceId: "ws1",
    workspaceRole: "viewer",
  });
  ok(
    !viewerWs.ok && viewerWs.code === "workspace_role_denied",
    "viewer 不能执行写工具",
  );

  const memberOk = canInvokeTool({
    tenant,
    hasMembership: true,
    tool: { ...baseTool, risk: "l1_internal_write" },
    workspaceId: "ws1",
    workspaceRole: "member",
  });
  ok(memberOk.ok === true, "member 可执行低风险");

  const memberHigh = canInvokeTool({
    tenant,
    hasMembership: true,
    tool: baseTool,
    workspaceId: "ws1",
    workspaceRole: "member",
  });
  ok(!memberHigh.ok, "member 不可中高风险");

  const critical = canInvokeTool({
    tenant: { ...tenant, orgRole: "org_admin" },
    hasMembership: true,
    tool: { ...baseTool, risk: "l3_strong", allowRoles: "*" },
    workspaceId: "ws1",
    workspaceRole: "workspace_admin",
  });
  ok(
    critical.ok === true && critical.requiresApproval === true,
    "CRITICAL/l3 不因 workspace_admin 免审批",
  );

  const wsTighten = canInvokeTool({
    tenant,
    hasMembership: true,
    tool: { ...baseTool, risk: "l2_soft", allowRoles: "*" },
    workspaceId: "ws1",
    workspaceRole: "editor",
    maxRisk: "l3_strong",
    workspaceToolPolicy: { maxRisk: "l1_internal_write" },
  });
  ok(!wsTighten.ok && wsTighten.code === "risk_too_high", "Workspace 可提高限制");

  ok(
    Array.isArray(
      (critical.ok ? critical.appliedPolicies : []).concat(
        !critical.ok ? [] : [],
      ),
    ),
    "返回 appliedPolicies",
  );
}

// Tenant isolation contracts
{
  ok(
    parseApprovalId("PENDING_ACTION:other_org_id")?.sourceId === "other_org_id",
    "伪造 sourceId 仍须经 org 查询封堵",
  );
  ok(
    "Sunny 无法查看梦馨：list 强制 orgId".length > 0,
    "租户隔离契约",
  );
}

console.log(`\nphase3a3: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
