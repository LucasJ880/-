import assert from "node:assert/strict";
import {
  createMemoryBriefClaimStore,
  DEFAULT_CLAIM_TTL_MS,
} from "../brief-claim";

async function main() {
  const store = createMemoryBriefClaimStore();
  const base = {
    orgId: "orgA",
    projectId: "projA",
    briefType: "project_daily_brief",
    localDate: "2026-08-03",
    claimTtlMs: DEFAULT_CLAIM_TTL_MS,
  };

  // 并发：两个同时 claim，仅一个获得执行权
  const results = await Promise.all([
    store.claim({
      ...base,
      correlationId: "c1",
      servicePrincipal: "system:cron:qm-project-daily-brief",
    }),
    store.claim({
      ...base,
      correlationId: "c2",
      servicePrincipal: "system:cron:qm-project-daily-brief",
    }),
  ]);
  const claimed = results.filter((r) => r.ok && r.claimed);
  const blocked = results.filter((r) => r.ok && !r.claimed);
  assert.equal(claimed.length, 1);
  assert.equal(blocked.length, 1);
  if (blocked[0].ok && !blocked[0].claimed) {
    assert.equal(blocked[0].reason, "in_progress");
  }

  const winner = claimed[0];
  assert.ok(winner.ok && winner.claimed);
  await store.complete({
    id: winner.record.id,
    briefMarkdown: "# brief",
    pendingActionId: "pa1",
  });

  // 完成后再次 claim → duplicate
  const again = await store.claim({
    ...base,
    correlationId: "c3",
    servicePrincipal: "system:cron:qm-project-daily-brief",
  });
  assert.equal(again.ok, true);
  if (again.ok) {
    assert.equal(again.claimed, false);
    if (!again.claimed) assert.equal(again.reason, "duplicate_completed");
  }

  // stale STARTED 可接管
  const store2 = createMemoryBriefClaimStore();
  const staleNow = new Date("2026-08-03T10:00:00Z");
  const first = await store2.claim({
    orgId: "orgA",
    projectId: "projB",
    briefType: "project_daily_brief",
    localDate: "2026-08-03",
    correlationId: "s1",
    servicePrincipal: "sp",
    claimTtlMs: 1000,
    now: staleNow,
  });
  assert.ok(first.ok && first.claimed);

  const afterExpiry = new Date(staleNow.getTime() + 5000);
  const reclaim = await store2.claim({
    orgId: "orgA",
    projectId: "projB",
    briefType: "project_daily_brief",
    localDate: "2026-08-03",
    correlationId: "s2",
    servicePrincipal: "sp",
    claimTtlMs: 60_000,
    now: afterExpiry,
  });
  assert.ok(reclaim.ok && reclaim.claimed);

  // FAILED 后可重试
  await store2.fail({ id: reclaim.record.id, errorMessage: "boom" });
  const retry = await store2.claim({
    orgId: "orgA",
    projectId: "projB",
    briefType: "project_daily_brief",
    localDate: "2026-08-03",
    correlationId: "s3",
    servicePrincipal: "sp",
    claimTtlMs: 60_000,
    now: afterExpiry,
  });
  assert.ok(retry.ok && retry.claimed);

  console.log("brief-claim: all passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
