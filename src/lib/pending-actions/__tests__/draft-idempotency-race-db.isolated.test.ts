/**
 * 审批草稿并发幂等复用——真实 DB（隔离库）
 * change：approval-draft-idempotency-race；能力 approvals/draft-idempotency。
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated \
 *   npx tsx src/lib/pending-actions/__tests__/draft-idempotency-race-db.isolated.test.ts
 * 无隔离库时自动跳过。全部数据为 fixture。
 *
 * 怎么稳定地制造并发：先在一个单独的事务里对提交人那一行 User 加 FOR UPDATE。
 * 建卡写入 PendingAction 时要对 createdById 做外键检查（FOR KEY SHARE），会等这把锁；
 * 先写入的一方已把唯一索引项放进去，后写入的一方在唯一索引上等先写入方的事务。
 * 测试在 pg_stat_activity 里看到两条写 PendingAction 的会话都在等锁后才放锁——
 * 此时两边都已越过「查已有记录」，后到方必然撞上组织 + 幂等键的唯一冲突。
 * 看不到就判失败，不靠运气。
 */
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过 审批草稿并发幂等复用 DB 测试（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "approval draft idempotency race DB test" });

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail).slice(0, 1500) : ""); }
}

// 记下 createDraftBatch 打的错误日志（照常输出，另存一份用于断言）
const draftErrors: string[] = [];
const origError = console.error.bind(console);
console.error = (...args: unknown[]) => {
  const text = args.map((a) => (a instanceof Error ? `${a.name}: ${a.message}` : String(a))).join(" ");
  if (text.includes("[createDraftBatch]")) draftErrors.push(text);
  origError(...args);
};

