/**
 * R1 §11 — AgentRun status inventory covers both declared vocabularies;
 * a NEW status literal in either union fails until inventoried here.
 * 运行：npx tsx src/lib/runtime-architecture/__tests__/run-status-inventory.test.ts
 */
import { readFileSync } from "fs";
import { join } from "path";
import { parseUnionLiterals } from "../guards";
import {
  PROPOSED_R2_TRANSITIONS,
  RUN_STATUS_INVENTORY,
  RUN_STATUS_INVENTORY_VALUES,
} from "../run-status-inventory";
import { finish, ok } from "./helpers";

const root = process.cwd();
const legacyText = readFileSync(join(root, "src/lib/agent-runtime/types.ts"), "utf8");
const v2Text = readFileSync(join(root, "src/lib/agent-runtime-v2/schemas.ts"), "utf8");

const legacy = parseUnionLiterals(legacyText, "AgentRunStatus");
const v2 = parseUnionLiterals(v2Text, "RuntimeV2RunStatus");
ok(legacy.length === 8, `legacy AgentRunStatus = 8（实际 ${legacy.length}）`);
ok(v2.length === 12, `RuntimeV2RunStatus = 12（实际 ${v2.length}）`);

const inventoried = new Set(RUN_STATUS_INVENTORY_VALUES);
for (const s of [...legacy, ...v2]) {
  ok(inventoried.has(s), `状态 "${s}" 已列入 run-status-inventory（新增状态必须先登记）`);
}

// Classification consistency vs the two unions.
const inLegacy = new Set(legacy);
const inV2 = new Set(v2);
for (const e of RUN_STATUS_INVENTORY) {
  if (e.classification === "phantom_reader_only") {
    ok(!inLegacy.has(e.status) && !inV2.has(e.status), `phantom "${e.status}" 不在任何声明词表中`);
    ok(e.writers.length === 0, `phantom "${e.status}" 无 writer`);
    continue;
  }
  const expected = inLegacy.has(e.status) && inV2.has(e.status) ? "shared" : inLegacy.has(e.status) ? "legacy" : "canonical_v2";
  ok(e.classification === expected, `"${e.status}" 分类=${expected}（实际 ${e.classification}）`);
  ok(e.writers.length > 0, `"${e.status}" 至少一个 writer`);
  ok(e.migrationOwner === "R2-C1", `"${e.status}" migration owner = R2-C1`);
}

// §12 transition matrix is DESIGN ONLY and self-consistent (no unknown targets).
for (const [from, tos] of Object.entries(PROPOSED_R2_TRANSITIONS)) {
  ok(inventoried.has(from), `矩阵 from "${from}" 已登记`);
  for (const to of tos) ok(inventoried.has(to), `矩阵 ${from}→${to} 目标已登记`);
}
ok(PROPOSED_R2_TRANSITIONS["completed"].length === 0 && PROPOSED_R2_TRANSITIONS["failed"].length === 0 && PROPOSED_R2_TRANSITIONS["cancelled"].length === 0, "终态在目标矩阵中不可离开（failed 复活只能显式 retry，不静默）");
ok(!("partially_executed" in PROPOSED_R2_TRANSITIONS), "partially_executed 在 R2 目标中退役（fold into needs_human）");

// R1 must NOT enforce the matrix in production: the substrate module may not import it.
const substrateRun = readFileSync(join(root, "src/lib/agent-runtime/run.ts"), "utf8");
ok(!substrateRun.includes("runtime-architecture"), "agent-runtime/run.ts 不引用 runtime-architecture（矩阵仅设计，不生效）");

finish("run status inventory");
