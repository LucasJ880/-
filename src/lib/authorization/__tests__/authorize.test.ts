/**
 * Security-1：authorize / compileAuthorizedWhere / Principal
 * 运行：npx tsx src/lib/authorization/__tests__/authorize.test.ts
 */

import { authorize } from "../authorize";
import { compileAuthorizedWhereFromScopes } from "../compile-where";
import { bindingsFromSystemProfile } from "../resolve-effective-permissions";
import { resolvePrincipalRef } from "../resolve-principal";
import type { PrincipalRef } from "../types";

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

console.log("security-1 authorize unit");

const principal: PrincipalRef = {
  type: "HUMAN",
  id: "u1",
  orgId: "org1",
};

const ownerBindings = bindingsFromSystemProfile("org_owner");
ok(
  ownerBindings.some(
    (b) => b.permissionKey === "sales.customer.read" && b.dataScope === "ORG",
  ),
  "企业负责人含 sales.customer.read:ORG",
);

const adminBindings = bindingsFromSystemProfile("org_admin");
ok(
  !adminBindings.some((b) => b.permissionKey === "sales.customer.read"),
  "企业管理员默认无销售客户读权限",
);

const repBindings = bindingsFromSystemProfile("sales_rep");
ok(
  repBindings.some((b) => b.dataScope === "PRINCIPAL") &&
    repBindings.some((b) => b.dataScope === "ASSIGNED"),
  "销售人员含 PRINCIPAL+ASSIGNED",
);

const digi = resolvePrincipalRef({
  type: "DIGITAL_EMPLOYEE",
  id: "d1",
  orgId: "org1",
});
ok(!digi.ok && digi.result.reasonCode === "NOT_IMPLEMENTED", "数字员工未实现");

// compile where — ORG
const orgWhere = compileAuthorizedWhereFromScopes({
  orgId: "org1",
  principalId: "u1",
  scopes: ["ORG"],
  resourceType: "sales_customer",
});
ok(
  orgWhere.ok &&
    "orgId" in orgWhere.where &&
    !("AND" in orgWhere.where),
  "ORG scope → 仅 orgId",
);

// PRINCIPAL + ASSIGNED for opportunity
const oppWhere = compileAuthorizedWhereFromScopes({
  orgId: "org1",
  principalId: "u1",
  scopes: ["PRINCIPAL", "ASSIGNED"],
  resourceType: "sales_opportunity",
});
ok(oppWhere.ok, "PRINCIPAL+ASSIGNED opportunity ok");
if (oppWhere.ok) {
  const and = oppWhere.where.AND as Array<{ OR: unknown[] }>;
  ok(Array.isArray(and?.[0]?.OR) && and[0].OR.length === 2, "组合 Scope OR 两条");
}

// GROUP fail closed
const groupWhere = compileAuthorizedWhereFromScopes({
  orgId: "org1",
  principalId: "u1",
  scopes: ["GROUP"],
  resourceType: "sales_customer",
});
ok(
  !groupWhere.ok && groupWhere.reasonCode === "SCOPE_NOT_IMPLEMENTED",
  "GROUP fail closed",
);

const noneWhere = compileAuthorizedWhereFromScopes({
  orgId: "org1",
  principalId: "u1",
  scopes: ["NONE"],
  resourceType: "sales_customer",
});
ok(!noneWhere.ok && noneWhere.reasonCode === "SCOPE_NONE", "NONE 拒绝");

const assignedOnlyCustomer = compileAuthorizedWhereFromScopes({
  orgId: "org1",
  principalId: "u1",
  scopes: ["ASSIGNED"],
  resourceType: "sales_customer",
});
ok(
  !assignedOnlyCustomer.ok && assignedOnlyCustomer.reasonCode === "NO_USABLE_SCOPE",
  "客户无 ASSIGNED 字段时不静默扩权",
);

(async () => {
  const unknown = await authorize({
    principal,
    orgId: "org1",
    permission: "not.a.real.permission",
  });
  ok(unknown.reasonCode === "UNKNOWN_PERMISSION", "未知权限 fail closed");

  const mismatch = await authorize({
    principal,
    orgId: "other",
    permission: "sales.customer.read",
  });
  ok(mismatch.reasonCode === "ORG_CONTEXT_MISMATCH", "org 不一致拒绝");

  const digiAuth = await authorize({
    principal: { type: "DIGITAL_EMPLOYEE", id: "d1", orgId: "org1" },
    orgId: "org1",
    permission: "sales.customer.read",
  });
  ok(digiAuth.reasonCode === "NOT_IMPLEMENTED", "DIGITAL_EMPLOYEE authorize fail closed");

  console.log(`\n结果: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
