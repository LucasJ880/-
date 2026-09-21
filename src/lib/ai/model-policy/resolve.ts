/**
 * 最小侵入 Model Policy：按角色解析模型，默认不升级 GPT-6。
 */

import {
  OPENAI_BUILTIN,
  OPENAI_GPT6_ASTRA,
  ProviderRouter,
} from "@/lib/ai/model-registry";
import {
  isGpt6WorkflowEnabledWithEnv,
  explainGpt6FlagWithEnv,
  type Gpt6FlagDecision,
  type Gpt6FlagEnv,
  type Gpt6FlagInput,
} from "./flags";
import { isGpt6Astra } from "./compat";
import {
  resolveReasoningPolicy,
  type ExtendedReasoningEffort,
  type QualityMode,
  type TenderStage,
} from "./reasoning";
import { QUALITY_FIRST_ROLES, ROLE_ENV_KEYS, type ModelRole } from "./roles";

/**
 * chat / fast 的角色 env 键就是全局基线键（OPENAI_CHAT_MODEL / OPENAI_FAST_MODEL），生产上始终有值。
 * 不能把它当「显式角色覆盖」，否则这两个角色永远走不到 flag 分支、无法灰度升级；
 * 只有运维明确把它写成 gpt-6 时才视为覆盖（仍受 kill switch 约束）。
 */
const GLOBAL_BASELINE_ROLES: readonly ModelRole[] = ["chat", "fast"];

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
  tenderStage?: TenderStage;
  evidenceConflict?: boolean;
}

export interface ModelPolicyResolution {
  role: ModelRole;
  model: string;
  fallbackModel: string;
  reasoningEffort: ExtendedReasoningEffort;
  upgraded: boolean;
  source: "baseline" | "env" | "gpt6_policy";
  api: "chat_completions" | "responses";
  qualityFirst: boolean;
  skipRolloutPct: boolean;
  flagDecision: Gpt6FlagDecision;
}

function envTrim(env: Gpt6FlagEnv, key: string): string | undefined {
  const v = env[key]?.trim();
  return v || undefined;
}

function roleBaseline(role: ModelRole): string {
  switch (role) {
    case "supervisor":
    case "researcher":
    case "tender":
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

function isQualityFirst(role: ModelRole): boolean {
  return (QUALITY_FIRST_ROLES as readonly ModelRole[]).includes(role);
}

export function resolveModelPolicy(
  input: ResolveModelPolicyInput,
): ModelPolicyResolution {
  const env = input.env ?? process.env;
  const qualityFirst = isQualityFirst(input.role);
  const flagInput: Gpt6FlagInput = {
    userId: input.userId,
    role: input.role,
    orgId: input.orgId,
    orgCode: input.orgCode,
    modelRole: input.role,
  };
  const flag = explainGpt6FlagWithEnv(flagInput, env);
  const enabled = flag.enabled;
  const workflowOn = isGpt6WorkflowEnabledWithEnv(input.role, flagInput, env);
  const flagDecision: Gpt6FlagDecision =
    enabled && !workflowOn ? "workflow_disabled" : flag.decision;
  const baseline = input.baselineModel?.trim() || roleBaseline(input.role);
  // Tender 回退必须是稳定 Chat（Sol），不得为了省钱改 Terra；也不得因输入变长换模型。
  const fallback =
    input.fallbackModel?.trim() ||
    envTrim(env, "OPENAI_MODEL_GPT6_FALLBACK") ||
    (qualityFirst
      ? ProviderRouter.getChatModel() || OPENAI_BUILTIN.chat
      : ProviderRouter.getChatModel());

  const roleEnvRaw = envTrim(env, ROLE_ENV_KEYS[input.role]);
  const roleEnv =
    roleEnvRaw &&
    (!GLOBAL_BASELINE_ROLES.includes(input.role) || isGpt6Astra(roleEnvRaw))
      ? roleEnvRaw
      : undefined;
  const reasoningEffort = resolveReasoningPolicy({
    role: input.role,
    toolCount: input.toolCount,
    retrievedContextChars: input.retrievedContextChars,
    criticality: input.criticality,
    retryCount: input.retryCount,
    supervisorEscalation: input.supervisorEscalation,
    qualityMode: input.qualityMode,
    tenderStage: input.tenderStage,
    evidenceConflict: input.evidenceConflict,
  });

  const extras = {
    qualityFirst,
    skipRolloutPct: qualityFirst,
  };

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
      flagDecision,
      ...extras,
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
      flagDecision,
      ...extras,
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
    flagDecision,
    ...extras,
  };
}

export function getModelPolicySnapshot(
  input: Omit<ResolveModelPolicyInput, "role"> = {},
): Record<ModelRole, ModelPolicyResolution> {
  const roles: ModelRole[] = [
    "supervisor",
    "planner",
    "researcher",
    "tender",
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
