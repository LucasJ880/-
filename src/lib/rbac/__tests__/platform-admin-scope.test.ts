/**
 * PERM-7b：平台 admin 退役（纯：判定只认 super_admin / 平台档归一 / 派生角色 / AI 档 / 导航 / 签发 / 压扁 / 源码断言）
 * 运行：npx tsx src/lib/rbac/__tests__/platform-admin-scope.test.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isAdmin, isPlatformSuperAdmin, isSuperAdmin, platformTier } from "../roles";
import { isPlatformAdmin } from "../platform-admin";
import * as client from "@/lib/permissions-client";
import { getCapabilities } from "../capabilities";
import { NAV_ROLES_EXEC } from "../nav-role-policy";
import { deriveEffectivePlatformRole, isReservedPlatformRole } from "../effective-platform-role";
import { SYSTEM_ROLE_PROFILES, WINDOW_COVERING_ROLE_PROFILES } from "@/lib/authorization/role-defaults";
import { SALES_MANAGER_PLATFORM_ROLES, resolveSalesScope } from "@/lib/muse-bridge/sales-pure";
import { COLLAPSIBLE_PLATFORM_ROLES, planCollapse } from "@/lib/authorization/platform-role-collapse";
import { NAVIGATION_REGISTRY, resolveNavigationTree, flattenVisibleHrefs, type NavigationFilterContext } from "@/lib/navigation";
import { registry } from "@/lib/agent-core/tool-registry";
import { buildOperatorSystemPrompt } from "@/lib/agent-core/prompts/operator-system";

let pass = 0;
let fail = 0;

function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`, detail === undefined ? "" : JSON.stringify(detail));
  }
}

const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

console.log("platform-admin-scope（PERM-7b）");

// ── 共用判定（服务端 / 客户端） ──
for (const [name, fn] of [
  ["roles.isSuperAdmin", isSuperAdmin],
  ["roles.isAdmin", isAdmin],
  ["roles.isPlatformSuperAdmin", isPlatformSuperAdmin],
  ["platform-admin.isPlatformAdmin", (r: string | null | undefined) => isPlatformAdmin(r)],
  ["client.isSuperAdmin", client.isSuperAdmin],
  ["client.isAdmin", client.isAdmin],
  ["client.isPlatformAdmin", client.isPlatformAdmin],
  ["client.isPlatformSuperAdmin", client.isPlatformSuperAdmin],
  ["client.canViewAdminPages", client.canViewAdminPages],
] as const) {
  ok(fn("super_admin") && !fn("admin") && !fn("boss") && !fn("user") && !fn(null), `${name}：只认 super_admin`);
}
ok(isPlatformAdmin({ role: "super_admin" }) && !isPlatformAdmin({ role: "admin" }), "isPlatformAdmin 传 user 对象同口径");

// ── 平台档归一 ──
for (const tier of [platformTier, client.platformTier]) {
  ok(
    tier("super_admin") === "admin" && tier("admin") === "user" && tier("sales") === "sales" && tier("trade") === "trade" && tier(null) === "user",
    "platformTier：super_admin → admin 档，admin → user，其余原样",
  );
}
ok(
  ["/sales", "/trade", "/admin", "/inventory"].every((m) => client.canAccessModule("admin", m) === client.canAccessModule("user", m)),
  "canAccessModule：平台 admin 与 user 相同",
);
ok(client.canAccessModule("super_admin", "/admin") === client.canAccessModule("super_admin", "/admin"), "canAccessModule：super_admin 不受影响");

// ── AI 能力矩阵 / 工具档 ──
ok(JSON.stringify(getCapabilities("admin")) === JSON.stringify(getCapabilities("user")), "能力矩阵：平台 admin = user");
ok(getCapabilities("super_admin").dataScope === "all" && getCapabilities("super_admin").aiDomains.includes("cockpit"), "能力矩阵：super_admin 仍是平台管理员档");
{
  const tag = `__perm7b_${Date.now()}`;
  registry.register({
    name: `${tag}_admin_only`,
    description: "PERM-7b test",
    domain: "system",
    parameters: { type: "object", properties: {} },
    execute: async () => ({ success: true }),
  } as never);
  registry.register({
    name: `${tag}_user`,
    description: "PERM-7b test",
    domain: "system",
    allowRoles: ["admin", "user"],
    parameters: { type: "object", properties: {} },
    execute: async () => ({ success: true }),
  } as never);
  const names = (role: string) => registry.list({ role, names: [`${tag}_admin_only`, `${tag}_user`] }).map((t) => t.name).sort().join();
  ok(names("admin") === names("user") && names("admin") === `${tag}_user`, "工具注册表：平台 admin 的可用工具与 user 相同（不含默认 admin 档工具）", names("admin"));
  ok(names("super_admin") === `${tag}_admin_only,${tag}_user`, "工具注册表：super_admin 进入 admin 档", names("super_admin"));
}

{
  const hint = (role: string) => buildOperatorSystemPrompt({ role, now: new Date(0) }).split("\n").find((l) => l.includes("角色说明")) ?? "";
  ok(hint("admin") === hint("user") && !hint("admin").includes("公司全局数据"), "操作员提示词：平台 admin 的角色说明与 user 相同");
  ok(hint("super_admin") === hint("user"), "操作员提示词：super_admin 与改动前相同（默认说明）");
}

// ── 派生角色 ──
const keysOf = (profiles: { key: string; bindings: { permissionKey: string }[] }[], key: string) =>
  (profiles.find((p) => p.key === key)?.bindings ?? []).map((b) => b.permissionKey);
const ownerKeys = keysOf(WINDOW_COVERING_ROLE_PROFILES, "owner");
const tradeRepKeys = keysOf(SYSTEM_ROLE_PROFILES, "trade_rep");
const salesRepKeys = keysOf(SYSTEM_ROLE_PROFILES, "sales_rep");
const derive = (platformRole: string, permissionKeys: string[], positionMode = true) =>
  deriveEffectivePlatformRole({ platformRole, positionMode, permissionKeys });
ok(derive("admin", ownerKeys) === "boss", "派生：平台 admin + owner → boss");
ok(derive("admin", tradeRepKeys) === "trade", "派生：平台 admin + trade_rep → trade");
ok(derive("admin", salesRepKeys) === "sales", "派生：平台 admin + sales_rep → sales");
ok(derive("admin", []) === "user", "派生：平台 admin 无绑定 → user");
ok(derive("trade", tradeRepKeys) === "trade", "派生：平台 trade + trade_rep → trade（与压扁后相同）");
ok(derive("trade", ownerKeys) === "boss", "派生：平台 trade 按键（绑 owner → boss）");
ok(derive("super_admin", []) === "super_admin", "派生：super_admin 保留");
ok(derive("admin", [], false) === "admin" && derive("sales", [], false) === "sales", "派生：旧模式原样（下游按 platformTier 把 admin 当 user）");
ok(isReservedPlatformRole("super_admin") && !isReservedPlatformRole("admin") && !isReservedPlatformRole("trade"), "保留名单只剩 super_admin");

// ── Muse ──
ok(!(SALES_MANAGER_PLATFORM_ROLES as readonly string[]).includes("admin"), "Muse 销售管理层名单无 admin");
{
  const id = (role: string, orgRole: string) => ({ userId: "u", orgId: "o", role, orgRole, positionMode: false });
  ok(resolveSalesScope(id("admin", "org_member")) === null, "Muse 旧模式：平台 admin + org_member 无销售范围（同 user）");
  ok(resolveSalesScope(id("super_admin", "org_member"))?.kind === "org", "Muse：super_admin 全组织");
}

// ── 导航（旧模式按平台角色的入口） ──
ok(!(NAV_ROLES_EXEC as readonly string[]).includes("admin") && (NAV_ROLES_EXEC as readonly string[]).includes("super_admin"), "导航业务入口角色表无 admin");
{
  const navCtx = (platformRole: string): NavigationFilterContext => ({
    pathname: "/",
    platformRole,
    orgRole: "org_member",
    hasMembership: true,
    workspaceIds: ["ws1"],
    modules: { enabled: ["sales", "trade", "operations", "marketing", "product_content", "bids", "projects", "window_covering"] },
    isPlatformAdmin: isPlatformAdmin(platformRole),
  });
  const hrefs = (role: string) => flattenVisibleHrefs(resolveNavigationTree(NAVIGATION_REGISTRY, navCtx(role))).sort().join();
  ok(hrefs("admin") === hrefs("user"), "旧模式导航：平台 admin 与 user 相同");
  ok(hrefs("super_admin") !== hrefs("user"), "旧模式导航：super_admin 仍多出平台入口");
}

// ── 压扁 ──
ok((COLLAPSIBLE_PLATFORM_ROLES as readonly string[]).includes("admin") && !(COLLAPSIBLE_PLATFORM_ROLES as readonly string[]).includes("super_admin"), "压扁范围含 admin、不含 super_admin");
{
  const m = (userId: string, platformRole: string, activeBindingCount: number) => ({ userId, email: `${userId}@x`, platformRole, memberStatus: "active", activeBindingCount });
  const plan = planCollapse({ orgCode: "sunny", positionMode: true, members: [m("a", "admin", 1), m("s", "super_admin", 0), m("u", "user", 0), m("b", "boss", 1)], otherMemberships: [] });
  ok(plan.change.map((c) => c.userId).sort().join() === "a,b" && plan.blockers.length === 0, "压扁计划：有绑定的 admin 与 boss 进计划，super_admin / user 不动", plan);
  const blocked = planCollapse({ orgCode: "sunny", positionMode: true, members: [m("a", "admin", 0)], otherMemberships: [] });
  ok(blocked.blockers.some((b) => b.includes("a@x") && b.includes("无 active 岗位绑定")), "压扁计划：无绑定的 admin 阻断", blocked.blockers);
}

// ── 签发与源码断言 ──
{
  const invite = src("src/app/api/admin/invite-codes/route.ts");
  const users = src("src/app/api/users/[id]/route.ts");
  const validRoles = (s: string) => (s.match(/const validRoles = \[([\s\S]*?)\];/)?.[1] ?? "");
  ok(validRoles(invite).length > 0 && !/"admin"/.test(validRoles(invite)), "邀请码 validRoles 无 admin");
  ok(validRoles(users).length > 0 && !/"admin"/.test(validRoles(users)), "平台用户修改 validRoles 无 admin");
  const reg = src("src/app/api/auth/register/route.ts");
  ok(reg.includes('const assignedRole = invite.role === "admin" ? "user" : invite.role;'), "注册：历史 admin 邀请码按 user 落");
  ok(!src("src/app/(main)/admin/users/page.tsx").includes('<option value="admin">') && !src("src/app/(main)/admin/invite-codes/page.tsx").includes('<option value="admin">'), "平台用户页 / 邀请码页无「平台管理员」选项");
  ok(src("src/app/api/cron/release-drift/route.ts").includes('where: { role: "super_admin", status: "active" }'), "发布漂移通知发给 super_admin");
  ok(src("src/lib/hooks/use-current-user.ts").includes("const isPlatformAdmin = isSuperAdmin(user?.role);"), "useCurrentUser.isPlatformAdmin 只认 super_admin");
  ok(/const normalizedRole = platformTier\(user\.role\);/.test(src("src/lib/auth/guards.ts")), "requireRole 用 platformTier");

  const D3 = [
    "src/app/(main)/sales/cockpit/discount-stats-card.tsx",
    "src/app/api/projects/[id]/org-rules/route.ts",
    "src/app/api/org/knowledge/route.ts",
    "src/app/api/org/knowledge/[id]/route.ts",
    "src/app/api/org/knowledge/search/route.ts",
    "src/app/api/org/knowledge/import/route.ts",
    "src/app/api/org/project-rules/route.ts",
    "src/app/api/agent/trace/route.ts",
    "src/app/api/agent/trace/sessions/[sessionId]/runs/route.ts",
    "src/app/api/agent/trace/runs/[runId]/route.ts",
    "src/app/api/messaging/gateway/route.ts",
    "src/app/api/secretary/briefing/route.ts",
    "src/lib/agent-scope/resolve.ts",
    "src/lib/agent-runtime-v2/executor.ts",
    "src/lib/agent-runtime/process.ts",
    "src/lib/agent-supervisor/engine.ts",
    "src/lib/agent-supervisor/workers/run-worker.ts",
    "src/lib/agent-core/tool-registry.ts",
    "src/lib/agent-core/engine.ts",
    "src/lib/operations/dashboard/build-dashboard.ts",
    "src/lib/messaging/binding.ts",
    "src/lib/ai/prompts/common.ts",
    "src/lib/secretary/briefing.ts",
  ];
  const handWritten = /(role|Role)\s*[!=]==\s*"admin"|case "admin":/;
  const offenders = D3.filter((p) => handWritten.test(src(p)));
  ok(offenders.length === 0, "D3 清单文件无手写平台 admin 判断", offenders);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
