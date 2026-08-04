import assert from "node:assert/strict";
import { writeQmAuditEvent } from "../audit";

async function main() {
  const calls: Array<Record<string, unknown>> = [];
  const original = console.info;
  console.info = ((...args: unknown[]) => {
    calls.push({ kind: "info", args });
  }) as typeof console.info;

  // 无 userId 但有 servicePrincipal：不得 skip
  // logAudit 可能因无 DB 失败并 console.error — 我们只验证不走 skip 分支
  const errors: string[] = [];
  const origErr = console.error;
  console.error = ((...args: unknown[]) => {
    errors.push(args.map(String).join(" "));
  }) as typeof console.error;

  try {
    await writeQmAuditEvent({
      event: "scope.brief_completed",
      orgId: "orgA",
      projectId: "projA",
      userId: null,
      servicePrincipal: "system:cron:qm-project-daily-brief",
      actorType: "service",
      correlationId: "corr_1",
      meta: {
        trigger: "cron",
        toolsAllowed: [],
        toolsDenied: ["x"],
        durationMs: 12,
      },
    });

    const skipped = calls.some(
      (c) =>
        Array.isArray(c.args) &&
        typeof c.args[0] === "string" &&
        c.args[0].includes("qm_audit_skip_no_actor"),
    );
    assert.equal(skipped, false, "service principal 审计不得 skip");
  } finally {
    console.info = original;
    console.error = origErr;
  }

  // 既无 user 也无 service → skip
  const skipCalls: string[] = [];
  console.info = ((msg?: unknown) => {
    if (typeof msg === "string") skipCalls.push(msg);
  }) as typeof console.info;
  try {
    await writeQmAuditEvent({
      event: "scope.automation_skipped",
      orgId: "orgA",
      reason: "x",
    });
    assert.ok(skipCalls.some((s) => s.includes("qm_audit_skip_no_actor")));
  } finally {
    console.info = original;
  }

  console.log("service-audit: all passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
