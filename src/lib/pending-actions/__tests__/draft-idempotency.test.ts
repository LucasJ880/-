/**
 * 审批草稿幂等键冲突判定与有上限的重跑——纯逻辑（无 DB）
 * change：approval-draft-idempotency-race；能力 approvals/draft-idempotency。
 *
 * 运行：npx tsx src/lib/pending-actions/__tests__/draft-idempotency.test.ts
 * 真实库上的并发路径见 draft-idempotency-race-db.isolated.test.ts。
 */
import { Prisma } from "@prisma/client";
import {
  DRAFT_IDEMPOTENCY_CONSTRAINT,
  DRAFT_IDEMPOTENCY_MAX_ATTEMPTS,
  isDraftIdempotencyConflict,
  withDraftIdempotencyRetry,
} from "../draft-idempotency";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail) : ""); }
}

const prismaError = (code: string, meta?: Record<string, unknown>) =>
  new Prisma.PrismaClientKnownRequestError(`fixture ${code}`, { code, clientVersion: "fixture", meta });
/** 本地 PostgreSQL 16 + Prisma 6.19 实测的形状 */
const conflict = () => prismaError("P2002", { modelName: "PendingAction", target: ["orgId", "idempotencyKey"] });

async function main() {
  console.log("draft idempotency — pure");

  // —— 冲突判定 ——
  ok(isDraftIdempotencyConflict(conflict()), "PendingAction 上 orgId + idempotencyKey 的 P2002 → 复用信号");
  ok(isDraftIdempotencyConflict(prismaError("P2002", { modelName: "PendingAction", target: ["idempotencyKey", "orgId"] })), "字段顺序不同 → 仍是复用信号");
  ok(isDraftIdempotencyConflict(prismaError("P2002", { modelName: "PendingAction", target: DRAFT_IDEMPOTENCY_CONSTRAINT })), "目标是约束名 → 复用信号");
  ok(isDraftIdempotencyConflict({ code: "P2002", meta: { modelName: "PendingAction", target: ["orgId", "idempotencyKey"] } }), "不是 Prisma 类实例但形状相同 → 复用信号（按形状判定）");
  ok(!isDraftIdempotencyConflict(prismaError("P2002", { modelName: "PendingAction", target: ["id"] })), "PendingAction 主键冲突 → 不是");
  ok(!isDraftIdempotencyConflict(prismaError("P2002", { modelName: "PendingAction", target: ["orgId", "idempotencyKey", "type"] })), "多一个字段的唯一冲突 → 不是");
  ok(!isDraftIdempotencyConflict(prismaError("P2002", { modelName: "PendingAction", target: ["idempotencyKey"] })), "只有幂等键一个字段 → 不是");
  ok(!isDraftIdempotencyConflict(prismaError("P2002", { modelName: "AgentRunStep", target: ["orgId", "idempotencyKey"] })), "别的表上同名字段的唯一冲突（AgentRunStep） → 不是");
  ok(!isDraftIdempotencyConflict(prismaError("P2002", { modelName: "ApprovalDecisionIdempotency", target: ["orgId", "idempotencyKey"] })), "别的表上同名字段的唯一冲突（ApprovalDecisionIdempotency） → 不是");
  ok(!isDraftIdempotencyConflict(prismaError("P2002", { target: ["orgId", "idempotencyKey"] })), "字段数组但没有表名 → 不是");
  ok(!isDraftIdempotencyConflict(prismaError("P2002", { modelName: "AgentRunStep", target: DRAFT_IDEMPOTENCY_CONSTRAINT })), "约束名对但表名是别的表 → 不是");
  ok(!isDraftIdempotencyConflict(prismaError("P2002", { modelName: "PendingAction", target: "AgentRunStep_orgId_idempotencyKey_key" })), "别的约束名 → 不是");
  ok(!isDraftIdempotencyConflict(prismaError("P2002")), "P2002 但没有 meta → 不是");
  ok(!isDraftIdempotencyConflict(prismaError("P2003", { modelName: "PendingAction", field_name: "PendingAction_createdById_fkey (index)" })), "外键错误 P2003 → 不是");
  ok(!isDraftIdempotencyConflict(prismaError("P2028", { modelName: "PendingAction" })), "事务超时 P2028 → 不是");
  ok(!isDraftIdempotencyConflict(new Error("connection reset")), "普通错误 → 不是");
  ok(!isDraftIdempotencyConflict(null) && !isDraftIdempotencyConflict(undefined) && !isDraftIdempotencyConflict("P2002"), "null / undefined / 字符串 → 不是");

  // —— 有上限的整段重跑 ——
  {
    let calls = 0;
    const v = await withDraftIdempotencyRetry(async () => { calls++; return "ok"; });
    ok(v === "ok" && calls === 1, "一次成功：只跑一次", { calls });
  }
  {
    let calls = 0;
    const v = await withDraftIdempotencyRetry(async () => { calls++; if (calls === 1) throw conflict(); return "reused"; });
    ok(v === "reused" && calls === 2, "第一次冲突：重跑一次后拿到结果", { calls });
  }
  {
    let calls = 0;
    let last: unknown;
    let thrown: unknown;
    try {
      await withDraftIdempotencyRetry(async () => { calls++; last = conflict(); throw last; });
    } catch (e) { thrown = e; }
    ok(DRAFT_IDEMPOTENCY_MAX_ATTEMPTS === 3 && calls === 3 && thrown === last, "一直冲突：跑满 3 次后抛出最后一次的错误", { calls });
  }
  {
    let calls = 0;
    const fk = prismaError("P2003", { modelName: "PendingAction" });
    let thrown: unknown;
    try {
      await withDraftIdempotencyRetry(async () => { calls++; throw fk; });
    } catch (e) { thrown = e; }
    ok(calls === 1 && thrown === fk, "外键错误：不重跑，原样抛出", { calls });
  }
  {
    let calls = 0;
    const other = prismaError("P2002", { modelName: "PendingAction", target: ["id"] });
    let thrown: unknown;
    try {
      await withDraftIdempotencyRetry(async () => { calls++; throw other; });
    } catch (e) { thrown = e; }
    ok(calls === 1 && thrown === other, "别的唯一冲突：不重跑，原样抛出", { calls });
  }
  {
    let calls = 0;
    const boom = new Error("boom");
    let thrown: unknown;
    try {
      await withDraftIdempotencyRetry(async () => { calls++; if (calls === 1) throw conflict(); throw boom; });
    } catch (e) { thrown = e; }
    ok(calls === 2 && thrown === boom, "先冲突、重跑时遇到别的错误：抛出那个别的错误，不再重跑", { calls });
  }

  console.log("");
  console.log(`draft idempotency: ${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("draft idempotency test crashed:", e);
  process.exit(1);
});
