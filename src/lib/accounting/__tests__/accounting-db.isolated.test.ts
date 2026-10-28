/**
 * PERM-5a：会计视图——真实 DB（隔离库）+ 真实路由端到端
 *
 *   成交与提成（销售 403 / 招投标 403 / 会计 200 按人分组、无 costPrice / 联系方式；与本人提成接口同口径；
 *   CSV 导出 + 审计 accounting.export；月份非法 400）；报价过程（审批轨迹、按销售过滤、无敏感字段）；
 *   项目结算（财务关闭 available:false；会计看全部、招投标只看参与的、销售 403）。
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated \
 *   npx tsx src/lib/accounting/__tests__/accounting-db.isolated.test.ts
 * 无隔离库时自动跳过。只用虚构数据。
 */
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过 PERM-5a 会计视图 DB 测试（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "PERM-5a accounting DB test" });

process.env.JWT_SECRET = process.env.JWT_SECRET || "perm-5a-isolated-test-secret-0123456789abcdef";

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

type Handler = (r: unknown, c: unknown) => Promise<Response>;

async function main() {
  const { db } = await import("@/lib/db");
  const { NextRequest } = await import("next/server");
  const { createSession } = await import("@/lib/auth/session");
  const { seedOrgAuthorizationProfiles } = await import("@/lib/authorization/seed-org-profiles");
  const salesSummaryRoute = await import("@/app/api/accounting/sales-summary/route");
  const quotesRoute = await import("@/app/api/accounting/quotes/route");
  const projectsRoute = await import("@/app/api/accounting/projects/route");
  const commissionRoute = await import("@/app/api/sales/commission-summary/route");

  const stamp = Date.now().toString(36);
  const BOSS = `acboss_${stamp}`;
  const ALEX = `acalex_${stamp}`;
  const LYNN = `aclynn_${stamp}`;
  const MIKI = `acmiki_${stamp}`;
  const BIDS = `acbids_${stamp}`;
  const ORG = `acorg_${stamp}`;
  const users = [BOSS, ALEX, LYNN, MIKI, BIDS];
  const roleOf: Record<string, string> = { [BOSS]: "user", [ALEX]: "sales", [LYNN]: "sales", [MIKI]: "user", [BIDS]: "user" };
  for (const id of users) {
    await db.user.create({ data: { id, email: `${id}@fixture.test`, name: `Example ${id.split("_")[0]}`, role: roleOf[id] } });
  }
  await db.organization.create({ data: { id: ORG, name: "Example Accounting Fixture", code: `aco-${stamp}`, ownerId: BOSS, industryPackId: "window_covering_services_v1" } });
  for (const id of users) {
    await db.organizationMember.create({ data: { orgId: ORG, userId: id, role: "org_member", status: "active" } });
  }
  await seedOrgAuthorizationProfiles(ORG);
  const bind = async (userId: string, key: string) => {
    const profile = await db.roleProfile.findUnique({ where: { orgId_key: { orgId: ORG, key } } });
    await db.principalRoleBinding.create({ data: { orgId: ORG, principalType: "HUMAN", principalId: userId, roleProfileId: profile!.id, status: "active" } });
  };
  await bind(BOSS, "owner");
  await bind(ALEX, "sales_rep");
  await bind(LYNN, "sales_rep");
  await bind(MIKI, "accounting");
  await bind(BIDS, "bids");

  const cust = await db.salesCustomer.create({
    data: { orgId: ORG, name: "Example Homeowner", phone: "416-555-0100", email: "homeowner@fixture.test", address: "1 Example St", createdById: ALEX },
  });
  const now = new Date();
  const quote = async (createdById: string, grandTotal: number, items: Array<{ price: number; costPrice: number | null }>, extra: Record<string, unknown> = {}) =>
    db.salesQuote.create({
      data: {
        orgId: ORG,
        customerId: cust.id,
        status: "signed",
        signedAt: now,
        grandTotal,
        preTaxTotal: grandTotal / 1.13,
        createdById,
        notes: "internal note fixture",
        shareToken: `tok_${createdById}_${grandTotal}_${stamp}`,
        items: { create: items.map((it) => ({ product: "Zebra", fabric: "Light Filtering", widthIn: 30, heightIn: 60, price: it.price, costPrice: it.costPrice })) },
        ...extra,
      },
    });
  await quote(ALEX, 1130, [{ price: 500, costPrice: 300 }, { price: 500, costPrice: null }]);
  await quote(ALEX, 565, [{ price: 500, costPrice: 200 }], {
    promotionApprovalStatus: "approved",
    promotionApprovalRatio: 0.42,
    promotionApprovalMaxPct: 0.35,
    promotionApprovalRequestedAt: now,
    promotionApprovedAt: now,
    promotionApprovedById: BOSS,
    finalDiscountPct: 0.42,
  });
  await quote(LYNN, 2260, [{ price: 2000, costPrice: 1500 }]);
  await quote(LYNN, 300, [{ price: 265, costPrice: null }], { status: "draft", signedAt: null });

  const projAll = await db.project.create({ data: { name: "Fixture Tender A", ownerId: BOSS, orgId: ORG } });
  const projBids = await db.project.create({ data: { name: "Fixture Tender B", ownerId: BOSS, orgId: ORG } });
  const projOther = await db.project.create({ data: { name: "Fixture Tender C", ownerId: BOSS, orgId: ORG } });
  await db.projectMember.create({ data: { projectId: projBids.id, userId: BIDS, role: "operator", status: "active" } });
  const projectIds = [projAll.id, projBids.id, projOther.id];

  const call = async (handler: Handler, uid: string, url: string) => {
    const cookie = `qy_session=${await createSession({ sub: uid, email: `${uid}@fixture.test`, role: roleOf[uid] })}`;
    const sep = url.includes("?") ? "&" : "?";
    const r = new NextRequest(`http://localhost${url}${sep}orgId=${ORG}`, { headers: { cookie, "x-forwarded-for": "10.31.0.7" } });
    const res = await handler(r, { params: Promise.resolve({}) });
    const ct = res.headers.get("content-type") || "";
    const text = await res.text();
    return { status: res.status, ct, text, body: (ct.includes("json") ? JSON.parse(text) : null) as Record<string, unknown> | null };
  };
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  try {
    console.log("\n[1] 成交与提成");
    const s0 = await call(salesSummaryRoute.GET as unknown as Handler, ALEX, `/api/accounting/sales-summary`);
    ok(s0.status === 403, "销售请求全员汇总 → 403", s0.status);
    const s0b = await call(salesSummaryRoute.GET as unknown as Handler, BIDS, `/api/accounting/sales-summary`);
    ok(s0b.status === 403, "招投标请求全员汇总 → 403（看不到销售成交）", s0b.status);
    const s1 = await call(salesSummaryRoute.GET as unknown as Handler, MIKI, `/api/accounting/sales-summary?month=${month}`);
    const rows = (s1.body?.bySales ?? []) as Array<Record<string, number | string>>;
    const alex = rows.find((r) => r.salesUserId === ALEX);
    const lynn = rows.find((r) => r.salesUserId === LYNN);
    ok(s1.status === 200 && rows.length === 2, "会计 → 200，按销售分组 2 人", s1.body);
    ok(alex?.quotesSigned === 2 && alex?.signedAmount === 1695 && alex?.realMargin === 500 && alex?.realCommission === 150, "Alex：2 单、成交 1695、毛利 500、提成 150", alex);
    ok(lynn?.quotesSigned === 1 && lynn?.signedAmount === 2260 && lynn?.realMargin === 500, "Lynn：draft 不计，1 单、毛利 500", lynn);
    ok(alex?.salesName === "Example acalex", "分组带销售姓名", alex?.salesName);
    ok(!/costPrice|homeowner@|416-555|Example St/.test(s1.text), "响应不含 costPrice / 客户联系方式");
    const mine = await call(commissionRoute.GET as unknown as Handler, ALEX, `/api/sales/commission-summary`);
    ok(
      mine.status === 200 && mine.body?.quotesSigned === alex?.quotesSigned && mine.body?.realMargin === alex?.realMargin && mine.body?.realCommission === alex?.realCommission && mine.body?.itemsCosted === alex?.itemsCosted,
      "Alex 本人提成接口与会计汇总同口径",
      { mine: mine.body, alex },
    );
    const bad = await call(salesSummaryRoute.GET as unknown as Handler, MIKI, `/api/accounting/sales-summary?month=2026-13`);
    ok(bad.status === 400, "月份非法 → 400", bad.status);
    const before = await db.auditLog.count({ where: { orgId: ORG, action: "accounting.export" } });
    const csv = await call(salesSummaryRoute.GET as unknown as Handler, MIKI, `/api/accounting/sales-summary?month=${month}&format=csv`);
    ok(csv.status === 200 && csv.ct.startsWith("text/csv") && csv.text.includes("Example acalex") && !/costPrice/.test(csv.text), "导出 CSV → text/csv，含销售行，无成本", { status: csv.status, ct: csv.ct });
    const audit = await db.auditLog.findFirst({ where: { orgId: ORG, action: "accounting.export" }, orderBy: { createdAt: "desc" } });
    ok((await db.auditLog.count({ where: { orgId: ORG, action: "accounting.export" } })) === before + 1 && audit?.userId === MIKI && audit?.targetId === month, "导出写审计 accounting.export（导出人、月份）", audit);
    const boss = await call(salesSummaryRoute.GET as unknown as Handler, BOSS, `/api/accounting/sales-summary?month=${month}`);
    ok(boss.status === 200, "老板（owner 含 accounting.read）→ 200", boss.status);

    console.log("\n[2] 报价过程");
    const q0 = await call(quotesRoute.GET as unknown as Handler, ALEX, `/api/accounting/quotes`);
    ok(q0.status === 403, "销售请求报价过程 → 403", q0.status);
    const q1 = await call(quotesRoute.GET as unknown as Handler, MIKI, `/api/accounting/quotes?month=${month}`);
    const qs = (q1.body?.quotes ?? []) as Array<Record<string, unknown>>;
    ok(q1.status === 200 && qs.length === 4, "会计 → 200，本月 4 张报价（含 draft）", qs.length);
    const approved = qs.find((q) => (q.approval as Record<string, unknown>).status === "approved");
    ok(!!approved && (approved.approval as Record<string, unknown>).approvedByName === "Example acboss" && !!(approved.approval as Record<string, unknown>).approvedAt, "超限审批轨迹：已批准、批准人姓名与时间", approved);
    ok(qs.every((q) => q.customerName === "Example Homeowner"), "客户只给名称");
    ok(!/costPrice|shareToken|signatureUrl|phone|email|internal note|homeowner@|416-555/.test(q1.text), "响应不含成本 / 令牌 / 签名 / 联系方式 / 备注");
    const q2 = await call(quotesRoute.GET as unknown as Handler, MIKI, `/api/accounting/quotes?month=${month}&salesId=${LYNN}`);
    ok(q2.status === 200 && ((q2.body?.quotes ?? []) as Array<Record<string, unknown>>).every((q) => q.salesUserId === LYNN) && ((q2.body?.quotes ?? []) as unknown[]).length === 2, "按销售过滤 → 只返回 Lynn 的 2 张");
    const q3 = await call(quotesRoute.GET as unknown as Handler, MIKI, `/api/accounting/quotes?month=${month}&status=signed`);
    ok(q3.status === 200 && ((q3.body?.quotes ?? []) as unknown[]).length === 3, "按状态过滤 signed → 3 张");

    console.log("\n[3] 项目结算");
    delete process.env.TENDER_FINANCIAL_CONTROL_ENABLED;
    const p0 = await call(projectsRoute.GET as unknown as Handler, MIKI, `/api/accounting/projects`);
    ok(p0.status === 200 && p0.body?.available === false && (p0.body?.projects as unknown[]).length === 0, "财务控制关闭 → 200 + available:false + 空列表", p0.body);
    process.env.TENDER_FINANCIAL_CONTROL_ENABLED = "true";
    const p1 = await call(projectsRoute.GET as unknown as Handler, MIKI, `/api/accounting/projects`);
    const plist = (p1.body?.projects ?? []) as Array<Record<string, unknown>>;
    ok(p1.status === 200 && p1.body?.scope === "ORG" && plist.length === 3, "会计 → ORG，3 个项目", p1.body);
    const keys = plist[0] ? Object.keys(plist[0]).sort().join(",") : "";
    ok(!/expense|receipt|payment|vendor/i.test(keys) && keys.includes("totalCostCad") && keys.includes("settlementStatus"), "只含汇总字段", keys);
    const p2 = await call(projectsRoute.GET as unknown as Handler, BIDS, `/api/accounting/projects`);
    const blist = (p2.body?.projects ?? []) as Array<Record<string, unknown>>;
    ok(p2.status === 200 && p2.body?.scope === "ASSIGNED" && blist.length === 1 && blist[0].id === projBids.id, "招投标 → ASSIGNED，只返回参与的 1 个项目", p2.body);
    const p3 = await call(projectsRoute.GET as unknown as Handler, ALEX, `/api/accounting/projects`);
    ok(p3.status === 403, "销售请求项目结算 → 403", p3.status);
    const p4 = await call(projectsRoute.GET as unknown as Handler, MIKI, `/api/accounting/projects?quarter=2026-Q9`);
    ok(p4.status === 400, "季度非法 → 400", p4.status);
    const y = now.getFullYear();
    const qn = Math.floor(now.getMonth() / 3) + 1;
    const p5 = await call(projectsRoute.GET as unknown as Handler, MIKI, `/api/accounting/projects?quarter=${y}-Q${qn}`);
    ok(p5.status === 200 && ((p5.body?.projects ?? []) as unknown[]).length === 3, "本季度（按创建时间）→ 3 个项目", p5.body?.projects);
    const p6 = await call(projectsRoute.GET as unknown as Handler, MIKI, `/api/accounting/projects?quarter=${y - 5}-Q1`);
    ok(p6.status === 200 && ((p6.body?.projects ?? []) as unknown[]).length === 0, "五年前季度 → 0 个项目");
  } finally {
    delete process.env.TENDER_FINANCIAL_CONTROL_ENABLED;
    await db.salesQuoteItem.deleteMany({ where: { quote: { orgId: ORG } } });
    await db.salesQuote.deleteMany({ where: { orgId: ORG } });
    await db.salesCustomer.deleteMany({ where: { orgId: ORG } });
    await db.projectMember.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.project.deleteMany({ where: { id: { in: projectIds } } }).catch((e) => console.warn("project cleanup:", e instanceof Error ? e.message : e));
    await db.auditLog.deleteMany({ where: { OR: [{ userId: { in: users } }, { orgId: ORG }] } });
    await db.principalRoleBinding.deleteMany({ where: { orgId: ORG } });
    await db.roleProfile.deleteMany({ where: { orgId: ORG } }).catch(() => undefined);
    await db.organizationMember.deleteMany({ where: { orgId: ORG } });
    await db.organization.deleteMany({ where: { id: ORG } }).catch((e) => console.warn("org cleanup:", e instanceof Error ? e.message : e));
    await db.user.deleteMany({ where: { id: { in: users } } }).catch((e) => console.warn("user cleanup:", e instanceof Error ? e.message : e));
    await db.$disconnect();
  }

  console.log(`\nPERM-5a 会计视图 DB 端到端：${pass} 通过，${fail} 失败`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
