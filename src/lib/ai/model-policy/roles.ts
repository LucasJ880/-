/**
 * Model Policy 角色。禁止业务代码散落 model: "gpt-6-astra"。
 */

export const MODEL_ROLES = [
  "supervisor",
  "planner",
  "researcher",
  "coder",
  "classifier",
  "summarizer",
  "chat",
  "fast",
  "supplier_intelligence",
  "proposal",
] as const;

export type ModelRole = (typeof MODEL_ROLES)[number];

export const ROLE_ENV_KEYS: Record<ModelRole, string> = {
  supervisor: "OPENAI_MODEL_SUPERVISOR",
  planner: "OPENAI_MODEL_PLANNER",
  researcher: "OPENAI_MODEL_RESEARCHER",
  coder: "OPENAI_MODEL_CODER",
  classifier: "OPENAI_MODEL_CLASSIFIER",
  summarizer: "OPENAI_MODEL_SUMMARIZER",
  chat: "OPENAI_CHAT_MODEL",
  fast: "OPENAI_FAST_MODEL",
  supplier_intelligence: "OPENAI_MODEL_SUPPLIER_INTEL",
  proposal: "OPENAI_MODEL_PROPOSAL",
};

/** Phase 1 默认升级集合；其余角色需 ENABLE_GPT6_ASTRA_WORKFLOWS 显式加入 */
export const GPT6_DEFAULT_ROLES: readonly ModelRole[] = [
  "supervisor",
  "planner",
  "researcher",
];

/** 明确不因 GPT-6 升级的低成本角色 */
export const LOWER_COST_ROLES: readonly ModelRole[] = [
  "classifier",
  "summarizer",
  "chat",
  "fast",
];
