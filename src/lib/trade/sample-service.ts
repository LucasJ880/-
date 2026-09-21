import { db } from "@/lib/db";
import { logActivity } from "@/lib/trade/activity-log";
import { loadTradeProductForOrg } from "@/lib/trade/product-match";
import { addBusinessDays } from "@/lib/revenue-spine/business-days";
import {
  SAMPLE_FOLLOW_UP_BUSINESS_DAYS,
  canTransitionSample,
  isSampleWaitingReply,
  isTradeSampleStatus,
  type TradeSampleStatus,
} from "@/lib/trade/sample-constants";

export type TradeSampleListItem = {
  id: string;
  productName: string;
  followUpDueAt: Date | null;
  waitingReply: boolean;
  overdue: boolean;
};

async function lastInboundByProspect(prospectIds: string[]) {
  const ids = [...new Set(prospectIds.filter(Boolean))];
  if (ids.length === 0) return new Map<string, Date>();
  const rows = await db.tradeMessage.groupBy({
    by: ["prospectId"],
    where: { prospectId: { in: ids }, direction: "inbound" },
    _max: { createdAt: true },
  });
  const out = new Map<string, Date>();
  for (const row of rows) {
    if (row._max.createdAt) out.set(row.prospectId, row._max.createdAt);
  }
  return out;
}

function annotateSample<T extends { status: string; shippedAt: Date | null; followedUpAt: Date | null; followUpDueAt: Date | null; prospectId: string | null }>(
  row: T,
  lastInbound: Date | null,
  now = new Date(),
) {
  const waitingReply = isSampleWaitingReply({
    status: row.status,
    shippedAt: row.shippedAt,
    followedUpAt: row.followedUpAt,
    lastInboundAt: lastInbound,
  });
  const overdue =
    waitingReply && row.followUpDueAt != null && row.followUpDueAt.getTime() <= now.getTime();
  return { ...row, waitingReply, overdue };
}

