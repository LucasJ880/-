/**
 * 企业技能输出 → PendingAction 落库桥
 *
 * 数字员工 JSON 技能可在输出中带 pendingActionProposal；
 * 本模块仅创建待审批草稿，绝不自动批准/执行。
 *
 * 幂等：同一 SkillExecution + proposalIndex + action type 只落一条；
 * 重复处理返回已有 PendingAction。
 */

import { db } from "@/lib/db";
import { createDraft } from "@/lib/pending-actions/drafts";
import type { PendingActionType } from "@/lib/pending-actions/types";

/** 技能允许提议的 PendingAction 白名单 */
export const SKILL_PENDING_ACTION_ALLOWLIST = [
  "sales.update_followup",
  "sales.update_stage",
  "grader.email_draft",
  "grader.internal_note",
  "grader.project_task",
  "marketing.activate_campaign",
] as const satisfies readonly PendingActionType[];

export type SkillPendingActionType =
  (typeof SKILL_PENDING_ACTION_ALLOWLIST)[number];

/** PendingAction.metadata 中的技能来源链（可追溯数字员工 / 技能 / 执行） */
export interface AgentSkillActionSource {
  source: "AGENT_SKILL";
  skillId: string;
  skillSlug: string;
  skillExecutionId: string;
  agentRunId: string;
  proposalIndex: number;
  /** 幂等键：skillExecutionId + proposalIndex + type */
  idempotencyKey: string;
  orgId: string;
}

export interface SkillPendingProposal {
  type: string;
  title?: string;
  preview?: string;
  payload?: Record<string, unknown>;
  /** 兼容扁平字段：未提供 payload 时，其余字段并入 payload */
  [key: string]: unknown;
}

export interface MaterializedPendingAction {
  id: string;
  type: string;
  title: string;
  preview: string;
  /** true = 命中幂等，返回已有草稿 */
  reused?: boolean;
  proposalIndex: number;
}

export interface MaterializeResult {
  created: MaterializedPendingAction[];
  skipped: { reason: string; proposal: SkillPendingProposal; proposalIndex?: number }[];
}

function isAllowlisted(type: string): type is SkillPendingActionType {
  return (SKILL_PENDING_ACTION_ALLOWLIST as readonly string[]).includes(type);
}

function asProposal(value: unknown): SkillPendingProposal | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const obj = value as SkillPendingProposal;
  if (typeof obj.type !== "string" || !obj.type.trim()) return null;
  return obj;
}

/** 幂等键：SkillExecution ID + proposal index + action type */
export function buildSkillPendingIdempotencyKey(
  skillExecutionId: string,
  proposalIndex: number,
  actionType: string,
): string {
  return `${skillExecutionId}:${proposalIndex}:${actionType}`;
}

export function buildAgentSkillActionSource(input: {
  orgId: string;
  skillId: string;
  skillSlug: string;
  skillExecutionId: string;
  agentRunId?: string | null;
  proposalIndex: number;
  actionType: string;
}): AgentSkillActionSource {
  return {
    source: "AGENT_SKILL",
    skillId: input.skillId || "",
    skillSlug: input.skillSlug || "",
    skillExecutionId: input.skillExecutionId,
    agentRunId: input.agentRunId || "",
    proposalIndex: input.proposalIndex,
    idempotencyKey: buildSkillPendingIdempotencyKey(
      input.skillExecutionId,
      input.proposalIndex,
      input.actionType,
    ),
    orgId: input.orgId,
  };
}

/** 从技能 JSON 输出中收集全部提案（顺序即 proposalIndex） */
export function collectPendingProposals(
  parsed: unknown,
): SkillPendingProposal[] {
  if (!parsed || typeof parsed !== "object") return [];
  const root = parsed as Record<string, unknown>;
  const out: SkillPendingProposal[] = [];

  const top = asProposal(root.pendingActionProposal);
  if (top) out.push(top);

  if (Array.isArray(root.priorities)) {
    for (const item of root.priorities) {
      if (!item || typeof item !== "object") continue;
      const p = asProposal(
        (item as { pendingActionProposal?: unknown }).pendingActionProposal,
      );
      if (p) out.push(p);
    }
  }

  if (Array.isArray(root.experiments)) {
    for (const item of root.experiments) {
      if (!item || typeof item !== "object") continue;
      const p = asProposal(
        (item as { pendingActionProposal?: unknown }).pendingActionProposal,
      );
      if (p) out.push(p);
    }
  }

  if (Array.isArray(root.nextActions)) {
    for (const item of root.nextActions) {
      if (!item || typeof item !== "object") continue;
      const maybe = item as SkillPendingProposal;
      if (typeof maybe.type === "string" && maybe.payload) {
        const p = asProposal(maybe);
        if (p) out.push(p);
      }
    }
  }

  return out;
}

