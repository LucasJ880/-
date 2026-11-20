/**
 * CHAIN-2c 谁能更换项目负责人——真实 DB（隔离库），调用真实路由
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated JWT_SECRET=… \
 *   npx tsx src/lib/projects/__tests__/owner-change-db.isolated.test.ts
 * 无隔离库时自动跳过。只用虚构数据。
 */
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过 CHAIN-2c 更换项目负责人 DB 测试（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "CHAIN-2c owner change DB test" });
process.env.JWT_SECRET = process.env.JWT_SECRET || "chain-2c-isolated-test-secret-0123456789abcdef";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail).slice(0, 1200) : ""); }
}
type Rec = Record<string, unknown>;

async function main() {
  const { db } = await import("@/lib/db");
  const { NextRequest } = await import("next/server");
  const { createSession } = await import("@/lib/auth/session");
  const { seedOrgAuthorizationProfiles } = await import("@/lib/authorization/seed-org-profiles");
  const { writeOwnerIfUnchanged, OwnerChangeConflict } = await import("@/lib/projects/owner-change-access");
  const projectRoute = await import("@/app/api/projects/[id]/route");
  const membersRoute = await import("@/app/api/projects/[id]/members/route");
  const memberRoute = await import("@/app/api/projects/[id]/members/[memberId]/route");
  const opsRoute = await import("@/app/api/ops/projects/[id]/route");

  console.log("CHAIN-2c owner change — isolated DB");
  const stamp = Date.now().toString(36);
  const id = (k: string) => `oc${k}_${stamp}`;
  const OWNER = id("owner"), PADMIN = id("padmin"), OADMIN = id("oadmin"), FIN = id("fin"), SUPER = id("super"), VIEWER = id("viewer");
  const TARGET = id("target"), TARGET2 = id("target2"), INACTIVE = id("inactive"), OUTSIDER = id("outsider"), LEFT = id("left");
  const POWNER = id("powner"), PADMIN2 = id("padmin2");
  // 执行项目用一个不按岗位的组织（组织管理员是管理层，能进运营中心、能管理执行项目）
  const OADMIN3 = id("oadmin3"), OWNER3 = id("owner3"), TARGET3 = id("target3");
  const USERS = [OWNER, PADMIN, OADMIN, FIN, SUPER, VIEWER, TARGET, TARGET2, INACTIVE, OUTSIDER, LEFT, POWNER, PADMIN2, OADMIN3, OWNER3, TARGET3];
  const ORG = id("org"), ORG2 = id("org2"), ORG3 = id("org3");
  for (const u of USERS) await db.user.create({ data: { id: u, email: `${u}@fixture.test`, name: `Example ${u}`, role: u === SUPER ? "super_admin" : "user", status: u === INACTIVE ? "inactive" : "active" } });
  await db.organization.create({ data: { id: ORG, name: "Example Owner Fixture", code: `oc-${stamp}`, ownerId: OADMIN, industryPackId: "window_covering_services_v1" } });
  await db.organization.create({ data: { id: ORG2, name: "Example Other Org", code: `oc2-${stamp}`, ownerId: OUTSIDER } });
  for (const u of [OWNER, PADMIN, FIN, VIEWER, TARGET, TARGET2, INACTIVE]) await db.organizationMember.create({ data: { orgId: ORG, userId: u, role: "org_member", status: "active" } });
  await db.organizationMember.create({ data: { orgId: ORG, userId: OADMIN, role: "org_admin", status: "active" } });
  await db.organizationMember.create({ data: { orgId: ORG, userId: LEFT, role: "org_member", status: "inactive" } });
  await db.organizationMember.create({ data: { orgId: ORG2, userId: OUTSIDER, role: "org_member", status: "active" } });
  await db.organization.create({ data: { id: ORG3, name: "Example Delivery Org", code: `oc3-${stamp}`, ownerId: OADMIN3 } });
  await db.organizationMember.create({ data: { orgId: ORG3, userId: OADMIN3, role: "org_admin", status: "active" } });
  for (const u of [OWNER3, TARGET3]) await db.organizationMember.create({ data: { orgId: ORG3, userId: u, role: "org_member", status: "active" } });
  await seedOrgAuthorizationProfiles(ORG);
  // FIN：岗位「owner」含组织范围 project.finance.manage（与 PERM-4c1 测试同一夹具）
  const ownerProfile = await db.roleProfile.findUnique({ where: { orgId_key: { orgId: ORG, key: "owner" } } });
  await db.principalRoleBinding.create({ data: { orgId: ORG, principalType: "HUMAN", principalId: FIN, roleProfileId: ownerProfile!.id, status: "active" } });

  const P = (await db.project.create({ data: { name: `Fixture Owner Project ${stamp}`, ownerId: OWNER, orgId: ORG, intakeStatus: "dispatched" } })).id;
  const D = (await db.project.create({ data: { name: `Fixture Delivery ${stamp}`, ownerId: OWNER3, orgId: ORG3, intakeStatus: "dispatched", workDomain: "delivery", deliveryStage: "handoff" } })).id;
  const PP = (await db.project.create({ data: { name: `Fixture Personal ${stamp}`, ownerId: POWNER, intakeStatus: "dispatched" } })).id;
  const projectIds = [P, D, PP];
  for (const [u, role] of [[OWNER, "project_admin"], [PADMIN, "project_admin"], [FIN, "project_admin"], [VIEWER, "viewer"], [TARGET, "operator"], [LEFT, "operator"]] as const) {
    await db.projectMember.create({ data: { projectId: P, userId: u, role, status: "active" } });
  }
  await db.projectMember.create({ data: { projectId: D, userId: OWNER3, role: "project_admin", status: "active" } });
  await db.projectMember.create({ data: { projectId: PP, userId: PADMIN2, role: "project_admin", status: "active" } });

  const cookie = async (u: string) => `qy_session=${await createSession({ sub: u, email: `${u}@fixture.test`, role: u === SUPER ? "super_admin" : "user" })}`;
  const call = async (handler: (req: InstanceType<typeof NextRequest>, ctx: never) => Promise<Response>, method: string, url: string, u: string, params: Rec, body?: unknown) => {
    const req = new NextRequest(`http://localhost${url}`, { method, headers: { cookie: await cookie(u), "content-type": "application/json", "x-forwarded-for": "10.31.0.9" }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    const res = await handler(req, { params: Promise.resolve(params) } as never);
    return { status: res.status, body: (await res.json().catch(() => ({}))) as Rec };
  };
  const patchProject = (u: string, body: Rec, pid = P) => call(projectRoute.PATCH as never, "PATCH", `/api/projects/${pid}`, u, { id: pid }, body);
  const addMember = (u: string, body: Rec) => call(membersRoute.POST as never, "POST", `/api/projects/${P}/members`, u, { id: P }, body);
  const listMembers = (u: string) => call(membersRoute.GET as never, "GET", `/api/projects/${P}/members`, u, { id: P });
  const patchMember = async (u: string, memberUserId: string, body: Rec) => {
    const m = await db.projectMember.findFirstOrThrow({ where: { projectId: P, userId: memberUserId } });
    return call(memberRoute.PATCH as never, "PATCH", `/api/projects/${P}/members/${m.id}`, u, { id: P, memberId: m.id }, body);
  };
  const patchOps = (u: string, body: Rec) => call(opsRoute.PATCH as never, "PATCH", `/api/ops/projects/${D}`, u, { id: D }, body);
  const ownerOf = async (pid: string) => (await db.project.findUniqueOrThrow({ where: { id: pid }, select: { ownerId: true } })).ownerId;
  const nameOf = async (pid: string) => (await db.project.findUniqueOrThrow({ where: { id: pid }, select: { name: true } })).name;
  const resetOwner = (pid: string, u: string) => db.project.update({ where: { id: pid }, data: { ownerId: u } });
  const audits = (pid: string) => db.auditLog.count({ where: { projectId: pid } });
  const F = { forbidden: "OWNER_CHANGE_FORBIDDEN", self: "OWNER_SELF_ASSIGN_FORBIDDEN", invalid: "OWNER_INVALID" };

  try {
    /* ---------- 换给别人 ---------- */
    const a0 = await audits(P);
    const pa = await patchProject(PADMIN, { name: "Renamed by padmin", ownerId: TARGET });
    ok(pa.status === 403 && pa.body.code === F.forbidden && pa.body.error === "只有项目负责人、组织管理员、持「管理项目财务」权限的人或平台管理员能更换项目负责人。请找现在的主负责人或组织管理员。" && (await ownerOf(P)) === OWNER && (await nameOf(P)).startsWith("Fixture Owner Project") && (await audits(P)) === a0, "不是负责人的项目管理员换给别人：403，负责人与名称都不变、没有审计", pa.body);
    for (const [u, label] of [[OADMIN, "组织管理员"], [OWNER, "当前负责人"], [FIN, "持组织范围 project.finance.manage 的项目管理员"], [SUPER, "平台超级管理员"]] as const) {
      const r = await patchProject(u, { ownerId: TARGET });
      ok(r.status === 200 && (await ownerOf(P)) === TARGET, `${label}换给别人：成功`, r.body);
      await resetOwner(P, OWNER);
    }

    /* ---------- 换给自己 ---------- */
    for (const [u, label] of [[OADMIN, "组织管理员"], [PADMIN, "项目管理员"]] as const) {
      const r = await patchProject(u, { ownerId: u });
      ok(r.status === 403 && r.body.code === F.self && r.body.error === "你不能把自己设为主负责人（需要「管理项目财务」权限），可以请现在的主负责人或另一位组织管理员交给你。" && (await ownerOf(P)) === OWNER, `${label}把自己设为负责人：403`, r.body);
    }
    const superNotMember = await patchProject(SUPER, { ownerId: SUPER });
    ok(superNotMember.status === 400 && superNotMember.body.code === F.invalid && (await ownerOf(P)) === OWNER, "平台超级管理员不是本组织成员时把自己设为负责人：权限通过，但新负责人不合格 → 400", superNotMember.body);
    await db.organizationMember.create({ data: { orgId: ORG, userId: SUPER, role: "org_member", status: "active" } });
    for (const [u, label] of [[FIN, "持财务键的项目管理员"], [SUPER, "平台超级管理员（本组织成员）"]] as const) {
      const r = await patchProject(u, { ownerId: u });
      ok(r.status === 200 && (await ownerOf(P)) === u, `${label}把自己设为负责人：成功`, r.body);
      await resetOwner(P, OWNER);
    }
    const same = await patchProject(PADMIN, { ownerId: OWNER, name: `Fixture Owner Project ${stamp} same` });
    ok(same.status === 200 && (await nameOf(P)) === `Fixture Owner Project ${stamp} same`, "负责人不变的请求照常保存（项目管理员也可以）", same.body);

    /* ---------- 新负责人的条件 ---------- */
    const inact = await patchProject(OADMIN, { ownerId: INACTIVE });
    const outside = await patchProject(OADMIN, { ownerId: OUTSIDER });
    const leftRow = await patchMember(OADMIN, LEFT, { duty: "owner" });
    const permFirst = await patchProject(PADMIN, { ownerId: INACTIVE });
    ok(inact.status === 400 && inact.body.code === F.invalid && inact.body.error === "新负责人必须是本组织的有效成员（账号没停用、没离开组织），请换一位。" && outside.status === 400 && outside.body.code === F.invalid && leftRow.status === 400 && leftRow.body.code === F.invalid && permFirst.status === 403 && (await ownerOf(P)) === OWNER, "已停用、别的组织、已离开本组织的成员：400；没有权限的人先 403", [inact.body, outside.body, leftRow.body, permFirst.body]);

    /* ---------- 审计 ---------- */
    const r1 = await patchProject(OADMIN, { ownerId: TARGET });
    const au1 = await db.auditLog.findFirst({ where: { projectId: P, userId: OADMIN, targetType: "project" }, orderBy: { createdAt: "desc" } });
    const b1 = JSON.parse(au1?.beforeData ?? "{}") as Rec, f1 = JSON.parse(au1?.afterData ?? "{}") as Rec;
    ok(r1.status === 200 && b1.ownerId === OWNER && f1.ownerId === TARGET, "换负责人的审计：前后各带负责人", { b1, f1 });
    await resetOwner(P, OWNER);
    await patchProject(OADMIN, { name: `Fixture Owner Project ${stamp} renamed` });
    const au2 = await db.auditLog.findFirst({ where: { projectId: P, userId: OADMIN, targetType: "project" }, orderBy: { createdAt: "desc" } });
    ok(!("ownerId" in (JSON.parse(au2?.beforeData ?? "{}") as Rec)) && !("ownerId" in (JSON.parse(au2?.afterData ?? "{}") as Rec)), "只改名称：审计不含负责人", au2);

    /* ---------- 成员接口 ---------- */
    const mBefore = await db.projectMember.count({ where: { projectId: P } });
    const aBeforeMembers = await audits(P);
    const addByPadmin = await addMember(PADMIN, { userId: TARGET2, duty: "owner" });
    const addSelf = await addMember(OADMIN, { userId: OADMIN, duty: "owner" });
    ok(addByPadmin.status === 403 && addByPadmin.body.code === F.forbidden && addSelf.status === 403 && addSelf.body.code === F.self && (await db.projectMember.count({ where: { projectId: P } })) === mBefore && (await ownerOf(P)) === OWNER && (await audits(P)) === aBeforeMembers, "加成员并设为负责人：项目管理员 403、组织管理员加自己 403；没有新成员、没有新审计", [addByPadmin.body, addSelf.body]);
    const selfRow = await patchMember(PADMIN, PADMIN, { duty: "owner" });
    const padminRow = await db.projectMember.findFirstOrThrow({ where: { projectId: P, userId: PADMIN } });
    ok(selfRow.status === 403 && selfRow.body.code === F.self && padminRow.role === "project_admin" && (await ownerOf(P)) === OWNER && (await audits(P)) === aBeforeMembers, "项目管理员把自己那一行改为主负责人：403，角色与身份不变、没有新审计", selfRow.body);
    const addOk = await addMember(OADMIN, { userId: TARGET2, duty: "owner" });
    const addAudit = await db.auditLog.findFirst({ where: { projectId: P, userId: OADMIN, targetType: "project_member" }, orderBy: { createdAt: "desc" } });
    ok((addOk.status === 200 || addOk.status === 201) && (await ownerOf(P)) === TARGET2 && (JSON.parse(addAudit?.beforeData ?? "{}") as Rec).ownerId === OWNER && (JSON.parse(addAudit?.afterData ?? "{}") as Rec).ownerId === TARGET2, "组织管理员加一位成员并设为负责人：成功，审计带前后负责人", { body: addOk.body, addAudit });
    await resetOwner(P, OWNER);
    const flags = async (u: string) => (await listMembers(u)).body.ownerChange as Rec | undefined;
    const fl = [await flags(PADMIN), await flags(OADMIN), await flags(FIN), await flags(VIEWER)];
    ok(JSON.stringify(fl) === JSON.stringify([{ canChange: false, canSelfAssign: false }, { canChange: true, canSelfAssign: false }, { canChange: true, canSelfAssign: true }, { canChange: false, canSelfAssign: false }]), "成员接口的两个标记：项目管理员、组织管理员、持财务键的项目管理员、只读成员", fl);

    /* ---------- 同时更换：经真实路由（在判定之后、写入之前把负责人改掉）与直接调写入 ---------- */
    {
      const orig = db.$transaction.bind(db) as (...args: unknown[]) => Promise<unknown>;
      (db as unknown as { $transaction: unknown }).$transaction = async (...args: unknown[]) => {
        await db.project.update({ where: { id: P }, data: { ownerId: TARGET2 } });
        return orig(...args);
      };
      let raced: { status: number; body: Rec };
      try {
        raced = await patchProject(OADMIN, { name: "Raced rename", ownerId: TARGET });
      } finally {
        (db as unknown as { $transaction: unknown }).$transaction = orig;
      }
      ok(raced.status === 409 && raced.body.code === "OWNER_CONFLICT" && raced.body.error === "负责人刚被别人换过了，请刷新页面，看清现在的负责人再操作。" && (await ownerOf(P)) === TARGET2 && !(await nameOf(P)).startsWith("Raced"), "PATCH：判定之后负责人被别人换了 → 409，不覆盖、名称也不写", raced.body);
      await resetOwner(P, OWNER);
    }
    await resetOwner(P, TARGET);
    let conflict = false;
    try {
      await db.$transaction(async (tx) => writeOwnerIfUnchanged(tx, P, OWNER, TARGET2));
    } catch (e) {
      conflict = e instanceof OwnerChangeConflict;
    }
    ok(conflict && (await ownerOf(P)) === TARGET, "按读到的旧负责人写入、库里已是另一个人：冲突，不覆盖", { conflict, owner: await ownerOf(P) });
    await resetOwner(P, OWNER);

    /* ---------- 执行项目 ---------- */
    const aD0 = await audits(D);
    const dSelf = await patchOps(OADMIN3, { name: "Delivery renamed", ownerId: OADMIN3 });
    ok(dSelf.status === 403 && dSelf.body.code === F.self && (await ownerOf(D)) === OWNER3 && (await nameOf(D)) === `Fixture Delivery ${stamp}` && (await audits(D)) === aD0, "执行项目：组织管理员同时改名并把自己设为负责人 → 403，名称与负责人都不变、没有新审计", dSelf.body);
    const dNonMgr = await patchOps(OWNER3, { ownerId: TARGET3 });
    // 普通组织成员连运营中心都进不去（原来的 OPS_FORBIDDEN）；能进运营中心但不能管理执行项目的人得到原来的 403「无权重新分配负责人」——由 owner-change.test.ts 的源码断言守住
    ok(dNonMgr.status === 403 && dNonMgr.body.code === "OPS_FORBIDDEN" && (await ownerOf(D)) === OWNER3, "执行项目：不是管理者的负责人 → 原来的 403（不是 OWNER_CHANGE_FORBIDDEN）", dNonMgr.body);
    const dOk = await patchOps(OADMIN3, { ownerId: TARGET3 });
    const dAudit = await db.auditLog.findFirst({ where: { projectId: D, userId: OADMIN3, targetType: "project" }, orderBy: { createdAt: "desc" } });
    ok(dOk.status === 200 && (await ownerOf(D)) === TARGET3 && (JSON.parse(dAudit?.beforeData ?? "{}") as Rec).ownerId === OWNER3 && (JSON.parse(dAudit?.afterData ?? "{}") as Rec).ownerId === TARGET3, "执行项目：组织管理员交给别人 → 成功，写审计（前后负责人）", { status: dOk.status, body: dOk.body, dAudit });
    const dBad = await patchOps(OADMIN3, { ownerId: OUTSIDER });
    ok(dBad.status === 400 && dBad.body.code === F.invalid && (await ownerOf(D)) === TARGET3, "执行项目：新负责人不在本组织 → 400", dBad.body);

    /* ---------- 个人项目 ---------- */
    // 个人项目：既有写权限只给负责人与平台超级管理员（项目管理员连修改都不能），所以个人项目的那两句只在纯函数里测
    const pp1 = await patchProject(PADMIN2, { ownerId: TARGET }, PP);
    const ppInactive = await patchProject(POWNER, { ownerId: INACTIVE }, PP);
    const pp2 = await patchProject(POWNER, { ownerId: PADMIN2 }, PP);
    ok(pp1.status === 403 && ppInactive.status === 400 && ppInactive.body.error === "新负责人的账号已停用，请换一位。" && pp2.status === 200 && (await ownerOf(PP)) === PADMIN2, "个人项目：项目管理员不能修改（既有 403）、换成已停用的用户 400（个人项目的话）、负责人交给别人成功", [pp1.body, ppInactive.body, pp2.status]);
  } finally {
    await db.auditLog.deleteMany({ where: { OR: [{ projectId: { in: projectIds } }, { userId: { in: USERS } }, { orgId: { in: [ORG, ORG2, ORG3] } }] } });
    await db.projectEvent.deleteMany({ where: { projectId: { in: projectIds } } }).catch(() => undefined);
    await db.projectMember.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.project.deleteMany({ where: { id: { in: projectIds } } }).catch(async () => {
      for (const pid of projectIds) await db.project.delete({ where: { id: pid } }).catch(() => undefined);
    });
    await db.principalRoleBinding.deleteMany({ where: { orgId: { in: [ORG, ORG2] } } }).catch(() => undefined);
    await db.roleProfile.deleteMany({ where: { orgId: { in: [ORG, ORG2] } } }).catch(() => undefined);
    await db.organizationMember.deleteMany({ where: { orgId: { in: [ORG, ORG2, ORG3] } } });
    await db.organization.deleteMany({ where: { id: { in: [ORG, ORG2, ORG3] } } }).catch(() => undefined);
    await db.user.deleteMany({ where: { id: { in: USERS } } }).catch(() => undefined);
    await db.$disconnect();
  }

  console.log(`\nCHAIN-2c owner change DB: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
