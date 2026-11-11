/**
 * W-1 询价 Web 入口 — 只读加载器：组装 GET /api/projects/[id]/tender-rfq/entry 的响应
 *
 * 零副作用：不建轮次、不建审批卡、不发信。判定与真正送审共用同一套函数：
 *   轮次锁 / 待批发送卡  → service.loadRfqRoundLockState（= prepareRfqRound 用的那份）
 *   已确认要求 / 敏感拦截 → service.loadRfqRequirementInputs + build.buildRfqDocument（内存预构建，不落库）
 *   发件授权             → round-pure.resolveSender + google-email.hasGmailComposeScope（= execTenderSendRfq 用的那份）
 *   催单天数             → chase-pure.resolveChaseAfterDays（= 催单引擎用的那份）
 * 响应按白名单组装，不含项目估值 / 我方报价 / 毛利。
 */

import { isRfqAutoDraftEnabledForOrg } from "./auto-draft-flags";
import { AUTO_DRAFT_TOOL_NAME, autoDraftedRoundNotes } from "./auto-draft-pure";
import { buildFollowUpPolicy, followUpCardView, parseFollowUpPolicy, type FollowUpCardView } from "./followup-coverage";
import { isRfqFollowUpPreapprovalEnabledForOrg } from "./followup-flags";
import { loadRoundFollowUpStatus } from "./followup-service";
import { db } from "@/lib/db";
import { resolveOrgTimezone } from "@/lib/automation/registry";
import { hasGmailComposeScope, hasGmailReadScope } from "@/lib/google-email";
import { pickRfqIncoterm, readUserPrefs } from "@/lib/muse-bridge/prefs-pure";
import { buildRfqDocument } from "./build";
import { chaseTemplateHash, resolveChaseAfterDays } from "./chase-pure";
import { readTenderRfqSettings, resolveSender } from "./round-pure";
import { loadRfqRequirementInputs, loadRfqRoundLockState } from "./service";
import { TENDER_SEND_CHASE_TYPE, TENDER_SEND_RFQ_TYPE, type TenderSendChasePayload } from "./types";
import {
  assembleEntryPreview,
  chaseStillNeeded,
  autoIngestNote,
  decideRfqEntryState,
  elapsedLabel,
  orderEntrySuppliers,
  type EntryPreview,
  type EntrySupplier,
  type RfqEntryFacts,
  type RfqEntryState,
  type UserMessage,
} from "./web-entry-pure";

export type RfqWebEntry =
  | { available: false; reason: "not_tender" }
  | {
      available: true;
      state: RfqEntryState;
      suppliers: EntrySupplier[];
      defaults: { incoterm: "EXW" | "FOB" | "CIF" | "DDP" | "DAP" | null; incotermFromPrefs: boolean };
      preview: EntryPreview;
      /** 本项目待批（或已批未执行）的发送卡；路由层再补审批能力 */
      pendingSends: Array<{ actionId: string; inquiryId: string; roundNumber: number | null; createdAt: string }>;
      /** T-1：本项目待批（未过期）或已批执行中的催单 / 追问卡；路由层再补审批能力与正文（design D13） */
      pendingChases: Array<{
        actionId: string;
        inquiryId: string;
        itemId: string;
        supplierName: string;
        kind: "no_reply" | "missing_fields";
        chaseIndex: number;
        roundNumber: number | null;
        createdAt: string;
      }>;
      /** 由询价引擎发出的轮次：inquiryId → 耗时标签 */
      engineRounds: Record<string, { elapsed: string | null }>;
      autoIngest: UserMessage;
      timeZone: string;
      /** RFQ-AUTO-1：开关关闭时为 null——界面不出现任何自动跟进的内容 */
      followUp: RfqEntryFollowUp | null;
      /** RFQ-AUTO-2：由系统起草的轮次（inquiryId → 卡上的那句说明）；开关关闭时没有这个字段——响应与界面都和本功能之前相同 */
      autoDraftedRounds?: Record<string, { noteZh: string }>;
    };

/** RFQ-AUTO-1：入口里与跟进授权有关的全部内容 */
export type RfqEntryFollowUp = {
  /** 新建一轮时可勾选的授权（范围 + 模板预览） */
  offer: FollowUpCardView | null;
  /** 待批发送卡上已带的授权：actionId → 展示内容 */
  cards: Record<string, FollowUpCardView>;
  /** 各轮的状态：inquiryId → 生效中 / 已停止 / 未生效 */
  rounds: Record<string, { state: "active" | "stopped" | "inactive"; summaryZh: string; reasonZh: string | null; autoSentCount: number }>;
};

const SUPPLIER_LIMIT = 100;

