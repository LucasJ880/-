/**
 * USR-1 邀请码直接绑定企业 + 用户管理按企业隔离 — 真实 DB 端到端（隔离库，虚构企业）
 *
 *   平台邀请码页建码（POST，带企业：只给 sales / trade、企业须启用；公司 logo 跟随企业）→ 列表带企业名 → 已有码补绑 / 解绑（PATCH）
 *   → 真实注册：直接加入企业、当前企业 = 该企业、自动绑 sales_rep、不建个人工作区；上限 2 的码第三人被拒；不限次数的码可多人用
 *   → GET /api/users：企业范围只列该企业 active 成员（带企业内角色）、全平台需显式 scope=platform、
 *     无企业范围 400 ORG_SCOPE_REQUIRED、不存在的企业 404、非平台管理员 403
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated \
 *   npx tsx src/lib/organizations/__tests__/org-scoped-users-db.isolated.test.ts
 * 无隔离库时自动跳过。只用虚构企业名。
 */
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过 USR-1 邀请码绑定企业 / 用户管理隔离 DB 测试（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "USR-1 org-scoped users DB test" });
process.env.JWT_SECRET = process.env.JWT_SECRET || "usr1-isolated-test-secret-0123456789abcdef";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail).slice(0, 900) : "");
  }
}

const stamp = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const ADMIN = `fx_usr1_admin_${stamp}`;
const PADMIN = `fx_usr1_padmin_${stamp}`;
const BOSS = `fx_usr1_boss_${stamp}`;
const LONER = `fx_usr1_loner_${stamp}`;
const B_MEMBER = `fx_usr1_bmember_${stamp}`;
const A_OLD = `fx_usr1_aold_${stamp}`;
const A_LEFT = `fx_usr1_aleft_${stamp}`;
const ORG_A = `fx_usr1_orga_${stamp}`;
const ORG_B = `fx_usr1_orgb_${stamp}`;
const ORG_OFF = `fx_usr1_orgoff_${stamp}`;
const COMPANY_A = `fx_usr1_coa_${stamp}`;
const COMPANY_X = `fx_usr1_cox_${stamp}`;

