/**
 * VIS-1b 入口判定（spec navigation/entry-visibility、navigation/position-based-visibility；change vis-1b-home-and-shell）
 * 判定输入拼装与路由门 loader 一致 + 客户端判定与路由门 HTTP 结果一致 + 纯模块源码断言
 * 运行：npx tsx src/lib/navigation/__tests__/entry-visibility.test.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";
import {
  ROUTE_GATE_TABLE,
  TtlCache,
  applyRouteGate,
  type RouteGateUser,
} from "../route-gate";
import { createRouteGateLoader } from "../context-server";
import {
  activeOrgNavigationFields,
  buildNavigationFilterContext,
  inputsFromActiveOrgResponse,
  type OrgNavigationInputs,
  type RouteGateContext,
} from "../filter-context";
import { canOpenHref } from "../landing";
import {
  HOME_TEXTILE_TRADE_INDUSTRY_PACK,
  WINDOW_COVERING_INDUSTRY_PACK,
  mergedProfileBindings,
} from "@/lib/authorization/role-defaults";
import { DEFAULT_MENGXIN_MODULES, DEFAULT_SUNNY_MODULES, type OrgModule } from "@/lib/tenancy/modules";

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
const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");

// ─────────────────────────── 身份（企业侧输入 + 平台角色）───────────────────────────

function keysOf(pack: string, ...positions: string[]): string[] {
  return [
    ...new Set(
      positions.flatMap((p) =>
        mergedProfileBindings(pack, p)
          .filter((b) => (b.effect ?? "ALLOW") === "ALLOW")
          .map((b) => b.permissionKey),
      ),
    ),
  ];
}
const sunny = (...p: string[]) => keysOf(WINDOW_COVERING_INDUSTRY_PACK, ...p);
const mengxin = (...p: string[]) => keysOf(HOME_TEXTILE_TRADE_INDUSTRY_PACK, ...p);
const LEGACY_MODULES: OrgModule[] = ["sales", "trade", "marketing", "operations", "product_content", "supply_chain"];

type Identity = { role: string; inputs: OrgNavigationInputs };
function inputs(partial: Partial<OrgNavigationInputs>): OrgNavigationInputs {
  return {
    modules: { enabled: [...DEFAULT_SUNNY_MODULES] },
    positionMode: true,
    orgRole: "org_member",
    hasMembership: true,
    workspaceIds: [],
    hasBidCapability: false,
    permissionKeys: [],
    ...partial,
  };
}
const MX = { enabled: [...DEFAULT_MENGXIN_MODULES] };
const IDENTITIES: Record<string, Identity> = {
  sales_rep: { role: "user", inputs: inputs({ permissionKeys: sunny("sales_rep") }) },
  pricing_lead: { role: "user", inputs: inputs({ permissionKeys: sunny("pricing_lead") }) },
  owner: { role: "user", inputs: inputs({ permissionKeys: sunny("owner"), orgRole: "org_admin" }) },
  owner_sales_only: { role: "user", inputs: inputs({ permissionKeys: sunny("owner"), orgRole: "org_admin", modules: { enabled: ["sales"] } }) },
  bids: { role: "user", inputs: inputs({ permissionKeys: sunny("bids") }) },
  ops_lead: { role: "user", inputs: inputs({ permissionKeys: sunny("ops_lead") }) },
  ops_staff: { role: "user", inputs: inputs({ permissionKeys: sunny("ops_staff") }) },
  ops_lead_bids: { role: "user", inputs: inputs({ permissionKeys: sunny("ops_lead", "bids") }) },
  accounting: { role: "user", inputs: inputs({ permissionKeys: sunny("accounting") }) },
  installer: { role: "user", inputs: inputs({ permissionKeys: sunny("installer") }) },
  fulfillment_vinyl: { role: "user", inputs: inputs({ permissionKeys: sunny("fulfillment_vinyl") }) },
  no_position: { role: "user", inputs: inputs({}) },
  project_member: { role: "user", inputs: inputs({ hasBidCapability: true }) },
  no_membership: { role: "user", inputs: inputs({ orgRole: null, hasMembership: false }) },
  mx_cathy: { role: "user", inputs: inputs({ modules: MX, permissionKeys: mengxin("owner", "trade_rep"), orgRole: "org_admin" }) },
  mx_trade_rep: { role: "user", inputs: inputs({ modules: MX, permissionKeys: mengxin("trade_rep") }) },
  legacy_sales: { role: "sales", inputs: inputs({ positionMode: false, modules: { enabled: LEGACY_MODULES }, permissionKeys: sunny("sales_rep") }) },
  legacy_boss: { role: "boss", inputs: inputs({ positionMode: false, orgRole: "org_admin", modules: { enabled: LEGACY_MODULES } }) },
  super_admin: { role: "super_admin", inputs: inputs({ permissionKeys: [] }) },
};
const NAMES = Object.keys(IDENTITIES);
const FLAGS = { autopilotAllowed: false, wechatEntryEnabled: false };

/** 客户端路径：active-org 响应（JSON 往返）→ 还原 → 拼装 */
function clientCtx(id: Identity, flags = FLAGS): RouteGateContext {
  const body = JSON.parse(JSON.stringify({ activeOrgId: "org1", orgCode: "x", ...activeOrgNavigationFields(id.inputs) }));
  return buildNavigationFilterContext(inputsFromActiveOrgResponse(body), { role: id.role }, flags);
}

