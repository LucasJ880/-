/**
 * Security-1：销售授权语义（不连库）
 * 运行：npx tsx src/lib/sales/__tests__/security1-sales-authz.test.ts
 */

import { compileAuthorizedWhereFromScopes } from "@/lib/authorization/compile-where";
import { bindingsFromSystemProfile, platformAdminBindings } from "@/lib/authorization/resolve-effective-permissions";
import { decideFromBindings } from "@/lib/authorization/authorize";
import { mergedProfileBindings } from "@/lib/authorization/role-defaults";
import { readFileSync } from "node:fs";
import { join } from "node:path";

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

console.log("security-1 sales authz");

const owner = bindingsFromSystemProfile("org_owner");
const admin = bindingsFromSystemProfile("org_admin");
const rep = bindingsFromSystemProfile("sales_rep");
const manager = bindingsFromSystemProfile("sales_manager");

ok(
  owner.some((b) => b.permissionKey === "sales.customer.read" && b.dataScope === "ORG"),
  "org_owner 可读组织级客户",
);
ok(
  !admin.some((b) => b.permissionKey.startsWith("sales.")),
  "org_admin 默认无销售权限",
);
ok(
  manager.some((b) => b.permissionKey === "sales.analytics.read" && b.dataScope === "ORG"),
  "销售经理可看组织级分析",
);

const repCustomerScopes = rep
  .filter((b) => b.permissionKey === "sales.customer.read")
  .map((b) => b.dataScope);
ok(
  repCustomerScopes.includes("PRINCIPAL") && !repCustomerScopes.includes("ORG"),
  "销售人员客户读仅 PRINCIPAL",
);

const repOppScopes = [
  ...new Set(
    rep
      .filter((b) => b.permissionKey === "sales.opportunity.read")
      .map((b) => b.dataScope),
  ),
];
const oppWhere = compileAuthorizedWhereFromScopes({
  orgId: "sunny",
  principalId: "sales-1",
  scopes: repOppScopes as ("PRINCIPAL" | "ASSIGNED")[],
  resourceType: "sales_opportunity",
});
ok(oppWhere.ok, "销售商机 where 可编译");
if (oppWhere.ok) {
  const and = oppWhere.where.AND as Array<{ OR: Array<Record<string, string>> }>;
  const ors = and[0].OR;
  ok(
    ors.some((c) => c.createdById === "sales-1") &&
      ors.some((c) => c.assignedToId === "sales-1"),
    "商机 PRINCIPAL+ASSIGNED",
  );
}

const adminCustomer = compileAuthorizedWhereFromScopes({
  orgId: "sunny",
  principalId: "admin-1",
  scopes: [],
  resourceType: "sales_customer",
});
ok(!adminCustomer.ok, "无 scope 不得查客户");

const ownerWhere = compileAuthorizedWhereFromScopes({
  orgId: "sunny",
  principalId: "owner-1",
  scopes: ["ORG"],
  resourceType: "sales_customer",
});
ok(
  ownerWhere.ok &&
    ownerWhere.where.orgId === "sunny" &&
    !("createdById" in ownerWhere.where),
  "负责人 ORG 不限 createdById",
);

console.log("PERM-4a：销售区不因平台角色短路");
{
  const principal = { type: "HUMAN" as const, id: "padmin-1", orgId: "sunny" };
  const cust = { type: "sales_customer" as const, id: "c1", ownerId: "someone-else", orgId: "sunny" };
  const opp = { type: "sales_opportunity" as const, id: "o1", ownerId: "someone-else", assignedToId: null, orgId: "sunny" };
  // 平台 admin、无岗位绑定、org_member（兼容回退为空）→ 有效绑定为空
  ok(!decideFromBindings({ principal, permission: "sales.customer.read", bindings: [], resource: cust }).allowed, "平台 admin 无绑定：读他人客户拒绝");
  ok(!decideFromBindings({ principal, permission: "sales.opportunity.read", bindings: [], resource: opp }).allowed, "平台 admin 无绑定：读他人商机拒绝");
  ok(!decideFromBindings({ principal, permission: "sales.customer.archive", bindings: [], resource: cust }).allowed, "平台 admin 无绑定：归档客户拒绝");
  const sa = platformAdminBindings();
  ok(
    ["sales.customer.read", "sales.customer.archive"].every((k) => decideFromBindings({ principal, permission: k, bindings: sa, resource: cust }).allowed)
      && decideFromBindings({ principal, permission: "sales.opportunity.update", bindings: sa, resource: opp }).allowed,
    "平台 super_admin（平台管理员绑定）：客户读 / 归档、商机改 允许",
  );
  const eff = (key: string) =>
    mergedProfileBindings("window_covering_services_v1", key).map((b, i) => ({ permissionKey: b.permissionKey, dataScope: b.dataScope, effect: "ALLOW" as const, source: `t:${i}` }));
  const repB = eff("sales_rep");
  ok(decideFromBindings({ principal, permission: "sales.customer.read", bindings: repB, resource: { ...cust, ownerId: "padmin-1" } }).allowed, "销售读本人客户允许（对照：绑定形状有效）");
  ok(!decideFromBindings({ principal, permission: "sales.customer.archive", bindings: repB, resource: { ...cust, ownerId: "padmin-1" } }).allowed, "销售归档本人客户拒绝（无归档权）");
  const ownerB = eff("owner");
  ok(
    decideFromBindings({ principal, permission: "sales.customer.archive", bindings: ownerB, resource: cust }).allowed
      && decideFromBindings({ principal, permission: "sales.opportunity.update", bindings: ownerB, resource: opp }).allowed,
    "老板岗位：归档他人客户、改他人商机 允许",
  );
  const ctxSrc = readFileSync(join(__dirname, "..", "org-context.ts"), "utf-8");
  ok(!/isAdmin\(|isSuperAdmin\(/.test(ctxSrc), "org-context.ts 无平台角色短路");
}

console.log(`\n结果: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
