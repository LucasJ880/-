/**
 * FIX-8 报价表助手保存不再冲掉报价引擎镜像的我方报价——真实 DB（隔离库），调用真实路由
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated JWT_SECRET=… \
 *   npx tsx src/lib/tender-pricing/__tests__/pricing-helper-save-db.isolated.test.ts
 * 无隔离库时自动跳过。全部数据为 fixture（虚构组织 / 用户 / 项目）。不发任何邮件，不调任何外部接口，不调模型。
 */
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过 FIX-8 报价表助手保存 DB 测试（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "FIX-8 pricing helper save DB test" });

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail).slice(0, 1500) : ""); }
}

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : {});

async function main() {
  const { NextRequest } = await import("next/server");
  const { db } = await import("@/lib/db");
  const { createSession } = await import("@/lib/auth/session");
  const { writeBidMirrorsTx, writePendingMirrorsTx } = await import("@/lib/quote-engine/tender-bid");
  const route = await import("@/app/api/projects/[id]/pricing-helper/route");

  console.log("FIX-8 pricing helper save keeps bid mirror — isolated DB");
  const stamp = Date.now().toString(36);
  const OWNER = `phowner_${stamp}`, VIEWER = `phviewer_${stamp}`;
  const ORG = `phorg_${stamp}`;
  const users = [OWNER, VIEWER];
  const email = (id: string) => `${id}@fixture.test`;

  await db.user.create({ data: { id: OWNER, email: email(OWNER), name: "Fixture Owner", role: "user" } });
  await db.user.create({ data: { id: VIEWER, email: email(VIEWER), name: "Fixture Viewer", role: "user" } });
  await db.organization.create({ data: { id: ORG, name: "Fixture Bidder Inc.", code: `ph-${stamp}`, ownerId: OWNER } });
  await db.organizationMember.create({ data: { orgId: ORG, userId: OWNER, role: "org_admin", status: "active" } });
  await db.organizationMember.create({ data: { orgId: ORG, userId: VIEWER, role: "org_member", status: "active" } });

  const projectIds: string[] = [];
  let seq = 0;
  async function mkProject(summaryJson: Rec | null = {}) {
    seq += 1;
    const id = `phproj_${stamp}_${seq}`;
    projectIds.push(id);
    await db.project.create({ data: { id, name: `Fixture Tender ${stamp}-${seq}`, orgId: ORG, ownerId: OWNER, workDomain: "tender", intakeStatus: "dispatched", status: "active" } as never });
    await db.projectMember.create({ data: { projectId: id, userId: VIEWER, role: "viewer", status: "active" } });
    if (summaryJson) await db.bidIntelligenceRoom.create({ data: { orgId: ORG, projectId: id, summaryJson: summaryJson as never } });
    return id;
  }
  const cookieOf = async (userId: string) => `qy_session=${await createSession({ sub: userId, email: email(userId), role: "user" })}`;
  const post = async (projectId: string, body: unknown, userId: string = OWNER) => {
    const res = await route.POST(new NextRequest(`http://localhost/api/projects/${projectId}/pricing-helper`, { method: "POST", headers: { cookie: await cookieOf(userId), "content-type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ id: projectId }) });
    return { status: res.status, body: rec(await res.json().catch(() => null)) };
  };
  const get = async (projectId: string) => {
    const res = await route.GET(new NextRequest(`http://localhost/api/projects/${projectId}/pricing-helper`, { headers: { cookie: await cookieOf(OWNER) } }), { params: Promise.resolve({ id: projectId }) });
    return { status: res.status, body: rec(await res.json().catch(() => null)) };
  };
  const roomSj = async (projectId: string) => rec((await db.bidIntelligenceRoom.findUniqueOrThrow({ where: { projectId }, select: { summaryJson: true } })).summaryJson);
  const pi = async (projectId: string) => rec((await roomSj(projectId)).pricingInputs);
  /** 用报价引擎本身的写穿函数镜像权威报价（与选标 / 同步同一条路径） */
  const mirror = (projectId: string, quoteId: string, version: number, sellingPrice: number, currency = "CAD") =>
    db.$transaction((tx) => writeBidMirrorsTx(tx as never, { projectId, quoteId, version, sellingPrice, currency }));

  try {
    /* ---------- 1. 整份保存：镜像键原样保留，三项输入更新 ---------- */
    const P = await mkProject({ incumbentLead: { vendor: "Fixture Incumbent" }, pricingInputs: { competitorPriceCad: 90000, ourCostCad: 60000, targetMarginPct: 20 } });
    const m = await mirror(P, "q_fixture_1", 3, 98765.43);
    const before = await pi(P);
    ok(m.roomMirrored && before.ourPriceCad === 98765.43 && before.ourPriceSource === "quote:q_fixture_1:v3" && before.ourPriceStatus === "AUTHORITATIVE" && before.ourPrice === 98765.43 && before.ourPriceCurrency === "CAD", "（前提）报价引擎把权威报价镜像进了 pricingInputs", before);
    const s1 = await post(P, { action: "save", inputs: { competitorPriceCad: 101000, ourCostCad: 70500, targetMarginPct: 18 } });
    const after1 = await pi(P);
    ok(s1.status === 200 && s1.body.ok === true, "整份保存：200", s1.body);
    ok(after1.competitorPriceCad === 101000 && after1.ourCostCad === 70500 && after1.targetMarginPct === 18, "三项人工输入更新为新值", after1);
    ok(after1.ourPriceCad === 98765.43 && after1.ourPrice === 98765.43 && after1.ourPriceCurrency === "CAD" && after1.ourPriceSource === "quote:q_fixture_1:v3" && after1.ourPriceStatus === "AUTHORITATIVE", "镜像的我方报价（ourPriceCad / ourPrice / 币种 / 来源 / 状态）保存后仍在", after1);
    ok(rec((await roomSj(P)).incumbentLead).vendor === "Fixture Incumbent", "summaryJson 里别的键也不动");
    ok(JSON.stringify(Object.keys(rec(s1.body.inputs)).sort()) === JSON.stringify(["competitorPriceCad", "ourCostCad", "targetMarginPct"]) && rec(s1.body.inputs).ourCostCad === 70500 && "model" in s1.body, "返回形状不变：inputs 只有三项人工输入，另有 ok / model", s1.body);

    /* ---------- 2. 只改一项：另两项沿用、镜像保留 ---------- */
    const s2 = await post(P, { action: "save", inputs: { competitorPriceCad: 99000 } });
    const after2 = await pi(P);
    ok(s2.status === 200 && after2.competitorPriceCad === 99000 && after2.ourCostCad === 70500 && after2.targetMarginPct === 18 && after2.ourPriceCad === 98765.43 && after2.ourPriceStatus === "AUTHORITATIVE", "只改竞品价：另两项沿用上次，镜像保留", after2);

    /* ---------- 3. 只存评分模型（不带 inputs）：镜像保留 ---------- */
    const s3 = await post(P, { action: "save", model: { priceWeightPct: 40, costFormula: "lowest_over_bid", otherCriteria: [] } });
    const after3 = await pi(P);
    ok(s3.status === 200 && rec(s3.body.model).source === "HUMAN" && after3.ourPriceCad === 98765.43 && after3.ourPriceSource === "quote:q_fixture_1:v3" && after3.competitorPriceCad === 99000, "只存人工评分模型：pricingInputs 的镜像与输入都保留", { body: s3.body, after3 });

    /* ---------- 4. 清空为 null：只清人工输入，不碰镜像 ---------- */
    const s4 = await post(P, { action: "save", inputs: { ourCostCad: null } });
    const after4 = await pi(P);
    ok(s4.status === 200 && after4.ourCostCad === null && after4.ourPriceCad === 98765.43, "把成本清成空：成本为 null，镜像的我方报价不受影响", after4);

    /* ---------- 5. 保存之后报价引擎再写：两边都在 ---------- */
    await mirror(P, "q_fixture_2", 1, 105000);
    const after5 = await pi(P);
    ok(after5.ourPriceCad === 105000 && after5.ourPriceSource === "quote:q_fixture_2:v1" && after5.competitorPriceCad === 99000 && after5.targetMarginPct === 18, "之后报价引擎再镜像：新报价写入，人工输入保留", after5);
    const g = await get(P);
    ok(g.status === 200 && rec(g.body.inputs).competitorPriceCad === 99000 && !("ourPriceCad" in rec(g.body.inputs)), "GET 照旧只返回三项人工输入", g.body.inputs);

    /* ---------- 6. 改价待定（报价引擎清空后标 QUOTE_REVISION_PENDING）：保存不把状态冲掉 ---------- */
    const PP = await mkProject({ pricingInputs: { competitorPriceCad: 50000 } });
    await mirror(PP, "q_fixture_3", 2, 48000);
    await db.$transaction((tx) => writePendingMirrorsTx(tx as never, { projectId: PP, supersededQuoteId: "q_fixture_3", version: 2 }));
    const pending = await pi(PP);
    ok(pending.ourPriceStatus === "QUOTE_REVISION_PENDING" && pending.ourPriceSupersededSource === "quote:q_fixture_3:v2" && pending.ourPriceCad === null, "（前提）报价引擎把镜像改成了改价待定", pending);
    const s6 = await post(PP, { action: "save", inputs: { targetMarginPct: 12 } });
    const after6 = await pi(PP);
    ok(s6.status === 200 && after6.targetMarginPct === 12 && after6.competitorPriceCad === 50000 && after6.ourPriceStatus === "QUOTE_REVISION_PENDING" && after6.ourPriceSupersededSource === "quote:q_fixture_3:v2" && "ourPriceCad" in after6 && after6.ourPriceCad === null, "改价待定时保存：状态与被替代的来源都还在，ourPriceCad 仍是 null（没被删掉）", after6);

    /* ---------- 7. 拒绝的请求什么都不写 ---------- */
    const snap = JSON.stringify(await roomSj(P));
    const bad = await post(P, { action: "save", inputs: { targetMarginPct: 100 } });
    ok(bad.status === 400 && JSON.stringify(await roomSj(P)) === snap, "目标毛利 ≥ 100%：400，房间不变", bad.body);
    const ro = await post(P, { action: "save", inputs: { competitorPriceCad: 1 } }, VIEWER);
    ok(ro.status === 403 && JSON.stringify(await roomSj(P)) === snap, "只读成员保存：403，房间不变", ro.body);

    /* ---------- 8. 房间里还没有 pricingInputs：照常写三项 ---------- */
    const PN = await mkProject({});
    const s8 = await post(PN, { action: "save", inputs: { competitorPriceCad: 1000, ourCostCad: 800, targetMarginPct: 10 } });
    const after8 = await pi(PN);
    ok(s8.status === 200 && JSON.stringify(Object.keys(after8).sort()) === JSON.stringify(["competitorPriceCad", "ourCostCad", "targetMarginPct"]), "原来没有 pricingInputs：只写三项人工输入，不凭空多出镜像键", after8);
    const PX = await mkProject(null);
    ok((await post(PX, { action: "save", inputs: { competitorPriceCad: 1 } })).status === 409, "没有投标调查室：409（与原来相同）");
  } finally {
    await db.bidIntelligenceRoom.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.auditLog.deleteMany({ where: { OR: [{ orgId: ORG }, { userId: { in: users } }, { projectId: { in: projectIds } }] } });
    await db.projectMember.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.project.deleteMany({ where: { id: { in: projectIds } } });
    await db.organizationMember.deleteMany({ where: { orgId: ORG } });
    await db.organization.deleteMany({ where: { id: ORG } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.$disconnect();
  }

  console.log(`\nFIX-8 pricing helper save DB: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
