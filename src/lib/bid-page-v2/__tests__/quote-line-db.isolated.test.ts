/**
 * BIDPAGE-3 逐行报价——真实 DB（隔离库）经真实路由处理函数
 * （openspec change quote-line-mode-persist，spec tender/quote-line-mode）
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated \
 *   npx tsx src/lib/bid-page-v2/__tests__/quote-line-db.isolated.test.ts
 * 无隔离库时自动跳过。全部数据为 fixture（虚构组织 / 用户 / 供应商 / 合成金额）。不发任何邮件、不批准任何询价卡。
 */
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过 BIDPAGE-3 逐行报价 DB 测试（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "BIDPAGE-3 逐行报价 隔离库测试" });

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
  const { computeForQuote, getQuote, reviseQuote, transitionQuote, updateEngineQuote } = await import("@/lib/quote-engine/service");
  const { resolveTenderBid, selectQuoteAsTenderBid } = await import("@/lib/quote-engine/tender-bid");
  const { seedOrgAuthorizationProfiles } = await import("@/lib/authorization/seed-org-profiles");
  const { readBidLineMeta } = await import("@/lib/bid-page-v2/quote-line/contract");
  const listRoute = await import("@/app/api/projects/[id]/bid-page/quotes/route");
  const lineRoute = await import("@/app/api/projects/[id]/bid-page/quotes/[quoteId]/line/route");
  const exportRoute = await import("@/app/api/projects/[id]/bid-page/quotes/[quoteId]/export/route");
  type LineView = import("@/lib/bid-page-v2/quote-line/contract").LineModeView;
  type ListView = import("@/lib/bid-page-v2/quote-line/contract").QuoteListView;

  console.log("BIDPAGE-3 逐行报价——隔离库");
  const stamp = Date.now().toString(36);
  const OWNER = `qlowner_${stamp}`, FINEDIT = `qlfinedit_${stamp}`, FINVIEW = `qlfinview_${stamp}`, OPERATOR = `qlop_${stamp}`, VIEWER = `qlviewer_${stamp}`, OUTSIDER = `qlout_${stamp}`;
  const ORG = `qlorg_${stamp}`, ORG_B = `qlorgb_${stamp}`;
  const users = [OWNER, FINEDIT, FINVIEW, OPERATOR, VIEWER, OUTSIDER];
  const email = (id: string) => `${id}@fixture.test`;
  const ENV_KEYS = ["TENDER_BID_PAGE_V2_ENABLED", "TENDER_BID_PAGE_V2_ORG_ALLOWLIST", "TENDER_QUOTE_ENGINE_ENABLED", "TENDER_BID_WORKSPACE_ENABLED"];
  for (const k of ENV_KEYS) delete process.env[k];
  process.env.TENDER_QUOTE_ENGINE_ENABLED = "1";

  for (const id of users) await db.user.create({ data: { id, email: email(id), name: `Fixture ${id}`, role: "user" } });
  await db.organization.create({ data: { id: ORG, name: "Fixture Bidder Inc.", code: `ql-${stamp}`, ownerId: OWNER, industryPackId: "window_covering_services_v1" } });
  await db.organization.create({ data: { id: ORG_B, name: "Other Fixture Org", code: `qlb-${stamp}`, ownerId: OUTSIDER } });
  for (const [u, role] of [[OWNER, "org_admin"], [FINEDIT, "org_member"], [FINVIEW, "org_member"], [OPERATOR, "org_member"], [VIEWER, "org_member"]] as const) {
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
    const id = `qlproj_${stamp}_${seq}`;
    projectIds.push(id);
    await db.project.create({ data: { id, name: `Fixture Tender ${stamp}-${seq}`, orgId: ORG, ownerId: OWNER, workDomain: "tender", intakeStatus: "dispatched" } });
    for (const [u, role] of [[FINEDIT, "operator"], [FINVIEW, "viewer"], [OPERATOR, "operator"], [VIEWER, "viewer"]] as const) await db.projectMember.create({ data: { projectId: id, userId: u, role, status: "active" } });
    return id;
  }
  const cookieOf = async (userId: string) => `qy_session=${await createSession({ sub: userId, email: email(userId), role: "user" })}`;
  const req = async (url: string, userId: string | null, init: { method?: string; body?: unknown } = {}) =>
    new NextRequest(`http://localhost${url}`, { method: init.method ?? "GET", headers: { ...(userId ? { cookie: await cookieOf(userId) } : {}), ...(init.body !== undefined ? { "content-type": "application/json" } : {}) }, body: init.body !== undefined ? JSON.stringify(init.body) : undefined });
  const json = async (res: Response) => {
    const text = await res.text();
    let body: Record<string, unknown> = {};
    try { body = JSON.parse(text); } catch { /* CSV */ }
    return { status: res.status, text, body };
  };
  const list = async (P: string, u: string | null = OWNER) => json(await listRoute.GET(await req(`/api/projects/${P}/bid-page/quotes`, u), { params: Promise.resolve({ id: P }) }));
  const create = async (P: string, body: unknown, u: string | null = OWNER) => json(await listRoute.POST(await req(`/api/projects/${P}/bid-page/quotes`, u, { method: "POST", body }), { params: Promise.resolve({ id: P }) }));
  const getLine = async (P: string, Q: string, u: string | null = OWNER) => json(await lineRoute.GET(await req(`/api/projects/${P}/bid-page/quotes/${Q}/line`, u), { params: Promise.resolve({ id: P, quoteId: Q }) }));
  const putLine = async (P: string, Q: string, body: unknown, u: string | null = OWNER) => json(await lineRoute.PUT(await req(`/api/projects/${P}/bid-page/quotes/${Q}/line`, u, { method: "PUT", body }), { params: Promise.resolve({ id: P, quoteId: Q }) }));
  const exp = async (P: string, Q: string, u: string | null = OWNER) => json(await exportRoute.GET(await req(`/api/projects/${P}/bid-page/quotes/${Q}/export`, u), { params: Promise.resolve({ id: P, quoteId: Q }) }));
  const linesSnap = async (Q: string) => JSON.stringify((await db.quoteCostLine.findMany({ where: { quoteId: Q }, orderBy: { id: "asc" } })).map((l) => [l.id, l.description, String(l.unitCost), String(l.quantity), l.included, l.metadata, l.updatedAt.toISOString()]));

  try {
    const P = await mkProject();
    // 投标工作区存下的价格表（2 行，合成）——不打开投标工作区开关
    await db.bidIntelligenceRoom.create({
      data: {
        orgId: ORG,
        projectId: P,
        summaryJson: {
          bidWorkspace: {
            version: 1,
            priceSchedule: { lines: [{ lineNo: 1, description: "合成卷帘 A（Fixture roller shade）", quantity: 100, uom: "Each" }, { lineNo: 2, description: "合成配件 B", quantity: 20, uom: "Box", packCount: 10 }] },
            lineDetails: {},
            documentHolders: null,
            addenda: [],
            updatedAt: new Date().toISOString(),
            updatedById: OWNER,
          },
          pricingInputs: { ourCostCad: 1 },
        },
      },
    });
    const workspaceOf = async () => JSON.stringify(((await db.bidIntelligenceRoom.findFirst({ where: { projectId: P } }))?.summaryJson as { bidWorkspace?: unknown } | null)?.bidWorkspace ?? null);
    const roomBefore = await workspaceOf();
    const supplier = await db.supplier.create({ data: { orgId: ORG, name: "合成供应商甲", contactEmail: `qlsupa${stamp}@fixture.test`, status: "active", createdById: OWNER } });
    supplierIds.push(supplier.id);
    const round = await db.projectInquiry.create({ data: { projectId: P, roundNumber: 1, title: "round 1", scope: "x", status: "in_progress", createdById: OWNER } });
    const replied = await db.inquiryItem.create({ data: { inquiryId: round.id, supplierId: supplier.id, status: "quoted", sentAt: new Date(), repliedAt: new Date(), unitPrice: new Prisma.Decimal(30), currency: "CNY", createdById: OWNER } });

    // —— 1. 开关 ——
    const anon = await list(P, null);
    ok(anon.status === 401, "没登录：401（第一步先做报价权限守卫）", anon.status);
    const off = await list(P);
    ok(off.status === 404 && off.body.error === "新版标书与报价页未启用", "新页面开关没开：404", off.body);
    process.env.TENDER_BID_PAGE_V2_ENABLED = "1";
    process.env.TENDER_BID_PAGE_V2_ORG_ALLOWLIST = ORG_B;
    ok((await list(P)).status === 404, "组织不在名单里：404");
    process.env.TENDER_BID_PAGE_V2_ORG_ALLOWLIST = "";
    delete process.env.TENDER_QUOTE_ENGINE_ENABLED;
    ok((await list(P)).status === 404, "报价引擎没开：404");
    process.env.TENDER_QUOTE_ENGINE_ENABLED = "1";

    const l0 = await list(P);
    const v0 = l0.body as unknown as ListView;
    ok(l0.status === 200 && v0.quotes.length === 0 && v0.scheduleLineCount === 2 && !v0.export.available, "开了：列表为空、有可用价格表 2 行、不能导出", l0.body);

    // —— 2. 新建 ——
    const c1 = await create(P, { entryMode: "LINE", businessType: "SUPPLY_ONLY", name: "合成逐行报价" });
    const Q = String(c1.body.id);
    ok(c1.status === 201 && c1.body.entryMode === "LINE", "逐行 + 只供货：建好逐行报价", c1.body);
    const q1 = await db.projectQuote.findUnique({ where: { id: Q }, include: { costLines: true, lineItems: true } });
    const metas = q1!.costLines.map((l) => readBidLineMeta(l.metadata));
    ok(q1!.quoteType === "SUPPLY_ONLY" && (q1!.engineJson as { entryMode?: string }).entryMode === "LINE" && q1!.pricingMethod === "MARGIN_ON_REVENUE", "只供货报价、按售价毛利定价、配置里记做法为逐行");
    ok(metas.filter((m) => m?.role === "goods").length === 2 && metas.filter((m) => m?.role === "shared").length === 4 && metas.filter((m) => m?.role === "preset").length === 4 && q1!.costLines.length === 10, "同一次写入：2 条货品行（来自价格表）、4 条共用参数行、4 条预置行", metas);
    ok(q1!.lineItems.length === 0, "不写给客户报价单的明细行");
    const createdAudit = await db.auditLog.findFirst({ where: { targetId: Q, action: "quote_created" } });
    ok(!!createdAudit && JSON.stringify(createdAudit.afterData).includes("LINE"), "审计里有一条新建报价（带做法）");
    const c2 = await create(P, { entryMode: "LINE", businessType: "SUPPLY_INSTALL" });
    const Q2 = String(c2.body.id);
    const q2 = await db.projectQuote.findUnique({ where: { id: Q2 }, include: { costLines: true } });
    ok(c2.status === 201 && c2.body.entryMode === null && String(c2.body.proModeHref).endsWith(`/quote-engine/${Q2}`) && q2!.quoteType === "PROJECT_SUPPLY_INSTALL" && !(q2!.engineJson as { entryMode?: string }).entryMode && q2!.costLines.length > 20, "供货加安装：照改版前模板新建、不记做法、返回专业模式地址", { body: c2.body, lines: q2!.costLines.length });
    const notLine = await getLine(P, Q2);
    ok(notLine.status === 409 && String(notLine.body.error).includes("专业模式"), "不是逐行报价：读逐行视图 409，叫去专业模式");
    const bad = await create(P, { entryMode: "LUMP_SUM" });
    ok(bad.status === 400, "不认识的做法：400");

    // —— 3. 读与存 ——
    const g1 = await getLine(P, Q);
    const view1 = g1.body as unknown as LineView;
    ok(g1.status === 200 && view1.state.rows.length === 2 && view1.state.rows[0].description.startsWith("合成卷帘 A") && view1.state.rows[1].packCount === 10 && view1.inquiryQuotes.length === 1 && view1.seed === null, "读：两行照价格表、带询价回复；有行时不附带入文本", g1.body);
    const state = {
      ...view1.state,
      rows: [
        { ...view1.state.rows[0], unitPrice: 50, currency: "CNY", evidenceKind: "ESTIMATE" },
        { ...view1.state.rows[1], unitPrice: 30, currency: "CNY", basis: "PER_PIECE", inquiryItemId: replied.id, supplierId: "spoofed", supplierName: "冒名", evidenceKind: null },
      ],
      fx: { CNY: { rate: 0.19, source: "合成汇率" } },
      shared: { oceanFreight: { containers: 1, perContainer: 3000, currency: "CAD" }, customs: { amount: 250, currency: "CAD" }, domesticFreight: { amount: 1500, currency: "CNY" }, dutyPct: 8 },
      targetMarginPct: 25,
    };
    const beforeBad = await linesSnap(Q);
    const noEv = await putLine(P, Q, { baseUpdatedAt: view1.quote.updatedAt, state: { ...state, rows: [{ ...state.rows[0], evidenceKind: null }, state.rows[1]] } });
    ok(noEv.status === 400 && String(noEv.body.error).includes("第 1 行手填的报价要选证据类别") && (await linesSnap(Q)) === beforeBad, "手填没选证据：400 指出第 1 行，库里没变", noEv.body);
    const mismatch = await putLine(P, Q, { baseUpdatedAt: view1.quote.updatedAt, state: { ...state, rows: [state.rows[0], { ...state.rows[1], unitPrice: 31 }] } });
    ok(mismatch.status === 400 && String(mismatch.body.error).includes("与选中的询价回复不一致") && (await linesSnap(Q)) === beforeBad, "点选的回复被改了价：400，库里没变");
    const saved = await putLine(P, Q, { baseUpdatedAt: view1.quote.updatedAt, state });
    const view2 = saved.body as unknown as LineView;
    ok(saved.status === 200 && view2.computed.ok, "保存：200，算得出", saved.body);
    if (view2.computed.ok) {
      ok(view2.computed.totals.sellingPrice === 8092.08 && view2.computed.totals.estimatedCost === 6675.97 && view2.computed.allocation.linesTotal === 8091.8 && view2.computed.allocation.diff === -0.28, "四个数与逐行合计（合成数字：8,092.08 / 6,675.97 / 逐行 8,091.80）", view2.computed);
    }
    const dbQ = await getQuote(Q, P);
    const engine = computeForQuote(dbQ).calc;
    ok(engine.ok && view2.computed.ok && engine.sellingPrice === view2.computed.totals.sellingPrice && engine.grossProfit === view2.computed.totals.grossProfit, "顶部四个数 = 库里这份报价经报价引擎算出的结果");
    const bLine = dbQ.costLines.find((l) => (readBidLineMeta(l.metadata) as { lineNo?: number } | null)?.lineNo === 2)!;
    ok(Number(bLine.unitCost) === 300 && bLine.supplierId === supplier.id && bLine.supplierName === "合成供应商甲" && bLine.source === "询价回复", "按件 30 × 10 → 成本行 300；供应商取自库里的回复（不信提交里的供应商）", { unitCost: String(bLine.unitCost), supplierId: bLine.supplierId, name: bLine.supplierName });
    const g2 = await getLine(P, Q, FINEDIT);
    const view3 = g2.body as unknown as LineView;
    ok(g2.status === 200 && JSON.stringify(view3.state) === JSON.stringify(view2.state) && JSON.stringify(view3.computed) === JSON.stringify(view2.computed), "换一位有财务查看权的同事读：同样的行、参数与结果");
    const stale = await putLine(P, Q, { baseUpdatedAt: view1.quote.updatedAt, state }, FINEDIT);
    ok(stale.status === 409 && String(stale.body.error).includes("刚被别人改过"), "拿旧的修改时间保存：409，不写", stale.body);
    const updAudit = await db.auditLog.findFirst({ where: { targetId: Q, action: "quote_updated" } });
    ok(!!updAudit && JSON.stringify(updAudit.afterData).includes("LINE"), "保存写一条报价修改审计");

    // —— 4. 权限 ——
    for (const [u, name] of [[OPERATOR, "有编辑权、没有财务查看权的成员"], [VIEWER, "只读成员（有成本读权限、没有财务查看权）"]] as const) {
      const r = await getLine(P, Q, u);
      const w = await putLine(P, Q, { baseUpdatedAt: view2.quote.updatedAt, state }, u);
      const ls = await list(P, u);
      ok(r.status === 403 && w.status === 403 && ls.status === 403 && !r.text.includes("合成卷帘") && !r.text.includes("8092") && !ls.text.includes("8092"), `${name}：读、写、列表都 403，响应里没有金额与品名`, [r.status, w.status, ls.status]);
    }
    const fv = await getLine(P, Q, FINVIEW);
    const fvw = await putLine(P, Q, { baseUpdatedAt: view2.quote.updatedAt, state }, FINVIEW);
    ok(fv.status === 200 && fvw.status === 403, "有财务查看权、只读的成员：能读、不能存");
    const out = await getLine(P, Q, OUTSIDER);
    ok(out.status >= 400 && out.status < 500 && !out.text.includes("合成卷帘"), "别的组织的人：被拒，没有内容", out.status);
    ok((await create(P, { entryMode: "LINE", businessType: "SUPPLY_ONLY" }, FINVIEW)).status === 403, "没有编辑权限的人不能新建");

    // —— 5. 专业模式改过以后 ——
    const pcc = await getQuote(Q, P);
    const payload = pcc.costLines.map((l) => ({ id: l.id, sortOrder: l.sortOrder, category: l.category, subcategory: l.subcategory, description: l.description, quantity: l.quantity == null ? null : Number(l.quantity), unit: l.unit, unitCost: l.unitCost == null ? null : Number(l.unitCost), sourceCurrency: l.sourceCurrency, fxRate: l.fxRate == null ? null : Number(l.fxRate), fxRateSource: l.fxRateSource, calculationType: l.calculationType, calculationBase: l.calculationBase, rate: l.rate == null ? null : Number(l.rate), duration: l.duration == null ? null : Number(l.duration), supplierId: l.supplierId, supplierName: l.supplierName, source: l.source, notes: l.notes, included: l.included }));
    await updateEngineQuote({ quoteId: Q, projectId: P, userId: OWNER, header: { engine: {} }, lines: [...payload, { sortOrder: 5000, category: "FREIGHT", description: "加拿大境内运费（合成）", calculationType: "FIXED", unitCost: 400, sourceCurrency: "CAD", included: true } as never] });
    const afterPcc = await getQuote(Q, P);
    ok((afterPcc.engineJson as { entryMode?: string }).entryMode === "LINE" && afterPcc.costLines.filter((l) => readBidLineMeta(l.metadata)).length === 10, "专业模式保存（引擎配置传 {}）后：做法还在、10 条行身份都在");
    const g3 = await getLine(P, Q);
    const view4 = g3.body as unknown as LineView;
    ok(view4.others.length === 1 && view4.others[0].description.includes("加拿大境内运费") && view4.others[0].amount === 400, "专业模式加的行：算作其它成本行、列出金额", view4.others);
    const saved2 = await putLine(P, Q, { baseUpdatedAt: view4.quote.updatedAt, state: { ...view4.state, targetMarginPct: 26 } });
    const other = (await db.quoteCostLine.findMany({ where: { quoteId: Q } })).find((l) => l.description.includes("加拿大境内运费"));
    ok(saved2.status === 200 && !!other && Number(other.unitCost) === 400 && other.metadata === null, "再逐行保存：那条其它成本行原样还在", { status: saved2.status });
    const v5 = saved2.body as unknown as LineView;
    ok(v5.computed.ok && engine.ok && v5.computed.totals.estimatedCost > engine.estimatedCost, "其它成本行计入四个数");

    // —— 6. 导出 ——
    const notYet = await exp(P, Q);
    ok(notYet.status === 409 && String(notYet.body.error).includes("报价定为我方报价后才能导出"), "还没定：导出 409，写明原因", notYet.body);
    await transitionQuote({ quoteId: Q, projectId: P, userId: OWNER, orgId: ORG, to: "review" });
    await transitionQuote({ quoteId: Q, projectId: P, userId: OWNER, orgId: ORG, to: "approved" });
    let bid = await resolveTenderBid({ projectId: P, orgId: ORG, internal: true });
    if (bid.status !== "AUTHORITATIVE" || bid.quote?.id !== Q) bid = await selectQuoteAsTenderBid({ projectId: P, quoteId: Q, orgId: ORG, userId: OWNER, reason: "fixture" });
    ok(bid.status === "AUTHORITATIVE" && bid.quote?.id === Q, "批准并选为我方报价", bid.status);
    const l1 = (await list(P)).body as unknown as ListView;
    ok(l1.export.available && l1.quotes.find((q) => q.id === Q)?.isOurBid === true, "列表：可以导出、标出我方报价", l1.export);
    const csv = await exp(P, Q);
    const v6 = (await getLine(P, Q)).body as unknown as LineView;
    ok(csv.status === 200 && csv.text.startsWith("Line,Description,UOM,Quantity,Unit Price,Extended Price") && v6.computed.ok, "已定：导出 CSV", csv.text.slice(0, 200));
    if (v6.computed.ok) {
      const a = v6.computed.allocation;
      ok(csv.text.includes(`,${a.lines[0].unitPrice!.toFixed(2)},${a.lines[0].extended!.toFixed(2)}`) && csv.text.includes(`,${a.lines[1].unitPrice!.toFixed(2)},${a.lines[1].extended!.toFixed(2)}`) && csv.text.includes(a.linesTotal!.toFixed(2)), "CSV 的单价、行合计、合计与逐行表相同", { csv: csv.text, a });
    }
    const frozen = await putLine(P, Q, { baseUpdatedAt: v6.quote.updatedAt, state: v6.state });
    ok(frozen.status === 409 && String(frozen.body.error).includes("锁定"), "已批准：逐行保存 409（内容锁定）", frozen.body);
    ok((await exp(P, Q2)).status === 409, "不是当前我方报价的那份：导出 409");
    ok((await exp(P, Q, VIEWER)).status === 403, "没有财务查看权：导出 403");

    // —— 7. 另起新版 ——
    const rev = await reviseQuote({ quoteId: Q, projectId: P, userId: OWNER, orgId: ORG, reason: "fixture 改价" });
    const revQ = await getQuote(rev.id, P);
    ok((revQ.engineJson as { entryMode?: string }).entryMode === "LINE" && revQ.costLines.filter((l) => readBidLineMeta(l.metadata)).length === 10, "另起新版：新版照样是逐行报价，行身份随成本行照抄");
    const g7 = await getLine(P, rev.id);
    ok(g7.status === 200 && (g7.body as unknown as LineView).state.rows.length === 2 && (g7.body as unknown as LineView).quote.version === 2, "新版能按逐行打开（行 id 换了也认得）");

    // —— 8. 没碰的地方 ——
    ok((await db.quoteLineItem.count({ where: { quote: { projectId: P } } })) === 0, "全程没写给客户报价单的明细行");
    ok((await workspaceOf()) === roomBefore && roomBefore !== "null", "投标工作区（情报室 JSON 里的 bidWorkspace）一字未变（选为我方报价时既有的价格镜像写在 pricingInputs，与本 change 无关）");
    ok(!process.env.TENDER_BID_WORKSPACE_ENABLED, "全程没打开投标工作区开关");

    // —— 9. 没有价格表的项目：表空、附带入文本 ——
    const P2 = await mkProject();
    const c3 = await create(P2, { entryMode: "LINE", businessType: "SUPPLY_ONLY" });
    const e3 = (await getLine(P2, String(c3.body.id))).body as unknown as LineView;
    ok(c3.status === 201 && e3.state.rows.length === 0 && e3.seed !== null && e3.seed.scheduleLineCount === 0 && typeof e3.seed.prefill.messageZh === "string", "没有价格表：逐行表是空的，附招标分析带入的状态与说明", e3.seed);
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

  console.log(`\nBIDPAGE-3 逐行报价 隔离库：${pass} 通过，${fail} 失败`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
