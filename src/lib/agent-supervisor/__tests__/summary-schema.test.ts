/**
 * 运行：npx tsx src/lib/agent-supervisor/__tests__/summary-schema.test.ts
 */
import { ManagementSummarySchema } from "../summary-schema";

let total = 0;
let failed = 0;
function expect(c: boolean, m: string) {
  total++;
  if (c) console.log(`✓ ${m}`);
  else {
    failed++;
    console.error(`✗ ${m}`);
  }
}

const ok = ManagementSummarySchema.safeParse({
  executiveConclusion: "本周应优先跟进高价值客户。",
  keyFindings: [
    { finding: "有一笔逾期跟进", evidence: ["管道"], confidence: "medium" },
  ],
  recommendedActions: [
    {
      priority: 1,
      action: "电话跟进",
      reason: "超过14天",
      approvalRequired: false,
      pendingActionId: null,
    },
  ],
});
expect(ok.success, "合法摘要通过 schema");

const bad = ManagementSummarySchema.safeParse({
  executiveConclusion: "",
  keyFindings: [],
});
expect(!bad.success, "空结论拒绝");

console.log(
  `\n${failed === 0 ? "✅" : "❌"} summary-schema: ${total - failed}/${total}`,
);
if (failed) process.exit(1);
