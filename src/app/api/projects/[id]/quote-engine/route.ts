import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireQuoteAccess } from "@/lib/quote-engine/access";
import { createEngineQuote, QuoteEngineError } from "@/lib/quote-engine/service";

/** GET 列表（引擎报价；内部 KPI 仅 internal_cost 可见）/ POST 新建（edit） */
export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const access = await requireQuoteAccess(request, id, "read");
  if (access instanceof NextResponse) return access;
  const rows = await db.projectQuote.findMany({ where: { projectId: id, quoteType: { not: "CUSTOM" } }, orderBy: [{ version: "desc" }], select: { id: true, quoteNumber: true, name: true, title: true, quoteType: true, status: true, version: true, currency: true, sourceQuoteId: true, approvedAt: true, awardedAt: true, summaryJson: true, updatedAt: true } });
  return NextResponse.json({
    enabled: true,
    capabilities: { canViewInternal: access.canViewInternal, canEdit: access.canEdit, canApprove: access.canApprove },
    quotes: rows.map((r) => {
      const s = (r.summaryJson ?? {}) as Record<string, unknown>;
      return { id: r.id, quoteNumber: r.quoteNumber, name: r.name ?? r.title, quoteType: r.quoteType, status: r.status, version: r.version, currency: r.currency, sourceQuoteId: r.sourceQuoteId, approvedAt: r.approvedAt, awardedAt: r.awardedAt, updatedAt: r.updatedAt, sellingPrice: s.sellingPrice ?? null, ...(access.canViewInternal ? { estimatedCost: s.estimatedCost ?? null, grossMarginPct: s.grossMarginPct ?? null } : {}) };
    }),
  });
}

export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const access = await requireQuoteAccess(request, id, "edit");
  if (access instanceof NextResponse) return access;
  const body = (await request.json().catch(() => ({}))) as { quoteType?: string; name?: string | null; currency?: string; seedTemplate?: boolean; demo?: "A" | "B" | null };
  try {
    const q = await createEngineQuote({ projectId: id, orgId: access.orgId, userId: access.user.id, quoteType: body.quoteType ?? "PROJECT_SUPPLY_INSTALL", name: body.name ?? null, currency: body.currency, seedTemplate: body.seedTemplate, demo: process.env.NODE_ENV === "production" ? null : (body.demo ?? null) });
    return NextResponse.json({ id: q.id, version: q.version, quoteType: q.quoteType }, { status: 201 });
  } catch (e) {
    if (e instanceof QuoteEngineError) return NextResponse.json({ error: e.message, code: e.code, details: e.details ?? null }, { status: e.status });
    throw e;
  }
}
