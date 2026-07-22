/**
 * Org Admin 运行可见性：AGGREGATE_ONLY | METADATA_ONLY | FULL
 */

import type { ExecutionProjection, RunVisibilityPolicy } from "./types";

export const DEFAULT_RUN_VISIBILITY: RunVisibilityPolicy = "AGGREGATE_ONLY";

export function parseRunVisibility(raw: unknown): RunVisibilityPolicy {
  if (raw === "FULL" || raw === "METADATA_ONLY" || raw === "AGGREGATE_ONLY") {
    return raw;
  }
  return DEFAULT_RUN_VISIBILITY;
}

/** 从 Organization.settingsJson 读取 */
export function runVisibilityFromOrgSettings(settingsJson: unknown): RunVisibilityPolicy {
  if (!settingsJson || typeof settingsJson !== "object" || Array.isArray(settingsJson)) {
    return DEFAULT_RUN_VISIBILITY;
  }
  const caps = (settingsJson as Record<string, unknown>).capabilities;
  if (!caps || typeof caps !== "object" || Array.isArray(caps)) {
    return DEFAULT_RUN_VISIBILITY;
  }
  return parseRunVisibility((caps as Record<string, unknown>).runVisibility);
}

export function redactProjection(
  proj: ExecutionProjection,
  visibility: RunVisibilityPolicy,
  opts: { isWorkspaceMember: boolean; isOrgAdmin: boolean },
): ExecutionProjection {
  // Workspace 成员可读完整（企业 FULL 另议：成员仍可读其 WS 明细）
  if (opts.isWorkspaceMember) {
    return proj;
  }

  // 非 WS 成员：Org Admin 受企业策略约束；其他人只能聚合级
  const policy =
    opts.isOrgAdmin ? visibility : ("AGGREGATE_ONLY" as RunVisibilityPolicy);

  if (policy === "FULL") {
    return proj;
  }

  if (policy === "METADATA_ONLY") {
    return {
      ...proj,
      hasBusinessPayload: false,
      inputSummary: null,
      outputSummary: null,
      metadata: stripSensitiveMetadata(proj.metadata),
    };
  }

  // AGGREGATE_ONLY：去掉几乎所有明细
  return {
    ...proj,
    hasBusinessPayload: false,
    inputSummary: null,
    outputSummary: null,
    modelProvider: null,
    modelName: null,
    tokenInput: null,
    tokenOutput: null,
    errorSummary: proj.errorCode ? "有错误（明细已隐藏）" : null,
    metadata: null,
    capabilityKey: proj.capabilityKey,
    status: proj.status,
    executionType: proj.executionType,
    durationMs: proj.durationMs,
    costAmount: proj.costAmount,
    currency: proj.currency,
  };
}

function stripSensitiveMetadata(
  metadata: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!metadata) return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(metadata)) {
    const key = k.toLowerCase();
    if (
      key.includes("prompt") ||
      key.includes("payload") ||
      key.includes("input") ||
      key.includes("output") ||
      key.includes("secret") ||
      key.includes("token") ||
      key.includes("password") ||
      key.includes("unlock")
    ) {
      continue;
    }
    out[k] = v;
  }
  return out;
}

export function canViewFullRunDetail(opts: {
  isWorkspaceMember: boolean;
  isOrgAdmin: boolean;
  visibility: RunVisibilityPolicy;
}): boolean {
  if (opts.isWorkspaceMember) return true;
  if (opts.isOrgAdmin && opts.visibility === "FULL") return true;
  return false;
}
