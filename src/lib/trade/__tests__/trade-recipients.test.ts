/**
 * PERM-6c：外贸收件人 / 默认询盘负责人 / 营收中心按外贸键 / 压扁纳入 trade（纯：选择函数矩阵 + 源码断言）
 * 运行：npx tsx src/lib/trade/__tests__/trade-recipients.test.ts
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { isTradeManager, isTradeWorker, pickDefaultInquiryOwner, type TradeMemberSignal } from "../recipients";
import { COLLAPSIBLE_PLATFORM_ROLES } from "@/lib/authorization/platform-role-collapse";
import { NAVIGATION_REGISTRY } from "@/lib/navigation/registry";
import {
  REVENUE_MANAGE_KEYS,
  REVENUE_POLICY_READ_KEYS,
  REVENUE_READ_KEYS,
  REVENUE_SETTINGS_KEYS,
} from "@/lib/revenue-spine/access";

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

const TRADE_ALL = ["trade.read", "trade.manage", "trade.settings.manage"];
const TRADE_REP = ["trade.read", "trade.manage"];
const SALES_REP = ["sales.quote.create", "sales.customer.read"];
const OWNER_WC = ["organization.dashboard.read", "sales.quote.create", ...TRADE_ALL];
const m = (userId: string, orgRole: string, platformRole: string, permissionKeys: string[] | null, userStatus = "active"): TradeMemberSignal => ({
  userId,
  orgRole,
  platformRole,
  userStatus,
  permissionKeys,
});

console.log("trade-recipients（PERM-6c）");

// ── 外贸工作收件人 ──
ok(isTradeWorker(m("a", "org_member", "trade", TRADE_REP)), "工作收件人：trade_rep");
ok(isTradeWorker(m("a", "org_owner", "admin", TRADE_ALL)), "工作收件人：org_owner 模板（梦馨老板）");
ok(isTradeWorker(m("a", "org_member", "user", ["trade.read"])), "工作收件人：只读键也算");
ok(!isTradeWorker(m("a", "org_admin", "user", ["trade.settings.manage"])), "工作收件人：只持设置键不算");
ok(!isTradeWorker(m("a", "org_member", "boss", [])), "工作收件人：不是负责人的平台 boss 不算");
ok(!isTradeWorker(m("a", "org_member", "sales", SALES_REP)), "工作收件人：sales_rep 不算");
ok(!isTradeWorker(m("a", "org_member", "trade", null)), "工作收件人：权限解析失败按无键");

// ── 外贸管理层（旧模式） ──
ok(isTradeManager(m("a", "org_owner", "admin", TRADE_ALL), false), "旧模式管理层：org_owner（梦馨老板）");
ok(!isTradeManager(m("a", "org_admin", "user", ["trade.settings.manage"]), false), "旧模式管理层：只持设置键的 org_admin 不算");
for (const r of ["boss", "manager", "admin"]) ok(!isTradeManager(m("a", "org_member", r, []), false), `旧模式管理层：不是负责人、无外贸键的平台 ${r} 不算`);
ok(isTradeManager(m("a", "org_member", "boss", TRADE_REP), false), "旧模式管理层：平台 boss 且绑了外贸岗位 → 算");
ok(!isTradeManager(m("a", "org_member", "trade", TRADE_REP), false), "旧模式管理层：外贸业务员不算");
ok(isTradeManager(m("a", "org_member", "super_admin", TRADE_ALL), false), "旧模式管理层：super_admin（全权键）");

// ── 外贸管理层（岗位模式） ──
ok(isTradeManager(m("a", "org_member", "user", OWNER_WC), true), "岗位模式管理层：窗饰 owner（压扁后）");
ok(isTradeManager(m("a", "org_member", "boss", OWNER_WC), true), "岗位模式管理层：窗饰 owner（压扁前）");
ok(!isTradeManager(m("a", "org_member", "boss", SALES_REP), true), "岗位模式管理层：平台 boss 只绑 sales_rep 不算（不看平台角色）");
ok(!isTradeManager(m("a", "org_owner", "user", TRADE_ALL), true), "岗位模式管理层：org_owner 无老板岗位不算（4c2 口径）");
ok(!isTradeManager(m("a", "org_member", "user", TRADE_REP), true), "岗位模式管理层：trade_rep 不算");
ok(isTradeManager(m("a", "org_member", "super_admin", TRADE_ALL), true), "岗位模式管理层：super_admin");

// ── 默认询盘负责人 ──
{
  const boss = m("boss", "org_owner", "admin", TRADE_ALL);
  const rep = m("rep", "org_member", "trade", TRADE_REP);
  ok(pickDefaultInquiryOwner([boss, rep], false) === "rep", "旧模式（梦馨）：老板先加入，默认仍给业务员");
  ok(pickDefaultInquiryOwner([boss, m("s", "org_member", "sales", SALES_REP), rep], false) === "s", "旧模式：平台 sales 先于 trade 加入 → sales（与今天同）");
  ok(pickDefaultInquiryOwner([boss], false) === null, "旧模式：只有老板 → 无候选（回退企业 owner）");
  ok(pickDefaultInquiryOwner([m("x", "org_member", "trade", TRADE_REP, "disabled"), rep], false) === "rep", "停用用户跳过");
  ok(pickDefaultInquiryOwner([m("sa", "org_member", "super_admin", TRADE_ALL), rep], false) === "rep", "super_admin 不当默认负责人");
}
{
  const owner = m("owner", "org_member", "user", OWNER_WC);
  ok(pickDefaultInquiryOwner([owner, m("sr", "org_member", "user", SALES_REP)], true) === "sr", "岗位模式：老板岗位不当默认负责人，给销售");
  ok(pickDefaultInquiryOwner([owner, m("tr", "org_member", "user", TRADE_REP)], true) === "tr", "岗位模式压扁后：user + trade_rep → 选到");
  ok(pickDefaultInquiryOwner([owner, m("tr", "org_member", "trade", TRADE_REP)], true) === "tr", "岗位模式压扁前：平台 trade + trade_rep → 选到同一人");
  ok(pickDefaultInquiryOwner([owner, m("sr0", "org_member", "sales", SALES_REP)], true) === "sr0", "岗位模式压扁前：平台 sales → 选到");
  ok(pickDefaultInquiryOwner([owner, m("u", "org_member", "user", [])], true) === null, "岗位模式：无岗位的 user 不选");
}

// ── 接入点源码 ──
{
  const booth = src("src/lib/trade/booth-summary.ts");
  ok(!booth.includes("MANAGEMENT_ROLES") && !booth.includes("isManagementMember"), "booth-summary：不再有平台角色管理层规则");
  ok(booth.includes("return tradeManagementRecipients(orgId);"), "managementOf 转调 tradeManagementRecipients（早报 / 展会小结 / SLA 分级共用）");
  const sla = src("src/lib/trade/inquiry-sla.ts");
  ok(sla.includes("members.filter(isTradeWorker)") && sla.includes("isTradeManager(m, positionMode)"), "inquiry-sla：首次提醒 / 24 小时升级按岗位");
  const wi = src("src/lib/trade/website-inquiry.ts");
  ok(wi.includes("const recipients = await tradeWorkRecipients(orgId);"), "询盘到达通知按外贸工作收件人");
  const intake = src("src/lib/revenue-spine/inquiry-intake.ts");
  ok(intake.includes("return resolveDefaultInquiryOwner(orgId);") && !/role: \{ in:/.test(intake), "默认询盘负责人按派生角色，不再按平台角色列表");
  for (const f of ["src/lib/trade/booth-summary.ts", "src/lib/trade/inquiry-sla.ts", "src/lib/trade/website-inquiry.ts", "src/lib/trade/recipients.ts"]) {
    ok(!src(f).includes('"boss", "manager", "admin"'), `${f.split("/").pop()}：无平台角色收件人列表`);
  }
  ok(!/from "[^"]*booth-summary"/.test(src("src/lib/trade/recipients.ts")), "recipients.ts 不引用 booth-summary（防环）");
}

// ── 营收中心 ──
ok(REVENUE_READ_KEYS.join() === "trade.read,trade.manage" && REVENUE_MANAGE_KEYS.join() === "trade.manage", "营收：读 = 读或写；写 = 写");
ok(REVENUE_SETTINGS_KEYS.join() === "trade.settings.manage" && REVENUE_POLICY_READ_KEYS.length === 3, "营收：发布策略 = 设置；读策略三键任一");
{
  const access = src("src/lib/revenue-spine/access.ts");
  ok(!access.includes("requireRole") && !access.includes("REVENUE_SPINE_ROLES"), "营收守卫不再用 requireRole / 平台角色白名单");
  ok(access.includes("await requireTradePermission(request, keys)"), "营收守卫 = 外贸守卫");
  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((n) => {
      const p = join(dir, n);
      return statSync(p).isDirectory() ? walk(p) : n === "route.ts" ? [p] : [];
    });
  }
  const root = join(process.cwd(), "src/app/api/revenue");
  const routes = walk(root);
  ok(routes.length === 15, `营收路由文件 15 个（实际 ${routes.length}）`);
  let handlers = 0;
  const mismatches: string[] = [];
  for (const f of routes) {
    const s = readFileSync(f, "utf8");
    const r = f.slice(root.length + 1);
    ok(!s.includes("requireRole(") && !/\bisAdmin\(/.test(s), `${r}：无 requireRole / isAdmin`);
    const hs = [...s.matchAll(/^export (?:async function|const) (GET|POST|PUT|PATCH|DELETE)\b/gm)];
    hs.forEach((h, i) => {
      const body = s.slice(h.index!, i + 1 < hs.length ? hs[i + 1].index! : s.length);
      const km = body.match(/resolveRevenueAccess\(request, (REVENUE_[A-Z_]+_KEYS)/);
      handlers++;
      const method = h[1];
      const expected =
        r === "policy/route.ts" ? (method === "PUT" ? "REVENUE_SETTINGS_KEYS" : "REVENUE_POLICY_READ_KEYS") : method === "GET" ? "REVENUE_READ_KEYS" : "REVENUE_MANAGE_KEYS";
      if (km?.[1] !== expected) mismatches.push(`${r} ${method}: ${km?.[1] ?? "无守卫"} ≠ ${expected}`);
    });
  }
  ok(handlers === 16, `营收处理器 16 个（实际 ${handlers}）`);
  ok(mismatches.length === 0, `每个营收处理器的键组与方法一致${mismatches.length ? "：" + mismatches.join("; ") : ""}`);
}
for (const key of ["biz-revenue", "biz-revenue-today"]) {
  const item = NAVIGATION_REGISTRY.find((i) => i.key === key);
  ok(!!item && !(item.requiredPlatformRoles ?? []).includes("sales"), `导航 ${key}：旧模式不再因平台 sales 显示`);
}

// ── 压扁纳入 trade 与剩余读点 ──
ok((COLLAPSIBLE_PLATFORM_ROLES as readonly string[]).includes("trade"), "压扁范围含 trade");
ok(!(COLLAPSIBLE_PLATFORM_ROLES as readonly string[]).some((r) => ["super_admin", "user"].includes(r)), "压扁范围不含 super_admin / user（PERM-7b 起含 admin）");
ok(src("src/components/sidebar.tsx").includes("usesTradeLayout(user?.effectiveRole ?? platformRole)"), "侧栏外贸布局按派生角色");
{
  const onb = src("src/lib/organizations/onboarding.ts");
  ok(onb.includes('const SALES_WORK_KEYS = ["sales.quote.create", "sales.quote.pricing_close", "trade.manage"];'), "入职清单业务员认 trade.manage");
  ok(!onb.includes('? m.user.role === "trade" ||'), "入职清单岗位模式不再看平台 trade");
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
