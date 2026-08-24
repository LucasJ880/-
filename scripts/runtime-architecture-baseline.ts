/**
 * QYANE_RUNTIME_CONVERGENCE_T3_5 — R1 baseline generator/checker.
 *
 * Usage:
 *   npx tsx scripts/runtime-architecture-baseline.ts --generate   # rewrite baseline JSON
 *   npx tsx scripts/runtime-architecture-baseline.ts              # diff current tree vs baseline (same as the guard test)
 *
 * Regenerating the baseline is an ARCHITECTURE DECISION: review the diff of
 * runtime-architecture-baseline.json like code, not like a snapshot.
 */
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { scanRepo } from "../src/lib/runtime-architecture/scan";
import {
  checkAgainstBaseline,
  computeBaseline,
  type RuntimeArchitectureBaseline,
} from "../src/lib/runtime-architecture/guards";

const BASELINE_PATH = join(
  process.cwd(),
  "src/lib/runtime-architecture/runtime-architecture-baseline.json",
);

const scan = scanRepo();
const current = computeBaseline(scan);

if (process.argv.includes("--generate")) {
  writeFileSync(BASELINE_PATH, `${JSON.stringify(current, null, 2)}\n`);
  console.log(`baseline written: ${BASELINE_PATH}`);
  process.exit(0);
}

const stored = JSON.parse(
  readFileSync(BASELINE_PATH, "utf8"),
) as RuntimeArchitectureBaseline;
const violations = checkAgainstBaseline(current, stored);
if (violations.length === 0) {
  console.log("runtime-architecture baseline: clean");
  process.exit(0);
}
for (const v of violations) console.error(`✗ ${v.message}\n`);
console.error(`${violations.length} violation(s)`);
process.exit(1);
