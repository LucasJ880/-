/**
 * 运行：npx tsx src/lib/agent-supervisor/__tests__/org-isolation.test.ts
 */
import { readFileSync } from "fs";
import { join } from "path";

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

const root = process.cwd();
const worker = readFileSync(
  join(root, "src/lib/agent-supervisor/workers/run-worker.ts"),
  "utf8",
);
const engine = readFileSync(
  join(root, "src/lib/agent-supervisor/engine.ts"),
  "utf8",
);
const ctx = readFileSync(
  join(root, "src/lib/agent-supervisor/context-builder.ts"),
  "utf8",
);

expect(worker.includes("orgId_slug"), "技能按 org 查找");
expect(worker.includes("organizationMember"), "校验组织成员");
expect(worker.includes("runSkill"), "唯一技能入口 runSkill");
expect(!engine.includes("registry.execute"), "Supervisor 不直接调 ToolRegistry");
expect(ctx.includes("orgId: input.orgId"), "上下文按 org 装配");
expect(ctx.includes("不属于当前组织"), "跨组织实体拒绝文案");

console.log(
  `\n${failed === 0 ? "✅" : "❌"} org-isolation: ${total - failed}/${total}`,
);
if (failed) process.exit(1);
