/**
 * schema-drift helper + list/detail fallback 契约（无真实 DB）
 */
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import {
  bidWorkflowUnavailableFields,
  isPrismaSchemaDriftError,
  withBidWorkflowSchemaFallback,
} from "../schema-drift";

function prismaKnown(code: string, message = "x"): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(message, {
    code,
    clientVersion: "test",
  });
}

async function main() {
  console.log("isPrismaSchemaDriftError");
  assert.equal(isPrismaSchemaDriftError(prismaKnown("P2021")), true);
  assert.equal(isPrismaSchemaDriftError(prismaKnown("P2022")), true);
  assert.equal(isPrismaSchemaDriftError(prismaKnown("P2002")), false);
  assert.equal(isPrismaSchemaDriftError(new Error("P2022 in message")), false);
  assert.equal(isPrismaSchemaDriftError({ code: "P2021" }), false);

  console.log("withBidWorkflowSchemaFallback primary ok");
  {
    const r = await withBidWorkflowSchemaFallback({
      logLabel: "t.primary",
      primary: async () => ({ ok: 1 }),
      fallback: async () => ({ ok: 0 }),
    });
    assert.equal(r.usedFallback, false);
    assert.deepEqual(r.value, { ok: 1 });
  }

  console.log("P2022 triggers fallback");
  {
    const r = await withBidWorkflowSchemaFallback({
      logLabel: "t.p2022",
      primary: async () => {
        throw prismaKnown("P2022", 'Column "bidPhaseStatus" does not exist');
      },
      fallback: async () => ({ legacy: true }),
    });
    assert.equal(r.usedFallback, true);
    assert.equal(r.driftCode, "P2022");
    assert.deepEqual(r.value, { legacy: true });
  }

  console.log("P2021 triggers fallback");
  {
    const r = await withBidWorkflowSchemaFallback({
      logLabel: "t.p2021",
      primary: async () => {
        throw prismaKnown("P2021", 'Table "BidIntelligenceRoom" does not exist');
      },
      fallback: async () => ({ legacy: true }),
    });
    assert.equal(r.usedFallback, true);
    assert.equal(r.driftCode, "P2021");
  }

  console.log("unknown error is not swallowed");
  {
    let threw = false;
    try {
      await withBidWorkflowSchemaFallback({
        logLabel: "t.unknown",
        primary: async () => {
          throw new Error("connection reset");
        },
        fallback: async () => ({ bad: true }),
      });
    } catch (e) {
      threw = true;
      assert.equal(e instanceof Error && e.message, "connection reset");
    }
    assert.equal(threw, true);
  }

  console.log("P2002 (unique) is not treated as schema drift");
  {
    let threw = false;
    try {
      await withBidWorkflowSchemaFallback({
        logLabel: "t.p2002",
        primary: async () => {
          throw prismaKnown("P2002", "Unique constraint failed");
        },
        fallback: async () => ({ bad: true }),
      });
    } catch {
      threw = true;
    }
    assert.equal(threw, true);
  }

  console.log("unavailable fields shape");
  {
    const u = bidWorkflowUnavailableFields();
    assert.equal(u.bidPhaseStatus, null);
    assert.equal(u.intelligenceRoom, null);
    assert.equal(u.intelligenceAvailable, false);
  }

  console.log("schema-drift.test PASS");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
