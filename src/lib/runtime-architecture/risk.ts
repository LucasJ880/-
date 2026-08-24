/**
 * QYANE_RUNTIME_CONVERGENCE_T3_5 — R1 Canonical Tool Risk Vocabulary
 *
 * R0 found 6 risk vocabularies with lossy bridges. This module defines the
 * ONE canonical vocabulary and a FAIL-CLOSED normalization from every known
 * existing vocabulary. R1 scope: metadata/contract only — nothing here
 * changes production authorization behavior. Enforcement adoption is R2.
 *
 * Invariants (guarded by src/lib/runtime-architecture/__tests__/risk.test.ts):
 * - Every unknown vocabulary or unknown value maps to "restricted".
 * - Normalization never downgrades: a source that requires approval can
 *   never normalize to a canonical risk below "sensitive_write", and
 *   requiresApproval is never dropped.
 * - The original risk metadata is preserved verbatim for audit.
 */

export type CanonicalToolRisk =
  | "read"
  | "low_write"
  | "sensitive_write"
  | "high_impact"
  | "restricted";

export const CANONICAL_TOOL_RISK_ORDER: Record<CanonicalToolRisk, number> = {
  read: 0,
  low_write: 1,
  sensitive_write: 2,
  high_impact: 3,
  restricted: 4,
};

export function riskAtLeast(
  value: CanonicalToolRisk,
  floor: CanonicalToolRisk,
): CanonicalToolRisk {
  return CANONICAL_TOOL_RISK_ORDER[value] >= CANONICAL_TOOL_RISK_ORDER[floor]
    ? value
    : floor;
}

/**
 * Known source vocabularies (R0 inventory):
 * - "agent-core.tool-risk": l0_read | l1_internal_write | l2_soft | l3_strong
 *   (src/lib/agent-core/types.ts ToolRisk — the closest thing to a canonical
 *   vocabulary today; enforced by tenancy/tool-auth canInvokeTool)
 * - "runtime-v2.risk-level": LOW | MEDIUM | HIGH | CRITICAL
 *   (src/lib/agent-runtime-v2/schemas.ts ToolDescriptor.riskLevel; carries
 *   readOnly/requiresApproval booleans alongside)
 * - "legacy.lmh": low | medium | high
 *   (deprecated ToolDefinition.riskLevel + lib/agent skills RiskLevel)
 * - "canonical": already canonical values (identity)
 */
export interface RiskSource {
  vocabulary: string;
  value: string;
  /** Source-side read-only marker when the vocabulary carries one (V2). */
  readOnly?: boolean;
  /** Source-side approval requirement when the vocabulary carries one. */
  requiresApproval?: boolean;
}

export interface NormalizedRisk {
  canonical: CanonicalToolRisk;
  /** Never dropped; floored per REQUIRES_APPROVAL_CONTRACT. */
  requiresApproval: boolean;
  /** Original metadata preserved verbatim for audit. */
  original: RiskSource;
  /** True when the fail-closed branch fired (unknown vocab/value). */
  failClosed: boolean;
}

const CANONICAL_VALUES: readonly CanonicalToolRisk[] = [
  "read",
  "low_write",
  "sensitive_write",
  "high_impact",
  "restricted",
];

function mapKnown(source: RiskSource): CanonicalToolRisk | null {
  const v = source.value;
  switch (source.vocabulary) {
    case "canonical":
      return (CANONICAL_VALUES as readonly string[]).includes(v)
        ? (v as CanonicalToolRisk)
        : null;
    case "agent-core.tool-risk":
      switch (v) {
        case "l0_read":
          return "read";
        case "l1_internal_write":
          return "low_write";
        case "l2_soft":
          return "sensitive_write";
        case "l3_strong":
          // l3 = strong side effect, always approval-gated today.
          return "high_impact";
        default:
          return null;
      }
    case "runtime-v2.risk-level":
      switch (v) {
        case "LOW":
          // LOW is only "read" when the descriptor explicitly says readOnly;
          // otherwise fail toward write (no downgrade on ambiguity).
          return source.readOnly === true ? "read" : "low_write";
        case "MEDIUM":
          return "sensitive_write";
        case "HIGH":
          return "high_impact";
        case "CRITICAL":
          return "restricted";
        default:
          return null;
      }
    case "legacy.lmh":
      // Legacy low/medium/high is untrusted metadata (R0: written but mostly
      // ignored). Floor: never treat a legacy-rated tool as pure "read".
      switch (v) {
        case "low":
          return "low_write";
        case "medium":
          return "sensitive_write";
        case "high":
          return "high_impact";
        default:
          return null;
      }
    default:
      return null;
  }
}

/**
 * Fail-closed normalization. Unknown vocabulary/value → "restricted" with
 * requiresApproval=true.
 */
export function normalizeToolRisk(source: RiskSource): NormalizedRisk {
  const mapped = mapKnown(source);
  if (mapped === null) {
    return {
      canonical: "restricted",
      requiresApproval: true,
      original: source,
      failClosed: true,
    };
  }
  const requiresApproval = source.requiresApproval === true;
  // REQUIRES_APPROVAL_CONTRACT floor: an approval-gated action is at least a
  // sensitive write; approval is never dropped by normalization.
  const canonical = requiresApproval
    ? riskAtLeast(mapped, "sensitive_write")
    : mapped;
  return { canonical, requiresApproval, original: source, failClosed: false };
}

/**
 * R1 contract rail (see task §10 and R0 audit finding: the Runtime V2
 * executor currently never reads canInvokeTool's requiresApproval output —
 * that production defect is tracked in the SEPARATE bugfix/convergence lane
 * (R2-C3; related rails: B-lane), NOT fixed here).
 *
 * The contract every runtime path must satisfy:
 */
export const REQUIRES_APPROVAL_CONTRACT = `requiresApproval=true MUST never be interpreted as direct-execution permission.
A tool call or step whose policy decision carries requiresApproval=true has exactly two legal outcomes:
(1) a PendingAction draft created via the canonical approval boundary (approval/port requestApproval), awaiting a human decision; or
(2) a fail-closed refusal.
Executing the side effect directly, or treating the flag as advisory, violates the runtime architecture contract.
Known open violation (baselined, not hidden): agent-runtime-v2 executor ignores canInvokeTool().requiresApproval — scheduled for R2-C3 alongside the B-lane fixes; do not add new consumers of that pattern.` as const;
