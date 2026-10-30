/**
 * PERM-4a：销售区记录访问不因平台角色短路——真实 DB（隔离库）+ 真实路由端到端（spec sales/record-access）
 *
 *   平台 admin 无绑定读客户 403 / super_admin 200；客户归档：销售 403、老板 200（报价保留）、跨企业 404；
 *   测量记录：销售只看本人、不返回其他企业；定金：合价为他人登记 200、跨企业 404；
 *   平台 admin（持老板岗）标记超限未批报价签约 409；代设目标：销售 403、老板给企业外的人 403、老板给本企业销售 200；
 *   平台 admin 初始化知识库索引 403。
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated \
 *   npx tsx src/lib/sales/__tests__/sales-record-access-db.isolated.test.ts
 * 无隔离库时自动跳过。只用虚构数据。
 */
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过销售区记录访问 DB 测试（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "PERM-4a sales record access DB test" });

process.env.JWT_SECRET = process.env.JWT_SECRET || "perm-4a-isolated-test-secret-0123456789abcdef";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail).slice(0, 1500) : "");
  }
}

type Handler = (r: unknown, c: unknown) => Promise<Response>;

async function main() {
  const { db } = await import("@/lib/db");
  const { NextRequest } = await import("next/server");
  const { createSession } = await import("@/lib/auth/session");
  const { seedOrgAuthorizationProfiles } = await import("@/lib/authorization/seed-org-profiles");
  const customerRoute = await import("@/app/api/sales/customers/[id]/route");
  const measurementRoute = await import("@/app/api/sales/measurements/route");
  const depositRoute = await import("@/app/api/sales/quotes/[quoteId]/record-deposit/route");
  const markSignedRoute = await import("@/app/api/sales/quotes/[quoteId]/mark-signed/route");
  const homeRoute = await import("@/app/api/sales/home/route");
  const knowledgeRoute = await import("@/app/api/sales/knowledge/init/route");

  const stamp = Date.now().toString(36);
  const OWNER = `raowner_${stamp}`;
  const REP = `rarep_${stamp}`;
  const LEAD = `ralead_${stamp}`;
  const PADMIN = `rapadmin_${stamp}`; // 平台 admin + 老板岗
  const PADMIN_NB = `rapadminnb_${stamp}`; // 平台 admin、无绑定
  const OUTSIDER = `raout_${stamp}`;
  const SA = `rasa_${stamp}`;
  const ORG = `raorg_${stamp}`;
  const ORG_X = `raorgx_${stamp}`;
  const CUST = `racust_${stamp}`;
  const CUST_ARCH = `racusta_${stamp}`;
  const CUST_X = `racustx_${stamp}`;
  const Q_DEP = `raqdep_${stamp}`;
  const Q_PROMO = `raqpromo_${stamp}`;
  const users = [OWNER, REP, LEAD, PADMIN, PADMIN_NB, OUTSIDER, SA];
  const role = (id: string) => (id === SA ? "super_admin" : id === PADMIN || id === PADMIN_NB ? "admin" : "user");

  for (const id of users) {
    await db.user.create({ data: { id, email: `${id}@fixture.test`, name: `Example ${id}`, role: role(id) } });
  }
  await db.organization.create({ data: { id: ORG, name: "Example Blinds Fixture", code: `rao-${stamp}`, ownerId: OWNER, industryPackId: "window_covering_services_v1" } });
  await db.organization.create({ data: { id: ORG_X, name: "Other Blinds Fixture", code: `rax-${stamp}`, ownerId: OUTSIDER, industryPackId: "window_covering_services_v1" } });
  for (const [orgId, userId] of [[ORG, OWNER], [ORG, REP], [ORG, LEAD], [ORG, PADMIN], [ORG, PADMIN_NB], [ORG_X, OUTSIDER]] as const) {
    await db.organizationMember.create({ data: { orgId, userId, role: "org_member", status: "active" } });
  }
  await seedOrgAuthorizationProfiles(ORG);
  await seedOrgAuthorizationProfiles(ORG_X);
  const bind = async (orgId: string, userId: string, key: string) => {
    const profile = await db.roleProfile.findUnique({ where: { orgId_key: { orgId, key } } });
    const dup = await db.principalRoleBinding.findFirst({ where: { orgId, principalId: userId, roleProfileId: profile!.id } });
    if (!dup) await db.principalRoleBinding.create({ data: { orgId, principalType: "HUMAN", principalId: userId, roleProfileId: profile!.id, status: "active" } });
  };
  await bind(ORG, OWNER, "owner");
  await bind(ORG, REP, "sales_rep");
  await bind(ORG, LEAD, "pricing_lead");
  await bind(ORG, PADMIN, "owner");
  await bind(ORG_X, OUTSIDER, "owner");

  await db.salesCustomer.create({ data: { id: CUST, orgId: ORG, name: "Example Homeowner", createdById: LEAD } });
  await db.salesCustomer.create({ data: { id: CUST_ARCH, orgId: ORG, name: "Archive Homeowner", createdById: REP } });
  await db.salesCustomer.create({ data: { id: CUST_X, orgId: ORG_X, name: "Other Homeowner", createdById: OUTSIDER } });
  await db.salesQuote.create({ data: { id: Q_DEP, orgId: ORG, customerId: CUST_ARCH, status: "signed", signedAt: new Date(), orderNumber: `RAD-${stamp}`, grandTotal: 1000, createdById: REP } });
  await db.salesQuote.create({ data: { id: Q_PROMO, orgId: ORG, customerId: CUST, status: "sent", orderNumber: `RAP-${stamp}`, grandTotal: 1000, finalDiscountPct: 0.6, specialPromotion: 600, createdById: REP } });
  const mRep = await db.measurementRecord.create({ data: { customerId: CUST, measuredById: REP } });
  const mLead = await db.measurementRecord.create({ data: { customerId: CUST, measuredById: LEAD } });
  const mX = await db.measurementRecord.create({ data: { customerId: CUST_X, measuredById: OUTSIDER } });

  const call = async (handler: Handler, uid: string, url: string, method = "GET", body?: unknown, params: Record<string, string> = {}) => {
    const cookie = `qy_session=${await createSession({ sub: uid, email: `${uid}@fixture.test`, role: role(uid) })}`;
    const r = new NextRequest(`http://localhost${url}`, {
      method,
      headers: { "content-type": "application/json", cookie, "x-forwarded-for": "10.31.0.5" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const res = await handler(r, { params: Promise.resolve(params) });
    const ct = res.headers.get("content-type") || "";
    return { status: res.status, body: (ct.includes("json") ? await res.json() : null) as Record<string, unknown> | null };
  };

  try {
    console.log("\n[1] 平台角色不带隐含权限");
    const c1 = await call(customerRoute.GET as unknown as Handler, PADMIN_NB, `/api/sales/customers/${CUST}?orgId=${ORG}`, "GET", undefined, { id: CUST });
    ok(c1.status === 403, "平台 admin、无岗位、org_member 读他人客户 → 403", c1);
    const c2 = await call(customerRoute.GET as unknown as Handler, SA, `/api/sales/customers/${CUST}?orgId=${ORG}`, "GET", undefined, { id: CUST });
    ok(c2.status === 200, "平台 super_admin 带企业读客户 → 200", c2.status);
    const k1 = await call(knowledgeRoute.POST as unknown as Handler, PADMIN, `/api/sales/knowledge/init`, "POST", {});
    ok(k1.status === 403, "平台 admin 初始化销售知识库索引 → 403", k1);

    console.log("\n[2] 客户归档按 sales.customer.archive");
    const a1 = await call(customerRoute.DELETE as unknown as Handler, REP, `/api/sales/customers/${CUST_ARCH}?orgId=${ORG}`, "DELETE", undefined, { id: CUST_ARCH });
    ok(a1.status === 403 && !(await db.salesCustomer.findUnique({ where: { id: CUST_ARCH } }))?.archivedAt, "销售删除本人客户 → 403，未归档", a1);
    const a2 = await call(customerRoute.DELETE as unknown as Handler, OWNER, `/api/sales/customers/${CUST_X}?orgId=${ORG}`, "DELETE", undefined, { id: CUST_X });
    ok(a2.status === 404 && !(await db.salesCustomer.findUnique({ where: { id: CUST_X } }))?.archivedAt, "老板删除另一企业客户 → 404", a2);

    console.log("\n[3] 测量记录按企业与范围");
    const m1 = await call(measurementRoute.GET as unknown as Handler, REP, `/api/sales/measurements?orgId=${ORG}`);
    const repIds = ((m1.body?.records ?? []) as { id: string }[]).map((r) => r.id);
    ok(m1.status === 200 && repIds.includes(mRep.id) && !repIds.includes(mLead.id) && !repIds.includes(mX.id), "销售只看本人测量、且客户属于当前企业", { status: m1.status, repIds });
    const m2 = await call(measurementRoute.GET as unknown as Handler, SA, `/api/sales/measurements?orgId=${ORG}`);
    const saIds = ((m2.body?.records ?? []) as { id: string }[]).map((r) => r.id);
    ok(m2.status === 200 && saIds.includes(mRep.id) && saIds.includes(mLead.id) && !saIds.includes(mX.id), "super_admin 以企业 A 查看：含 A 全部、不含 B 的记录", { status: m2.status, saIds });
    const m3 = await call(measurementRoute.GET as unknown as Handler, PADMIN_NB, `/api/sales/measurements?orgId=${ORG}`);
    ok(m3.status === 403, "无 sales.customer.read → 403", m3.status);

    console.log("\n[4] 定金按报价改权 + 企业边界");
    const d1 = await call(depositRoute.POST as unknown as Handler, LEAD, `/api/sales/quotes/${Q_DEP}/record-deposit?orgId=${ORG}`, "POST", { amount: 300, method: "cash" }, { quoteId: Q_DEP });
    ok(d1.status === 200 && (await db.salesQuote.findUnique({ where: { id: Q_DEP } }))?.depositAmount === 300, "合价为销售的签约报价登记定金 → 200", d1);
    const d2 = await call(depositRoute.POST as unknown as Handler, OUTSIDER, `/api/sales/quotes/${Q_DEP}/record-deposit?orgId=${ORG_X}`, "POST", { amount: 999, method: "cash" }, { quoteId: Q_DEP });
    ok(d2.status === 404 && (await db.salesQuote.findUnique({ where: { id: Q_DEP } }))?.depositAmount === 300, "另一企业的人登记定金 → 404，报价未变", d2);

    console.log("\n[5] 超限未批拦截只对 super_admin 放行");
    const s1 = await call(markSignedRoute.POST as unknown as Handler, PADMIN, `/api/sales/quotes/${Q_PROMO}/mark-signed?orgId=${ORG}`, "POST", {}, { quoteId: Q_PROMO });
    ok(s1.status === 409 && s1.body?.code === "PROMOTION_APPROVAL_REQUIRED" && (await db.salesQuote.findUnique({ where: { id: Q_PROMO } }))?.status === "sent", "平台 admin（持老板岗）标记超限未批报价签约 → 409", s1);

    console.log("\n[6] 代设他人销售目标");
    const h1 = await call(homeRoute.PATCH as unknown as Handler, REP, `/api/sales/home?orgId=${ORG}`, "PATCH", { userId: LEAD, targetAmount: 5000 });
    ok(h1.status === 403, "销售替他人设目标 → 403", h1);
    const h2 = await call(homeRoute.PATCH as unknown as Handler, OWNER, `/api/sales/home?orgId=${ORG}`, "PATCH", { userId: OUTSIDER, targetAmount: 5000 });
    ok(h2.status === 403, "老板替企业外的人设目标 → 403", h2);
    const h3 = await call(homeRoute.PATCH as unknown as Handler, OWNER, `/api/sales/home?orgId=${ORG}`, "PATCH", { userId: REP, targetAmount: 8000 });
    ok(h3.status === 200, "老板替本企业销售设目标 → 200", h3);

    console.log("\n[7] 老板归档客户（报价保留）");
    const a3 = await call(customerRoute.DELETE as unknown as Handler, OWNER, `/api/sales/customers/${CUST_ARCH}?orgId=${ORG}`, "DELETE", undefined, { id: CUST_ARCH });
    const arch = await db.salesCustomer.findUnique({ where: { id: CUST_ARCH } });
    ok(a3.status === 200 && !!arch?.archivedAt && !!(await db.salesQuote.findUnique({ where: { id: Q_DEP } })), "老板归档 → 200，客户带归档时间，名下报价保留", a3);
  } finally {
    await db.measurementRecord.deleteMany({ where: { id: { in: [mRep.id, mLead.id, mX.id] } } });
    await db.salesAction.deleteMany({ where: { customerId: { in: [CUST, CUST_ARCH, CUST_X] } } }).catch(() => undefined);
    await db.auditLog.deleteMany({ where: { OR: [{ userId: { in: users } }, { orgId: { in: [ORG, ORG_X] } }] } });
    await db.notification.deleteMany({ where: { userId: { in: users } } });
    await db.salesQuote.deleteMany({ where: { id: { in: [Q_DEP, Q_PROMO] } } });
    await db.salesCustomer.deleteMany({ where: { id: { in: [CUST, CUST_ARCH, CUST_X] } } });
    await db.organizationMember.deleteMany({ where: { orgId: { in: [ORG, ORG_X] } } });
    await db.organization.deleteMany({ where: { id: { in: [ORG, ORG_X] } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.$disconnect();
  }

  console.log(`\n销售区记录访问 DB 端到端：${pass} 通过，${fail} 失败`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
