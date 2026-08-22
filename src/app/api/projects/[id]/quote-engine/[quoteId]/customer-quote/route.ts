import { NextRequest, NextResponse } from "next/server";
import { requireQuoteAccess } from "@/lib/quote-engine/access";
import { computeForQuote, engineOf, getQuote, QuoteEngineError } from "@/lib/quote-engine/service";
import { buildCustomerView, customerViewLeaks } from "@/lib/quote-engine/customer-view";
import { customerHeaderOf, customerTermsOf, generateCustomerDraftLines, resolveCustomerHeaderDefaults, updateCustomerQuote } from "@/lib/quote-engine/customer-quote";
import { getCompanyIdentity, getDefaultQuoteTerms } from "@/lib/quote-engine/quotation-identity";
import { logAudit } from "@/lib/audit/logger";
import { CUSTOMER_QUOTE_AUDIT_ACTIONS } from "@/lib/quote-engine/customer-quote";
import { QUOTE_AUDIT_TARGET } from "@/lib/quote-engine/service";

/**
 * Customer Quote Builder
 *  GET  ：当前客户行 / 抬头 / 条款 + 默认值（项目 + 组织模板）+ 客户视图预览（internal_cost：编辑器含内部溯源）
 *  PUT  ：保存 { header?, terms?, lines? }（edit；冻结态 409）
 *  POST ：{ action: "draft" } → 由内部成本生成客户行**建议**（不落库；必须人工确认后 PUT）
 */

type Ctx = { params: Promise<{ id: string; quoteId: string }> };

function errorResponse(e: unknown) {
  if (e instanceof QuoteEngineError) return NextResponse.json({ error: e.message, code: e.code, details: e.details ?? null }, { status: e.status });
  if (e && typeof e === "object" && "issues" in e) return NextResponse.json({ error: "输入校验失败", code: "VALIDATION", details: (e as { issues: unknown }).issues }, { status: 400 });
  throw e;
}

function serializeLines(q: Awaited<ReturnType<typeof getQuote>>) {
  const num = (v: unknown) => (v == null ? null : Number(v));
  return q.lineItems.filter((l) => !l.isInternal).sort((a, b) => a.sortOrder - b.sortOrder).map((l) => ({ id: l.id, sortOrder: l.sortOrder, section: l.section, item: l.itemName, description: l.specification, quantity: num(l.quantity), unit: l.unit, unitPrice: num(l.unitPrice), amount: num(l.totalPrice), optional: l.optional || l.category === "optional", allowance: l.allowance || l.category === "allowance", taxable: l.taxable, notes: l.remarks, source: l.sourceJson ?? null }));
}

async function payload(q: Awaited<ReturnType<typeof getQuote>>, orgId: string) {
  const computed = computeForQuote(q);
  const company = await getCompanyIdentity(orgId);
  const view = buildCustomerView({ quote: q, calc: computed.calc.ok ? computed.calc : null, tiers: computed.standingOffer?.tiers ?? null, tax: engineOf(q).tax ?? null, company });
  const leaks = customerViewLeaks(view);
  return { header: customerHeaderOf(q), terms: customerTermsOf(q), lines: serializeLines(q), defaults: { header: await resolveCustomerHeaderDefaults(q.projectId), terms: await getDefaultQuoteTerms(orgId) }, company, preview: leaks.length === 0 ? view : null, leaks, frozen: ["approved", "superseded", "awarded", "cancelled"].includes(q.status) };
}

export async function GET(request: NextRequest, ctx: Ctx) {
  const { id, quoteId } = await ctx.params;
  const access = await requireQuoteAccess(request, id, "internal_cost");
  if (access instanceof NextResponse) return access;
  try {
    const q = await getQuote(quoteId, id);
    return NextResponse.json(await payload(q, access.orgId));
  } catch (e) {
    return errorResponse(e);
  }
}

export async function PUT(request: NextRequest, ctx: Ctx) {
  const { id, quoteId } = await ctx.params;
  const access = await requireQuoteAccess(request, id, "edit");
  if (access instanceof NextResponse) return access;
  const body = await request.json().catch(() => ({}));
  try {
    const q = await updateCustomerQuote({ quoteId, projectId: id, orgId: access.orgId, userId: access.user.id, patch: body });
    return NextResponse.json(await payload(q, access.orgId));
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(request: NextRequest, ctx: Ctx) {
  const { id, quoteId } = await ctx.params;
  const access = await requireQuoteAccess(request, id, "edit");
  if (access instanceof NextResponse) return access;
  const body = (await request.json().catch(() => ({}))) as { action?: string; productLabel?: string | null };
  if (body.action !== "draft") return NextResponse.json({ error: "action 必须是 draft" }, { status: 400 });
  try {
    const q = await getQuote(quoteId, id);
    const computed = computeForQuote(q);
    if (!computed.calc.ok) return NextResponse.json({ error: "报价存在校验错误，先修正成本行再生成客户草稿", code: "QUOTE_INVALID", details: computed.calc.errors }, { status: 409 });
    const lines = generateCustomerDraftLines({ calc: computed.calc, quoteType: q.quoteType, tiers: computed.standingOffer?.tiers ?? null, productLabel: body.productLabel ?? q.name ?? null });
    await logAudit({ userId: access.user.id, orgId: access.orgId, projectId: id, action: CUSTOMER_QUOTE_AUDIT_ACTIONS.CUSTOMER_QUOTE_DRAFT_GENERATED, targetType: QUOTE_AUDIT_TARGET, targetId: q.id, afterData: { lines: lines.length, sellingPrice: computed.calc.sellingPrice, applied: false } }).catch(() => undefined);
    return NextResponse.json({ draft: { lines, sellingPrice: computed.calc.sellingPrice, note: "建议行仅供参考：确认后才会成为正式客户报价行（Commission / Profit / 供应商成本已按比例摊入，绝不单列）" } });
  } catch (e) {
    return errorResponse(e);
  }
}
