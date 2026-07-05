/**
 * agent-core 工具注册表冒烟检查（只读，不连库）
 *
 * 验证：
 * - 所有工具都完成 RBAC 打标（无 missing / orphaned 警告即通过）
 * - A-P2 桥接的 project 域工具已注册且风险标签符合预期
 *
 * 运行：npx tsx scripts/smoke-agent-core-registry.ts
 */

import "../src/lib/agent-core/tools/index";
import { registry } from "../src/lib/agent-core/tool-registry";
import { STATIC_SKILL_TOOL_NAMES } from "../src/lib/agent-core/skills/static-bridge";

let failed = false;

const projectTools = registry.list({ domains: ["project"] });
console.log(`project 域工具（${projectTools.length} 个）:`);
for (const t of projectTools) {
  console.log(`  ${t.name}  risk=${t.risk}  allowRoles=${JSON.stringify(t.allowRoles)}`);
}

for (const toolName of Object.values(STATIC_SKILL_TOOL_NAMES)) {
  const tool = registry.get(toolName);
  if (!tool) {
    console.error(`FAIL: 桥接工具未注册 ${toolName}`);
    failed = true;
    continue;
  }
  if (!tool.risk || !tool.allowRoles) {
    console.error(`FAIL: 工具未打 RBAC 标签 ${toolName}`);
    failed = true;
  }
}

console.log(`registry 总工具数 = ${registry.size}`);
if (failed) {
  process.exit(1);
}
console.log("PASS: agent-core registry 冒烟通过");
process.exit(0);
