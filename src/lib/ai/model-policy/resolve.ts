/**
 * 最小侵入 Model Policy：按角色解析模型，默认不升级 GPT-6。
 */

import {
  OPENAI_BUILTIN,
  OPENAI_GPT6_ASTRA,
  ProviderRouter,
} from "@/lib/ai/model-registry";
import {
  isGpt6AstraEnabledWithEnv,
  isGpt6WorkflowEnabledWithEnv,
  type Gpt6FlagEnv,
  type Gpt6FlagInput,
} from "./flags";
import { isGpt6Astra } from "./compat";
import {
  resolveReasoningPolicy,
  type ExtendedReasoningEffort,
  type QualityMode,
} from "./reasoning";
import { ROLE_ENV_KEYS, type ModelRole } from "./roles";

export interface ResolveModelPolicyInput extends Gpt6FlagInput {
  role: ModelRole;
  env?: Gpt6FlagEnv;
  /** 调用方当前模型；flag 关闭时原样返回 */
  baselineModel?: string;
  fallbackModel?: string;
  toolCount?: number;
  retrievedContextChars?: number;
  criticality?: "normal" | "high" | "critical";
  retryCount?: number;
  supervisorEscalation?: boolean;
  qualityMode?: QualityMode;
}

export interface ModelPolicyResolution {
  role: ModelRole;
  model: string;
  fallbackModel: string;
  reasoningEffort: ExtendedReasoningEffort;
  upgraded: boolean;
  source: "baseline" | "env" | "gpt6_policy";
  api: "chat_completions" | "responses";
}

function envTrim(env: Gpt6FlagEnv, key: string): string | undefined {
  const v = env[key]?.trim();
  return v || undefined;
}

function roleBaseline(role: ModelRole): string {
  switch (role) {
    case "supervisor":
    case "researcher":
    case "coder":
    case "classifier":
    case "supplier_intelligence":
      return ProviderRouter.getReasoningModel();
    case "summarizer":
    case "fast":
      return ProviderRouter.getFastModel();
    case "planner":
    case "proposal":
    case "chat":
    default:
      return ProviderRouter.getChatModel();
  }
}

function stripGpt6IfDisabled(
  model: string,
  enabled: boolean,
  fallback: string,
): string {
  if (isGpt6Astra(model) && !enabled) return fallback;
  return model;
}

function distinctFallback(model: string, fallback: string): string {
  const candidates = [
    fallback,
    ProviderRouter.getChatModel(),
    ProviderRouter.getReasoningModel(),
    OPENAI_BUILTIN.chat,
  ];
  for (const c of candidates) {
    const id = c?.trim();
    if (id && id !== model && !isGpt6Astra(id)) return id;
  }
  return OPENAI_BUILTIN.chat;
}

export function resolveModelPolicy(
  input: ResolveModelPolicyInput,
): ModelPolicyResolution {
  const env = input.env ?? process.env;
  const flagInput: Gpt6FlagInput = {
    userId: input.userId,
    role: input.role,
    orgId: input.orgId,
    orgCode: input.orgCode,
  };
  const enabled = isGpt6AstraEnabledWithEnv(flagInput, env);
  const workflowOn = isGpt6WorkflowEnabledWithEnv(input.role, flagInput, env);
  const baseline = input.baselineModel?.trim() || roleBaseline(input.role);
  const fallback =
    input.fallbackModel?.trim() ||
    envTrim(env, "OPENAI_MODEL_GPT6_FALLBACK") ||
    ProviderRouter.getChatModel();

  const roleEnv = envTrim(env, ROLE_ENV_KEYS[input.role]);
  const reasoningEffort = resolveReasoningPolicy({
    role: input.role,
    toolCount: input.toolCount,
    retrievedContextChars: input.retrievedContextChars,
    criticality: input.criticality,
    retryCount: input.retryCount,
    supervisorEscalation: input.supervisorEscalation,
    qualityMode: input.qualityMode,
  });

  // 显式角色 env 优先，但仍受 kill switch 约束
  if (roleEnv) {
    const model = stripGpt6IfDisabled(roleEnv, enabled && workflowOn, baseline);
    return {
      role: input.role,
      model,
      fallbackModel: distinctFallback(model, fallback),
      reasoningEffort,
      upgraded: isGpt6Astra(model),
      source: "env",
      api: "chat_completions",
    };
  }

  if (enabled && workflowOn) {
    const model = OPENAI_GPT6_ASTRA;
    return {
      role: input.role,
      model,
      fallbackModel: distinctFallback(model, fallback),
      reasoningEffort,
      upgraded: true,
      source: "gpt6_policy",
      api: "chat_completions",
    };
  }

  const model = stripGpt6IfDisabled(baseline, false, roleBaseline(input.role));
  return {
    role: input.role,
    model,
    fallbackModel: distinctFallback(model, fallback),
    reasoningEffort,
    upgraded: false,
    source: "baseline",
    api: "chat_completions",
  };
}

export function getModelPolicySnapshot(
  input: Omit<ResolveModelPolicyInput, "role"> = {},
): Record<ModelRole, ModelPolicyResolution> {
  const roles: ModelRole[] = [
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
  ];
  const out = {} as Record<ModelRole, ModelPolicyResolution>;
  for (const role of roles) {
    out[role] = resolveModelPolicy({ ...input, role });
  }
  return out;
}
