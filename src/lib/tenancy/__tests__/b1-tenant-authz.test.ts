/**
 * B1 — Tenant/AuthZ 安全矩阵（纯函数：不触 DB / 模型 / 网络）。
 * 运行：npx tsx src/lib/tenancy/__tests__/b1-tenant-authz.test.ts
 *
 * 不变量：effectiveScope ⊆ authenticatedAuthorizedScope。
 * 覆盖任务矩阵中的 1/2/3/5/6/7/8/10/11/14/15（4/9/12 见静态测试与报告说明）。
 */
import { canInvokeTool } from "../tool-auth";
import {
  assertArgsMatchScopeGuard,
  runPreExecuteGuards,
} from "@/lib/agent-core/pre-execute-guard";
import type { ToolExecutionContext } from "@/lib/agent-core/types";
import { toAgentTenantRunFields } from "../agent-tenant-run-fields";
import type { AgentTenantResolved } from "../resolve-agent-tenant";

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

const ORG_A = "org_a_fixture";
const ORG_B = "org_b_fixture";
const USER_A = "user_a_fixture";

const readTool = { name: "sales_get_pipeline", domain: "sales" as const, risk: "l0_read" as const, allowRoles: ["admin", "sales"] as const };
const draftTool = { name: "sales_update_followup", domain: "sales" as const, risk: "l2_soft" as const, allowRoles: ["admin", "sales"] as const };

function memberTenant(over?: Partial<AgentTenantResolved>): AgentTenantResolved {
  return {
    orgId: ORG_A,
    orgRole: "org_member",
    hasMembership: true,
    isPlatformAdmin: false,
    modulesJson: null,
    industryPackId: null,
    workspaceIds: [],
    toolPolicy: {},
    ...over,
  } as AgentTenantResolved;
}

// ── 映射器：权威字段原样透传，永不放宽 ──────────────────────────────
{
  const t = memberTenant({ hasMembership: false, orgRole: "org_viewer" });
  const f = toAgentTenantRunFields(t);
  ok(f.hasMembership === false && f.orgRole === "org_viewer", "映射器不伪造 membership/orgRole（fail-closed 透传）");
  const t2 = memberTenant({ toolPolicy: { disabledTools: ["x"] }, workspaceIds: ["ws1"] });
  const f2 = toAgentTenantRunFields(t2);
  ok(f2.toolPolicy === t2.toolPolicy && f2.workspaceIds === t2.workspaceIds, "toolPolicy/workspaceIds 原样传递（策略不丢失）");
  ok(!("maxRisk" in f2) && !("isPlatformAdmin" in (f2 as Record<string, unknown>)), "映射器不额外注入授权字段（无越权面）");
}

// ── canInvokeTool（执行时授权；与暴露无关 → 覆盖矩阵 11）────────────
const baseInput = (over?: Record<string, unknown>) => ({
  tenant: { userId: USER_A, orgId: ORG_A, orgRole: "org_member", isPlatformAdmin: false, workspaceIds: [] as string[] },
  hasMembership: true,
  tool: readTool,
  ...over,
});

{
  const d = canInvokeTool(baseInput());
  ok(d.ok === true, "矩阵1：同 org 授权成员 + 域内只读工具 → 放行");
}
{
  const d = canInvokeTool(baseInput({ hasMembership: false }));
  ok(!d.ok && d.code === "no_membership", "矩阵8：缺权威 membership → no_membership fail-closed");
  const d2 = canInvokeTool(baseInput({ hasMembership: false, tenant: { userId: USER_A, orgId: ORG_A, orgRole: "org_admin", isPlatformAdmin: true, workspaceIds: [] } }));
  ok(!d2.ok && d2.code === "no_membership", "矩阵8/11：平台管理员无 membership 同样拒绝（暴露≠执行，执行边界独立生效）");
}
{
  const d = canInvokeTool(baseInput({ tenant: { userId: USER_A, orgId: ORG_A, orgRole: "sales", isPlatformAdmin: false, workspaceIds: [] } }));
  ok(!d.ok && d.code === "org_role_denied", "伪造/非法 orgRole → org_role_denied（不接受平台 role 词表）");
}
{
  const d = canInvokeTool(baseInput({ toolPolicy: { disabledTools: [readTool.name] } }));
  ok(!d.ok && d.code === "tool_disabled", "矩阵14：org toolPolicy.disabledTools 在执行层继续生效");
}
{
  const d = canInvokeTool(baseInput({ tool: draftTool, maxRisk: "l0_read" }));
  ok(!d.ok && d.code === "risk_too_high", "矩阵15a：maxRisk 上限不因 B1 放宽（l0 cap 挡 l2 工具）");
}
{
  const d = canInvokeTool(baseInput({ tool: draftTool, toolPolicy: { forceApprovalTools: [draftTool.name] } }));
  ok(d.ok === true && d.requiresApproval === true, "矩阵15b/16：forceApproval → requiresApproval=true（审批语义不降级、不新增旁路）");
}
{
  const viewer = canInvokeTool(baseInput({ tenant: { userId: USER_A, orgId: ORG_A, orgRole: "org_viewer", isPlatformAdmin: false, workspaceIds: [] }, tool: draftTool }));
  ok(!viewer.ok, "org_viewer 不得执行写类工具（fail-closed 保持）");
}

