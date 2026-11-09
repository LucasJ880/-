/**
 * OPS-REV 运营中心「全公司销售额」— 真实 DB 端到端（隔离库，虚构企业）
 *
 *   窗饰企业落地岗位模板 → 按岗位绑定真实成员
 *   → 取数（固定 now = 多伦多 2026-10-15 周四）：本周 / 本月至今的成单金额、成单数、报价金额；
 *     草稿、上月、非 CAD、已归档客户、其他企业的报价不计
 *   → GET /api/ops/sales-summary：运营主管 / 运营人员 / 老板 / 会计 200；销售人员 / 招投标 / 无岗位 403；
 *     响应没有客户名、销售员名、报价 id；运营人员仍不能读销售期间汇总（不多开销售分析）
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated \
 *   npx tsx src/lib/sales/period/__tests__/revenue-summary-db.isolated.test.ts
 * 无隔离库时自动跳过。只用虚构企业名。
 */
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过 OPS-REV 销售额汇总 DB 测试（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "OPS-REV sales revenue summary DB test" });
process.env.JWT_SECRET = process.env.JWT_SECRET || "ops-rev-isolated-test-secret-0123456789abcdef";

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

/** 多伦多 10 月为 UTC−4 */
const edt = (local: string) => new Date(`${local}-04:00`);
const stamp = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const ORG = `fx_opsrev_org_${stamp}`;
const ORG_X = `fx_opsrev_orgx_${stamp}`;
const U = (tag: string) => `fx_opsrev_${tag}_${stamp}`;
const OWNER = U("owner");
const OPS_LEAD = U("opslead");
const OPS_STAFF = U("opsstaff");
const REP = U("rep");
const BIDS = U("bids");
const ACCT = U("acct");
const PLAIN = U("plain");
const OUTSIDER = U("outsider");
const CUST = U("cust");
const CUST_ARCH = U("custarch");
const CUST_X = U("custx");
const CUST_NAME = "Fixture Homeowner Rivera";

