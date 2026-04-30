/**
 * TradeQuote → SalesQuote 人工转换（预览 + 执行）
 *
 * - 不自动转换、不同步；仅 API + 显式按钮触发。
 * - TradeQuoteItem 与 SalesQuoteItem（窗饰尺寸结构）不兼容：明细写入 formDataJson + notes，不创建 SalesQuoteItem。
 */

import { randomBytes } from "crypto";
import { NextResponse } from "next/server";
import type { SalesCustomer, TradeProspect, TradeQuote } from "@prisma/client";
import { db } from "@/lib/db";
import {
  assertSalesCustomerInOrgForMutation,
  assertSalesCustomerInOrgOrThrowForConvert,
  getActiveOrgMemberUserIds,
} from "@/lib/sales/org-context";
import { loadTradeQuoteForOrg } from "@/lib/trade/access";
import { normalizeTradeProspectStage } from "@/lib/trade/stage";

const FORM_JSON_VERSION = 1 as const;

export type TradeQuoteSalesConversionPreviewDto = {
  tradeQuote: {
    id: string;
    quoteNumber: string;
    status: string;
    currency: string;
    subtotal: number;
    discount: number;
    shippingCost: number;
    totalAmount: number;
    companyName: string;
    prospectId: string | null;
  };
  prospect: {
    id: string;
    companyName: string;
    stage: string;
    stageNormalized: string;
    convertedToSalesCustomerId: string | null;
    convertedToSalesOpportunityId: string | null;
    convertedAt: string | null;
  } | null;
  targetCustomer: { id: string; name: string; email: string | null; orgId: string | null } | null;
  targetOpportunity: { id: string; title: string; stage: string; orgId: string | null } | null;
  proposedSalesQuote: {
    status: string;
    currency: string;
    grandTotal: number;
    merchSubtotal: number;
    deliveryFee: number;
    preTaxTotal: number;
    taxAmount: number;
    notesPreview: string;
  };
  proposedItems: Array<{
    tradeLineId: string;
    productName: string;
    specification: string | null;
    unit: string;
    quantity: number;
    unitPrice: number;
    totalPrice: number;
    remarks: string | null;
  }>;
  warnings: string[];
  alreadyConverted: boolean;
  existingSalesQuoteId: string | null;
  canConvert: boolean;
};

export type ConvertTradeQuoteToSalesQuoteBody = {
  orgId?: string;
  includeItems?: boolean;
  attachToOpportunity?: boolean;
};

export function mapTradeQuoteStatusToSalesQuoteStatus(tradeStatus: string): string {
  const s = tradeStatus.trim().toLowerCase();
  const map: Record<string, string> = {
    draft: "draft",
    sent: "sent",
    negotiating: "viewed",
    accepted: "accepted",
    rejected: "rejected",
    expired: "expired",
  };
  return map[s] ?? "draft";
}

function buildImportedFormDataJson(params: {
  tradeQuote: Pick<TradeQuote, "id" | "quoteNumber">;
  items: Array<{
    id: string;
    productName: string;
    specification: string | null;
    unit: string;
    quantity: number;
    unitPrice: number;
    totalPrice: number;
    remarks: string | null;
    sortOrder: number;
  }>;
  includeItems: boolean;
}): string {
  const payload = {
    tradeQuoteShellImport: true,
    v: FORM_JSON_VERSION,
    tradeQuoteId: params.tradeQuote.id,
    tradeQuoteNumber: params.tradeQuote.quoteNumber,
    importedAt: new Date().toISOString(),
    lineCount: params.items.length,
    importedLines: params.includeItems
      ? params.items.map((it) => ({
          tradeLineId: it.id,
          productName: it.productName,
          specification: it.specification,
          unit: it.unit,
          quantity: it.quantity,
          unitPrice: it.unitPrice,
          totalPrice: it.totalPrice,
          remarks: it.remarks,
          sortOrder: it.sortOrder,
        }))
      : [],
  };
  return JSON.stringify(payload);
}

