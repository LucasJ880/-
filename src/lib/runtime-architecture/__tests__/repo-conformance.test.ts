/**
 * R1 — the enforcement test: current repository vs checked-in baseline.
 * Fails when a NEW architectural surface appears in any guarded category
 * without an explicit baseline update in the same PR.
 * 运行：npx tsx src/lib/runtime-architecture/__tests__/repo-conformance.test.ts
 * 更新 baseline（本身必须走代码评审）：
 *   npx tsx scripts/runtime-architecture-baseline.ts --generate
 */
import { readFileSync } from "fs";
import { join } from "path";
import { checkAgainstBaseline, computeBaseline, parseAgentRunEventTypeUnion, type RuntimeArchitectureBaseline } from "../guards";
import { scanRepo } from "../scan";
import { finish, ok } from "./helpers";

const scan = scanRepo();
const current = computeBaseline(scan);
const stored = JSON.parse(
  readFileSync(join(process.cwd(), "src/lib/runtime-architecture/runtime-architecture-baseline.json"), "utf8"),
) as RuntimeArchitectureBaseline;

const violations = checkAgainstBaseline(current, stored);
for (const v of violations) console.error(`  ✗ ${v.message}`);
ok(violations.length === 0, `无新增架构面（violations=${violations.length}）`);

// Structural sanity of the stored baseline (guards depend on these anchors).
ok(stored.version === 1, "baseline 版本 = 1");
ok(stored.agentRunEventWriteFiles.length === 1 && stored.agentRunEventWriteFiles[0] === "src/lib/agent-runtime/run.ts", "AgentRunEvent 唯一物理 writer = agent-runtime/run.ts");
ok(stored.importEdges["agent-runtime-v2->workforce-runtime"].length > 0, "runtime⇄workforce 倒置边已显式建档（shrink-only）");
ok(stored.eventTypeLiteralExceptions.every((l) => l.startsWith("supervisor.")), "union 外事件字面量例外仅 supervisor.*（既有违规，不隐藏）");
const union = parseAgentRunEventTypeUnion(scan);
ok(union.size >= 60, `AgentRunEventType union 解析正常（${union.size} 项）`);

// Known-violation baselines are visible, not silently absorbed:
for (const known of [
  "src/app/api/sales/quotes/[quoteId]/route.ts", // R0 lifecycle bypass (quote PUT)
  "src/lib/capabilities/approvals/decision.ts", // R0 cancel bypass
  "src/lib/agent-runtime/pending-link.ts", // R0 bulk reject on run cancel
]) {
  ok(stored.approvalCreationFiles.includes(known), `已知审批旁路仍在 baseline 中可见: ${known}`);
}

finish("runtime-architecture repo conformance");
