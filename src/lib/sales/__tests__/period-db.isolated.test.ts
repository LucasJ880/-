/**
 * KPI-1：销售期间汇总——真实 DB（隔离库）+ 真实路由端到端（spec sales/period-summary）
 *
 *   无 sales.analytics.read → 403；参数不合法 → 400 INVALID_PERIOD；老板全企业 + 按人降序；
 *   销售只看本人且不含他人姓名与金额；跨企业不可见；归档客户 / 草稿 / 非 CAD / 期外不计；
 *   字段齐全；wonAmount 与直接 SQL 求和逐分一致。
 *   STAT-1：按人明细合计 = 按人表、草稿不出现、销售看他人 403、ORG 缺 repId 400；draftsUnsent 按范围；
 *   报价列表 createdById 筛选与 reps 名单。
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
  const drillRoute = await import("@/app/api/sales/period-summary/quotes/route");
  const listRoute = await import("@/app/api/sales/quotes/list/route");

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
  const OPP = `kpopp_${stamp}`;
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
  // STAT-1：期间内创建的草稿（A、B 各 1；归档客户 / 9 月创建的不计）
  await quote("dra", { status: "draft", createdAt: edt("2026-10-15T10:00:00"), grandTotal: 111 });
  await quote("drb", { createdById: REP_B, status: "draft", createdAt: edt("2026-10-16T10:00:00"), grandTotal: 222 });
  await quote("drarch", { customerId: CUST_ARCH, status: "draft", createdAt: edt("2026-10-17T10:00:00"), grandTotal: 333 });
  await quote("drsep", { status: "draft", createdAt: edt("2026-09-17T10:00:00"), grandTotal: 444 });
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

    console.log("\n[7] CAL-1：日历观察开启后的日程来源");
    const { toLedgerAfterData, withCalendarWatch, readCalendarWatch } = await import("@/lib/calendar-watch/pure");
    const { writeAuditLog } = await import("@/lib/audit/logger");
    const ledger = async (eventId: string, source: "member" | "website", createdLocal: string) => {
      const created = edt(createdLocal).toISOString();
      const entry = toLedgerAfterData({
        calendarId: "shared@group.calendar.google.com",
        change: { id: eventId, status: "confirmed", created, updated: created, creatorEmail: null, organizerEmail: null, summary: "量房", description: null, start: null, end: null, allDay: false, htmlLink: null, recurringEventId: null },
        kind: "created",
        baseline: false,
        attribution:
          source === "member"
            ? { source, rule: "R3", userId: REP_A, bucket: "sales", appointmentId: null }
            : { source, rule: "R2", userId: null, bucket: null, appointmentId: null },
        editedVia: null,
        diff: null,
        observedAt: new Date(),
      });
      await writeAuditLog(db, { userId: OWNER, orgId: ORG, action: "calendar.watch.observed", targetType: "google_calendar_event", targetId: `shared/${eventId}`, afterData: entry });
    };
    for (let i = 0; i < 4; i++) await ledger(`kpw${i}_${stamp}`, "website", `2026-10-${String(i + 2).padStart(2, "0")}T10:00:00`);
    for (let i = 0; i < 6; i++) await ledger(`kpm${i}_${stamp}`, "member", `2026-10-${String(i + 10).padStart(2, "0")}T10:00:00`);
    await ledger(`kpsep_${stamp}`, "member", "2026-09-30T10:00:00"); // 9 月创建 → 不计
    const off = await call(OWNER, OCT);
    ok(off.status === 200 && off.body?.calendar === null, "账本有数但未开启观察 → calendar 为 null");
    const orgRow = await db.organization.findUnique({ where: { id: ORG }, select: { settingsJson: true } });
    const enabled = { ...readCalendarWatch(orgRow?.settingsJson ?? null), enabled: true, readerUserId: OWNER, calendarIds: ["shared@group.calendar.google.com"] };
    await db.organization.update({ where: { id: ORG }, data: { settingsJson: withCalendarWatch(orgRow?.settingsJson ?? null, enabled) as object } });
    const on = await call(OWNER, OCT);
    const cal = on.body?.calendar as { bySource?: Record<string, number>; byActor?: Array<{ userId: string; created: number }> } | null;
    ok(on.status === 200 && cal?.bySource?.website === 4 && cal.bySource.member === 6 && cal.bySource.qingyan === 0 && cal.bySource.unknown === 0, "开启后 calendar.bySource：网站 4、成员 6", cal);
    ok(cal?.byActor?.length === 1 && cal.byActor[0].userId === REP_A && cal.byActor[0].created === 6, "按成员新建数", cal?.byActor);
    const ins = (on.body?.insights ?? []) as Array<{ code: string }>;
    ok(ins.some((i) => i.code === "I9_CAL_WEBSITE_SHARE"), "洞察出现 I9_CAL_WEBSITE_SHARE（4 / 10 = 40%）", ins.map((i) => i.code));
    const repView = await call(REP_A, OCT);
    ok(repView.status === 200 && repView.body?.calendar === null, "同一企业销售范围 → calendar 为 null");

    console.log("\n[8] STAT-1：按人明细、草稿提醒、报价列表按销售筛选");
    const callAt = async (handler: unknown, path: string, uid: string, query: string) => {
      const cookie = `qy_session=${await createSession({ sub: uid, email: `${uid}@fixture.test`, role: "user" })}`;
      const r = new NextRequest(`http://localhost${path}${query}`, { method: "GET", headers: { cookie, "x-forwarded-for": "10.41.0.7" } });
      const res = await (handler as Handler)(r, { params: Promise.resolve({}) });
      return { status: res.status, body: (await res.json().catch(() => null)) as Record<string, unknown> | null };
    };
    const drill = (uid: string, query: string) => callAt(drillRoute.GET, "/api/sales/period-summary/quotes", uid, query);
    type Drill = { won: Array<Record<string, unknown>> | null; quoted: Array<Record<string, unknown>> | null; totals: Record<string, number>; name: string; truncated: boolean };
    const byRepA = (o.body?.byRep ?? []).find((r) => r.userId === REP_A) as unknown as Record<string, number>;
    const da = await drill(OWNER, `${OCT}&repId=${REP_A}`);
    const dab = da.body as unknown as Drill;
    ok(da.status === 200 && dab.totals.wonCount === byRepA.wonCount && dab.totals.wonAmount === byRepA.wonAmount && dab.totals.quotedCount === byRepA.quotedCount && dab.totals.quotedAmount === byRepA.quotedAmount, "老板展开 A：小计 = 按人表 A 行", { drill: dab?.totals, byRepA });
    ok(dab.won?.length === byRepA.wonCount && dab.quoted?.length === byRepA.quotedCount, "明细条数 = 按人表条数（成单 1 + 报价 2）", { won: dab.won?.length, quoted: dab.quoted?.length });
    const allIds = [...(dab.won ?? []), ...(dab.quoted ?? [])].map((q) => String(q.quoteId));
    ok(!allIds.some((id) => id.includes("draft") || id.includes("dra")) && !allIds.some((id) => id.includes("arch") || id.includes("usd")), "草稿 / 归档客户 / 非 CAD 不出现", allIds);
    const a1 = (dab.won ?? [])[0];
    ok(a1?.orderNumber === `KP-a1-${stamp}` && a1?.customerName === "Example Homeowner" && a1?.grandTotal === 1000 && a1?.status === "signed" && a1?.pricelistVersion === null && typeof a1?.signedAt === "string", "明细行含单号、客户、金额、状态、签字时间、价表版本", a1);
    ok(dab.name === `Example ${REP_A}` && dab.truncated === false, "带姓名、未截断");
    const bOwn = await drill(REP_B, OCT);
    const bOwnBody = bOwn.body as unknown as Drill;
    ok(bOwn.status === 200 && bOwnBody.totals.wonAmount === 3000 && bOwnBody.totals.quotedAmount === 3500 && !JSON.stringify(bOwn.body).includes(REP_A), "销售 B 不带 repId → 本人明细，不含 A", bOwnBody?.totals);
    const bToA = await drill(REP_B, `${OCT}&repId=${REP_A}`);
    ok(bToA.status === 403 && bToA.body?.code === "FORBIDDEN_REP", "销售 B 看 A → 403 FORBIDDEN_REP", bToA);
    const noRep = await drill(OWNER, OCT);
    ok(noRep.status === 400 && noRep.body?.code === "INVALID_REP", "老板不带 repId → 400 INVALID_REP", noRep);
    const badKind = await drill(OWNER, `${OCT}&repId=${REP_A}&kind=all`);
    ok(badKind.status === 400 && badKind.body?.code === "INVALID_KIND", "kind 非法 → 400", badKind);
    const wonOnly = await drill(OWNER, `${OCT}&repId=${REP_A}&kind=won`);
    ok(wonOnly.status === 200 && (wonOnly.body as unknown as Drill).quoted === null && (wonOnly.body as unknown as Drill).won?.length === 1 && (wonOnly.body as unknown as Drill).totals.quotedCount === byRepA.quotedCount, "kind=won 只给成单组，小计仍全量", wonOnly.body);
    const badPeriod = await drill(OWNER, `?orgId=${ORG}&from=2026-10-28&to=2026-10-01&repId=${REP_A}`);
    ok(badPeriod.status === 400 && badPeriod.body?.code === "INVALID_PERIOD", "期间非法 → 400 INVALID_PERIOD");
    ok((await drill(PLAIN, `${OCT}&repId=${REP_A}`)).status === 403, "无分析权限 → 403");
    const xDrill = await drill(OUTSIDER, `${OCT}&repId=${REP_A}`);
    ok(!JSON.stringify(xDrill.body).includes(`KP-a1-${stamp}`) && !JSON.stringify(xDrill.body).includes("Example Homeowner"), "另一企业老板拿不到本企业明细", { status: xDrill.status });

    ok((o.body as Record<string, unknown>)?.draftsUnsent !== undefined, "汇总响应含 draftsUnsent");
    const fresh = await call(OWNER, OCT);
    ok((fresh.body?.draftsUnsent as { count: number })?.count === 2 && fresh.body?.totals?.quotedAmount === 8944, "老板 draftsUnsent = 2（A、B 各 1；归档 / 期外不计），totals 不变", fresh.body?.draftsUnsent);
    const aFresh = await call(REP_A, OCT);
    ok((aFresh.body?.draftsUnsent as { count: number })?.count === 1, "销售 A draftsUnsent = 1", aFresh.body?.draftsUnsent);

    const list = (uid: string, query: string) => callAt(listRoute.GET, "/api/sales/quotes/list", uid, query);
    type ListBody = { quotes: Array<{ id: string; createdBy?: { id?: string } }>; reps: Array<{ id: string; name: string }> };
    const lAll = await list(OWNER, `?orgId=${ORG}`);
    const lAllBody = lAll.body as unknown as ListBody;
    ok(lAll.status === 200 && lAllBody.reps.some((r) => r.id === REP_A) && lAllBody.reps.some((r) => r.id === REP_B) && lAllBody.quotes.every((q) => typeof q.createdBy?.id === "string"), "列表返回 reps（A、B）与每份的 createdBy.id", lAllBody?.reps);
    const lA = await list(OWNER, `?orgId=${ORG}&createdById=${REP_A}`);
    const lABody = lA.body as unknown as ListBody;
    ok(lA.status === 200 && lABody.quotes.length > 0 && lABody.quotes.every((q) => q.createdBy?.id === REP_A), "老板 createdById=A → 只有 A 的报价", lABody?.quotes.length);
    const lBtoA = await list(REP_B, `?orgId=${ORG}&createdById=${REP_A}`);
    const lBtoABody = lBtoA.body as unknown as ListBody;
    ok(lBtoA.status === 200 && lBtoABody.quotes.length === 0 && !lBtoABody.reps.some((r) => r.id === REP_A), "销售 B 带 createdById=A → 空，名单里也没有 A", lBtoABody);

    console.log("\n[9] STAT-1 审查修订：同商机修订跨销售、跨企业不露姓名");
    await db.salesOpportunity.create({ data: { id: OPP, orgId: ORG, customerId: CUST, title: "Shared opportunity", createdById: REP_A } });
    await quote("oa", { opportunityId: OPP, status: "sent", sentAt: edt("2026-10-11T10:00:00"), grandTotal: 600 });
    await quote("ob", { opportunityId: OPP, createdById: REP_B, status: "sent", sentAt: edt("2026-10-12T10:00:00"), grandTotal: 650 });
    const s9 = await call(OWNER, OCT);
    let quotedSum = 0;
    for (const rep of [REP_A, REP_B]) {
      const row = (s9.body?.byRep ?? []).find((r) => r.userId === rep) as unknown as Record<string, number>;
      const dd = (await drill(OWNER, `${OCT}&repId=${rep}`)).body as unknown as Drill;
      quotedSum += dd.totals.quotedCount;
      ok(dd.totals.quotedCount === row.quotedCount && dd.totals.quotedAmount === row.quotedAmount && dd.totals.wonAmount === row.wonAmount, `${rep === REP_A ? "A" : "B"}：B 修订了 A 的报价后，明细小计仍 = 按人表`, { drill: dd.totals, row });
    }
    ok(quotedSum === s9.body?.totals?.quotedCount, "各人明细报价数之和 = 全企业报价数", { quotedSum, total: s9.body?.totals?.quotedCount });
    const aOwn = await call(REP_A, OCT);
    const aOwnDrill = (await drill(REP_A, OCT)).body as unknown as Drill;
    const aOwnRow = aOwn.body?.byRep?.[0] as unknown as Record<string, number> | undefined;
    ok(aOwnRow !== undefined && aOwnDrill.totals.quotedCount === aOwnRow.quotedCount && aOwnDrill.totals.quotedAmount === aOwnRow.quotedAmount, "销售 A 本人范围：明细 = 本人面板", { drill: aOwnDrill.totals, own: aOwnRow });
    const xName = await drill(OUTSIDER, `?orgId=${ORG_X}&from=2026-10-01&to=2026-10-28&repId=${REP_A}`);
    const xNameRaw = JSON.stringify(xName.body);
    ok(xName.status === 200 && !xNameRaw.includes(`Example ${REP_A}`) && !xNameRaw.includes(`${REP_A}@fixture.test`), "另一企业老板用本企业销售的 id 查明细：不返回其姓名 / 邮箱", xName.body);
  } finally {
    await db.salesQuote.deleteMany({ where: { id: { in: quoteIds } } });
    await db.salesOpportunity.deleteMany({ where: { id: OPP } });
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
