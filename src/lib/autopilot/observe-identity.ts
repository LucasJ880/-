/**
 * Observe Dashboard run identity.
 * Canonical only — never infer agent from model or domain from runType.
 */

export type ObserveRunIdentity = {
  agentId: string | null;
  agentRole: string | null;
  workDomain: string | null;
};

function readMetaString(metadata: unknown, key: string): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Read AgentRun.metadata identity fields written by AIRuntimeContext.
 * Missing values stay null. Do not invent lineage.
 */
export function extractObserveRunIdentity(
  metadata: unknown,
): ObserveRunIdentity {
  return {
    agentId: readMetaString(metadata, "agentId"),
    agentRole: readMetaString(metadata, "agentRole"),
    workDomain: readMetaString(metadata, "workDomain"),
  };
}

export function formatObserveAgentLabel(
  identity: ObserveRunIdentity,
): string | null {
  const { agentId, agentRole } = identity;
  if (agentId && agentRole) return `${agentId} / ${agentRole}`;
  return agentId ?? agentRole;
}
