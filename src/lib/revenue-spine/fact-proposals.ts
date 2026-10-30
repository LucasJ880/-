/**
 * Revenue Spine — 人工回复 → 商务事实提案（B-2，openspec change fde-fact-proposals）
 *
 * 触发：B-1 记录器写完改稿类反馈事件（人工回复作废草稿 replaced_by_manual_reply；将来的 approved_edited）之后。
 * 1. 人工回复先截引用，与草稿快照逐行比较，只看新增的行（事实段 + 签名段）；
 * 2. fact-extract.ts 规则化抽取 6 个 commercialFacts 键，价格类句子整句跳过；
 * 3. 与企业当前值比较（回复里没写的子字段沿用当前值）：为空或不同才起卡；同字段已有待审批卡 / 24 小时内起过卡 /
 *    同提议值被驳回过 / 提议值过不了商务事实合并规则 / 组织里没有能批的人，都不起；
 * 4. 卡片 revenue_spine.propose_commercial_fact：审批人优先组织所有者（平台角色须为 admin / boss），否则在职的 boss、admin；
 *    只有平台角色 admin / boss 能批（执行器认领前按 User.role 判定）；
 * 5. 批准 → 在批准时的最新商务事实上重新合并抽取值，写进 revenue_spine.business_profile 并发布新版本
 *    （与 PUT /api/revenue/policy 同一写入口），此后 FDE 草稿按 factory-knowledge.ts 的既有口径引用。
 *
 * 起卡判定与执行器合并都是纯函数；起卡器与执行器依赖可注入。不调用 LLM，不抽价格 / 折扣 / 付款条款。
 */

import { FACT_PROPOSAL_ACTION_TYPE, FACT_PROPOSAL_APPROVER_PERMISSION, canApproveCommercialFact, FACT_PROPOSAL_DENIED } from "@/lib/pending-actions/approver-roles";
import { isSuperAdmin } from "@/lib/rbac/roles";
import {
  DEFAULT_PRODUCTION_STARTS_FROM,
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
import { addedLineIndexes, isClosing, maskBuyerPii, sectionedLines, type BuyerPiiTerms } from "./fde/draft-diff";
import { mergeBusinessProfile, mergeCommercialFacts, type BusinessProfile, type CommercialFacts, type RevenueSpinePolicy } from "./policy";

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
  // 有没有结束语按整封回复判（照抄草稿的 "Best regards," 不在新增行里）
  const signatureHasClosing = diffLines.some((l) => l.section === "signature" && isClosing(l.line));
  return extractFacts(factLines, { buyerEmail: input.buyer.recipientEmail, buyerPhone: input.buyer.phone, signatureHasClosing }).map((f) => ({
    ...f,
    evidence: (aligned ? evidenceLines[indexes[f.lineIndex]] : diffLines[indexes[f.lineIndex]]).line.slice(0, EVIDENCE_MAX),
  }));
}

// ── 起卡判定（纯函数） ────────────────────────────────────

export interface PlannedProposal {
  field: FactField;
  /** 回复里抽到的原值（没写的子字段为 null）；批准时在最新商务事实上重新合并 */
  extractedValue: unknown;
  /** 起卡时按当前值合并出的提议值（卡片展示用） */
  proposedValue: unknown;
  currentValue: unknown;
  valueKey: string;
  evidence: string;
}

export type ProposalSkipReason = "same" | "pending" | "cooldown" | "rejected" | "invalid" | "no_approver";

const isEmpty = (v: unknown) => v === null || v === undefined || (Array.isArray(v) && v.length === 0);

type Rec = Record<string, unknown>;
const recOf = (v: unknown): Rec | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : null);

/**
 * 抽取值 → 提议值（回复里没写的部分沿用企业当前值，不清空、不改成默认）：
 * - 装运港：现有 ∪ 新增；
 * - 起订量：没写"按什么计"沿用当前，当前也没有时用合并规则的默认（style）；
 * - 样品时效：现货样、定制样两组各自合并，没写的那组沿用当前；
 * - 大货周期：没写起算点沿用当前，当前也没有时用默认起算点；
 * - 落款：只补当前为空的子字段（落款全组织共用、每个销售的 WhatsApp 不同，已配置的不来回改）。
 */
