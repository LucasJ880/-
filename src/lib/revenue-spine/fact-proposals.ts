/**
 * Revenue Spine — 人工回复 → 商务事实提案（B-2，openspec change fde-fact-proposals）
 *
 * 触发：B-1 记录器写完改稿类反馈事件（人工回复作废草稿 replaced_by_manual_reply；将来的 approved_edited）之后。
 * 1. 人工回复先截引用，与草稿快照逐行比较，只看新增的行（事实段 + 签名段）；
 * 2. fact-extract.ts 规则化抽取 6 个 commercialFacts 键，价格类句子整句跳过；
 * 3. 与企业当前值比较：为空或不同才起卡；同字段已有待审批卡 / 24 小时内起过卡 / 同提议值被驳回过都不起；
 * 4. 卡片 revenue_spine.propose_commercial_fact：审批人为组织所有者，只有 admin / boss 能批（执行器认领前判定）；
 * 5. 批准 → 合并进 revenue_spine.business_profile 并发布新版本（与 PUT /api/revenue/policy 同一写入口），
 *    此后 FDE 草稿按 factory-knowledge.ts 的既有口径引用。
 *
 * 起卡判定与执行器合并都是纯函数；起卡器与执行器依赖可注入。不调用 LLM，不抽价格 / 折扣 / 付款条款。
 */

import { FACT_PROPOSAL_ACTION_TYPE, canApproveCommercialFact, FACT_PROPOSAL_DENIED } from "@/lib/pending-actions/approver-roles";
import { isSuperAdmin } from "@/lib/rbac/roles";
import {
  FACT_FIELDS,
  FACT_FIELD_LABELS,
  canonicalPort,
  extractFacts,
  factValueKey,
  factValueLabel,
  stripQuotedReply,
  type ExtractedFact,
  type FactField,
} from "./fact-extract";
import { addedLineIndexes, maskBuyerPii, sectionedLines, type BuyerPiiTerms } from "./fde/draft-diff";
import { mergeBusinessProfile, type BusinessProfile, type CommercialFacts, type RevenueSpinePolicy } from "./policy";

export const FACT_PROPOSAL_TYPE = FACT_PROPOSAL_ACTION_TYPE;
export const FACT_PROPOSAL_TTL_HOURS = 168;
export const FACT_PROPOSAL_COOLDOWN_MS = 24 * 3_600_000;
export const FACT_APPLIED_AUDIT_ACTION = "revenue_spine.commercial_fact.applied";
export const FACT_PROPOSAL_SOURCE_MODULE = "revenue-spine.fact-proposals";
export const EVIDENCE_MAX = 300;
/** 读取驳回记录的上限（只用于去重，最近的优先） */
export const REJECTED_SCAN_LIMIT = 500;

// ── 抽取：原文与脱敏文逐行对齐 ────────────────────────────

export interface ReplyBuyer extends BuyerPiiTerms {
  /** 买家电话（WhatsApp 与之相同则不取） */
  phone?: string | null;
}

export type FactWithEvidence = ExtractedFact & { evidence: string };

/**
 * 只从人工回复新增的行里抽取：
 * - 新增行 = 与草稿快照（已替换买家信息）比较，按替换后的行判；没有快照时整封回复都算新增；
 * - 抽取用原文（脱敏会把我方 WhatsApp 也当电话替换掉）；证据句用替换后、连收件人邮箱也不留的版本。
 */
export function extractFromReply(input: { snapshotBody: string | null; sentRaw: string; buyer: ReplyBuyer }): FactWithEvidence[] {
  const raw = stripQuotedReply(input.sentRaw);
  const forDiff = maskBuyerPii(raw, input.buyer);
  const forEvidence = maskBuyerPii(raw, { ...input.buyer, recipientEmail: null });
  const rawLines = sectionedLines(raw);
  const diffLines = sectionedLines(forDiff);
  const evidenceLines = sectionedLines(forEvidence);
  // 替换不改换行，逐行对齐；万一行数不同（截断边界），退回只用替换后的行
  const aligned = rawLines.length === diffLines.length && evidenceLines.length === diffLines.length;
  const indexes = input.snapshotBody ? addedLineIndexes(input.snapshotBody, forDiff) : diffLines.map((_, i) => i);
  const factLines = indexes.map((i) => ({ line: (aligned ? rawLines[i] : diffLines[i]).line, section: diffLines[i].section }));
  return extractFacts(factLines, { buyerEmail: input.buyer.recipientEmail, buyerPhone: input.buyer.phone }).map((f) => ({
    ...f,
    evidence: (aligned ? evidenceLines[indexes[f.lineIndex]] : diffLines[indexes[f.lineIndex]]).line.slice(0, EVIDENCE_MAX),
  }));
}

