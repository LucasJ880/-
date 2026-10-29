/**
 * KPI-1：销售期间汇总——真实 DB（隔离库）+ 真实路由端到端（spec sales/period-summary）
 *
 *   无 sales.analytics.read → 403；参数不合法 → 400 INVALID_PERIOD；老板全企业 + 按人降序；
 *   销售只看本人且不含他人姓名与金额；跨企业不可见；归档客户 / 草稿 / 非 CAD / 期外不计；
 *   字段齐全；wonAmount 与直接 SQL 求和逐分一致。
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated \
 *   npx tsx src/lib/sales/__tests__/period-db.isolated.test.ts
 * 无隔离库时自动跳过。只用虚构数据。
 */
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过销售期间汇总 DB 端到端（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "KPI-1 sales period summary DB test" });

process.env.JWT_SECRET = process.env.JWT_SECRET || "kpi-1-isolated-test-secret-0123456789abcdef";

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
type Body = Record<string, unknown> & {
  scope?: string;
  totals?: Record<string, number | null>;
  byRep?: { userId: string; name: string; wonAmount: number }[];
  period?: { from: string; to: string; days: number; timezone: string };
};

/** 多伦多 10 月为 UTC−4 */
const edt = (local: string) => new Date(`${local}-04:00`);

async function main() {
  const { db } = await import("@/lib/db");
  const { NextRequest } = await import("next/server");
  const { createSession } = await import("@/lib/auth/session");
  const { seedOrgAuthorizationProfiles } = await import("@/lib/authorization/seed-org-profiles");
  const { defaultPeriod } = await import("@/lib/sales/period/summary-pure");
  const route = await import("@/app/api/sales/period-summary/route");
  const GET = route.GET as unknown as Handler;

  const stamp = Date.now().toString(36);
  const OWNER = `kpowner_${stamp}`;
  const REP_A = `kprepa_${stamp}`;
  const REP_B = `kprepb_${stamp}`;
  const PLAIN = `kpplain_${stamp}`;
  const OUTSIDER = `kpout_${stamp}`;
  const ORG = `kporg_${stamp}`;
  const ORG_X = `kporgx_${stamp}`;
  const CUST = `kpcust_${stamp}`;
  const CUST_ARCH = `kpcusta_${stamp}`;
  const CUST_X = `kpcustx_${stamp}`;
  const users = [OWNER, REP_A, REP_B, PLAIN, OUTSIDER];
  const quoteIds: string[] = [];

  for (const id of users) {
    await db.user.create({ data: { id, email: `${id}@fixture.test`, name: `Example ${id}`, role: "user" } });
  }
  await db.organization.create({ data: { id: ORG, name: "Example Shutters Fixture", code: `kpo-${stamp}`, ownerId: OWNER, industryPackId: "window_covering_services_v1" } });
  await db.organization.create({ data: { id: ORG_X, name: "Other Shutters Fixture", code: `kpx-${stamp}`, ownerId: OUTSIDER, industryPackId: "window_covering_services_v1" } });
  for (const [orgId, userId] of [[ORG, OWNER], [ORG, REP_A], [ORG, REP_B], [ORG, PLAIN], [ORG_X, OUTSIDER]] as const) {
    await db.organizationMember.create({ data: { orgId, userId, role: "org_member", status: "active" } });
  }
  await seedOrgAuthorizationProfiles(ORG);
  await seedOrgAuthorizationProfiles(ORG_X);
  const bind = async (orgId: string, userId: string, key: string) => {
    const profile = await db.roleProfile.findUnique({ where: { orgId_key: { orgId, key } } });
    await db.principalRoleBinding.create({ data: { orgId, principalType: "HUMAN", principalId: userId, roleProfileId: profile!.id, status: "active" } });
  };
  await bind(ORG, OWNER, "owner");
  await bind(ORG, REP_A, "sales_rep");
  await bind(ORG, REP_B, "sales_rep");
  await bind(ORG_X, OUTSIDER, "owner");

  await db.salesCustomer.create({ data: { id: CUST, orgId: ORG, name: "Example Homeowner", createdById: REP_A } });
  await db.salesCustomer.create({ data: { id: CUST_ARCH, orgId: ORG, name: "Archived Homeowner", createdById: REP_A, archivedAt: new Date("2026-10-20T12:00:00Z") } });
  await db.salesCustomer.create({ data: { id: CUST_X, orgId: ORG_X, name: "Other Homeowner", createdById: OUTSIDER } });

  const quote = async (tag: string, data: Record<string, unknown>) => {
    const id = `kpq${tag}_${stamp}`;
    quoteIds.push(id);
    await db.salesQuote.create({ data: { id, orgId: ORG, customerId: CUST, orderNumber: `KP-${tag}-${stamp}`, createdById: REP_A, ...data } as never });
  };
  // 计入：A 签 1,000；B 签 3,000；B 报出未签 500
  await quote("a1", { status: "signed", sentAt: edt("2026-10-04T10:00:00"), signedAt: edt("2026-10-05T10:00:00"), grandTotal: 1000, preTaxTotal: 885 });
  await quote("b1", { createdById: REP_B, status: "signed", sentAt: edt("2026-10-05T10:00:00"), signedAt: edt("2026-10-06T10:00:00"), grandTotal: 3000, preTaxTotal: 2655 });
  await quote("b2", { createdById: REP_B, status: "sent", sentAt: edt("2026-10-07T10:00:00"), grandTotal: 500, preTaxTotal: 442.48 });
  // 不计成单：归档客户 / 美元 / 草稿 / 当地 10/29 签（但 10/28 发出，计报价）/ 9 月签（只进对比期）
  await quote("arch", { customerId: CUST_ARCH, status: "signed", sentAt: edt("2026-10-07T10:00:00"), signedAt: edt("2026-10-08T10:00:00"), grandTotal: 7777 });
  await quote("usd", { status: "signed", currency: "USD", sentAt: edt("2026-10-08T10:00:00"), signedAt: edt("2026-10-09T10:00:00"), grandTotal: 8888 });
  await quote("draft", { status: "draft", sentAt: edt("2026-10-03T10:00:00"), grandTotal: 6666 });
  await quote("late", { status: "signed", sentAt: edt("2026-10-28T09:00:00"), signedAt: edt("2026-10-29T01:00:00"), grandTotal: 4444 });
  await quote("sep", { status: "signed", sentAt: edt("2026-09-10T10:00:00"), signedAt: edt("2026-09-12T10:00:00"), grandTotal: 2000 });
  const QX = `kpqx_${stamp}`;
  quoteIds.push(QX);
  await db.salesQuote.create({ data: { id: QX, orgId: ORG_X, customerId: CUST_X, orderNumber: `KPX-${stamp}`, createdById: OUTSIDER, status: "signed", sentAt: edt("2026-10-04T10:00:00"), signedAt: edt("2026-10-05T10:00:00"), grandTotal: 9999 } });

  const call = async (uid: string, query: string) => {
    const cookie = `qy_session=${await createSession({ sub: uid, email: `${uid}@fixture.test`, role: "user" })}`;
    const r = new NextRequest(`http://localhost/api/sales/period-summary${query}`, { method: "GET", headers: { cookie, "x-forwarded-for": "10.41.0.7" } });
    const res = await GET(r, { params: Promise.resolve({}) });
    const ct = res.headers.get("content-type") || "";
    return { status: res.status, body: (ct.includes("json") ? await res.json() : null) as Body | null };
  };
  const OCT = `?orgId=${ORG}&from=2026-10-01&to=2026-10-28`;

  try {
    console.log("\n[1] 授权");
    const p1 = await call(PLAIN, OCT);
    ok(p1.status === 403, "无 sales.analytics.read 的成员 → 403", p1);

    console.log("\n[2] 参数校验");
    for (const [label, q] of [
      ["to 早于 from", `?orgId=${ORG}&from=2026-10-28&to=2026-10-01`],
      ["跨度 367 天", `?orgId=${ORG}&from=2025-01-01&to=2026-01-02`],
      ["spec 场景 2025-01-01..2026-06-30", `?orgId=${ORG}&from=2025-01-01&to=2026-06-30`],
      ["compare=x", `${OCT}&compare=x`],
      ["只给 from", `?orgId=${ORG}&from=2026-10-01`],
      ["格式 2026/10/01", `?orgId=${ORG}&from=2026/10/01&to=2026-10-28`],
    ] as const) {
      const r = await call(OWNER, q);
      ok(r.status === 400 && r.body?.code === "INVALID_PERIOD", `${label} → 400 INVALID_PERIOD`, r);
    }

    console.log("\n[3] 老板：全企业");
    const o = await call(OWNER, OCT);
    const t = o.body?.totals ?? {};
    ok(o.status === 200 && o.body?.scope === "org", "老板 → 200、scope=org", o.status);
    ok(t.wonCount === 2 && t.wonAmount === 4000 && t.wonPreTax === 3540, "成单 2 单 4,000（排除归档 / 美元 / 草稿 / 期外）", t);
    // late 单 10/28 当地发出、10/29 才签：计入"报出去"，不计成单
    ok(t.quotedCount === 4 && t.quotedAmount === 8944, "报价 4 份 8,944（含 10/28 发出、10/29 才签的 late 单）", t);
    ok(t.openQuotedCount === 1 && t.openQuotedAmount === 500, "在手未签 1 份 500", t);
    ok(t.nonCadExcludedCount === 1, "非 CAD 1 份被排除并计数", t);
    const reps = o.body?.byRep ?? [];
    ok(reps.length === 2 && reps[0].userId === REP_B && reps[0].wonAmount === 3000 && reps[1].userId === REP_A, "byRep 两行按成单金额降序", reps);
    ok(reps[0].name === `Example ${REP_B}`, "byRep 带姓名", reps[0]);
    const cmp = o.body?.comparison as { kind: string; period: { from: string; to: string }; totals: Record<string, number> } | undefined;
    ok(cmp?.kind === "prev_period" && cmp.period.from === "2026-09-03" && cmp.period.to === "2026-09-30" && cmp.totals.wonAmount === 2000, "对比期 9/3–9/30 同口径（9 月签 2,000）", cmp);
    const keys = ["period", "scope", "totals", "comparison", "byRep", "insights", "calendar", "narrative", "truncated"];
    ok(keys.every((k) => o.body && k in o.body) && o.body?.calendar === null && o.body?.narrative === null && o.body?.truncated === false, "响应字段齐全；calendar / narrative 为 null；truncated=false", Object.keys(o.body ?? {}));
    ok(o.body?.period?.days === 28 && o.body?.period?.timezone === "America/Toronto", "period.days=28，未设时区按多伦多", o.body?.period);
    const totalKeys = ["wonCount", "wonAmount", "wonPreTax", "quotedCount", "quotedAmount", "conversionRate", "openQuotedCount", "openQuotedAmount", "staleOpenCount", "staleOpenAmount", "depositAmount", "wonWithoutDepositCount", "wonWithoutDepositAmount", "nonCadExcludedCount"];
    ok(totalKeys.every((k) => k in t), "totals 含 spec 列出的全部键", Object.keys(t));

    const sql = await db.$queryRaw<{ s: number | null }[]>`
      SELECT SUM(q."grandTotal")::float8 AS s
      FROM "SalesQuote" q JOIN "SalesCustomer" c ON c.id = q."customerId"
      WHERE q."orgId" = ${ORG} AND q.status IN ('signed', 'accepted') AND q.currency = 'CAD'
        AND c."archivedAt" IS NULL
        AND q."signedAt" >= ${new Date("2026-10-01T04:00:00Z")} AND q."signedAt" < ${new Date("2026-10-29T04:00:00Z")}`;
    ok(Math.round((sql[0]?.s ?? 0) * 100) === Math.round((t.wonAmount ?? -1) * 100), "wonAmount 与直接 SQL 求和逐分一致", { sql: sql[0]?.s, api: t.wonAmount });

    console.log("\n[4] 销售：只看本人");
    const a = await call(REP_A, OCT);
    const raw = JSON.stringify(a.body);
    ok(a.status === 200 && a.body?.scope === "own" && a.body?.totals?.wonAmount === 1000 && a.body?.totals?.quotedCount === 2 && a.body?.totals?.quotedAmount === 5444, "sales_rep → scope=own，只含本人（成单 1,000；报价 a1 + late）", a.body?.totals);
    ok((a.body?.byRep ?? []).length === 1 && a.body?.byRep?.[0].userId === REP_A, "byRep 只有本人一行", a.body?.byRep);
    ok(!raw.includes(REP_B) && !raw.includes("3000") && !raw.includes("Example kprepb"), "响应 JSON 不含他人 id、姓名与金额");
    ok(!raw.includes("I5_REP_SILENT") && !raw.includes("I6_REP_CONCENTRATION"), "销售范围不含团队洞察");

    console.log("\n[5] 跨企业");
    const x1 = await call(OUTSIDER, OCT);
    const xraw = JSON.stringify(x1.body);
    ok(!xraw.includes("4000") && !xraw.includes(REP_A) && !xraw.includes(REP_B), "另一企业老板显式带本企业 orgId：拿不到本企业数字", { status: x1.status });
    const x2 = await call(OUTSIDER, `?orgId=${ORG_X}&from=2026-10-01&to=2026-10-28`);
    ok(x2.status === 200 && x2.body?.totals?.wonAmount === 9999, "另一企业老板看自己企业 → 只有 9,999", x2.body?.totals);

    console.log("\n[6] 缺省期间");
    const d = await call(OWNER, `?orgId=${ORG}`);
    const exp = defaultPeriod(new Date(), "America/Toronto");
    ok(d.status === 200 && d.body?.period?.from === exp.from && d.body?.period?.to === exp.to, "不带 from / to = 当地本月 1 日至今天", d.body?.period);
  } finally {
    await db.salesQuote.deleteMany({ where: { id: { in: quoteIds } } });
    await db.salesCustomer.deleteMany({ where: { id: { in: [CUST, CUST_ARCH, CUST_X] } } });
    await db.auditLog.deleteMany({ where: { OR: [{ userId: { in: users } }, { orgId: { in: [ORG, ORG_X] } }] } });
    await db.principalRoleBinding.deleteMany({ where: { orgId: { in: [ORG, ORG_X] } } }).catch(() => undefined);
    await db.roleProfile.deleteMany({ where: { orgId: { in: [ORG, ORG_X] } } }).catch(() => undefined);
    await db.organizationMember.deleteMany({ where: { orgId: { in: [ORG, ORG_X] } } });
    await db.organization.deleteMany({ where: { id: { in: [ORG, ORG_X] } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.$disconnect();
  }

  console.log(`\n销售期间汇总 DB 端到端：${pass} 通过，${fail} 失败`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