export function proposedValueFor(field: FactField, extracted: unknown, current: unknown): unknown {
  const ext = recOf(extracted);
  const cur = recOf(current);
  switch (field) {
    case "loadingPorts": {
      const have = Array.isArray(current) ? (current as string[]) : [];
      const haveCanon = new Set(have.map((p) => canonicalPort(p) ?? p.trim()));
      const add = (extracted as string[]).filter((p) => !haveCanon.has(canonicalPort(p) ?? p));
      return [...have, ...add];
    }
    case "moq":
      return ext ? { quantity: ext.quantity, unit: ext.unit, per: ext.per ?? cur?.per ?? "style" } : extracted;
    case "sampleLeadTime": {
      if (!ext) return extracted;
      const hasCustom = ext.customDaysMin !== null && ext.customDaysMin !== undefined;
      return {
        stockDays: ext.stockDays ?? cur?.stockDays ?? null,
        customDaysMin: hasCustom ? ext.customDaysMin : (cur?.customDaysMin ?? null),
        customDaysMax: hasCustom ? (ext.customDaysMax ?? null) : (cur?.customDaysMax ?? null),
      };
    }
    case "productionLeadTime":
      return ext ? { daysMin: ext.daysMin, daysMax: ext.daysMax, startsFrom: ext.startsFrom ?? cur?.startsFrom ?? DEFAULT_PRODUCTION_STARTS_FROM } : extracted;
    case "signature": {
      if (!ext) return extracted;
      const sub = (k: "title" | "whatsapp" | "website") => cur?.[k] ?? ext[k] ?? null;
      return { title: sub("title"), whatsapp: sub("whatsapp"), website: sub("website") };
    }
    case "catalogUrl":
      return extracted;
  }
}

/** 提议值能原样通过商务事实合并规则（与批准时执行器写入同一规则）；不能的不起卡，免得批准后才失败 */
export function proposalAppliesCleanly(current: CommercialFacts, field: FactField, value: unknown): boolean {
  const merged = mergeCommercialFacts(current, { [field]: value });
  const got = (merged as unknown as Rec)[field];
  return !isEmpty(got) && factValueKey(field, got) === factValueKey(field, value);
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
  // 抽取值原样留在提议里，批准时在最新配置上重新合并
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
    else if (!proposalAppliesCleanly(input.current, fact.field, proposedValue)) reason = "invalid";
    else if (input.pendingFields.has(fact.field)) reason = "pending";
    else if (input.recentFields.has(fact.field)) reason = "cooldown";
    else if (input.rejectedKeys.has(rejectedKey(fact.field, valueKey))) reason = "rejected";
    if (reason) skipped.push({ field: fact.field, reason });
    else
      proposals.push({
        field: fact.field,
        extractedValue: fact.value,
        proposedValue,
        currentValue: isEmpty(currentValue) ? null : currentValue,
        valueKey,
        evidence: fact.evidence,
      });
  }
  return { proposals, skipped };
}

// ── 卡片 ──────────────────────────────────────────────────

export interface FactProposalPayload {
  field: FactField;
  /** 旧载荷可能没有；执行器退回用 proposedValue */
  extractedValue?: unknown;
  proposedValue: unknown;
  currentValue: unknown;
  valueKey: string;
  evidence: string;
  opportunityId: string | null;
  sourcePendingActionId: string;
  metadata: { orgId: string; opportunityId: string | null; sourcePendingActionId: string };
}

/** 回复里没写、当前也没有，只能按商务事实合并规则的默认值补上的部分（卡片里标出来，让老板知道不是销售写的） */
export function defaultedParts(field: FactField, extracted: unknown, current: unknown): string[] {
  const ext = recOf(extracted);
  const cur = recOf(current);
  if (field === "moq" && ext && !ext.per && !cur?.per) return ["按什么计（默认 style）"];
  if (field === "productionLeadTime" && ext && !ext.startsFrom && !cur?.startsFrom) return [`起算点（默认 ${DEFAULT_PRODUCTION_STARTS_FROM}）`];
  return [];
}