// ── 起卡判定（纯函数） ────────────────────────────────────

export interface PlannedProposal {
  field: FactField;
  proposedValue: unknown;
  currentValue: unknown;
  valueKey: string;
  evidence: string;
}

export type ProposalSkipReason = "same" | "pending" | "cooldown" | "rejected";

const isEmpty = (v: unknown) => v === null || v === undefined || (Array.isArray(v) && v.length === 0);

/** 列表字段（装运港）：现有 ∪ 新增；签名：按子字段合并到现有签名上 */
export function proposedValueFor(field: FactField, extracted: unknown, current: unknown): unknown {
  if (field === "loadingPorts") {
    const have = (current as string[] | null) ?? [];
    const haveCanon = new Set(have.map((p) => canonicalPort(p) ?? p.trim()));
    const add = (extracted as string[]).filter((p) => !haveCanon.has(canonicalPort(p) ?? p));
    return [...have, ...add];
  }
  if (field === "signature") {
    const cur = (current as { title: string | null; whatsapp: string | null; website: string | null } | null) ?? null;
    const ext = extracted as { title: string | null; whatsapp: string | null; website: string | null };
    return { title: ext.title ?? cur?.title ?? null, whatsapp: ext.whatsapp ?? cur?.whatsapp ?? null, website: ext.website ?? cur?.website ?? null };
  }
  return extracted;
}

export function rejectedKey(field: FactField, valueKey: string): string {
  return `${field}:${valueKey}`;
}

export function planFactProposals(input: {
  facts: readonly FactWithEvidence[];
  current: CommercialFacts;
  pendingFields: ReadonlySet<string>;
  recentFields: ReadonlySet<string>;
  rejectedKeys: ReadonlySet<string>;
}): { proposals: PlannedProposal[]; skipped: Array<{ field: FactField; reason: ProposalSkipReason }> } {
  const proposals: PlannedProposal[] = [];
  const skipped: Array<{ field: FactField; reason: ProposalSkipReason }> = [];
  const seen = new Set<FactField>();
  for (const fact of input.facts) {
    if (seen.has(fact.field)) continue;
    seen.add(fact.field);
    const currentValue = (input.current as unknown as Record<string, unknown>)[fact.field] ?? null;
    const proposedValue = proposedValueFor(fact.field, fact.value, currentValue);
    const valueKey = factValueKey(fact.field, proposedValue);
    let reason: ProposalSkipReason | null = null;
    if (!isEmpty(currentValue) && factValueKey(fact.field, currentValue) === valueKey) reason = "same";
    else if (input.pendingFields.has(fact.field)) reason = "pending";
    else if (input.recentFields.has(fact.field)) reason = "cooldown";
    else if (input.rejectedKeys.has(rejectedKey(fact.field, valueKey))) reason = "rejected";
    if (reason) skipped.push({ field: fact.field, reason });
    else proposals.push({ field: fact.field, proposedValue, currentValue: isEmpty(currentValue) ? null : currentValue, valueKey, evidence: fact.evidence });
  }
  return { proposals, skipped };
}

// ── 卡片 ──────────────────────────────────────────────────

export interface FactProposalPayload {
  field: FactField;
  proposedValue: unknown;
  currentValue: unknown;
  valueKey: string;
  evidence: string;
  opportunityId: string | null;
  sourcePendingActionId: string;
  metadata: { orgId: string; opportunityId: string | null; sourcePendingActionId: string };
}