export async function listTradeSamples(
  orgId: string,
  opts?: { status?: string; prospectId?: string; waiting?: boolean },
) {
  const rows = await db.tradeSample.findMany({
    where: {
      orgId,
      ...(opts?.status ? { status: opts.status } : {}),
      ...(opts?.prospectId ? { prospectId: opts.prospectId } : {}),
      ...(opts?.waiting ? { status: "shipped", followedUpAt: null } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  const inbound = await lastInboundByProspect(rows.map((r) => r.prospectId ?? ""));
  const now = new Date();
  const items = rows.map((row) =>
    annotateSample(row, row.prospectId ? inbound.get(row.prospectId) ?? null : null, now),
  );
  return opts?.waiting ? items.filter((row) => row.waitingReply) : items;
}

export async function getTradeSampleForOrg(orgId: string, sampleId: string) {
  const row = await db.tradeSample.findFirst({ where: { id: sampleId, orgId } });
  if (!row) return null;
  const inbound = row.prospectId
    ? (await lastInboundByProspect([row.prospectId])).get(row.prospectId) ?? null
    : null;
  return annotateSample(row, inbound);
}

export async function createTradeSample(input: {
  orgId: string;
  userId: string;
  prospectId?: string;
  quoteId?: string;
  productId?: string;
  sku?: string;
  productName: string;
  quantity?: number;
  unit?: string;
  destination?: string;
  recipientName?: string;
  recipientEmail?: string;
  address?: string;
  notes?: string;
}) {
  let sku = input.sku?.trim() || null;
  let productName = input.productName.trim();
  let productId = input.productId?.trim() || null;
  if (productId) {
    const product = await loadTradeProductForOrg(productId, input.orgId);
    if (!product) return { ok: false as const, error: "货号不存在或不属于当前组织", status: 403 };
    productId = product.id;
    sku = product.sku;
    if (!productName) productName = product.nameEn || product.name;
  }
  if (!productName) return { ok: false as const, error: "产品名称必填", status: 400 };

  const row = await db.tradeSample.create({
    data: {
      orgId: input.orgId,
      prospectId: input.prospectId,
      quoteId: input.quoteId,
      productId,
      sku,
      productName: productName.slice(0, 240),
      quantity: input.quantity && input.quantity > 0 ? input.quantity : 1,
      unit: input.unit?.trim() || "pcs",
      destination: input.destination?.trim() || null,
      recipientName: input.recipientName?.trim() || null,
      recipientEmail: input.recipientEmail?.trim() || null,
      address: input.address?.trim() || null,
      notes: input.notes?.trim() || null,
      createdById: input.userId,
    },
  });

  await logActivity({
    orgId: input.orgId,
    prospectId: input.prospectId,
    action: "sample_create",
    detail: `寄样 ${row.productName} × ${row.quantity}`,
    meta: { sampleId: row.id },
  });

  return { ok: true as const, sample: row };
}

export async function updateTradeSampleStatus(input: {
  orgId: string;
  sampleId: string;
  status: string;
  trackingNo?: string;
  notes?: string;
}) {
  if (!isTradeSampleStatus(input.status)) {
    return { ok: false as const, error: "状态无效", status: 400 };
  }
  const row = await db.tradeSample.findFirst({
    where: { id: input.sampleId, orgId: input.orgId },
  });
  if (!row) return { ok: false as const, error: "寄样单不存在", status: 404 };
  if (!canTransitionSample(row.status as TradeSampleStatus, input.status)) {
    return { ok: false as const, error: "不允许该状态变更", status: 400 };
  }

  const becomingShipped = input.status === "shipped" && row.status !== "shipped";
  const shippedAt = becomingShipped ? new Date() : row.shippedAt;
  const followUpDueAt = becomingShipped
    ? addBusinessDays(shippedAt ?? new Date(), SAMPLE_FOLLOW_UP_BUSINESS_DAYS)
    : row.followUpDueAt;

  const updated = await db.tradeSample.update({
    where: { id: row.id },
    data: {
      status: input.status,
      trackingNo: input.trackingNo?.trim() || row.trackingNo,
      notes: input.notes?.trim() || row.notes,
      shippedAt,
      followUpDueAt,
    },
  });

  if (becomingShipped && row.prospectId) {
    await db.tradeProspect.update({
      where: { id: row.prospectId },
      data: { nextFollowUpAt: followUpDueAt },
    });
  }

  await logActivity({
    orgId: input.orgId,
    prospectId: row.prospectId ?? undefined,
    action: "sample_status",
    detail: `寄样 ${row.productName} → ${input.status}`,
    meta: { sampleId: row.id, status: input.status },
  });

  return { ok: true as const, sample: updated };
}

export async function markSampleFollowedUp(input: {
  orgId: string;
  sampleId: string;
  notes?: string;
}) {
  const row = await db.tradeSample.findFirst({
    where: { id: input.sampleId, orgId: input.orgId },
  });
  if (!row) return { ok: false as const, error: "寄样单不存在", status: 404 };
  if (row.status !== "shipped") {
    return { ok: false as const, error: "只有已寄出的寄样才能标记已跟进", status: 400 };
  }

  const now = new Date();
  const note = input.notes?.trim();
  const updated = await db.tradeSample.update({
    where: { id: row.id },
    data: {
      followedUpAt: now,
      notes: note ? [row.notes, note].filter(Boolean).join("\n") : row.notes,
    },
  });

  if (row.prospectId) {
    const others = await db.tradeSample.findMany({
      where: {
        orgId: input.orgId,
        prospectId: row.prospectId,
        status: "shipped",
        followedUpAt: null,
        id: { not: row.id },
      },
      select: { followUpDueAt: true },
    });
    const nextDue =
      others
        .map((s) => s.followUpDueAt)
        .filter((d): d is Date => d != null)
        .sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
    await db.tradeProspect.update({
      where: { id: row.prospectId },
      data: { lastContactAt: now, nextFollowUpAt: nextDue },
    });
  }

  await logActivity({
    orgId: input.orgId,
    prospectId: row.prospectId ?? undefined,
    action: "sample_followed_up",
    detail: `寄样 ${row.productName} 已跟进（不自动发信）`,
    meta: { sampleId: row.id },
  });

  return { ok: true as const, sample: updated };
}

export async function loadWaitingSamplesForProspects(orgId: string, prospectIds: string[]) {
  const ids = [...new Set(prospectIds.filter(Boolean))];
  if (ids.length === 0) return new Map<string, TradeSampleListItem>();
  const rows = await db.tradeSample.findMany({
    where: { orgId, prospectId: { in: ids }, status: "shipped", followedUpAt: null },
    orderBy: { shippedAt: "desc" },
  });
  const inbound = await lastInboundByProspect(ids);
  const now = new Date();
  const out = new Map<string, TradeSampleListItem>();
  for (const row of rows) {
    if (!row.prospectId || out.has(row.prospectId)) continue;
    const annotated = annotateSample(row, inbound.get(row.prospectId) ?? null, now);
    if (annotated.waitingReply) out.set(row.prospectId, annotated);
  }
  return out;
}
