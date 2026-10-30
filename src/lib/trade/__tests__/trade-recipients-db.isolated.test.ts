/**
 * PERM-6c：营收中心按外贸键 + 外贸收件人 / 默认询盘负责人按岗位 + 压扁纳入 trade——真实 DB（隔离库）+ 真实路由
 *
 *   旧模式企业（梦馨形态，未 seed）：老板（平台 admin、org_owner）与业务员（平台 trade）照常；
 *   不是负责人的平台 boss、平台 sales、只管设置的 org_admin 被拒 / 不收；
 *   岗位模式企业（窗饰，已 seed）：owner / trade_rep 照常，sales_rep 403；默认负责人给 trade_rep；
 *   压扁 dry-run：有绑定的平台 trade 纳入计划，无绑定的阻断。
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated \
 *   npx tsx src/lib/trade/__tests__/trade-recipients-db.isolated.test.ts
 * 无隔离库时自动跳过。只用虚构数据。
 */
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过 PERM-6c 外贸收件人 DB 测试（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "PERM-6c trade recipients DB test" });

process.env.JWT_SECRET = process.env.JWT_SECRET || "perm-6c-isolated-test-secret-0123456789abcdef";

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
  const { tradeWorkRecipients, tradeManagementRecipients, resolveDefaultInquiryOwner } = await import("@/lib/trade/recipients");
  const { managementOf } = await import("@/lib/trade/booth-summary");
  const { resolveInquiryOwner } = await import("@/lib/revenue-spine/inquiry-intake");
  const cockpitRoute = await import("@/app/api/revenue/cockpit/route");
  const opportunitiesRoute = await import("@/app/api/revenue/opportunities/route");
  const policyRoute = await import("@/app/api/revenue/policy/route");

  const stamp = Date.now().toString(36);
  const BOSS = `trboss_${stamp}`;
  const REP = `trrep_${stamp}`;
  const PBOSS = `trpb_${stamp}`;
  const OADMIN = `troa_${stamp}`;
  const SALES = `trsal_${stamp}`;
  const OWNER = `trown_${stamp}`;
  const TR = `trtr_${stamp}`;
  const SR = `trsr_${stamp}`;
  const PT = `trpt_${stamp}`;
  const PT_LATE = `trptl_${stamp}`;
  const SA = `trsa_${stamp}`;
  const LEG = `trleg_${stamp}`;
  const WC = `trwc_${stamp}`;
  const WC_CODE = `tr-wc-${stamp}`;
  const role: Record<string, string> = {
    [BOSS]: "admin",
    [REP]: "trade",
    [PBOSS]: "boss",
    [OADMIN]: "user",
    [SALES]: "sales",
    [OWNER]: "user",
    [TR]: "user",
    [SR]: "user",
    [PT]: "trade",
    [PT_LATE]: "trade",
    [SA]: "super_admin",
  };
  const users = Object.keys(role);
  const orgs = [LEG, WC];
  for (const id of users) await db.user.create({ data: { id, email: `${id}@fixture.test`, name: `Example ${id}`, role: role[id] } });
  await db.organization.create({ data: { id: LEG, name: "Example Legacy Trade", code: `tr-leg-${stamp}`, ownerId: BOSS, modulesJson: { enabled: ["trade"] } } });
  await db.organization.create({ data: { id: WC, name: "Example WC Trade", code: WC_CODE, ownerId: OWNER, industryPackId: "window_covering_services_v1", modulesJson: { enabled: ["sales", "trade"] } } });
  // 加入顺序决定默认负责人：逐个创建，createdAt 递增
  const member = async (orgId: string, userId: string, orgRole: string) => {
    await db.organizationMember.create({ data: { orgId, userId, role: orgRole, status: "active", createdAt: new Date(Date.now() + users.indexOf(userId) * 1000) } });
    await db.user.update({ where: { id: userId }, data: { activeOrgId: orgId } });
  };
  await member(LEG, BOSS, "org_owner");
  await member(LEG, REP, "org_member");
  await member(LEG, PBOSS, "org_member");
  await member(LEG, OADMIN, "org_admin");
  await member(LEG, SALES, "org_member");
  await member(WC, OWNER, "org_member");
  await member(WC, TR, "org_member");
  await member(WC, SR, "org_member");
  await member(WC, PT, "org_member");
  await seedOrgAuthorizationProfiles(WC);
  const bind = async (userId: string, key: string) => {
    const profile = await db.roleProfile.findUnique({ where: { orgId_key: { orgId: WC, key } } });
    await db.principalRoleBinding.create({ data: { orgId: WC, principalType: "HUMAN", principalId: userId, roleProfileId: profile!.id, status: "active" } });
  };
  await bind(OWNER, "owner");
  await bind(TR, "trade_rep");
  await bind(SR, "sales_rep");
  // seed 之后才加入：没有自动绑定
  await member(WC, PT_LATE, "org_member");

  const req = async (uid: string, url: string, body?: unknown) =>
    new NextRequest(`http://localhost${url}`, {
      method: body === undefined ? "GET" : "PUT",
      headers: {
        cookie: `qy_session=${await createSession({ sub: uid, email: `${uid}@fixture.test`, role: role[uid] })}`,
        "x-forwarded-for": "10.47.0.8",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const call = async (handler: unknown, uid: string, url: string, body?: unknown) =>
    (handler as Handler)(await req(uid, url, body), { params: Promise.resolve({}) });
  const sorted = (a: string[]) => [...a].sort().join(",");

  try {
    // ── 营收中心：旧模式 ──
    ok((await call(cockpitRoute.GET, REP, "/api/revenue/cockpit")).status === 200, "旧模式业务员（兼容 trade_rep）：营收驾驶舱 200");
    ok((await call(cockpitRoute.GET, BOSS, "/api/revenue/cockpit")).status === 200, "旧模式老板（平台 admin、org_owner）：营收驾驶舱 200");
    ok((await call(policyRoute.PUT, BOSS, "/api/revenue/policy", {})).status === 200, "旧模式老板：发布策略 200（trade.settings.manage）");
    ok((await call(policyRoute.PUT, REP, "/api/revenue/policy", {})).status === 403, "业务员：发布策略 403");
    ok((await call(opportunitiesRoute.GET, SALES, "/api/revenue/opportunities")).status === 403, "平台 sales（sales_rep）：营收商机 403");
    ok((await call(cockpitRoute.GET, PBOSS, "/api/revenue/cockpit")).status === 403, "不是负责人的平台 boss：营收中心 403");
    ok((await call(policyRoute.GET, OADMIN, "/api/revenue/policy")).status === 200, "只管设置的 org_admin：读策略 200");
    ok((await call(cockpitRoute.GET, OADMIN, "/api/revenue/cockpit")).status === 403, "只管设置的 org_admin：营收驾驶舱 403");
    ok((await call(cockpitRoute.GET, SA, `/api/revenue/cockpit?orgId=${LEG}`)).status === 200, "平台 super_admin 显式企业：200");

    // ── 营收中心：岗位模式 ──
    ok((await call(cockpitRoute.GET, OWNER, "/api/revenue/cockpit")).status === 200, "岗位模式 owner（压扁后）：200");
    ok((await call(cockpitRoute.GET, TR, "/api/revenue/cockpit")).status === 200, "岗位模式 trade_rep：200");
    ok((await call(opportunitiesRoute.GET, SR, "/api/revenue/opportunities")).status === 403, "岗位模式 sales_rep：营收商机 403（不再越过本人范围）");

    // ── 收件人：旧模式 ──
    ok(sorted(await tradeWorkRecipients(LEG)) === sorted([BOSS, REP]), "旧模式工作收件人 = 老板 + 业务员", await tradeWorkRecipients(LEG));
    ok(sorted(await tradeManagementRecipients(LEG)) === sorted([BOSS]), "旧模式管理层收件人 = 老板（不含平台 boss 非负责人、org_admin）", await tradeManagementRecipients(LEG));
    ok(sorted(await managementOf(LEG)) === sorted([BOSS]), "managementOf（早报 / 展会小结 / SLA 分级）同一规则");
    ok((await resolveDefaultInquiryOwner(LEG)) === REP, "旧模式默认询盘负责人 = 业务员（老板先加入也不抢）");
    ok((await resolveInquiryOwner(LEG, BOSS)) === BOSS, "既有商机负责人优先（preferredUserId）");

    // ── 收件人：岗位模式 ──
    ok(sorted(await tradeWorkRecipients(WC)) === sorted([OWNER, TR, PT]), "岗位模式工作收件人 = owner + trade_rep + seed 自动绑的平台 trade", await tradeWorkRecipients(WC));
    ok(sorted(await tradeManagementRecipients(WC)) === sorted([OWNER]), "岗位模式管理层收件人 = 老板岗位", await tradeManagementRecipients(WC));
    ok((await resolveDefaultInquiryOwner(WC)) === TR, "岗位模式默认询盘负责人 = 最早的 trade_rep（owner 不入选）");

    // ── 压扁纳入 trade（dry-run，不写库） ──
    const plan = await runPlatformRoleCollapse({ orgCode: WC_CODE, actorEmail: `${SA}@fixture.test`, dryRun: true, restore: false, ready: true });
    ok(plan.lines.some((l) => l === `压扁 ${PT}@fixture.test：trade → user`), "压扁计划含有绑定的平台 trade", plan.lines);
    ok(plan.exitCode === 2 && plan.lines.some((l) => l.includes(`${PT_LATE}@fixture.test`) && l.includes("无 active 岗位绑定")), "无绑定的平台 trade 阻断", plan.lines);
    ok((await db.user.findUnique({ where: { id: PT }, select: { role: true } }))?.role === "trade", "dry-run 不写库");
  } finally {
    await db.orgBusinessRule.deleteMany({ where: { orgId: { in: orgs } } }).catch(() => undefined);
    await db.notification.deleteMany({ where: { userId: { in: users } } });
    await db.auditLog.deleteMany({ where: { OR: [{ userId: { in: users } }, { orgId: { in: orgs } }] } });
    await db.principalRoleBinding.deleteMany({ where: { orgId: { in: orgs } } });
    await db.roleProfile.deleteMany({ where: { orgId: { in: orgs } } }).catch(() => undefined);
    await db.positionTemplate.deleteMany({ where: { orgId: { in: orgs } } }).catch(() => undefined);
    await db.user.updateMany({ where: { id: { in: users } }, data: { activeOrgId: null } });
    await db.organizationMember.deleteMany({ where: { orgId: { in: orgs } } });
    await db.organization.deleteMany({ where: { id: { in: orgs } } }).catch((e) => console.warn("org cleanup:", e instanceof Error ? e.message : e));
    await db.user.deleteMany({ where: { id: { in: users } } }).catch((e) => console.warn("user cleanup:", e instanceof Error ? e.message : e));
    await db.$disconnect();
  }

  console.log(`\nPERM-6c 外贸收件人 DB 端到端：${pass} 通过，${fail} 失败`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