export function buildFactProposalApproval(
  p: PlannedProposal,
  ctx: { orgId: string; opportunityId: string | null; sourcePendingActionId: string },
): { title: string; preview: string; payload: FactProposalPayload; idempotencyKey: string } {
  const label = FACT_FIELD_LABELS[p.field];
  const proposed = factValueLabel(p.field, p.proposedValue);
  return {
    title: `商务事实提案：${label} ${proposed}`.slice(0, 160),
    preview: [
      `${label}：当前 ${factValueLabel(p.field, p.currentValue)} → 提议 ${proposed}`,
      "",
      "依据（销售人工回复买家时写的原句，已隐去买家信息）：",
      p.evidence,
      "",
      "批准后写入企业商务事实，此后 FDE 草稿直接引用；驳回后同一提议不再出现。",
    ].join("\n"),
    payload: {
      field: p.field,
      proposedValue: p.proposedValue,
      currentValue: p.currentValue,
      valueKey: p.valueKey,
      evidence: p.evidence,
      opportunityId: ctx.opportunityId,
      sourcePendingActionId: ctx.sourcePendingActionId,
      metadata: { orgId: ctx.orgId, opportunityId: ctx.opportunityId, sourcePendingActionId: ctx.sourcePendingActionId },
    },
    idempotencyKey: `revenue-spine:fact:${p.field}:${p.valueKey}:${ctx.sourcePendingActionId}`.slice(0, 400),
  };
}

// ── 查询条件（纯函数） ────────────────────────────────────

export function pendingProposalWhere(orgId: string, now: Date) {
  return { orgId, type: FACT_PROPOSAL_TYPE, status: "pending", expiresAt: { gt: now } };
}

export function recentProposalWhere(orgId: string, since: Date) {
  return { orgId, type: FACT_PROPOSAL_TYPE, createdAt: { gte: since } };
}

export function rejectedProposalWhere(orgId: string) {
  return { orgId, type: FACT_PROPOSAL_TYPE, status: "rejected" };
}

const rec = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

export function proposalFieldOf(payload: unknown): FactField | null {
  const f = rec(payload)?.field;
  return typeof f === "string" && (FACT_FIELDS as readonly string[]).includes(f) ? (f as FactField) : null;
}

// ── 起卡器 ────────────────────────────────────────────────

export interface ProposeInput {
  orgId: string;
  opportunityId: string | null;
  sourcePendingActionId: string;
  /** 卡片创建人（发出人工回复的人）；外键，必须是真实用户 */
  principalUserId: string;
  /** 草稿快照正文（已替换买家信息）；没有快照时为 null */
  snapshotBody: string | null;
  /** 人工外发原文 */
  sentRaw: string;
  buyer: ReplyBuyer;
  now: Date;
}

export interface FactProposalDeps {
  loadCurrentFacts(orgId: string): Promise<CommercialFacts>;
  pendingFields(orgId: string, now: Date): Promise<string[]>;
  recentFields(orgId: string, since: Date): Promise<string[]>;
  rejectedKeys(orgId: string): Promise<string[]>;
  ownerUserId(orgId: string): Promise<string | null>;
  createApproval(input: {
    orgId: string;
    principalUserId: string;
    approverUserId: string | null;
    title: string;
    preview: string;
    payload: FactProposalPayload;
    idempotencyKey: string;
  }): Promise<{ ok: true; id: string | null } | { ok: false; error: string }>;
}

export interface ProposeResult {
  extracted: number;
  created: string[];
  failed: number;
  skipped: Array<{ field: FactField; reason: ProposalSkipReason }>;
}

export async function proposeCommercialFacts(input: ProposeInput, deps: FactProposalDeps = defaultFactProposalDeps()): Promise<ProposeResult> {
  const facts = extractFromReply({ snapshotBody: input.snapshotBody, sentRaw: input.sentRaw, buyer: input.buyer });
  const out: ProposeResult = { extracted: facts.length, created: [], failed: 0, skipped: [] };
  if (!facts.length) return out;
  const [current, pending, recent, rejected, owner] = await Promise.all([
    deps.loadCurrentFacts(input.orgId),
    deps.pendingFields(input.orgId, input.now),
    deps.recentFields(input.orgId, new Date(input.now.getTime() - FACT_PROPOSAL_COOLDOWN_MS)),
    deps.rejectedKeys(input.orgId),
    deps.ownerUserId(input.orgId),
  ]);
  const plan = planFactProposals({ facts, current, pendingFields: new Set(pending), recentFields: new Set(recent), rejectedKeys: new Set(rejected) });
  out.skipped = plan.skipped;
  for (const p of plan.proposals) {
    const card = buildFactProposalApproval(p, { orgId: input.orgId, opportunityId: input.opportunityId, sourcePendingActionId: input.sourcePendingActionId });
    try {
      const r = await deps.createApproval({ orgId: input.orgId, principalUserId: input.principalUserId, approverUserId: owner, ...card });
      if (r.ok && r.id) out.created.push(r.id);
      else out.failed += 1;
    } catch {
      out.failed += 1;
    }
  }
  return out;
}

