/**
 * POST /api/trade/inbox/[prospectId]/quote-draft
 * 按最新一份 AI 报价建议创建外贸报价【草稿】（价格缺失的行按 0 占位，需人工填）。
 * body: { orgId? }
 */

import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { loadTradeProspectForOrg, resolveTradeOrgId } from "@/lib/trade/access";
import { createQuote } from "@/lib/trade/quote-service";

interface SuggestionItem {
  productName: string;
  specification?: string;
  unit?: string;
  quantity?: number;
  unitPriceSuggested?: number | null;
  basis?: string;
}
interface Suggestion {
  items?: SuggestionItem[];
  moq?: string | null;
  leadTimeDays?: number | null;
  incoterm?: string;
  notes?: string;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ prospectId: string }> },
) {
  const auth = await requireRole(request, ["trade", "admin"]);
  if (auth instanceof NextResponse) return auth;

  const body = await request.json().catch(() => ({}));
  const orgRes = await resolveTradeOrgId(request, auth.user, { bodyOrgId: body.orgId });
  if (!orgRes.ok) return orgRes.response;

  const { prospectId } = await params;
  const loaded = await loadTradeProspectForOrg(prospectId, orgRes.orgId);
  if (loaded instanceof NextResponse) return loaded;
  const { prospect } = loaded;

  const analysis = await db.tradeInquiryAnalysis.findFirst({
    where: { orgId: orgRes.orgId, prospectId, designStatus: "done" },
    orderBy: { createdAt: "desc" },
    select: { quoteSuggestion: true },
  });
  const suggestion = (analysis?.quoteSuggestion ?? null) as Suggestion | null;
  if (!suggestion || !suggestion.items?.length) {
    return NextResponse.json({ error: "还没有 AI 报价建议，可先「重新生成」或直接新建报价" }, { status: 400 });
  }

  const items = suggestion.items.slice(0, 20).map((it) => ({
    productName: (it.productName || "Item").slice(0, 200),
    specification: it.specification ? it.specification.slice(0, 500) : undefined,
    unit: it.unit || "pcs",
    quantity: Number.isFinite(it.quantity) && (it.quantity ?? 0) > 0 ? Number(it.quantity) : 0,
    unitPrice: Number.isFinite(it.unitPriceSuggested ?? NaN) ? Number(it.unitPriceSuggested) : 0,
  }));
  const needsPricing = items.filter((it) => it.unitPrice === 0).length;

  const quote = await createQuote(
    {
      orgId: orgRes.orgId,
      prospectId,
      campaignId: prospect.campaignId,
      companyName: prospect.companyName,
      contactName: prospect.contactName ?? undefined,
      contactEmail: prospect.contactEmail ?? undefined,
      country: prospect.country ?? undefined,
      currency: "USD",
      incoterm: suggestion.incoterm || "FOB",
      leadTimeDays: suggestion.leadTimeDays ?? undefined,
      moq: suggestion.moq ?? undefined,
      internalNotes: [
        "由询盘 AI 建议预填（草稿），发送前请核对价格与规格。",
        suggestion.notes || "",
        ...suggestion.items.map((it) => (it.basis ? `· ${it.productName}: ${it.basis}` : "")),
      ]
        .filter(Boolean)
        .join("\n"),
      items,
    },
    auth.user.id,
  );

  return NextResponse.json({ ok: true, quoteId: quote.id, needsPricing }, { status: 201 });
}
