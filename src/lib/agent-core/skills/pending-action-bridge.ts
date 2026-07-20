/**
 * 企业技能输出 → PendingAction 落库桥
 *
 * 数字员工 JSON 技能可在输出中带 pendingActionProposal；
 * 本模块仅创建待审批草稿，绝不自动批准/执行。
 */

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
}

export interface MaterializeResult {
  created: MaterializedPendingAction[];
  skipped: { reason: string; proposal: SkillPendingProposal }[];
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

/** 从技能 JSON 输出中收集全部提案 */
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
  orgId: string,
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

  const meta =
    base.metadata && typeof base.metadata === "object"
      ? { ...(base.metadata as Record<string, unknown>) }
      : {};
  if (!meta.orgId) meta.orgId = orgId;
  base.metadata = meta;
  return base;
}

/**
 * 将技能提案落为 PendingAction(pending)。
 * 非法类型 / 缺标题 → skip，不抛错（避免阻断技能主输出）。
 */
export async function materializeSkillPendingActions(input: {
  parsed: unknown;
  userId: string;
  orgId: string;
  skillSlug?: string;
  skillExecutionId?: string;
  projectId?: string;
  maxActions?: number;
}): Promise<MaterializeResult> {
  const proposals = collectPendingProposals(input.parsed);
  const created: MaterializedPendingAction[] = [];
  const skipped: MaterializeResult["skipped"] = [];
  const max = input.maxActions ?? 5;

  for (const proposal of proposals.slice(0, max)) {
    if (!isAllowlisted(proposal.type)) {
      skipped.push({
        reason: `类型不在白名单: ${proposal.type}`,
        proposal,
      });
      continue;
    }

    const title =
      (typeof proposal.title === "string" && proposal.title.trim()) ||
      `数字员工建议：${proposal.type}`;
    const preview =
      (typeof proposal.preview === "string" && proposal.preview.trim()) ||
      title;
    const payload = buildPayload(proposal, input.orgId);

    // 把技能溯源写入 payload，便于审计
    payload.skillTrace = {
      skillSlug: input.skillSlug ?? null,
      skillExecutionId: input.skillExecutionId ?? null,
      source: "enterprise_skill",
    };

    try {
      const result = await createDraft({
        type: proposal.type,
        title,
        preview,
        payload,
        userId: input.userId,
        orgId: input.orgId,
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
        });
      } else {
        skipped.push({
          reason: result.error || "createDraft 失败",
          proposal,
        });
      }
    } catch (err) {
      skipped.push({
        reason: err instanceof Error ? err.message : String(err),
        proposal,
      });
    }
  }

  if (proposals.length > max) {
    for (const proposal of proposals.slice(max)) {
      skipped.push({ reason: `超过单次上限 ${max}`, proposal });
    }
  }

  return { created, skipped };
}
