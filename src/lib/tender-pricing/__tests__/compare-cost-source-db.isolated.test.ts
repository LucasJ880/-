/**
 * FLOW-H2 报价表助手的成本来源——真实 DB（隔离库）+ 真实路由
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated JWT_SECRET=… \
 *   npx tsx src/lib/tender-pricing/__tests__/compare-cost-source-db.isolated.test.ts
 * 无隔离库时自动跳过。全部数据为 fixture。不调任何模型，不发任何请求。
 */
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过 FLOW-H2 报价表助手成本来源 DB 测试（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "FLOW-H2 pricing compare cost source DB test" });

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail).slice(0, 1500) : ""); }
}
type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : {});
const close = (a: unknown, b: number) => typeof a === "number" && Math.abs(a - b) < 0.005;
/** 情景表价格舍入到分 */
const closeCents = (a: unknown, b: number) => typeof a === "number" && Math.abs(a - b) <= 0.01;

async function main() {
  const { NextRequest } = await import("next/server");
  const { db } = await import("@/lib/db");
  const { createSession } = await import("@/lib/auth/session");
  const route = await import("@/app/api/projects/[id]/pricing-helper/route");
  const { normalizeQuote, readLandedCostSettings } = await import("@/lib/tender-rfq/landed-cost");

  console.log("FLOW-H2 pricing helper × compare matrix cost source — isolated DB");
  const stamp = Date.now().toString(36);
  const OWNER = `h2owner_${stamp}`, OUTSIDER = `h2out_${stamp}`;
  const ORG = `h2org_${stamp}`, ORG_B = `h2orgb_${stamp}`;
  const users = [OWNER, OUTSIDER];
  const email = (id: string) => `${id}@fixture.test`;
  const DAY = 86_400_000;
  const NOTE_SECRET = "备注原文-不该出现-NOTE7731";
  const BODY_SECRET = "邮件正文-不该出现-BODY5520";
  process.env.TENDER_PRICING_COMPARE_SOURCE_ENABLED = "1";
  delete process.env.TENDER_PRICING_COMPARE_SOURCE_ORG_ALLOWLIST;

  const projectIds: string[] = [];
  const supplierIds: string[] = [];
  let seq = 0;

  const landedSettings = (dutyByProject: Record<string, number>) => ({
    tenderRfq: {
      landedCost: {
        fxRates: { CNY: 0.19 },
        fxAsOf: new Date(Date.now() - 2 * DAY).toISOString().slice(0, 10),
        fxSource: "MANUAL",
        freightEstimate: { mode: "per_unit", value: 6 },
        insurancePct: 1,
        clearanceFlatCad: 150,
        projects: Object.fromEntries(Object.entries(dutyByProject).map(([pid, d]) => [pid, { dutyRatePct: d }])),
      },
    },
  });
  const MODEL = { version: "tender-pricing-model/v1", priceWeightPct: 30, costFormula: "lowest_over_bid", otherCriteria: [], source: "HUMAN", evidenceZh: [], derivedAt: new Date().toISOString() };

  async function mkProject(orgId = ORG, owner = OWNER) {
    seq += 1;
    const id = `h2proj_${stamp}_${seq}`;
    projectIds.push(id);
    await db.project.create({ data: { id, name: `Fixture Tender ${stamp}-${seq}`, orgId, ownerId: owner, workDomain: "tender", intakeStatus: "dispatched", closeDate: new Date(Date.now() + 30 * DAY) } });
    await db.bidIntelligenceRoom.create({ data: { orgId, projectId: id, summaryJson: { pricingModel: MODEL, pricingInputs: { competitorPriceCad: 150000, ourCostCad: null, targetMarginPct: 20 } } } });
    await db.tenderAnalysisRun.create({ data: { orgId, projectId: id, status: "APPROVED", idempotencyKey: `h2-${stamp}-run-${seq}`, sourceHashFingerprint: "fixture", createdById: owner, completedAt: new Date() } });
    return id;
  }
  async function mkSupplier(orgId: string, name: string) {
    const s = await db.supplier.create({ data: { orgId, name, contactEmail: `${name.replace(/\W/g, "").toLowerCase() || "s"}${seq}@supplier-fixture.test`, status: "active", createdById: orgId === ORG ? OWNER : OUTSIDER } as never });
    supplierIds.push(s.id);
    return s.id;
  }
  /** 一轮询价（带已发出的发送卡，正文写首档数量 1500）+ 若干已报价条目 */
  async function mkRound(projectId: string, roundNumber: number, quotes: Array<{ supplierId: string; unitPrice: number; currency?: string; incoterm?: string; selected?: boolean; status?: string }>, orgId = ORG, owner = OWNER) {
    const inquiry = await db.projectInquiry.create({ data: { projectId, roundNumber, status: "in_progress", createdById: owner } });
    await db.pendingAction.create({ data: { type: "tender.send_rfq", title: `第 ${roundNumber} 轮询价`, preview: "fixture", payload: { inquiryId: inquiry.id, projectId, roundNumber, items: [{ supplierId: quotes[0]?.supplierId, body: `${BODY_SECRET}\n- 数量：1500 件\n` }] }, status: "executed", createdById: owner, orgId, projectId, decidedById: owner, decidedAt: new Date(), executedAt: new Date(), expiresAt: new Date(Date.now() + 3 * DAY), idempotencyKey: `h2-${stamp}-${projectId}-${roundNumber}` } });
    const ids: string[] = [];
    for (const q of quotes) {
      const it = await db.inquiryItem.create({
        data: {
          inquiryId: inquiry.id,
          supplierId: q.supplierId,
          status: q.status ?? "quoted",
          unitPrice: q.unitPrice,
          currency: q.currency ?? "CNY",
          deliveryDays: 20,
          validUntil: new Date(Date.now() + 60 * DAY),
          repliedAt: new Date(Date.now() - DAY),
          quoteNotes: `[auto 2026-11-01T00:00:00.000Z msg=m${seq}] 贸易条款=${q.incoterm ?? "FOB"}\n${NOTE_SECRET}`,
          isSelected: q.selected ?? false,
          createdById: owner,
        } as never,
      });
      ids.push(it.id);
    }
    return { inquiryId: inquiry.id, itemIds: ids };
  }
  const select = async (inquiryId: string, itemId: string | null) => {
    await db.inquiryItem.updateMany({ where: { inquiryId }, data: { isSelected: false } });
    if (itemId) await db.inquiryItem.update({ where: { id: itemId }, data: { isSelected: true } });
  };

  const cookie = async (uid: string) => `qy_session=${await createSession({ sub: uid, email: email(uid), role: "user" })}`;
  const get = async (projectId: string, userId: string = OWNER) => {
    const res = await route.GET(new NextRequest(`http://localhost/api/projects/${projectId}/pricing-helper`, { headers: { cookie: await cookie(userId) } }), { params: Promise.resolve({ id: projectId }) });
    const text = await res.text();
    return { status: res.status, body: rec(JSON.parse(text || "null")), text };
  };
  const post = async (projectId: string, body: unknown, userId: string = OWNER) => {
    const res = await route.POST(new NextRequest(`http://localhost/api/projects/${projectId}/pricing-helper`, { method: "POST", headers: { cookie: await cookie(userId), "content-type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ id: projectId }) });
    return { status: res.status, body: rec(await res.json().catch(() => null)) };
  };
  const save = (projectId: string, ourCostCad: number | null, claimItemId?: string, extra: Rec = {}) =>
    post(projectId, { action: "save", inputs: { competitorPriceCad: 150000, ourCostCad, targetMarginPct: 20 }, ...(claimItemId ? { ourCostSource: { kind: "rfq_compare", inquiryItemId: claimItemId } } : {}), ...extra });
  const storedInputs = async (projectId: string) => rec(rec((await db.bidIntelligenceRoom.findUnique({ where: { projectId }, select: { summaryJson: true } }))?.summaryJson).pricingInputs);
  const cc = (b: Rec) => rec(b.compareCost);
  const sug = (b: Rec) => rec(cc(b).suggestion);
  const floorOf = (b: Rec) => (rec(b.result).scenarios as Array<{ key: string; priceCad: number }> | undefined)?.find((s) => s.key === "floor")?.priceCad;
  const snapshot = async (projectId: string) => JSON.stringify({
    pa: await db.pendingAction.findMany({ where: { projectId }, orderBy: { id: "asc" }, select: { id: true, status: true, updatedAt: true } }),
    inq: await db.projectInquiry.findMany({ where: { projectId }, orderBy: { id: "asc" }, select: { id: true, status: true, updatedAt: true } }),
    items: await db.inquiryItem.findMany({ where: { inquiry: { projectId } }, orderBy: { id: "asc" }, select: { id: true, status: true, isSelected: true, updatedAt: true } }),
    room: await db.bidIntelligenceRoom.findUnique({ where: { projectId }, select: { summaryJson: true, updatedAt: true } }),
    audits: await db.auditLog.count({ where: { projectId } }),
  });
  /** 期望值直接用纯函数算（与矩阵同一套），避免在测试里手算 */
  let settingsForExpect: ReturnType<typeof readLandedCostSettings> | null = null;
  const expectLanded = (projectId: string, unitPrice: number) => {
    const s = settingsForExpect!;
    return normalizeQuote({ unitPrice, totalPrice: null, currency: "CNY", incoterm: "FOB" }, { settings: s, dutyRatePct: s.projects[projectId]?.dutyRatePct ?? null, quantity: 1500, now: new Date() }).landedCad.total!;
  };

  try {
    for (const id of users) await db.user.create({ data: { id, email: email(id), name: `Fixture ${id}`, role: "user" } });
    await db.organization.create({ data: { id: ORG, name: "Fixture Bidder Inc.", code: `h2-${stamp}`, ownerId: OWNER } });
    await db.organization.create({ data: { id: ORG_B, name: "Other Fixture Org", code: `h2b-${stamp}`, ownerId: OUTSIDER } });
    await db.organizationMember.create({ data: { orgId: ORG, userId: OWNER, role: "org_admin", status: "active" } });
    await db.organizationMember.create({ data: { orgId: ORG_B, userId: OUTSIDER, role: "org_admin", status: "active" } });

    const P = await mkProject();
    const P2 = await mkProject();
    const PU = await mkProject();
    const PB = await mkProject(ORG_B, OUTSIDER);
    await db.organization.update({ where: { id: ORG }, data: { settingsJson: landedSettings({ [P]: 6.5, [P2]: 6.5 }) } });
    await db.organization.update({ where: { id: ORG_B }, data: { settingsJson: landedSettings({ [PB]: 6.5 }) } });
    settingsForExpect = readLandedCostSettings(landedSettings({ [P]: 6.5, [P2]: 6.5 }));

    const SA = await mkSupplier(ORG, "甲厂 Alpha");
    const SB = await mkSupplier(ORG, "乙厂 Beta");
    const SC = await mkSupplier(ORG, "丙厂 Gamma");
    const SX = await mkSupplier(ORG_B, "外组织 Delta");

    /* ---------- 1. 没有选定：不给数字，即使有推荐与最低价 ---------- */
    const r1 = await mkRound(P, 1, [{ supplierId: SA, unitPrice: 280 }, { supplierId: SB, unitPrice: 300 }]);
    const [itemA, itemB] = r1.itemIds;
    let g = await get(P);
    ok(g.status === 200 && sug(g.body).status === "none_selected" && !("landedCadTotal" in sug(g.body)), "有报价但没有选定：「还没有选定」、不给数字（矩阵里有推荐与最低价也不用）", sug(g.body));

    /* ---------- 2. 选定了更贵的那一家：给的是选定的，不是最低价 ---------- */
    await select(r1.inquiryId, itemB);
    const landedB = expectLanded(P, 300);
    const landedA = expectLanded(P, 280);
    const before = await snapshot(P);
    g = await get(P);
    const s = sug(g.body);
    ok(s.status === "ok" && s.inquiryItemId === itemB && s.roundNumber === 1 && close(s.landedCadTotal, landedB) && String(s.supplierName).includes("乙厂"), "选定了更贵的乙厂：建议是乙厂第 1 轮的落地价（不是最低价甲厂）", s);
    ok(rec(s.quantityBasis).kind === "first_tier" && rec(s.quantityBasis).qty === 1500, "数量口径：按询价单首档数量 1500", s.quantityBasis);
    const b = rec(s.breakdown);
    ok(close(b.freight, 9000) && close(b.duty, 300 * 0.19 * 1500 * 0.065) && close(b.clearance, 150) && b.inland === null && b.feesIncludedInQuote === false, "逐项：海运 9,000、关税按货值 6.5%、清关 150、没有内陆", b);
    ok(Array.isArray(s.laterUnselectedRounds) && (s.laterUnselectedRounds as unknown[]).length === 0, "之后没有别的轮次");
    ok((await snapshot(P)) === before, "读取前后：审批卡、询价、条目与选定、房间、审计都没有变化");
    ok(!g.text.includes(NOTE_SECRET) && !g.text.includes(BODY_SECRET) && !g.text.includes("supplier-fixture.test"), "返回里没有报价备注原文、邮件正文、供应商联系方式");
    ok(rec(g.body.inputs).ourCostCad === null && Object.keys(rec(g.body.inputs)).sort().join() === "competitorPriceCad,ourCostCad,targetMarginPct", "读取不改写成本；inputs 仍只有三项", g.body.inputs);

    /* ---------- 3. 别的组织的人 ---------- */
    const roomBefore = await snapshot(P);
    ok((await get(P, OUTSIDER)).status === 403, "别的组织的人读：403");
    const out = await post(P, { action: "save", inputs: { ourCostCad: landedB }, ourCostSource: { kind: "rfq_compare", inquiryItemId: itemB } }, OUTSIDER);
    ok(out.status === 403 && (await snapshot(P)) === roomBefore, "别的组织的人带声明保存：403，什么都没改", out);

    /* ---------- 4. 点按钮后直接保存：记来源 ---------- */
    let p = await save(P, landedB, itemB);
    let st = await storedInputs(P);
    const src = rec(st.ourCostSource);
    ok(p.status === 200 && src.kind === "rfq_compare" && src.inquiryItemId === itemB && src.inquiryId === r1.inquiryId && src.roundNumber === 1 && close(src.landedCadTotal, landedB) && rec(src.quantityBasis).kind === "first_tier" && typeof src.recordedAt === "string", "数字与落地价相同：记来自比价矩阵（轮次、条目、落地价、数量口径、时间）", { p: p.body, src });
    ok(close(st.ourCostCad, landedB) && rec(p.body.ourCostSource).kind === "rfq_compare", "成本保存了；响应里带来源", p.body);
    g = await get(P);
    ok(rec(cc(g.body).source).kind === "rfq_compare" && cc(g.body).staleNoteZh === null, "读取：来源是比价矩阵，没有过时提示", cc(g.body));
    ok(closeCents(floorOf(g.body), landedB / 0.8), "情景表按保存的成本计算（成本底线 = 成本 ÷ 0.8）", floorOf(g.body));

    /* ---------- 5. 只改毛利：来源保留 ---------- */
    p = await post(P, { action: "save", inputs: { competitorPriceCad: 150000, ourCostCad: landedB, targetMarginPct: 25 } });
    ok(rec((await storedInputs(P)).ourCostSource).kind === "rfq_compare", "成本没变、只改了毛利：来源保留");
    p = await post(P, { action: "save", inputs: { targetMarginPct: 20 } });
    ok(rec((await storedInputs(P)).ourCostSource).kind === "rfq_compare", "请求里没有成本：来源保留");

    /* ---------- 6. 改过数字、伪造来源：照常保存，记手填 ---------- */
    p = await save(P, landedB + 1, itemB);
    st = await storedInputs(P);
    ok(p.status === 200 && close(st.ourCostCad, landedB + 1) && rec(st.ourCostSource).kind === "manual", "点按钮后改了数字再保存：成本照常保存，来源记手填", st);
    p = await save(P, landedA, itemA);
    ok(rec((await storedInputs(P)).ourCostSource).kind === "manual", "声明没有选定的那一条（甲厂，金额也对得上）：手填");
    const r2b = await mkRound(P2, 1, [{ supplierId: SA, unitPrice: 280, selected: true }]);
    p = await save(P, expectLanded(P2, 280), r2b.itemIds[0]);
    ok(rec((await storedInputs(P)).ourCostSource).kind === "manual", "声明别的项目里选定的那一条：手填");
    const rxb = await mkRound(PB, 1, [{ supplierId: SX, unitPrice: 300, selected: true }], ORG_B, OUTSIDER);
    p = await save(P, landedB, rxb.itemIds[0]);
    ok(rec((await storedInputs(P)).ourCostSource).kind === "manual", "声明别的组织里选定的那一条：手填");
    p = await post(P, { action: "save", inputs: { ourCostCad: landedB }, ourCostSource: { kind: "rfq_compare", inquiryItemId: itemB, landedCadTotal: landedB, roundNumber: 1, orgId: ORG_B } });
    ok(rec((await storedInputs(P)).ourCostSource).kind === "rfq_compare" && rec((await storedInputs(P)).ourCostSource).roundNumber === 1, "声明里多带的金额、轮次、组织不读：只按条目 id 重新核对");
    p = await save(P, null);
    ok(!("ourCostSource" in (await storedInputs(P))), "成本清空：没有来源");

    /* ---------- 7. 已有手填的成本：读取不动它 ---------- */
    await save(P, 90000);
    g = await get(P);
    ok(rec(g.body.inputs).ourCostCad === 90000 && closeCents(floorOf(g.body), 90000 / 0.8) && close(sug(g.body).landedCadTotal, landedB) && cc(g.body).staleNoteZh === null && rec(cc(g.body).source).kind === "manual", "已保存手填 90,000、建议是乙厂的落地价：仍按 90,000 计算，手填不提示过时", { inputs: g.body.inputs, cc: cc(g.body) });

    /* ---------- 8. 选定换了一家：只提示，不改 ---------- */
    await save(P, landedB, itemB);
    await select(r1.inquiryId, itemA);
    g = await get(P);
    const note = String(cc(g.body).staleNoteZh ?? "");
    ok(note.includes("比价矩阵现在是 甲厂") && note.includes("按 乙厂") && note.includes("没有自动更新") && close(rec(g.body.inputs).ourCostCad, landedB), "按乙厂保存后改选甲厂：提示现在是甲厂、已保存的是乙厂，成本没变", { note, inputs: g.body.inputs });
    ok(close((await storedInputs(P)).ourCostCad, landedB) && rec((await storedInputs(P)).ourCostSource).inquiryItemId === itemB, "库里的成本与来源都没被改写");

    /* ---------- 9. 更新的一轮还没选定：用更早一轮，写明之后的轮次 ---------- */
    const r2 = await mkRound(P, 2, [{ supplierId: SC, unitPrice: 250 }]);
    g = await get(P);
    ok(sug(g.body).roundNumber === 1 && sug(g.body).inquiryItemId === itemA && JSON.stringify(sug(g.body).laterUnselectedRounds) === "[2]", "第 2 轮还没选定：建议来自第 1 轮的选定，写明之后还有第 2 轮", sug(g.body));
    await select(r2.inquiryId, r2.itemIds[0]);
    g = await get(P);
    ok(sug(g.body).roundNumber === 2 && sug(g.body).inquiryItemId === r2.itemIds[0] && close(sug(g.body).landedCadTotal, expectLanded(P, 250)), "第 2 轮选定之后：建议来自第 2 轮", sug(g.body));

    /* ---------- 10. 选定的条目不是已报价：不算 ---------- */
    const PD = await mkProject();
    await mkRound(PD, 1, [{ supplierId: SA, unitPrice: 280, selected: true, status: "declined" }]);
    ok(sug((await get(PD)).body).status === "none_selected", "选定的条目已经不是已报价状态：当作没有选定");

    /* ---------- 11. 换算不出落地价：写原因、不给数字；声明也不记 ---------- */
    await mkRound(PU, 1, [{ supplierId: SA, unitPrice: 280, currency: "EUR", selected: true }]);
    g = await get(PU);
    const su = sug(g.body);
    ok(su.status === "unconvertible" && JSON.stringify(su.reasons).includes("EUR→CAD") && !("landedCadTotal" in su), "选定的那一家缺 EUR 汇率：换算不出，写原因，不给数字", su);
    const puItem = String(su.inquiryItemId);
    await save(PU, 1000, puItem);
    ok(rec((await storedInputs(PU)).ourCostSource).kind === "manual", "换算不出时带声明保存：记手填");

    /* ---------- 12. 开关 ---------- */
    process.env.TENDER_PRICING_COMPARE_SOURCE_ENABLED = "0";
    g = await get(P);
    ok(g.status === 200 && !("compareCost" in g.body), "开关关闭：读取不返回这一项", Object.keys(g.body));
    p = await save(P2, expectLanded(P2, 280), r2b.itemIds[0]);
    ok(p.status === 200 && !("ourCostSource" in p.body) && !("ourCostSource" in (await storedInputs(P2))), "开关关闭：保存不看声明、不记来源、响应没有这一项", { p: p.body, st: await storedInputs(P2) });
    process.env.TENDER_PRICING_COMPARE_SOURCE_ENABLED = "1";
    process.env.TENDER_PRICING_COMPARE_SOURCE_ORG_ALLOWLIST = "some-other-org";
    ok(!("compareCost" in (await get(P)).body), "组织不在名单里：不返回");
    process.env.TENDER_PRICING_COMPARE_SOURCE_ORG_ALLOWLIST = ORG;
    ok("compareCost" in (await get(P)).body, "组织在名单里：返回");
    delete process.env.TENDER_PRICING_COMPARE_SOURCE_ORG_ALLOWLIST;
  } finally {
    delete process.env.TENDER_PRICING_COMPARE_SOURCE_ENABLED;
    delete process.env.TENDER_PRICING_COMPARE_SOURCE_ORG_ALLOWLIST;
    await db.auditLog.deleteMany({ where: { OR: [{ orgId: { in: [ORG, ORG_B] } }, { userId: { in: users } }, { projectId: { in: projectIds } }] } });
    await db.pendingAction.deleteMany({ where: { orgId: { in: [ORG, ORG_B] } } });
    await db.inquiryItem.deleteMany({ where: { inquiry: { projectId: { in: projectIds } } } });
    await db.projectInquiry.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.tenderAnalysisRun.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.bidIntelligenceRoom.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.supplier.deleteMany({ where: { id: { in: supplierIds } } });
    await db.project.deleteMany({ where: { id: { in: projectIds } } });
    await db.organizationMember.deleteMany({ where: { orgId: { in: [ORG, ORG_B] } } });
    await db.organization.deleteMany({ where: { id: { in: [ORG, ORG_B] } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.$disconnect();
  }

  console.log(`\nFLOW-H2 pricing compare cost source DB: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
