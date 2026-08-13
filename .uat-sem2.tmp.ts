import fs from "node:fs";
const envFile = process.env.QY_UAT_ENVFILE!;
for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
  const m = line.match(/^([A-Za-z0-9_]+)="(.*)"$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
}
if ((process.env.DATABASE_URL ?? "").includes("ep-super-field-antfibsl")) throw new Error("REFUSING prod");
const PID = "cmsr0t06u0001l7044n50zuz5";
async function main() {
  const { db } = await import("@/lib/db");
  const proj = await db.project.findUnique({ where: { id: PID }, select: { orgId: true, ownerId: true } });
  if (!proj) throw new Error("project missing");
  // 与 reanalyze API 相同的产品路径（forceNewRun = 重新分析语义）
  const { enqueueTenderPackageAnalysis } = await import("@/lib/tender-auto-analysis/enqueue-package");
  const enq = await enqueueTenderPackageAnalysis({
    projectId: PID,
    userId: proj.ownerId,
    orgId: proj.orgId ?? undefined,
    forceNewRun: true,
  });
  console.log("ENQUEUE " + JSON.stringify({ enqueued: enq.enqueued, reason: enq.reason, runId: enq.runId }));
  if (!enq.enqueued && enq.reason !== "idempotent_reuse") throw new Error("enqueue failed: " + enq.reason);
  const { processQueuedTenderAnalysisRuns } = await import("@/lib/tender-auto-analysis/worker");
  for (let round = 1; round <= 4; round++) {
    const out = await processQueuedTenderAnalysisRuns(1);
    console.log(`round=${round} processed=${out.processed} succeeded=${out.succeeded} failed=${out.failed}`);
    if (out.processed === 0) break;
  }
  const r = await db.$queryRaw<Array<Record<string, unknown>>>`
    SELECT "id","status","errorMessageSanitized",
      ("summaryJson"->'analystSynthesis'->>'version') AS syn_version,
      ("summaryJson"->'analystSynthesis'->'qa'->>'status') AS qa_status,
      jsonb_array_length("summaryJson"->'analystSynthesis'->'keyRequirements') AS key_count
    FROM "TenderAnalysisRun" WHERE "projectId"=${PID} ORDER BY "createdAt" DESC LIMIT 1`;
  console.log("FINAL_RUN " + JSON.stringify(r[0], (_k, v) => (typeof v === "bigint" ? Number(v) : v)));
}
main().then(() => process.exit(0)).catch((e) => { console.error("ERR", e?.message ?? e); process.exit(1); });
