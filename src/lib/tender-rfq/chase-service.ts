/**
 * Tender RFQ（P1-7）— 催单 / 缺字段追问：扫描 + 起草 tender.send_chase 审批卡（DB 侧）
 *
 *   runChaseScan(orgId)：挂在 tender-rfq-inbound 每次 tick 的末尾（先收信，再判断谁该催），不新增 cron；
 *   draftChasesForProject：Muse `chase` 意图手动起草（不看天数，其它规则一样）。
 *
 * 本文件零出站：只建审批卡、只对 no_response 做状态迁移。真正发信只在 chase-execute.ts（批准后）。
 * 一个 item 一张卡——审批人可以只催其中一家。
 */

import { db } from "@/lib/db";
import { requestApproval } from "@/lib/approval/request";
import { markItemNoResponse } from "@/lib/inquiry/service";
import { readUserPrefs } from "@/lib/muse-bridge/prefs-pure";
import { parseRfqThreadId } from "./inbound-contract";
import {
  CHASE_TTL_HOURS,
  buildChasePayload,
  chaseTitle,
  decideChases,
  parseChaseNotes,
  previewChasePayload,
  resolveChaseAfterDays,
  type ChaseCardState,
  type ChaseDecision,
  type ChaseItemSnapshot,
  type ChaseKind,
  type ChaseSkipReason,
} from "./chase-pure";
import { readTenderRfqSettings } from "./round-pure";
import { TENDER_SEND_CHASE_TYPE, TENDER_SEND_RFQ_TYPE } from "./types";

/** 与入站同一窗口：只看最近 90 天发出的询价 */
const OPEN_ITEM_WINDOW_DAYS = 90;

export type ChaseDraftResult = { itemId: string; supplierName: string; actionId: string; kind: ChaseKind; chaseIndex: 1 | 2 };
export type ChaseRunResult = {
  drafted: ChaseDraftResult[];
  noResponse: Array<{ itemId: string; supplierName: string }>;
  skipped: Array<{ itemId: string; supplierName: string; reason: ChaseSkipReason }>;
  failed: Array<{ itemId: string; supplierName: string; error: string }>;
};

const emptyRun = (): ChaseRunResult => ({ drafted: [], noResponse: [], skipped: [], failed: [] });

type LoadedItem = {
  snapshot: ChaseItemSnapshot;
  supplierEmail: string | null;
  inquiryId: string;
  roundDueDate: Date | null;
  projectName: string;
  ownerId: string;
};

async function loadItems(where: { orgId: string; projectId?: string; inquiryId?: string; itemIds?: string[] }, now: Date): Promise<LoadedItem[]> {
  const rows = await db.inquiryItem.findMany({
    where: {
      ...(where.itemIds ? { id: { in: where.itemIds } } : {}),
      status: { in: ["sent", "replied", "quoted"] },
      sentAt: { gte: new Date(now.getTime() - OPEN_ITEM_WINDOW_DAYS * 86_400_000) },
      inquiry: {
        ...(where.inquiryId ? { id: where.inquiryId } : {}),
        project: { orgId: where.orgId, ...(where.projectId ? { id: where.projectId } : {}) },
      },
    },
    select: {
      id: true,
      status: true,
      sentAt: true,
      unitPrice: true,
      totalPrice: true,
      deliveryDays: true,
      validUntil: true,
      quoteNotes: true,
      contactNotes: true,
      updatedAt: true,
      supplier: { select: { name: true, contactEmail: true } },
      inquiry: { select: { id: true, dueDate: true, projectId: true, project: { select: { name: true, ownerId: true } } } },
    },
  });
  if (rows.length === 0) return [];

  const actions = await db.pendingAction.findMany({
    where: { orgId: where.orgId, type: TENDER_SEND_CHASE_TYPE, OR: rows.map((r) => ({ idempotencyKey: { startsWith: `${TENDER_SEND_CHASE_TYPE}:${r.id}:` } })) },
    select: { idempotencyKey: true, status: true, expiresAt: true },
  });
  const cards: ChaseCardState[] = actions
    .filter((a): a is typeof a & { idempotencyKey: string } => !!a.idempotencyKey)
    .map((a) => ({
      slot: a.idempotencyKey.replace(/:r\d+$/, ""),
      state:
        a.status === "approved" || (a.status === "pending" && a.expiresAt.getTime() > now.getTime())
          ? "live"
          : a.status === "rejected"
            ? "rejected"
            : "dead",
    }));

  return rows.map((r) => ({
    snapshot: {
      itemId: r.id,
      inquiryId: r.inquiry.id,
      projectId: r.inquiry.projectId,
      supplierName: r.supplier?.name ?? "供应商",
      status: r.status,
      sentAt: r.sentAt,
      threadId: parseRfqThreadId(r.contactNotes),
      chases: parseChaseNotes(r.contactNotes),
      cards: cards.filter((c) => c.slot.startsWith(`${TENDER_SEND_CHASE_TYPE}:${r.id}:`)),
      quote: { unitPrice: r.unitPrice, totalPrice: r.totalPrice, deliveryDays: r.deliveryDays, validUntil: r.validUntil, quoteNotes: r.quoteNotes, updatedAt: r.updatedAt },
    },
    supplierEmail: r.supplier?.contactEmail ?? null,
    inquiryId: r.inquiry.id,
    roundDueDate: r.inquiry.dueDate,
    projectName: r.inquiry.project.name,
    ownerId: r.inquiry.project.ownerId,
  }));
}

