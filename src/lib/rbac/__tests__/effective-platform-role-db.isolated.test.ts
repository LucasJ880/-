/**
 * PERM-4c4：岗位派生平台角色——真实 DB（隔离库）
 *
 *   窗饰企业：user + sales_rep → sales、boss + ops_staff → operations、user + owner → boss、trade 原样；
 *   旧模式企业：sales 原样；Muse 绑定身份带派生角色与 positionMode、org_owner 无老板岗位被拒；
 *   晨报扫描域、AI 上下文"销售只能挂自己客户"按派生角色（压扁后不放宽）。
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated \
 *   npx tsx src/lib/rbac/__tests__/effective-platform-role-db.isolated.test.ts
 * 无隔离库时自动跳过。只用虚构数据。
 */
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过 PERM-4c4 岗位派生平台角色 DB 测试（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "PERM-4c4 effective platform role DB test" });

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail).slice(0, 1200) : "");
  }
}

async function main() {
  const { db } = await import("@/lib/db");
  const { seedOrgAuthorizationProfiles } = await import("@/lib/authorization/seed-org-profiles");
  const { resolveEffectivePlatformRole } = await import("@/lib/rbac/effective-platform-role");
  const { resolveMuseBinding } = await import("@/lib/muse-bridge/binding");
  const { resolveSalesScope } = await import("@/lib/muse-bridge/sales-pure");
  const { resolveAgentScope } = await import("@/lib/agent-scope/resolve");
  const { generateDailyBriefing } = await import("@/lib/secretary/briefing");

  const stamp = Date.now().toString(36);
  const REP = `eprrep_${stamp}`;
  const BOSS_OPS = `eprbops_${stamp}`;
  const OWNER = `eprown_${stamp}`;
  const ORG_OWNER_OPS = `eproo_${stamp}`;
  const TRADE = `eprtr_${stamp}`;
  const LEGACY_SALES = `eprls_${stamp}`;
  const OTHER = `eproth_${stamp}`;
  const WC = `eprwc_${stamp}`;
  const LEGACY = `eprleg_${stamp}`;
  const role: Record<string, string> = {
    [REP]: "user",
    [BOSS_OPS]: "boss",
    [OWNER]: "user",
    [ORG_OWNER_OPS]: "user",
    [TRADE]: "trade",
    [LEGACY_SALES]: "sales",
    [OTHER]: "user",
  };
  const users = Object.keys(role);
  for (const id of users) await db.user.create({ data: { id, email: `${id}@fixture.test`, name: `Example ${id}`, role: role[id] } });
  const museBindings = {
    [`muse-owner-${stamp}`]: { userId: OWNER, boundAt: new Date().toISOString(), boundBy: OWNER },
    [`muse-rep-${stamp}`]: { userId: REP, boundAt: new Date().toISOString(), boundBy: OWNER },
    [`muse-oo-${stamp}`]: { userId: ORG_OWNER_OPS, boundAt: new Date().toISOString(), boundBy: OWNER },
  };
  await db.organization.create({
    data: {
      id: WC,
      name: "Example WC Fixture",
      code: `epr-wc-${stamp}`,
      ownerId: OWNER,
      industryPackId: "window_covering_services_v1",
      settingsJson: { museBridge: { bindings: museBindings } },
    },
  });
  await db.organization.create({
    data: {
      id: LEGACY,
      name: "Example Legacy Fixture",
      code: `epr-leg-${stamp}`,
      ownerId: LEGACY_SALES,
      settingsJson: { museBridge: { bindings: { [`muse-ls-${stamp}`]: { userId: LEGACY_SALES, boundAt: new Date().toISOString(), boundBy: LEGACY_SALES } } } },
    },
  });
  const addMember = (orgId: string, userId: string, orgRole = "org_member") =>
    db.organizationMember.create({ data: { orgId, userId, role: orgRole, status: "active" } });
  for (const id of [REP, BOSS_OPS, OWNER, TRADE, OTHER]) await addMember(WC, id);
  await addMember(WC, ORG_OWNER_OPS, "org_owner");
  await addMember(LEGACY, LEGACY_SALES);
  await seedOrgAuthorizationProfiles(WC);
  const bind = async (userId: string, key: string) => {
    const profile = await db.roleProfile.findUnique({ where: { orgId_key: { orgId: WC, key } } });
    await db.principalRoleBinding.create({ data: { orgId: WC, principalType: "HUMAN", principalId: userId, roleProfileId: profile!.id, status: "active" } });
  };
  await bind(REP, "sales_rep");
  await bind(BOSS_OPS, "ops_staff");
  await bind(OWNER, "owner");
  await bind(OWNER, "pricing_lead");
  await bind(ORG_OWNER_OPS, "ops_lead");
  const OWN_CUST = `eprcown_${stamp}`;
  const OTHER_CUST = `eprcoth_${stamp}`;
  await db.salesCustomer.create({ data: { id: OWN_CUST, orgId: WC, name: "Example Own Customer", createdById: REP } });
  await db.salesCustomer.create({ data: { id: OTHER_CUST, orgId: WC, name: "Example Other Customer", createdById: OTHER } });

  const eff = (userId: string, orgId: string) => resolveEffectivePlatformRole({ userId, orgId, platformRole: role[userId] });

  try {
    // ── 派生 ──
    ok((await eff(REP, WC)) === "sales", "窗饰：平台 user + sales_rep → sales");
    ok((await eff(BOSS_OPS, WC)) === "operations", "窗饰：平台 boss + ops_staff → operations");
    ok((await eff(OWNER, WC)) === "boss", "窗饰：owner + pricing_lead → boss");
    ok((await eff(ORG_OWNER_OPS, WC)) === "operations", "窗饰：org_owner + ops_lead → operations（企业角色不参与）");
    ok((await eff(TRADE, WC)) === "trade", "窗饰：trade 原样");
    ok((await eff(OTHER, WC)) === "user", "窗饰：无岗位 → user");
    ok((await eff(LEGACY_SALES, LEGACY)) === "sales", "旧模式企业：sales 原样");
    ok((await resolveEffectivePlatformRole({ userId: REP, orgId: null, platformRole: "user" })) === "user", "无企业上下文：原角色");

    // ── Muse 身份与范围 ──
    const mOwner = await resolveMuseBinding(WC, `muse-owner-${stamp}`);
    ok(mOwner.ok && mOwner.identity.role === "boss" && mOwner.identity.positionMode === true, "Muse：老板岗位身份 role=boss、positionMode", mOwner);
    ok(mOwner.ok && resolveSalesScope(mOwner.identity)?.kind === "org", "Muse：老板岗位 → 全组织");
    const mRep = await resolveMuseBinding(WC, `muse-rep-${stamp}`);
    ok(mRep.ok && resolveSalesScope(mRep.identity)?.kind === "own", "Muse：压扁后的销售 → 本人", mRep);
    const mOO = await resolveMuseBinding(WC, `muse-oo-${stamp}`);
    ok(mOO.ok && mOO.identity.orgRole === "org_owner" && resolveSalesScope(mOO.identity) === null, "Muse：org_owner 无老板岗位 → 拒绝", mOO);
    const mLegacy = await resolveMuseBinding(LEGACY, `muse-ls-${stamp}`);
    ok(mLegacy.ok && mLegacy.identity.role === "sales" && !mLegacy.identity.positionMode && resolveSalesScope(mLegacy.identity)?.kind === "own", "Muse：旧模式身份不变", mLegacy);

    // ── 晨报扫描域 ──
    const briefRep = await generateDailyBriefing(REP, WC);
    ok(briefRep.domains.some((d) => d.domain === "sales"), "晨报：压扁后的销售扫描销售域", briefRep.domains.map((d) => d.domain));
    const briefOps = await generateDailyBriefing(BOSS_OPS, WC);
    ok(!briefOps.domains.some((d) => d.domain === "sales"), "晨报：平台 boss + ops_staff 不扫销售域", briefOps.domains.map((d) => d.domain));

    // ── AI 上下文客户限制 ──
    const scopeOther = await resolveAgentScope({ user: { id: REP, role: "user" }, orgId: WC, channel: "web_chat", customerId: OTHER_CUST });
    ok(!scopeOther.ok && scopeOther.code === "customer_access_denied", "AI 上下文：压扁后的销售挂他人客户 → 拒绝", scopeOther);
    const scopeOwn = await resolveAgentScope({ user: { id: REP, role: "user" }, orgId: WC, channel: "web_chat", customerId: OWN_CUST });
    ok(scopeOwn.ok, "AI 上下文：挂自己的客户 → 允许", scopeOwn);
  } finally {
    await db.salesCustomer.deleteMany({ where: { id: { in: [OWN_CUST, OTHER_CUST] } } });
    // 晨报会写会话与通知
    await db.aiThread.deleteMany({ where: { OR: [{ orgId: { in: [WC, LEGACY] } }, { userId: { in: users } }] } });
    await db.notification.deleteMany({ where: { userId: { in: users } } });
    await db.auditLog.deleteMany({ where: { OR: [{ userId: { in: users } }, { orgId: { in: [WC, LEGACY] } }] } });
    await db.principalRoleBinding.deleteMany({ where: { orgId: { in: [WC, LEGACY] } } });
    await db.roleProfile.deleteMany({ where: { orgId: { in: [WC, LEGACY] } } }).catch(() => undefined);
    await db.positionTemplate.deleteMany({ where: { orgId: { in: [WC, LEGACY] } } }).catch(() => undefined);
    await db.organizationMember.deleteMany({ where: { orgId: { in: [WC, LEGACY] } } });
    await db.organization.deleteMany({ where: { id: { in: [WC, LEGACY] } } }).catch((e) => console.warn("org cleanup:", e instanceof Error ? e.message : e));
    await db.user.deleteMany({ where: { id: { in: users } } }).catch((e) => console.warn("user cleanup:", e instanceof Error ? e.message : e));
    await db.$disconnect();
  }

  console.log(`\nPERM-4c4 岗位派生平台角色 DB 端到端：${pass} 通过，${fail} 失败`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
