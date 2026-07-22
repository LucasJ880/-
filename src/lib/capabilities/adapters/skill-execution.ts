/**
 * SkillExecution adapter — 无直接 orgId，必须经 AgentSkill.orgId 可信 JOIN
 */

import type { ExecutionProjection } from "../types";
import { mapSkillSuccess } from "../execution-status";
import { readTraceIdFromUnknown } from "../trace-context";

export type SkillExecutionJoinRow = {
  id: string;
  skillId: string;
  userId: string;
  inputJson: string;
  outputJson: string | null;
  success: boolean;
  durationMs: number | null;
  tokenCount: number | null;
  createdAt: Date;
  skill: {
    id: string;
    orgId: string;
    slug: string;
    name: string;
  };
};

function truncate(text: string | null | undefined, max = 240): string | null {
  if (!text) return null;
  const t = text.trim();
  if (!t) return null;
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

export function projectSkillExecution(
  row: SkillExecutionJoinRow,
): ExecutionProjection {
  let traceId: string | null = null;
  try {
    const parsed = JSON.parse(row.inputJson) as unknown;
    traceId = readTraceIdFromUnknown(parsed);
  } catch {
    traceId = null;
  }

  return {
    id: row.id,
    executionType: "SKILL",
    status: mapSkillSuccess(row.success),
    capabilityKey: row.skill.slug || row.skill.name,
    orgId: row.skill.orgId,
    workspaceId: null,
    projectId: null,
    userId: row.userId,
    traceId,
    runId: null,
    parentRunId: null,
    startedAt: row.createdAt,
    finishedAt: row.createdAt,
    durationMs: row.durationMs,
    modelProvider: null,
    modelName: null,
    tokenInput: row.tokenCount,
    tokenOutput: null,
    costAmount: null,
    currency: null,
    riskLevel: null,
    approvalRequired: null,
    errorCode: row.success ? null : "SKILL_FAILED",
    errorSummary: row.success ? null : "Skill 执行失败",
    hasBusinessPayload: true,
    inputSummary: truncate(row.inputJson),
    outputSummary: truncate(row.outputJson),
    sourceType: "SkillExecution",
    sourceId: row.id,
    metadata: { skillId: row.skillId },
  };
}

/**
 * 租户债说明：SkillExecution 表无 orgId。
 * 读取路径必须：WHERE skill.orgId = :tenantOrgId，禁止 findUnique(id) 后直接返回。
 */
export const SKILL_EXECUTION_ORG_DEBT = {
  model: "SkillExecution",
  issue: "missing_direct_orgId",
  mitigation: "JOIN AgentSkill.orgId + TenantContext.orgId equality",
  followUp: "Add nullable SkillExecution.orgId + backfill from skill.orgId (Phase 3A-2+)",
} as const;
