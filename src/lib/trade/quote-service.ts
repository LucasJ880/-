/**
 * Trade 外贸获客 — 报价单服务层
 */

import { db } from "@/lib/db";
import { stageAfterQuoteCreated } from "@/lib/trade/stage";

// ── Quote Number Generator ──────────────────────────────────

async function generateQuoteNumber(): Promise<string> {
  const now = new Date();
  const prefix = `TQ${now.getFullYear().toString().slice(-2)}${String(now.getMonth() + 1).padStart(2, "0")}`;
  const count = await db.tradeQuote.count({
    where: { quoteNumber: { startsWith: prefix } },
  });
  return `${prefix}-${String(count + 1).padStart(4, "0")}`;
}

// ── CRUD ────────────────────────────────────────────────────

export interface CreateQuoteInput {
  orgId: string;
  prospectId?: string;
  campaignId?: string;
  companyName: string;
  contactName?: string;
  contactEmail?: string;
  country?: string;
  currency?: string;
  incoterm?: string;
  paymentTerms?: string;
  validDays?: number;
  leadTimeDays?: number;
  moq?: string;
  shippingPort?: string;
  notes?: string;
  internalNotes?: string;
  items?: {
    productName: string;
    specification?: string;
    unit?: string;
    quantity: number;
    unitPrice: number;
    remarks?: string;
  }[];
}

export async function createQuote(input: CreateQuoteInput, userId: string) {
  const quoteNumber = await generateQuoteNumber();

  const items = (input.items ?? []).map((item, i) => ({
    sortOrder: i,
    productName: item.productName,
    specification: item.specification,
    unit: item.unit ?? "pcs",
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    totalPrice: item.quantity * item.unitPrice,
    remarks: item.remarks,
  }));

  const subtotal = items.reduce((s, i) => s + i.totalPrice, 0);

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + (input.validDays ?? 30));

  const quote = await db.tradeQuote.create({
    data: {
      orgId: input.orgId,
      prospectId: input.prospectId,
      campaignId: input.campaignId,
      quoteNumber,
      companyName: input.companyName,
      contactName: input.contactName,
      contactEmail: input.contactEmail,
      country: input.country,
      currency: input.currency ?? "USD",
      incoterm: input.incoterm ?? "FOB",
      paymentTerms: input.paymentTerms,
      validDays: input.validDays ?? 30,
      leadTimeDays: input.leadTimeDays,
      moq: input.moq,
      shippingPort: input.shippingPort,
      subtotal,
      totalAmount: subtotal,
      notes: input.notes,
      internalNotes: input.internalNotes,
      expiresAt,
      createdById: userId,
      items: { create: items },
    },
    include: { items: true },
  });

  if (input.prospectId) {
    const p = await db.tradeProspect.findUnique({
      where: { id: input.prospectId },
      select: { stage: true },
    });
    if (p) {
      await db.tradeProspect.update({
        where: { id: input.prospectId },
        data: { stage: stageAfterQuoteCreated(p.stage) },
      });
    }
  }

  return quote;
}

export async function listQuotes(orgId: string, opts?: { status?: string; prospectId?: string }) {
  return db.tradeQuote.findMany({
    where: {
      orgId,
      ...(opts?.status ? { status: opts.status } : {}),
      ...(opts?.prospectId ? { prospectId: opts.prospectId } : {}),
    },
    orderBy: { createdAt: "desc" },
    include: { items: true, prospect: { select: { companyName: true, stage: true } } },
  });
}

export async function getQuote(id: string) {
  return db.tradeQuote.findUnique({
    where: { id },
    include: { items: { orderBy: { sortOrder: "asc" } }, prospect: true },
  });
}

export async function updateQuote(
  id: string,
  data: Partial<Pick<CreateQuoteInput, "currency" | "incoterm" | "paymentTerms" | "validDays" | "leadTimeDays" | "moq" | "shippingPort" | "notes" | "internalNotes">> & {
    status?: string;
    discount?: number;
    shippingCost?: number;
  },
) {
  return db.tradeQuote.update({ where: { id }, data });
}

export async function recalcQuote(id: string) {
  const quote = await db.tradeQuote.findUnique({
    where: { id },
    include: { items: true },
  });
  if (!quote) return null;

  const subtotal = quote.items.reduce((s, i) => s + i.totalPrice, 0);
  const totalAmount = subtotal - quote.discount + quote.shippingCost;

  return db.tradeQuote.update({
    where: { id },
    data: { subtotal, totalAmount },
  });
}

export async function addQuoteItem(quoteId: string, item: {
  productName: string;
  specification?: string;
  unit?: string;
  quantity: number;
  unitPrice: number;
  remarks?: string;
}) {
  const maxSort = await db.tradeQuoteItem.aggregate({
    where: { quoteId },
    _max: { sortOrder: true },
  });

  const created = await db.tradeQuoteItem.create({
    data: {
      quoteId,
      sortOrder: (maxSort._max.sortOrder ?? 0) + 1,
      productName: item.productName,
      specification: item.specification,
      unit: item.unit ?? "pcs",
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      totalPrice: item.quantity * item.unitPrice,
      remarks: item.remarks,
    },
  });

  await recalcQuote(quoteId);
  return created;
}

export async function removeQuoteItem(itemId: string) {
  const item = await db.tradeQuoteItem.findUnique({ where: { id: itemId } });
  if (!item) return;
  await db.tradeQuoteItem.delete({ where: { id: itemId } });
  await recalcQuote(item.quoteId);
}

export async function deleteQuote(id: string) {
  return db.tradeQuote.delete({ where: { id } });
}
