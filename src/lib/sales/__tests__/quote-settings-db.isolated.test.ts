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
  const { loadDiscounts, loadDiscountsDto, applyOrgDiscountDefaults, dtoToProductDiscounts, dtoToCordlessPolicy } = await import("@/lib/blinds/discount-settings");
  const { priceFor, calculateQuoteTotal } = await import("@/lib/blinds/pricing-engine");

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
  const call = async (handler: unknown, uid: string, method: string, url: string, body?: Record<string, unknown>, params: Record<string, string> = {}) => {
    const r = new NextRequest(`http://localhost${url}`, {
      method,
      headers: { "content-type": "application/json", cookie: await cookie(uid), "x-forwarded-for": "10.31.0.4", "x-org-id": ORG },
      ...(body ? { body: JSON.stringify({ orgId: ORG, ...body }) } : {}),
    });
    const res = await (handler as (r: unknown, c: unknown) => Promise<Response>)(r, { params: Promise.resolve(params) });
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

    console.log("\n[6] PRICE-2：老板改无绳设置 → 202 → 另一位老板批准 → 只动 pricing.cordless");
    const c1 = await call(settingsRoute.PUT, BOSS_A, "PUT", `/api/sales/quote-settings/discounts?orgId=${ORG}`, { cordlessDiscount: 0.25, cordlessFloorZebra: 169 });
    ok(c1.status === 202 && String(c1.body.summary).includes("cordlessDiscount=0.25") && String(c1.body.summary).includes("cordlessFloorZebra=169"), "202 + 审批摘要含无绳两项", c1.body);
    const sjC0 = await settingsJson();
    ok(!(sjC0?.pricing as Record<string, unknown> | undefined)?.cordless, "提交后 pricing.cordless 仍不存在", sjC0);
    const ec1 = await approve(String(c1.body.approvalId), BOSS_B);
    ok(ec1.ok === true, "批准执行成功", ec1);
    const sjC1 = await settingsJson();
    const pricingC1 = sjC1?.pricing as Record<string, unknown>;
    const cordlessC1 = pricingC1?.cordless as { discount?: number; floors?: Record<string, number> } | undefined;
    ok(cordlessC1?.discount === 0.25 && cordlessC1?.floors?.Zebra === 169 && cordlessC1?.floors?.Roller === undefined, "pricing.cordless = {discount 0.25, floors.Zebra 169}", sjC1);
    ok((pricingC1?.discounts as Record<string, number>)?.fauxwood === 0.25 && pricingC1?.leadMaxPct === 0.4 && (sjC1?.sunnyWarranty as Record<string, unknown>)?.fixture === true, "pricing.discounts / leadMaxPct / sunnyWarranty 原样", sjC1);
    const gC = await call(settingsRoute.GET, BOSS_A, "GET", `/api/sales/quote-settings/discounts?orgId=${ORG}`);
    ok(gC.body.cordlessDiscount === 0.25 && gC.body.cordlessFloorZebra === 169 && gC.body.cordlessFloorRoller === 129, "GET 返回无绳三项（Roller 回默认 129）", gC.body);
    const bad1 = await call(settingsRoute.PUT, BOSS_A, "PUT", `/api/sales/quote-settings/discounts?orgId=${ORG}`, { cordlessFloorRoller: -1 });
    const bad2 = await call(settingsRoute.PUT, BOSS_A, "PUT", `/api/sales/quote-settings/discounts?orgId=${ORG}`, { cordlessDiscount: 1.2 });
    ok(bad1.status === 400 && bad2.status === 400, "无绳非法值 → 400", { bad1: bad1.body, bad2: bad2.body });

    console.log("\n[7] PRICE-2：预览无绳行按企业无绳策略；有绳行按企业产品折扣；量房生成布帘按褶皱率 2");
    const pvC = await call(previewRoute.POST, BOSS_A, "POST", `/api/sales/quotes/preview?orgId=${ORG}`, {
      items: [
        { product: "Zebra", fabric: "Light Filtering", widthIn: 48, heightIn: 60, cordless: true },
        { product: "Zebra", fabric: "Light Filtering", widthIn: 48, heightIn: 60 },
        { product: "Drapery", fabric: "Without liner", widthIn: 100, heightIn: 120, fullness: 1.8 },
      ],
      installMode: "pickup", taxRate: 0,
    });
    const rows = (pvC.body.itemResults as Array<Record<string, number | boolean>> | undefined) ?? [];
    const baseC = priceFor("Zebra", "Light Filtering", 48, 60, 0, false);
    const msrp48 = "error" in baseC ? NaN : baseC.msrp;
    const expectCordless = Math.max(msrp48 * 0.75 * 1.15, 169);
    ok(rows[0]?.cordless === true && rows[0]?.discountPct === 0.25 && Math.abs((rows[0]?.price as number) - expectCordless) < 1e-6, `无绳行折扣 0.25、成交 max(MSRP×0.75×1.15, 169) = ${expectCordless.toFixed(2)}`, rows[0]);
    ok(rows[1]?.cordless === false && rows[1]?.discountPct === 0.45, "有绳行仍按 Zebra 企业产品折扣 0.45", rows[1]);
    const drape18 = priceFor("Drapery", "Without liner", 100, 120, null, false, undefined, 1.8);
    ok(!("error" in drape18) && Math.abs((rows[2]?.price as number) - drape18.price) < 1e-6 && Math.abs(drape18.price - 831.41) < 0.01, "预览布帘 100x120 褶皱率 1.8 → 831.41", { row: rows[2] });

    // 量房生成报价：路由在写库前的计价步骤（量房窗位不带褶皱率 → 按 2）。
    // 路由本身在 origin/main 上写库即 500（嵌套 rooms.items 用 quoteId: undefined，Prisma 报 "Argument quote is missing"），
    // 与定价无关，PRICE-2 报告 §5 记为既有问题，不在本 change 修。
    const genSettings = await loadDiscountsDto(ORG);
    const genCalc = calculateQuoteTotal({
      items: applyOrgDiscountDefaults(
        [{ product: "Drapery" as const, fabric: "Without liner", widthIn: 100, heightIn: 120, cordless: false, location: "Living" }],
        dtoToProductDiscounts(genSettings),
      ),
      installMode: "pickup",
      cordlessPolicy: dtoToCordlessPolicy(genSettings),
    });
    const drape2 = priceFor("Drapery", "Without liner", 100, 120, 0.35, false, undefined, 2);
    ok(genCalc.itemResults.length === 1 && genCalc.itemResults[0].bracketWidth === 100 && !("error" in drape2) && Math.abs(genCalc.itemResults[0].price - drape2.price) < 1e-6, "量房计价：布帘 100x120 不带褶皱率 → 按 2，取档 100", genCalc.itemResults[0]);
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