/** 尽力而为：任何异常只记日志，返回 null（不影响反馈事件与外发同步） */
export async function proposeCommercialFactsSafe(input: ProposeInput, deps?: FactProposalDeps): Promise<ProposeResult | null> {
  try {
    return await proposeCommercialFacts(input, deps);
  } catch (err) {
    console.error("[fact-proposals] 起卡失败", input.sourcePendingActionId, err instanceof Error ? err.name : typeof err);
    return null;
  }
}

export function defaultFactProposalDeps(): FactProposalDeps {
  return {
    loadCurrentFacts: async (orgId) => {
      const { loadRevenueSpinePolicy } = await import("./policy");
      return (await loadRevenueSpinePolicy(orgId)).businessProfile.commercialFacts;
    },
    pendingFields: async (orgId, now) => {
      const { db } = await import("@/lib/db");
      const rows = await db.pendingAction.findMany({ where: pendingProposalWhere(orgId, now), select: { payload: true }, take: 200 });
      return rows.map((r) => proposalFieldOf(r.payload)).filter((f): f is FactField => f !== null);
    },
    recentFields: async (orgId, since) => {
      const { db } = await import("@/lib/db");
      const rows = await db.pendingAction.findMany({ where: recentProposalWhere(orgId, since), select: { payload: true }, take: 200 });
      return rows.map((r) => proposalFieldOf(r.payload)).filter((f): f is FactField => f !== null);
    },
    rejectedKeys: async (orgId) => {
      const { db } = await import("@/lib/db");
      const rows = await db.pendingAction.findMany({
        where: rejectedProposalWhere(orgId),
        select: { payload: true },
        orderBy: { createdAt: "desc" },
        take: REJECTED_SCAN_LIMIT,
      });
      return rows
        .map((r) => {
          const field = proposalFieldOf(r.payload);
          const key = rec(r.payload)?.valueKey;
          return field && typeof key === "string" ? rejectedKey(field, key) : null;
        })
        .filter((k): k is string => k !== null);
    },
    ownerUserId: async (orgId) => {
      const { db } = await import("@/lib/db");
      const org = await db.organization.findUnique({ where: { id: orgId }, select: { ownerId: true } });
      return org?.ownerId ?? null;
    },
    createApproval: async (input) => {
      const { requestApproval } = await import("@/lib/approval/request");
      const r = await requestApproval({
        orgId: input.orgId,
        principal: { userId: input.principalUserId, actorType: "agent" },
        actionType: FACT_PROPOSAL_TYPE,
        title: input.title,
        preview: input.preview,
        payload: input.payload as unknown as Record<string, unknown>,
        // 改写企业配置、影响此后所有草稿：敏感内部写入，必须人工批准
        risk: { vocabulary: "agent-core.tool-risk", value: "l2_soft", requiresApproval: true },
        source: { module: FACT_PROPOSAL_SOURCE_MODULE, toolName: "propose_commercial_fact", stepKey: `fact:${input.payload.field}` },
        approver: { approverUserId: input.approverUserId ?? undefined, requiredRole: "boss" },
        ttlHours: FACT_PROPOSAL_TTL_HOURS,
        idempotencyKey: input.idempotencyKey,
      });
      return r.ok ? { ok: true, id: r.actionIds[0] ?? null } : { ok: false, error: r.error };
    },
  };
}

// ── 执行器（批准后写入） ──────────────────────────────────

/** 把一个字段合并进业务画像（与 PUT /api/revenue/policy 同一合并规则：字段级覆盖，不合法的值被丢弃） */
export function applyCommercialFact(profile: BusinessProfile, field: FactField, value: unknown): BusinessProfile {
  return mergeBusinessProfile(profile, { commercialFacts: { [field]: value } });
}

