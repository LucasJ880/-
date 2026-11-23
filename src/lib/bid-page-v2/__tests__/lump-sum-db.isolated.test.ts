/**
 * BIDPAGE-4 只报总价——真实 DB（隔离库）经真实路由处理函数
 * （openspec change quote-lump-sum-mode，spec tender/quote-lump-sum-mode、tender/quote-line-mode 的修改）
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated \
 *   npx tsx src/lib/bid-page-v2/__tests__/lump-sum-db.isolated.test.ts
 * 无隔离库时自动跳过。全部数据为 fixture（虚构组织 / 用户 / 供应商 / 任务书的合成金额）。不发任何邮件、不批准任何询价卡。
 */
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过 BIDPAGE-4 只报总价 DB 测试（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "BIDPAGE-4 只报总价 隔离库测试" });

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail).slice(0, 2000) : ""); }
}

async function main() {
  const { NextRequest } = await import("next/server");
  const { Prisma } = await import("@prisma/client");
  const { db } = await import("@/lib/db");
  const { createSession } = await import("@/lib/auth/session");
  const { getQuote, reviseQuote, transitionQuote, updateEngineQuote } = await import("@/lib/quote-engine/service");
  const { resolveTenderBid, selectQuoteAsTenderBid } = await import("@/lib/quote-engine/tender-bid");
  const { seedOrgAuthorizationProfiles } = await import("@/lib/authorization/seed-org-profiles");
  const { lumpFormulaLinesZh, readLumpMeta } = await import("@/lib/bid-page-v2/lump-sum/contract");
  const { createLumpQuote, convertQuote, saveLumpView } = await import("@/lib/bid-page-v2/lump-sum/service");
  const { readBidLineMeta } = await import("@/lib/bid-page-v2/quote-line/contract");
  const listRoute = await import("@/app/api/projects/[id]/bid-page/quotes/route");
  const lineRoute = await import("@/app/api/projects/[id]/bid-page/quotes/[quoteId]/line/route");
  const lumpRoute = await import("@/app/api/projects/[id]/bid-page/quotes/[quoteId]/lump/route");
  const convertRoute = await import("@/app/api/projects/[id]/bid-page/quotes/[quoteId]/convert/route");
  const exportRoute = await import("@/app/api/projects/[id]/bid-page/quotes/[quoteId]/export/route");
  const proRoute = await import("@/app/api/projects/[id]/quote-engine/[quoteId]/route");
  type LumpView = import("@/lib/bid-page-v2/lump-sum/contract").LumpView;
  type LumpState = import("@/lib/bid-page-v2/lump-sum/contract").LumpState;
  type LumpItem = import("@/lib/bid-page-v2/lump-sum/contract").LumpItem;
  type LineView = import("@/lib/bid-page-v2/quote-line/contract").LineModeView;
  type ListView = import("@/lib/bid-page-v2/quote-line/contract").QuoteListView;

  console.log("BIDPAGE-4 只报总价——隔离库");
  const stamp = Date.now().toString(36);
  const OWNER = `lsowner_${stamp}`, FINEDIT = `lsfinedit_${stamp}`, FINVIEW = `lsfinview_${stamp}`, OPERATOR = `lsop_${stamp}`, OUTSIDER = `lsout_${stamp}`;
  const ORG = `lsorg_${stamp}`, ORG_B = `lsorgb_${stamp}`;
  const users = [OWNER, FINEDIT, FINVIEW, OPERATOR, OUTSIDER];
  const email = (id: string) => `${id}@fixture.test`;
  const ENV_KEYS = ["TENDER_BID_PAGE_V2_ENABLED", "TENDER_BID_PAGE_V2_ORG_ALLOWLIST", "TENDER_QUOTE_ENGINE_ENABLED", "TENDER_BID_WORKSPACE_ENABLED"];
  for (const k of ENV_KEYS) delete process.env[k];
  process.env.TENDER_QUOTE_ENGINE_ENABLED = "1";

  for (const id of users) await db.user.create({ data: { id, email: email(id), name: `Fixture ${id}`, role: "user" } });
  await db.organization.create({ data: { id: ORG, name: "Fixture Bidder Inc.", code: `ls-${stamp}`, ownerId: OWNER, industryPackId: "window_covering_services_v1" } });
  await db.organization.create({ data: { id: ORG_B, name: "Other Fixture Org", code: `lsb-${stamp}`, ownerId: OUTSIDER } });
  for (const [u, role] of [[OWNER, "org_admin"], [FINEDIT, "org_member"], [FINVIEW, "org_member"], [OPERATOR, "org_member"]] as const) {
    await db.organizationMember.create({ data: { orgId: ORG, userId: u, role, status: "active" } });
  }
  await db.organizationMember.create({ data: { orgId: ORG_B, userId: OUTSIDER, role: "org_admin", status: "active" } });
  await seedOrgAuthorizationProfiles(ORG);
  const accounting = await db.roleProfile.findUnique({ where: { orgId_key: { orgId: ORG, key: "accounting" } } });
  if (!accounting) throw new Error("缺少岗位模板 accounting");
  for (const u of [FINEDIT, FINVIEW]) await db.principalRoleBinding.create({ data: { orgId: ORG, principalType: "HUMAN", principalId: u, roleProfileId: accounting.id, status: "active" } });

  const projectIds: string[] = [];
  const supplierIds: string[] = [];
  let seq = 0;
  async function mkProject() {
    seq += 1;
    const id = `lsproj_${stamp}_${seq}`;
    projectIds.push(id);
    await db.project.create({ data: { id, name: `Fixture Tender ${stamp}-${seq}`, orgId: ORG, ownerId: OWNER, workDomain: "tender", intakeStatus: "dispatched" } });
    for (const [u, role] of [[FINEDIT, "operator"], [FINVIEW, "viewer"], [OPERATOR, "operator"]] as const) await db.projectMember.create({ data: { projectId: id, userId: u, role, status: "active" } });
    return id;
  }
  const cookieOf = async (userId: string) => `qy_session=${await createSession({ sub: userId, email: email(userId), role: "user" })}`;
  const req = async (url: string, userId: string | null, init: { method?: string; body?: unknown } = {}) =>
    new NextRequest(`http://localhost${url}`, { method: init.method ?? "GET", headers: { ...(userId ? { cookie: await cookieOf(userId) } : {}), ...(init.body !== undefined ? { "content-type": "application/json" } : {}) }, body: init.body !== undefined ? JSON.stringify(init.body) : undefined });
  const json = async (res: Response) => {
    const text = await res.text();
    let body: Record<string, unknown> = {};
    try { body = JSON.parse(text); } catch { /* 非 JSON */ }
    return { status: res.status, text, body };
  };
  const pq = (P: string, Q: string) => ({ params: Promise.resolve({ id: P, quoteId: Q }) });
  const list = async (P: string, u: string | null = OWNER) => json(await listRoute.GET(await req(`/api/projects/${P}/bid-page/quotes`, u), { params: Promise.resolve({ id: P }) }));
  const create = async (P: string, body: unknown, u: string | null = OWNER) => json(await listRoute.POST(await req(`/api/projects/${P}/bid-page/quotes`, u, { method: "POST", body }), { params: Promise.resolve({ id: P }) }));
  const getLump = async (P: string, Q: string, u: string | null = OWNER) => json(await lumpRoute.GET(await req(`/api/projects/${P}/bid-page/quotes/${Q}/lump`, u), pq(P, Q)));
  const putLump = async (P: string, Q: string, body: unknown, u: string | null = OWNER) => json(await lumpRoute.PUT(await req(`/api/projects/${P}/bid-page/quotes/${Q}/lump`, u, { method: "PUT", body }), pq(P, Q)));
  const convert = async (P: string, Q: string, body: unknown, u: string | null = OWNER) => json(await convertRoute.POST(await req(`/api/projects/${P}/bid-page/quotes/${Q}/convert`, u, { method: "POST", body }), pq(P, Q)));
  const getLine = async (P: string, Q: string, u: string | null = OWNER) => json(await lineRoute.GET(await req(`/api/projects/${P}/bid-page/quotes/${Q}/line`, u), pq(P, Q)));
  const putLine = async (P: string, Q: string, body: unknown, u: string | null = OWNER) => json(await lineRoute.PUT(await req(`/api/projects/${P}/bid-page/quotes/${Q}/line`, u, { method: "PUT", body }), pq(P, Q)));
  const exp = async (P: string, Q: string, u: string | null = OWNER) => json(await exportRoute.GET(await req(`/api/projects/${P}/bid-page/quotes/${Q}/export`, u), pq(P, Q)));
  const pro = async (P: string, Q: string) => json(await proRoute.GET(await req(`/api/projects/${P}/quote-engine/${Q}`, OWNER), pq(P, Q)));
  const snap = async (Q: string) => {
    const q = await db.projectQuote.findUnique({ where: { id: Q }, select: { engineJson: true, pricingRate: true, costLines: { orderBy: { id: "asc" } } } });
    return JSON.stringify([q?.engineJson, String(q?.pricingRate), q?.costLines.map((l) => [l.id, l.description, String(l.unitCost), String(l.rate), l.calculationType, l.included, l.notes, l.metadata, l.updatedAt.toISOString()])]);
  };
  /** 专业模式保存（与专业模式页面同一个服务）：原样回写全部成本行，可改几条、加几条 */
  const proSave = async (Q: string, P: string, header: Record<string, unknown>, patch: (l: Record<string, unknown>) => Record<string, unknown> = (l) => l, extra: Record<string, unknown>[] = []) => {
    const q = await getQuote(Q, P);
    const lines = q.costLines.map((l) => patch({ id: l.id, sortOrder: l.sortOrder, category: l.category, subcategory: l.subcategory, description: l.description, quantity: l.quantity == null ? null : Number(l.quantity), unit: l.unit, unitCost: l.unitCost == null ? null : Number(l.unitCost), sourceCurrency: l.sourceCurrency, fxRate: l.fxRate == null ? null : Number(l.fxRate), fxRateSource: l.fxRateSource, calculationType: l.calculationType, calculationBase: l.calculationBase, rate: l.rate == null ? null : Number(l.rate), duration: l.duration == null ? null : Number(l.duration), supplierId: l.supplierId, supplierName: l.supplierName, source: l.source, notes: l.notes, included: l.included, _key: readLumpMeta(l.metadata)?.key ?? null }));
    await updateEngineQuote({ quoteId: Q, projectId: P, userId: OWNER, header: header as never, lines: [...lines.map(({ _key, ...rest }) => { void _key; return rest; }), ...extra] as never });
  };
  const it = (s: LumpState, key: string) => s.items.find((i) => i.key === key);
  const mkItem = (key: LumpItem["key"], over: Partial<LumpItem> = {}): LumpItem => ({ costLineId: null, key, seq: null, label: null, kind: key === "bond" || key === "contingency" || key === "warranty_reserve" ? "percent" : "amount", amount: null, currency: "CAD", ratePct: null, notes: null, ...over });

  try {
    const P = await mkProject();
    const supplier = await db.supplier.create({ data: { orgId: ORG, name: "合成供应商甲", contactEmail: `lssupa${stamp}@fixture.test`, status: "active", createdById: OWNER } });
    supplierIds.push(supplier.id);
    const round = await db.projectInquiry.create({ data: { projectId: P, roundNumber: 1, title: "round 1", scope: "x", status: "in_progress", createdById: OWNER } });
    const replied = await db.inquiryItem.create({ data: { inquiryId: round.id, supplierId: supplier.id, status: "quoted", sentAt: new Date(), repliedAt: new Date(), totalPrice: new Prisma.Decimal(50000), unitPrice: new Prisma.Decimal(25), currency: "CAD", createdById: OWNER } });

    // —— 1. 开关 ——
    const anon = [await getLump(P, "q_fixture_nope", null), await putLump(P, "q_fixture_nope", { baseUpdatedAt: "x", state: {} }, null), await convert(P, "q_fixture_nope", { to: "LINE", baseUpdatedAt: "x" }, null)];
    ok(anon.every((r) => r.status === 401), "没登录：读、存、转换都 401（第一步先做报价权限守卫）", anon.map((r) => r.status));
    const quotesBefore = await db.projectQuote.count({ where: { projectId: P } });
    const offs = [await create(P, { entryMode: "LUMP_SUM", businessType: "SUPPLY_ONLY" }), await getLump(P, "q_fixture_nope"), await putLump(P, "q_fixture_nope", { baseUpdatedAt: "x", state: {} }), await convert(P, "q_fixture_nope", { to: "LINE", baseUpdatedAt: "x" })];
    ok(offs.every((r) => r.status === 404 && r.body.error === "新版标书与报价页未启用") && (await db.projectQuote.count({ where: { projectId: P } })) === quotesBefore, "新页面开关没开：新建只报总价、读、存、转换都 404，库里不变", offs.map((r) => r.status));
    process.env.TENDER_BID_PAGE_V2_ENABLED = "1";
    const three = async () => [await getLump(P, "q_fixture_nope"), await putLump(P, "q_fixture_nope", { baseUpdatedAt: "x", state: {} }), await convert(P, "q_fixture_nope", { to: "LINE", baseUpdatedAt: "x" })];
    process.env.TENDER_BID_PAGE_V2_ORG_ALLOWLIST = ORG_B;
    const notListed = await three();
    ok(notListed.every((r) => r.status === 404), "组织不在名单里：读、存、转换都 404", notListed.map((r) => r.status));
    process.env.TENDER_BID_PAGE_V2_ORG_ALLOWLIST = "";
    delete process.env.TENDER_QUOTE_ENGINE_ENABLED;
    const engineOff = await three();
    ok(engineOff.every((r) => r.status === 404), "报价引擎没开：读、存、转换都 404", engineOff.map((r) => r.status));
    process.env.TENDER_QUOTE_ENGINE_ENABLED = "1";

    // —— 2. 新建 ——
    const c1 = await create(P, { entryMode: "LUMP_SUM", businessType: "SUPPLY_ONLY", name: "合成总价报价" });
    const Q = String(c1.body.id);
    const q1 = await db.projectQuote.findUnique({ where: { id: Q }, include: { costLines: true } });
    const keys = q1!.costLines.map((l) => readLumpMeta(l.metadata)?.key ?? readBidLineMeta(l.metadata)?.role).sort();
    const eng1 = q1!.engineJson as { entryMode?: string; tax?: Record<string, unknown> };
    ok(c1.status === 201 && c1.body.entryMode === "LUMP_SUM" && q1!.quoteType === "SUPPLY_ONLY" && eng1.entryMode === "LUMP_SUM" && q1!.currency === "CAD" && q1!.pricingMethod === "MARGIN_ON_REVENUE" && q1!.pricingRate === null, "只报总价 + 只供货：201，只供货报价、做法为只报总价、加元、按售价毛利、目标毛利率空着", c1.body);
    ok(JSON.stringify(keys) === JSON.stringify(["duty", "goods_total", "ocean_freight", "preset", "preset", "preset", "preset"]) && eng1.tax?.hstPct == null && eng1.tax?.gstPct == null && eng1.tax?.pstPct == null, "同一次写入只有货品、海运费、关税三项与四条预置；税三项为空（不套 15 / 31 行模板）", keys);
    const created = await db.auditLog.findFirst({ where: { targetId: Q, action: "quote_created" } });
    ok(!!created && JSON.stringify(created.afterData).includes("LUMP_SUM"), "审计里有一条新建报价（带做法）");
    const c2 = await create(P, { entryMode: "LUMP_SUM", businessType: "SUPPLY_INSTALL" });
    const Q2 = String(c2.body.id);
    const q2 = await db.projectQuote.findUnique({ where: { id: Q2 }, include: { costLines: true } });
    ok(c2.status === 201 && c2.body.entryMode === "LUMP_SUM" && q2!.quoteType === "PROJECT_SUPPLY_INSTALL" && q2!.costLines.length === 7, "只报总价 + 供货加安装：201，供货加安装报价、做法为只报总价，成本行与只供货时相同");
    const c3 = await create(P, { entryMode: "LUMP_SUM", businessType: "STANDING_OFFER" });
    const q3 = await db.projectQuote.findUnique({ where: { id: String(c3.body.id) }, include: { costLines: true } });
    ok(c3.status === 201 && c3.body.entryMode === null && String(c3.body.proModeHref).endsWith(`/quote-engine/${c3.body.id}`) && !(q3!.engineJson as { entryMode?: string }).entryMode && q3!.quoteType === "STANDING_OFFER", "只报总价 + 长期供货协议：照改版前模板、没有做法、返回专业模式地址");
    ok((await create(P, { entryMode: "FREESTYLE", businessType: "SUPPLY_ONLY" })).status === 400, "不认识的做法：400");
    const lv = (await list(P)).body as unknown as ListView;
    ok(lv.quotes.find((q) => q.id === Q)?.entryMode === "LUMP_SUM" && lv.quotes.find((q) => q.id === Q2)?.entryMode === "LUMP_SUM" && lv.quotes.find((q) => q.id === String(c3.body.id))?.entryMode === null, "列表：总价报价写只报总价，长期供货协议是专业模式");

    // —— 3. 读与存（验收 3） ——
    const g0 = await getLump(P, Q);
    const v0 = g0.body as unknown as LumpView;
    ok(g0.status === 200 && v0.state.goods.mode === "total" && v0.state.items.map((i) => i.key).join(",") === "ocean_freight,duty" && v0.inquiryQuotes.length === 1 && v0.convertToLine.available === false, "读：货品填总数、海运费、关税两项、带询价回复；货品是总数时不能转逐行", g0.body);
    const off = (p: LumpState["presets"]) => ({ financing: { ...p.financing, included: false }, admin: { ...p.admin, included: false }, cashAllowance: { ...p.cashAllowance, included: false }, commission: { ...p.commission, included: false } });
    const s3: LumpState = {
      ...v0.state,
      goods: { ...v0.state.goods, amount: 800000, evidenceKind: "ESTIMATE" },
      items: v0.state.items.map((i) => (i.key === "ocean_freight" ? { ...i, amount: 60000, notes: "2 个 40 尺柜" } : { ...i, amount: 40000 })),
      presets: off(v0.state.presets),
      tax: { hstPct: 7, gstPct: null, pstPct: null },
      targetMarginPct: 25,
    };
    const p3 = await putLump(P, Q, { baseUpdatedAt: v0.quote.updatedAt, state: s3 });
    const v3 = p3.body as unknown as LumpView;
    const t3 = v3.computed?.ok ? v3.computed.totals : null;
    ok(p3.status === 200 && !!t3 && t3.estimatedCost === 900000 && t3.sellingPrice === 1200000 && t3.salesTax === 84000 && t3.totalWithTax === 1284000 && t3.grossProfit === 300000 && t3.grossMarginPct === 25, "验收 3：成本 900,000 / 税前 1,200,000 / 税 84,000 / 含税 1,284,000 / 利润 300,000 / 25%", (t3 ?? p3.body));
    const q3db = await db.projectQuote.findUnique({ where: { id: Q }, include: { costLines: true } });
    const e3 = q3db!.engineJson as { entryMode?: string; tax?: { hstPct?: number } };
    ok(q3db!.costLines.length === 7 && e3.tax?.hstPct === 7 && e3.entryMode === "LUMP_SUM" && (q3db!.summaryJson as { sellingPrice?: number }).sellingPrice === 1200000, "销售税不是成本行：没多出成本行；配置里税 7%、做法仍是只报总价；存下的结果税前报价不含税");
    const oceanLine = q3db!.costLines.find((l) => readLumpMeta(l.metadata)?.key === "ocean_freight");
    ok(oceanLine?.notes === "2 个 40 尺柜", "备注存在海运费那条成本行的备注里");
    const g3 = await getLump(P, Q, FINEDIT);
    const v3b = g3.body as unknown as LumpView;
    ok(g3.status === 200 && JSON.stringify(v3b.state) === JSON.stringify(v3.state) && JSON.stringify(v3b.computed) === JSON.stringify(v3.computed) && it(v3b.state, "ocean_freight")?.notes === "2 个 40 尺柜", "换一位有财务查看权的同事读：同样的各项、备注、税与结果");
    const upd = await db.auditLog.findFirst({ where: { targetId: Q, action: "quote_updated" } });
    ok(!!upd && JSON.stringify(upd.afterData).includes("LUMP_SUM"), "保存写一条更新报价的审计（带做法）");
    // 加了保险没填
    const p4 = await putLump(P, Q, { baseUpdatedAt: v3.quote.updatedAt, state: { ...v3.state, items: [...v3.state.items, mkItem("insurance")] } });
    const v4 = p4.body as unknown as LumpView;
    const insLine = (await db.quoteCostLine.findMany({ where: { quoteId: Q } })).find((l) => readLumpMeta(l.metadata)?.key === "insurance");
    ok(p4.status === 200 && !!insLine && !insLine.included && v4.computed.ok && v4.computed.totals.estimatedCost === 900000, "加了保险没填：不计入，合计与没加时相同");
    // 校验不过：库里不变
    const before5 = await snap(Q);
    const bad1 = await putLump(P, Q, { baseUpdatedAt: v4.quote.updatedAt, state: { ...v4.state, items: [...v4.state.items, mkItem("installation", { amount: 1 }), mkItem("installation", { amount: 2 })] } });
    const bad2 = await putLump(P, Q, { baseUpdatedAt: v4.quote.updatedAt, state: { ...v4.state, items: [...v4.state.items, mkItem("installation", { amount: 12.34567 })] } });
    ok(bad1.status === 400 && String(bad1.body.error).includes("安装只能有一项") && bad2.status === 400 && String(bad2.body.error).includes("安装") && (await snap(Q)) === before5, "同一项两条 / 安装 12.34567：400，指到安装，库里不变", [bad1.body.error, bad2.body.error]);

    // —— 4. 验收 4：开预置后与专业模式读接口相同 ——
    const p5 = await putLump(P, Q, { baseUpdatedAt: v4.quote.updatedAt, state: { ...v4.state, presets: { financing: { ratePct: 8, months: 1, included: true }, admin: { ratePct: 3, included: true }, cashAllowance: { ratePct: 1, included: true }, commission: { ratePct: 30, included: true } } } });
    const v5 = p5.body as unknown as LumpView;
    const pr = await pro(P, Q);
    const pc = (pr.body.computed as { calc?: { estimatedCost: number; sellingPrice: number; grossProfit: number; grossMarginPct: number } } | undefined)?.calc;
    const t5 = v5.computed.ok ? v5.computed.totals : null;
    ok(!!t5 && t5.estimatedCost === 1037322.68 && t5.sellingPrice === 1257360.83 && t5.grossProfit === 220038.15 && t5.grossMarginPct === 17.5, "验收 4：开四条预置后 1,037,322.68 / 1,257,360.83 / 220,038.15 / 17.5%", t5);
    ok(pr.status === 200 && !!pc && !!t5 && pc.estimatedCost === t5.estimatedCost && pc.sellingPrice === t5.sellingPrice && pc.grossProfit === t5.grossProfit && pc.grossMarginPct === t5.grossMarginPct, "与专业模式读接口对同一份报价返回的结果逐项相同（没有第二套算法）", { pro: pc, lump: t5 });
    // 算式里的数也取自同一套结果：提成金额等于专业模式读接口里提成那一行的金额
    const proLines = (pr.body.computed as { calc?: { lines: Array<{ calculationType: string; amount: number }>; baseCost: number } } | undefined)?.calc;
    const proCommission = proLines?.lines.find((l) => l.calculationType === "PCT_OF_GROSS_PROFIT")?.amount;
    const f5 = v5.computed.ok ? v5.computed.formula : null;
    const fLines = lumpFormulaLinesZh(f5);
    ok(!!f5 && f5.commission?.amount === proCommission && f5.baseCost === proLines?.baseCost && f5.commission?.ratePct === 30 && fLines[0] === "税前报价 1,257,360.83 = 不含销售提成的成本 943,020.62 ÷（1 − 25%）" && fLines[1] === `销售提成 ${proCommission!.toLocaleString("en-US", { minimumFractionDigits: 2 })} =（税前报价 1,257,360.83 − 943,020.62）× 30%，算进成本合计`, "算式：税前报价 = 不含提成的成本 943,020.62 ÷（1 − 25%）；提成金额与专业模式里提成那一行相同", fLines);

    // —— 5. 货品明细与点选 ——
    const PD = await mkProject();
    const cd = await create(PD, { entryMode: "LUMP_SUM", businessType: "SUPPLY_ONLY" });
    const QD = String(cd.body.id);
    const vd0 = (await getLump(PD, QD)).body as unknown as LumpView;
    const row = (over: Record<string, unknown>) => ({ costLineId: null, description: "合成卷帘 A", quantity: 5, uom: "Each", packCount: null, basis: "PER_TENDER_UOM", unitPrice: 100, currency: "CAD", evidenceKind: "ESTIMATE", inquiryItemId: null, supplierId: null, supplierName: null, rowSource: "manual", ...over });
    const pd = await putLump(PD, QD, { baseUpdatedAt: vd0.quote.updatedAt, state: { ...vd0.state, goods: { ...vd0.state.goods, mode: "detail", amount: 999 }, details: [row({}), row({ description: "合成配件 B", quantity: 10, unitPrice: 20 })], presets: off(vd0.state.presets), targetMarginPct: 20 } });
    const vd = pd.body as unknown as LumpView;
    const gtd = (await db.quoteCostLine.findMany({ where: { quoteId: QD } })).find((l) => readLumpMeta(l.metadata)?.key === "goods_total");
    ok(pd.status === 200 && vd.computed.ok && vd.computed.goodsAmount === 700 && vd.computed.totals.estimatedCost === 700 && !!gtd && !gtd.included && Number(gtd.unitCost) === 999, "明细 5 × 100 + 10 × 20：货品计入 700，总数那一行留着（999）、不计入", vd.computed);
    // 点选回复的总价
    const PP = await mkProject();
    const cp = await create(PP, { entryMode: "LUMP_SUM", businessType: "SUPPLY_ONLY" });
    const QP = String(cp.body.id);
    const vp0 = (await getLump(PP, QP)).body as unknown as LumpView;
    const okPick = await putLump(P, Q2, { baseUpdatedAt: ((await getLump(P, Q2)).body as unknown as LumpView).quote.updatedAt, state: { ...((await getLump(P, Q2)).body as unknown as LumpView).state, goods: { ...((await getLump(P, Q2)).body as unknown as LumpView).state.goods, amount: 50000, inquiryItemId: replied.id, supplierId: "spoofed0", supplierName: "任意供应商" } } });
    const gt2 = (await db.quoteCostLine.findMany({ where: { quoteId: Q2 } })).find((l) => readLumpMeta(l.metadata)?.key === "goods_total");
    ok(okPick.status === 200 && Number(gt2?.unitCost) === 50000 && gt2?.supplierId === supplier.id && gt2?.supplierName === "合成供应商甲", "点选总价 50,000 加元的回复：货品是 50,000，供应商取自回复（提交里带的另一个供应商不用）", okPick.body.error);
    const beforeP = await snap(QP);
    // 金额与回复一致（50,000），只因为回复属于别的项目被拒
    const mism = await putLump(PP, QP, { baseUpdatedAt: vp0.quote.updatedAt, state: { ...vp0.state, goods: { ...vp0.state.goods, amount: 50000, inquiryItemId: replied.id } } });
    ok(mism.status === 400 && String(mism.body.error).includes("找不到") && (await snap(QP)) === beforeP && vp0.inquiryQuotes.length === 0, "点选别的项目的回复（金额与回复一致）：400，库里不变；本项目的视图里也看不到那条回复", mism.body.error);
    const v2now = (await getLump(P, Q2)).body as unknown as LumpView;
    const before2 = await snap(Q2);
    const mism2 = await putLump(P, Q2, { baseUpdatedAt: v2now.quote.updatedAt, state: { ...v2now.state, goods: { ...v2now.state.goods, amount: 49000 } } });
    ok(mism2.status === 400 && String(mism2.body.error).includes("对不上") && (await snap(Q2)) === before2, "点选后把总数改成 49,000：400，写明和回复对不上，库里不变", mism2.body.error);
    // 明细从询价回复点选单价：供应商取自回复
    const v2d = (await getLump(P, Q2)).body as unknown as LumpView;
    const pickDetail = await putLump(P, Q2, { baseUpdatedAt: v2d.quote.updatedAt, state: { ...v2d.state, goods: { ...v2d.state.goods, mode: "detail" }, details: [{ costLineId: null, description: "合成卷帘 A", quantity: 4, uom: "Each", packCount: null, basis: "PER_TENDER_UOM", unitPrice: 25, currency: "CAD", evidenceKind: null, inquiryItemId: replied.id, supplierId: "spoofed0", supplierName: "任意供应商", rowSource: "manual" }] } });
    const d2 = (await db.quoteCostLine.findMany({ where: { quoteId: Q2 } })).find((l) => readBidLineMeta(l.metadata)?.role === "goods");
    ok(pickDetail.status === 200 && d2?.supplierId === supplier.id && d2?.supplierName === "合成供应商甲" && Number(d2?.unitCost) === 25, "明细从询价回复点选单价 25：供应商取自回复（提交里带的另一个供应商不用）", pickDetail.body.error);

    // —— 6. 其它成本行、并发、专业模式改过以后 ——
    await proSave(Q, P, { engine: {} }, (l) => l, [{ sortOrder: 5000, category: "WAREHOUSING", description: "合成仓储费", calculationType: "FIXED", unitCost: 300, sourceCurrency: "CAD", included: true }]);
    const afterPro = await db.projectQuote.findUnique({ where: { id: Q } });
    const ep = afterPro!.engineJson as { entryMode?: string; tax?: { hstPct?: number } };
    ok(ep.entryMode === "LUMP_SUM" && ep.tax?.hstPct === 7, "专业模式保存（引擎配置不带税）后：配置里的做法与税都还在", ep);
    const g6 = (await getLump(P, Q)).body as unknown as LumpView;
    const wh = g6.others.find((o) => o.description === "合成仓储费");
    ok(!!wh && wh.amount === 300 && wh.reasonZh === null && !wh.fromLump, "专业模式加的仓储费：列在其它成本行、带金额", g6.others);
    const whBefore = await db.quoteCostLine.findFirst({ where: { quoteId: Q, description: "合成仓储费" } });
    const p6 = await putLump(P, Q, { baseUpdatedAt: g6.quote.updatedAt, state: { ...g6.state, targetMarginPct: 26 } });
    const whAfter = await db.quoteCostLine.findFirst({ where: { quoteId: Q, description: "合成仓储费" } });
    const v6 = p6.body as unknown as LumpView;
    // 快照会重写每行的计算结果与修改时间；比较的是成本行本身的字段
    const biz = (l: typeof whBefore) => (l ? JSON.stringify({ ...l, calculatedCost: null, updatedAt: null }) : "");
    ok(p6.status === 200 && !!whBefore && biz(whBefore) === biz(whAfter) && v6.computed.ok && v5.computed.ok && v6.computed.totals.estimatedCost > v5.computed.totals.estimatedCost, "在总价表里保存：仓储费那一行一个字段都没变，合计里有它");
    const before6 = await snap(Q);
    const stale = await putLump(P, Q, { baseUpdatedAt: g6.quote.updatedAt, state: g6.state }, FINEDIT);
    ok(stale.status === 409 && String(stale.body.error).includes("刚被别人改过") && (await snap(Q)) === before6, "拿旧的修改时间保存：409，库里不变", stale.body);
    // 专业模式把海运费改成按柜计
    await proSave(Q, P, { engine: {} }, (l) => (l._key === "ocean_freight" ? { ...l, calculationType: "PER_CONTAINER", duration: 2, unitCost: 30000 } : l));
    const g7 = (await getLump(P, Q)).body as unknown as LumpView;
    const oc7 = g7.others.find((o) => o.reasonZh?.includes("在专业模式里改了类别或算法"));
    ok(!it(g7.state, "ocean_freight") && !!oc7 && g7.notices.some((n) => n.includes("「海运费」在专业模式里改了类别或算法，这张表不再管它")), "专业模式把海运费改成按柜计：列在其它成本行并写明", g7.notices);
    const p7 = await putLump(P, Q, { baseUpdatedAt: g7.quote.updatedAt, state: g7.state });
    const oc7db = await db.quoteCostLine.findUnique({ where: { id: oc7!.id } });
    ok(p7.status === 200 && oc7db?.calculationType === "PER_CONTAINER", "保存后它的算法仍是按柜计（不改回）");
    // 专业模式把定价方式改成成本加成、目标毛利率清空
    await proSave(Q, P, { pricingMethod: "MARKUP_ON_COST", pricingRate: null });
    const g8 = (await getLump(P, Q)).body as unknown as LumpView;
    const p8 = await putLump(P, Q, { baseUpdatedAt: g8.quote.updatedAt, state: g8.state });
    ok(g8.state.targetMarginPct === null && p8.status === 400 && String(p8.body.error).includes("先填目标毛利率"), "改了定价方式、没填目标毛利率：400，写着先填目标毛利率", p8.body.error);
    const p8b = await putLump(P, Q, { baseUpdatedAt: g8.quote.updatedAt, state: { ...g8.state, targetMarginPct: 25 } });
    ok(p8b.status === 200 && (await db.projectQuote.findUnique({ where: { id: Q } }))!.pricingMethod === "MARGIN_ON_REVENUE", "填上目标毛利率再存：改回按售价毛利");

    // —— 7. 权限与脱敏 ——
    const v9 = p8b.body as unknown as LumpView;
    const before9 = await snap(Q);
    const r9 = await getLump(P, Q, OPERATOR);
    const w9 = await putLump(P, Q, { baseUpdatedAt: v9.quote.updatedAt, state: v9.state }, OPERATOR);
    const c9 = await convert(P, Q, { to: "LINE", baseUpdatedAt: v9.quote.updatedAt }, OPERATOR);
    const leaks = [r9, w9, c9].some((r) => /800000|800,000|2 个 40 尺柜|合成仓储费|合成供应商甲/.test(r.text));
    ok([r9, w9, c9].every((r) => r.status === 403) && !leaks && (await snap(Q)) === before9, "有编辑权、没有财务查看权的成员：读、存、转换都 403（不断言提示文字），响应里没有金额、备注、品名与供应商，库里不变", [r9.status, w9.status, c9.status]);
    const r10 = await getLump(P, Q, FINVIEW);
    const w10 = await putLump(P, Q, { baseUpdatedAt: v9.quote.updatedAt, state: v9.state }, FINVIEW);
    const c10 = await convert(P, Q, { to: "LINE", baseUpdatedAt: v9.quote.updatedAt }, FINVIEW);
    ok(r10.status === 200 && w10.status === 403 && c10.status === 403 && (await snap(Q)) === before9, "有财务查看权的只读成员：能读，存与转换 403");
    const out = await getLump(P, Q, OUTSIDER);
    const outW = await putLump(P, Q, { baseUpdatedAt: v9.quote.updatedAt, state: v9.state }, OUTSIDER);
    const outC = await convert(P, Q, { to: "LINE", baseUpdatedAt: v9.quote.updatedAt }, OUTSIDER);
    ok([out, outW, outC].every((r) => r.status >= 400 && r.status < 500 && !/800000|合成仓储费/.test(r.text)) && (await snap(Q)) === before9, "别的组织的人：读、存、转换都被拒，没有内容，库里不变", [out.status, outW.status, outC.status]);
    const qBefore = await db.projectQuote.count({ where: { projectId: P } });
    const cOp = await create(P, { entryMode: "LUMP_SUM", businessType: "SUPPLY_ONLY" }, OPERATOR);
    const cFv = await create(P, { entryMode: "LUMP_SUM", businessType: "SUPPLY_ONLY" }, FINVIEW);
    ok(cOp.status === 403 && cFv.status === 403 && (await db.projectQuote.count({ where: { projectId: P } })) === qBefore, "有编辑权没有财务查看权的成员、只读成员新建只报总价：都 403，没建出报价", [cOp.status, cFv.status]);
    ok((await putLump(P, Q, { nope: 1 })).status === 400 && (await convert(P, Q, { to: "SIDEWAYS" })).status === 400, "请求体格式不对：存与转换都 400");
    // 跨项目
    const PB = await mkProject();
    const before11 = await snap(Q);
    const x1 = await getLump(PB, Q);
    const x2 = await putLump(PB, Q, { baseUpdatedAt: v9.quote.updatedAt, state: v9.state });
    const x3 = await convert(PB, Q, { to: "LINE", baseUpdatedAt: v9.quote.updatedAt });
    ok([x1, x2, x3].every((r) => r.status === 404) && !/800000|合成仓储费/.test(x1.text + x2.text + x3.text) && (await snap(Q)) === before11, "拿 A 项目的报价走 B 项目的地址读、存、转换：都 404，没有内容、库里不变", [x1.status, x2.status, x3.status]);

    // —— 8. 不是总价报价、币种改了 ——
    const PL = await mkProject();
    const cl = await create(PL, { entryMode: "LINE", businessType: "SUPPLY_ONLY" });
    const QL = String(cl.body.id);
    const nl = await getLump(PL, QL);
    const nlw = await putLump(PL, QL, { baseUpdatedAt: "x", state: v9.state });
    ok(nl.status === 409 && String(nl.body.error).includes("不是按「只报总价」做的") && nlw.status === 409, "读、存一份逐行报价的总价视图：409，写着不是只报总价的报价", nl.body);
    const nll = await getLine(P, Q);
    ok(nll.status === 409, "读一份总价报价的逐行视图：409");

    // —— 9. 互转：逐行 → 总价 → 逐行（逐行保存一次）→ 总价 ——
    const vl0 = (await getLine(PL, QL)).body as unknown as LineView;
    const lineState = {
      ...vl0.state,
      rows: [
        { costLineId: null, description: "合成卷帘 A", quantity: 100, uom: "Each", packCount: null, basis: "PER_TENDER_UOM", unitPrice: 50, currency: "CNY", evidenceKind: "ESTIMATE", inquiryItemId: null, supplierId: null, supplierName: null, rowSource: "manual" },
        { costLineId: null, description: "合成配件 B", quantity: 20, uom: "Box", packCount: 10, basis: "PER_PIECE", unitPrice: 3, currency: "CNY", evidenceKind: "ESTIMATE", inquiryItemId: null, supplierId: null, supplierName: null, rowSource: "manual" },
      ],
      fx: { CNY: { rate: 0.19, source: "合成" }, USD: { rate: 1.37, source: "合成" } },
      shared: { oceanFreight: { containers: 2, perContainer: 3000, currency: "USD" }, customs: { amount: 500, currency: "CAD" }, domesticFreight: { amount: null, currency: "CAD" }, dutyPct: 8 },
      targetMarginPct: 22,
    };
    const sl = await putLine(PL, QL, { baseUpdatedAt: vl0.quote.updatedAt, state: lineState });
    const vl1 = sl.body as unknown as LineView;
    const tL = vl1.computed?.ok ? vl1.computed.totals : null;
    const cv1 = await convert(PL, QL, { to: "LUMP_SUM", baseUpdatedAt: vl1.quote.updatedAt });
    const vs1 = (await getLump(PL, QL)).body as unknown as LumpView;
    const tS = vs1.computed?.ok ? vs1.computed.totals : null;
    const oc = vs1.state ? it(vs1.state, "ocean_freight") : undefined;
    ok(sl.status === 200 && cv1.status === 200 && cv1.body.entryMode === "LUMP_SUM" && cv1.body.id === QL, "逐行 → 总价：200，返回报价标识与做法「只报总价」", cv1.body);
    ok(vs1.state.goods.mode === "detail" && vs1.state.details.length === 2 && oc?.amount === 6000 && oc.currency === "USD" && vs1.state.fx.USD?.rate === 1.37 && it(vs1.state, "customs")?.amount === 500 && it(vs1.state, "duty")?.kind === "percent" && it(vs1.state, "duty")?.ratePct === 8, "货品展开成 2 条明细，海运费 6,000 美元（汇率不变）、报关费 500、关税按货值 8%", vs1.state.items);
    ok(!!tL && !!tS && tL.estimatedCost === tS.estimatedCost && tL.sellingPrice === tS.sellingPrice && tL.grossProfit === tS.grossProfit, "转换前后成本合计、税前报价、利润相同", { tL, tS });
    const convAudit = await db.auditLog.findFirst({ where: { targetId: QL, action: "quote_updated" }, orderBy: { createdAt: "desc" } });
    ok(!!convAudit && JSON.stringify(convAudit.afterData).includes("LINE→LUMP_SUM"), "审计里有一条转换");
    const same = await putLump(PL, QL, { baseUpdatedAt: vs1.quote.updatedAt, state: vs1.state });
    const vs1b = same.body as unknown as LumpView;
    ok(same.status === 200 && vs1b.computed.ok && vs1b.computed.totals.sellingPrice === tS!.sellingPrice, "转换后不改任何数原样保存：200，数不变");
    // 加一项安装（带备注），再转逐行
    const s2 = { ...vs1b.state, items: [...vs1b.state.items, mkItem("installation", { amount: 2000, notes: "合成安装备注" })] };
    const sv2 = await putLump(PL, QL, { baseUpdatedAt: vs1b.quote.updatedAt, state: s2 });
    const vs2 = sv2.body as unknown as LumpView;
    const tS2 = vs2.computed.ok ? vs2.computed.totals : null;
    ok(sv2.status === 200 && vs2.convertToLine.available === true, "加安装 2,000 后：可以转逐行");
    const cv2 = await convert(PL, QL, { to: "LINE", baseUpdatedAt: vs2.quote.updatedAt });
    const vl2 = (await getLine(PL, QL)).body as unknown as LineView;
    const tL2 = vl2.computed?.ok ? vl2.computed.totals : null;
    ok(cv2.status === 200 && cv2.body.entryMode === "LINE" && vl2.state.rows.length === 2 && vl2.state.shared.customs.amount === 500 && vl2.state.shared.dutyPct === 8 && vl2.state.shared.oceanFreight.containers === null, "总价 → 逐行：逐行表 2 行、报关费 500、关税率 8%、海运柜数空着", cv2.body);
    ok(vl2.notices.some((n) => n.includes("「海运费」按金额算在下面「从只报总价转来的项」里")) && vl2.others.filter((o) => o.fromLump && o.included).map((o) => o.description).sort().join(",") === "安装,海运费", "海运费与安装列在「从只报总价转来的项」里，写着海运费不要再填柜数", { notices: vl2.notices, others: vl2.others });
    ok(!!tS2 && !!tL2 && tS2.estimatedCost === tL2.estimatedCost && tS2.sellingPrice === tL2.sellingPrice && tS2.grossProfit === tL2.grossProfit, "总价 → 逐行前后成本合计、税前报价、利润相同", { tS2, tL2 });
    ok(vl2.state.rows[1].basis === "PER_PIECE" && vl2.state.rows[1].packCount === 10 && vl2.state.rows[1].unitPrice === 3, "按件报价的行：仍是按件、每盒 10 件、每件 3 元");
    const fromLumpBefore = JSON.stringify((await db.quoteCostLine.findMany({ where: { quoteId: QL }, orderBy: { id: "asc" } })).filter((l) => readLumpMeta(l.metadata)).map((l) => [l.id, String(l.unitCost), l.included, l.notes, l.calculationType]));
    const sl3 = await putLine(PL, QL, { baseUpdatedAt: vl2.quote.updatedAt, state: vl2.state });
    const vl3 = sl3.body as unknown as LineView;
    const fromLumpAfter = JSON.stringify((await db.quoteCostLine.findMany({ where: { quoteId: QL }, orderBy: { id: "asc" } })).filter((l) => readLumpMeta(l.metadata)).map((l) => [l.id, String(l.unitCost), l.included, l.notes, l.calculationType]));
    ok(sl3.status === 200 && fromLumpBefore === fromLumpAfter && vl3.computed.ok && vl3.computed.totals.sellingPrice === tL2!.sellingPrice, "在逐行表里保存一次：从只报总价转来的两项原样还在、计入成本", sl3.body.error);
    const cv3 = await convert(PL, QL, { to: "LUMP_SUM", baseUpdatedAt: vl3.quote.updatedAt });
    const vs3 = (await getLump(PL, QL)).body as unknown as LumpView;
    const tS3 = vs3.computed?.ok ? vs3.computed.totals : null;
    ok(cv3.status === 200 && vs3.state.items.filter((i) => i.key === "ocean_freight").length === 1 && it(vs3.state, "ocean_freight")?.amount === 6000 && it(vs3.state, "installation")?.amount === 2000 && it(vs3.state, "installation")?.notes === "合成安装备注" && vs3.others.length === 0, "再转回总价：只有一项海运费（6,000）、一项安装，备注都还在，没有多出来的行", { items: vs3.state?.items, others: vs3.others });
    ok(!!tS3 && tS3.sellingPrice === tS2!.sellingPrice && tS3.estimatedCost === tS2!.estimatedCost, "往返每一步的成本合计、税前报价都相同");
    // 脱敏（一份有明细品名、备注、能转成逐行的总价报价）：没有财务查看权的人读、存、转换都 403，响应里没有品名 / 备注 / 金额，库里不变
    const vLeak = (await getLump(PL, QL)).body as unknown as LumpView;
    const beforeLeak = await snap(QL);
    const lr = await getLump(PL, QL, OPERATOR);
    const lw = await putLump(PL, QL, { baseUpdatedAt: vLeak.quote.updatedAt, state: vLeak.state }, OPERATOR);
    const lc = await convert(PL, QL, { to: "LINE", baseUpdatedAt: vLeak.quote.updatedAt }, OPERATOR);
    ok(vLeak.convertToLine.available === true && [lr, lw, lc].every((r) => r.status === 403 && !/合成卷帘|合成配件|合成安装备注|6000|2000/.test(r.text)) && (await snap(QL)) === beforeLeak, "可转逐行的总价报价：没有财务查看权的成员读、存、转换都 403，响应里没有品名、备注、金额，库里不变", [lr.status, lw.status, lc.status]);

    // —— 10. 不该转的请求 ——
    const vs3n = (await getLump(PL, QL)).body as unknown as LumpView;
    const before12 = await snap(QL);
    const n1 = await convert(PL, QL, { to: "LUMP_SUM", baseUpdatedAt: vs3n.quote.updatedAt });
    const n2 = await convert(PL, QL, { to: "LINE", baseUpdatedAt: "2000-01-01T00:00:00.000Z" });
    const proQ = String(c3.body.id);
    const pv = await db.projectQuote.findUnique({ where: { id: proQ } });
    const n3 = await convert(P, proQ, { to: "LUMP_SUM", baseUpdatedAt: pv!.updatedAt.toISOString() });
    const v2x = (await getLump(P, Q2)).body as unknown as LumpView;
    const n4 = await convert(P, Q2, { to: "LINE", baseUpdatedAt: v2x.quote.updatedAt });
    const vQ = (await getLump(P, Q)).body as unknown as LumpView;
    const n5 = await convert(P, Q, { to: "LINE", baseUpdatedAt: vQ.quote.updatedAt });
    ok(n1.status === 409 && n2.status === 409 && n3.status === 409 && n4.status === 409 && n5.status === 409 && (await snap(QL)) === before12, "转到当前做法 / 旧修改时间 / 专业模式报价 / 供货加安装转逐行 / 货品是总数转逐行：都 409，库里不变", [n1.body.error, n2.body.error, n3.body.error, n4.body.error, n5.body.error]);
    ok(String(n4.body.error).includes("逐行报价限于只供货") && String(n5.body.error).includes("先展开成明细"), "拒绝原因写明（限于只供货 / 先展开成明细）");

    // —— 11. 我方报价是总价报价、另起新版 ——
    await transitionQuote({ quoteId: Q, projectId: P, userId: OWNER, orgId: ORG, to: "review" }).catch(() => undefined);
    await transitionQuote({ quoteId: Q, projectId: P, userId: OWNER, orgId: ORG, to: "approved" });
    let bid = await resolveTenderBid({ projectId: P, orgId: ORG, internal: true });
    if (bid.status !== "AUTHORITATIVE" || bid.quote?.id !== Q) bid = await selectQuoteAsTenderBid({ projectId: P, quoteId: Q, orgId: ORG, userId: OWNER, reason: "fixture" });
    const lx = (await list(P)).body as unknown as ListView;
    const ex = await exp(P, Q);
    ok(bid.quote?.id === Q && !lx.export.available && lx.export.reasonZh === "我方报价是只报总价的，没有逐行单价，不能按招标方价格表导出；招标方要价格表的话，请用逐行报价做一份并定为我方报价" && ex.status === 409, "我方报价是总价报价：导出不可用、原因写明没有逐行单价；导出接口 409", lx.export);
    const vf = (await getLump(P, Q)).body as unknown as LumpView;
    const fz = await putLump(P, Q, { baseUpdatedAt: vf.quote.updatedAt, state: vf.state });
    const fc = await convert(P, Q, { to: "LINE", baseUpdatedAt: vf.quote.updatedAt });
    ok(vf.quote.frozen && fz.status === 409 && String(fz.body.error).includes("已批准") && fc.status === 409, "已批准：存与转换都 409", fz.body.error);
    const rev = await reviseQuote({ quoteId: Q, projectId: P, userId: OWNER, orgId: ORG, reason: "fixture 改价" });
    const revQ = await db.projectQuote.findUnique({ where: { id: rev.id } });
    const er = revQ!.engineJson as { entryMode?: string; tax?: { hstPct?: number } };
    ok(er.entryMode === "LUMP_SUM" && er.tax?.hstPct === 7 && (await getLump(P, rev.id)).status === 200, "另起新版：新版本的做法与税都还在，照样按总价构成表打开", er);
    // 币种改成美元
    await proSave(Q2, P, { currency: "USD" });
    const usd = await getLump(P, Q2);
    ok(usd.status === 409 && String(usd.body.error).includes("美元（USD）") && String(usd.body.error).includes("只能用加元"), "专业模式把币种改成美元：读总价视图 409，叫去专业模式", usd.body);

    // —— 12. 审查补充：原样带回的数、拒绝转换的情况进库、行的先后、开关关时不读请求体 ——
    const PX = await mkProject();
    const cx = await create(PX, { entryMode: "LINE", businessType: "SUPPLY_ONLY" });
    const QX = String(cx.body.id);
    const vx0 = (await getLine(PX, QX)).body as unknown as LineView;
    const rowX = { costLineId: null, description: "合成卷帘 X", quantity: 10, uom: "Each", packCount: null, basis: "PER_TENDER_UOM", unitPrice: 40, currency: "CAD", evidenceKind: "ESTIMATE", inquiryItemId: null, supplierId: null, supplierName: null, rowSource: "manual" };
    const sx = await putLine(PX, QX, { baseUpdatedAt: vx0.quote.updatedAt, state: { ...vx0.state, rows: [rowX], shared: { ...vx0.state.shared, oceanFreight: { containers: 1.5, perContainer: 2345.67, currency: "CAD" } }, targetMarginPct: 20 } });
    const vx1 = sx.body as unknown as LineView;
    const cvx = await convert(PX, QX, { to: "LUMP_SUM", baseUpdatedAt: vx1.quote.updatedAt });
    const vx2 = (await getLump(PX, QX)).body as unknown as LumpView;
    ok(cvx.status === 200 && it(vx2.state, "ocean_freight")?.amount === 3518.505, "逐行 1.5 柜 × 2,345.67 转成总价：海运费 3,518.505（4 位小数内）", cvx.body);
    const longNote = "合".repeat(1500);
    const sx2 = await putLump(PX, QX, { baseUpdatedAt: vx2.quote.updatedAt, state: { ...vx2.state, items: vx2.state.items.map((i) => (i.key === "ocean_freight" ? { ...i, notes: longNote } : i.key === "duty" ? { ...i, kind: "percent", ratePct: 100 } : i)) } });
    const vx3 = sx2.body as unknown as LumpView;
    const sx3 = await putLump(PX, QX, { baseUpdatedAt: vx3.quote.updatedAt, state: vx3.state });
    const vx4 = sx3.body as unknown as LumpView;
    ok(sx2.status === 200 && sx3.status === 200 && it(vx4.state, "ocean_freight")?.amount === 3518.505 && it(vx4.state, "ocean_freight")?.notes === longNote && it(vx4.state, "duty")?.ratePct === 100, "原样带回的数（海运费 3,518.505、关税比例 100、1,500 字备注）读出后不改直接保存：200，数与备注不变", [sx2.body.error, sx3.body.error]);
    // 共用参数的算法在专业模式里改过：转换 409，库里不变
    const cy = await create(PX, { entryMode: "LINE", businessType: "SUPPLY_ONLY" });
    const QY = String(cy.body.id);
    const vy0 = (await getLine(PX, QY)).body as unknown as LineView;
    await putLine(PX, QY, { baseUpdatedAt: vy0.quote.updatedAt, state: { ...vy0.state, rows: [rowX], shared: { ...vy0.state.shared, oceanFreight: { containers: 2, perContainer: 3000, currency: "CAD" } }, targetMarginPct: 20 } });
    await proSave(QY, PX, { engine: {} }, (l) => (l.calculationType === "PER_CONTAINER" ? { ...l, calculationType: "FIXED" } : l));
    const vy1 = await db.projectQuote.findUnique({ where: { id: QY } });
    const beforeY = await snap(QY);
    const cvy = await convert(PX, QY, { to: "LUMP_SUM", baseUpdatedAt: vy1!.updatedAt.toISOString() });
    ok(cvy.status === 409 && String(cvy.body.error).includes("「海运费」的类别或算法在专业模式里改过") && (await snap(QY)) === beforeY, "逐行报价的海运费在专业模式里改成固定金额：转换 409、写明先在逐行表里保存一次，库里不变", cvy.body.error);
    // 总数和明细在专业模式里都设成了计入：转逐行 409，库里不变
    await proSave(QX, PX, { engine: {} }, (l) => (l._key === "goods_total" ? { ...l, included: true } : l));
    const vx5 = await db.projectQuote.findUnique({ where: { id: QX } });
    const beforeX = await snap(QX);
    const cvx2 = await convert(PX, QX, { to: "LINE", baseUpdatedAt: vx5!.updatedAt.toISOString() });
    ok(cvx2.status === 409 && String(cvx2.body.error).includes("货品总数和明细都计入了") && (await snap(QX)) === beforeX, "总数和明细都计入：转逐行 409，写明先在总价表里保存一次，库里不变", cvx2.body.error);
    // 行的先后（审查反例）：经服务转换，要么不转，要么转换后按库里顺序重算与转换前完全相同
    const zq = await createLumpQuote({ projectId: PX, orgId: ORG, userId: OWNER, businessType: "SUPPLY_ONLY" });
    const z0 = (await getLump(PX, zq.id)).body as unknown as LumpView;
    const zs = await saveLumpView({ projectId: PX, orgId: ORG, quoteId: zq.id, userId: OWNER, caps: { canEdit: true, canApprove: true }, request: { baseUpdatedAt: z0.quote.updatedAt, state: { ...z0.state, goods: { ...z0.state.goods, mode: "detail" }, details: [{ ...rowX, quantity: 1, unitPrice: 78260.73 }], items: [mkItem("ocean_freight", { amount: 8522.32 }), mkItem("duty"), mkItem("domestic_freight", { amount: 2390.06 }), mkItem("customs", { amount: 1802.39 }), mkItem("contingency", { ratePct: 3 })], tax: { hstPct: 13, gstPct: null, pstPct: null }, targetMarginPct: 20 } as never } });
    const zBefore = zs.computed.ok ? zs.computed.totals : null;
    let zStatus = 200;
    try { await convertQuote({ projectId: PX, orgId: ORG, quoteId: zq.id, userId: OWNER, request: { to: "LINE", baseUpdatedAt: zs.quote.updatedAt } }); } catch (e) { zStatus = (e as { status?: number }).status ?? 500; }
    const zAfterQ = await getQuote(zq.id, PX);
    const { computeForQuote } = await import("@/lib/quote-engine/service");
    const zAfter = computeForQuote(zAfterQ).calc;
    ok(!!zBefore && zAfter.ok && (zStatus === 409 ? (zAfterQ.engineJson as { entryMode?: string }).entryMode === "LUMP_SUM" : zStatus === 200 && zAfter.estimatedCost === zBefore.estimatedCost && zAfter.sellingPrice === zBefore.sellingPrice), "审查反例（行的先后会让预备金差一分）：要么 409 不转、库里还是只报总价，要么转换后按库里顺序重算完全相同", { zStatus, zBefore, after: zAfter.ok ? [zAfter.estimatedCost, zAfter.sellingPrice] : zAfter });
    // 还没有货品行的逐行报价（刚新建、没有价格表）也能转成总价；GST + PST 两项税；手填货品总数不用提交里的供应商
    const cn = await create(PX, { entryMode: "LINE", businessType: "SUPPLY_ONLY" });
    const QN = String(cn.body.id);
    const vn0 = (await getLine(PX, QN)).body as unknown as LineView;
    const cvn = await convert(PX, QN, { to: "LUMP_SUM", baseUpdatedAt: vn0.quote.updatedAt });
    const vn1 = (await getLump(PX, QN)).body as unknown as LumpView;
    ok(cvn.status === 200 && vn0.state.rows.length === 0 && vn1.state.goods.mode === "total" && vn1.state.goods.amount === null, "还没有货品行的逐行报价转成总价：200，货品填总数、空着", cvn.body.error);
    const pn = await putLump(PX, QN, { baseUpdatedAt: vn1.quote.updatedAt, state: { ...vn1.state, goods: { ...vn1.state.goods, amount: 1000, evidenceKind: "ESTIMATE", supplierId: "spoofed0", supplierName: "任意供应商" }, tax: { hstPct: null, gstPct: 5, pstPct: 7 }, targetMarginPct: 20 } });
    const vn2 = pn.body as unknown as LumpView;
    const gtn = (await db.quoteCostLine.findMany({ where: { quoteId: QN } })).find((l) => readLumpMeta(l.metadata)?.key === "goods_total");
    const tn = vn2.computed?.ok ? vn2.computed.totals : null;
    const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
    ok(pn.status === 200 && gtn?.supplierId === null && gtn?.supplierName === null, "手填货品总数：提交里带的供应商不用（库里没有供应商）", pn.body.error);
    ok(!!tn && tn.salesTax === r2(r2(tn.sellingPrice * 0.05) + r2(tn.sellingPrice * 0.07)) && tn.totalWithTax === r2(tn.sellingPrice + tn.salesTax) && tn.salesTax > 0, "GST 5% + PST 7%：销售税 = 两项各自取到分再相加，含税总价 = 税前报价 + 销售税", tn);

    // 开关关：拿真实报价、合法请求体调存与转换，守卫后立刻 404，没读请求体、库里不变
    const vOff = (await getLump(PX, QX)).body as unknown as LumpView;
    const beforeOff = await snap(QX);
    process.env.TENDER_BID_PAGE_V2_ENABLED = "";
    const spied = async (url: string, method: string, body: unknown) => {
      const r = await req(url, OWNER, { method, body });
      let reads = 0;
      const orig = r.json.bind(r);
      (r as unknown as { json: () => Promise<unknown> }).json = async () => { reads += 1; return orig(); };
      return { r, reads: () => reads };
    };
    const sp1 = await spied(`/api/projects/${PX}/bid-page/quotes/${QX}/lump`, "PUT", { baseUpdatedAt: vOff.quote.updatedAt, state: vOff.state });
    const o1 = await json(await lumpRoute.PUT(sp1.r, pq(PX, QX)));
    const sp2 = await spied(`/api/projects/${PX}/bid-page/quotes/${QX}/convert`, "POST", { to: "LINE", baseUpdatedAt: vOff.quote.updatedAt });
    const o2 = await json(await convertRoute.POST(sp2.r, pq(PX, QX)));
    const sp3 = await spied(`/api/projects/${PX}/bid-page/quotes`, "POST", { entryMode: "LUMP_SUM", businessType: "SUPPLY_ONLY" });
    const o3 = await json(await listRoute.POST(sp3.r, { params: Promise.resolve({ id: PX }) }));
    ok([o1, o2, o3].every((r) => r.status === 404 && r.body.error === "新版标书与报价页未启用") && sp1.reads() + sp2.reads() + sp3.reads() === 0 && (await snap(QX)) === beforeOff, "开关关：真实报价上的存、转换、新建都 404，请求体一次都没读，库里不变", [o1.status, o2.status, o3.status, sp1.reads(), sp2.reads(), sp3.reads()]);
    process.env.TENDER_BID_PAGE_V2_ENABLED = "1";
  } finally {
    for (const k of ENV_KEYS) delete process.env[k];
    await db.project.updateMany({ where: { id: { in: projectIds } }, data: { bidQuoteId: null } });
    await db.projectQuote.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.inquiryItem.deleteMany({ where: { inquiry: { projectId: { in: projectIds } } } });
    await db.projectInquiry.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.supplier.deleteMany({ where: { id: { in: supplierIds } } });
    await db.projectMember.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.auditLog.deleteMany({ where: { OR: [{ orgId: { in: [ORG, ORG_B] } }, { userId: { in: users } }, { projectId: { in: projectIds } }] } });
    await db.notification.deleteMany({ where: { userId: { in: users } } });
    await db.bidIntelligenceRoom.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.project.deleteMany({ where: { id: { in: projectIds } } });
    await db.principalRoleBinding.deleteMany({ where: { orgId: { in: [ORG, ORG_B] } } });
    await db.roleProfile.deleteMany({ where: { orgId: { in: [ORG, ORG_B] } } }).catch(() => undefined);
    await db.organizationMember.deleteMany({ where: { orgId: { in: [ORG, ORG_B] } } });
    await db.organization.deleteMany({ where: { id: { in: [ORG, ORG_B] } } }).catch(() => undefined);
    await db.user.deleteMany({ where: { id: { in: users } } }).catch(() => undefined);
    await db.$disconnect();
  }

  console.log(`\nBIDPAGE-4 只报总价 隔离库：${pass} 通过，${fail} 失败`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