function buildConversionNotes(tradeQuote: TradeQuote): string {
  const header = `[TradeQuote import] ${tradeQuote.quoteNumber} (id=${tradeQuote.id}) @ ${new Date().toISOString()}`;
  const tradeNotes = tradeQuote.notes?.trim();
  return [header, tradeNotes ? `--- 外贸备注 ---\n${tradeNotes}` : null].filter(Boolean).join("\n\n");
}

async function assertSalesOpportunityInOrgForTradeConvert(
  opportunityId: string,
  customerId: string,
  orgId: string,
): Promise<NextResponse | null> {
  const opp = await db.salesOpportunity.findFirst({
    where: { id: opportunityId, customerId },
    select: { id: true, orgId: true, customerId: true, createdById: true },
  });
  if (!opp) {
    return NextResponse.json({ error: "商机不存在或不属于该客户" }, { status: 404 });
  }
  if (opp.orgId) {
    if (opp.orgId !== orgId) {
      return NextResponse.json({ error: "商机不属于当前组织" }, { status: 403 });
    }
    return null;
  }
  // TODO remove legacy membership fallback after sales orgId backfill.
  const memberIds = await getActiveOrgMemberUserIds(orgId);
  if (!new Set(memberIds).has(opp.createdById)) {
    return NextResponse.json({ error: "商机不属于当前组织" }, { status: 403 });
  }
  return null;
}

async function ensureUserInOrg(userId: string, orgId: string): Promise<NextResponse | null> {
  const memberIds = await getActiveOrgMemberUserIds(orgId);
  if (!new Set(memberIds).has(userId)) {
    return NextResponse.json({ error: "当前用户不是该组织成员，无法执行转换" }, { status: 403 });
  }
  return null;
}

