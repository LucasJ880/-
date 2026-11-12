/**
 * FIX-5 待审批草稿按「企业 + 幂等键」只建一张（spec approvals/draft-idempotency；change draft-idempotent-race-reuse）
 * 假事务注入「建或复用一行」，不连数据库。并发的真实行为见 draft-idempotency-db.isolated.test.ts。
 * 运行：npx tsx src/lib/pending-actions/__tests__/draft-idempotency.test.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}${detail === undefined ? "" : ` → ${JSON.stringify(detail)}`}`);
  }
}
const code = (p: string) =>
  readFileSync(join(process.cwd(), p), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

type Row = { id: string; type: string; title: string; preview: string; agentRunId: string | null; payloadHash?: string | null };
type Call = { op: "findFirst" | "create" | "createManyAndReturn"; args: Record<string, unknown> };

/** 假事务：按脚本依次给出 findFirst 与 createManyAndReturn 的结果，记下每次调用 */
function fakeTx(script: { found?: Array<Row | null>; inserted?: Row[][] }) {
  const calls: Call[] = [];
  const found = [...(script.found ?? [])];
  const inserted = [...(script.inserted ?? [])];
  const tx = {
    pendingAction: {
      findFirst: async (args: Record<string, unknown>) => {
        calls.push({ op: "findFirst", args });
        return found.length ? found.shift() ?? null : null;
      },
      create: async (args: Record<string, unknown>) => {
        calls.push({ op: "create", args });
        const data = args.data as Record<string, unknown>;
        return { id: "new-plain", type: data.type, title: data.title, preview: data.preview, agentRunId: data.agentRunId ?? null };
      },
      createManyAndReturn: async (args: Record<string, unknown>) => {
        calls.push({ op: "createManyAndReturn", args });
        return inserted.length ? inserted.shift() ?? [] : [];
      },
    },
  };
  return { tx, calls };
}

const base = {
  type: "assistant.create_reminder",
  title: "Example 提醒",
  preview: "明早 9 点提醒跟进",
  payload: { when: "2026-11-13T09:00:00Z", note: undefined },
  userId: "u1",
};
const existingRow: Row = { id: "pa_existing", type: "assistant.create_reminder", title: "先到的那张", preview: "先到的摘要", agentRunId: "run_a", payloadHash: "hash_existing" };

