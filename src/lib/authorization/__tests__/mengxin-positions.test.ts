/**
 * PERM-6b：梦馨（家纺外贸）落岗位（纯：行业包登记 / owner 键 / 绑定文件 / 岗位模式下 Cathy 与 Lucas 的派生角色、落地、收件人）
 * 运行：npx tsx src/lib/authorization/__tests__/mengxin-positions.test.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  HOME_TEXTILE_TRADE_INDUSTRY_PACK,
  SYSTEM_ROLE_PROFILES,
  WINDOW_COVERING_INDUSTRY_PACK,
  hasPositionTemplates,
  positionTemplatesForIndustryPack,
  profilesForIndustryPack,
} from "../role-defaults";
import { parseBindingFile } from "../position-binding";
import { deriveEffectivePlatformRole } from "@/lib/rbac/effective-platform-role";
import { getDefaultWorkspace, isManagementWorkspaceUser, resolveHomeRedirect } from "@/lib/rbac/workspace-policy";
import { usesTradeLayout } from "@/lib/navigation/trade-layout";
import { isTradeManager, isTradeWorker, pickDefaultInquiryOwner, type TradeMemberSignal } from "@/lib/trade/recipients";

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

const PACK = HOME_TEXTILE_TRADE_INDUSTRY_PACK;
const sys = (k: string) => (SYSTEM_ROLE_PROFILES.find((p) => p.key === k)?.bindings ?? []).map((b) => b.permissionKey);
const ownerKeys = (profilesForIndustryPack(PACK).find((p) => p.key === "owner")?.bindings ?? []).map((b) => b.permissionKey);
const tradeRepKeys = sys("trade_rep");

console.log("mengxin-positions（PERM-6b）");

// ── 行业包登记 ──
ok(PACK === "home_textile_trade_v1", "行业包 id = home_textile_trade_v1");
ok(hasPositionTemplates(PACK), "家纺外贸行业包有岗位模板 → 岗位模式");
ok(profilesForIndustryPack(PACK).map((p) => p.key).join() === "owner", "行业包岗位只有 owner");
ok(positionTemplatesForIndustryPack(PACK).map((t) => `${t.key}:${t.roleProfileKey}`).join() === "owner:owner", "岗位模板 owner → RoleProfile owner");
ok(SYSTEM_ROLE_PROFILES.some((p) => p.key === "trade_rep"), "外贸业务员复用系统模板 trade_rep");
ok(hasPositionTemplates(WINDOW_COVERING_INDUSTRY_PACK) && !hasPositionTemplates(null) && !hasPositionTemplates("other_pack"), "窗饰仍是岗位模式；无行业包 / 未知行业包仍是旧模式");

// ── owner 键 ──
ok(sys("org_owner").every((k) => ownerKeys.includes(k)), "家纺 owner ⊇ 系统 org_owner 全部键");
ok(["organization.read", "organization.dashboard.read", "trade.read", "trade.manage", "trade.settings.manage"].every((k) => ownerKeys.includes(k)), "家纺 owner：企业读、管理层信号、外贸三键");
ok(!ownerKeys.some((k) => k.startsWith("identity.") && k.endsWith(".manage")), "家纺 owner 不含成员 / 岗位管理键");
ok(!ownerKeys.some((k) => k.startsWith("orders.fulfillment.") || k === "sales.quote.pricing_close" || k === "project.finance.manage"), "家纺 owner 不含窗饰业务键");
ok(new Set(ownerKeys).size === ownerKeys.length, "家纺 owner 键无重复");
ok(!profilesForIndustryPack(PACK).some((p) => ["pricing_lead", "fulfillment_vinyl", "installer"].includes(p.key)), "家纺企业不落窗饰岗位");

// ── 绑定文件 ──
{
  const parsed = parseBindingFile(readFileSync(join(process.cwd(), "config/positions/mengxin.json"), "utf8"));
  ok(parsed.ok, "config/positions/mengxin.json 可解析");
  if (parsed.ok) {
    const b = parsed.value.bindings;
    ok(!Object.keys(b).some((k) => k.startsWith("TODO:")), "绑定文件无 TODO 占位");
    ok(b["cathy@hlmbedding.com"]?.join() === "trade_rep", "Cathy → trade_rep");
    ok(b["lucas@sunnyshutter.ca"]?.join() === "owner", "Lucas → owner");
    const known = new Set([...SYSTEM_ROLE_PROFILES.map((p) => p.key), ...profilesForIndustryPack(PACK).map((p) => p.key)]);
    ok(Object.values(b).flat().every((k) => known.has(k)), "绑定文件里的岗位都已登记");
  }
}

// ── 岗位模式下 Cathy / Lucas ──
for (const platformRole of ["trade", "user"]) {
  const tag = platformRole === "trade" ? "压扁前" : "压扁后";
  const role = deriveEffectivePlatformRole({ platformRole, positionMode: true, permissionKeys: tradeRepKeys });
  ok(role === "trade", `Cathy（${tag}）派生角色 trade`);
  ok(usesTradeLayout(role), `Cathy（${tag}）侧栏外贸布局`);
  const ctx = { platformRole, orgRole: "org_member", positionMode: true, permissionKeys: tradeRepKeys, enabledModules: ["trade"], hasMembership: true };
  ok(getDefaultWorkspace(ctx) === "/" && resolveHomeRedirect(ctx) === "/tasks", `Cathy（${tag}）首页落 /tasks（与旧模式相同）`);
  ok(!isManagementWorkspaceUser(ctx), `Cathy（${tag}）不是管理层`);
}
{
  const legacy = { platformRole: "trade", orgRole: "org_member", positionMode: false, permissionKeys: tradeRepKeys, enabledModules: ["trade"], hasMembership: true };
  ok(resolveHomeRedirect(legacy) === "/tasks", "对照：旧模式 Cathy 也落 /tasks");
  const lucas = { platformRole: "admin", orgRole: "org_owner", positionMode: true, permissionKeys: [...sys("org_owner"), ...ownerKeys], enabledModules: ["trade"], hasMembership: true };
  ok(isManagementWorkspaceUser(lucas) && resolveHomeRedirect(lucas) === null, "Lucas 绑 owner：管理层，首页停在 /");
  ok(deriveEffectivePlatformRole({ platformRole: "user", positionMode: true, permissionKeys: ownerKeys }) === "boss", "owner 压扁后派生 boss");
  const lucasNoOwner = { ...lucas, permissionKeys: sys("org_owner") };
  ok(!isManagementWorkspaceUser(lucasNoOwner), "Lucas 只有系统 org_owner 绑定（未绑 owner、非 super_admin）：不是管理层（上线顺序要绑 owner）");
}

// ── 收件人 ──
{
  const m = (userId: string, orgRole: string, platformRole: string, permissionKeys: string[]): TradeMemberSignal => ({ userId, orgRole, platformRole, userStatus: "active", permissionKeys });
  const lucas = m("lucas", "org_owner", "admin", [...sys("org_owner"), ...ownerKeys]);
  const cathy = m("cathy", "org_member", "trade", tradeRepKeys);
  ok(isTradeWorker(cathy) && isTradeWorker(lucas), "工作收件人：Cathy 与 Lucas");
  ok(isTradeManager(lucas, true) && !isTradeManager(cathy, true), "管理层收件人：Lucas，不含 Cathy");
  ok(pickDefaultInquiryOwner([lucas, cathy], true) === "cathy", "默认询盘负责人：Cathy（Lucas 先加入也不抢）");
}

// ── 入驻 / 交接 / 邀请注册后落岗位（D5） ──
{
  const onb = readFileSync(join(process.cwd(), "src/lib/organizations/onboarding.ts"), "utf8");
  ok(onb.includes("await ensureDefaultPositions({ orgId: result.orgId, actorUserId: input.actorUserId, ownerUserId });"), "入驻（provisionFactoryOrg）之后落岗位并给指定老板绑 owner");
  ok(onb.includes("if (patch.ownerUserId) await ensureDefaultPositions({ orgId, actorUserId, ownerUserId: patch.ownerUserId });"), "交接负责人之后落岗位");
  const reg = readFileSync(join(process.cwd(), "src/app/api/auth/register/route.ts"), "utf8");
  ok(reg.includes("await ensureDefaultPositions({ orgId: input.orgId, actorUserId: user.id });"), "企业邀请码注册之后自动绑岗位（不指定负责人）");
  const helper = readFileSync(join(process.cwd(), "src/lib/authorization/onboarding-positions.ts"), "utf8");
  ok(helper.includes("await seedOrgAuthorizationProfiles(input.orgId);") && helper.includes('via: "onboarding"'), "默认岗位 = seed + 指定负责人绑 owner（审计 via onboarding）");
  ok(!/role: "org_owner"/.test(helper), "不按 org_owner 成员角色批量绑 owner");
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
