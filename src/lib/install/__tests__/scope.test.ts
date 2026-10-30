/**
 * INSTALL-1：安装任务范围（ASSIGNED vs ORG）+ 安装工默认工作区
 * 运行：npx tsx src/lib/install/__tests__/scope.test.ts
 */
import { decideFromBindings } from "@/lib/authorization/authorize";
import { mergedProfileBindings } from "@/lib/authorization/role-defaults";
import { canSeeInstallTask, groupByDay, installScopeFromDecision, installTaskWhere } from "../scope";
import { canAccessInstallWorkspace, getDefaultWorkspace, resolveHomeRedirect } from "@/lib/rbac/workspace-policy";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`  ✗ ${name}`); }
}

const WC = "window_covering_services_v1";
const toBindings = (key: string) =>
  mergedProfileBindings(WC, key).map((b, i) => ({ permissionKey: b.permissionKey, dataScope: b.dataScope, effect: "ALLOW" as const, source: `t:${key}:${i}` }));
const principal = { type: "HUMAN" as const, id: "u-wang", orgId: "org1" };

console.log("INSTALL-1 范围判定");
const instDecision = decideFromBindings({ principal, permission: "install.task.read", bindings: toBindings("installer") });
ok(installScopeFromDecision(instDecision) === "assigned", "installer → assigned");
const opsDecision = decideFromBindings({ principal, permission: "install.task.read", bindings: toBindings("ops_lead") });
ok(installScopeFromDecision(opsDecision) === "org", "ops_lead → org");
const salesDecision = decideFromBindings({ principal, permission: "install.task.read", bindings: toBindings("sales_rep") });
ok(installScopeFromDecision(salesDecision) === "none", "sales_rep → none");

const wAssigned = installTaskWhere({ orgId: "org1", userId: "u-wang", scope: "assigned", start: "2026-10-27", end: "2026-11-03" });
ok(!!wAssigned && wAssigned.assignedToId === "u-wang" && (wAssigned.customer as { orgId: string }).orgId === "org1" && wAssigned.type === "install", "assigned where：本人 + 企业 + install");
const wOrg = installTaskWhere({ orgId: "org1", userId: "u-wang", scope: "org" });
ok(!!wOrg && !("assignedToId" in wOrg) && !("startAt" in wOrg), "org where：不限人；无区间不加 startAt");
ok(installTaskWhere({ orgId: "org1", userId: "u", scope: "none" }) === null, "none → null");
ok(canSeeInstallTask({ scope: "assigned", userId: "u-wang", assignedToId: "u-wang" }) && !canSeeInstallTask({ scope: "assigned", userId: "u-wang", assignedToId: "u-li" }), "assigned 只看本人");
ok(canSeeInstallTask({ scope: "org", userId: "u-wang", assignedToId: "u-li" }), "org 看他人");

// resource 级：ASSIGNED 匹配 assignedToId
const own = decideFromBindings({ principal, permission: "install.window.complete", bindings: toBindings("installer"), resource: { type: "appointment", id: "a1", assignedToId: "u-wang", orgId: "org1" } });
const other = decideFromBindings({ principal, permission: "install.window.complete", bindings: toBindings("installer"), resource: { type: "appointment", id: "a2", assignedToId: "u-li", orgId: "org1" } });
ok(own.allowed && own.matchedScope === "ASSIGNED" && !other.allowed, "逐窗拍照：本人任务允许，他人任务拒绝");

console.log("INSTALL-1 周视图分组");
const g = groupByDay([
  { id: 1, startAt: "2026-10-29T15:00:00" },
  { id: 2, startAt: "2026-10-28T09:00:00" },
  { id: 3, startAt: "2026-10-28T13:00:00" },
]);
ok(g.length === 2 && g[0].day === "2026-10-28" && g[0].items.map((x) => x.id).join(",") === "2,3" && g[1].day === "2026-10-29", "按天分组、天内按时间排序");

console.log("INSTALL-1 工作区");
const installerCtx = { platformRole: "user", orgRole: "org_member", permissionKeys: ["install.task.read", "install.task.update", "install.window.complete"], hasMembership: true };
ok(canAccessInstallWorkspace(installerCtx), "持 install.task.read → 可进 install 工作区");
ok(getDefaultWorkspace(installerCtx) === "/install", "安装工默认工作区 /install");
ok(resolveHomeRedirect(installerCtx) === "/install", "访问 / → 重定向 /install");
ok(!canAccessInstallWorkspace({ platformRole: "sales", orgRole: "org_member", permissionKeys: ["sales.quote.read"] }), "销售不进 install 工作区");
ok(getDefaultWorkspace({ platformRole: "boss", orgRole: "org_owner", permissionKeys: ["install.task.read"] }) === "/", "管理层仍落管理总览");

console.log(`\n结果: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
