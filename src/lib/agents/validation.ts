export const AGENT_TYPES = ["chat", "assistant", "workflow", "router"] as const;
export type AgentType = (typeof AGENT_TYPES)[number];

export const AGENT_STATUSES = ["active", "archived", "draft"] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

export function isValidAgentType(t: string): t is AgentType {
  return (AGENT_TYPES as readonly string[]).includes(t);
}

export function isValidAgentStatus(s: string): s is AgentStatus {
  return (AGENT_STATUSES as readonly string[]).includes(s);
}

export function normalizeAgentKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
}

export function isValidAgentKeyFormat(key: string): boolean {
  return (
    /^[a-z0-9][a-z0-9_-]{0,62}[a-z0-9]$/.test(key) || /^[a-z0-9]$/.test(key)
  );
}
