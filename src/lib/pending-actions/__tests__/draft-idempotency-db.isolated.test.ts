/**
 * FIX-5 待审批草稿按「企业 + 幂等键」只建一张 — 真实 DB（隔离库，虚构企业；spec approvals/draft-idempotency）
 *
 *   顺序重复两次：同一个 id、库里一行。
 *   同键并发两次（10 轮，每轮换一个键）：两边都成功、同一个 id、库里一行，没有「建草稿失败」的错误日志。
 *   一批两条（一条与并发的单条请求同键、一条新键）与单条请求并发：两边都成功，撞键的复用、新键新建，顺序与请求一致。
 *
 * 只建草稿，不批准、不执行、不出站。
 *
 * 运行（隔离库）：
 *   DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated \
 *   npx tsx src/lib/pending-actions/__tests__/draft-idempotency-db.isolated.test.ts
 * 无隔离库时自动跳过。
 */
import { assertSafeTestDatabase } from "@/lib/testing/assert-safe-test-database";

function skip(reason: string): never {
  console.log(`⏭  跳过 FIX-5 草稿幂等隔离 DB 测试（${reason}）`);
  process.exit(0);
}
if (!process.env.DATABASE_URL?.trim()) skip("未提供 DATABASE_URL");
if (process.env.NODE_ENV !== "test") skip("需 NODE_ENV=test");
if ((process.env.DATABASE_ENVIRONMENT || "").toLowerCase() !== "isolated") skip("需 DATABASE_ENVIRONMENT=isolated");
assertSafeTestDatabase({ scriptName: "FIX-5 draft idempotency DB test" });

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail).slice(0, 1200) : "");
  }
}

const stamp = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const USER = `fx_fix5_user_${stamp}`;
const ORG = `fx_fix5_org_${stamp}`;
const ROUNDS = 10;

async function main() {
  const { db } = await import("@/lib/db");
  const { createDraftBatch } = await import("@/lib/pending-actions/drafts");

  // 拦截错误日志：建草稿失败会打 `[createDraftBatch] failed`
  const errorLines: string[] = [];
  const realError = console.error;
  console.error = (...args: unknown[]) => {
    errorLines.push(args.map((a) => (a instanceof Error ? `${a.name}: ${a.message}` : String(a))).join(" "));
  };
  const draftFailures = () => errorLines.filter((l) => l.includes("[createDraftBatch] failed")).length;

  const input = (key: string, title = "Example 提醒") => ({
    type: "assistant.create_reminder" as const,
    title,
    preview: "明早 9 点提醒跟进",
    payload: { key },
    userId: USER,
    orgId: ORG,
    idempotencyKey: key,
  });
  const rows = (key: string) => db.pendingAction.count({ where: { orgId: ORG, idempotencyKey: key } });
  const firstId = (r: Awaited<ReturnType<typeof createDraftBatch>>) => (r.success ? r.actions[0]?.actionId : null);

  try {
    await db.user.create({ data: { id: USER, email: `${USER}@fixture.test`, name: "Example Owner", role: "user" } });
    await db.organization.create({ data: { id: ORG, name: `Example Drafts ${stamp}`, code: `fx-fix5-${stamp}`, ownerId: USER } });

    console.log("FIX-5 草稿幂等（隔离库）");

    console.log("\n顺序重复");
    {
      const a = await createDraftBatch([input("seq")]);
      const b = await createDraftBatch([input("seq", "第二次的标题")]);
      ok(a.success && b.success && firstId(a) === firstId(b) && (await rows("seq")) === 1, "同键先后两次：都成功、同一个 id、库里一行", { a, b });
      ok(b.success && b.actions[0].title === "Example 提醒", "第二次返回已有那张的标题，不是本次请求的", b);
    }

    console.log("\n同键并发");
    {
      const outcomes: string[] = [];
      let allOk = true;
      for (let i = 0; i < ROUNDS; i++) {
        const key = `race-${i}`;
        const [a, b] = await Promise.all([createDraftBatch([input(key)]), createDraftBatch([input(key)])]);
        const n = await rows(key);
        const good = a.success && b.success && firstId(a) === firstId(b) && n === 1;
        if (!good) allOk = false;
        outcomes.push(`${a.success ? "ok" : "FAIL"}/${b.success ? "ok" : "FAIL"} rows=${n}${firstId(a) && firstId(a) === firstId(b) ? " same-id" : ""}`);
      }
      ok(allOk, `并发两次 × ${ROUNDS} 轮：每轮两边都成功、同一个 id、库里一行`, outcomes);
      ok(draftFailures() === 0, "并发全程没有「建草稿失败」的错误日志", errorLines.slice(0, 3));
    }

    console.log("\n一批里撞键的条目");
    {
      const outcomes: string[] = [];
      let allOk = true;
      for (let i = 0; i < 5; i++) {
        const shared = `mix-shared-${i}`;
        const fresh = `mix-fresh-${i}`;
        const [batch, single] = await Promise.all([
          createDraftBatch([input(shared), input(fresh)]),
          createDraftBatch([input(shared)]),
        ]);
        const ids = batch.success ? batch.actions.map((x) => x.actionId) : [];
        const keys = ids.length
          ? (await db.pendingAction.findMany({ where: { id: { in: ids } }, select: { id: true, idempotencyKey: true } })).reduce<Record<string, string | null>>((m, r) => ((m[r.id] = r.idempotencyKey), m), {})
          : {};
        const good =
          batch.success &&
          single.success &&
          ids.length === 2 &&
          ids[0] === firstId(single) &&
          ids[1] !== ids[0] &&
          keys[ids[0]] === shared &&
          keys[ids[1]] === fresh &&
          (await rows(shared)) === 1 &&
          (await rows(fresh)) === 1;
        if (!good) allOk = false;
        outcomes.push(`${batch.success ? "ok" : "FAIL"}/${single.success ? "ok" : "FAIL"} ${good ? "good" : JSON.stringify(keys)}`);
      }
      ok(allOk, "一批两条与同键单条并发 × 5 轮：两边都成功；撞键的与单条同一个 id，新键新建；顺序与请求一致；每个键一行", outcomes);
      ok(draftFailures() === 0, "一批撞键时也没有「建草稿失败」的错误日志", errorLines.slice(0, 3));
    }

    const pendingCount = await db.pendingAction.count({ where: { orgId: ORG, status: { not: "pending" } } });
    ok(pendingCount === 0, "没有草稿被补偿标成失败（全是待审批）", pendingCount);
  } finally {
    console.error = realError;
    await db.auditLog.deleteMany({ where: { OR: [{ userId: USER }, { orgId: ORG }] } }).catch(() => undefined);
    await db.pendingAction.deleteMany({ where: { orgId: ORG } }).catch(() => undefined);
    await db.organization.deleteMany({ where: { id: ORG } }).catch((e) => console.warn("org cleanup:", e instanceof Error ? e.message : e));
    await db.user.deleteMany({ where: { id: USER } }).catch((e) => console.warn("user cleanup:", e instanceof Error ? e.message : e));
    await db.$disconnect();
  }

  console.log(`\nFIX-5 草稿幂等 DB：${pass} 通过，${fail} 失败`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
