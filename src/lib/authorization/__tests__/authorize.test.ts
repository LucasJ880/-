/**
 * Security-1：authorize / compileAuthorizedWhere / Principal / DENY / compat
 * 运行：npx tsx src/lib/authorization/__tests__/authorize.test.ts
 */

import { authorize, decideFromBindings } from "../authorize";
import { compileAuthorizedWhereFromScopes } from "../compile-where";
import {
  bindingsFromSystemProfile,
  compatProfileKeyForMembership,
} from "../resolve-effective-permissions";
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
  "org_owner → Role Profile 含销售 ORG read",
);

const adminBindings = bindingsFromSystemProfile("org_admin");
ok(
  !adminBindings.some((b) => b.permissionKey.startsWith("sales.")),
  "org_admin → 仅企业管理权限，无销售",
);

const viewerBindings = bindingsFromSystemProfile("viewer");
ok(
  viewerBindings.every((b) => !b.permissionKey.startsWith("sales.")),
  "org_viewer → viewer profile 无销售",
);

ok(
  compatProfileKeyForMembership({ orgRole: "org_member", platformRole: "sales" }) ===
    "sales_rep",
  "sales + org_member → 可兼容 sales_rep",
);
ok(
  compatProfileKeyForMembership({ orgRole: "org_member", platformRole: "trade" }) ===
    null,
  "trade + org_member → 无销售权限",
);
ok(
  compatProfileKeyForMembership({ orgRole: "org_member", platformRole: "user" }) ===
    null,
  "user + org_member → 无销售权限",
);
ok(
  compatProfileKeyForMembership({
    orgRole: "org_member",
    platformRole: "manager",
  }) === null,
  "manager + org_member → 无销售权限",
);
ok(
  compatProfileKeyForMembership({ orgRole: "org_admin", platformRole: "sales" }) ===
    "org_admin",
  "org_admin membership → admin profile（非 sales_rep）",
);
ok(
  compatProfileKeyForMembership({ orgRole: "org_owner", platformRole: "user" }) ===
    "org_owner",
  "org_owner membership → owner profile",
);
ok(
  compatProfileKeyForMembership({ orgRole: "org_viewer", platformRole: "sales" }) ===
    "viewer",
  "org_viewer → viewer profile",
);

const digi = resolvePrincipalRef({
  type: "DIGITAL_EMPLOYEE",
  id: "d1",
  orgId: "org1",
});
ok(!digi.ok && digi.result.reasonCode === "NOT_IMPLEMENTED", "数字员工未实现");

const orgWhere = compileAuthorizedWhereFromScopes({
  orgId: "org1",
  principalId: "u1",
  scopes: ["ORG"],
  resourceType: "sales_customer",
});
ok(
  orgWhere.ok && "orgId" in orgWhere.where && !("AND" in orgWhere.where),
  "ORG scope → 仅 orgId",
);

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

ok(
  !compileAuthorizedWhereFromScopes({
    orgId: "org1",
    principalId: "u1",
    scopes: ["GROUP"],
    resourceType: "sales_customer",
  }).ok,
  "GROUP fail closed",
);

// DENY = permission 级全局拒绝
const denyDecision = decideFromBindings({
  principal,
  permission: "sales.customer.read",
  bindings: [
    {
      permissionKey: "sales.customer.read",
      dataScope: "ORG",
      effect: "ALLOW",
      source: "allow",
    },
    {
      permissionKey: "sales.customer.read",
      dataScope: "PRINCIPAL",
      effect: "DENY",
      source: "deny",
    },
  ],
});
ok(
  !denyDecision.allowed && denyDecision.reasonCode === "EXPLICIT_DENY",
  "ALLOW:ORG + DENY:PRINCIPAL → 整个 permission 拒绝",
);

const allowOnly = decideFromBindings({
  principal,
  permission: "sales.customer.read",
  bindings: [
    {
      permissionKey: "sales.customer.read",
      dataScope: "ORG",
      effect: "ALLOW",
      source: "allow",
    },
  ],
});
ok(allowOnly.allowed && allowOnly.matchedScope === "ORG", "仅 ALLOW:ORG → 允许");

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
