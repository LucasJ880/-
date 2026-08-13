import fs from "node:fs";
const envFile = process.env.QY_UAT_ENVFILE!;
for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
  const m = line.match(/^([A-Za-z0-9_]+)="(.*)"$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
}
if ((process.env.DATABASE_URL ?? "").includes("ep-super-field-antfibsl")) throw new Error("REFUSING prod");
const PID = "cmsr0t06u0001l7044n50zuz5";
async function main() {
  const { processQueuedTenderAnalysisRuns } = await import("@/lib/tender-auto-analysis/worker");
  for (let round = 1; round <= 4; round++) {
    const out = await processQueuedTenderAnalysisRuns(1);
    console.log(`round=${round} processed=${out.processed} succeeded=${out.succeeded} failed=${out.failed}`);
    if (out.processed === 0) break;
  }
  const { db } = await import("@/lib/db");
  const r = await db.$queryRaw<Array<Record<string, unknown>>>`
    SELECT "id","status",("summaryJson"->'analystSynthesis'->>'version') AS syn,
      ("summaryJson"->'analystSynthesis'->'qa'->>'status') AS qa
    FROM "TenderAnalysisRun" WHERE "projectId"=${PID} ORDER BY "createdAt" DESC LIMIT 1`;
  console.log("FINAL_RUN " + JSON.stringify(r[0]));
  const p = await db.$queryRaw<Array<Record<string, unknown>>>`
    SELECT ("interpretedAt" IS NOT NULL) AS interpreted FROM "Project" WHERE "id"=${PID}`;
  console.log("STAGE " + JSON.stringify(p[0]));
}
main().then(() => process.exit(0)).catch((e) => { console.error("ERR", e?.message ?? e); process.exit(1); });
