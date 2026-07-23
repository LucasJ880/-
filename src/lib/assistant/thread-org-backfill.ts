/**
 * Phase 3B-A：AiThread.orgId 回填决策（纯函数，可供脚本与单测共用）
 */

export type ThreadOrgBackfillReasonCode =
  | "PROJECT_PENDING_ACTION_CONFLICT"
  | "MULTIPLE_PENDING_ACTION_ORGS"
  | "MULTIPLE_AGENT_RUN_ORGS"
  | "SOURCE_CONFLICT"
  | "NO_RELIABLE_ORG_SOURCE"
  | "NO_ACTIVE_MEMBERSHIP"
  | "MULTIPLE_ACTIVE_MEMBERSHIPS";

export type ThreadOrgBackfillDecision =
  | { kind: "skip_bound" }
  | { kind: "skip_already_archived" }
  | {
      kind: "bind";
      orgId: string;
      source: "project" | "pending_action" | "agent_run" | "membership";
    }
  | {
      kind: "archive";
      reasonCode: ThreadOrgBackfillReasonCode;
      sourceOrgIds: string[];
    };

function uniqueNonEmpty(ids: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(
      ids.filter((x): x is string => typeof x === "string" && x.length > 0),
    ),
  );
}

/**
 * 回填优先级：Project → 唯一 PendingAction → 唯一 AgentRun → 唯一 active membership
 * 冲突 / 无法判断 → archive（orgId 保持 null）
 */
export function decideAiThreadOrgBackfill(input: {
  existingOrgId: string | null;
  archived: boolean;
  projectOrg: string | null;
  pendingActionOrgs: string[];
  agentRunOrgs: string[];
  membershipOrgs: string[];
}): ThreadOrgBackfillDecision {
  if (input.existingOrgId) return { kind: "skip_bound" };
  // 历史冲突/无法判断已归档：幂等跳过，禁止再猜归属或反复写
  if (input.archived) return { kind: "skip_already_archived" };

  const pa = uniqueNonEmpty(input.pendingActionOrgs);
  if (pa.length > 1) {
    return {
      kind: "archive",
      reasonCode: "MULTIPLE_PENDING_ACTION_ORGS",
      sourceOrgIds: pa,
    };
  }

  const ar = uniqueNonEmpty(input.agentRunOrgs);
  if (ar.length > 1) {
    return {
      kind: "archive",
      reasonCode: "MULTIPLE_AGENT_RUN_ORGS",
      sourceOrgIds: ar,
    };
  }

  const distinct = uniqueNonEmpty([input.projectOrg, pa[0], ar[0]]);
  if (distinct.length > 1) {
    const reason: ThreadOrgBackfillReasonCode =
      input.projectOrg && pa[0] && input.projectOrg !== pa[0]
        ? "PROJECT_PENDING_ACTION_CONFLICT"
        : "SOURCE_CONFLICT";
    return { kind: "archive", reasonCode: reason, sourceOrgIds: distinct };
  }

  if (input.projectOrg) {
    return { kind: "bind", orgId: input.projectOrg, source: "project" };
  }
  if (pa[0]) {
    return { kind: "bind", orgId: pa[0], source: "pending_action" };
  }
  if (ar[0]) {
    return { kind: "bind", orgId: ar[0], source: "agent_run" };
  }

  const mem = uniqueNonEmpty(input.membershipOrgs);
  if (mem.length === 1) {
    return { kind: "bind", orgId: mem[0], source: "membership" };
  }
  if (mem.length === 0) {
    return {
      kind: "archive",
      reasonCode: "NO_ACTIVE_MEMBERSHIP",
      sourceOrgIds: [],
    };
  }
  return {
    kind: "archive",
    reasonCode: "MULTIPLE_ACTIVE_MEMBERSHIPS",
    sourceOrgIds: mem,
  };
}

/** PendingAction 确认：activeOrg 必须与 action.orgId 一致（null 个人草稿除外） */
export function canConfirmPendingActionInActiveOrg(input: {
  actionOrgId: string | null;
  activeOrgId: string;
}): { ok: true } | { ok: false; code: "ORG_CONTEXT_MISMATCH" } {
  if (input.actionOrgId && input.actionOrgId !== input.activeOrgId) {
    return { ok: false, code: "ORG_CONTEXT_MISMATCH" };
  }
  return { ok: true };
}
