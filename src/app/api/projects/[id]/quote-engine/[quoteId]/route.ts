import { NextRequest, NextResponse } from "next/server";
import { requireQuoteAccess } from "@/lib/quote-engine/access";
import { computeForQuote, getQuote, QuoteEngineError, updateEngineQuote, type QuoteRecord } from "@/lib/quote-engine/service";
import { quoteHeaderSchema, type CostLinePayload, type TierPayload } from "@/lib/quote-engine/contract";
import { buildCustomerView } from "@/lib/quote-engine/customer-view";

type Ctx = { params: Promise<{ id: string; quoteId: string }> };

const num = (v: unknown) => (v == null ? null : Number(v));
function serializeInternal(q: QuoteRecord) {
  return {
    id: q.id, projectId: q.projectId, quoteNumber: q.quoteNumber, name: q.name ?? q.title, quoteType: q.quoteType, status: q.status, version: q.version, sourceQuoteId: q.sourceQuoteId, revisionReason: q.revisionReason,
    currency: q.currency, pricingMethod: q.pricingMethod, pricingRate: num(q.pricingRate), internalNotes: q.internalNotes, engine: q.engineJson ?? null, calcVersion: q.calcVersion, submittedAt: q.submittedAt, approvedAt: q.approvedAt, approvedById: q.approvedById, supersededAt: q.supersededAt, awardedAt: q.awardedAt, cancelledAt: q.cancelledAt, updatedAt: q.updatedAt,
    costLines: q.costLines.map((l) => ({ id: l.id, sortOrder: l.sortOrder, category: l.category, subcategory: l.subcategory, description: l.description, quantity: num(l.quantity), unit: l.unit, unitCost: num(l.unitCost), sourceCurrency: l.sourceCurrency, fxRate: num(l.fxRate), fxRateSource: l.fxRateSource, calculationType: l.calculationType, calculationBase: l.calculationBase, rate: num(l.rate), duration: num(l.duration), supplierId: l.supplierId, supplierName: l.supplierName, source: l.source, notes: l.notes, included: l.included, calculatedCost: num(l.calculatedCost) })),
    tiers: q.pricingTiers.map((t) => ({ id: t.id, sortOrder: t.sortOrder, tierName: t.tierName, minQuantity: Number(t.minQuantity), maxQuantity: num(t.maxQuantity), expectedQuantity: Number(t.expectedQuantity), pricingMethod: t.pricingMethod, rate: num(t.rate), active: t.active })),
  };
}

/** GET：internal_cost 权限 → 完整内部视图 + 运行时重算；仅 read 权限 → 客户视图 */
export async function GET(request: NextRequest, ctx: Ctx) {
  const { id, quoteId } = await ctx.params;
  const access = await requireQuoteAccess(request, id, "read");
  if (access instanceof NextResponse) return access;
  try {
    const q = await getQuote(quoteId, id);
    const computed = computeForQuote(q);
    if (!access.canViewInternal) {
      return NextResponse.json({ customerView: buildCustomerView({ quote: q, calc: computed.calc.ok ? computed.calc : null, tiers: computed.standingOffer?.tiers ?? null }), capabilities: { canViewInternal: false, canEdit: false, canApprove: false } });
    }
    return NextResponse.json({ quote: serializeInternal(q), computed, capabilities: { canViewInternal: true, canEdit: access.canEdit, canApprove: access.canApprove } });
  } catch (e) {
    if (e instanceof QuoteEngineError) return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    throw e;
  }
}

/** PUT：编辑头/成本行/分级（edit 权限；冻结态 409） */
export async function PUT(request: NextRequest, ctx: Ctx) {
  const { id, quoteId } = await ctx.params;
  const access = await requireQuoteAccess(request, id, "edit");
  if (access instanceof NextResponse) return access;
  const body = (await request.json().catch(() => ({}))) as { header?: unknown; lines?: CostLinePayload[]; tiers?: TierPayload[] };
  try {
    const header = body.header ? quoteHeaderSchema.parse(body.header) : undefined;
    const q = await updateEngineQuote({ quoteId, projectId: id, userId: access.user.id, header: header ? { ...header, pricingRate: header.pricingRate ?? undefined } : undefined, lines: body.lines, tiers: body.tiers });
    const computed = computeForQuote(q);
    return NextResponse.json({ quote: serializeInternal(q), computed });
  } catch (e) {
    if (e instanceof QuoteEngineError) return NextResponse.json({ error: e.message, code: e.code, details: e.details ?? null }, { status: e.status });
    if (e && typeof e === "object" && "issues" in e) return NextResponse.json({ error: "输入校验失败", code: "VALIDATION", details: (e as { issues: unknown }).issues }, { status: 400 });
    throw e;
  }
}
