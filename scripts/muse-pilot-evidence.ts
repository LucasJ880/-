/**
 * Sales Pilot 证据导出（TASKFLOW S3）：按 workflowId 打印整条链的 JSON。只读。
 *
 * npx tsx scripts/muse-pilot-evidence.ts --workflow wf_<requestId>
 */

import { collectWorkflowEvidence } from "@/lib/muse-bridge/evidence";
import { db } from "@/lib/db";

async function main() {
  const i = process.argv.indexOf("--workflow");
  const workflowId = i >= 0 ? process.argv[i + 1] : undefined;
  if (!workflowId || !/^[A-Za-z0-9_:-]{1,80}$/.test(workflowId)) {
    console.error("用法：npx tsx scripts/muse-pilot-evidence.ts --workflow wf_<requestId>");
    process.exit(2);
  }
  const evidence = await collectWorkflowEvidence(workflowId);
  console.log(JSON.stringify(evidence, null, 2));
}

main()
  .catch((err) => {
    console.error("[muse-pilot-evidence] failed:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
