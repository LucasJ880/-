/**
 * PERM-4c5：残留平台角色读点收口——真实 DB（隔离库）+ 真实路由
 *
 *   窗饰企业（压扁后平台角色 user）：老板岗位看团队任务、运营主管看运营项目、平台 boss 只绑 sales_rep 被拒；
 *   压扁后销售 GET 增长中心 403、运营人员 200；/api/auth/me 的 role / effectiveRole；
 *   视觉方案：老板只看本企业（跨企业泄露已修）。
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated \
 *   npx tsx src/lib/authorization/__tests__/residual-reads-db.isolated.test.ts
 * 无隔离库时自动跳过。只用虚构数据。
 */
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过 PERM-4c5 残留读点 DB 测试（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "PERM-4c5 residual reads DB test" });

process.env.JWT_SECRET = process.env.JWT_SECRET || "perm-4c5-isolated-test-secret-0123456789abcdef";

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

type Handler = (req: unknown, ctx: unknown) => Promise<Response>;

async function main() {
  const { db } = await import("@/lib/db");
  const { NextRequest } = await import("next/server");
  const { createSession } = await import("@/lib/auth/session");
  const { seedOrgAuthorizationProfiles } = await import("@/lib/authorization/seed-org-profiles");
  const tasksRoute = await import("@/app/api/tasks/route");
  const opsProjectsRoute = await import("@/app/api/ops/projects/route");
  const marketingDashboardRoute = await import("@/app/api/marketing/dashboard/route");
  const meRoute = await import("@/app/api/auth/me/route");
  const visualizerSessionsRoute = await import("@/app/api/visualizer/sessions/route");

  const stamp = Date.now().toString(36);
  const OWNER = `rrown_${stamp}`;
  const OPS_LEAD = `rrol_${stamp}`;
  const OPS_STAFF = `rros_${stamp}`;
  const REP = `rrrep_${stamp}`;
  const BOSS_REP = `rrbr_${stamp}`;
  const OTHER_OWNER = `rroo_${stamp}`;
  const LEGACY_BOSS = `rrlb_${stamp}`;
  const LEGACY = `rrleg_${stamp}`;
  const WC = `rrwc_${stamp}`;
  const WC2 = `rrwc2_${stamp}`;
  const role: Record<string, string> = {
    [OWNER]: "user",
    [OPS_LEAD]: "user",
    [OPS_STAFF]: "user",
    [REP]: "user",
    [BOSS_REP]: "boss",
    [OTHER_OWNER]: "user",
    [LEGACY_BOSS]: "boss",
  };
  const users = Object.keys(role);
  for (const id of users) await db.user.create({ data: { id, email: `${id}@fixture.test`, name: `Example ${id}`, role: role[id] } });
  for (const [id, code, owner] of [[WC, `rr-wc-${stamp}`, OWNER], [WC2, `rr-wc2-${stamp}`, OTHER_OWNER]] as const) {
    await db.organization.create({ data: { id, name: `Example ${id}`, code, ownerId: owner, industryPackId: "window_covering_services_v1", modulesJson: { enabled: ["sales", "operations", "marketing", "window_covering"] } } });
  }
  for (const id of [OWNER, OPS_LEAD, OPS_STAFF, REP, BOSS_REP]) {
    await db.organizationMember.create({ data: { orgId: WC, userId: id, role: "org_member", status: "active" } });
    await db.user.update({ where: { id }, data: { activeOrgId: WC } });
  }
  await db.organizationMember.create({ data: { orgId: WC2, userId: OTHER_OWNER, role: "org_member", status: "active" } });
  // 旧模式企业（无行业包）的平台 boss：修复前 dataScope=all 不按企业过滤，能看到所有企业的方案
  await db.organization.create({ data: { id: LEGACY, name: "Example Legacy", code: `rr-leg-${stamp}`, ownerId: LEGACY_BOSS } });
  await db.organizationMember.create({ data: { orgId: LEGACY, userId: LEGACY_BOSS, role: "org_owner", status: "active" } });
  await seedOrgAuthorizationProfiles(WC);
  await seedOrgAuthorizationProfiles(WC2);
  const bind = async (orgId: string, userId: string, key: string) => {
    const profile = await db.roleProfile.findUnique({ where: { orgId_key: { orgId, key } } });
    await db.principalRoleBinding.create({ data: { orgId, principalType: "HUMAN", principalId: userId, roleProfileId: profile!.id, status: "active" } });
  };
  await bind(WC, OWNER, "owner");
  await bind(WC, OPS_LEAD, "ops_lead");
  await bind(WC, OPS_STAFF, "ops_staff");
  await bind(WC, REP, "sales_rep");
  await bind(WC, BOSS_REP, "sales_rep");
  await bind(WC2, OTHER_OWNER, "owner");

  // 视觉方案：两家企业各一个他人创建的方案
  const CUST_A = `rrca_${stamp}`;
  const CUST_B = `rrcb_${stamp}`;
  await db.salesCustomer.create({ data: { id: CUST_A, orgId: WC, name: "Example A", createdById: REP } });
  await db.salesCustomer.create({ data: { id: CUST_B, orgId: WC2, name: "Example B", createdById: OTHER_OWNER } });
  const SESS_A = `rrsa_${stamp}`;
  const SESS_B = `rrsb_${stamp}`;
  await db.visualizerSession.create({ data: { id: SESS_A, customerId: CUST_A, createdById: REP } });
  await db.visualizerSession.create({ data: { id: SESS_B, customerId: CUST_B, createdById: OTHER_OWNER } });

  const req = async (uid: string, url: string) =>
    new NextRequest(`http://localhost${url}`, {
      headers: { cookie: `qy_session=${await createSession({ sub: uid, email: `${uid}@fixture.test`, role: role[uid] })}`, "x-forwarded-for": "10.45.0.8" },
    });
  const call = async (handler: unknown, uid: string, url: string) =>
    (handler as Handler)(await req(uid, url), { params: Promise.resolve({}) });

  try {
    // ── B1 团队任务 ──
    ok((await call(tasksRoute.GET, OWNER, "/api/tasks?view=team")).status === 200, "压扁后 owner：团队任务 200");
    ok((await call(tasksRoute.GET, BOSS_REP, "/api/tasks?view=team")).status === 403, "平台 boss + sales_rep：团队任务 403");
    ok((await call(tasksRoute.GET, OPS_LEAD, "/api/tasks?view=team")).status === 200, "压扁后 ops_lead：团队任务 200（键）");

    // ── B2 运营项目 ──
    const opsLead = await call(opsProjectsRoute.GET, OPS_LEAD, "/api/ops/projects");
    ok(opsLead.status === 200, "压扁后 ops_lead：运营项目列表 200", opsLead.status);
    const opsRep = await call(opsProjectsRoute.GET, REP, "/api/ops/projects");
    ok(opsRep.status === 403, "sales_rep：运营项目列表 403", opsRep.status);

    // ── A6 营销只读 ──
    const mRep = await call(marketingDashboardRoute.GET, REP, `/api/marketing/dashboard?orgId=${WC}`);
    ok(mRep.status === 403, "压扁后 sales_rep：GET /api/marketing/dashboard 403", mRep.status);
    const mOps = await call(marketingDashboardRoute.GET, OPS_STAFF, `/api/marketing/dashboard?orgId=${WC}`);
    ok(mOps.status === 200, "ops_staff：GET /api/marketing/dashboard 200", mOps.status);

    // ── C1 /api/auth/me ──
    const meRep = (await (await call(meRoute.GET, REP, "/api/auth/me")).json()) as { user: { role: string; effectiveRole: string } };
    ok(meRep.user.role === "user" && meRep.user.effectiveRole === "sales", "me：sales_rep 的 role=user、effectiveRole=sales", meRep.user);
    const meOwner = (await (await call(meRoute.GET, OWNER, "/api/auth/me")).json()) as { user: { effectiveRole: string } };
    ok(meOwner.user.effectiveRole === "boss", "me：owner 的 effectiveRole=boss", meOwner.user);

    // ── B5 视觉方案（跨企业泄露） ──
    const vs = (await (await call(visualizerSessionsRoute.GET, OWNER, "/api/visualizer/sessions")).json()) as { sessions: Array<{ id: string }> };
    const ids = (vs.sessions ?? []).map((x) => x.id);
    ok(ids.includes(SESS_A), "压扁后 owner：看到本企业他人创建的方案", ids);
    ok(!ids.includes(SESS_B), "压扁后 owner：看不到其他企业的方案（泄露已修）", ids);
    const vsRep = (await (await call(visualizerSessionsRoute.GET, OPS_STAFF, "/api/visualizer/sessions")).json()) as { sessions: Array<{ id: string }> };
    ok(!(vsRep.sessions ?? []).some((x) => x.id === SESS_A), "ops_staff：看不到他人的方案（本人范围）");
    const vsLegacy = (await (await call(visualizerSessionsRoute.GET, LEGACY_BOSS, "/api/visualizer/sessions")).json()) as { sessions: Array<{ id: string }> };
    const legacyIds = (vsLegacy.sessions ?? []).map((x) => x.id);
    ok(!legacyIds.includes(SESS_A) && !legacyIds.includes(SESS_B), "旧模式企业的平台 boss：看不到其他企业的方案（修复前可见）", legacyIds);
  } finally {
    await db.visualizerSession.deleteMany({ where: { id: { in: [SESS_A, SESS_B] } } });
    await db.salesCustomer.deleteMany({ where: { id: { in: [CUST_A, CUST_B] } } });
    await db.notification.deleteMany({ where: { userId: { in: users } } });
    await db.auditLog.deleteMany({ where: { OR: [{ userId: { in: users } }, { orgId: { in: [WC, WC2, LEGACY] } }] } });
    await db.principalRoleBinding.deleteMany({ where: { orgId: { in: [WC, WC2, LEGACY] } } });
    await db.roleProfile.deleteMany({ where: { orgId: { in: [WC, WC2, LEGACY] } } }).catch(() => undefined);
    await db.positionTemplate.deleteMany({ where: { orgId: { in: [WC, WC2, LEGACY] } } }).catch(() => undefined);
    await db.user.updateMany({ where: { id: { in: users } }, data: { activeOrgId: null } });
    await db.organizationMember.deleteMany({ where: { orgId: { in: [WC, WC2, LEGACY] } } });
    await db.organization.deleteMany({ where: { id: { in: [WC, WC2, LEGACY] } } }).catch((e) => console.warn("org cleanup:", e instanceof Error ? e.message : e));
    await db.user.deleteMany({ where: { id: { in: users } } }).catch((e) => console.warn("user cleanup:", e instanceof Error ? e.message : e));
    await db.$disconnect();
  }

  console.log(`\nPERM-4c5 残留读点 DB 端到端：${pass} 通过，${fail} 失败`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