// ── scopeGuard（模型参数只可收窄、不可扩权 → 矩阵 2/3/5/6/7/10）──────
const guard = { orgId: ORG_A, principalUserId: USER_A, projectId: "proj_a", customerId: "cust_a" };
{
  const d = assertArgsMatchScopeGuard({}, guard);
  ok(d.ok, "矩阵2：不带范围参数（继承授权范围）→ 放行");
}
{
  const d = assertArgsMatchScopeGuard({ orgId: ORG_A, projectId: "proj_a", customerId: "cust_a" }, guard);
  ok(d.ok, "矩阵3：显式收窄到授权范围内（同 org/project/customer）→ 放行");
}
{
  const d = assertArgsMatchScopeGuard({ orgId: ORG_B }, guard);
  ok(!d.ok && d.code === "SCOPE_ORG_OVERRIDE", "矩阵5：模型参数尝试不同 orgId → DENY SCOPE_ORG_OVERRIDE");
}
{
  const d = assertArgsMatchScopeGuard({ projectId: "proj_other" }, guard);
  ok(!d.ok && d.code === "SCOPE_PROJECT_OVERRIDE", "矩阵6：未授权 projectId → DENY SCOPE_PROJECT_OVERRIDE");
}
{
  const d = assertArgsMatchScopeGuard({ customerId: "cust_other" }, guard);
  ok(!d.ok && d.code === "SCOPE_CUSTOMER_OVERRIDE", "矩阵7：未授权 customerId → DENY SCOPE_CUSTOMER_OVERRIDE");
}
{
  const d = assertArgsMatchScopeGuard({ userId: "someone_else" }, guard);
  ok(!d.ok && d.code === "SCOPE_USER_OVERRIDE", "矩阵10：合法用户会话内注入他人 userId → DENY SCOPE_USER_OVERRIDE");
}
{
  const d = assertArgsMatchScopeGuard({ orgId: "" }, { orgId: "", principalUserId: USER_A });
  ok(!d.ok && d.code === "SCOPE_MISSING", "scopeGuard 存在但 orgId 空 → SCOPE_MISSING fail-closed");
}

// ── registry 前置守卫端到端（allowlist + scopeGuard 组合）────────────
{
  const ctx = {
    args: { orgId: ORG_B },
    userId: USER_A,
    orgId: ORG_A,
    scopeGuard: guard,
    allowedToolNames: [readTool.name],
  } as unknown as ToolExecutionContext;
  const d = runPreExecuteGuards({ toolName: readTool.name, ctx });
  ok(!d.ok && d.code === "SCOPE_ORG_OVERRIDE", "runPreExecuteGuards 组合：allowlist 通过但跨 org 参数仍拒绝");
  const d2 = runPreExecuteGuards({ toolName: "not_in_list", ctx: { ...ctx, args: {} } as ToolExecutionContext });
  ok(!d2.ok && d2.code === "TOOL_NOT_ALLOWLISTED", "矩阵14b：allowlist 语义不变（名单外工具拒绝）");
}

console.log("");
console.log(`B1 tenant/authz 安全矩阵 结果: ${pass} 通过, ${fail} 失败`);
if (fail > 0) process.exit(1);
