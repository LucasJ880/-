/**
 * 运行：npx tsx src/lib/agent-supervisor/__tests__/worker-registry.test.ts
 */
import {
  WORKER_REGISTRY,
  isSkillAllowedForWorker,
  findWorkerForSkill,
  listWorkers,
} from "../worker-registry";

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

expect(listWorkers().length === 4, "四个 Worker");
expect(
  isSkillAllowedForWorker("sales", "sales-next-best-action"),
  "销售白名单内",
);
expect(
  !isSkillAllowedForWorker("sales", "tender-bid-no-bid"),
  "销售不能调投标技能",
);
expect(
  !isSkillAllowedForWorker("marketing", "sales.send_quote_email"),
  "营销不能调直发邮件工具名",
);
expect(findWorkerForSkill("mmm-data-readiness") === "analytics", "MMM → analytics");
expect(
  WORKER_REGISTRY.marketing.allowedSkills.includes("marketing-geo-audit"),
  "营销含 GEO",
);
expect(
  WORKER_REGISTRY.marketing.allowedSkills.some((s) =>
    s.startsWith("marketing-"),
  ),
  "营销含 Phase2 技能（若已落地）",
);

console.log(
  `\n${failed === 0 ? "✅" : "❌"} worker-registry: ${total - failed}/${total}`,
);
if (failed) process.exit(1);
