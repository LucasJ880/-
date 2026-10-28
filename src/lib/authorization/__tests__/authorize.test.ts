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
ok(!digi.ok && digi.result.reasonCode === "SPONSOR_REQUIRED", "PERM-5b：数字员工无 sponsor 拒绝");
const digiOk = resolvePrincipalRef({ type: "DIGITAL_EMPLOYEE", id: "d1", orgId: "org1", sponsorUserId: "alex" });
ok(digiOk.ok && digiOk.principal.type === "DIGITAL_EMPLOYEE" && digiOk.principal.sponsorUserId === "alex", "PERM-5b：数字员工带 sponsor 可构造");

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


// ── PERM-1：岗位目录 / 平台管理员全权 ──
import {
  WINDOW_COVERING_ROLE_PROFILES,
  mergedProfileBindings,
  profilesForIndustryPack,
  profileKeysForIndustryPack,
} from "../role-defaults";
import { PERMISSION_REGISTRY, getPermissionDefinition, isKnownPermission } from "../permissions";
import { platformAdminBindings } from "../resolve-effective-permissions";

console.log("PERM-1 岗位目录");
const WC = "window_covering_services_v1";
const wcKeys = profilesForIndustryPack(WC).map((p) => p.key);
ok(wcKeys.length === 11 && profileKeysForIndustryPack(WC).length === 17, "窗饰行业包：11 个追加模板（含安装工、ops_staff 并集），17 个岗位 key");
ok(profilesForIndustryPack(null).length === 0 && profilesForIndustryPack("other_pack").length === 0, "非窗饰行业包：0 个追加模板");
for (const k of [
  "sales.quote.pricing_close",
  "sales.quote.discount.over_limit.submit",
  "sales.quote.discount.over_limit.approve",
  "sales.settings.manage",
  "sales.order.create",
  "orders.fulfillment.update",
  "orders.fulfillment.update.vinyl",
  "orders.fulfillment.update.drapery",
  "orders.fulfillment.update.shades",
  "orders.fulfillment.read",
  "orders.cancel",
  "inventory.manage",
  "inventory.read",
  "accounting.read",
  "identity.position.manage",
  "sales.quote.signed_amount.approve",
  "operations.content.draft",
  "operations.content.approve",
]) {
  ok(isKnownPermission(k), `权限键已登记：${k}`);
}
ok(
  getPermissionDefinition("identity.position.manage")?.allowedPrincipalTypes.join(",") === "HUMAN",
  "identity.position.manage 仅 HUMAN",
);
const has = (bs: { permissionKey: string; dataScope: string }[], key: string, scope?: string) =>
  bs.some((b) => b.permissionKey === key && (!scope || b.dataScope === scope));