async function main() {
  const { db } = await import("@/lib/db");
  const { NextRequest } = await import("next/server");
  const { createSession } = await import("@/lib/auth/session");
  const { seedOrgAuthorizationProfiles } = await import("@/lib/authorization/seed-org-profiles");
  const { loadOrgRevenueSummary } = await import("@/lib/sales/period/revenue-summary");
  const route = await import("@/app/api/ops/sales-summary/route");
  const periodRoute = await import("@/app/api/sales/period-summary/route");

  const users = [OWNER, OPS_LEAD, OPS_STAFF, REP, BIDS, ACCT, PLAIN, OUTSIDER];
  const names: Record<string, string> = { [REP]: "Fixture Rep Jordan" };
  for (const id of users) {
    await db.user.create({ data: { id, email: `${id}@fixture.test`, name: names[id] ?? `Fixture ${id.split("_")[2]}`, role: "user" } });
  }
  await db.organization.create({ data: { id: ORG, name: `Fixture Blinds ${stamp}`, code: `fx-opsrev-${stamp}`, ownerId: OWNER, industryPackId: "window_covering_services_v1" } });
  await db.organization.create({ data: { id: ORG_X, name: `Fixture Other ${stamp}`, code: `fx-opsrevx-${stamp}`, ownerId: OUTSIDER, industryPackId: "window_covering_services_v1" } });
  for (const id of users.filter((u) => u !== OUTSIDER)) {
    await db.organizationMember.create({ data: { orgId: ORG, userId: id, role: "org_member", status: "active" } });
    await db.user.update({ where: { id }, data: { activeOrgId: ORG } });
  }
  await db.organizationMember.create({ data: { orgId: ORG_X, userId: OUTSIDER, role: "org_member", status: "active" } });
  await seedOrgAuthorizationProfiles(ORG);
  await seedOrgAuthorizationProfiles(ORG_X);
  for (const [userId, key] of [
    [OWNER, "owner"],
    [OPS_LEAD, "ops_lead"],
    [OPS_STAFF, "ops_staff"],
    [REP, "sales_rep"],
    [BIDS, "bids"],
    [ACCT, "accounting"],
  ] as const) {
    const profile = await db.roleProfile.findUnique({ where: { orgId_key: { orgId: ORG, key } } });
    await db.principalRoleBinding.create({ data: { orgId: ORG, principalType: "HUMAN", principalId: userId, roleProfileId: profile!.id, status: "active" } });
  }

  await db.salesCustomer.create({ data: { id: CUST, orgId: ORG, name: CUST_NAME, createdById: REP } });
  await db.salesCustomer.create({ data: { id: CUST_ARCH, orgId: ORG, name: "Archived Homeowner", createdById: REP, archivedAt: edt("2026-10-01T09:00:00") } });
  await db.salesCustomer.create({ data: { id: CUST_X, orgId: ORG_X, name: "Other Homeowner", createdById: OUTSIDER } });
  const quoteIds: string[] = [];
  let n = 0;
  const quote = async (data: Record<string, unknown>, orgId = ORG, customerId = CUST, createdById = REP) => {
    const id = U(`q${++n}`);
    quoteIds.push(id);
    await db.salesQuote.create({ data: { id, orgId, customerId, orderNumber: `OPSREV-${n}-${stamp}`, createdById, ...data } as never });
    return id;
  };
  const QA = await quote({ status: "signed", sentAt: edt("2026-10-12T09:00:00"), signedAt: edt("2026-10-13T10:00:00"), grandTotal: 1000, preTaxTotal: 885 });
  await quote({ status: "signed", sentAt: edt("2026-10-02T09:00:00"), signedAt: edt("2026-10-03T10:00:00"), grandTotal: 2000, preTaxTotal: 1770 });
  await quote({ status: "sent", sentAt: edt("2026-10-14T09:00:00"), grandTotal: 500, preTaxTotal: 442 });
  await quote({ status: "draft", grandTotal: 7777 });
  await quote({ status: "signed", currency: "USD", sentAt: edt("2026-10-14T09:00:00"), signedAt: edt("2026-10-14T10:00:00"), grandTotal: 8888 });
  await quote({ status: "signed", sentAt: edt("2026-09-29T09:00:00"), signedAt: edt("2026-09-30T10:00:00"), grandTotal: 6666 });
  await quote({ status: "signed", sentAt: edt("2026-10-13T09:00:00"), signedAt: edt("2026-10-13T10:00:00"), grandTotal: 5555 }, ORG, CUST_ARCH);
  await quote({ status: "signed", sentAt: edt("2026-10-13T09:00:00"), signedAt: edt("2026-10-13T10:00:00"), grandTotal: 9999 }, ORG_X, CUST_X, OUTSIDER);

  const call = async (uid: string, path = "/api/ops/sales-summary", handler: unknown = route.GET) => {
    const cookie = `qy_session=${await createSession({ sub: uid, email: `${uid}@fixture.test`, role: "user" })}`;
    const r = new NextRequest(`http://localhost${path}`, { method: "GET", headers: { cookie, "x-forwarded-for": "10.43.0.9" } });
    const res = await (handler as (r: unknown, c: unknown) => Promise<Response>)(r, { params: Promise.resolve({}) });
    return { status: res.status, body: (await res.json().catch(() => null)) as Record<string, unknown> | null };
  };

  try {
    console.log("\n[1] 取数（固定 now = 2026-10-15 周四，多伦多）");
    const s = await loadOrgRevenueSummary(ORG, edt("2026-10-15T12:00:00"));
    ok(
      s.thisWeek.from === "2026-10-12" && s.thisWeek.wonCount === 1 && s.thisWeek.wonAmount === 1000 && s.thisWeek.quotedAmount === 1500 && s.thisWeek.quotedCount === 2,
      "本周：成单 1 单 $1,000、报价 $1,500（2 份）",
      s.thisWeek,
    );
    ok(
      s.monthToDate.from === "2026-10-01" && s.monthToDate.wonCount === 2 && s.monthToDate.wonAmount === 3000 && s.monthToDate.quotedAmount === 3500,
      "本月至今：成单 2 单 $3,000、报价 $3,500；草稿 / 上月 / 已归档客户 / 其他企业不计",
      s.monthToDate,
    );
    ok(s.nonCadExcludedCount === 1 && s.currency === "CAD" && s.timezone === "America/Toronto", "非 CAD 1 份不计入金额；时区为组织时区", { n: s.nonCadExcludedCount, tz: s.timezone });

    console.log("\n[2] 接口权限");
    for (const [uid, label] of [
      [OPS_LEAD, "运营主管"],
      [OPS_STAFF, "运营人员"],
      [OWNER, "老板"],
      [ACCT, "会计（已有全企业销售分析）"],
    ] as const) {
      const r = await call(uid);
      ok(r.status === 200 && !!r.body?.thisWeek && !!r.body?.monthToDate, `${label} → 200`, r);
    }
    for (const [uid, label] of [
      [REP, "销售人员（只有本人范围）"],
      [BIDS, "招投标"],
      [PLAIN, "无岗位成员"],
    ] as const) {
      const r = await call(uid);
      ok(r.status === 403 && r.body?.code === "SALES_SUMMARY_FORBIDDEN", `${label} → 403`, r);
    }

    console.log("\n[3] 只给汇总，不多开销售分析");
    const staff = await call(OPS_STAFF);
    const json = JSON.stringify(staff.body);
    ok(
      Object.keys(staff.body ?? {}).sort().join(",") === "currency,monthToDate,nonCadExcludedCount,thisWeek,timezone,truncated",
      "响应只有白名单字段",
      Object.keys(staff.body ?? {}),
    );
    ok(!json.includes(CUST_NAME) && !json.includes("Fixture Rep Jordan") && !json.includes(QA) && !json.includes(REP), "响应里没有客户名、销售员名、报价 id、销售员 id");
    const period = await call(OPS_STAFF, `/api/sales/period-summary?orgId=${ORG}&from=2026-10-01&to=2026-10-15`, periodRoute.GET);
    ok(period.status === 403, "运营人员读销售期间汇总（按人明细）→ 仍 403", period.status);
  } finally {
    await db.salesQuote.deleteMany({ where: { id: { in: quoteIds } } });
    await db.salesCustomer.deleteMany({ where: { id: { in: [CUST, CUST_ARCH, CUST_X] } } });
    await db.auditLog.deleteMany({ where: { OR: [{ userId: { in: users } }, { orgId: { in: [ORG, ORG_X] } }] } });
    await db.principalRoleBinding.deleteMany({ where: { orgId: { in: [ORG, ORG_X] } } }).catch(() => undefined);
    await db.positionTemplate.deleteMany({ where: { orgId: { in: [ORG, ORG_X] } } }).catch(() => undefined);
    await db.rolePermissionBinding.deleteMany({ where: { roleProfile: { orgId: { in: [ORG, ORG_X] } } } }).catch(() => undefined);
    await db.roleProfile.deleteMany({ where: { orgId: { in: [ORG, ORG_X] } } }).catch(() => undefined);
    await db.user.updateMany({ where: { id: { in: users } }, data: { activeOrgId: null } });
    await db.organizationMember.deleteMany({ where: { orgId: { in: [ORG, ORG_X] } } });
    await db.organization.deleteMany({ where: { id: { in: [ORG, ORG_X] } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  await db.$disconnect();
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