function loaderFor(id: Identity, flags = FLAGS) {
  return createRouteGateLoader({
    findUser: async () => ({ id: "u1", role: id.role, status: "active", activeOrgId: "org1" }),
    findUsableOrgIds: async () => ["org1"],
    loadOrgInputs: async () => ({ inputs: id.inputs, degraded: false }),
    cache: new TtlCache({ ttlMs: 1000, max: 10 }),
    autopilotAllowed: () => flags.autopilotAllowed,
    wechatEntryEnabled: () => flags.wechatEntryEnabled,
  });
}
const gateUser = (id: Identity): RouteGateUser => ({ id: "u1", role: id.role, status: "active", activeOrgId: "org1" });

/** 门表条目对应的示例路径：`*` → x，去掉结尾 `=`；再加一层子路径 */
const samplePaths = (() => {
  const out = new Set<string>(["/", "/no-such-workspace"]);
  for (const e of ROUTE_GATE_TABLE) {
    const p = e.pattern.replace(/=$/, "").replace(/\*/g, "x") || "/";
    out.add(p);
    if (!e.pattern.endsWith("=")) out.add(`${p === "/" ? "" : p}/x`);
  }
  return [...out];
})();

async function main() {
  console.log("entry-visibility（VIS-1b）");

  // ── 判定输入拼装：客户端与路由门 loader 逐字段相同 ──
  {
    const diffs: string[] = [];
    for (const name of NAMES) {
      const id = IDENTITIES[name];
      for (const flags of [FLAGS, { autopilotAllowed: true, wechatEntryEnabled: true }]) {
        const server = await loaderFor(id, flags).loadContext(gateUser(id));
        const client = clientCtx(id, flags);
        if (JSON.stringify(server) !== JSON.stringify(client)) diffs.push(name);
      }
    }
    ok(diffs.length === 0, `客户端由 active-org 响应拼出的判定输入与 loader 逐字段相同（${NAMES.length} 种身份 × 2 组开关${diffs.length ? "；不同：" + diffs.join(",") : ""}）`);
    const roundTrip = NAMES.every((n) => {
      const i = IDENTITIES[n].inputs;
      return JSON.stringify(inputsFromActiveOrgResponse(JSON.parse(JSON.stringify(activeOrgNavigationFields(i))))) === JSON.stringify(i);
    });
    ok(roundTrip, "active-org 导航字段 → 还原：企业侧输入不变");
    const legacy = inputsFromActiveOrgResponse({ orgRole: "org_member" });
    ok(legacy.hasMembership === true && legacy.modules === null && legacy.permissionKeys.length === 0, "响应缺 hasMembership 时按 orgRole 推出成员身份（与侧栏既有口径一致）");
    ok(inputsFromActiveOrgResponse(null).hasMembership === false && inputsFromActiveOrgResponse("x").positionMode === false, "响应不是对象：按「无企业」处理");
  }

  // ── 客户端判定与路由门一致（HTTP 层，含 super_admin 旁路）──
  {
    const mismatches: string[] = [];
    for (const name of NAMES) {
      const id = IDENTITIES[name];
      const loader = loaderFor(id);
      const c = clientCtx(id);
      for (const path of samplePaths) {
        const res = await applyRouteGate(new NextRequest(`http://localhost${path}`), "u1", loader);
        if ((res === null) !== canOpenHref(path, c)) mismatches.push(`${name} ${path}`);
      }
    }
    ok(mismatches.length === 0, `${NAMES.length} 种身份 × ${samplePaths.length} 条登记路径：客户端判定与路由门结果相同${mismatches.length ? "；不同：" + mismatches.slice(0, 8).join(" | ") : ""}`);
    const sa = clientCtx(IDENTITIES.super_admin);
    ok(samplePaths.every((p) => canOpenHref(p, sa)), "平台 super_admin：全部放行");
    ok(!canOpenHref("/tasks", null) && !canOpenHref("/", null), "输入未就绪：一律不放行（入口不先显示后消失）");
    const lynn = clientCtx(IDENTITIES.sales_rep);
    ok(canOpenHref("/sales?view=customers", lynn) && !canOpenHref("/bids?tab=rfq#x", lynn), "href 的查询串与锚点不参与判定");
  }

  // ── 纯模块：不导入 next/server ──
  {
    const PURE = [
      "src/lib/navigation/route-gate-core.ts",
      "src/lib/navigation/landing.ts",
      "src/lib/navigation/filter-context.ts",
      "src/lib/navigation/use-navigation-access.ts",
    ];
    const bad = PURE.filter((p) => /from "next\/server"|from "\.\/route-gate"|from "\.\/context-server"|@\/lib\/db/.test(read(p)));
    ok(bad.length === 0, `纯模块不导入 next/server / route-gate.ts / context-server / db${bad.length ? "（" + bad.join(",") + "）" : ""}`);
    const hook = read("src/lib/navigation/use-navigation-access.ts");
    ok(/buildNavigationFilterContext/.test(hook) && /inputsFromActiveOrgResponse/.test(hook) && /canOpenHref/.test(hook) && /resolveLandingPage/.test(hook), "钩子用共享拼装与判定函数");
    const cs = read("src/lib/navigation/context-server.ts");
    ok(/buildNavigationFilterContext\(org, \{ role: user\.role \}/.test(cs), "路由门 loader 用同一个拼装函数");
    const ao = read("src/app/api/auth/active-org/route.ts");
    ok(/activeOrgNavigationFields\(navInputs\)/.test(ao), "active-org 导航字段经 activeOrgNavigationFields 输出");
  }

  console.log(`\n结果: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
