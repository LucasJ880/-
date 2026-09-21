import { db } from "@/lib/db";
import { logActivity } from "@/lib/trade/activity-log";
import { loadTradeProductForOrg } from "@/lib/trade/product-match";
import {
  canTransitionSample,
  isTradeSampleStatus,
  type TradeSampleStatus,
} from "@/lib/trade/sample-constants";

export async function listTradeSamples(orgId: string, opts?: { status?: string; prospectId?: string }) {
  return db.tradeSample.findMany({
    where: {
      orgId,
      ...(opts?.status ? { status: opts.status } : {}),
      ...(opts?.prospectId ? { prospectId: opts.prospectId } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
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

  const updated = await db.tradeSample.update({
    where: { id: row.id },
    data: {
      status: input.status,
      trackingNo: input.trackingNo?.trim() || row.trackingNo,
      notes: input.notes?.trim() || row.notes,
      shippedAt: input.status === "shipped" ? new Date() : row.shippedAt,
    },
  });

  await logActivity({
    orgId: input.orgId,
    prospectId: row.prospectId ?? undefined,
    action: "sample_status",
    detail: `寄样 ${row.productName} → ${input.status}`,
    meta: { sampleId: row.id, status: input.status },
  });

  return { ok: true as const, sample: updated };
}
