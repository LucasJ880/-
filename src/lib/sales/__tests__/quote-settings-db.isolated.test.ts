/**
 * PRICE-1：企业设置 JSON 里的折扣（fauxwood / allusion）走同一条审批链——真实 DB（隔离库）+ 真实路由 / 执行器端到端
 *
 *   老板 PUT {fauxwood:0.25} → 202、settingsJson 未变、审批 diff 含 fauxwood=0.25；
 *   另一位老板批准 → pricing.discounts.fauxwood=0.25，其它键（sunnyWarranty / calendarWatch）原样，版本加一；
 *   PUT {allusion:1.5} → 400 不建审批；GET 含 fauxwood / allusion；
 *   super_admin PUT {allusion:0.4} → 200 直接生效，预览 Allusion 行按 40% 计价；
 *   POST /api/sales/quotes 落库 formDataJson.pricelistVersion = 2026-10-28，Allusion 行按企业折扣计价。
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated \
 *   npx tsx src/lib/sales/__tests__/quote-settings-db.isolated.test.ts
 * 无隔离库时自动跳过。只用虚构数据。
 */
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过价表折扣设置审批 DB 测试（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "PRICE-1 quote settings JSON discounts DB test" });

process.env.JWT_SECRET = process.env.JWT_SECRET || "price-1-isolated-test-secret-0123456789abcdef";

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