const owner = mergedProfileBindings(WC, "owner");
ok(has(owner, "sales.quote.discount.over_limit.approve", "ORG") && has(owner, "sales.settings.manage", "ORG"), "owner 含超限审批与设置权");
ok(
  !has(owner, "identity.member.manage") && !has(owner, "identity.role.manage") && !has(owner, "identity.position.manage") && !has(owner, "authorization.policy.manage"),
  "owner 不含成员 / 岗位 / 策略管理",
);
const rep = mergedProfileBindings(WC, "sales_rep");
ok(
  rep.filter((b) => b.permissionKey.startsWith("sales.")).every((b) => b.dataScope === "PRINCIPAL" || b.dataScope === "ASSIGNED"),
  "sales_rep 的 sales.* 只有 PRINCIPAL / ASSIGNED",
);
ok(has(rep, "sales.quote.send", "PRINCIPAL") && has(rep, "sales.order.create", "PRINCIPAL") && !has(rep, "sales.quote.discount.over_limit.submit"), "sales_rep 可发报价、建单，不可超限");
const pl = mergedProfileBindings(WC, "pricing_lead");
ok(
  has(pl, "sales.quote.pricing_close", "ORG") && has(pl, "sales.quote.discount.over_limit.submit", "ORG") && !has(pl, "sales.quote.discount.over_limit.approve") && !has(pl, "sales.settings.manage"),
  "pricing_lead 含合价 + 超限提交，不含审批 / 设置",
);
ok(has(mergedProfileBindings(WC, "ops_lead"), "inventory.manage", "ORG") && !has(mergedProfileBindings(WC, "ops_staff"), "inventory.manage"), "ops_lead 含库存管理，ops_staff 不含");
const acc = mergedProfileBindings(WC, "accounting");
ok(
  has(acc, "accounting.read", "ORG") && has(acc, "sales.quote.read", "ORG") && !acc.some((b) => /\.(create|update)$/.test(b.permissionKey) && b.permissionKey.startsWith("sales.")),
  "accounting 只读",
);
const bids = mergedProfileBindings(WC, "bids");
ok(has(bids, "bids.handoff.execute", "ORG") && !has(bids, "bids.handoff.override"), "bids 可交接、不可 override");
// PERM-3：出单岗只持自己品类的更新键 + read；不持伞键 / 作废 / 库存管理
const CATEGORY_OF = { fulfillment_vinyl: "vinyl", fulfillment_drapery: "drapery", fulfillment_shades: "shades" } as const;
for (const k of ["fulfillment_vinyl", "fulfillment_drapery", "fulfillment_shades"] as const) {
  const f = mergedProfileBindings(WC, k);
  const mine = `orders.fulfillment.update.${CATEGORY_OF[k]}`;
  const others = ["vinyl", "drapery", "shades"].filter((c) => c !== CATEGORY_OF[k]).map((c) => `orders.fulfillment.update.${c}`);
  ok(
    has(f, mine, "ORG") && has(f, "orders.fulfillment.read", "ORG") && has(f, "inventory.read", "ORG") &&
      others.every((o) => !has(f, o)) && !has(f, "orders.fulfillment.update") && !has(f, "orders.cancel") && !has(f, "inventory.manage") &&
      !has(f, "sales.quote.create") && !has(f, "sales.quote.update") && !has(f, "sales.customer.create") && !has(f, "sales.customer.update"),
    `${k} 只含 ${CATEGORY_OF[k]} 品类更新键 + read，不含他品类 / 伞键 / 作废 / 库存管理 / 销售写权`,
  );
}
const ownerB = mergedProfileBindings(WC, "owner");
ok(has(ownerB, "orders.fulfillment.update", "ORG") && has(ownerB, "orders.cancel", "ORG") && has(ownerB, "inventory.manage", "ORG") && has(ownerB, "orders.fulfillment.read", "ORG"), "owner 持全品类伞键 + 作废 + 库存管理 + 全企业读");
ok(has(mergedProfileBindings(WC, "ops_staff"), "inventory.read", "ORG") && !has(mergedProfileBindings(WC, "ops_staff"), "inventory.manage"), "ops_staff 只读库存");
ok(has(mergedProfileBindings(WC, "sales_rep"), "inventory.read", "ORG"), "sales_rep 只读库存");
ok(has(mergedProfileBindings(WC, "ops_lead"), "orders.fulfillment.read", "ORG") && has(mergedProfileBindings(WC, "ops_lead"), "inventory.read", "ORG"), "ops_lead 读工艺单 + 读库存");
ok(WINDOW_COVERING_ROLE_PROFILES.every((p) => p.name && p.description), "窗饰模板均有中文名与说明");

// PERM-4a：owner 销售改权 + 签约改价审批权；其余岗位不持新审批键 / 归档键
const ownerS = mergedProfileBindings(WC, "owner");
ok(
  ["sales.customer.update", "sales.customer.archive", "sales.opportunity.update", "sales.quote.update", "sales.quote.signed_amount.approve"].every((k) => has(ownerS, k, "ORG")),
  "PERM-4a：owner 以 ORG 持客户改 / 归档、商机改、报价改、签约改价审批",
);
ok(
  profileKeysForIndustryPack(WC).filter((k) => k !== "owner").every((k) => {
    const bs = mergedProfileBindings(WC, k);
    return !has(bs, "sales.quote.signed_amount.approve") && !has(bs, "sales.customer.archive");
  }),
  "PERM-4a：除 owner 外的岗位模板（含 pricing_lead）不含签约改价审批键与归档键",
);
{
  const d = PERMISSION_REGISTRY.find((p) => p.key === "sales.quote.signed_amount.approve");
  ok(!!d && d.allowedPrincipalTypes.length === 1 && d.allowedPrincipalTypes[0] === "HUMAN" && d.supportedScopes.join() === "ORG" && d.riskLevel === "HIGH", "PERM-4a：sales.quote.signed_amount.approve 仅人类 / ORG / HIGH");
}

