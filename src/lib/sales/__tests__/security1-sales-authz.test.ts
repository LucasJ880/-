/**
 * Security-1：销售授权语义（不连库）
 * 运行：npx tsx src/lib/sales/__tests__/security1-sales-authz.test.ts
 */

import { compileAuthorizedWhereFromScopes } from "@/lib/authorization/compile-where";
import { bindingsFromSystemProfile } from "@/lib/authorization/resolve-effective-permissions";

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

console.log(`\n结果: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