async function main() {
  const { db } = await import("@/lib/db");
  const { NextRequest } = await import("next/server");
  const { createSession } = await import("@/lib/auth/session");
  const settingsRoute = await import("@/app/api/sales/quote-settings/discounts/route");
  const previewRoute = await import("@/app/api/sales/quotes/preview/route");
  const quotesRoute = await import("@/app/api/sales/quotes/route");
  const { executePendingAction } = await import("@/lib/pending-actions/executor");
  const { seedOrgAuthorizationProfiles } = await import("@/lib/authorization/seed-org-profiles");
  const { loadDiscounts } = await import("@/lib/blinds/discount-settings");
  const { priceFor } = await import("@/lib/blinds/pricing-engine");

  const stamp = Date.now().toString(36);
  const BOSS_A = `plbossa_${stamp}`;
  const BOSS_B = `plbossb_${stamp}`;
  const SA = `plsa_${stamp}`;
  const REP = `plrep_${stamp}`;
  const ORG = `plorg_${stamp}`;
  const CUST = `plcust_${stamp}`;
  const users = [BOSS_A, BOSS_B, SA, REP];

  for (const id of users) {
    await db.user.create({ data: { id, email: `${id}@fixture.test`, name: `Example ${id}`, role: id === SA ? "super_admin" : "user" } });
  }
  await db.organization.create({
    data: {
      id: ORG, name: "Example Blinds Fixture", code: `plo-${stamp}`, ownerId: BOSS_A, industryPackId: "window_covering_services_v1",
      settingsJson: { sunnyWarranty: { fixture: true }, calendarWatch: { enabled: false }, pricing: { leadMaxPct: 0.4 } },
    },
  });
  for (const userId of [BOSS_A, BOSS_B, SA, REP]) {
    await db.organizationMember.create({ data: { orgId: ORG, userId, role: "org_member", status: "active" } });
  }
  await seedOrgAuthorizationProfiles(ORG);
  const bind = async (userId: string, key: string) => {
    const profile = await db.roleProfile.findUnique({ where: { orgId_key: { orgId: ORG, key } } });
    await db.principalRoleBinding.create({ data: { orgId: ORG, principalType: "HUMAN", principalId: userId, roleProfileId: profile!.id, status: "active" } });
  };
  await bind(BOSS_A, "owner");
  await bind(BOSS_B, "owner");
  await bind(REP, "sales_rep");
  await db.salesCustomer.create({ data: { id: CUST, orgId: ORG, name: "Example Homeowner", createdById: REP } });

  const cookie = async (id: string) => `qy_session=${await createSession({ sub: id, email: `${id}@fixture.test`, role: id === SA ? "super_admin" : "user" })}`;
  const call = async (handler: unknown, uid: string, method: string, url: string, body?: Record<string, unknown>) => {
    const r = new NextRequest(`http://localhost${url}`, {
      method,
      headers: { "content-type": "application/json", cookie: await cookie(uid), "x-forwarded-for": "10.31.0.4", "x-org-id": ORG },
      ...(body ? { body: JSON.stringify({ orgId: ORG, ...body }) } : {}),
    });
    const res = await (handler as (r: unknown, c: unknown) => Promise<Response>)(r, { params: Promise.resolve({}) });
    return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
  };
  const settingsJson = async () => (await db.organization.findUnique({ where: { id: ORG }, select: { settingsJson: true } }))?.settingsJson as Record<string, unknown> | null;
  const approve = (actionId: string, uid: string, role = "user") =>
    executePendingAction(actionId.replace(/^PENDING_ACTION:/, ""), { userId: uid, role, orgId: ORG });
  const quoteIds: string[] = [];

  try {
    console.log("\n[1] GET 含 fauxwood / allusion 默认值");
    const g0 = await call(settingsRoute.GET, BOSS_A, "GET", `/api/sales/quote-settings/discounts?orgId=${ORG}`);
    ok(g0.status === 200 && g0.body.fauxwood === 0.3 && g0.body.allusion === 0.35, "GET 默认 fauxwood 0.30 / allusion 0.35", g0.body);
    const d0 = await loadDiscounts(ORG);
    ok(d0.Fauxwood === 0.3 && d0.Allusion === 0.35 && d0.Zebra === 0.45, "loadDiscounts 合并视图默认值", d0);

    console.log("\n[2] 老板 A PUT {fauxwood:0.25} → 202，settingsJson 未变");
    const p1 = await call(settingsRoute.PUT, BOSS_A, "PUT", `/api/sales/quote-settings/discounts?orgId=${ORG}`, { fauxwood: 0.25 });
    ok(p1.status === 202 && typeof p1.body.approvalId === "string" && String(p1.body.summary).includes("fauxwood=0.25"), "202 + 审批摘要含 fauxwood=0.25", p1.body);
    const sj1 = await settingsJson();
    ok(!(sj1?.pricing as Record<string, unknown> | undefined)?.discounts, "提交后 settingsJson.pricing.discounts 仍不存在", sj1);
    const action1 = await db.pendingAction.findUnique({ where: { id: String(p1.body.approvalId).replace(/^PENDING_ACTION:/, "") } });
    ok(action1?.type === "sales.update_quote_settings" && action1.approverUserId === BOSS_B, "审批类型正确，收件人是另一位老板", action1?.approverUserId);

    console.log("\n[3] 老板 B 批准 → 只动 pricing.discounts 子键，版本加一");
    const vBefore = (await db.quoteDiscountSettings.findUnique({ where: { orgId: ORG } }))?.version ?? 0;
    const e1 = await approve(String(p1.body.approvalId), BOSS_B);
    ok(e1.ok === true, "批准执行成功", e1);
    const sj2 = await settingsJson();
    const pricing2 = sj2?.pricing as Record<string, unknown>;
    ok((pricing2?.discounts as Record<string, number>)?.fauxwood === 0.25, "pricing.discounts.fauxwood = 0.25", sj2);
    ok(pricing2?.leadMaxPct === 0.4 && (sj2?.sunnyWarranty as Record<string, unknown>)?.fixture === true && (sj2?.calendarWatch as Record<string, unknown>)?.enabled === false, "leadMaxPct / sunnyWarranty / calendarWatch 原样保留", sj2);
    const vAfter = (await db.quoteDiscountSettings.findUnique({ where: { orgId: ORG } }))?.version ?? 0;
    ok(vAfter === vBefore + 1, `设置版本 ${vBefore} → ${vAfter}`);
    const g1 = await call(settingsRoute.GET, BOSS_A, "GET", `/api/sales/quote-settings/discounts?orgId=${ORG}`);
    ok(g1.body.fauxwood === 0.25 && g1.body.allusion === 0.35, "GET 反映新值", g1.body);
    const audit = await db.auditLog.findFirst({ where: { orgId: ORG, action: "quote_settings_updated" }, orderBy: { createdAt: "desc" } });
    ok(!!audit && String(audit.afterData).includes("fauxwood") && String(audit.afterData).includes(BOSS_B), "审计含新键与批准人", audit?.afterData);

    console.log("\n[4] 非法值 → 400，不建审批");
    const countBefore = await db.pendingAction.count({ where: { orgId: ORG } });
    const p2 = await call(settingsRoute.PUT, BOSS_A, "PUT", `/api/sales/quote-settings/discounts?orgId=${ORG}`, { allusion: 1.5 });
    ok(p2.status === 400 && (await db.pendingAction.count({ where: { orgId: ORG } })) === countBefore, "allusion=1.5 → 400 且无新审批", p2.body);

    console.log("\n[5] super_admin PUT {allusion:0.4} → 200 直接生效；预览与新建报价按 40% 计价");
    const p3 = await call(settingsRoute.PUT, SA, "PUT", `/api/sales/quote-settings/discounts?orgId=${ORG}`, { allusion: 0.4 });
    ok(p3.status === 200 && p3.body.allusion === 0.4, "200 + allusion 0.4", p3.body);
    const d1 = await loadDiscounts(ORG);
    ok(d1.Allusion === 0.4 && d1.Fauxwood === 0.25, "loadDiscounts 合并视图更新", d1);
    const expected = priceFor("Allusion", "Standard", 24, 36, 0.4, false);
    const pv = await call(previewRoute.POST, BOSS_A, "POST", `/api/sales/quotes/preview?orgId=${ORG}`, {
      items: [{ product: "Allusion", fabric: "Standard", widthIn: 24, heightIn: 36 }], installMode: "pickup", taxRate: 0,
    });
    const pvItem = (pv.body.itemResults as Array<Record<string, number>> | undefined)?.[0];
    ok(pv.status === 200 && !!pvItem && !("error" in expected) && Math.abs(pvItem.price - expected.price) < 1e-6 && pvItem.discountPct === 0.4, "预览 Allusion 行按企业折扣 40%", { pv: pv.body, expected });
    ok(!JSON.stringify(pv.body).includes("costPrice") && !JSON.stringify(pv.body).includes("dealer"), "预览响应不含成本字段");

    const q = await call(quotesRoute.POST, REP, "POST", `/api/sales/quotes?orgId=${ORG}`, {
      customerId: CUST,
      items: [
        { product: "Allusion", fabric: "Standard", widthIn: 24, heightIn: 36 },
        { product: "Fauxwood", fabric: "Standard", widthIn: 36.5, heightIn: 48 },
      ],
      installMode: "pickup", taxRate: 0,
      formDataJson: JSON.stringify({ orderNumber: `PL-${stamp}`, shadeOrders: [] }),
    });
    const quoteId = String((q.body.quote as Record<string, unknown> | undefined)?.id ?? q.body.quoteId ?? "");
    if (quoteId) quoteIds.push(quoteId);
    const saved = quoteId ? await db.salesQuote.findUnique({ where: { id: quoteId }, include: { items: { orderBy: { sortOrder: "asc" } } } }) : null;
    ok(q.status < 300 && !!saved, "新建报价成功", q.body);
    const form = saved?.formDataJson ? (JSON.parse(saved.formDataJson) as Record<string, unknown>) : {};
    ok(form.pricelistVersion === "2026-10-28" && form.orderNumber === `PL-${stamp}`, "formDataJson.pricelistVersion = 2026-10-28 且原字段保留", form);
    const allusionRow = saved?.items.find((i) => i.product === "Allusion");
    const fauxwoodRow = saved?.items.find((i) => i.product === "Fauxwood");
    ok(!!allusionRow && allusionRow.discountPct === 0.4 && !("error" in expected) && Math.abs(allusionRow.price - expected.price) < 1e-6, "落库 Allusion 行按 40%", allusionRow);
    ok(!!fauxwoodRow && fauxwoodRow.discountPct === 0.25 && Math.abs(fauxwoodRow.msrp - 410.06) < 0.01 && fauxwoodRow.bracketWidth === 42 && fauxwoodRow.bracketHeight === 48, "落库 Fauxwood 36.5x48：MSRP 410.06、取档 42x48、企业折扣 25%", fauxwoodRow);
  } finally {
    await db.pendingAction.deleteMany({ where: { orgId: ORG } });
    await db.auditLog.deleteMany({ where: { OR: [{ userId: { in: users } }, { orgId: ORG }] } });
    await db.notification.deleteMany({ where: { userId: { in: users } } });
    if (quoteIds.length) await db.salesQuote.deleteMany({ where: { id: { in: quoteIds } } });
    await db.salesCustomer.deleteMany({ where: { id: CUST } });
    await db.orgBusinessRule.deleteMany({ where: { orgId: ORG } });
    await db.quoteDiscountSettings.deleteMany({ where: { orgId: ORG } });
    await db.organizationMember.deleteMany({ where: { orgId: ORG } });
    await db.organization.deleteMany({ where: { id: ORG } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.$disconnect();
  }

  console.log(`\n价表折扣设置审批 DB 端到端：${pass} 通过，${fail} 失败`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