// PERM-4b：运营内容分权
{
  const st = mergedProfileBindings(WC, "ops_staff");
  ok(has(st, "operations.content.draft", "ORG") && has(st, "operations.read", "ORG") && !has(st, "operations.content.approve") && !has(st, "operations.manage"), "PERM-4b：ops_staff 起草 + 读，不批准、不管理");
  const lead = mergedProfileBindings(WC, "ops_lead");
  ok(has(lead, "operations.content.draft", "ORG") && has(lead, "operations.content.approve", "ORG") && has(lead, "operations.manage", "ORG"), "PERM-4b：ops_lead 起草 + 批准 + 管理");
  const ow = mergedProfileBindings(WC, "owner");
  ok(has(ow, "operations.content.approve", "ORG") && has(ow, "operations.read", "ORG") && !has(ow, "operations.manage") && !has(ow, "operations.content.draft"), "PERM-4b：owner 只批不改");
  ok(
    profileKeysForIndustryPack(WC).filter((k) => !["ops_staff", "ops_lead", "owner"].includes(k)).every((k) => {
      const bs = mergedProfileBindings(WC, k);
      return !has(bs, "operations.content.draft") && !has(bs, "operations.content.approve");
    }),
    "PERM-4b：其余模板（含 sales_rep）不含运营内容键",
  );
  const ap = PERMISSION_REGISTRY.find((p) => p.key === "operations.content.approve");
  ok(!!ap && ap.allowedPrincipalTypes.join() === "HUMAN" && ap.riskLevel === "HIGH", "PERM-4b：operations.content.approve 仅人类 / HIGH");
}

// 多岗并集：owner + pricing_lead + accounting
const multi = ["owner", "pricing_lead", "accounting"].flatMap((k) =>
  mergedProfileBindings(WC, k).map((b, i) => ({ permissionKey: b.permissionKey, dataScope: b.dataScope, effect: (b.effect ?? "ALLOW") as "ALLOW" | "DENY", source: `t:${k}:${i}` })),
);
const multiRead = decideFromBindings({
  principal,
  permission: "sales.quote.read",
  bindings: multi,
  resource: { type: "sales_quote", id: "q9", ownerId: "someone-else", orgId: "org1" },
});
ok(multiRead.allowed && multiRead.matchedScope === "ORG", "多岗并集：sales.quote.read 匹配 ORG");
ok(decideFromBindings({ principal, permission: "sales.quote.discount.over_limit.approve", bindings: multi }).allowed, "多岗并集：可审批超限");

ok(
  !has(bindingsFromSystemProfile("org_owner"), "identity.member.manage") && !has(bindingsFromSystemProfile("org_owner"), "identity.role.manage") && !has(bindingsFromSystemProfile("org_owner"), "authorization.policy.manage") && has(bindingsFromSystemProfile("org_owner"), "audit.read", "ORG"),
  "PERM-2：org_owner 系统模板不含成员 / 岗位 / 策略管理，仍含 audit.read",
);