export async function loadRfqWebEntry(input: { projectId: string; orgId: string; userId: string; now?: Date }): Promise<RfqWebEntry> {
  const now = input.now ?? new Date();
  const project = await db.project.findFirst({
    where: { id: input.projectId, orgId: input.orgId, workDomain: "tender" },
    select: { id: true, name: true, closeDate: true, ownerId: true, org: { select: { settingsJson: true } } },
  });
  if (!project) return { available: false, reason: "not_tender" };

  const orgSettings = project.org?.settingsJson ?? null;
  const settings = readTenderRfqSettings(orgSettings);
  const timeZone = resolveOrgTimezone(orgSettings);
  const prefs = readUserPrefs(orgSettings, input.userId);

  const [lockState, reqInputs, providers, supplierRows, executed, chaseRows] = await Promise.all([
    loadRfqRoundLockState({ orgId: input.orgId, projectId: project.id, now, roundLockDays: settings.roundLockDays }),
    loadRfqRequirementInputs(project.id),
    db.emailProvider.findMany({
      where: { type: "gmail", accountEmail: { equals: settings.mailboxEmail, mode: "insensitive" } },
      select: { userId: true, accountEmail: true, grantedScopes: true },
    }),
    db.supplier.findMany({
      where: {
        orgId: input.orgId,
        OR: [{ status: "active" }, ...(prefs.defaultSupplierIds.length ? [{ id: { in: prefs.defaultSupplierIds } }] : [])],
      },
      orderBy: { updatedAt: "desc" },
      take: SUPPLIER_LIMIT,
      select: { id: true, name: true, contactEmail: true, status: true },
    }),
    db.pendingAction.findMany({
      where: { orgId: input.orgId, projectId: project.id, type: TENDER_SEND_RFQ_TYPE, status: "executed" },
      select: { payload: true, createdAt: true, executedAt: true },
    }),
    // 已过期没人批的催单卡不列：下次定时检查会按规则重新起草
    db.pendingAction.findMany({
      where: {
        orgId: input.orgId,
        projectId: project.id,
        type: TENDER_SEND_CHASE_TYPE,
        OR: [{ status: "approved" }, { status: "pending", expiresAt: { gt: now } }],
      },
      select: { id: true, payload: true, createdAt: true, status: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  // 待批催单卡对应那家的当前状态：已回复的那家不用再催（批了执行器也不会发），不列
  const chaseItemIds = [
    ...new Set(chaseRows.flatMap((a) => {
      const id = (a.payload as Partial<TenderSendChasePayload> | null)?.inquiryItemId;
      return id ? [id] : [];
    })),
  ];
  const chaseItemStatus = new Map(
    (chaseItemIds.length
      ? await db.inquiryItem.findMany({ where: { id: { in: chaseItemIds } }, select: { id: true, status: true } })
      : []
    ).map((i) => [i.id, i.status]),
  );

  // ── 内存预构建（与 prepareRfqRound 的 buildRfqDocument 入参一致；不传人工可选项） ──
  const term = pickRfqIncoterm(null, prefs);
  const built = buildRfqDocument({
    projectName: project.name,
    buyerDisplayName: settings.fromName,
    closeDate: project.closeDate ? project.closeDate.toISOString() : null,
    now,
    requirements: reqInputs.requirements,
    facts: reqInputs.facts,
    incoterm: term.incoterm,
    replyLeadDays: settings.replyLeadDays,
  });
  const confirmedRequirementCount = built.ok ? built.doc.lineItems.length : 0;
  const excludedCount = built.ok ? built.doc.excluded.length : 0;
  const replyBy = built.ok ? built.doc.replyBy : null;

  // ── 发件授权（执行器同一函数） ──
  const sender = resolveSender(providers, settings.mailboxEmail, hasGmailComposeScope);
  const provider = providers.find((p) => p.accountEmail.toLowerCase() === settings.mailboxEmail.toLowerCase());
  const hasReadScope = !!provider && hasGmailReadScope(provider.grantedScopes);

  // ── 轮次锁 → 纯函数输入 ──
  const roundOf = new Map(lockState.existing.map((r) => [r.inquiryId, r]));
  const lock: RfqEntryFacts["lock"] = lockState.lock.locked
    ? (() => {
        const v = lockState.lock;
        const r = roundOf.get(v.inquiryId);
        return {
          locked: true as const,
          reason: v.reason,
          inquiryId: v.inquiryId,
          roundNumber: r?.roundNumber ?? 0,
          at: (r?.createdAt ?? now).toISOString(),
          days: settings.roundLockDays,
        };
      })()
    : { locked: false as const };

  const suppliers = orderEntrySuppliers(supplierRows, prefs.defaultSupplierIds);

  const state = decideRfqEntryState({
    projectId: project.id,
    lock,
    confirmedRequirementCount,
    readySupplierCount: suppliers.filter((s) => s.ready).length,
    buildError: built.ok ? null : built.errorCode,
    sender: sender.ok ? { ok: true } : { ok: false, errorCode: sender.errorCode },
    hasReadScope,
    mailboxEmail: settings.mailboxEmail,
    fromEmail: settings.fromEmail,
    replyBy,
    timeZone,
  });

  // ── 引擎发出的轮次与耗时 ──
  const engineRounds: Record<string, { elapsed: string | null }> = {};
  for (const a of executed) {
    const inquiryId = (a.payload as { inquiryId?: string } | null)?.inquiryId;
    if (!inquiryId) continue;
    engineRounds[inquiryId] = { elapsed: elapsedLabel(a.createdAt.toISOString(), a.executedAt?.toISOString() ?? null) };
  }

  const ownerPrefs = project.ownerId ? readUserPrefs(orgSettings, project.ownerId) : null;
  const chaseAfterDays = resolveChaseAfterDays(ownerPrefs?.chaseAfterDays ?? null, orgSettings);

  return {
    available: true,
    state,
    suppliers,
    defaults: { incoterm: term.incoterm, incotermFromPrefs: term.fromPrefs },
    preview: assembleEntryPreview({
      fromName: settings.fromName,
      fromEmail: settings.fromEmail,
      replyBy,
      confirmedRequirementCount,
      excludedCount,
    }),
    pendingSends: lockState.pendingSends.map((p) => ({
      actionId: p.actionId,
      inquiryId: p.inquiryId,
      roundNumber: roundOf.get(p.inquiryId)?.roundNumber ?? null,
      createdAt: p.createdAt.toISOString(),
    })),
    pendingChases: chaseRows.flatMap((a) => {
      const p = a.payload as Partial<TenderSendChasePayload> | null;
      if (!p?.inquiryId || !p.inquiryItemId) return [];
      const kind = p.kind === "missing_fields" ? ("missing_fields" as const) : ("no_reply" as const);
      // 已批准、还在发出中的照常显示；待批的只列还有用的
      if (a.status === "pending" && !chaseStillNeeded(kind, chaseItemStatus.get(p.inquiryItemId) ?? "")) return [];
      return [
        {
          actionId: a.id,
          inquiryId: p.inquiryId,
          itemId: p.inquiryItemId,
          supplierName: String(p.supplierName ?? ""),
          kind,
          chaseIndex: p.chaseIndex === 2 ? 2 : 1,
          roundNumber: roundOf.get(p.inquiryId)?.roundNumber ?? null,
          createdAt: a.createdAt.toISOString(),
        },
      ];
    }),
    engineRounds,
    autoIngest: autoIngestNote({ hasReadScope, chaseAfterDays }),
    timeZone,
    ...(isRfqAutoDraftEnabledForOrg(input.orgId) ? { autoDraftedRounds: await loadAutoDraftedRounds(input.orgId, project.id) } : {}),
    followUp: await loadEntryFollowUp({
      orgId: input.orgId,
      now,
      fromName: settings.fromName,
      chaseAfterDays,
      replyBy,
      pendingActionIds: lockState.pendingSends.map((p) => p.actionId),
      inquiryIds: lockState.existing.map((r) => r.inquiryId),
    }),
  };
}

/** RFQ-AUTO-2：本项目里由系统起草的轮次（只在开关打开时调用） */
async function loadAutoDraftedRounds(orgId: string, projectId: string): Promise<Record<string, { noteZh: string }>> {
  const cards = await db.pendingAction.findMany({
    where: { orgId, projectId, type: TENDER_SEND_RFQ_TYPE, payload: { path: ["metadata", "sourceToolName"], equals: AUTO_DRAFT_TOOL_NAME } },
    select: { payload: true, preview: true },
  });
  return autoDraftedRoundNotes(cards);
}

async function loadEntryFollowUp(input: {
  orgId: string;
  now: Date;
  fromName: string;
  chaseAfterDays: number;
  replyBy: string | null;
  pendingActionIds: string[];
  inquiryIds: string[];
}): Promise<RfqEntryFollowUp | null> {
  if (!isRfqFollowUpPreapprovalEnabledForOrg(input.orgId)) return null;
  const view = (policy: Parameters<typeof followUpCardView>[0]) => followUpCardView(policy, { fromName: input.fromName, now: input.now });
  // 新建一轮会带的授权：与 prepareRfqRound 同一套入参（间隔按项目负责人偏好、截止 = 这一轮的回复截止）
  const offerPolicy = buildFollowUpPolicy({ chaseAfterDays: input.chaseAfterDays, replyBy: input.replyBy, templateHash: chaseTemplateHash() });
  const cards: RfqEntryFollowUp["cards"] = {};
  if (input.pendingActionIds.length) {
    const rows = await db.pendingAction.findMany({ where: { orgId: input.orgId, id: { in: input.pendingActionIds }, type: TENDER_SEND_RFQ_TYPE }, select: { id: true, payload: true } });
    for (const r of rows) {
      const policy = parseFollowUpPolicy((r.payload as { followUpPolicy?: unknown } | null)?.followUpPolicy);
      if (policy) cards[r.id] = view(policy);
    }
  }
  const rounds: RfqEntryFollowUp["rounds"] = {};
  for (const [inquiryId, st] of await loadRoundFollowUpStatus(input.orgId, input.inquiryIds)) {
    if (st.state === "none") continue;
    rounds[inquiryId] = { state: st.state, summaryZh: st.summaryZh, reasonZh: st.state === "inactive" ? st.reasonZh : null, autoSentCount: st.autoSentCount };
  }
  return { offer: offerPolicy ? view(offerPolicy) : null, cards, rounds };
}
