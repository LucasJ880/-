/**
 * P0-3 / P0-4：AgentScopeContext 纯逻辑校验 + Context org 收敛
 * 运行：npx tsx src/lib/agent-scope/__tests__/agent-scope.test.ts
 */

import {
  evaluateProjectScope,
  evaluateCustomerScope,
  evaluateWorkspaceScope,
  normalizeOrgRole,
  toScopeGuard,
} from "../resolve";
import type { AgentScopeContext } from "../types";
import { buildOrgScopedProjectWhere } from "@/lib/ai/context";

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

const ORG_A = "org_a";
const ORG_B = "org_b";
const USER = "u1";

console.log("P0-3: projectId 跨 org 拒绝（fail-closed）");
{
  const crossOrg = evaluateProjectScope(
    { orgId: ORG_B, ownerId: "u9", isMember: false },
    { orgId: ORG_A, userId: USER },
  );
  ok(!crossOrg.ok && crossOrg.code === "project_org_mismatch", "Org B 项目 → 拒绝");
  ok(!crossOrg.ok && crossOrg.status === 404, "跨 org 返回 404（不泄露存在性）");

  // 即使是本人拥有的其他 org 项目也拒绝
  const crossOrgOwn = evaluateProjectScope(
    { orgId: ORG_B, ownerId: USER, isMember: true },
    { orgId: ORG_A, userId: USER },
  );
  ok(!crossOrgOwn.ok, "本人拥有但属 Org B → 仍拒绝（无 silent fallback）");

  const missing = evaluateProjectScope(null, { orgId: ORG_A, userId: USER });
  ok(!missing.ok && missing.code === "invalid_project", "项目不存在 → 拒绝");

  const sameOrg = evaluateProjectScope(
    { orgId: ORG_A, ownerId: "u9", isMember: false },
    { orgId: ORG_A, userId: USER },
  );
  ok(sameOrg.ok && sameOrg.projectRole === "org", "同 org 经组织可见 → org 角色");

  const personal = evaluateProjectScope(
    { orgId: null, ownerId: USER, isMember: false },
    { orgId: ORG_A, userId: USER },
  );
  ok(personal.ok && personal.projectRole === "owner", "本人个人项目 → owner");

  const othersPersonal = evaluateProjectScope(
    { orgId: null, ownerId: "u9", isMember: false },
    { orgId: ORG_A, userId: USER },
  );
  ok(!othersPersonal.ok, "他人个人项目 → 拒绝");
}

console.log("P0-3: customerId 跨 org 拒绝 + sales own-scope");
{
  const crossOrg = evaluateCustomerScope(
    { orgId: ORG_B, createdById: USER, archived: false },
    { orgId: ORG_A, userId: USER, platformRole: "sales" },
  );
  ok(!crossOrg.ok && crossOrg.code === "customer_org_mismatch", "Org B 客户 → 拒绝");

  const notOwn = evaluateCustomerScope(
    { orgId: ORG_A, createdById: "u9", archived: false },
    { orgId: ORG_A, userId: USER, platformRole: "sales" },
  );
  ok(!notOwn.ok && notOwn.code === "customer_access_denied", "sales 非本人客户 → 拒绝");

  const adminAny = evaluateCustomerScope(
    { orgId: ORG_A, createdById: "u9", archived: false },
    { orgId: ORG_A, userId: USER, platformRole: "admin" },
  );
  ok(adminAny.ok, "admin 同 org 客户 → 放行");

  const archived = evaluateCustomerScope(
    { orgId: ORG_A, createdById: USER, archived: true },
    { orgId: ORG_A, userId: USER, platformRole: "sales" },
  );
  ok(!archived.ok && archived.code === "invalid_customer", "已归档 → 拒绝");
}

console.log("P0-3: workspace 跨 org 拒绝");
{
  const crossOrg = evaluateWorkspaceScope(
    { orgId: ORG_B, active: true },
    "member",
    { orgId: ORG_A, orgRole: "org_admin" },
  );
  ok(!crossOrg.ok && crossOrg.code === "workspace_org_mismatch", "Org B workspace → 拒绝");

  const noMember = evaluateWorkspaceScope(
    { orgId: ORG_A, active: true },
    null,
    { orgId: ORG_A, orgRole: "org_member" },
  );
  ok(!noMember.ok && noMember.code === "workspace_access_denied", "非成员且非 org_admin → 拒绝");

  const orgAdmin = evaluateWorkspaceScope(
    { orgId: ORG_A, active: true },
    null,
    { orgId: ORG_A, orgRole: "org_admin" },
  );
  ok(orgAdmin.ok && orgAdmin.workspaceRole === "workspace_admin", "org_admin 无成员记录 → workspace_admin");
}

console.log("P0-4: WorkContext org 收敛（activeOrg A 不加载 Org B）");
{
  const whereNormal = buildOrgScopedProjectWhere(
    { userId: USER, orgId: ORG_A },
    ["p1", "p2"],
  ) as { id?: { in: string[] }; OR: Array<Record<string, unknown>> };
  ok(Array.isArray(whereNormal.OR), "普通用户 where 含 org 收敛 OR");
  ok(
    whereNormal.OR.some((c) => c.orgId === ORG_A) &&
      !whereNormal.OR.some((c) => c.orgId === ORG_B),
    "OR 仅含当前 org（不含 Org B）",
  );
  ok(
    whereNormal.OR.some((c) => c.orgId === null && c.ownerId === USER),
    "个人项目仅限本人",
  );
  ok(whereNormal.id?.in.length === 2, "可见项目 ID 交集保留");

  // super_admin：visibleProjectIds === null，不再全库
  const whereSuper = buildOrgScopedProjectWhere(
    { userId: USER, orgId: ORG_A },
    null,
  ) as { id?: unknown; OR: Array<Record<string, unknown>> };
  ok(whereSuper.id === undefined, "super_admin 无 ID 白名单");
  ok(
    Array.isArray(whereSuper.OR) && whereSuper.OR.some((c) => c.orgId === ORG_A),
    "super_admin 仍被 org 收敛（不默认加载全部企业）",
  );
  ok(
    !JSON.stringify(whereSuper).includes(ORG_B),
    "super_admin where 不包含 Org B",
  );
}

console.log("辅助函数");
{
  ok(normalizeOrgRole("org_owner") === "org_admin", "org_owner → org_admin");
  ok(normalizeOrgRole("org_member") === "org_member", "org_member 不变");

  const scope: AgentScopeContext = {
    principalUserId: USER,
    principalPlatformRole: "sales",
    orgId: ORG_A,
    orgRole: "org_member",
    isPlatformAdmin: false,
    hasMembership: true,
    projectId: "p1",
    channel: "web_chat",
    traceId: "t1",
  };
  const guard = toScopeGuard(scope);
  ok(
    guard.orgId === ORG_A && guard.principalUserId === USER && guard.projectId === "p1",
    "toScopeGuard 投影正确",
  );
}

console.log("");
console.log(`结果: ${pass} 通过, ${fail} 失败`);
if (fail > 0) process.exit(1);
