/**
 * PERM-4c1：项目财务按岗位——真实 DB（隔离库）+ 真实守卫 / 路由端到端（财务开关打开）
 *
 *   老板（owner，非项目成员）审核费用 / 编辑预算放行；会计（accounting，非成员）看全部费用、审核 / 付款 / 提交 403；
 *   org_admin + sales_rep 岗位的成员只见本人费用；无岗位 org_admin 也不再有特权；
 *   销售非成员 403；跨企业不可见；未派发项目 404；项目负责人编辑预算放行。
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated \
 *   npx tsx src/lib/project-finance/__tests__/finance-access-db.isolated.test.ts
 * 无隔离库时自动跳过。只用虚构数据。
 */
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过 PERM-4c1 项目财务 DB 测试（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "PERM-4c1 finance access DB test" });

process.env.JWT_SECRET = process.env.JWT_SECRET || "perm-4c1-isolated-test-secret-0123456789abcdef";
process.env.TENDER_FINANCIAL_CONTROL_ENABLED = "true";

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
  const { NextRequest, NextResponse } = await import("next/server");
  const { createSession } = await import("@/lib/auth/session");
  const { seedOrgAuthorizationProfiles } = await import("@/lib/authorization/seed-org-profiles");
  const { requireCostAccess } = await import("@/lib/project-finance/access");
  const { PERMISSIONS } = await import("@/lib/rbac/permissions");
  const expensesRoute = await import("@/app/api/projects/[id]/finance/expenses/route");

  const stamp = Date.now().toString(36);
  const BOSS = `pfboss_${stamp}`;
  const MIKI = `pfmiki_${stamp}`;
  const PM = `pfpm_${stamp}`;
  const MEMBER = `pfmem_${stamp}`;
  const ADMINREP = `pfadm_${stamp}`;
  const ADMINNOPOS = `pfadmn_${stamp}`;
  const REP = `pfrep_${stamp}`;
  const OTHER = `pfoth_${stamp}`;
  const ORG = `pforg_${stamp}`;
  const ORG2 = `pforg2_${stamp}`;
  const users = [BOSS, MIKI, PM, MEMBER, ADMINREP, ADMINNOPOS, REP, OTHER];
  for (const id of users) await db.user.create({ data: { id, email: `${id}@fixture.test`, name: `Example ${id}`, role: "user" } });
  await db.organization.create({ data: { id: ORG, name: "Example Finance Fixture", code: `pfo-${stamp}`, ownerId: BOSS, industryPackId: "window_covering_services_v1" } });
  await db.organization.create({ data: { id: ORG2, name: "Example Other Org", code: `pfo2-${stamp}`, ownerId: OTHER } });
  const orgRole: Record<string, string> = { [ADMINREP]: "org_admin", [ADMINNOPOS]: "org_admin" };
  for (const id of [BOSS, MIKI, PM, MEMBER, ADMINREP, ADMINNOPOS, REP]) {
    await db.organizationMember.create({ data: { orgId: ORG, userId: id, role: orgRole[id] ?? "org_member", status: "active" } });
  }
  await db.organizationMember.create({ data: { orgId: ORG2, userId: OTHER, role: "org_member", status: "active" } });
  await seedOrgAuthorizationProfiles(ORG);
  const bind = async (userId: string, key: string) => {
    const profile = await db.roleProfile.findUnique({ where: { orgId_key: { orgId: ORG, key } } });
    await db.principalRoleBinding.create({ data: { orgId: ORG, principalType: "HUMAN", principalId: userId, roleProfileId: profile!.id, status: "active" } });
  };
  await bind(BOSS, "owner");
  await bind(MIKI, "accounting");
  await bind(ADMINREP, "sales_rep");
  await bind(REP, "sales_rep");
  await bind(MEMBER, "bids");
  // ADMINNOPOS：org_admin、无岗位——seed 自动绑系统模板 org_admin（不含 project.finance.manage）

  const project = await db.project.create({ data: { name: "Fixture Tender", ownerId: PM, orgId: ORG } });
  const otherProject = await db.project.create({ data: { name: "Fixture Other", ownerId: OTHER, orgId: ORG2 } });
  const intake = await db.project.create({ data: { name: "Fixture Intake", ownerId: PM, orgId: ORG, intakeStatus: "pending_dispatch" } });
  const projectIds = [project.id, otherProject.id, intake.id];
  await db.projectMember.create({ data: { projectId: project.id, userId: MEMBER, role: "operator", status: "active" } });
  await db.projectMember.create({ data: { projectId: project.id, userId: ADMINREP, role: "operator", status: "active" } });
  const expense = (submittedById: string, description: string) =>
    db.projectExpenseSubmission.create({
      data: { orgId: ORG, projectId: project.id, costCategory: "OTHER", submittedById, expenseOccurredAt: new Date(), description, totalAmount: 100, currency: "CAD" },
    });
  await expense(MEMBER, "member expense");
  await expense(ADMINREP, "admin expense");

  const req = async (uid: string, url: string) =>
    new NextRequest(`http://localhost${url}`, {
      headers: { cookie: `qy_session=${await createSession({ sub: uid, email: `${uid}@fixture.test`, role: "user" })}`, "x-forwarded-for": "10.31.0.8" },
    });
  const guard = async (uid: string, projectId: string, perm: (typeof PERMISSIONS)[keyof typeof PERMISSIONS]) => {
    const r = await requireCostAccess(await req(uid, `/api/projects/${projectId}/finance/summary`), projectId, perm as never);
    return r instanceof NextResponse ? { status: r.status } : { status: 200, finance: r.finance, projectRole: r.projectRole };
  };
  const listExpenses = async (uid: string) => {
    const res = await (expensesRoute.GET as unknown as (r: unknown, c: unknown) => Promise<Response>)(
      await req(uid, `/api/projects/${project.id}/finance/expenses`),
      { params: Promise.resolve({ id: project.id }) },
    );
    const body = res.status === 200 ? ((await res.json()) as { expenses: Array<{ submittedById: string }>; canReview: boolean }) : null;
    return { status: res.status, count: body?.expenses.length ?? -1, canReview: body?.canReview ?? null };
  };

  try {
    console.log("\n[1] 老板（owner 岗位，非项目成员）");
    const b1 = await guard(BOSS, project.id, PERMISSIONS.PROJECT_COST_REVIEW);
    ok(b1.status === 200 && b1.finance?.privileged === true && b1.projectRole === null, "审核费用权限放行（非成员经岗位键进入）", b1);
    const b2 = await guard(BOSS, project.id, PERMISSIONS.PROJECT_COST_WRITE);
    ok(b2.status === 200, "编辑预算权限放行", b2);
    const bl = await listExpenses(BOSS);
    ok(bl.status === 200 && bl.count === 2 && bl.canReview === true, "费用列表：全部 2 条、可审核", bl);

    console.log("\n[2] 会计（accounting 岗位，非项目成员）");
    const a1 = await guard(MIKI, project.id, PERMISSIONS.PROJECT_COST_READ);
    ok(a1.status === 200 && a1.finance?.canReadAll === true && a1.finance?.privileged === false, "读放行、只读全量、无特权", a1);
    const al = await listExpenses(MIKI);
    ok(al.status === 200 && al.count === 2 && al.canReview === false, "费用列表：全部 2 条、不可审核", al);
    for (const p of [PERMISSIONS.PROJECT_COST_REVIEW, PERMISSIONS.PROJECT_COST_WRITE, PERMISSIONS.PROJECT_PAYMENT_RECORD, PERMISSIONS.PROJECT_EXPENSE_SUBMIT]) {
      const r = await guard(MIKI, project.id, p);
      ok(r.status === 403, `会计 ${p} → 403`, r);
    }

    console.log("\n[3] org_admin 与兼容回退");
    const ar = await listExpenses(ADMINREP);
    ok(ar.status === 200 && ar.count === 1 && ar.canReview === false, "org_admin + sales_rep 岗位（项目成员）→ 只见本人 1 条、不可审核", ar);
    const ar2 = await guard(ADMINREP, project.id, PERMISSIONS.PROJECT_COST_REVIEW);
    ok(ar2.status === 403, "org_admin + sales_rep 审核 → 403", ar2);
    const an = await guard(ADMINNOPOS, project.id, PERMISSIONS.PROJECT_COST_REVIEW);
    ok(an.status === 403, "无岗位 org_admin（非项目成员）审核 → 403（org_admin 不再是特权）", an);

    console.log("\n[4] 其他人与边界");
    const r1 = await guard(REP, project.id, PERMISSIONS.PROJECT_COST_READ);
    ok(r1.status === 403, "销售（sales_rep，非成员）读 → 403", r1);
    const m1 = await listExpenses(MEMBER);
    ok(m1.status === 200 && m1.count === 1, "招投标项目成员（无项目审核角色）→ 只见本人 1 条", m1);
    const x1 = await guard(MIKI, otherProject.id, PERMISSIONS.PROJECT_COST_READ);
    ok(x1.status !== 200, "会计读别家企业项目 → 不可见", x1);
    const i1 = await guard(MIKI, intake.id, PERMISSIONS.PROJECT_COST_READ);
    ok(i1.status === 404, "未派发项目 → 404（与原规则一致）", i1);
    const pm = await guard(PM, project.id, PERMISSIONS.PROJECT_COST_WRITE);
    ok(pm.status === 200 && pm.finance?.privileged === true, "项目负责人编辑预算 → 放行", pm);

    console.log("\n[5] 财务开关关闭");
    delete process.env.TENDER_FINANCIAL_CONTROL_ENABLED;
    const off = await guard(BOSS, project.id, PERMISSIONS.PROJECT_COST_READ);
    ok(off.status === 404, "开关关闭 → 404（dark）", off);
  } finally {
    await db.projectExpenseSubmission.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.projectMember.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.project.deleteMany({ where: { id: { in: projectIds } } }).catch((e) => console.warn("project cleanup:", e instanceof Error ? e.message : e));
    await db.auditLog.deleteMany({ where: { OR: [{ userId: { in: users } }, { orgId: { in: [ORG, ORG2] } }] } });
    await db.principalRoleBinding.deleteMany({ where: { orgId: ORG } });
    await db.roleProfile.deleteMany({ where: { orgId: ORG } }).catch(() => undefined);
    await db.organizationMember.deleteMany({ where: { orgId: { in: [ORG, ORG2] } } });
    await db.organization.deleteMany({ where: { id: { in: [ORG, ORG2] } } }).catch((e) => console.warn("org cleanup:", e instanceof Error ? e.message : e));
    await db.user.deleteMany({ where: { id: { in: users } } }).catch((e) => console.warn("user cleanup:", e instanceof Error ? e.message : e));
    await db.$disconnect();
  }

  console.log(`\nPERM-4c1 项目财务 DB 端到端：${pass} 通过，${fail} 失败`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
