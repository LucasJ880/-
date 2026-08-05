/**
 * SupplierLink 并发 P2002 回收语义（无真实 DB）
 */
import assert from "node:assert/strict";
import { isPrismaUniqueViolation } from "../prisma-errors";

function simulatePostCreate(opts: {
  existingBefore: boolean;
  createThrowsP2002: boolean;
  recovered: {
    projectId: string;
    supplierId: string;
    orgId: string;
  } | null;
  request: { projectId: string; supplierId: string; orgId: string };
}): { created: boolean; ok: boolean; status?: number } {
  if (opts.existingBefore) return { created: false, ok: true };
  if (!opts.createThrowsP2002) return { created: true, ok: true };
  // P2002 path
  assert.equal(isPrismaUniqueViolation({ code: "P2002" }), true);
  const r = opts.recovered;
  if (
    !r ||
    r.projectId !== opts.request.projectId ||
    r.supplierId !== opts.request.supplierId ||
    r.orgId !== opts.request.orgId
  ) {
    return { created: false, ok: false, status: 409 };
  }
  return { created: false, ok: true };
}

async function main() {
  console.log("pre-existing → created:false");
  {
    const r = simulatePostCreate({
      existingBefore: true,
      createThrowsP2002: false,
      recovered: null,
      request: { projectId: "p1", supplierId: "s1", orgId: "o1" },
    });
    assert.equal(r.created, false);
    assert.equal(r.ok, true);
  }

  console.log("create ok → created:true");
  {
    const r = simulatePostCreate({
      existingBefore: false,
      createThrowsP2002: false,
      recovered: null,
      request: { projectId: "p1", supplierId: "s1", orgId: "o1" },
    });
    assert.equal(r.created, true);
  }

  console.log("P2002 + matching recover → created:false");
  {
    const r = simulatePostCreate({
      existingBefore: false,
      createThrowsP2002: true,
      recovered: { projectId: "p1", supplierId: "s1", orgId: "o1" },
      request: { projectId: "p1", supplierId: "s1", orgId: "o1" },
    });
    assert.equal(r.created, false);
    assert.equal(r.ok, true);
  }

  console.log("P2002 + org mismatch → 409");
  {
    const r = simulatePostCreate({
      existingBefore: false,
      createThrowsP2002: true,
      recovered: { projectId: "p1", supplierId: "s1", orgId: "OTHER" },
      request: { projectId: "p1", supplierId: "s1", orgId: "o1" },
    });
    assert.equal(r.ok, false);
    assert.equal(r.status, 409);
  }

  console.log("non-P2002 not treated as unique");
  assert.equal(isPrismaUniqueViolation({ code: "P2003" }), false);

  console.log("supplier-link-idempotency.test PASS");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
