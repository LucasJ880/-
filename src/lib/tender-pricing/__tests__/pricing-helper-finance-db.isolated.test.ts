/**
 * CHAIN-2b 报价表助手的我方成本只给有财务查看权的人——真实 DB（隔离库），调用真实路由
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated JWT_SECRET=… \
 *   npx tsx src/lib/tender-pricing/__tests__/pricing-helper-finance-db.isolated.test.ts
 * 无隔离库时自动跳过。全部数据为 fixture（虚构组织 / 用户 / 项目）。不发任何邮件，不调任何外部接口，不调模型。
 */
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过 CHAIN-2b 报价表助手财务查看权 DB 测试（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "CHAIN-2b pricing helper finance DB test" });

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail).slice(0, 1500) : ""); }
}

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : {});

/** 成本与落地价用不常见的数字，便于在响应 JSON 里搜 */
const COST = 91234.56;
const LANDED = 87654.32;
const COST_STRINGS = ["91234", "91,234", "87654", "87,654"];
const DAY = 24 * 3600 * 1000;

async function main() {
  const { NextRequest } = await import("next/server");
  const { db } = await import("@/lib/db");
  const { createSession } = await import("@/lib/auth/session");
  const { seedOrgAuthorizationProfiles } = await import("@/lib/authorization/seed-org-profiles");
  const { PRICING_MODEL_VERSION } = await import("@/lib/tender-pricing/calc");
  const { COST_HIDDEN_NOTE_ZH, COST_WRITE_FORBIDDEN_ZH, NO_COST_ASSUMPTION_ZH } = await import("@/lib/tender-pricing/finance-view");
  const route = await import("@/app/api/projects/[id]/pricing-helper/route");
  const roomRoute = await import("@/app/api/projects/[id]/bid-intelligence/route");
  const listRoute = await import("@/app/api/projects/route");

  console.log("CHAIN-2b pricing helper finance view — isolated DB");
  const stamp = Date.now().toString(36);
  const id = (k: string) => `pf${k}_${stamp}`;
  const ORG_OWNER = id("orgowner"), OWNER = id("owner"), VIEWER = id("viewer"), EDITOR = id("editor"), ADMIN = id("admin");
  const BIDS = id("bids"), FINREAD = id("finread"), SUPER = id("super");
  const users = [ORG_OWNER, OWNER, VIEWER, EDITOR, ADMIN, BIDS, FINREAD, SUPER];
  const ORG = id("org");
  const email = (u: string) => `${u}@fixture.test`;

  for (const u of users) {
    await db.user.create({ data: { id: u, email: email(u), name: `Fixture ${u}`, role: u === SUPER ? "super_admin" : "user" } });
  }
  await db.organization.create({ data: { id: ORG, name: "Fixture Bidder Inc.", code: `pf-${stamp}`, ownerId: ORG_OWNER, industryPackId: "window_covering_services_v1" } });
  for (const u of [ORG_OWNER, OWNER, VIEWER, EDITOR, BIDS, FINREAD]) {
    await db.organizationMember.create({ data: { orgId: ORG, userId: u, role: u === ORG_OWNER ? "org_owner" : "org_member", status: "active" } });
  }
  await db.organizationMember.create({ data: { orgId: ORG, userId: ADMIN, role: "org_admin", status: "active" } });
  await seedOrgAuthorizationProfiles(ORG);
  const bind = async (userId: string, key: string) => {
    const profile = await db.roleProfile.findUnique({ where: { orgId_key: { orgId: ORG, key } } });
    if (!profile) throw new Error(`缺少岗位模板 ${key}`);
    await db.principalRoleBinding.create({ data: { orgId: ORG, principalType: "HUMAN", principalId: userId, roleProfileId: profile.id, status: "active" } });
  };
  await bind(BIDS, "bids"); // project.finance.read 只在 ASSIGNED 范围
  await bind(FINREAD, "accounting"); // project.finance.read 在 ORG 范围

  const projectIds: string[] = [];
  let seq = 0;
  const model = { version: PRICING_MODEL_VERSION, priceWeightPct: 60, costFormula: "lowest_over_bid", otherCriteria: [], source: "HUMAN", evidenceZh: [], derivedAt: new Date().toISOString() };
  const costSource = { kind: "rfq_compare", inquiryId: "inq_fixture", inquiryItemId: "item_fixture", roundNumber: 2, supplierName: "Fixture Supplier", landedCadTotal: LANDED, quantityBasis: { kind: "first_tier", qty: 1500 }, recordedAt: new Date().toISOString() };
  async function mkProject(pricingInputs: Rec) {
    seq += 1;
    const pid = `pfproj_${stamp}_${seq}`;
    projectIds.push(pid);
    await db.project.create({ data: { id: pid, name: `Fixture Tender ${stamp}-${seq}`, orgId: ORG, ownerId: OWNER, workDomain: "tender", intakeStatus: "dispatched", status: "active" } as never });
    for (const [u, role] of [[VIEWER, "viewer"], [EDITOR, "project_admin"], [BIDS, "viewer"], [FINREAD, "project_admin"]] as const) {
      await db.projectMember.create({ data: { projectId: pid, userId: u, role, status: "active" } });
    }
    await db.bidIntelligenceRoom.create({ data: { orgId: ORG, projectId: pid, summaryJson: { pricingModel: model, pricingInputs, otherFeature: { keep: true }, bidStrategyMemo: { pricingStrategyZh: `按成本 ${COST} 定价` }, majorBlockers: ["fixture blocker"] } as never } });
    return pid;
  }
  /** 一轮已报价、人工选定的询价（比价矩阵按组织的落地价设置算出一个落地价） */
  const supplierIds: string[] = [];
  async function mkSelectedRound(projectId: string, unitPrice: number) {
    const sup = await db.supplier.create({ data: { orgId: ORG, name: `Fixture Supplier ${stamp}`, contactEmail: `sup_${stamp}@supplier-fixture.test`, status: "active", createdById: OWNER } as never });
    supplierIds.push(sup.id);
    const inquiry = await db.projectInquiry.create({ data: { projectId, roundNumber: 1, status: "in_progress", createdById: OWNER } });
    await db.pendingAction.create({ data: { type: "tender.send_rfq", title: "第 1 轮询价", preview: "fixture", payload: { inquiryId: inquiry.id, projectId, roundNumber: 1, items: [{ supplierId: sup.id, body: "- 数量：1500 件\n" }] }, status: "executed", createdById: OWNER, orgId: ORG, projectId, decidedById: OWNER, decidedAt: new Date(), executedAt: new Date(), expiresAt: new Date(Date.now() + 3 * DAY), idempotencyKey: `pf-${stamp}-${projectId}-1` } });
    await db.inquiryItem.create({ data: { inquiryId: inquiry.id, supplierId: sup.id, status: "quoted", unitPrice, currency: "CNY", deliveryDays: 20, validUntil: new Date(Date.now() + 60 * DAY), repliedAt: new Date(Date.now() - DAY), quoteNotes: "[auto 2026-11-01T00:00:00.000Z msg=m1] 贸易条款=FOB", isSelected: true, createdById: OWNER } as never });
  }
  const cookieOf = async (userId: string) => `qy_session=${await createSession({ sub: userId, email: email(userId), role: userId === SUPER ? "super_admin" : "user" })}`;
  const get = async (projectId: string, userId: string) => {
    const res = await route.GET(new NextRequest(`http://localhost/api/projects/${projectId}/pricing-helper`, { headers: { cookie: await cookieOf(userId) } }), { params: Promise.resolve({ id: projectId }) });
    const text = await res.text();
    return { status: res.status, text, body: rec(JSON.parse(text || "null")) };
  };
  const post = async (projectId: string, body: unknown, userId: string) => {
    const res = await route.POST(new NextRequest(`http://localhost/api/projects/${projectId}/pricing-helper`, { method: "POST", headers: { cookie: await cookieOf(userId), "content-type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ id: projectId }) });
    const text = await res.text();
    return { status: res.status, text, body: rec(JSON.parse(text || "null")) };
  };
  const roomSj = async (projectId: string) => rec((await db.bidIntelligenceRoom.findUniqueOrThrow({ where: { projectId }, select: { summaryJson: true } })).summaryJson);
  const noCostIn = (text: string) => COST_STRINGS.every((s) => !text.includes(s));
  const scenarios = (b: Rec) => ((rec(b.result).scenarios as Rec[] | undefined) ?? []);
  const assumptions = (b: Rec) => ((rec(b.result).assumptionsZh as string[] | undefined) ?? []);

  const prevFlag = process.env.TENDER_PRICING_COMPARE_SOURCE_ENABLED;
  try {
    const baseInputs = { competitorPriceCad: 100000, ourCostCad: COST, targetMarginPct: 15, ourCostSource: costSource, ourPriceCad: 99000, ourPriceStatus: "AUTHORITATIVE" };
    const P = await mkProject(baseInputs);
    await db.organization.update({ where: { id: ORG }, data: { settingsJson: { tenderRfq: { landedCost: { fxRates: { CNY: 0.19 }, fxAsOf: new Date(Date.now() - 2 * DAY).toISOString().slice(0, 10), fxSource: "MANUAL", freightEstimate: { mode: "per_unit", value: 6 }, insurancePct: 1, clearanceFlatCad: 150, projects: { [P]: { dutyRatePct: 6.5 } } } } } as never } });
    await mkSelectedRound(P, 313.37);
    // 有财务查看权的人看到的比价矩阵落地价：之后在没有权限的人的响应里搜这个数
    process.env.TENDER_PRICING_COMPARE_SOURCE_ENABLED = "1";
    const gProbe = await get(P, OWNER);
    const sugg = rec(rec(gProbe.body.compareCost).suggestion);
    const landed = typeof sugg.landedCadTotal === "number" ? (sugg.landedCadTotal as number) : NaN;
    ok(sugg.status === "ok" && Number.isFinite(landed) && landed > 1000, "比价矩阵有选定：负责人拿到落地价建议", sugg);
    const li = Math.floor(landed);
    COST_STRINGS.push(String(li), li.toLocaleString("en-CA"));

    /* ---------- 1. 开关开着：没有财务查看权的四种人 ---------- */
    process.env.TENDER_PRICING_COMPARE_SOURCE_ENABLED = "1";
    for (const [u, label] of [[VIEWER, "只读成员"], [EDITOR, "项目编辑者"], [ADMIN, "org_admin（无财务键）"], [BIDS, "投标岗（ASSIGNED 范围的 finance.read）"]] as const) {
      const g = await get(P, u);
      const inputs = rec(g.body.inputs);
      ok(
        g.status === 200 && inputs.ourCostCad === null && inputs.competitorPriceCad === 100000 && inputs.targetMarginPct === 15 &&
          g.body.costHidden === true && g.body.compareCostHidden === true && !("compareCost" in g.body),
        `${label}读取：成本为 null、costHidden、compareCostHidden、没有 compareCost`,
        g.body,
      );
      ok(
        scenarios(g.body).length > 0 && scenarios(g.body).every((s) => s.marginPct === null) && !scenarios(g.body).some((s) => s.key === "floor" || s.key === "cost") &&
          assumptions(g.body).includes(COST_HIDDEN_NOTE_ZH) && !assumptions(g.body).includes(NO_COST_ASSUMPTION_ZH),
        `${label}读取：情景没有毛利、没有成本底价情景，假设说明换句`,
        g.body.result,
      );
      ok(noCostIn(g.text), `${label}读取：响应 JSON 里搜不到成本与落地价的数字`, g.text.slice(0, 600));
    }

    /* ---------- 2. 有财务查看权的三种人：结果一致、带成本与建议 ---------- */
    const seen: string[] = [];
    for (const [u, label] of [[OWNER, "项目负责人"], [FINREAD, "持 ORG 范围 finance.read 的成员"], [SUPER, "平台超级管理员"]] as const) {
      const g = await get(P, u);
      seen.push(g.text);
      ok(
        g.status === 200 && rec(g.body.inputs).ourCostCad === COST && "compareCost" in g.body && !("costHidden" in g.body) && !("compareCostHidden" in g.body) &&
          scenarios(g.body).some((s) => s.key === "floor") && scenarios(g.body).some((s) => typeof s.marginPct === "number"),
        `${label}读取：带成本与 compareCost、有成本底价情景与毛利、没有 costHidden`,
        g.body,
      );
    }
    ok(seen.every((t) => t === seen[0]), "三种有财务查看权的人拿到的响应逐字节相同");

    /* ---------- 3. 开关关着 ---------- */
    process.env.TENDER_PRICING_COMPARE_SOURCE_ENABLED = "0";
    const gOff = await get(P, VIEWER);
    ok(gOff.body.costHidden === true && !("compareCostHidden" in gOff.body) && !("compareCost" in gOff.body) && rec(gOff.body.inputs).ourCostCad === null, "开关关：只读成员 costHidden、没有 compareCostHidden", gOff.body);
    const gOffOwner = await get(P, OWNER);
    ok(rec(gOffOwner.body.inputs).ourCostCad === COST && !("compareCost" in gOffOwner.body) && !("costHidden" in gOffOwner.body), "开关关：负责人照旧看到成本、没有 compareCost", gOffOwner.body);
    process.env.TENDER_PRICING_COMPARE_SOURCE_ENABLED = "1";

    /* ---------- 4. 没有财务查看权的编辑者保存 ---------- */
    const snap = JSON.stringify(await roomSj(P));
    const w1 = await post(P, { action: "save", inputs: { competitorPriceCad: 100000, ourCostCad: 1, targetMarginPct: 15 } }, EDITOR);
    ok(w1.status === 403 && w1.body.error === COST_WRITE_FORBIDDEN_ZH && JSON.stringify(await roomSj(P)) === snap, "编辑者带 ourCostCad 保存：403、库不变", w1.body);
    const w2 = await post(P, { action: "save", inputs: { competitorPriceCad: 100000 }, ourCostSource: null }, EDITOR);
    ok(w2.status === 403 && w2.body.error === COST_WRITE_FORBIDDEN_ZH && JSON.stringify(await roomSj(P)) === snap, "编辑者带 ourCostSource: null 保存：403、库不变", w2.body);
    const w3 = await post(P, { action: "save", inputs: { competitorPriceCad: 100000, ourCostCad: null }, ourCostSource: { kind: "rfq_compare", inquiryItemId: "x" } }, ADMIN);
    ok(w3.status === 403 && w3.body.error === COST_WRITE_FORBIDDEN_ZH && JSON.stringify(await roomSj(P)) === snap, "org_admin（无财务键）带成本保存：403、库不变", w3.body);
    const w4 = await post(P, { action: "save", inputs: { competitorPriceCad: 105000, targetMarginPct: 12 } }, EDITOR);
    const afterPi = rec((await roomSj(P)).pricingInputs);
    ok(
      w4.status === 200 && afterPi.competitorPriceCad === 105000 && afterPi.targetMarginPct === 12 && afterPi.ourCostCad === COST &&
        rec(afterPi.ourCostSource).landedCadTotal === LANDED && afterPi.ourPriceCad === 99000,
      "编辑者只带对手价与目标毛利保存：成功；成本、来源与报价镜像保留",
      afterPi,
    );
    ok(rec(w4.body.inputs).ourCostCad === null && w4.body.costHidden === true && !("ourCostSource" in w4.body) && noCostIn(w4.text), "编辑者保存的返回：成本为 null、costHidden、没有 ourCostSource、搜不到成本数字", w4.body);
    const w5 = await post(P, { action: "save", inputs: { competitorPriceCad: 105000, targetMarginPct: 100 } }, EDITOR);
    ok(w5.status === 400, "编辑者不碰成本但目标毛利 100：400（财务判定之后才是目标毛利）", w5.body);
    const w6 = await post(P, { action: "save", inputs: { targetMarginPct: 100, ourCostCad: 5 } }, EDITOR);
    ok(w6.status === 403 && w6.body.error === COST_WRITE_FORBIDDEN_ZH, "编辑者带成本且目标毛利 100：403 先于 400", w6.body);

    /* ---------- 5. 有财务查看权的人照常保存成本 ---------- */
    const o1 = await post(P, { action: "save", inputs: { competitorPriceCad: 105000, ourCostCad: 90000, targetMarginPct: 12 } }, OWNER);
    ok(o1.status === 200 && rec(o1.body.inputs).ourCostCad === 90000 && !("costHidden" in o1.body) && "ourCostSource" in o1.body, "负责人保存成本：成功、返回带成本与来源（开关开着）", o1.body);
    const f1 = await post(P, { action: "save", inputs: { ourCostCad: COST } }, FINREAD);
    ok(f1.status === 200 && rec((await roomSj(P)).pricingInputs).ourCostCad === COST, "能编辑项目、持 ORG 范围 finance.read 的成员可以保存成本", f1.body);

    /* ---------- 6. 没有调查室：409 先于 403 ---------- */
    seq += 1;
    const PX = `pfproj_${stamp}_${seq}`;
    projectIds.push(PX);
    await db.project.create({ data: { id: PX, name: `Fixture Tender ${stamp}-${seq}`, orgId: ORG, ownerId: OWNER, workDomain: "tender", intakeStatus: "dispatched", status: "active" } as never });
    await db.projectMember.create({ data: { projectId: PX, userId: EDITOR, role: "project_admin", status: "active" } });
    ok((await post(PX, { action: "save", inputs: { ourCostCad: 5 } }, EDITOR)).status === 409, "没有投标调查室：409 先于财务 403");

    /* ---------- 7. 房间 JSON 两个接口 ---------- */
    const before = JSON.stringify(await roomSj(P));
    const rr = await roomRoute.GET(new NextRequest(`http://localhost/api/projects/${P}/bid-intelligence`, { headers: { cookie: await cookieOf(OWNER) } }), { params: Promise.resolve({ id: P }) });
    const roomBody = rec(await rr.json());
    const roomPi = rec(rec(rec(roomBody.room).summaryJson).pricingInputs);
    const roomSjOut = rec(rec(roomBody.room).summaryJson);
    ok(rr.status === 200 && !("ourCostCad" in roomPi) && !("ourCostSource" in roomPi) && roomPi.ourPriceCad === 99000 && roomPi.competitorPriceCad === 105000 && rec(roomSjOut.otherFeature).keep === true && !("bidStrategyMemo" in roomSjOut) && Array.isArray(roomSjOut.majorBlockers), "调查室读取（负责人）：pricingInputs 没有成本与来源、没有投标策略备忘，其它键还在", roomPi);
    let mine: Rec | undefined;
    for (const [u, label] of [[VIEWER, "只读成员"], [OWNER, "项目负责人"]] as const) {
      const lr = await listRoute.GET(new NextRequest(`http://localhost/api/projects?orgId=${ORG}`, { headers: { cookie: await cookieOf(u) } }), { params: Promise.resolve({}) } as never);
      const list = (await lr.json()) as Rec[];
      mine = Array.isArray(list) ? list.find((p) => p.id === P) : undefined;
      const listSj = rec(rec(mine?.intelligenceRoom).summaryJson);
      const listPi = rec(listSj.pricingInputs);
      ok(lr.status === 200 && !!mine && !("ourCostCad" in listPi) && !("ourCostSource" in listPi) && listPi.ourPriceCad === 99000 && !("bidStrategyMemo" in listSj) && Array.isArray(listSj.majorBlockers), `项目列表（${label}）：pricingInputs 没有成本与来源、没有投标策略备忘，其它键还在`, mine ? listSj : list);
    }
    ok(noCostIn(JSON.stringify(mine ?? {})) && noCostIn(JSON.stringify(roomBody)), "两个接口的 JSON 里都搜不到成本与落地价的数字");
    ok(JSON.stringify(await roomSj(P)) === before, "两个接口都不改库");
  } finally {
    if (prevFlag === undefined) delete process.env.TENDER_PRICING_COMPARE_SOURCE_ENABLED;
    else process.env.TENDER_PRICING_COMPARE_SOURCE_ENABLED = prevFlag;
    await db.bidIntelligenceRoom.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.inquiryItem.deleteMany({ where: { inquiry: { projectId: { in: projectIds } } } });
    await db.projectInquiry.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.pendingAction.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.supplier.deleteMany({ where: { id: { in: supplierIds } } });
    await db.auditLog.deleteMany({ where: { OR: [{ orgId: ORG }, { userId: { in: users } }, { projectId: { in: projectIds } }] } });
    await db.projectMember.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.project.deleteMany({ where: { id: { in: projectIds } } });
    await db.principalRoleBinding.deleteMany({ where: { orgId: ORG } });
    await db.organizationMember.deleteMany({ where: { orgId: ORG } });
    await db.organization.deleteMany({ where: { id: ORG } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.$disconnect();
  }

  console.log(`\nCHAIN-2b pricing helper finance DB: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
