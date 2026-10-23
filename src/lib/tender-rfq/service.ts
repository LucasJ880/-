/**
 * Tender RFQ（P1-2）— 准备一轮询价 → PendingAction（tender.send_rfq）
 *
 * 流程：项目/组织 → 轮次锁 → 供应商就绪 → 已确认要求 + 关键事实 → buildRfqDocument
 *       → 创建 ProjectInquiry(draft) + items → 每家渲染邮件 → requestApproval（审批卡）
 *
 * 本函数零出站。真正发送只在 execute.ts（批准后）。
 */

import { db } from "@/lib/db";
import { requestApproval } from "@/lib/approval/request";
import { addInquiryItem, createInquiry } from "@/lib/inquiry/service";
import { buildRfqDocument, renderRfqEmail, type RfqFactInput, type RfqRequirementInput } from "./build";
import {
  decideRoundLock,
  factFromText,
  hashRfqPayloadItems,
  partitionSuppliers,
  previewRfqPayload,
  readCriticalFactSlot,
  readTenderRfqSettings,
  type ExistingRound,
} from "./round-pure";
import { TENDER_SEND_RFQ_TYPE, type TenderSendRfqPayload } from "./types";

const RFQ_FACT_TYPES = ["quantity", "delivery", "location", "warranty", "scope"] as const;

export type PrepareRfqInput = {
  projectId: string;
  orgId: string;
  userId: string;
  supplierIds?: string[];
  /** 没给 supplierIds 时按名称模糊匹配 */
  supplierHint?: string | null;
  scopeNote?: string | null;
  extraQuestions?: string[];
  incoterm?: "EXW" | "FOB" | "CIF" | "DDP" | "DAP" | null;
  destination?: string | null;
  quantityTiers?: number[];
  now?: Date;
};

export type PrepareRfqResult =
  | {
      ok: true;
      actionId: string;
      inquiryId: string;
      roundNumber: number;
      preview: string;
      replyBy: string | null;
      fromEmail: string;
      suppliers: Array<{ id: string; name: string; to: string }>;
      blockedSuppliers: Array<{ id: string; name: string; reason: "no_email" | "inactive" }>;
      excludedRequirements: number;
    }
  | {
      ok: false;
      errorCode:
        | "PROJECT_NOT_FOUND"
        | "ROUND_LOCKED"
        | "NO_SUPPLIERS"
        | "SUPPLIERS_NOT_READY"
        | "NO_CONFIRMED_REQUIREMENTS"
        | "SENSITIVE_LEAK"
        | "DRAFT_FAILED";
      message: string;
      /** NO_SUPPLIERS 时给候选，让 Muse 渲染成可选项 */
      candidates?: Array<{ id: string; name: string; contactEmail: string | null }>;
      blockedSuppliers?: Array<{ id: string; name: string; reason: "no_email" | "inactive" }>;
    };