export function buildFactProposalApproval(
  p: PlannedProposal,
  ctx: { orgId: string; opportunityId: string | null; sourcePendingActionId: string },
): { title: string; preview: string; payload: FactProposalPayload; idempotencyKey: string } {
  const label = FACT_FIELD_LABELS[p.field];
  const proposed = factValueLabel(p.field, p.proposedValue);
  const defaulted = defaultedParts(p.field, p.extractedValue, p.currentValue);
  return {
    title: `商务事实提案：${label} ${proposed}`.slice(0, 160),
    preview: [
      `${label}：当前 ${factValueLabel(p.field, p.currentValue)} → 提议 ${proposed}`,
      ...(defaulted.length ? [`回复里没写、按默认值补上：${defaulted.join("；")}`] : []),
      "",
      "依据（发给买家的外发正文原句，已隐去买家信息）：",
      p.evidence,
      "",
      "批准时以届时的最新配置为准重新合并（回复里没写的部分不改）；批准后写入企业商务事实，此后 FDE 草稿直接引用；驳回后同一提议不再出现。",
    ].join("\n"),
    payload: {
      field: p.field,
      extractedValue: p.extractedValue,
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

export function proposalFieldOf(payload: unknown): FactField | null {
  const f = recOf(payload)?.field;
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
  /** 在职成员（含是否能批），用于挑审批人 */
  approverCandidates(orgId: string): Promise<ApproverCandidate[]>;
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

export interface ApproverCandidate {
  userId: string;
  /** 能批：平台 super_admin 或在该企业持 trade.settings.manage（canApproveCommercialFact） */
  canApprove: boolean;
  isOwner: boolean;
  /** 在职成员（所有者不在成员表里时按在职算） */
  active: boolean;
  joinedAt: Date | null;
}

/**
 * 挑审批人：能批的所有者 → 其他能批的在职成员，同类按入职先后。
 * 审批人必须本身能批（平台 super_admin 或持 trade.settings.manage），否则卡会永远批不了。没有合格的人返回 null（不起卡）。
 */
export function pickFactApprover(candidates: readonly ApproverCandidate[]): string | null {
  const ok = candidates.filter((c) => c.active && c.canApprove);
  const rank = (c: ApproverCandidate) => (c.isOwner ? 0 : 1);
  const sorted = [...ok].sort((a, b) => rank(a) - rank(b) || (a.joinedAt?.getTime() ?? 0) - (b.joinedAt?.getTime() ?? 0));
  return sorted[0]?.userId ?? null;
}

/** 是否在该企业持 trade.settings.manage——与 holdsTradePermission / PUT /api/revenue/policy 同一授权引擎（不含平台角色） */
export async function holdsFactApproverKey(userId: string, orgId: string): Promise<boolean> {
  const { authorize } = await import("@/lib/authorization");
  const decision = await authorize({ principal: { type: "HUMAN", id: userId, orgId }, orgId, permission: FACT_PROPOSAL_APPROVER_PERMISSION });
  return decision.allowed;
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
  const [current, pending, recent, rejected, candidates] = await Promise.all([
    deps.loadCurrentFacts(input.orgId),
    deps.pendingFields(input.orgId, input.now),
    deps.recentFields(input.orgId, new Date(input.now.getTime() - FACT_PROPOSAL_COOLDOWN_MS)),
    deps.rejectedKeys(input.orgId),
    deps.approverCandidates(input.orgId),
  ]);
  const plan = planFactProposals({ facts, current, pendingFields: new Set(pending), recentFields: new Set(recent), rejectedKeys: new Set(rejected) });
  out.skipped = plan.skipped;
  const approver = pickFactApprover(candidates);
  if (!approver) {
    out.skipped.push(...plan.proposals.map((p) => ({ field: p.field, reason: "no_approver" as const })));
    return out;
  }
  for (const p of plan.proposals) {
    const card = buildFactProposalApproval(p, { orgId: input.orgId, opportunityId: input.opportunityId, sourcePendingActionId: input.sourcePendingActionId });
    try {
      const r = await deps.createApproval({ orgId: input.orgId, principalUserId: input.principalUserId, approverUserId: approver, ...card });
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
          const key = recOf(r.payload)?.valueKey;
          return field && typeof key === "string" ? rejectedKey(field, key) : null;
        })
        .filter((k): k is string => k !== null);
    },
    approverCandidates: async (orgId) => {
      const { db } = await import("@/lib/db");
      const [org, members] = await Promise.all([
        db.organization.findUnique({ where: { id: orgId }, select: { ownerId: true } }),
        db.organizationMember.findMany({
          where: { orgId, status: "active", user: { status: "active" } },
          select: { userId: true, joinedAt: true, user: { select: { role: true } } },
          orderBy: { joinedAt: "asc" },
          take: 50,
        }),
      ]);
      // 只取在职成员：所有者账号停用、成员停用或不在成员表时都不当审批人
      // （执行器在认领后才查成员身份，非成员批准会把卡消耗成 failed）
      // 能否批与 PUT /api/revenue/policy 同源：平台 super_admin 或企业内 trade.settings.manage
      return Promise.all(
        members.map(async (m) => ({
          userId: m.userId,
          canApprove: canApproveCommercialFact({ platformRole: m.user.role, holdsSettingsKey: await holdsFactApproverKey(m.userId, orgId) }),
          isOwner: m.userId === org?.ownerId,
          active: true,
          joinedAt: m.joinedAt,
        })),
      );
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
  /** 批准人的平台角色 User.role（ctx.role 可能是组织成员角色，不能用） */
  platformRole(userId: string): Promise<string | null>;
  /** 批准人是否在该企业持 trade.settings.manage（与 PUT /api/revenue/policy 同源） */
  holdsSettingsKey(userId: string, orgId: string): Promise<boolean>;
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
  // 认领前已判过；这里再判一次（纵深防御），同样按 userId 读平台角色、按 userId + 企业判岗位键
  const platformRole = await deps.platformRole(ctx.userId);
  if (!canApproveCommercialFact({ platformRole, holdsSettingsKey: await deps.holdsSettingsKey(ctx.userId, orgId) })) {
    return { ok: false, error: FACT_PROPOSAL_DENIED };
  }
  if (!deps.isSuperAdmin(platformRole) && !(await deps.membershipActive(ctx.userId, orgId))) return { ok: false, error: "无权更新该组织的商务事实" };
  const field = payload?.field;
  if (!field || !(FACT_FIELDS as readonly string[]).includes(field)) return { ok: false, error: "未知的商务事实字段" };
  // 没有抽取原值的旧载荷退回用提议值
  const extracted = payload?.extractedValue ?? payload?.proposedValue;
  if (isEmpty(extracted)) return { ok: false, error: "缺少提议值" };

  // 在批准时的最新配置上重新合并：起卡后老板改过的港口 / 落款等不会被起卡时算好的值覆盖
  const policy = await deps.loadPolicy(orgId);
  const before = (policy.businessProfile.commercialFacts as unknown as Record<string, unknown>)[field] ?? null;
  const value = proposedValueFor(field, extracted, before);
  if (!isEmpty(before) && factValueKey(field, before) === factValueKey(field, value)) {
    return { ok: true, resultRef: "business_profile:unchanged", message: `${FACT_FIELD_LABELS[field]}已是该值，未发布新版本` };
  }
  const merged = applyCommercialFact(policy.businessProfile, field, value);
  if (!factAppliedCleanly(merged, field, value)) return { ok: false, error: "提议值不合法，未写入商务事实" };
  const { version } = await deps.publishProfile(orgId, merged, ctx.userId);
  await deps.audit({
    userId: ctx.userId,
    orgId,
    targetId: orgId,
    beforeData: { field, valueKey: isEmpty(before) ? null : factValueKey(field, before) },
    afterData: {
      field,
      valueKey: factValueKey(field, value),
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
    platformRole: async (userId) => {
      const { db } = await import("@/lib/db");
      return (await db.user.findUnique({ where: { id: userId }, select: { role: true } }))?.role ?? null;
    },
    holdsSettingsKey: (userId, orgId) => holdsFactApproverKey(userId, orgId),
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