async function main() {
  const { db } = await import("@/lib/db");
  const { NextRequest } = await import("next/server");
  const { createSession } = await import("@/lib/auth/session");
  const inviteRoute = await import("@/app/api/admin/invite-codes/route");
  const inviteIdRoute = await import("@/app/api/admin/invite-codes/[id]/route");
  const registerRoute = await import("@/app/api/auth/register/route");
  const usersRoute = await import("@/app/api/users/route");

  const createdUserIds = [ADMIN, PADMIN, BOSS, LONER, B_MEMBER, A_OLD, A_LEFT];
  const orgIds = [ORG_A, ORG_B, ORG_OFF];
  const roleOf: Record<string, string> = { [ADMIN]: "super_admin", [PADMIN]: "admin", [BOSS]: "boss" };
  for (const [id, role, name] of [
    [ADMIN, "super_admin", "Fixture Platform Admin"],
    [PADMIN, "admin", "Fixture Legacy Admin"],
    [BOSS, "boss", "Fixture Boss"],
    [LONER, "user", "Fixture Loner"],
    [B_MEMBER, "sales", "Fixture Other Tenant Rep"],
    [A_OLD, "sales", "Fixture Existing Rep"],
    [A_LEFT, "sales", "Fixture Former Rep"],
  ] as const) {
    await db.user.create({ data: { id, email: `${id}@fixture.test`, name, role } });
  }
  await db.company.create({ data: { id: COMPANY_A, name: "Fixture Blinds", slug: `fx-usr1-coa-${stamp}`, logoUrl: "/icons/icon-192x192.png" } });
  await db.company.create({ data: { id: COMPANY_X, name: "Fixture Other Brand", slug: `fx-usr1-cox-${stamp}`, logoUrl: "/icons/icon-192x192.png" } });
  await db.organization.create({ data: { id: ORG_A, name: `Fixture Blinds ${stamp}`, code: `fx-usr1-a-${stamp}`, ownerId: ADMIN, industryPackId: "window_covering_services_v1", companyId: COMPANY_A } });
  await db.organization.create({ data: { id: ORG_B, name: `Fixture Textiles ${stamp}`, code: `fx-usr1-b-${stamp}`, ownerId: ADMIN } });
  await db.organization.create({ data: { id: ORG_OFF, name: `Fixture Archived ${stamp}`, code: `fx-usr1-off-${stamp}`, ownerId: ADMIN, status: "archived" } });
  await db.organizationMember.createMany({
    data: [
      { orgId: ORG_A, userId: A_OLD, role: "org_admin", status: "active" },
      { orgId: ORG_A, userId: A_LEFT, role: "org_member", status: "inactive" },
      { orgId: ORG_B, userId: B_MEMBER, role: "org_member", status: "active" },
    ],
  });

  let ipSeq = 1;
  const cookieOf = async (uid: string) => `qy_session=${await createSession({ sub: uid, email: `${uid}@fixture.test`, role: roleOf[uid] ?? "user" })}`;
  const req = async (url: string, init: { method?: string; body?: unknown; as?: string } = {}) =>
    new NextRequest(`http://localhost${url}`, {
      method: init.method ?? "GET",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": `10.41.${Math.floor(ipSeq / 200)}.${ipSeq++ % 200}`,
        ...(init.as ? { cookie: await cookieOf(init.as) } : {}),
      },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });
  const json = async (res: Response) => (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const createInvite = async (body: Record<string, unknown>, as = ADMIN) => {
    const res = await inviteRoute.POST(await req("/api/admin/invite-codes", { method: "POST", body, as }));
    return { status: res.status, body: await json(res) };
  };
  const patchInvite = async (id: string, body: Record<string, unknown>) => {
    const res = await inviteIdRoute.PATCH(await req(`/api/admin/invite-codes/${id}`, { method: "PATCH", body, as: ADMIN }), { params: Promise.resolve({ id }) });
    return { status: res.status, body: await json(res) };
  };
  const register = async (email: string, inviteCode: string) => {
    const res = await registerRoute.POST(await req("/api/auth/register", { method: "POST", body: { email, password: "secret123", name: "Fixture New Rep", inviteCode } }));
    const user = await db.user.findUnique({ where: { email } });
    if (user) createdUserIds.push(user.id);
    return { status: res.status, body: await json(res), user };
  };
  const listUsers = async (qs: string, as = ADMIN) => {
    const res = await usersRoute.GET(await req(`/api/users?${qs}`, { as }));
    return { status: res.status, body: await json(res) };
  };
  const code = (tag: string) => `FXU1${tag}${stamp}`.toUpperCase();

  try {
    console.log("\n[1] 建码：带企业只给 sales / trade，企业须启用");
    const salesA = await createInvite({ code: code("SALESA"), role: "sales", label: "Fixture sales team", maxUses: 2, orgId: ORG_A, companyIds: [COMPANY_X] });
    const salesRow = salesA.status === 201 ? await db.inviteCode.findUnique({ where: { code: code("SALESA") } }) : null;
    ok(salesA.status === 201 && salesRow?.orgId === ORG_A && salesRow.orgRole === "org_member", "sales + 企业 A（不填企业内角色）→ 201，orgRole = org_member", { status: salesA.status, row: salesRow });
    ok(salesRow?.companyIdsJson === JSON.stringify([COMPANY_A]), "公司 logo 跟随企业：写入企业 A 关联的公司，忽略传入的其他公司", salesRow?.companyIdsJson);
    const salesB = await createInvite({ code: code("SALESB"), role: "trade", orgId: ORG_B, companyIds: [COMPANY_X] });
    const salesBRow = await db.inviteCode.findUnique({ where: { code: code("SALESB") } });
    ok(salesB.status === 201 && salesBRow?.orgId === ORG_B && salesBRow.companyIdsJson === null, "企业 B 没有关联公司 → 码上不带公司 logo", salesBRow);
    for (const [tag, body, why] of [
      ["OPS", { role: "operations", orgId: ORG_A }, "运营角色绑定企业"],
      ["OFF", { role: "sales", orgId: ORG_OFF }, "已归档企业"],
      ["NONE", { role: "sales", orgId: `missing_${stamp}` }, "不存在的企业"],
      ["OWNER", { role: "sales", orgId: ORG_A, orgRole: "org_owner" }, "企业内角色 org_owner"],
    ] as const) {
      const r = await createInvite({ code: code(tag), ...body });
      const row = await db.inviteCode.findUnique({ where: { code: code(tag) } });
      ok(r.status === 400 && !row, `${why} → 400，不建码`, { status: r.status, body: r.body });
    }
    const plain = await createInvite({ code: code("PLAIN"), role: "user" });
    const plainRow = await db.inviteCode.findUnique({ where: { code: code("PLAIN") } });
    ok(plain.status === 201 && plainRow?.orgId === null && plainRow.orgRole === null && plainRow.companyIdsJson === null, "不填企业的普通用户码 → 201，orgId / orgRole 为空（原行为）", plainRow);
    const compat = await createInvite({ code: code("COMPAT"), role: "user", companyIds: [COMPANY_X] });
    const compatRow = await db.inviteCode.findUnique({ where: { code: code("COMPAT") } });
    ok(compat.status === 201 && compatRow?.companyIdsJson === JSON.stringify([COMPANY_X]), "不绑企业时仍接受旧参数 companyIds（接口兼容）", compatRow?.companyIdsJson);
    const denied = await createInvite({ code: code("PADMIN"), role: "sales", orgId: ORG_A }, PADMIN);
    ok(denied.status === 403, "平台 admin（非 super_admin）建码 → 403", denied.status);

    console.log("\n[2] 列表带企业");
    const list = await inviteRoute.GET(await req("/api/admin/invite-codes", { as: ADMIN }));
    const codes = ((await json(list)).codes ?? []) as Array<{ code: string; org: { id: string; name: string | null; status: string } | null }>;
    const listedSales = codes.find((c) => c.code === code("SALESA"));
    const listedPlain = codes.find((c) => c.code === code("PLAIN"));
    ok(listedSales?.org?.id === ORG_A && listedSales.org.name === `Fixture Blinds ${stamp}` && listedPlain?.org === null, "绑定企业的码带企业名，未绑定为 null", { listedSales, listedPlain });

    console.log("\n[3] 已有码补绑 / 解绑");
    const legacy = await db.inviteCode.create({ data: { code: code("LEGACY"), role: "sales", createdById: ADMIN, companyIdsJson: null } });
    const bind = await patchInvite(legacy.id, { orgId: ORG_A });
    const legacyAfter = await db.inviteCode.findUnique({ where: { id: legacy.id } });
    ok(bind.status === 200 && legacyAfter?.orgId === ORG_A && legacyAfter.orgRole === "org_member", "给已有、未绑定的销售码补绑企业 A → 200", { status: bind.status, row: legacyAfter });
    ok(legacyAfter?.companyIdsJson === JSON.stringify([COMPANY_A]), "补绑后公司 logo 跟随企业 A", legacyAfter?.companyIdsJson);
    const badBind = await patchInvite(plainRow!.id, { orgId: ORG_A });
    const plainAfter = await db.inviteCode.findUnique({ where: { id: plainRow!.id } });
    ok(badBind.status === 400 && plainAfter?.orgId === null, "给普通用户码补绑企业 → 400，码不变", { status: badBind.status, row: plainAfter });
    const offBind = await patchInvite(legacy.id, { orgId: ORG_OFF });
    ok(offBind.status === 400 && (await db.inviteCode.findUnique({ where: { id: legacy.id } }))?.orgId === ORG_A, "改绑到已归档企业 → 400，仍是企业 A", offBind.status);
    const unbindCode = await db.inviteCode.create({ data: { code: code("UNBIND"), role: "trade", createdById: ADMIN, orgId: ORG_A, orgRole: "org_admin" } });
    const unbind = await patchInvite(unbindCode.id, { orgId: null });
    const unbound = await db.inviteCode.findUnique({ where: { id: unbindCode.id } });
    ok(unbind.status === 200 && unbound?.orgId === null && unbound.orgRole === null, "解绑：orgId 与 orgRole 一并清空", unbound);

    console.log("\n[4] 真实注册：直接加入企业");
    const r1 = await register(`fx_usr1_rep1_${stamp}@fixture.test`, code("SALESA").toLowerCase());
    const m1 = r1.user ? await db.organizationMember.findMany({ where: { userId: r1.user.id } }) : [];
    ok(r1.status === 200 && r1.body.organization && (r1.body.organization as { id: string }).id === ORG_A, "销售用企业 A 的码注册 → 200，返回企业 A", { status: r1.status, body: r1.body });
    ok(r1.user?.role === "sales" && r1.user.activeOrgId === ORG_A, "平台角色 sales，当前企业 = 企业 A", { role: r1.user?.role, active: r1.user?.activeOrgId });
    ok(r1.user?.companyIdsJson === JSON.stringify([COMPANY_A]), "账号的公司 logo = 企业 A 关联的公司（不是页面手选的）", r1.user?.companyIdsJson);
    ok(m1.length === 1 && m1[0].orgId === ORG_A && m1[0].role === "org_member" && m1[0].status === "active", "只是企业 A 的 org_member，没有其他企业", m1);
    ok(!r1.user || !(await db.organization.findFirst({ where: { code: `personal-${r1.user.id.slice(0, 8)}` } })), "没有建个人工作区");
    const binding = r1.user
      ? await db.principalRoleBinding.findFirst({ where: { orgId: ORG_A, principalId: r1.user.id, status: "active" }, include: { roleProfile: { select: { key: true } } } })
      : null;
    ok(binding?.roleProfile.key === "sales_rep", "岗位模式企业：自动绑定 sales_rep", binding?.roleProfile);

    const r2 = await register(`fx_usr1_rep2_${stamp}@fixture.test`, code("SALESA"));
    const r3 = await register(`fx_usr1_rep3_${stamp}@fixture.test`, code("SALESA"));
    const usedAfter = await db.inviteCode.findUnique({ where: { code: code("SALESA") } });
    ok(r2.status === 200 && r2.user?.activeOrgId === ORG_A, "上限 2 的码：第二人加入企业 A", r2.status);
    ok(r3.status === 400 && !r3.user && usedAfter?.usedCount === 2, "第三人 → 400，不建用户，已用 2 次", { status: r3.status, used: usedAfter?.usedCount });

    const r4 = await register(`fx_usr1_rep4_${stamp}@fixture.test`, code("LEGACY"));
    const r5 = await register(`fx_usr1_rep5_${stamp}@fixture.test`, code("LEGACY"));
    ok(
      r4.status === 200 && r5.status === 200 && r4.user?.activeOrgId === ORG_A && r5.user?.activeOrgId === ORG_A,
      "补绑后的不限次数码：两人先后注册都直接加入企业 A",
      { r4: r4.status, r5: r5.status },
    );
    const r6 = await register(`fx_usr1_rep6_${stamp}@fixture.test`, code("PLAIN"));
    const personal = r6.user ? await db.organization.findFirst({ where: { code: `personal-${r6.user.id.slice(0, 8)}` } }) : null;
    if (personal) orgIds.push(personal.id);
    ok(r6.status === 200 && !!personal && r6.user?.activeOrgId === null, "不绑定企业的码：仍建个人工作区（原行为不变）", { status: r6.status, personal: personal?.code });

    console.log("\n[5] 用户管理按企业范围");
    const inA = await listUsers(`orgId=${ORG_A}&pageSize=100`);
    const usersA = (inA.body.users ?? []) as Array<{ id: string; orgRole?: string }>;
    const idsA = new Set(usersA.map((u) => u.id));
    const expectA = [A_OLD, r1.user?.id, r2.user?.id, r4.user?.id, r5.user?.id].filter(Boolean) as string[];
    ok(
      inA.status === 200 && expectA.every((id) => idsA.has(id)) && usersA.length === expectA.length,
      "企业 A 范围：只列企业 A 的 active 成员",
      { status: inA.status, got: usersA.map((u) => u.id), expectA },
    );
    ok(![LONER, B_MEMBER, A_LEFT, r6.user?.id].some((id) => id && idsA.has(id)), "不含其他企业成员、无企业账号、已离开企业 A 的人", usersA.map((u) => u.id));
    ok(usersA.find((u) => u.id === A_OLD)?.orgRole === "org_admin" && usersA.find((u) => u.id === r1.user?.id)?.orgRole === "org_member", "每人带企业内角色", usersA);
    const scopeA = inA.body.scope as { type: string; org?: { id: string; name: string } } | undefined;
    ok(scopeA?.type === "org" && scopeA.org?.id === ORG_A && scopeA.org.name === `Fixture Blinds ${stamp}` && inA.body.total === expectA.length, "响应带范围（企业 id / 名称）与人数", { scope: scopeA, total: inA.body.total });

    const platform = await listUsers(`scope=platform&keyword=${stamp}&pageSize=100`);
    const idsP = new Set(((platform.body.users ?? []) as Array<{ id: string }>).map((u) => u.id));
    ok(platform.status === 200 && [LONER, B_MEMBER, A_LEFT, A_OLD].every((id) => idsP.has(id)) && (platform.body.scope as { type: string }).type === "platform", "scope=platform：全平台（含其他企业与无企业账号）", { status: platform.status, n: idsP.size });

    await db.user.update({ where: { id: ADMIN }, data: { activeOrgId: null } });
    const noScope = await listUsers("pageSize=20");
    ok(noScope.status === 400 && noScope.body.code === "ORG_SCOPE_REQUIRED", "没有当前企业、没传范围 → 400 ORG_SCOPE_REQUIRED（不回落到全平台）", noScope);
    await db.user.update({ where: { id: ADMIN }, data: { activeOrgId: ORG_B } });
    const byActive = await listUsers("pageSize=100");
    const idsB = ((byActive.body.users ?? []) as Array<{ id: string }>).map((u) => u.id);
    ok(byActive.status === 200 && idsB.length === 1 && idsB[0] === B_MEMBER, "没传范围 → 用当前工作企业（企业 B）", { status: byActive.status, idsB });
    const missing = await listUsers(`orgId=missing_${stamp}`);
    ok(missing.status === 404, "不存在的企业 → 404", missing.status);
    for (const who of [PADMIN, BOSS]) {
      const r = await listUsers(`orgId=${ORG_A}`, who);
      ok(r.status === 403, `平台角色 ${roleOf[who]} 以企业范围列用户 → 403`, r.status);
    }
  } finally {
    try {
      await db.principalRoleBinding.deleteMany({ where: { orgId: { in: orgIds } } }).catch(() => undefined);
      await db.positionTemplate.deleteMany({ where: { orgId: { in: orgIds } } }).catch(() => undefined);
      await db.rolePermissionBinding.deleteMany({ where: { roleProfile: { orgId: { in: orgIds } } } }).catch(() => undefined);
      await db.roleProfile.deleteMany({ where: { orgId: { in: orgIds } } }).catch(() => undefined);
      await db.inviteCode.deleteMany({ where: { OR: [{ code: { contains: stamp.toUpperCase() } }, { orgId: { in: orgIds } }] } });
      await db.auditLog.deleteMany({ where: { OR: [{ orgId: { in: orgIds } }, { userId: { in: createdUserIds } }] } });
      // 不绑定企业的普通用户码注册时，旧 bootstrap 会建「我的第一个项目」+ 环境
      const ownProjects = { ownerId: { in: createdUserIds } };
      await db.environment.deleteMany({ where: { project: ownProjects } }).catch(() => undefined);
      await db.projectMember.deleteMany({ where: { project: ownProjects } }).catch(() => undefined);
      await db.project.deleteMany({ where: ownProjects });
      await db.user.updateMany({ where: { id: { in: createdUserIds } }, data: { activeOrgId: null } });
      await db.organizationMember.deleteMany({ where: { OR: [{ orgId: { in: orgIds } }, { userId: { in: createdUserIds } }] } });
      await db.organization.deleteMany({ where: { id: { in: orgIds } } });
      await db.user.deleteMany({ where: { id: { in: createdUserIds } } });
      await db.company.deleteMany({ where: { id: { in: [COMPANY_A, COMPANY_X] } } });
    } catch (cleanupErr) {
      console.warn("[cleanup] 清理未完成：", cleanupErr instanceof Error ? cleanupErr.message : cleanupErr);
    }
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  await db.$disconnect();
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