export async function prepareRfqRound(input: PrepareRfqInput): Promise<PrepareRfqResult> {
  const now = input.now ?? new Date();

  const project = await db.project.findFirst({
    where: { id: input.projectId, orgId: input.orgId, workDomain: "tender" },
    select: { id: true, name: true, closeDate: true, org: { select: { settingsJson: true } } },
  });
  if (!project) return { ok: false, errorCode: "PROJECT_NOT_FOUND", message: "没找到这个投标项目，或它不属于你的组织。" };
  const settings = readTenderRfqSettings(project.org?.settingsJson);

  // ── 轮次锁 ──
  const rounds = await db.projectInquiry.findMany({
    where: { projectId: project.id },
    select: {
      id: true,
      roundNumber: true,
      status: true,
      createdAt: true,
      createdById: true,
      items: { select: { status: true } },
    },
  });
  const pendingSends = await db.pendingAction.findMany({
    where: { orgId: input.orgId, projectId: project.id, type: TENDER_SEND_RFQ_TYPE, status: { in: ["pending", "approved"] } },
    select: { payload: true },
  });
  const pendingInquiryIds = new Set(pendingSends.map((p) => (p.payload as { inquiryId?: string } | null)?.inquiryId).filter(Boolean));
  const creatorIds = [...new Set(rounds.map((r) => r.createdById))];
  const creators = creatorIds.length ? await db.user.findMany({ where: { id: { in: creatorIds } }, select: { id: true, name: true } }) : [];
  const nameOf = new Map(creators.map((u) => [u.id, u.name]));
  const existing: ExistingRound[] = rounds.map((r) => ({
    inquiryId: r.id,
    roundNumber: r.roundNumber,
    status: r.status,
    createdAt: r.createdAt,
    createdByName: nameOf.get(r.createdById) ?? null,
    sentCount: r.items.filter((i) => i.status !== "pending").length,
    hasPendingSend: pendingInquiryIds.has(r.id),
  }));
  const lock = decideRoundLock(existing, now, settings.roundLockDays);
  if (lock.locked) return { ok: false, errorCode: "ROUND_LOCKED", message: lock.message };

  // ── 供应商 ──
  const where = input.supplierIds?.length
    ? { orgId: input.orgId, id: { in: input.supplierIds } }
    : input.supplierHint?.trim()
      ? { orgId: input.orgId, name: { contains: input.supplierHint.trim(), mode: "insensitive" as const } }
      : null;
  if (!where) {
    const candidates = await db.supplier.findMany({
      where: { orgId: input.orgId, status: "active" },
      orderBy: { updatedAt: "desc" },
      take: 8,
      select: { id: true, name: true, contactEmail: true },
    });
    return { ok: false, errorCode: "NO_SUPPLIERS", message: "要问哪几家？", candidates };
  }
  const suppliers = await db.supplier.findMany({ where, select: { id: true, name: true, contactEmail: true, status: true } });
  const { ready, blocked } = partitionSuppliers(suppliers);
  if (ready.length === 0) {
    return {
      ok: false,
      errorCode: "SUPPLIERS_NOT_READY",
      message: blocked.length
        ? `这些供应商还发不了：${blocked.map((b) => `${b.name}（${b.reason === "no_email" ? "没有邮箱" : "已停用"}）`).join("、")}。先在青砚补上联系邮箱。`
        : "没匹配到供应商。",
      blockedSuppliers: blocked,
    };
  }

  // ── 要求 + 事实（最新非 SUPERSEDED 的 run） ──
  const run = await db.tenderAnalysisRun.findFirst({
    where: { projectId: project.id, status: { in: ["REVIEW_REQUIRED", "APPROVED"] } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      summaryJson: true,
      requirements: {
        select: { requirementCode: true, category: true, originalRequirement: true, chineseTranslation: true, mandatory: true, reviewStatus: true, sourcePage: true },
        orderBy: { requirementCode: "asc" },
      },
    },
  });
  const requirements: RfqRequirementInput[] = run?.requirements ?? [];

  const facts: RfqFactInput[] = [];
  if (run) {
    const factIds: Array<{ type: string; factId: string }> = [];
    for (const t of RFQ_FACT_TYPES) {
      const slot = readCriticalFactSlot(run.summaryJson, t);
      if (!slot) continue;
      if ("text" in slot) facts.push(factFromText(t, slot.text));
      else factIds.push({ type: t, factId: slot.factId });
    }
    if (factIds.length) {
      const rows = await db.tenderAnalysisFact.findMany({
        where: { id: { in: factIds.map((f) => f.factId) } },
        select: { id: true, contentZh: true, contentOriginal: true, confidence: true, manuallyConfirmed: true },
      });
      for (const f of factIds) {
        const r = rows.find((x) => x.id === f.factId);
        if (r) facts.push({ type: f.type, contentZh: r.contentZh, contentOriginal: r.contentOriginal, confidence: r.confidence, manuallyConfirmed: r.manuallyConfirmed });
      }
    }
  }

  const built = buildRfqDocument({
    projectName: project.name,
    buyerDisplayName: settings.fromName,
    closeDate: project.closeDate ? project.closeDate.toISOString() : null,
    now,
    requirements,
    facts,
    quantityTiers: input.quantityTiers,
    incoterm: input.incoterm ?? null,
    destination: input.destination ?? null,
    replyLeadDays: settings.replyLeadDays,
    extraQuestions: input.extraQuestions,
    scopeNote: input.scopeNote ?? null,
  });
  if (!built.ok) return { ok: false, errorCode: built.errorCode, message: built.message };
  const doc = built.doc;

  // ── 建轮次（draft，零出站） ──
  const inquiry = await createInquiry(
    { projectId: project.id, title: `第 N 轮询价（Muse）`, scope: doc.scopeNote ?? undefined, dueDate: doc.replyBy ?? undefined },
    input.userId,
  );
  const items: TenderSendRfqPayload["items"] = [];
  for (const s of ready) {
    const item = await addInquiryItem({ projectId: project.id, inquiryId: inquiry.id }, s.id, input.userId);
    const mail = renderRfqEmail(doc, { supplierName: s.name, roundNumber: inquiry.roundNumber });
    items.push({ inquiryItemId: item.id, supplierId: s.id, supplierName: s.name, to: s.contactEmail, subject: mail.subject, body: mail.body });
  }

  const payload: TenderSendRfqPayload = {
    projectId: project.id,
    inquiryId: inquiry.id,
    roundNumber: inquiry.roundNumber,
    fromName: settings.fromName,
    fromEmail: settings.fromEmail,
    items,
    rfqDocHash: hashRfqPayloadItems(items),
  };

  // 新审批一律走 canonical 入口 requestApproval（runtime-architecture 守卫禁止新代码直接调旧的草稿创建 helper）
  const approval = await requestApproval({
    orgId: input.orgId,
    principal: { userId: input.userId, actorType: "user" },
    actionType: TENDER_SEND_RFQ_TYPE,
    title: `发送第 ${inquiry.roundNumber} 轮询价给 ${items.length} 家供应商 — ${project.name}`,
    preview: previewRfqPayload(payload),
    payload: payload as unknown as Record<string, unknown>,
    // 对外发邮件：与 revenue-spine 跟进邮件同级
    risk: { vocabulary: "agent-core.tool-risk", value: "l3_strong", requiresApproval: true },
    source: { module: "tender-rfq.service", toolName: "tender_send_rfq", stepKey: `rfq:${inquiry.id}` },
    business: { projectId: project.id },
    ttlHours: 72,
    idempotencyKey: `${TENDER_SEND_RFQ_TYPE}:${inquiry.id}`,
  });
  if (!approval.ok) {
    return { ok: false, errorCode: "DRAFT_FAILED", message: `生成审批草稿失败：${approval.error}` };
  }
  const actionId = approval.actionIds[0] ?? "";

  return {
    ok: true,
    actionId,
    inquiryId: inquiry.id,
    roundNumber: inquiry.roundNumber,
    preview: payload.items.map((i) => `${i.supplierName} <${i.to}>`).join("、"),
    replyBy: doc.replyBy,
    fromEmail: settings.fromEmail,
    suppliers: items.map((i) => ({ id: i.supplierId, name: i.supplierName, to: i.to })),
    blockedSuppliers: blocked,
    excludedRequirements: doc.excluded.length,
  };
}
