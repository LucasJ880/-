/**
 * PERM-6a：外贸按岗位权限键（纯：模板 / 兼容回退 / 派生角色 / 通道矩阵 / 路由表源码断言）
 * 运行：npx tsx src/lib/trade/__tests__/trade-access.test.ts
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { SYSTEM_ROLE_PROFILES, WINDOW_COVERING_INDUSTRY_PACK, mergedProfileBindings } from "@/lib/authorization/role-defaults";
import { compatProfileKeyForMembership } from "@/lib/authorization/resolve-effective-permissions";
import { getPermissionDefinition } from "@/lib/authorization/permissions";
import { deriveEffectivePlatformRole } from "@/lib/rbac/effective-platform-role";
import { roleCanManageTradeChannels } from "../channel-access";
import {
  TRADE_CHANNEL_KEYS,
  TRADE_MANAGE_KEYS,
  TRADE_READ_KEYS,
  TRADE_SETTINGS_KEYS,
} from "../access";

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

const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const sysKeys = (key: string) => new Set((SYSTEM_ROLE_PROFILES.find((p) => p.key === key)?.bindings ?? []).map((b) => b.permissionKey));

console.log("trade-access（PERM-6a）");

// ── 键与模板 ──
for (const k of ["trade.read", "trade.manage", "trade.settings.manage"]) {
  const d = getPermissionDefinition(k);
  ok(!!d && d.allowedPrincipalTypes.join() === "HUMAN" && d.supportedScopes.join() === "ORG", `${k}：已登记、HUMAN only、ORG`);
}
ok(sysKeys("trade_rep").has("trade.read") && sysKeys("trade_rep").has("trade.manage"), "trade_rep：读写");
ok(!sysKeys("trade_rep").has("trade.settings.manage"), "trade_rep：不含设置");
ok(["trade.read", "trade.manage", "trade.settings.manage"].every((k) => sysKeys("org_owner").has(k)), "org_owner：外贸三键");
ok(sysKeys("org_admin").has("trade.settings.manage") && !sysKeys("org_admin").has("trade.read"), "org_admin：只有设置键");
ok(new Set(mergedProfileBindings(WINDOW_COVERING_INDUSTRY_PACK, "owner").map((b) => b.permissionKey)).has("trade.manage"), "窗饰 owner：外贸");
ok(TRADE_READ_KEYS.join() === "trade.read,trade.manage" && TRADE_MANAGE_KEYS.join() === "trade.manage", "读键 = 读或写；写键 = 写");
ok(TRADE_SETTINGS_KEYS.join() === "trade.settings.manage" && TRADE_CHANNEL_KEYS.length === 3, "设置键；通道入口三键任一");

// ── 兼容回退 ──
ok(compatProfileKeyForMembership({ orgRole: "org_member", platformRole: "trade" }) === "trade_rep", "旧模式 平台 trade + org_member → trade_rep");
ok(compatProfileKeyForMembership({ orgRole: "org_member", platformRole: "sales" }) === "sales_rep", "平台 sales 映射不变");
ok(compatProfileKeyForMembership({ orgRole: "org_owner", platformRole: "admin" }) === "org_owner", "梦馨老板（平台 admin、org_owner）→ 系统 org_owner（含外贸）");
ok(compatProfileKeyForMembership({ orgRole: "org_member", platformRole: "admin" }) === null, "平台 admin + org_member：无兼容岗位（不再隐含外贸）");
{
  const seed = src("src/lib/authorization/seed-org-profiles.ts");
  ok(/trade:\s*profileIdByKey\.get\("trade_rep"\)/.test(seed), "seed：平台 trade 自动绑 trade_rep");
}

// ── 派生角色 ──
const derive = (platformRole: string, keys: string[]) => deriveEffectivePlatformRole({ platformRole, positionMode: true, permissionKeys: keys });
ok(derive("user", ["trade.read", "trade.manage"]) === "trade", "岗位模式 user + trade_rep → trade");
ok(derive("user", ["operations.read", "trade.read"]) === "operations", "运营优先于外贸");
ok(derive("user", ["sales.quote.create", "trade.read"]) === "sales", "销售优先于外贸");
ok(derive("user", ["organization.dashboard.read", "trade.read"]) === "boss", "管理层优先");
ok(derive("trade", ["trade.read"]) === "trade" && derive("trade", []) === "user", "PERM-7b：平台 trade 按键派生（trade.read → trade）");
ok(deriveEffectivePlatformRole({ platformRole: "user", positionMode: false, permissionKeys: ["trade.read"] }) === "user", "旧模式不派生");

// ── 通道矩阵（旧模式等价） ──
ok(!roleCanManageTradeChannels("admin", null, false), "平台 admin：不再隐含通道管理");
ok(roleCanManageTradeChannels("super_admin", null, false), "平台 super_admin：可管理");
ok(roleCanManageTradeChannels("trade", "org_owner", true) && roleCanManageTradeChannels("trade", "org_admin", true), "企业负责人 / 管理员：可管理");
ok(!roleCanManageTradeChannels("trade", "org_member", true), "外贸业务员：不可管理");
{
  const ca = src("src/lib/trade/channel-access.ts");
  ok(ca.includes("holdsTradePermission(user, orgId, [TRADE_SETTINGS_MANAGE])"), "canManageTradeChannels 运行时按设置键");
  // 通道管理处理器：入口三键任一，随后必须经 canManageTradeChannels（企业管理员只持设置键也能进；业务员得 CHANNEL_MANAGE_FORBIDDEN）
  for (const f of ["src/app/api/trade/channels/route.ts", "src/app/api/trade/channels/[channel]/route.ts"]) {
    const s = src(f);
    const writes = [...s.matchAll(/^export async function (POST|PATCH|DELETE)\b/gm)];
    ok(writes.length > 0 && writes.every((w, i) => {
      const body = s.slice(w.index!, writes[i + 1]?.index ?? s.length);
      return body.includes("canManageTradeChannels(auth.user, orgRes.orgId)") && body.includes("channelManageForbiddenResponse()");
    }), `${f.split("/api/trade/")[1]}：写处理器都经 canManageTradeChannels`);
  }
}

// ── 守卫与企业解析 ──
{
  const access = src("src/lib/trade/access.ts");
  ok(!/\bisAdmin\(/.test(access), "trade/access.ts：不再用 isAdmin（平台 admin 不隐含）");
  ok((access.match(/if \(isPlatformSuperAdmin\(user\.role\)\) \{/g) ?? []).length === 2, "resolveTradeOrgId / assertUserCanAccessTradeOrg：显式企业通道只给 super_admin");
  const guardAt = access.indexOf("export async function requireTradePermission(");
  const guard = access.slice(guardAt, access.indexOf("\n}\n", guardAt));
  ok(guard.includes("if (isPlatformSuperAdmin(auth.user.role)) return auth;"), "守卫：super_admin 放行");
  ok(guard.indexOf("resolveTradeOrgId(request, auth.user)") < guard.indexOf("holdsTradePermission("), "守卫：先解析企业再判键");
}

// ── 路由表 ──
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : n === "route.ts" ? [p] : [];
  });
}
const root = join(process.cwd(), "src/app/api/trade");
const routes = walk(root);
const rel = (p: string) => p.slice(root.length + 1);
ok(routes.length >= 80, `外贸路由文件 ${routes.length} 个`);
let guarded = 0;
let mismatches: string[] = [];
for (const f of routes) {
  const s = readFileSync(f, "utf8");
  const r = rel(f);
  ok(!s.includes("requireRole("), `${r}：无 requireRole`);
  const isMachine = r.startsWith("webhook/") || r.startsWith("cron/");
  if (isMachine) {
    ok(!s.includes("requireTradePermission("), `${r}：机器入口不看用户岗位`);
    continue;
  }
  const handlers = [...s.matchAll(/^export (?:async function|const) (GET|POST|PUT|PATCH|DELETE)\b/gm)];
  handlers.forEach((h, i) => {
    const body = s.slice(h.index!, i + 1 < handlers.length ? handlers[i + 1].index! : s.length);
    const m = body.match(/requireTradePermission\(request, (TRADE_[A-Z_]+_KEYS)\)|requireTradePlatformAdmin\(request\)/);
    if (!m) return;
    guarded++;
    const method = h[1];
    const key = m[1] ?? "PLATFORM";
    let expected: string;
    if (r.startsWith("email-profile/") || r === "email-profile/route.ts" || r.startsWith("email-sender")) {
      expected = method === "DELETE" && r.startsWith("email-sender") ? "PLATFORM" : "TRADE_SETTINGS_KEYS";
    } else if (r.startsWith("channels/") && !r.includes("/send/")) expected = "TRADE_CHANNEL_KEYS";
    else expected = method === "GET" ? "TRADE_READ_KEYS" : "TRADE_MANAGE_KEYS";
    if (key !== expected) mismatches.push(`${r} ${method}: ${key} ≠ ${expected}`);
  });
}
ok(guarded === 110, `守卫处理器 110 个（实际 ${guarded}）`);
ok(mismatches.length === 0, `每个处理器的守卫键与方法一致${mismatches.length ? "：" + mismatches.join("; ") : ""}`);
mismatches = [];
{
  const sender = src("src/app/api/trade/email-sender/route.ts");
  ok(!/\bisAdmin\(/.test(sender) && sender.includes("isPlatformSuperAdmin(auth.user.role)"), "发件邮箱修改只给 super_admin");
  const research = src("src/app/api/trade/prospects/[id]/research/route.ts");
  ok(!/\bisAdmin\(/.test(research), "调试评分只给 super_admin");
}

// ── 导航 ──
{
  const filter = src("src/lib/navigation/filter.ts");
  ok(filter.includes('(ctx.permissionKeys ?? []).includes("trade.read")'), "岗位模式外贸入口认 trade.read");
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
