/**
 * PERM-7b：平台 admin 退役——真实 DB（隔离库）+ 真实路由
 *
 *   平台 admin（只在企业 A 绑 owner）：企业列表只有 A、企业 B 详情 / 项目 403、入驻控制台 / 能力运行记录 / 新建企业 /
 *   邀请码 / 智能体追踪 403、在 A 是管理层（派生 boss）；super_admin 对照全部照旧；
 *   不签发 admin（邀请码 400、历史 admin 邀请码注册得到 user）；压扁 dry-run：有绑定的 admin 进计划，无绑定的阻断。
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated \
 *   npx tsx src/lib/rbac/__tests__/platform-admin-scope-db.isolated.test.ts
 * 无隔离库时自动跳过。只用虚构数据。
 */
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过 PERM-7b 平台 admin 退役 DB 测试（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "PERM-7b platform admin scope DB test" });

process.env.JWT_SECRET = process.env.JWT_SECRET || "perm-7b-isolated-test-secret-0123456789abcdef";

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
  const { runPlatformRoleCollapse } = await import("@/lib/authorization/platform-role-collapse-run");
  const orgsRoute = await import("@/app/api/organizations/route");
  const orgRoute = await import("@/app/api/organizations/[orgId]/route");
  const orgProjectsRoute = await import("@/app/api/organizations/[orgId]/projects/route");
  const onboardingRoute = await import("@/app/api/admin/onboarding/route");
  const runsRoute = await import("@/app/api/capabilities/runs/route");
  const inviteRoute = await import("@/app/api/admin/invite-codes/route");
  const traceRoute = await import("@/app/api/agent/trace/route");
  const registerRoute = await import("@/app/api/auth/register/route");
  const meRoute = await import("@/app/api/auth/me/route");
  const positionsRoute = await import("@/app/api/organizations/[orgId]/positions/route");

  const stamp = Date.now().toString(36);
  const ADM = `pa_${stamp}`;
  const NOBIND = `pan_${stamp}`;
  const SA = `pas_${stamp}`;
  const ORG_A = `paorga_${stamp}`;
  const ORG_B = `paorgb_${stamp}`;
  const CODE_A = `pa-a-${stamp}`;
  const CODE_B = `pa-b-${stamp}`;
  const INVITE_OK = `PAOK${stamp}`.toUpperCase();
  const INVITE_ADMIN = `PAADM${stamp}`.toUpperCase();
  const REG_EMAIL = `pareg_${stamp}@fixture.test`;
  const role: Record<string, string> = { [ADM]: "admin", [NOBIND]: "admin", [SA]: "super_admin" };
  const users = Object.keys(role);
  const email = (id: string) => `${id}@fixture.test`;
  for (const id of users) await db.user.create({ data: { id, email: email(id), name: `Example ${id}`, role: role[id] } });
  for (const [id, code] of [[ORG_A, CODE_A], [ORG_B, CODE_B]] as const) {
    await db.organization.create({
      data: { id, name: `Example ${code}`, code, ownerId: SA, industryPackId: "window_covering_services_v1", modulesJson: { enabled: ["sales", "projects"] } },
    });
  }
  await db.organizationMember.create({ data: { orgId: ORG_A, userId: ADM, role: "org_member", status: "active" } });
  await db.user.update({ where: { id: ADM }, data: { activeOrgId: ORG_A } });
  await seedOrgAuthorizationProfiles(ORG_A);
  await seedOrgAuthorizationProfiles(ORG_B);

  const req = async (uid: string, method: string, url: string, body?: unknown) =>
    new NextRequest(`http://localhost${url}`, {
      method,
      headers: {
        ...(uid ? { cookie: `qy_session=${await createSession({ sub: uid, email: email(uid), role: role[uid] })}` } : {}),
        "x-forwarded-for": "10.71.0.8",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const call = async (handler: unknown, uid: string, method: string, url: string, body?: unknown, params: Record<string, string> = {}) =>
    (handler as Handler)(await req(uid, method, url, body), { params: Promise.resolve(params) });
  const json = async (r: Response) => (await r.json().catch(() => ({}))) as Record<string, unknown>;
  let regUserId: string | null = null;

  try {
    // ── super_admin 在界面接口给 ADM 绑 owner ──
    const bind = await call(positionsRoute.PUT, SA, "PUT", `/api/organizations/${ORG_A}/positions`, { principalType: "HUMAN", principalId: ADM, keys: ["owner"] }, { orgId: ORG_A });
    ok(bind.status === 200, "super_admin 给平台 admin 绑 owner", await json(bind));

    // ── 跨企业访问 ──
    const listAdm = (await json(await call(orgsRoute.GET, ADM, "GET", "/api/organizations"))) as { organizations?: { id: string }[] };
    const admOrgIds = (listAdm.organizations ?? []).map((o) => o.id);
    ok(admOrgIds.includes(ORG_A) && !admOrgIds.includes(ORG_B), "平台 admin 企业列表只有自己的企业", admOrgIds);
    const listSa = (await json(await call(orgsRoute.GET, SA, "GET", "/api/organizations"))) as { organizations?: { id: string }[] };
    ok([ORG_A, ORG_B].every((id) => (listSa.organizations ?? []).some((o) => o.id === id)), "super_admin 企业列表含全部企业");
    ok((await call(orgRoute.GET, ADM, "GET", `/api/organizations/${ORG_B}`, undefined, { orgId: ORG_B })).status === 403, "平台 admin：非成员企业详情 403");
    ok((await call(orgRoute.GET, ADM, "GET", `/api/organizations/${ORG_A}`, undefined, { orgId: ORG_A })).status === 200, "平台 admin：本企业详情 200");
    ok((await call(orgProjectsRoute.GET, ADM, "GET", `/api/organizations/${ORG_B}/projects`, undefined, { orgId: ORG_B })).status === 403, "平台 admin：非成员企业项目列表 403");
    ok((await call(orgRoute.GET, SA, "GET", `/api/organizations/${ORG_B}`, undefined, { orgId: ORG_B })).status === 200, "super_admin：任一企业详情 200");
    ok((await call(orgProjectsRoute.GET, SA, "GET", `/api/organizations/${ORG_B}/projects`, undefined, { orgId: ORG_B })).status === 200, "super_admin：任一企业项目列表 200");

    // ── 平台控制台入口 ──
    const onbAdm = await call(onboardingRoute.GET, ADM, "GET", "/api/admin/onboarding");
    ok(onbAdm.status === 403 && (await json(onbAdm)).code === "PLATFORM_ADMIN_REQUIRED", "平台 admin：入驻控制台 403 PLATFORM_ADMIN_REQUIRED");
    ok((await call(onboardingRoute.GET, SA, "GET", "/api/admin/onboarding")).status === 200, "super_admin：入驻控制台 200");
    ok((await call(runsRoute.GET, ADM, "GET", "/api/capabilities/runs")).status === 403, "平台 admin：能力运行记录 403");
    ok((await call(runsRoute.GET, SA, "GET", "/api/capabilities/runs")).status !== 403, "super_admin：能力运行记录不被平台门禁拦");
    const create = await call(orgsRoute.POST, ADM, "POST", "/api/organizations", { name: "Example Should Not Exist", code: `pa-x-${stamp}` });
    ok(create.status === 403, "平台 admin：新建企业 403", create.status);
    ok(!(await db.organization.findFirst({ where: { code: `pa-x-${stamp}` } })), "平台 admin 新建企业未落库");
    ok((await call(traceRoute.GET, ADM, "GET", `/api/agent/trace?orgId=${ORG_A}`)).status === 403, "平台 admin：智能体追踪 403");

    // ── 本企业按岗位 ──
    const me = (await json(await call(meRoute.GET, ADM, "GET", "/api/auth/me"))) as { user?: { effectiveRole?: string } };
    ok(me.user?.effectiveRole === "boss", "平台 admin 绑 owner：派生角色 boss（管理层）", me.user);

    // ── 不签发 admin ──
    ok((await call(inviteRoute.POST, ADM, "POST", "/api/admin/invite-codes", { code: `PAX${stamp}`, role: "user" })).status === 403, "平台 admin：创建邀请码 403");
    const badInvite = await call(inviteRoute.POST, SA, "POST", "/api/admin/invite-codes", { code: `PABAD${stamp}`, role: "admin" });
    ok(badInvite.status === 400, "super_admin 创建 admin 邀请码 400", badInvite.status);
    const goodInvite = await call(inviteRoute.POST, SA, "POST", "/api/admin/invite-codes", { code: INVITE_OK, role: "user" });
    ok(goodInvite.status === 200 || goodInvite.status === 201, "super_admin 创建 user 邀请码成功", goodInvite.status);
    await db.inviteCode.create({ data: { code: INVITE_ADMIN, role: "admin", createdById: SA } });
    const reg = await call(registerRoute.POST, "", "POST", "/api/auth/register", { email: REG_EMAIL, password: "example-password", inviteCode: INVITE_ADMIN });
    const regUser = await db.user.findUnique({ where: { email: REG_EMAIL }, select: { id: true, role: true } });
    regUserId = regUser?.id ?? null;
    ok(reg.status < 300 && regUser?.role === "user", "历史 admin 邀请码注册：平台角色为 user", { status: reg.status, role: regUser?.role });

    // ── 压扁 dry-run ──
    const plan = await runPlatformRoleCollapse({ orgCode: CODE_A, actorEmail: email(SA), dryRun: true, restore: false, ready: true });
    ok(plan.exitCode === 0 && plan.lines.some((l) => l === `压扁 ${email(ADM)}：admin → user`), "压扁计划：有绑定的平台 admin → user，无阻断", plan.lines);
    await db.organizationMember.create({ data: { orgId: ORG_A, userId: NOBIND, role: "org_member", status: "active" } });
    const blocked = await runPlatformRoleCollapse({ orgCode: CODE_A, actorEmail: email(SA), dryRun: true, restore: false, ready: true });
    ok(blocked.exitCode === 2 && blocked.lines.some((l) => l.includes(email(NOBIND)) && l.includes("无 active 岗位绑定")), "压扁计划：无绑定的平台 admin 阻断", blocked.lines);
    ok((await db.user.findUnique({ where: { id: ADM }, select: { role: true } }))?.role === "admin", "dry-run 不写库");
  } finally {
    if (regUserId) {
      const personal = await db.organization.findMany({ where: { ownerId: regUserId }, select: { id: true } });
      const personalIds = personal.map((o) => o.id);
      const projects = await db.project.findMany({ where: { orgId: { in: personalIds } }, select: { id: true } });
      const projectIds = projects.map((p) => p.id);
      await db.environment.deleteMany({ where: { projectId: { in: projectIds } } }).catch(() => undefined);
      await db.projectMember.deleteMany({ where: { projectId: { in: projectIds } } }).catch(() => undefined);
      await db.project.deleteMany({ where: { id: { in: projectIds } } }).catch(() => undefined);
      await db.organizationMember.deleteMany({ where: { orgId: { in: personalIds } } }).catch(() => undefined);
      await db.auditLog.deleteMany({ where: { OR: [{ userId: regUserId }, { orgId: { in: personalIds } }] } }).catch(() => undefined);
      await db.organization.deleteMany({ where: { id: { in: personalIds } } }).catch(() => undefined);
      await db.user.deleteMany({ where: { id: regUserId } }).catch(() => undefined);
    }
    await db.inviteCode.deleteMany({ where: { code: { in: [INVITE_OK, INVITE_ADMIN, `PABAD${stamp}`, `PAX${stamp}`] } } }).catch(() => undefined);
    await db.auditLog.deleteMany({ where: { OR: [{ userId: { in: users } }, { orgId: { in: [ORG_A, ORG_B] } }] } });
    await db.principalRoleBinding.deleteMany({ where: { orgId: { in: [ORG_A, ORG_B] } } });
    await db.roleProfile.deleteMany({ where: { orgId: { in: [ORG_A, ORG_B] } } }).catch(() => undefined);
    await db.positionTemplate.deleteMany({ where: { orgId: { in: [ORG_A, ORG_B] } } }).catch(() => undefined);
    await db.user.updateMany({ where: { id: { in: users } }, data: { activeOrgId: null } });
    await db.organizationMember.deleteMany({ where: { orgId: { in: [ORG_A, ORG_B] } } });
    await db.organization.deleteMany({ where: { id: { in: [ORG_A, ORG_B] } } }).catch((e) => console.warn("org cleanup:", e instanceof Error ? e.message : e));
    await db.user.deleteMany({ where: { id: { in: users } } }).catch((e) => console.warn("user cleanup:", e instanceof Error ? e.message : e));
    await db.$disconnect();
  }

  console.log(`\nPERM-7b 平台 admin 退役 DB 端到端：${pass} 通过，${fail} 失败`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
