/**
 * FIX-9 报价表助手写入与报价同步串行——真实 DB（隔离库），调用真实路由，强制交错
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated JWT_SECRET=… \
 *   npx tsx src/lib/tender-pricing/__tests__/pricing-helper-lock-db.isolated.test.ts
 * 无隔离库时自动跳过。全部数据为 fixture（虚构组织 / 用户 / 项目）。不发任何邮件，不调任何外部接口，不调模型
 * （推导用的分析没有评分条款，推导直接返回「无」，不走模型）。
 */
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过 FIX-9 报价表助手写入加锁 DB 测试（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "FIX-9 pricing helper lock DB test" });

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail).slice(0, 1500) : ""); }
}

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : {});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const { NextRequest } = await import("next/server");
  const { db } = await import("@/lib/db");
  const { createSession } = await import("@/lib/auth/session");
  const { writeBidMirrorsTx, lockProject } = await import("@/lib/quote-engine/tender-bid");
  const route = await import("@/app/api/projects/[id]/pricing-helper/route");

  console.log("FIX-9 pricing helper write lock — isolated DB");
  const stamp = Date.now().toString(36);
  const OWNER = `plowner_${stamp}`;
  const ORG = `plorg_${stamp}`;
  const email = (id: string) => `${id}@fixture.test`;

  await db.user.create({ data: { id: OWNER, email: email(OWNER), name: "Fixture Owner", role: "user" } });
  await db.organization.create({ data: { id: ORG, name: "Fixture Bidder Inc.", code: `pl-${stamp}`, ownerId: OWNER } });
  await db.organizationMember.create({ data: { orgId: ORG, userId: OWNER, role: "org_admin", status: "active" } });

  const projectIds: string[] = [];
  let seq = 0;
  async function mkProject(summaryJson: Rec, withRun = false) {
    seq += 1;
    const id = `plproj_${stamp}_${seq}`;
    projectIds.push(id);
    await db.project.create({ data: { id, name: `Fixture Tender ${stamp}-${seq}`, orgId: ORG, ownerId: OWNER, workDomain: "tender", intakeStatus: "dispatched", status: "active" } as never });
    await db.bidIntelligenceRoom.create({ data: { orgId: ORG, projectId: id, summaryJson: summaryJson as never } });
    // 没有评分条款的已完成分析：推导不调模型，直接返回「无」
    if (withRun) await db.tenderAnalysisRun.create({ data: { orgId: ORG, projectId: id, status: "REVIEW_REQUIRED", idempotencyKey: `plrun_${stamp}_${seq}`, sourceHashFingerprint: "fixture", summaryJson: {} } });
    return id;
  }
  const cookie = `qy_session=${await createSession({ sub: OWNER, email: email(OWNER), role: "user" })}`;
  const post = async (projectId: string, body: unknown) => {
    const res = await route.POST(new NextRequest(`http://localhost/api/projects/${projectId}/pricing-helper`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ id: projectId }) });
    return { status: res.status, body: rec(await res.json().catch(() => null)) };
  };
  const roomSj = async (projectId: string) => rec((await db.bidIntelligenceRoom.findUniqueOrThrow({ where: { projectId }, select: { summaryJson: true } })).summaryJson);
  const pi = async (projectId: string) => rec((await roomSj(projectId)).pricingInputs);
  const mirror = (projectId: string, quoteId: string, version: number, sellingPrice: number) =>
    db.$transaction((tx) => writeBidMirrorsTx(tx as never, { projectId, quoteId, version, sellingPrice, currency: "CAD" }));

  /**
   * 报价同步在项目行锁下写镜像、先不提交；这期间发起 fn；等 holdMs 再提交同步。
   * 返回 fn 的结果，以及 fn 是否在同步提交之前就返回了（加锁之后应当等到提交之后）。
   */
  async function duringOpenSync<T>(projectId: string, quoteId: string, price: number, fn: () => Promise<T>, holdMs = 400) {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let locked!: () => void;
    const lockedP = new Promise<void>((r) => { locked = r; });
    let committedAt = 0;
    const sync = db.$transaction(async (tx) => {
      await lockProject(tx as never, projectId);
      await writeBidMirrorsTx(tx as never, { projectId, quoteId, version: 1, sellingPrice: price, currency: "CAD" });
      locked();
      await gate;
    }, { timeout: 20_000 }).then(() => { committedAt = Date.now(); });
    await lockedP;
    let doneAt = 0;
    const p = fn().then((v) => { doneAt = Date.now(); return v; });
    await sleep(holdMs);
    release();
    await sync;
    const value = await p;
    return { value, waitedForSync: doneAt >= committedAt };
  }

  try {
    // 预热：路由第一次调用要加载模块、建连接，会比同步持锁的时间还长，交错就不成立了
    const PW = await mkProject({});
    ok((await post(PW, { action: "save", inputs: { competitorPriceCad: 1 } })).status === 200, "（前提）预热调用成功");

    /* ---------- 1. 保存发起时报价同步还没提交：同步的新报价与新输入都留下 ---------- */
    const P = await mkProject({ incumbentLead: { vendor: "Fixture Incumbent" }, pricingInputs: { competitorPriceCad: 90000, ourCostCad: 60000, targetMarginPct: 20 } });
    await mirror(P, "q_old", 1, 80000);
    const r1 = await duringOpenSync(P, "q_new", 95000, () => post(P, { action: "save", inputs: { competitorPriceCad: 101000, ourCostCad: 70500, targetMarginPct: 18 } }));
    const a1 = await pi(P);
    ok(r1.value.status === 200, "（前提）保存成功", r1.value.body);
    ok(a1.ourPriceCad === 95000 && a1.ourPrice === 95000 && a1.ourPriceSource === "quote:q_new:v1" && a1.ourPriceStatus === "AUTHORITATIVE", "同步提交后：镜像是同步写的新报价，没被保存用旧值盖回去", a1);
    ok(a1.competitorPriceCad === 101000 && a1.ourCostCad === 70500 && a1.targetMarginPct === 18, "同步提交后：三项人工输入是这次保存的值", a1);
    ok(rec((await roomSj(P)).incumbentLead).vendor === "Fixture Incumbent", "summaryJson 里别的键不动");
    ok(r1.waitedForSync, "保存在同步提交之后才返回");
    ok(JSON.stringify(Object.keys(rec(r1.value.body.inputs)).sort()) === JSON.stringify(["competitorPriceCad", "ourCostCad", "targetMarginPct"]) && rec(r1.value.body.inputs).ourCostCad === 70500, "返回形状不变：inputs 只有三项人工输入", r1.value.body);

    /* ---------- 2. 只改一项、在同步期间：没带的项沿用同步提交后的库里值 ---------- */
    const r2 = await duringOpenSync(P, "q_new2", 97000, () => post(P, { action: "save", inputs: { targetMarginPct: 15 } }));
    const a2 = await pi(P);
    ok(r2.value.status === 200 && a2.targetMarginPct === 15 && a2.competitorPriceCad === 101000 && a2.ourCostCad === 70500 && a2.ourPriceCad === 97000 && a2.ourPriceSource === "quote:q_new2:v1", "只改目标毛利：另两项沿用，镜像是同步的新值", a2);

    /* ---------- 3. 只存评分模型、在同步期间 ---------- */
    const r3 = await duringOpenSync(P, "q_new3", 99000, () => post(P, { action: "save", model: { priceWeightPct: 40, costFormula: "lowest_over_bid", otherCriteria: [] } }));
    const sj3 = await roomSj(P);
    ok(r3.value.status === 200 && rec(sj3.pricingModel).source === "HUMAN" && rec(sj3.pricingModel).priceWeightPct === 40 && rec(sj3.pricingInputs).ourPriceCad === 99000 && rec(sj3.pricingInputs).targetMarginPct === 15, "只存人工模型：模型写入，镜像是同步的新值，输入不变", sj3);

    /* ---------- 4. 拒绝的保存在同步期间也不写 ---------- */
    const r4 = await duringOpenSync(P, "q_new4", 100000, () => post(P, { action: "save", inputs: { targetMarginPct: 100 } }));
    const a4 = await pi(P);
    ok(r4.value.status === 400 && a4.targetMarginPct === 15 && a4.ourPriceCad === 100000, "目标毛利 ≥ 100%：400，库里只有同步写的变化", { body: r4.value.body, a4 });

    /* ---------- 5. 推导发起时报价同步还没提交：镜像不被推导用旧的整块盖回去 ---------- */
    const PD = await mkProject({ pricingInputs: { competitorPriceCad: 50000, targetMarginPct: 10 } }, true);
    await mirror(PD, "q_d_old", 1, 40000);
    const r5 = await duringOpenSync(PD, "q_d_new", 45000, () => post(PD, { action: "derive" }));
    const sj5 = await roomSj(PD);
    const a5 = rec(sj5.pricingInputs);
    ok(r5.value.status === 200 && r5.value.body.via === "NONE", "（前提）推导成功，没走模型", r5.value.body);
    ok(a5.ourPriceCad === 45000 && a5.ourPriceSource === "quote:q_d_new:v1" && a5.competitorPriceCad === 50000 && a5.targetMarginPct === 10, "同步提交后：镜像是同步的新报价，人工输入还在", a5);
    ok(typeof sj5.pricingDerivedAt === "string" && !Number.isNaN(Date.parse(String(sj5.pricingDerivedAt))), "推导时间照常写入", sj5.pricingDerivedAt);
    ok(r5.waitedForSync, "推导在同步提交之后才返回");

    /* ---------- 6. 推导不覆盖人工模型：在写入时按库里的最新值判断 ---------- */
    const PH = await mkProject({}, true);
    await db.bidIntelligenceRoom.update({ where: { projectId: PH }, data: { summaryJson: { pricingModel: { version: "tender-pricing-model/v1", priceWeightPct: 30, costFormula: "unknown", otherCriteria: [], source: "HUMAN", evidenceZh: [], derivedAt: new Date().toISOString() } } as never } });
    const r6 = await post(PH, { action: "derive" });
    const sj6 = await roomSj(PH);
    ok(r6.status === 200 && r6.body.keptHumanOverride === true && rec(sj6.pricingModel).source === "HUMAN" && rec(sj6.pricingModel).priceWeightPct === 30, "已有人工模型：推导保留它（与原来相同）", { body: r6.body, sj6 });
    ok((await post(PH, { action: "derive" })).status === 429, "60 秒内再推导：429（与原来相同）");

    /* ---------- 7. 不在同步期间：与原来相同 ---------- */
    const PN = await mkProject({});
    const s7 = await post(PN, { action: "save", inputs: { competitorPriceCad: 1000, ourCostCad: 800, targetMarginPct: 10 } });
    const a7 = await pi(PN);
    ok(s7.status === 200 && JSON.stringify(Object.keys(a7).sort()) === JSON.stringify(["competitorPriceCad", "ourCostCad", "targetMarginPct"]), "没有并发：只写三项人工输入", a7);
  } finally {
    await db.tenderAnalysisRun.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.bidIntelligenceRoom.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.auditLog.deleteMany({ where: { OR: [{ orgId: ORG }, { userId: OWNER }, { projectId: { in: projectIds } }] } });
    await db.project.deleteMany({ where: { id: { in: projectIds } } });
    await db.organizationMember.deleteMany({ where: { orgId: ORG } });
    await db.organization.deleteMany({ where: { id: ORG } });
    await db.user.deleteMany({ where: { id: OWNER } });
    await db.$disconnect();
  }

  console.log(`\nFIX-9 pricing helper lock DB: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
