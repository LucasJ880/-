/**
 * FIX-10 分析投影与开始调查不再整块替换 BidIntelligenceRoom.summaryJson——真实 DB（隔离库）
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated JWT_SECRET=… \
 *   npx tsx src/lib/tender-room/__tests__/room-summary-merge-db.isolated.test.ts
 * 无隔离库时自动跳过。全部数据为 fixture（虚构组织 / 用户 / 项目）。不发任何邮件，不调任何外部接口，不调模型。
 */
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过 FIX-10 调查室 summaryJson 合并写 DB 测试（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "FIX-10 room summary merge DB test" });

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail).slice(0, 1500) : ""); }
}

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : {});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** jsonb 不保留键的顺序：按键排序后再比 */
const canon = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v as Rec).sort().map((k) => [k, canon((v as Rec)[k])])) : v;
const same = (a: unknown, b: unknown) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

async function main() {
  const { db } = await import("@/lib/db");
  const { projectAnalysisToRoom } = await import("@/lib/tender-auto-analysis/project-room");
  const { startBidIntelligence } = await import("@/lib/bid-workflow/start-intelligence");
  const { writeBidMirrorsTx, lockProject } = await import("@/lib/quote-engine/tender-bid");

  console.log("FIX-10 room summaryJson merge — isolated DB");
  const stamp = Date.now().toString(36);
  const OWNER = `rsowner_${stamp}`;
  const ORG = `rsorg_${stamp}`;
  await db.user.create({ data: { id: OWNER, email: `${OWNER}@fixture.test`, name: "Fixture Owner", role: "user" } });
  await db.organization.create({ data: { id: ORG, name: "Fixture Bidder Inc.", code: `rs-${stamp}`, ownerId: OWNER } });
  await db.organizationMember.create({ data: { orgId: ORG, userId: OWNER, role: "org_admin", status: "active" } });

  /** 别的功能写在调查室 summaryJson 里的键（报价表助手 + 报价引擎镜像、投标工作区、跟标、报价模型） */
  const featureKeys = (): Rec => ({
    pricingInputs: { competitorPriceCad: 90000, ourCostCad: 60000, targetMarginPct: 18, ourPriceCad: 98765, ourPrice: 98765, ourPriceCurrency: "CAD", ourPriceSource: "quote:q_fixture:v2", ourPriceStatus: "AUTHORITATIVE" },
    pricingModel: { version: "tender-pricing-model/v1", priceWeightPct: 40, costFormula: "unknown", otherCriteria: [], source: "HUMAN", evidenceZh: [], derivedAt: "2026-11-01T00:00:00.000Z" },
    bidWorkspace: { version: 1, priceSchedule: { lines: [{ lineNo: "1", description: "Fixture roller shade", quantity: 12 }] }, addenda: [] },
    tenderWatch: { enabled: true, lastCheckedAt: "2026-11-01T00:00:00.000Z" },
  });

  const projectIds: string[] = [];
  let seq = 0;
  async function mkProject() {
    seq += 1;
    const id = `rsproj_${stamp}_${seq}`;
    projectIds.push(id);
    await db.project.create({ data: { id, name: `Fixture Tender ${stamp}-${seq}`, orgId: ORG, ownerId: OWNER, workDomain: "tender", intakeStatus: "dispatched", status: "active" } as never });
    return id;
  }
  async function mkRun(projectId: string, roomId: string | null, summaryJson: Rec, status = "REVIEW_REQUIRED") {
    seq += 1;
    return db.tenderAnalysisRun.create({ data: { orgId: ORG, projectId, roomId, status, idempotencyKey: `rsrun_${stamp}_${seq}`, sourceHashFingerprint: "fixture", summaryJson: summaryJson as never, summaryText: `analysis ${seq}` } });
  }
  const roomOf = (projectId: string) => db.bidIntelligenceRoom.findUniqueOrThrow({ where: { projectId }, select: { id: true, summaryJson: true, summaryText: true, summaryStatus: true } });
  const sjOf = async (projectId: string) => rec((await roomOf(projectId)).summaryJson);
  const keepsFeatureKeys = (sj: Rec) => {
    const want = featureKeys();
    return Object.keys(want).every((k) => same(sj[k], want[k]));
  };

  try {
    /* ---------- 1. 重新分析之后的投影：别的功能的键都在，分析的键换成新的 ---------- */
    const P = await mkProject();
    const room = await db.bidIntelligenceRoom.create({ data: { orgId: ORG, projectId: P, summaryJson: { ...featureKeys() } as never } });
    const run1 = await mkRun(P, room.id, { projectName: "First analysis", solicitationNumber: "FIX-001", oldOnlyKey: "only in run 1" });
    const r1 = await projectAnalysisToRoom({ runId: run1.id, projectId: P, orgId: ORG, roomId: room.id });
    const sj1 = await sjOf(P);
    ok(r1.projected === true, "（前提）第一次投影成功", r1);
    ok(keepsFeatureKeys(sj1), "第一次投影：报价表助手 / 报价引擎镜像 / 投标工作区 / 跟标 / 报价模型的键原样保留", Object.keys(sj1));
    ok(sj1.projectName === "First analysis" && sj1.oldOnlyKey === "only in run 1" && sj1.projectedFromRunId === run1.id, "第一次投影：分析的键写入，记下来自哪一次分析", sj1);

    const run2 = await mkRun(P, room.id, { projectName: "Re-analysis after addendum", solicitationNumber: "FIX-001" });
    const r2 = await projectAnalysisToRoom({ runId: run2.id, projectId: P, orgId: ORG, roomId: room.id });
    const after2 = await roomOf(P);
    const sj2 = rec(after2.summaryJson);
    ok(r2.projected === true, "（前提）重新分析之后再投影成功", r2);
    ok(keepsFeatureKeys(sj2), "重新分析之后：别的功能的键仍原样保留（原来整块被换掉）", Object.keys(sj2));
    ok(sj2.projectName === "Re-analysis after addendum" && sj2.projectedFromRunId === run2.id, "重新分析之后：分析的键是新一次的", sj2);
    ok(!("oldOnlyKey" in sj2), "上一次投影写的、这一次没有的分析键被去掉（不留旧分析的残值）", sj2);
    ok(after2.summaryText === run2.summaryText && after2.summaryStatus === "investigating", "摘要文字与状态照旧更新", { summaryText: after2.summaryText, summaryStatus: after2.summaryStatus });

    /* ---------- 2. 已被替代的分析不写（与原来相同） ---------- */
    const before3 = await sjOf(P);
    const runOld = await mkRun(P, room.id, { projectName: "Superseded" }, "SUPERSEDED");
    const r3 = await projectAnalysisToRoom({ runId: runOld.id, projectId: P, orgId: ORG, roomId: room.id });
    ok(r3.projected === false && r3.reason === "run_superseded" && same(await sjOf(P), before3), "已被替代的分析：不投影，房间不变", r3);

    /* ---------- 3. 投影时报价同步正在进行：同步的新报价不被盖回去 ---------- */
    const PQ = await mkProject();
    const roomQ = await db.bidIntelligenceRoom.create({ data: { orgId: ORG, projectId: PQ, summaryJson: { ...featureKeys() } as never } });
    const runQ = await mkRun(PQ, roomQ.id, { projectName: "Analysis during quote sync" });
    // 预热：第一次调用要加载模块，交错要在热路径上做
    await projectAnalysisToRoom({ runId: runQ.id, projectId: PQ, orgId: ORG, roomId: roomQ.id });
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let locked!: () => void;
    const lockedP = new Promise<void>((r) => { locked = r; });
    const sync = db.$transaction(async (tx) => {
      await lockProject(tx as never, PQ);
      await writeBidMirrorsTx(tx as never, { projectId: PQ, quoteId: "q_during", version: 1, sellingPrice: 123456, currency: "CAD" });
      locked();
      await gate;
    }, { timeout: 20_000 });
    await lockedP;
    const proj = projectAnalysisToRoom({ runId: runQ.id, projectId: PQ, orgId: ORG, roomId: roomQ.id });
    await sleep(400);
    release();
    await sync;
    const rq = await proj;
    const sjQ = await sjOf(PQ);
    ok(rq.projected === true && rec(sjQ.pricingInputs).ourPriceCad === 123456 && rec(sjQ.pricingInputs).ourPriceSource === "quote:q_during:v1" && rec(sjQ.pricingInputs).competitorPriceCad === 90000, "投影与报价同步交错：同步提交的新报价与人工输入都在", sjQ.pricingInputs);
    ok(sjQ.projectName === "Analysis during quote sync" && rec(sjQ.bidWorkspace).version === 1, "交错时投影照常写入，投标工作区还在", sjQ);

    /* ---------- 4. 开始投标调查：房间已有（投标工作区先建的）但还没有摘要 ---------- */
    const PS = await mkProject();
    await db.bidIntelligenceRoom.create({ data: { orgId: ORG, projectId: PS, summaryJson: { ...featureKeys() } as never } });
    const s4 = await startBidIntelligence({ orgId: ORG, projectId: PS, actorUserId: OWNER });
    const after4 = await roomOf(PS);
    const sj4 = rec(after4.summaryJson);
    ok(s4.ok === true && s4.created === false && !!after4.summaryText, "（前提）开始调查：沿用已有的房间，写入初始摘要", { s4, summaryText: after4.summaryText });
    ok(keepsFeatureKeys(sj4), "开始调查：房间里别的功能的键原样保留（原来整块被换成初始摘要）", Object.keys(sj4));
    ok(Object.keys(sj4).length > Object.keys(featureKeys()).length, "开始调查：初始摘要的键也写进去了", Object.keys(sj4));

    /* ---------- 5. 开始投标调查：没有房间时照常新建 ---------- */
    const PN = await mkProject();
    const s5 = await startBidIntelligence({ orgId: ORG, projectId: PN, actorUserId: OWNER });
    const after5 = await roomOf(PN);
    ok(s5.ok === true && s5.created === true && !!after5.summaryText && Object.keys(rec(after5.summaryJson)).length > 0, "没有房间：新建房间并写入初始摘要（与原来相同）", { s5, keys: Object.keys(rec(after5.summaryJson)) });
  } finally {
    const rooms = await db.bidIntelligenceRoom.findMany({ where: { projectId: { in: projectIds } }, select: { id: true } });
    const roomIds = rooms.map((r) => r.id);
    await db.task.deleteMany({ where: { OR: [{ projectId: { in: projectIds } }, { sourceId: { in: roomIds } }] } });
    await db.bidIntelligenceModule.deleteMany({ where: { roomId: { in: roomIds } } });
    await db.tenderAnalysisRun.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.bidIntelligenceRoom.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.notification.deleteMany({ where: { OR: [{ userId: OWNER }, { projectId: { in: projectIds } }] } });
    await db.auditLog.deleteMany({ where: { OR: [{ orgId: ORG }, { userId: OWNER }, { projectId: { in: projectIds } }] } });
    await db.projectMessage.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.projectMember.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.project.deleteMany({ where: { id: { in: projectIds } } });
    await db.organizationMember.deleteMany({ where: { orgId: ORG } });
    await db.organization.deleteMany({ where: { id: ORG } });
    await db.user.deleteMany({ where: { id: OWNER } });
    await db.$disconnect();
  }

  console.log(`\nFIX-10 room summary merge DB: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