export async function buildTradeQuoteToSalesQuotePreview(params: {
  orgId: string;
  tradeQuoteId: string;
}): Promise<NextResponse | TradeQuoteSalesConversionPreviewDto> {
  const loaded = await loadTradeQuoteForOrg(params.tradeQuoteId, params.orgId);
  if (loaded instanceof NextResponse) return loaded;

  const { quote } = loaded;
  const warnings: string[] = [];
  let canConvert = true;

  const existingSq = await db.salesQuote.findFirst({
    where: { sourceTradeQuoteId: quote.id },
    select: { id: true },
  });
  if (existingSq) {
    warnings.push(`该外贸报价已对应销售报价 ${existingSq.id}，不能重复转换。`);
    canConvert = false;
  }

  if (!quote.prospectId || !quote.prospect) {
    warnings.push("该报价单未关联外贸线索，无法转入销售报价。");
    canConvert = false;
  }

  const prospect = quote.prospect as TradeProspect | null | undefined;
  const stageN = prospect ? normalizeTradeProspectStage(prospect.stage) : "";
  const prospectConverted =
    !!prospect &&
    stageN === "converted" &&
    !!prospect.convertedToSalesCustomerId;

  if (prospect && !prospectConverted) {
    warnings.push("请先将该线索转入 Sales CRM，再转换报价。");
    canConvert = false;
  }

  let targetCustomer: TradeQuoteSalesConversionPreviewDto["targetCustomer"] = null;
  let targetOpportunity: TradeQuoteSalesConversionPreviewDto["targetOpportunity"] = null;

  if (prospectConverted && prospect?.convertedToSalesCustomerId) {
    const cust = await db.salesCustomer.findFirst({
      where: { id: prospect.convertedToSalesCustomerId, archivedAt: null },
      select: { id: true, name: true, email: true, orgId: true, createdById: true },
    });
    if (!cust) {
      warnings.push("线索记录的销售客户 ID 在 CRM 中不存在或已归档。");
      canConvert = false;
    } else {
      const denied = await assertSalesCustomerInOrgForMutation(
        cust as Pick<SalesCustomer, "orgId" | "createdById">,
        params.orgId,
      );
      if (denied) {
        return denied;
      }
      targetCustomer = { id: cust.id, name: cust.name, email: cust.email, orgId: cust.orgId };
      if (!cust.orgId) {
        // TODO remove after sales orgId backfill — 已通过 active 成员兜底校验
        warnings.push("目标销售客户 orgId 仍为空，依赖 legacy 成员关系校验；建议在回填后补齐 orgId。");
      }
    }

    if (prospect.convertedToSalesOpportunityId && targetCustomer) {
      const opp = await db.salesOpportunity.findFirst({
        where: {
          id: prospect.convertedToSalesOpportunityId,
          customerId: prospect.convertedToSalesCustomerId,
        },
        select: { id: true, title: true, stage: true, orgId: true, createdById: true },
      });
      if (!opp) {
        warnings.push("线索记录的销售商机 ID 无效或与该客户不匹配。");
        canConvert = false;
      } else {
        const od = await assertSalesOpportunityInOrgForTradeConvert(
          opp.id,
          prospect.convertedToSalesCustomerId!,
          params.orgId,
        );
        if (od) return od;
        targetOpportunity = { id: opp.id, title: opp.title, stage: opp.stage, orgId: opp.orgId };
        if (!opp.orgId) {
          warnings.push("目标商机 orgId 仍为空，依赖 legacy 成员关系校验。");
        }
      }
    }
  }

  if (quote.items?.length) {
    warnings.push(
      "外贸报价行与销售窗饰报价行结构不同：明细将写入 formDataJson（不生成 SalesQuoteItem 数据库行）。",
    );
  }

  const mappedStatus = mapTradeQuoteStatusToSalesQuoteStatus(quote.status);
  const preTax = Math.max(0, quote.subtotal - quote.discount + quote.shippingCost);
  const notesPreview = buildConversionNotes(quote);

  const proposedItems =
    quote.items?.map((it) => ({
      tradeLineId: it.id,
      productName: it.productName,
      specification: it.specification,
      unit: it.unit,
      quantity: it.quantity,
      unitPrice: it.unitPrice,
      totalPrice: it.totalPrice,
      remarks: it.remarks,
    })) ?? [];

  return {
    tradeQuote: {
      id: quote.id,
      quoteNumber: quote.quoteNumber,
      status: quote.status,
      currency: quote.currency,
      subtotal: quote.subtotal,
      discount: quote.discount,
      shippingCost: quote.shippingCost,
      totalAmount: quote.totalAmount,
      companyName: quote.companyName,
      prospectId: quote.prospectId,
    },
    prospect: prospect
      ? {
          id: prospect.id,
          companyName: prospect.companyName,
          stage: prospect.stage,
          stageNormalized: stageN,
          convertedToSalesCustomerId: prospect.convertedToSalesCustomerId,
          convertedToSalesOpportunityId: prospect.convertedToSalesOpportunityId,
          convertedAt: prospect.convertedAt?.toISOString() ?? null,
        }
      : null,
    targetCustomer,
    targetOpportunity,
    proposedSalesQuote: {
      status: mappedStatus,
      currency: quote.currency || "CAD",
      grandTotal: quote.totalAmount,
      merchSubtotal: quote.subtotal,
      deliveryFee: quote.shippingCost,
      preTaxTotal: preTax,
      taxAmount: 0,
      notesPreview,
    },
    proposedItems,
    warnings,
    alreadyConverted: !!existingSq,
    existingSalesQuoteId: existingSq?.id ?? null,
    canConvert: canConvert && !existingSq && prospectConverted && !!targetCustomer,
  };
}

export async function executeTradeQuoteToSalesQuoteConvert(params: {
  orgId: string;
  userId: string;
  tradeQuoteId: string;
  body: ConvertTradeQuoteToSalesQuoteBody;
}): Promise<
  | NextResponse
  | {
      salesQuote: {
        id: string;
        grandTotal: number;
        status: string;
        currency: string;
        customerId: string;
        opportunityId: string | null;
        sourceTradeQuoteId: string | null;
      };
      logMeta: { prospectId: string; campaignId: string | null };
    }