/** 合并后该字段与提议值规范键一致 = 提议值合法、确实写进去了 */
export function factAppliedCleanly(merged: BusinessProfile, field: FactField, value: unknown): boolean {
  const got = (merged.commercialFacts as unknown as Record<string, unknown>)[field];
  return !isEmpty(got) && factValueKey(field, got) === factValueKey(field, value);
}

export interface FactExecDeps {
  membershipActive(userId: string, orgId: string): Promise<boolean>;
  isSuperAdmin(role: string | null | undefined): boolean;
  loadPolicy(orgId: string): Promise<RevenueSpinePolicy>;
  publishProfile(orgId: string, profile: BusinessProfile, userId: string): Promise<{ version: number }>;
  audit(input: { userId: string; orgId: string; targetId: string; afterData: Record<string, unknown>; beforeData: Record<string, unknown> }): Promise<void>;
}

export async function execProposeCommercialFact(
  payload: Partial<FactProposalPayload> | null | undefined,
  ctx: { userId: string; role: string | null | undefined; orgId?: string | null },
  actionId: string,
  deps: FactExecDeps = defaultFactExecDeps(),
): Promise<{ ok: boolean; resultRef?: string; message?: string; error?: string }> {
  const orgId = payload?.metadata?.orgId;
  if (!orgId) return { ok: false, error: "缺少组织信息，拒绝执行" };
  if (ctx.orgId && ctx.orgId !== orgId) return { ok: false, error: "跨组织动作，拒绝执行" };
  // 认领前已判过；这里再判一次（纵深防御）
  if (!canApproveCommercialFact(ctx.role)) return { ok: false, error: FACT_PROPOSAL_DENIED };
  if (!deps.isSuperAdmin(ctx.role) && !(await deps.membershipActive(ctx.userId, orgId))) return { ok: false, error: "无权更新该组织的商务事实" };
  const field = payload?.field;
  if (!field || !(FACT_FIELDS as readonly string[]).includes(field)) return { ok: false, error: "未知的商务事实字段" };
  if (isEmpty(payload?.proposedValue)) return { ok: false, error: "缺少提议值" };

  const policy = await deps.loadPolicy(orgId);
  const before = (policy.businessProfile.commercialFacts as unknown as Record<string, unknown>)[field] ?? null;
  const merged = applyCommercialFact(policy.businessProfile, field, payload!.proposedValue);
  if (!factAppliedCleanly(merged, field, payload!.proposedValue)) return { ok: false, error: "提议值不合法，未写入商务事实" };
  const { version } = await deps.publishProfile(orgId, merged, ctx.userId);
  await deps.audit({
    userId: ctx.userId,
    orgId,
    targetId: orgId,
    beforeData: { field, valueKey: isEmpty(before) ? null : factValueKey(field, before) },
    afterData: {
      field,
      valueKey: factValueKey(field, payload!.proposedValue),
      version,
      pendingActionId: actionId,
      sourcePendingActionId: payload?.sourcePendingActionId ?? null,
      opportunityId: payload?.opportunityId ?? null,
    },
  });
  return { ok: true, resultRef: `business_profile:v${version}`, message: `${FACT_FIELD_LABELS[field]}已写入商务事实，此后 FDE 草稿会引用` };
}

export function defaultFactExecDeps(): FactExecDeps {
  return {
    membershipActive: async (userId, orgId) => {
      const { getOrgMembership } = await import("@/lib/auth");
      return (await getOrgMembership(userId, orgId))?.status === "active";
    },
    isSuperAdmin: (role) => isSuperAdmin(role ?? ""),
    loadPolicy: async (orgId) => (await import("./policy")).loadRevenueSpinePolicy(orgId),
    publishProfile: async (orgId, profile, userId) => {
      const { publishRevenueSpineRule, RULE_KEY_BUSINESS_PROFILE } = await import("./policy");
      return publishRevenueSpineRule({ orgId, ruleKey: RULE_KEY_BUSINESS_PROFILE, config: profile as unknown as Record<string, unknown>, userId });
    },
    audit: async (input) => {
      const { logAudit } = await import("@/lib/audit/logger");
      await logAudit({
        userId: input.userId,
        orgId: input.orgId,
        action: FACT_APPLIED_AUDIT_ACTION,
        targetType: "organization",
        targetId: input.targetId,
        beforeData: input.beforeData,
        afterData: input.afterData,
      });
    },
  };
}
