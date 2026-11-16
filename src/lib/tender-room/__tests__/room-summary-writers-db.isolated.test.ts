/**
 * FIX-11 调查室 summaryJson 的其它写入方与报价同步 / 彼此串行——真实 DB（隔离库），强制交错
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated JWT_SECRET=… \
 *   npx tsx src/lib/tender-room/__tests__/room-summary-writers-db.isolated.test.ts
 * 无隔离库时自动跳过。全部数据为 fixture。不发任何邮件，不调模型；盯梢抓取用注入的假 fetch，不访问外网。
 */
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过 FIX-11 调查室 summaryJson 写入方 DB 测试（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "FIX-11 room summary writers DB test" });

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
  const { checkTenderWatch } = await import("@/lib/tender-intel/watch");
  const { saveWorkspaceBlocks, loadWorkspace } = await import("@/lib/tender-bid-workspace/store");
  const awardRoute = await import("@/app/api/projects/[id]/external-intel/award-history/route");
  const watchRoute = await import("@/app/api/projects/[id]/tender-watch/route");

  console.log("FIX-11 room summaryJson writers — isolated DB");
  const stamp = Date.now().toString(36);
  const OWNER = `rwowner_${stamp}`;
  const ORG = `rworg_${stamp}`;
  const email = `${OWNER}@fixture.test`;
  await db.user.create({ data: { id: OWNER, email, name: "Fixture Owner", role: "user" } });
  await db.organization.create({ data: { id: ORG, name: "Fixture Bidder Inc.", code: `rw-${stamp}`, ownerId: OWNER } });
  await db.organizationMember.create({ data: { orgId: ORG, userId: OWNER, role: "org_admin", status: "active" } });
  const cookie = `qy_session=${await createSession({ sub: OWNER, email, role: "user" })}`;

  const projectIds: string[] = [];
  let seq = 0;
  async function mkProject(summaryJson: Rec) {
    seq += 1;
    const id = `rwproj_${stamp}_${seq}`;
    projectIds.push(id);
    await db.project.create({ data: { id, name: `Fixture Tender ${stamp}-${seq}`, orgId: ORG, ownerId: OWNER, workDomain: "tender", intakeStatus: "dispatched", status: "active" } as never });
    await db.bidIntelligenceRoom.create({ data: { orgId: ORG, projectId: id, summaryJson: summaryJson as never } });
    return id;
  }
  const sjOf = async (projectId: string) => rec((await db.bidIntelligenceRoom.findUniqueOrThrow({ where: { projectId }, select: { summaryJson: true } })).summaryJson);
  const commitMirror = (projectId: string, quoteId: string, price: number) =>
    db.$transaction(async (tx) => { await lockProject(tx as never, projectId); await writeBidMirrorsTx(tx as never, { projectId, quoteId, version: 1, sellingPrice: price, currency: "CAD" }); });
  const HOLDERS = { solicitationId: "FIX-11-001", portal: "Fixture Portal", sourceKind: "USER_UPLOAD_TABLE", capturedAt: "2026-11-16T00:00:00Z", entries: [{ name: "Fixture Holder Ltd." }], evidenceRef: null };
  const htmlResponse = (body: string) => new Response(body, { status: 200, headers: { "content-type": "text/html" } });

  /** 报价同步在项目行锁下写镜像、先不提交；这期间做 fn；holdMs 后提交 */
  async function duringOpenSync<T>(projectId: string, quoteId: string, price: number, fn: () => Promise<T>, holdMs = 400): Promise<T> {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let locked!: () => void;
    const lockedP = new Promise<void>((r) => { locked = r; });
    const sync = db.$transaction(async (tx) => {
      await lockProject(tx as never, projectId);
      await writeBidMirrorsTx(tx as never, { projectId, quoteId, version: 1, sellingPrice: price, currency: "CAD" });
      locked();
      await gate;
    }, { timeout: 20_000 });
    await lockedP;
    const p = fn();
    await sleep(holdMs);
    release();
    await sync;
    return p;
  }

  try {
    // 预热：路由与模块第一次调用很慢，会让交错不成立
    const PW = await mkProject({});
    await awardRoute.POST(new NextRequest(`http://localhost/api/projects/${PW}/external-intel/award-history`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ kind: "competitor", vendorName: "Warmup Co" }) }), { params: Promise.resolve({ id: PW }) });
    await watchRoute.DELETE(new NextRequest(`http://localhost/api/projects/${PW}/tender-watch`, { method: "DELETE", headers: { cookie } }), { params: Promise.resolve({ id: PW }) });
    await saveWorkspaceBlocks({ projectId: PW, orgId: ORG, userId: OWNER, request: { documentHolders: HOLDERS } as never }).catch(() => null);

    /* ---------- 1. 盯梢抓取期间报价同步提交：抓取写回时不把新报价盖掉 ---------- */
    const P1 = await mkProject({ pricingInputs: { competitorPriceCad: 1000 }, tenderWatch: { url: "https://example.invalid/notice", lastHash: "old", lastCheckedAt: null } });
    await commitMirror(P1, "q_before", 500);
    const r1 = await checkTenderWatch(P1, {
      fetchImpl: (async () => {
        // 抓取「进行中」：另一边把新报价写进去并提交
        await commitMirror(P1, "q_during_fetch", 777);
        return htmlResponse("<html><body>notice v2</body></html>");
      }) as typeof fetch,
    });
    const s1 = await sjOf(P1);
    ok(r1.status === "changed", "（前提）盯梢检查到页面变化", r1);
    ok(rec(s1.pricingInputs).ourPriceCad === 777 && rec(s1.pricingInputs).ourPriceSource === "quote:q_during_fetch:v1" && rec(s1.pricingInputs).competitorPriceCad === 1000, "抓取期间提交的新报价还在（原来被抓取前读到的旧整块盖回去）", s1.pricingInputs);
    ok(rec(s1.tenderWatch).lastHash !== "old" && typeof rec(s1.tenderWatch).lastCheckedAt === "string" && typeof rec(s1.tenderWatch).lastChangedAt === "string", "盯梢状态照常更新", s1.tenderWatch);

    /* ---------- 2. 盯梢抓取期间被停掉：不写回、不通知 ---------- */
    const P2 = await mkProject({ tenderWatch: { url: "https://example.invalid/notice2", lastHash: "old", lastCheckedAt: null } });
    const notesBefore = await db.notification.count({ where: { projectId: P2 } });
    const r2 = await checkTenderWatch(P2, {
      fetchImpl: (async () => {
        const res = await watchRoute.DELETE(new NextRequest(`http://localhost/api/projects/${P2}/tender-watch`, { method: "DELETE", headers: { cookie } }), { params: Promise.resolve({ id: P2 }) });
        if (res.status !== 200) throw new Error(`delete ${res.status}`);
        return htmlResponse("<html><body>changed page</body></html>");
      }) as typeof fetch,
    });
    const s2 = await sjOf(P2);
    ok(!("tenderWatch" in s2), "抓取期间停掉的盯梢不会被写回来", s2);
    ok(r2.status === "no_watch" && (await db.notification.count({ where: { projectId: P2 } })) === notesBefore, "这种情况返回「没有盯梢」，不发变化通知", r2);

    /* ---------- 3. 投标工作区保存 vs. 先读后写的同步：价格表与新报价都在 ---------- */
    const P3 = await mkProject({ pricingInputs: { competitorPriceCad: 2000 } });
    let release3!: () => void;
    const gate3 = new Promise<void>((r) => { release3 = r; });
    let read3!: () => void;
    const readP3 = new Promise<void>((r) => { read3 = r; });
    // 与 writeBidMirrorsTx 同样的写法：锁项目行 → 读房间 → （这里停一下）→ 展开旧值写回
    const syncLike = db.$transaction(async (tx) => {
      await lockProject(tx as never, P3);
      const room = await tx.bidIntelligenceRoom.findUniqueOrThrow({ where: { projectId: P3 }, select: { id: true, summaryJson: true } });
      read3();
      await gate3;
      const sj = rec(room.summaryJson);
      await tx.bidIntelligenceRoom.update({ where: { id: room.id }, data: { summaryJson: { ...sj, pricingInputs: { ...rec(sj.pricingInputs), ourPriceCad: 3333, ourPriceSource: "quote:q_synclike:v1" } } as never } });
    }, { timeout: 20_000 });
    await readP3;
    // 立刻接住结果：原来的写法会死锁、被中止，不能让它在等待期间变成未处理的拒绝
    const save3 = saveWorkspaceBlocks({ projectId: P3, orgId: ORG, userId: OWNER, request: { documentHolders: HOLDERS } as never }).then((v) => v, (e) => ({ error: String(e) }));
    await sleep(400);
    release3();
    let syncErr: unknown = null;
    await syncLike.catch((e) => { syncErr = e; });
    const w3 = await save3;
    // 原来两边锁的顺序相反（工作区先锁房间行、写审计时要项目行；同步先锁项目行、再写房间），会死锁、其中一边被数据库中止
    ok(syncErr === null, "同步一方没有因死锁被中止", String(syncErr).slice(0, 200));
    const s3 = await sjOf(P3);
    const ws3 = await loadWorkspace(P3);
    ok(!("error" in rec(w3)), "投标工作区保存成功，没有因死锁被中止", String(rec(w3).error ?? "").slice(0, 200));
    ok(rec(s3.pricingInputs).ourPriceCad === 3333 && rec(s3.pricingInputs).competitorPriceCad === 2000, "同步写的新报价在", s3.pricingInputs);
    ok(!!ws3 && JSON.stringify(ws3.documentHolders ?? null).includes("Fixture Holder Ltd."), "投标工作区这次保存的内容也在（原来锁房间行挡不住，同步用旧值把它盖掉）", { ws3, keys: Object.keys(s3) });

    /* ---------- 4. 外部情报确认竞争对手 vs. 未提交的报价同步 ---------- */
    const P4 = await mkProject({ pricingInputs: { competitorPriceCad: 4000 }, externalConfirmed: { competitors: [{ name: "Existing Rival", url: null }] } });
    await commitMirror(P4, "q4_old", 400);
    const r4 = await duringOpenSync(P4, "q4_new", 4444, async () => {
      const res = await awardRoute.POST(new NextRequest(`http://localhost/api/projects/${P4}/external-intel/award-history`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ kind: "competitor", vendorName: "Fixture Rival Two" }) }), { params: Promise.resolve({ id: P4 }) });
      return { status: res.status, body: rec(await res.json().catch(() => null)) };
    });
    const s4 = await sjOf(P4);
    const comps = (rec(s4.externalConfirmed).competitors as Array<{ name: string }> | undefined) ?? [];
    ok(r4.status === 200, "（前提）确认竞争对手成功", r4);
    ok(rec(s4.pricingInputs).ourPriceCad === 4444 && rec(s4.pricingInputs).ourPriceSource === "quote:q4_new:v1", "同步提交的新报价在（原来被确认前读到的旧整块盖回去）", s4.pricingInputs);
    ok(comps.map((c) => c.name).join("|") === "Existing Rival|Fixture Rival Two", "竞争对手列表在最新值上加了这一家", comps);
    const returned = (rec(r4.body.externalConfirmed).competitors as Array<{ name: string }> | undefined) ?? [];
    ok(returned.map((c) => c.name).join("|") === comps.map((c) => c.name).join("|"), "返回的 externalConfirmed 与库里一致（按名称比；jsonb 不保留对象里键的顺序）", { returned, comps });

    /* ---------- 5. 停止盯梢 vs. 未提交的报价同步 ---------- */
    const P5 = await mkProject({ tenderWatch: { url: "https://example.invalid/n5" }, pricingInputs: { competitorPriceCad: 5000 } });
    const r5 = await duringOpenSync(P5, "q5_new", 5555, async () => {
      const res = await watchRoute.DELETE(new NextRequest(`http://localhost/api/projects/${P5}/tender-watch`, { method: "DELETE", headers: { cookie } }), { params: Promise.resolve({ id: P5 }) });
      return res.status;
    });
    const s5 = await sjOf(P5);
    ok(r5 === 200 && !("tenderWatch" in s5) && rec(s5.pricingInputs).ourPriceCad === 5555 && rec(s5.pricingInputs).competitorPriceCad === 5000, "停止盯梢：盯梢去掉，同步提交的新报价与人工输入都在", s5);
  } finally {
    await db.notification.deleteMany({ where: { OR: [{ userId: OWNER }, { projectId: { in: projectIds } }] } });
    await db.bidIntelligenceRoom.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.auditLog.deleteMany({ where: { OR: [{ orgId: ORG }, { userId: OWNER }, { projectId: { in: projectIds } }] } });
    await db.project.deleteMany({ where: { id: { in: projectIds } } });
    await db.organizationMember.deleteMany({ where: { orgId: ORG } });
    await db.organization.deleteMany({ where: { id: ORG } });
    await db.user.deleteMany({ where: { id: OWNER } });
    await db.$disconnect();
  }

  console.log(`\nFIX-11 room summary writers DB: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
