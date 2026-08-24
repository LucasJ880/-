/**
 * QYANE_RUNTIME_CONVERGENCE_T3_5 — R1 Canonical Tool Descriptor contract
 *
 * ONE canonical metadata shape for tools — NOT one physical registry (that
 * is R2-C4). These are pure bridge/normalization helpers that can describe
 * every existing catalog's entries without importing any runtime module and
 * without changing runtime behavior.
 *
 * Existing registries (R0 inventory) and their sourceRegistry ids:
 * - "agent-core.tool-policy"   src/lib/agent-core/tools/_policy.ts (93 tools)
 * - "runtime-v2.catalog"       src/lib/agent-runtime-v2/tool-catalog.ts (13)
 * - "tender-workforce.tools"   src/lib/tender-workforce/tools.ts (9)
 * - "mention-gateway.allowlist" projection of agent-core l0_read tools (18)
 * - "supervisor.worker-registry" skill-slug allowlist (frozen)
 * - "db.tool-registry"         Prisma ToolRegistry/AgentToolBinding (frozen)
 * - "legacy.skill-registry"    lib/agent/skills (frozen)
 */

import {
  normalizeToolRisk,
  type CanonicalToolRisk,
  type RiskSource,
} from "./risk";

export interface CanonicalToolDescriptor {
  name: string;
  domain: string;
  risk: CanonicalToolRisk;
  description?: string;
  requiresApproval: boolean;
  capabilities?: string[];
  /** Which physical registry this descriptor was normalized from. */
  sourceRegistry: string;
  /** Original risk metadata preserved verbatim for audit. */
  originalRisk: RiskSource;
  /** True when risk normalization had to fail closed. */
  failClosedRisk: boolean;
}

export interface AgentCorePolicyEntry {
  name: string;
  risk: string; // ToolRisk literal from TOOL_POLICY
  domain?: string;
  allowRoles?: readonly string[] | "*";
}

export function fromAgentCorePolicy(
  entry: AgentCorePolicyEntry,
): CanonicalToolDescriptor {
  const normalized = normalizeToolRisk({
    vocabulary: "agent-core.tool-risk",
    value: entry.risk,
    // l3_strong is always approval-gated by tool-auth today.
    requiresApproval: entry.risk === "l3_strong",
  });
  return {
    name: entry.name,
    domain: entry.domain ?? "unknown",
    risk: normalized.canonical,
    requiresApproval: normalized.requiresApproval,
    capabilities:
      entry.allowRoles === "*"
        ? undefined
        : entry.allowRoles?.map((r) => `role:${r}`),
    sourceRegistry: "agent-core.tool-policy",
    originalRisk: normalized.original,
    failClosedRisk: normalized.failClosed,
  };
}

export interface RuntimeV2DescriptorEntry {
  name: string;
  riskLevel: string; // LOW | MEDIUM | HIGH | CRITICAL
  readOnly?: boolean;
  requiresApproval?: boolean;
  description?: string;
  domain?: string;
}

export function fromRuntimeV2Descriptor(
  entry: RuntimeV2DescriptorEntry,
  sourceRegistry: "runtime-v2.catalog" | "tender-workforce.tools" = "runtime-v2.catalog",
): CanonicalToolDescriptor {
  const normalized = normalizeToolRisk({
    vocabulary: "runtime-v2.risk-level",
    value: entry.riskLevel,
    readOnly: entry.readOnly,
    requiresApproval: entry.requiresApproval,
  });
  return {
    name: entry.name,
    domain: entry.domain ?? (sourceRegistry === "tender-workforce.tools" ? "tender" : "sales"),
    risk: normalized.canonical,
    description: entry.description,
    requiresApproval: normalized.requiresApproval,
    sourceRegistry,
    originalRisk: normalized.original,
    failClosedRisk: normalized.failClosed,
  };
}

export interface LegacySkillEntry {
  name: string;
  riskLevel: string; // low | medium | high
  requiresApproval?: boolean;
  description?: string;
}

export function fromLegacySkill(entry: LegacySkillEntry): CanonicalToolDescriptor {
  const normalized = normalizeToolRisk({
    vocabulary: "legacy.lmh",
    value: entry.riskLevel,
    requiresApproval: entry.requiresApproval,
  });
  return {
    name: entry.name,
    domain: "legacy-skill",
    risk: normalized.canonical,
    description: entry.description,
    requiresApproval: normalized.requiresApproval,
    sourceRegistry: "legacy.skill-registry",
    originalRisk: normalized.original,
    failClosedRisk: normalized.failClosed,
  };
}

/** Generic bridge for registries with no structured risk metadata at all. */
export function fromUnratedTool(input: {
  name: string;
  domain: string;
  sourceRegistry: string;
  description?: string;
}): CanonicalToolDescriptor {
  const normalized = normalizeToolRisk({
    vocabulary: input.sourceRegistry,
    value: "unrated",
  });
  return {
    name: input.name,
    domain: input.domain,
    risk: normalized.canonical, // "restricted" by fail-closed rule
    description: input.description,
    requiresApproval: normalized.requiresApproval, // true
    sourceRegistry: input.sourceRegistry,
    originalRisk: normalized.original,
    failClosedRisk: true,
  };
}
