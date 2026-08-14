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
  const { enqueueTenderPackageAnalysis } = await import("@/lib/tender-auto-analysis/enqueue-package");
  const enq = await enqueueTenderPackageAnalysis({
    projectId: PID, userId: proj!.ownerId, orgId: proj!.orgId ?? undefined, forceNewRun: true,
  });
  console.log("ENQUEUE " + JSON.stringify({ enqueued: enq.enqueued, reason: enq.reason }));
  const { processQueuedTenderAnalysisRuns } = await import("@/lib/tender-auto-analysis/worker");
  for (let round = 1; round <= 4; round++) {
    const out = await processQueuedTenderAnalysisRuns(1);
    console.log(`round=${round} processed=${out.processed} succeeded=${out.succeeded} failed=${out.failed}`);
    if (out.processed === 0) break;
  }
  const room = await db.$queryRaw<Array<Record<string, unknown>>>`
    SELECT jsonb_array_length("summaryJson"->'externalCandidates'->'candidates') AS award_c,
           jsonb_array_length("summaryJson"->'webIntel'->'candidates') AS web_c,
           ("summaryJson"->'webIntel'->>'note') AS web_note
    FROM "BidIntelligenceRoom" WHERE "projectId"=${PID}`;
  console.log("EXTERNAL " + JSON.stringify(room[0] ?? null));
}
main().then(() => process.exit(0)).catch((e) => { console.error("ERR", e?.message ?? e); process.exit(1); });