async function main() {
  const { db } = await import("@/lib/db");
  const { createDraftBatch } = await import("../drafts");
  type Input = Parameters<typeof createDraftBatch>[0][number];
  type Result = Awaited<ReturnType<typeof createDraftBatch>>;

  console.log("approval draft idempotency race — isolated DB");
  const stamp = Date.now().toString(36);
  const U = `dirU_${stamp}`; // 被加锁的提交人
  const U2 = `dirU2_${stamp}`; // 不加锁的提交人
  const ORG = `dirOrg_${stamp}`;
  const GHOST = `dirGhost_${stamp}`; // 库里不存在的用户
  const key = (n: string) => `dir_${stamp}_${n}`;

  await db.user.create({ data: { id: U, email: `${U}@fixture.test`, name: "Fixture Submitter", role: "admin" } });
  await db.user.create({ data: { id: U2, email: `${U2}@fixture.test`, name: "Fixture Submitter 2", role: "admin" } });
  await db.organization.create({ data: { id: ORG, name: "Fixture Draft Org", code: `dir-${stamp}`, ownerId: U } });

  const input = (idempotencyKey: string | undefined, userId: string = U): Input => ({
    type: "grader.internal_note",
    title: "Fixture 草稿",
    preview: "Fixture 草稿预览",
    payload: { note: "fixture", key: idempotencyKey ?? null },
    userId,
    orgId: ORG,
    idempotencyKey,
  });
  const rowsFor = (k: string) => db.pendingAction.findMany({ where: { orgId: ORG, idempotencyKey: k }, select: { id: true } });
  const idsOf = (r: Result | undefined) => (r?.success ? r.actions.map((a) => a.actionId) : []);

  type RawTx = { $queryRaw: typeof db.$queryRaw; $executeRaw: typeof db.$executeRaw };
  /**
   * 有几条写 PendingAction 的会话正被本事务的锁挡住（直接挡住，或挡在被挡住的会话后面）。
   * 只数这条阻塞链上的会话，同时跑的其它测试不会混进来。
   * pg_stat_activity 在同一事务里第一次读取后就固定为快照，每次读之前先清掉，否则一直读到第一次的结果。
   */
  async function waitingInserts(tx: RawTx): Promise<number> {
    await tx.$executeRaw`SELECT pg_stat_clear_snapshot()`;
    const rows = await tx.$queryRaw<Array<{ n: number }>>`
      WITH RECURSIVE chain(pid) AS (
        SELECT a.pid FROM pg_stat_activity a WHERE pg_backend_pid() = ANY(pg_blocking_pids(a.pid))
        UNION
        SELECT a.pid FROM pg_stat_activity a JOIN chain c ON c.pid = ANY(pg_blocking_pids(a.pid))
      )
      SELECT count(*)::int AS n FROM pg_stat_activity a JOIN chain c ON c.pid = a.pid
      WHERE a.wait_event_type = 'Lock' AND a.query ILIKE '%INSERT INTO%"PendingAction"%'`;
    return rows[0]?.n ?? 0;
  }
  async function waitFor(tx: RawTx, n: number): Promise<boolean> {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      if ((await waitingInserts(tx)) >= n) return true;
      await new Promise((r) => setTimeout(r, 25));
    }
    return false;
  }

  /**
   * 锁住 U，按顺序发起调用：每发起一个就等它卡在写入上，全部卡住后放锁。
   * 第一个发起的就是先写入的一方。
   */
  async function raceOnLockedWrites(calls: Array<() => Promise<Result>>): Promise<{ results: Result[]; blocked: boolean }> {
    const started: Array<Promise<Result>> = [];
    let blocked = true;
    await db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${U} FOR UPDATE`;
        for (let i = 0; i < calls.length; i++) {
          started.push(calls[i]());
          if (!(await waitFor(tx, i + 1))) { blocked = false; break; }
        }
      },
      { timeout: 30_000, maxWait: 10_000 },
    );
    return { results: await Promise.all(started), blocked };
  }

  try {
    // —— 1. 先后两次建卡：复用 ——
    {
      const k = key("seq");
      const a = await createDraftBatch([input(k)]);
      const b = await createDraftBatch([input(k)]);
      const rows = await rowsFor(k);
      ok(a.success && b.success && idsOf(a)[0] === idsOf(b)[0] && rows.length === 1, "先后两次建卡：同一个审批 id，库里只有一条", { a, b, rows: rows.length });
    }

    // —— 2. 不带幂等键：每次新建 ——
    {
      const a = await createDraftBatch([input(undefined)]);
      const b = await createDraftBatch([input(undefined)]);
      ok(a.success && b.success && idsOf(a)[0] !== idsOf(b)[0], "不带幂等键：两次两个不同的审批 id", { a: idsOf(a), b: idsOf(b) });
    }

    // —— 3. 两个请求都卡在写入上：后到方复用先到方的卡 ——
    {
      const k = key("race");
      const errorsBefore = draftErrors.length;
      const { results, blocked } = await raceOnLockedWrites([
        () => createDraftBatch([input(k)]),
        () => createDraftBatch([input(k)]),
      ]);
      const [first, second] = results;
      const rows = await rowsFor(k);
      ok(blocked, "并发前提成立：两条写入都在等锁（两边都已越过查已有记录）");
      ok(first?.success === true && second?.success === true, "两个请求都成功，后到方没有收到建卡失败", { first, second });
      ok(rows.length === 1 && idsOf(first)[0] === rows[0]?.id && idsOf(second)[0] === rows[0]?.id, "两个请求返回同一个审批 id，库里只有一条", { first: idsOf(first), second: idsOf(second), rows });
      const newErrors = draftErrors.slice(errorsBefore);
      ok(newErrors.length === 0, "没有建卡失败的错误日志（含 25P02）", newErrors);
    }

    // —— 4. 一批里只有一张撞上并发 ——
    {
      const kNew = key("batch_new");
      const kRace = key("batch_race");
      const errorsBefore = draftErrors.length;
      const { results, blocked } = await raceOnLockedWrites([
        () => createDraftBatch([input(kRace)]), // 先写入的一方
        () => createDraftBatch([input(kNew, U2), input(kRace)]), // 新键的那张不受锁影响，撞上并发的那张后到
      ]);
      const [single, batch] = results;
      const raceRows = await rowsFor(kRace);
      const newRows = await rowsFor(kNew);
      const batchIds = idsOf(batch);
      ok(blocked, "并发前提成立：单张与批量里那张都在等锁");
      ok(single?.success === true && batch?.success === true && batchIds.length === 2, "批量成功返回两张卡", { single, batch });
      ok(raceRows.length === 1 && batchIds[1] === raceRows[0]?.id && idsOf(single)[0] === raceRows[0]?.id, "撞上并发的那张返回另一个请求建成的审批 id", { batchIds, single: idsOf(single), raceRows });
      ok(newRows.length === 1 && batchIds[0] === newRows[0]?.id, "新幂等键的那张在库里只有一条", { batchIds, newRows });
      const newErrors = draftErrors.slice(errorsBefore);
      ok(newErrors.length === 0, "批量并发：没有建卡失败的错误日志", newErrors);
    }

    // —— 5. 引用的用户不存在：照旧整批失败，不留记录 ——
    {
      const kA = key("ghost_a");
      const kB = key("ghost_b");
      const r = await createDraftBatch([input(kA), input(kB, GHOST)]);
      const rowsA = await rowsFor(kA);
      const rowsB = await rowsFor(kB);
      ok(!r.success && r.errorCode === "DRAFT_CREATION_FAILED", "第二张的提交人不存在：整批返回 DRAFT_CREATION_FAILED", r);
      ok(rowsA.length === 0 && rowsB.length === 0, "这一批两张卡的幂等键在库里都没有记录", { rowsA: rowsA.length, rowsB: rowsB.length });
    }
  } finally {
    await db.pendingAction.deleteMany({ where: { orgId: ORG } });
    await db.auditLog.deleteMany({ where: { userId: { in: [U, U2, GHOST] } } });
    await db.organization.deleteMany({ where: { id: ORG } });
    await db.user.deleteMany({ where: { id: { in: [U, U2] } } });
    await db.$disconnect();
  }

  console.log("");
  console.log(`审批草稿并发幂等复用 DB: ${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  origError("draft idempotency race test crashed:", e);
  process.exit(1);
});