/** 原询价那封邮件的主题与收件地址（tender.send_rfq payload 里——发出去的就是事实来源） */
async function loadRfqMail(inquiryId: string): Promise<Map<string, { subject: string; to: string }>> {
  const pa = await db.pendingAction.findFirst({
    where: { type: TENDER_SEND_RFQ_TYPE, payload: { path: ["inquiryId"], equals: inquiryId } },
    orderBy: { createdAt: "desc" },
    select: { payload: true },
  });
  const items = (pa?.payload as { items?: Array<{ inquiryItemId?: string; subject?: string; to?: string }> } | null)?.items ?? [];
  return new Map(items.filter((i) => i.inquiryItemId).map((i) => [i.inquiryItemId as string, { subject: i.subject ?? "", to: i.to ?? "" }]));
}

const ymd = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/**
 * 按轮次分组决策 → 起草 / 标 no_response。
 * principalUserId：手动 = 发起人；扫描 = 项目 owner（催单天数也按 owner 的偏好）。
 */
async function runForItems(
  orgId: string,
  items: LoadedItem[],
  now: Date,
  opts: { manual: boolean; principalUserId?: string; onNoResponse?: (itemId: string, reason: "two_chases" | "deadline") => Promise<void> },
): Promise<ChaseRunResult> {
  const out = emptyRun();
  if (items.length === 0) return out;
  const org = await db.organization.findUnique({ where: { id: orgId }, select: { settingsJson: true } });
  const settings = readTenderRfqSettings(org?.settingsJson);

  const byRound = new Map<string, LoadedItem[]>();
  for (const it of items) byRound.set(it.inquiryId, [...(byRound.get(it.inquiryId) ?? []), it]);

  for (const [inquiryId, roundItems] of byRound) {
    const owner = roundItems[0].ownerId;
    const days = resolveChaseAfterDays(readUserPrefs(org?.settingsJson, owner).chaseAfterDays, org?.settingsJson);
    const replyBy = roundItems[0].roundDueDate;
    const decision: ChaseDecision = decideChases({ now, chaseAfterDays: days, replyBy, items: roundItems.map((i) => i.snapshot) }, { manual: opts.manual });
    const nameOf = (id: string) => roundItems.find((i) => i.snapshot.itemId === id)?.snapshot.supplierName ?? "供应商";

    for (const s of decision.skipped) out.skipped.push({ ...s, supplierName: nameOf(s.itemId) });

    for (const itemId of decision.noResponse) {
      const it = roundItems.find((i) => i.snapshot.itemId === itemId)!;
      try {
        await markItemNoResponse({ projectId: it.snapshot.projectId, inquiryId, itemId });
        out.noResponse.push({ itemId, supplierName: it.snapshot.supplierName });
        const twoChases = it.snapshot.chases.filter((c) => c.kind === "no_reply").length >= 2;
        await opts.onNoResponse?.(itemId, twoChases ? "two_chases" : "deadline");
      } catch (err) {
        out.failed.push({ itemId, supplierName: it.snapshot.supplierName, error: err instanceof Error ? err.message : String(err) });
      }
    }

    if (decision.drafts.length === 0) continue;
    const mails = await loadRfqMail(inquiryId);
    for (const plan of decision.drafts) {
      const it = roundItems.find((i) => i.snapshot.itemId === plan.itemId)!;
      const mail = mails.get(plan.itemId);
      const to = mail?.to || it.supplierEmail || "";
      if (!to) {
        out.failed.push({ itemId: plan.itemId, supplierName: it.snapshot.supplierName, error: "没有供应商邮箱" });
        continue;
      }
      const built = buildChasePayload({
        plan,
        projectId: it.snapshot.projectId,
        inquiryId,
        supplierName: it.snapshot.supplierName,
        to,
        threadId: it.snapshot.threadId!,
        originalSubject: mail?.subject || `询价：${it.projectName}`,
        sentAt: it.snapshot.sentAt,
        replyBy: ymd(it.roundDueDate),
        fromName: settings.fromName,
        fromEmail: settings.fromEmail,
      });
      if (!built.ok) {
        out.failed.push({ itemId: plan.itemId, supplierName: it.snapshot.supplierName, error: built.message });
        continue;
      }
      const approval = await requestApproval({
        orgId,
        principal: { userId: opts.principalUserId ?? owner, actorType: opts.manual ? "user" : "agent" },
        actionType: TENDER_SEND_CHASE_TYPE,
        title: chaseTitle(built.payload, plan.missingFields, it.projectName),
        preview: previewChasePayload(built.payload),
        payload: built.payload as unknown as Record<string, unknown>,
        // 对外发邮件：与询价发送同级
        risk: { vocabulary: "agent-core.tool-risk", value: "l3_strong", requiresApproval: true },
        source: { module: "tender-rfq.chase-service", toolName: "tender_send_chase", stepKey: plan.idempotencyKey },
        business: { projectId: it.snapshot.projectId },
        ttlHours: CHASE_TTL_HOURS,
        idempotencyKey: plan.idempotencyKey,
      });
      if (!approval.ok) {
        out.failed.push({ itemId: plan.itemId, supplierName: it.snapshot.supplierName, error: approval.error });
        continue;
      }
      out.drafted.push({ itemId: plan.itemId, supplierName: it.snapshot.supplierName, actionId: approval.actionIds[0] ?? "", kind: plan.kind, chaseIndex: plan.chaseIndex });
    }
  }
  return out;
}

