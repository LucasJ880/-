/**
 * PERM-4c4：岗位派生平台角色（纯：规则表、工具列表等价、Muse 范围、接入点源码断言）
 * 运行：npx tsx src/lib/rbac/__tests__/effective-platform-role.test.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { deriveEffectivePlatformRole, isReservedPlatformRole } from "../effective-platform-role";
import { WINDOW_COVERING_INDUSTRY_PACK, mergedProfileBindings } from "@/lib/authorization/role-defaults";
import { registry } from "@/lib/agent-core/tool-registry";
import "@/lib/agent-core/tools";
import { amountsVisible, resolveSalesScope } from "@/lib/muse-bridge/sales-pure";

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

function keysOf(...positions: string[]): string[] {
  return [
    ...new Set(
      positions.flatMap((p) =>
        mergedProfileBindings(WINDOW_COVERING_INDUSTRY_PACK, p)
          .filter((b) => (b.effect ?? "ALLOW") === "ALLOW")
          .map((b) => b.permissionKey),
      ),
    ),
  ];
}

const derive = (platformRole: string | null, positions: string[], positionMode = true) =>
  deriveEffectivePlatformRole({ platformRole, positionMode, permissionKeys: keysOf(...positions) });

const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

console.log("effective-platform-role（PERM-4c4）");

// ── 规则表（岗位模式） ──
ok(derive("user", ["owner"]) === "boss", "owner → boss");
ok(derive("user", ["sales_rep"]) === "sales", "sales_rep → sales");
ok(derive("user", ["pricing_lead"]) === "sales", "pricing_lead → sales");
ok(derive("user", ["ops_lead"]) === "operations", "ops_lead → operations");
ok(derive("user", ["ops_staff"]) === "operations", "ops_staff → operations");
ok(derive("user", ["accounting"]) === "user", "accounting → user");
ok(derive("user", ["bids"]) === "user", "bids → user");
ok(derive("user", ["fulfillment_vinyl"]) === "user", "出单岗 → user");
ok(derive("user", ["installer"]) === "user", "installer → user");
ok(derive("user", []) === "user", "无岗位 → user");
ok(derive("user", ["owner", "pricing_lead", "accounting"]) === "boss", "多岗：owner 优先（取最高一项）");
ok(derive("user", ["pricing_lead", "ops_staff"]) === "sales", "多岗：销售优先于运营");
ok(derive("boss", ["ops_staff"]) === "operations", "平台 boss + ops_staff → operations（平台角色不决定）");
ok(derive("sales", ["accounting"]) === "user", "平台 sales + accounting → user");
ok(derive("operations", ["sales_rep"]) === "sales", "平台 operations + sales_rep → sales");
ok(derive(null, ["sales_rep"]) === "sales", "平台角色缺省按 user 处理");
ok(deriveEffectivePlatformRole({ platformRole: "user", positionMode: true, permissionKeys: null }) === "user", "权限键解析失败（null）→ user");

// ── 保留角色（PERM-7b：只剩 super_admin；平台 admin / trade 按岗位派生） ──
ok(derive("super_admin", []) === "super_admin" && derive("super_admin", ["owner"]) === "super_admin", "保留角色 super_admin 原样");
ok(isReservedPlatformRole("super_admin"), "isReservedPlatformRole(super_admin)");
ok(derive("admin", []) === "user" && derive("admin", ["owner"]) === "boss", "PERM-7b：平台 admin 按岗位派生（无绑定 user、owner → boss）");
ok(derive("trade", ["trade_rep"]) === "trade" && derive("trade", ["owner"]) === "boss", "PERM-7b：平台 trade 按岗位派生（trade_rep → trade）");
ok(!isReservedPlatformRole("admin") && !isReservedPlatformRole("trade"), "PERM-7b：admin / trade 不再是保留角色");
ok(!isReservedPlatformRole("boss") && !isReservedPlatformRole("sales"), "boss / sales 不是保留角色");

// ── 旧模式 ──
ok(derive("sales", [], false) === "sales", "旧模式：sales 原样（与绑定无关）");
ok(derive("boss", ["sales_rep"], false) === "boss", "旧模式：boss 原样");
ok(derive("user", ["owner"], false) === "user", "旧模式：user 原样");

// ── 幂等 ──
for (const ps of [["owner"], ["sales_rep"], ["ops_staff"], ["accounting"], []]) {
  const once = derive("user", ps);
  ok(derive(once, ps) === once, `幂等：${ps.join("+") || "无岗位"} → ${once}`);
}

// ── 工具列表等价 ──
const toolNames = (role: string) => new Set(registry.list({ role }).map((t) => t.name));
const same = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every((x) => b.has(x));
{
  const collapsedRep = toolNames(derive("user", ["sales_rep"]));
  const legacyRep = toolNames("sales");
  ok(same(collapsedRep, legacyRep), "压扁后 user + sales_rep 的工具 = 平台 sales 的工具");
  ok(collapsedRep.has("sales_get_pipeline") && collapsedRep.has("secretary_get_briefing") && collapsedRep.has("project_risk_scan"), "包含 sales_* / secretary_* / project_* 工具");
  const opsAsSales = toolNames(derive("sales", ["ops_staff"]));
  ok(![...opsAsSales].some((n) => n.startsWith("sales_")), "平台 sales + ops_staff：不含 sales_* 工具");
  ok(same(toolNames(derive("user", ["owner"])), toolNames("boss")), "压扁后 owner 的工具 = 平台 boss 的工具（等价，不额外给销售工具）");
  ok(same(toolNames(derive("user", [])), toolNames("user")), "无岗位 = user 工具");
}

// ── Muse 销售查询范围（决定 B） ──
const id = (role: string | null, orgRole: string, positionMode?: boolean) => ({ userId: "u1", orgId: "o1", role, orgRole, positionMode });
{
  const boss = resolveSalesScope(id(derive("user", ["owner"]), "org_member", true));
  ok(boss?.kind === "org" && amountsVisible(boss), "岗位模式：owner（派生 boss）→ 全组织 + 金额");
  const rep = resolveSalesScope(id(derive("user", ["sales_rep"]), "org_member", true));
  ok(rep?.kind === "own" && !amountsVisible(rep), "岗位模式：sales_rep（派生 sales）→ 本人，无金额");
  ok(resolveSalesScope(id(derive("user", ["ops_lead"]), "org_owner", true)) === null, "岗位模式：org_owner + ops_lead → 拒绝（企业角色不带全组织）");
  ok(resolveSalesScope(id(derive("user", ["accounting"]), "org_admin", true)) === null, "岗位模式：org_admin + accounting → 拒绝");
  // PERM-7b：平台 admin 不带平台特权——岗位模式先派生（无绑定 → user → 拒绝）
  ok(resolveSalesScope(id(derive("admin", []), "org_member", true)) === null, "岗位模式：平台 admin 无绑定 → 拒绝");
  ok(resolveSalesScope(id("super_admin", "org_member", true))?.kind === "org", "岗位模式：super_admin 仍全组织");
  const legacyOwner = resolveSalesScope(id("user", "org_owner"));
  ok(legacyOwner?.kind === "org" && amountsVisible(legacyOwner), "旧模式：org_owner → 全组织 + 金额（不变）");
  ok(resolveSalesScope(id("sales", "org_member"))?.kind === "own", "旧模式：平台 sales → 本人（不变）");
  ok(resolveSalesScope(id("operations", "org_member")) === null, "旧模式：operations → 拒绝（不变）");
}

// ── 接入点源码断言 ──
{
  const engine = src("src/lib/agent-core/engine.ts");
  ok(/export async function runAgent\(rawOptions: AgentRunOptions\)[^]*?const options = await withEffectiveRole\(rawOptions\);/.test(engine), "runAgent 开头派生");
  ok(/export async function\* runAgentStream\(\s*rawOptions: AgentRunOptions,[^]*?const options = await withEffectiveRole\(rawOptions\);/.test(engine), "runAgentStream 开头派生");
  const threads = src("src/app/api/ai/threads/[threadId]/messages/route.ts");
  ok(!/user\.role\)|role: user\.role/.test(threads.replace("platformRole: user.role", "")), "AI 线程路由：除派生入参外不再直接用 user.role");
  ok(threads.includes("getCapabilities(aiRole)") && threads.includes("isOperatorEnabled({ userId: user.id, role: aiRole })"), "AI 线程路由：能力矩阵与开关白名单用派生角色");
  const checks: Array<[string, string]> = [
    ["src/app/api/ai/threads/[threadId]/runs/[runId]/retry/route.ts", "重试"],
    ["src/app/api/ai/chat/route.ts", "/api/ai/chat"],
    ["src/app/api/agent-core/tools/route.ts", "/api/agent-core/tools"],
    ["src/lib/agent-runtime/process.ts", "微信 executeConversationRun"],
    ["src/lib/agent-runtime-v2/principal.ts", "运行时 v2 主体"],
    ["src/app/api/agent-supervisor/runs/route.ts", "agent-supervisor 发起"],
    ["src/app/api/agent-supervisor/runs/[id]/route.ts", "agent-supervisor 恢复"],
    ["src/lib/muse-bridge/binding.ts", "Muse 身份"],
    ["src/lib/secretary/briefing.ts", "晨报"],
    ["src/lib/agent-scope/resolve.ts", "AI 上下文"],
    ["src/app/api/marketing/employee/route.ts", "营销数字员工"],
  ];
  for (const [p, name] of checks) ok(src(p).includes("resolveEffectivePlatformRole("), `${name}：调用 resolveEffectivePlatformRole`);
  const proc = src("src/lib/agent-runtime/process.ts");
  ok(proc.indexOf("const input = {\n    ...rawInput,") > 0 && proc.indexOf("const input = {\n    ...rawInput,") < proc.indexOf("canUseMarketingDigitalEmployee(input.userRole)"), "微信：先派生再判营销数字员工与域");
  const mkt = src("src/app/api/marketing/employee/route.ts");
  ok(!mkt.includes("canUseMarketingDigitalEmployee(user.role)"), "营销数字员工接口不再直接看 user.role");
  ok(src("src/lib/muse-bridge/sales-pure.ts").includes("!identity.positionMode && has(SALES_MANAGER_ORG_ROLES, identity.orgRole)"), "Muse：岗位模式忽略企业成员角色");
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
