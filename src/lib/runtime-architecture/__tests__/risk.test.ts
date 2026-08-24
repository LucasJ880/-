/**
 * R1 guard 9 — canonical risk mapping is fail-closed and never downgrades.
 * 运行：npx tsx src/lib/runtime-architecture/__tests__/risk.test.ts
 */
import {
  CANONICAL_TOOL_RISK_ORDER,
  normalizeToolRisk,
  REQUIRES_APPROVAL_CONTRACT,
  riskAtLeast,
} from "../risk";
import { finish, ok } from "./helpers";

const rank = (v: string) => CANONICAL_TOOL_RISK_ORDER[v as keyof typeof CANONICAL_TOOL_RISK_ORDER];

// Known mappings (metadata only; no production behavior change in R1).
const cases: Array<[{ vocabulary: string; value: string; readOnly?: boolean; requiresApproval?: boolean }, string]> = [
  [{ vocabulary: "agent-core.tool-risk", value: "l0_read" }, "read"],
  [{ vocabulary: "agent-core.tool-risk", value: "l1_internal_write" }, "low_write"],
  [{ vocabulary: "agent-core.tool-risk", value: "l2_soft" }, "sensitive_write"],
  [{ vocabulary: "agent-core.tool-risk", value: "l3_strong" }, "high_impact"],
  [{ vocabulary: "runtime-v2.risk-level", value: "LOW", readOnly: true }, "read"],
  [{ vocabulary: "runtime-v2.risk-level", value: "LOW" }, "low_write"],
  [{ vocabulary: "runtime-v2.risk-level", value: "MEDIUM" }, "sensitive_write"],
  [{ vocabulary: "runtime-v2.risk-level", value: "HIGH" }, "high_impact"],
  [{ vocabulary: "runtime-v2.risk-level", value: "CRITICAL" }, "restricted"],
  [{ vocabulary: "legacy.lmh", value: "low" }, "low_write"],
  [{ vocabulary: "legacy.lmh", value: "medium" }, "sensitive_write"],
  [{ vocabulary: "legacy.lmh", value: "high" }, "high_impact"],
  [{ vocabulary: "canonical", value: "restricted" }, "restricted"],
];
for (const [src, expected] of cases) {
  const n = normalizeToolRisk(src);
  ok(n.canonical === expected, `${src.vocabulary}:${src.value}${src.readOnly ? "+readOnly" : ""} → ${expected}（实际 ${n.canonical}）`);
  ok(n.original.value === src.value && n.original.vocabulary === src.vocabulary, `${src.vocabulary}:${src.value} 保留原始元数据`);
  ok(!n.failClosed, `${src.vocabulary}:${src.value} 不触发 fail-closed`);
}

// Fail-closed: UNKNOWN vocabulary / value → restricted + requiresApproval.
for (const src of [
  { vocabulary: "made-up-vocab", value: "whatever" },
  { vocabulary: "agent-core.tool-risk", value: "l9_nope" },
  { vocabulary: "runtime-v2.risk-level", value: "MEGA" },
  { vocabulary: "legacy.lmh", value: "" },
  { vocabulary: "canonical", value: "not-a-level" },
]) {
  const n = normalizeToolRisk(src);
  ok(n.canonical === "restricted", `未知 ${src.vocabulary}:${src.value || "<empty>"} → restricted`);
  ok(n.requiresApproval === true, `未知 ${src.vocabulary}:${src.value || "<empty>"} → requiresApproval=true`);
  ok(n.failClosed === true, `未知 ${src.vocabulary}:${src.value || "<empty>"} 标记 failClosed`);
}

// No-downgrade properties.
ok(rank(normalizeToolRisk({ vocabulary: "legacy.lmh", value: "low" }).canonical) >= rank("low_write"), "legacy low 永不映射为 read（不信任的词表下限 low_write）");
ok(rank(normalizeToolRisk({ vocabulary: "runtime-v2.risk-level", value: "LOW" }).canonical) >= rank("low_write"), "V2 LOW 非 readOnly → 不降级为 read");
const approvalCase = normalizeToolRisk({ vocabulary: "runtime-v2.risk-level", value: "LOW", readOnly: true, requiresApproval: true });
ok(approvalCase.requiresApproval === true, "requiresApproval 永不被归一化丢弃");
ok(rank(approvalCase.canonical) >= rank("sensitive_write"), "requiresApproval=true → canonical 下限 sensitive_write");
ok(riskAtLeast("read", "high_impact") === "high_impact" && riskAtLeast("restricted", "read") === "restricted", "riskAtLeast 单调");

// §10 requiresApproval contract rail is present and names the open violation lane.
ok(REQUIRES_APPROVAL_CONTRACT.includes("MUST never be interpreted as direct-execution permission"), "REQUIRES_APPROVAL_CONTRACT 文本存在");
ok(REQUIRES_APPROVAL_CONTRACT.includes("R2-C3"), "契约指向单独修复 lane（R2-C3 / B-lane），R1 不静默修 bug");

finish("canonical risk vocabulary");