async function emitNoResponse(itemId: string, reason: "two_chases" | "deadline"): Promise<void> {
  const { museOnNoResponse } = await import("@/lib/muse-bridge/hooks");
  await museOnNoResponse(itemId, reason);
}

/** cron：入站 tick 末尾调用（同一次 tick，先收信再判断谁该催） */
export async function runChaseScan(orgId: string, now: Date = new Date()): Promise<ChaseRunResult> {
  const items = await loadItems({ orgId }, now);
  return runForItems(orgId, items, now, { manual: false, onNoResponse: emitNoResponse });
}

/** Muse `chase` 意图：立即为指定项目 / 轮次 / item 起草（不看天数；不标 no_response） */
export async function draftChasesForProject(input: {
  orgId: string;
  userId: string;
  projectId: string;
  inquiryId?: string;
  itemIds?: string[];
  now?: Date;
}): Promise<{ ok: true; run: ChaseRunResult } | { ok: false; errorCode: "PROJECT_NOT_FOUND" | "NO_ROUND"; message: string }> {
  const now = input.now ?? new Date();
  const project = await db.project.findFirst({ where: { id: input.projectId, orgId: input.orgId, workDomain: "tender" }, select: { id: true } });
  if (!project) return { ok: false, errorCode: "PROJECT_NOT_FOUND", message: "没找到这个投标项目，或它不属于你的组织。" };
  // 不指定轮次 → 最新一轮
  const inquiryId =
    input.inquiryId ??
    (await db.projectInquiry.findFirst({ where: { projectId: project.id }, orderBy: { roundNumber: "desc" }, select: { id: true } }))?.id;
  if (!inquiryId) return { ok: false, errorCode: "NO_ROUND", message: "这个标还没有询价轮次，没有可催的供应商。" };
  const items = await loadItems({ orgId: input.orgId, projectId: project.id, inquiryId, itemIds: input.itemIds }, now);
  const run = await runForItems(input.orgId, items, now, { manual: true, principalUserId: input.userId });
  return { ok: true, run };
}
