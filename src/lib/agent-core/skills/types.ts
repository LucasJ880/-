/**
 * 动态技能系统 — 核心类型
 */

export interface DynamicSkillDef {
  id: string;
  slug: string;
  name: string;
  description: string;
  domain: string;
  tier: string;

  systemPrompt: string;
  userPromptTemplate: string;
  outputFormat: "text" | "json" | "markdown";
  temperature: number;
  maxTokens: number;

  inputSchema: Record<string, unknown> | null;
  outputSchema: Record<string, unknown> | null;
  requiredTools: string[];

  version: number;
  isBuiltin: boolean;
}

export interface SkillRunInput {
  skillId?: string;
  slug?: string;
  variables: Record<string, string>;
  userId: string;
  orgId: string;
}

export interface SkillRunOutput {
  success: boolean;
  content: string;
  parsed?: unknown;
  toolCalls: { name: string; args: Record<string, unknown> }[];
  durationMs: number;
  tokenCount?: number;
  executionId: string;
}

export interface SkillFeedback {
  executionId: string;
  rating?: number;
  feedback?: string;
  wasEdited?: boolean;
}

export interface SkillOptimizationResult {
  skillId: string;
  previousVersion: number;
  newVersion: number;
  changes: string[];
  oldPrompt: string;
  newPrompt: string;
}