async function main() {
  const drafts = await import("../drafts");
  const { createOrReuseDraftRow } = drafts;
  const run = (tx: unknown, input: Record<string, unknown>) =>
    createOrReuseDraftRow(tx as never, input as never);

  console.log("draft-idempotency（待审批草稿按企业 + 幂等键只建一张）");

  console.log("\n带企业与幂等键");
  {
    const { tx, calls } = fakeTx({ found: [null], inserted: [[{ id: "pa_new", type: base.type, title: base.title, preview: base.preview, agentRunId: null }]] });
    const out = await run(tx, { ...base, orgId: "o1", idempotencyKey: "k1" });
    const ins = calls.find((c) => c.op === "createManyAndReturn");
    const data = (ins?.args.data as Array<Record<string, unknown>> | undefined) ?? [];
    ok(out.actionId === "pa_new" && out.title === base.title && out.reused === undefined, "没有已有行：插入成功，返回新建的那张（不标复用）", out);
    ok(calls.map((c) => c.op).join(",") === "findFirst,createManyAndReturn", "先按键查，再插入（不走普通 create）", calls.map((c) => c.op));
    ok(ins?.args.skipDuplicates === true && data.length === 1 && data[0].orgId === "o1" && data[0].idempotencyKey === "k1" && data[0].status === "pending", "插入遇唯一冲突什么都不做（skipDuplicates），只插这一行、状态待审批", ins?.args);
    ok(typeof out.payloadHash === "string" && out.payloadHash.length > 0 && out.payloadHash === data[0].payloadHash, "新建的返回本次载荷的哈希（与落库的一致）", out.payloadHash);
    const where = calls[0].args.where as Record<string, unknown>;
    ok(where.orgId === "o1" && where.idempotencyKey === "k1" && Object.keys(where).length === 2, "按企业 + 幂等键查，不看状态", where);
  }
  {
    const { tx, calls } = fakeTx({ found: [existingRow] });
    const out = await run(tx, { ...base, orgId: "o1", idempotencyKey: "k1" });
    ok(out.actionId === "pa_existing" && out.title === "先到的那张" && out.preview === "先到的摘要" && out.payloadHash === "hash_existing" && out.agentRunId === "run_a" && out.reused === true, "先查命中：复用已有那张，返回它的 id、类型、标题、摘要与哈希，标为复用", out);
    ok(calls.length === 1 && calls[0].op === "findFirst", "先查命中：不发插入", calls.map((c) => c.op));
  }
  {
    const { tx, calls } = fakeTx({ found: [null, existingRow], inserted: [[]] });
    const out = await run(tx, { ...base, orgId: "o1", idempotencyKey: "k1" });
    ok(out.actionId === "pa_existing" && out.payloadHash === "hash_existing" && out.reused === true, "插入撞键（没插进去）：在同一事务里按键读出先到者的行并复用，标为复用", out);
    ok(calls.map((c) => c.op).join(",") === "findFirst,createManyAndReturn,findFirst", "撞键后再按键读一次，不抛错、不重插", calls.map((c) => c.op));
  }
  {
    const { tx } = fakeTx({ found: [{ ...existingRow, payloadHash: null }] });
    const out = await run(tx, { ...base, orgId: "o1", idempotencyKey: "k1" });
    ok(out.payloadHash === "", "已有行没有哈希：返回空串（与改动前相同）", out.payloadHash);
  }
  {
    const { tx, calls } = fakeTx({ found: [null, null], inserted: [[]] });
    let thrown: unknown = null;
    let out: unknown = undefined;
    try {
      out = await run(tx, { ...base, orgId: "o1", idempotencyKey: "k1" });
    } catch (e) {
      thrown = e;
    }
    ok(thrown instanceof Error && out === undefined, "撞键后按键也读不到：抛错，不返回任何草稿", { thrown: String(thrown), out });
    ok(calls.filter((c) => c.op === "createManyAndReturn").length === 1 && !calls.some((c) => c.op === "create"), "读不到时不改走普通插入、不重试", calls.map((c) => c.op));
  }

  console.log("\n不带幂等键或不带企业");
  {
    const { tx, calls } = fakeTx({});
    const out = await run(tx, { ...base, orgId: "o1" });
    ok(out.actionId === "new-plain" && calls.length === 1 && calls[0].op === "create", "不带幂等键：普通插入，不按键查、不跳过冲突", calls.map((c) => c.op));
    const { tx: tx2, calls: calls2 } = fakeTx({});
    const out2 = await run(tx2, { ...base, idempotencyKey: "k1" });
    ok(out2.actionId === "new-plain" && calls2.length === 1 && calls2[0].op === "create", "不带企业：普通插入", calls2.map((c) => c.op));
    const data = calls[0].args.data as Record<string, unknown>;
    ok(data.idempotencyKey === null && data.status === "pending" && !("note" in (data.payload as Record<string, unknown>)), "普通插入的数据与改动前相同（幂等键为空、待审批、载荷按落库形态）", data);
  }

  console.log("\n补偿只针对本批新建的行");
  {
    const { createDraftBatch } = drafts;
    const reusedA = { actionId: "pa_other_request", type: base.type, title: "别的请求建的", preview: "p", payloadHash: "h1", agentRunId: null, reused: true as const };
    const newB = { actionId: "pa_this_batch", type: base.type, title: "本批新建", preview: "p", payloadHash: "h2", agentRunId: null };
    const compensated: string[][] = [];
    const inputs = [
      { ...base, orgId: "o1", idempotencyKey: "kA", agentRunId: "run_1" },
      { ...base, orgId: "o1", agentRunId: "run_1" },
    ];
    const failed = await createDraftBatch(inputs as never, {
      createAllInTransaction: async () => [reusedA, newB],
      auditCreated: async () => undefined,
      markAwaitingApproval: async () => {
        throw new Error("Run 不存在或跨组织");
      },
      compensate: async (ids) => {
        compensated.push(ids);
        return ids.length;
      },
    });
    ok(
      !failed.success && JSON.stringify(compensated) === JSON.stringify([["pa_this_batch"]]) && JSON.stringify(failed.compensatedActionIds) === JSON.stringify(["pa_this_batch"]),
      "事务后的步骤失败：只把本批新建的标为失败，不动复用的、别的请求建的那张",
      { compensated, failed },
    );
    const audited: unknown[] = [];
    const succeeded = await createDraftBatch(inputs as never, {
      createAllInTransaction: async () => [reusedA, newB],
      auditCreated: async (actions) => {
        audited.push(...actions);
      },
      markAwaitingApproval: async () => undefined,
      compensate: async () => 0,
    });
    ok(
      succeeded.success && succeeded.actions.length === 2 && succeeded.actions.every((a) => !("reused" in a)) && audited.length === 2 && audited.every((a) => !("reused" in (a as object))),
      "成功时返回给调用方与写审计的结果不带复用标记，形状与改动前相同",
      succeeded,
    );
  }

  console.log("\n接线（源码）");
  {
    const src = code("src/lib/pending-actions/drafts.ts");
    const txFn = src.slice(src.indexOf("async function defaultCreateAllInTransaction"), src.indexOf("export async function createDraftBatch"));
    ok(/for \(const input of inputs\) \{?\s*out\.push\(await createOrReuseDraftRow\(tx, input\)\)/.test(txFn), "整批建行：事务里逐条经「建或复用一行」");
    ok(!/catch\s*\(/.test(txFn) && !/\.create\(/.test(txFn), "整批建行：不再在事务里捕获唯一冲突、不直接 create");
    const fn = src.slice(src.indexOf("export async function createOrReuseDraftRow"), src.indexOf("async function defaultCreateAllInTransaction"));
    ok(/createManyAndReturn\(\{[\s\S]*?skipDuplicates: true/.test(fn), "带键的插入用 skipDuplicates（INSERT … ON CONFLICT DO NOTHING）");
    ok(/\{ isolationLevel: "ReadCommitted" \}/.test(txFn), "整批建行的事务显式用 READ COMMITTED（撞键后要读到先到者刚提交的行）");
  }

  console.log(`\n结果: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