console.log("PERM-5a 项目结算权限键");
{
  const pf = getPermissionDefinition("project.finance.read");
  ok(!!pf && pf.riskLevel === "HIGH" && pf.supportedScopes.join() === "ASSIGNED,ORG", "project.finance.read 已登记（HIGH，ASSIGNED / ORG）");
  ok(has(mergedProfileBindings(WC, "accounting"), "project.finance.read", "ORG"), "accounting：project.finance.read ORG");
  ok(has(mergedProfileBindings(WC, "owner"), "project.finance.read", "ORG"), "owner：project.finance.read ORG");
  const bidsB = mergedProfileBindings(WC, "bids");
  ok(has(bidsB, "project.finance.read", "ASSIGNED") && !has(bidsB, "project.finance.read", "ORG"), "bids：project.finance.read 只 ASSIGNED");
  for (const k of ["sales_rep", "pricing_lead", "ops_staff", "ops_lead", "installer", "fulfillment_vinyl", "fulfillment_drapery", "fulfillment_shades"]) {
    ok(!has(mergedProfileBindings(WC, k), "project.finance.read"), `${k} 不含 project.finance.read`);
  }
  const bidsDecision = decideFromBindings({
    principal,
    permission: "project.finance.read",
    bindings: bidsB.map((b, i) => ({ permissionKey: b.permissionKey, dataScope: b.dataScope, effect: "ALLOW" as const, source: `t:bids:${i}` })),
  });
  ok(bidsDecision.allowed && bidsDecision.matchedScope === "ASSIGNED", "bids 不带资源判定 → ASSIGNED");
}

console.log("INSTALL-1 安装工岗位");
for (const k of ["install.task.read", "install.task.update", "install.window.complete", "install.task.assign", "install.photo.read"]) {
  ok(isKnownPermission(k), `权限键已登记：${k}`);
}
const inst = mergedProfileBindings(WC, "installer");
ok(
  inst.length === 3 && inst.every((b) => b.permissionKey.startsWith("install.") && b.dataScope === "ASSIGNED"),
  "installer：三个 install.* 键均 ASSIGNED",
);
ok(!has(inst, "install.task.assign") && !has(inst, "install.photo.read") && !inst.some((b) => b.permissionKey.startsWith("sales.")), "installer 不含安排 / 照片查看 / sales.*");
for (const k of ["ops_lead", "accounting", "owner"]) {
  const b = mergedProfileBindings(WC, k);
  ok(has(b, "install.task.assign", "ORG") && has(b, "install.task.read", "ORG") && has(b, "install.photo.read", "ORG"), `${k} 可安排安装 + 看任务 + 看照片`);
}
for (const k of ["fulfillment_vinyl", "fulfillment_drapery", "fulfillment_shades"]) {
  const b = mergedProfileBindings(WC, k);
  ok(has(b, "install.task.read", "ORG") && has(b, "install.photo.read", "ORG") && !has(b, "install.task.assign"), `${k} 只看不排`);
}
ok(!mergedProfileBindings(WC, "sales_rep").some((b) => b.permissionKey.startsWith("install.")), "sales_rep 无 install.*");
ok(!mergedProfileBindings(WC, "ops_staff").some((b) => b.permissionKey.startsWith("install.")), "ops_staff 无 install.*");

console.log("PERM-1 平台管理员全权");
const pa = platformAdminBindings();
ok(pa.length === PERMISSION_REGISTRY.length && pa.every((b) => b.source.startsWith("platform_admin")), "platformAdminBindings：条数 = Registry，来源 platform_admin");
ok(pa.every((b) => b.dataScope === "ORG" && b.effect === "ALLOW"), "platformAdminBindings：全部 ORG / ALLOW");
const paSame = decideFromBindings({ principal, permission: "sales.quote.read", bindings: pa, resource: { type: "sales_quote", id: "q1", ownerId: "x", orgId: "org1" } });
ok(paSame.allowed && paSame.matchedScope === "ORG", "平台管理员对同企业资源 ALLOW/ORG");
const paOther = decideFromBindings({ principal, permission: "sales.quote.read", bindings: pa, resource: { type: "sales_quote", id: "q2", ownerId: "x", orgId: "org2" } });
ok(!paOther.allowed && paOther.reasonCode === "RESOURCE_OUT_OF_SCOPE", "平台管理员对异企业资源拒绝");
ok(compatProfileKeyForMembership({ orgRole: "org_member", platformRole: "admin" }) === null, "平台 admin 无兼容岗位（无全权）");

