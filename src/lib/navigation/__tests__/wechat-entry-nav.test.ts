/**
 * 导航里的"微信集成"入口受微信入口开关控制（openspec change hide-wechat-entry / COLLAB-1）
 * spec identity/wechat-entry「导航里的微信入口」；navigation/position-based-visibility「岗位模式判定」「岗位模式的导航入口」
 * 纯函数，无 DB。
 * 运行：npx tsx src/lib/navigation/__tests__/wechat-entry-nav.test.ts
 */

import {
  NAVIGATION_REGISTRY,
  SYSTEM_NAV_ITEMS,
  resolveNavigationTree,
  type NavigationFilterContext,
  type NavigationItem,
  type ResolvedNavItem,
} from "../index";
import { WINDOW_COVERING_INDUSTRY_PACK, mergedProfileBindings } from "@/lib/authorization/role-defaults";
import { PERMISSION_REGISTRY } from "@/lib/authorization/permissions";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}${detail === undefined ? "" : ` → ${JSON.stringify(detail).slice(0, 400)}`}`);
  }
}

const MODULES = {
  enabled: ["sales", "trade", "operations", "marketing", "product_content", "bids", "projects", "window_covering", "supply_chain"],
};

/** 与 seed 落库后一致：系统模板 + 窗饰行业包并集的 ALLOW 键（同 position-nav.test.ts） */
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
const ALL_KEYS = PERMISSION_REGISTRY.map((p) => p.key);

function base(partial: Partial<NavigationFilterContext>): NavigationFilterContext {
  return {
    pathname: "/",
    platformRole: "user",
    orgRole: "org_member",
    hasMembership: true,
    workspaceIds: ["ws1"],
    modules: MODULES,
    isPlatformAdmin: false,
    permissionKeys: [],
    positionMode: false,
    ...partial,
  };
}

function flat(items: ResolvedNavItem[]): ResolvedNavItem[] {
  return items.flatMap((i) => [i, ...(i.children ? flat(i.children) : [])]);
}
const keys = (c: NavigationFilterContext) => flat(resolveNavigationTree(NAVIGATION_REGISTRY, c)).map((i) => i.key).sort();
const hrefs = (c: NavigationFilterContext) =>
  [...flat(resolveNavigationTree(NAVIGATION_REGISTRY, c)), ...flat(resolveNavigationTree(SYSTEM_NAV_ITEMS, c))].map((i) => i.href);
const hasWechat = (c: NavigationFilterContext) => hrefs(c).includes("/wechat");

/** 三种开关状态：打开 / 关闭 / 上下文缺值 */
const on = (c: NavigationFilterContext) => ({ ...c, wechatEntryEnabled: true });
const off = (c: NavigationFilterContext) => ({ ...c, wechatEntryEnabled: false });
const missing = (c: NavigationFilterContext): NavigationFilterContext => {
  const rest = { ...c };
  delete rest.wechatEntryEnabled;
  return rest;
};

console.log("wechat-entry-nav（COLLAB-1）");

console.log("\n注册表");
{
  const all = (items: NavigationItem[]): NavigationItem[] => items.flatMap((i) => [i, ...(i.children ? all(i.children) : [])]);
  const items = [...all(NAVIGATION_REGISTRY), ...all(SYSTEM_NAV_ITEMS)];
  const flagged = items.filter((i) => i.wechatEntry);
  ok(flagged.length === 1 && flagged[0].key === "mgmt-wechat" && flagged[0].href === "/wechat", "只有 mgmt-wechat（/wechat）标了 wechatEntry", flagged.map((i) => i.key));
  const wechatHrefs = items.filter((i) => i.href === "/wechat" || i.href?.startsWith("/settings/wechat") || i.href?.startsWith("/wechat/"));
  ok(wechatHrefs.every((i) => i.wechatEntry === true), "指向两个微信页面的导航项都受开关控制", wechatHrefs.map((i) => i.key));
}

const CASES: Array<[string, NavigationFilterContext]> = [
  ["旧模式 boss 企业成员", base({ platformRole: "boss", orgRole: "org_admin" })],
  ["旧模式 operations 企业成员", base({ platformRole: "operations" })],
  ["岗位模式 owner", base({ positionMode: true, orgRole: "org_owner", permissionKeys: keysOf("owner") })],
];

console.log("\n开关打开：按改动前的规则");
for (const [name, c] of CASES) {
  ok(hasWechat(on(c)) && keys(on(c)).includes("mgmt-wechat"), `${name} 可见"微信集成"`);
}
ok(!hasWechat(on(base({ platformRole: "sales" }))), "旧模式 sales 仍不可见（销售本来就不显示）");

console.log("\n开关关闭或上下文缺值：任何人都看不到");
for (const [name, c] of CASES) {
  const expected = keys(on(c)).filter((k) => k !== "mgmt-wechat");
  for (const [state, cc] of [["关闭", off(c)], ["缺值", missing(c)]] as const) {
    ok(!hasWechat(cc), `${name}（${state}）：导航中没有 /wechat`);
    const got = keys(cc);
    ok(
      got.length === expected.length && got.every((k, i) => k === expected[i]),
      `${name}（${state}）：其余可见项与开关打开时相同`,
      { extra: got.filter((k) => !expected.includes(k)), missing: expected.filter((k) => !got.includes(k)) },
    );
  }
}

{
  const leaks: string[] = [];
  for (const positionMode of [false, true]) {
    for (const platformRole of ["super_admin", "admin", "boss", "manager", "operations", "trade", "user", "sales", null]) {
      for (const orgRole of ["org_owner", "org_admin", "manager", "org_member", null]) {
        const c = base({
          positionMode,
          platformRole,
          orgRole,
          isPlatformAdmin: platformRole === "super_admin" || platformRole === "admin",
          permissionKeys: ALL_KEYS,
        });
        if (hasWechat(off(c)) || hasWechat(missing(c))) leaks.push(`${positionMode ? "岗位" : "旧"}/${platformRole}/${orgRole}`);
      }
    }
  }
  ok(leaks.length === 0, "关闭时不论平台角色、企业角色或岗位（含全权限键），侧栏与系统区都没有 /wechat", leaks);
}

console.log(`\nwechat-entry-nav: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