> {
  const gate = await ensureUserInOrg(params.userId, params.orgId);
  if (gate) return gate;

  const preview = await buildTradeQuoteToSalesQuotePreview({
    orgId: params.orgId,
    tradeQuoteId: params.tradeQuoteId,
  });
  if (preview instanceof NextResponse) return preview;
  if (!preview.canConvert) {
    return NextResponse.json(
      { error: "当前不满足转换条件", warnings: preview.warnings, alreadyConverted: preview.alreadyConverted },
      { status: 400 },
    );
  }

  const loaded = await loadTradeQuoteForOrg(params.tradeQuoteId, params.orgId);
  if (loaded instanceof NextResponse) return loaded;
  const { quote } = loaded;
  const prospect = quote.prospect as TradeProspect;
  const customerId = prospect.convertedToSalesCustomerId!;
  const includeItems = params.body.includeItems !== false;
  const attachToOpportunity = params.body.attachToOpportunity !== false;

  const customerRow = await db.salesCustomer.findFirst({
    where: { id: customerId, archivedAt: null },
    select: { id: true, orgId: true, createdById: true },
  });
  if (!customerRow) {
    return NextResponse.json({ error: "销售客户不存在" }, { status: 404 });
  }
  const deniedCust = await assertSalesCustomerInOrgForMutation(customerRow, params.orgId);
  if (deniedCust) return deniedCust;
  try {
    await assertSalesCustomerInOrgOrThrowForConvert(
      { id: customerRow.id, orgId: customerRow.orgId, createdById: customerRow.createdById },
      params.orgId,
    );
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: m }, { status: 403 });
  }

  let opportunityId: string | null = null;
  if (attachToOpportunity && prospect.convertedToSalesOpportunityId) {
    const od = await assertSalesOpportunityInOrgForTradeConvert(
      prospect.convertedToSalesOpportunityId,
      customerId,
      params.orgId,
    );
    if (od) return od;
    opportunityId = prospect.convertedToSalesOpportunityId;
  }

  const dup = await db.salesQuote.findFirst({ where: { sourceTradeQuoteId: quote.id }, select: { id: true } });
  if (dup) {
    return NextResponse.json({ error: "该外贸报价已转换过", existingSalesQuoteId: dup.id }, { status: 409 });
  }

  const mappedStatus = mapTradeQuoteStatusToSalesQuoteStatus(quote.status);
  const preTax = Math.max(0, quote.subtotal - quote.discount + quote.shippingCost);
  const notes = buildConversionNotes(quote);
  const formDataJson = buildImportedFormDataJson({
    tradeQuote: { id: quote.id, quoteNumber: quote.quoteNumber },
    items:
      quote.items?.map((it) => ({
        id: it.id,
        productName: it.productName,
        specification: it.specification,
        unit: it.unit,
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        totalPrice: it.totalPrice,
        remarks: it.remarks,
        sortOrder: it.sortOrder,
      })) ?? [],
    includeItems,
  });

  const existingCount = await db.salesQuote.count({ where: { customerId } });
  const shareToken = randomBytes(16).toString("hex");

  const result = await db.$transaction(async (tx) => {
    const sq = await tx.salesQuote.create({
      data: {
        orgId: params.orgId,
        customerId,
        opportunityId,
        sourceTradeQuoteId: quote.id,
        version: existingCount + 1,
        shareToken,
        status: mappedStatus,
        installMode: "default",
        merchSubtotal: quote.subtotal,
        addonsSubtotal: 0,
        installSubtotal: 0,
        installApplied: 0,
        deliveryFee: quote.shippingCost,
        preTaxTotal: preTax,
        taxRate: 0,
        taxAmount: 0,
        grandTotal: quote.totalAmount,
        currency: quote.currency || "CAD",
        notes,
        formDataJson,
        aiSource: "trade_quote_import",
        createdById: params.userId,
      },
      select: {
        id: true,
        grandTotal: true,
        status: true,
        currency: true,
        customerId: true,
        opportunityId: true,
        sourceTradeQuoteId: true,
      },
    });

    await tx.customerInteraction.create({
      data: {
        orgId: params.orgId,
        customerId,
        opportunityId,
        type: "note",
        direction: "inbound",
        summary: `外贸报价转入销售：${quote.quoteNumber}`,
        content: `TradeQuote id=${quote.id}\nSalesQuote id=${sq.id}\n币种 ${quote.currency} 合计 ${quote.totalAmount}`,
        createdById: params.userId,
      },
    });

    return sq;
  });

  return {
    salesQuote: result,
    logMeta: {
      prospectId: prospect.id,
      campaignId: quote.campaignId,
    },
  };
}