function buildPayload(
  proposal: SkillPendingProposal,
  source: AgentSkillActionSource,
): Record<string, unknown> {
  const {
    type: _t,
    title: _title,
    preview: _preview,
    payload,
    ...rest
  } = proposal;
  const base =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? { ...payload }
      : { ...rest };

  const existingMeta =
    base.metadata && typeof base.metadata === "object"
      ? (base.metadata as Record<string, unknown>)
      : {};

  // 来源链字段以桥接器为准，避免被模型输出覆盖
  base.metadata = {
    ...existingMeta,
    ...source,
    orgId: source.orgId,
  };
  return base;
}

async function findExistingByIdempotencyKey(input: {
  orgId: string;
  type: string;
  idempotencyKey: string;
}): Promise<{
  id: string;
  type: string;
  title: string;
  preview: string;
} | null> {
  // Prisma JSON path 查询（PostgreSQL）
  const hit = await db.pendingAction.findFirst({
    where: {
      orgId: input.orgId,
      type: input.type,
      payload: {
        path: ["metadata", "idempotencyKey"],
        equals: input.idempotencyKey,
      },
    },
    select: { id: true, type: true, title: true, preview: true },
    orderBy: { createdAt: "asc" },
  });
  return hit;
}

/**
 * 将技能提案落为 PendingAction(pending)。
 * 非法类型 → skip；同一执行的同一提案 → 复用已有草稿。
 */
export async function materializeSkillPendingActions(input: {
  parsed: unknown;
  userId: string;
  orgId: string;
  skillId?: string;
  skillSlug?: string;
  skillExecutionId?: string;
  agentRunId?: string | null;
  projectId?: string;
  maxActions?: number;
}): Promise<MaterializeResult> {
  const proposals = collectPendingProposals(input.parsed);
  const created: MaterializedPendingAction[] = [];
  const skipped: MaterializeResult["skipped"] = [];
  const max = input.maxActions ?? 5;

  if (!input.skillExecutionId?.trim()) {
    for (const proposal of proposals) {
      skipped.push({
        reason: "缺少 skillExecutionId，拒绝落库（无法保证幂等与来源链）",
        proposal,
      });
    }
    return { created, skipped };
  }

  const skillExecutionId = input.skillExecutionId.trim();

  for (let proposalIndex = 0; proposalIndex < proposals.length; proposalIndex++) {
    const proposal = proposals[proposalIndex];

    if (proposalIndex >= max) {
      skipped.push({
        reason: `超过单次上限 ${max}`,
        proposal,
        proposalIndex,
      });
      continue;
    }

    if (!isAllowlisted(proposal.type)) {
      skipped.push({
        reason: `类型不在白名单: ${proposal.type}`,
        proposal,
        proposalIndex,
      });
      continue;
    }

    const source = buildAgentSkillActionSource({
      orgId: input.orgId,
      skillId: input.skillId ?? "",
      skillSlug: input.skillSlug ?? "",
      skillExecutionId,
      agentRunId: input.agentRunId,
      proposalIndex,
      actionType: proposal.type,
    });

    try {
      const existing = await findExistingByIdempotencyKey({
        orgId: input.orgId,
        type: proposal.type,
        idempotencyKey: source.idempotencyKey,
      });
      if (existing) {
        created.push({
          id: existing.id,
          type: existing.type,
          title: existing.title,
          preview: existing.preview,
          reused: true,
          proposalIndex,
        });
        continue;
      }

      const title =
        (typeof proposal.title === "string" && proposal.title.trim()) ||
        `数字员工建议：${proposal.type}`;
      const preview =
        (typeof proposal.preview === "string" && proposal.preview.trim()) ||
        title;
      const payload = buildPayload(proposal, source);

      const result = await createDraft({
        type: proposal.type,
        title,
        preview,
        payload,
        userId: input.userId,
        orgId: input.orgId,
        agentRunId: input.agentRunId || undefined,
        projectId:
          input.projectId ||
          (typeof payload.projectId === "string"
            ? payload.projectId
            : undefined),
      });

      const data = result.data as
        | { actionId?: string; type?: string; title?: string; preview?: string }
        | null;
      if (result.success && data?.actionId) {
        created.push({
          id: data.actionId,
          type: data.type ?? proposal.type,
          title: data.title ?? title,
          preview: data.preview ?? preview,
          reused: false,
          proposalIndex,
        });
      } else {
        skipped.push({
          reason: result.error || "createDraft 失败",
          proposal,
          proposalIndex,
        });
      }
    } catch (err) {
      skipped.push({
        reason: err instanceof Error ? err.message : String(err),
        proposal,
        proposalIndex,
      });
    }
  }

  return { created, skipped };
}