console.log("PERM-5b 数字员工禁区与 sponsor 范围");
{
  const humanOnly = (k: string) => getPermissionDefinition(k)?.allowedPrincipalTypes.join() === "HUMAN";
  for (const k of [
    "sales.quote.discount.over_limit.approve",
    "sales.quote.discount.over_limit.submit",
    "sales.quote.signed_amount.approve",
    "operations.content.approve",
    "sales.quote.pricing_close",
    "sales.settings.manage",
    "organization.settings.manage",
    "authorization.policy.manage",
    "identity.member.read",
    "identity.member.manage",
    "identity.role.manage",
    "identity.position.manage",
    "install.task.assign",
    "orders.cancel",
    "inventory.manage",
    "operations.manage",
  ]) {
    ok(humanOnly(k), `禁区键只允许人类：${k}`);
  }
  ok(
    PERMISSION_REGISTRY.filter((p) => p.key.endsWith(".approve")).every((p) => p.allowedPrincipalTypes.join() === "HUMAN"),
    "所有 *.approve 键只允许人类",
  );
  for (const k of ["sales.customer.read", "sales.quote.create", "operations.content.draft", "project.read", "accounting.read"]) {
    ok(getPermissionDefinition(k)?.allowedPrincipalTypes.includes("DIGITAL_EMPLOYEE") === true, `业务键开放给数字员工：${k}`);
  }

  const de: PrincipalRef = { type: "DIGITAL_EMPLOYEE", id: "agent1", orgId: "org1", sponsorUserId: "alex" };
  const toBindings = (k: string) =>
    mergedProfileBindings(WC, k).map((b, i) => ({ permissionKey: b.permissionKey, dataScope: b.dataScope, effect: (b.effect ?? "ALLOW") as "ALLOW" | "DENY", source: `t:${k}:${i}` }));
  const accB = toBindings("accounting");
  const deAssign = decideFromBindings({ principal: de, permission: "install.task.assign", bindings: accB });
  ok(!deAssign.allowed && deAssign.reasonCode === "PRINCIPAL_TYPE_NOT_ALLOWED", "数字员工绑了 accounting 也不能安排安装");
  ok(decideFromBindings({ principal, permission: "install.task.assign", bindings: accB }).allowed, "人类 accounting 可安排安装（不受禁区影响）");
  ok(
    decideFromBindings({ principal: de, permission: "sales.quote.discount.over_limit.approve", bindings: multi }).reasonCode === "PRINCIPAL_TYPE_NOT_ALLOWED",
    "数字员工永不审批（即使绑了老板岗）",
  );
  const repB = toBindings("sales_rep");
  const own = decideFromBindings({ principal: de, permission: "sales.customer.read", bindings: repB, resource: { type: "sales_customer", ownerId: "alex", orgId: "org1" } });
  ok(own.allowed && own.matchedScope === "PRINCIPAL", "销售数字员工读 sponsor 的客户 → PRINCIPAL 命中");
  const other = decideFromBindings({ principal: de, permission: "sales.customer.read", bindings: repB, resource: { type: "sales_customer", ownerId: "lynn", orgId: "org1" } });
  ok(!other.allowed && other.reasonCode === "RESOURCE_OUT_OF_SCOPE", "销售数字员工读其他销售的客户 → 拒绝");
  const self = decideFromBindings({ principal: de, permission: "sales.customer.read", bindings: repB, resource: { type: "sales_customer", ownerId: "agent1", orgId: "org1" } });
  ok(!self.allowed, "资源 owner = Agent id 本身不算 PRINCIPAL 命中");
  ok(decideFromBindings({ principal: de, permission: "sales.quote.read", bindings: repB }).allowed, "绑定 sales_rep 的数字员工不带资源读报价 → 允许");
  const noSponsor: PrincipalRef = { type: "DIGITAL_EMPLOYEE", id: "agent1", orgId: "org1" };
  const ns = decideFromBindings({ principal: noSponsor, permission: "sales.quote.read", bindings: repB });
  ok(!ns.allowed && ns.reasonCode === "NO_USABLE_SCOPE", "无 sponsor 的数字员工：PRINCIPAL 范围不可用");
  ok(decideFromBindings({ principal: de, permission: "sales.customer.read", bindings: [] }).reasonCode === "NO_BINDING", "无绑定的数字员工 → NO_BINDING");
}

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
  ok(digiAuth.reasonCode === "SPONSOR_REQUIRED", "PERM-5b：DIGITAL_EMPLOYEE 无 sponsor authorize fail closed（不读库）");

  console.log(`\n结果: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
