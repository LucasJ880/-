import { NextRequest, NextResponse } from "next/server";
import { requireProjectReadAccess } from "@/lib/projects/access";
import { db } from "@/lib/db";
import { createCompletion } from "@/lib/ai/client";
import { getQuoteReviewPrompt } from "@/lib/ai/prompts";
import { engineQuoteHref, isEngineQuote, LEGACY_QUOTE_ENGINE_CONFLICT_ZH, legacyQuoteAiReviewForbiddenZh } from "@/lib/quote/finance-view";
import { resolveLegacyQuoteCaps } from "@/lib/quote/legacy-access";

type Ctx = { params: Promise<{ id: string; quoteId: string }> };

/**
 * FIX-26：审查要把每行成本价、内部成本与利润率交给模型——只给有财务查看权的人；没有的人 403、不调模型。
 * 报价引擎 / 逐行报价 / 只报总价的报价 409。有资格的人请求与模型输入不变。
 */
export async function POST(request: NextRequest, ctx: Ctx) {
  const { id, quoteId } = await ctx.params;
  const access = await requireProjectReadAccess(request, id);
  if (access instanceof NextResponse) return access;

  const quote = await db.projectQuote.findUnique({
    where: { id: quoteId },
    include: { lineItems: { orderBy: { sortOrder: "asc" } } },
  });

  if (!quote || quote.projectId !== id) {
    return NextResponse.json({ error: "报价单不存在" }, { status: 404 });
  }
  if (isEngineQuote(quote)) {
    return NextResponse.json({ error: LEGACY_QUOTE_ENGINE_CONFLICT_ZH, href: engineQuoteHref(id, quoteId) }, { status: 409 });
  }

  const caps = await resolveLegacyQuoteCaps(access);
  if (!caps.canViewInternal) {
    return NextResponse.json({ error: legacyQuoteAiReviewForbiddenZh(caps.hintReason) }, { status: 403 });
  }

  const project = await db.project.findUnique({
    where: { id },
    select: { description: true },
  });

  const supplierQuoteCount = await db.inquiryItem.count({
    where: { inquiry: { projectId: id }, status: "quoted" },
  });

  const prompt = getQuoteReviewPrompt({
    templateType: quote.templateType,
    header: {
      currency: quote.currency,
      tradeTerms: quote.tradeTerms ?? "",
      paymentTerms: quote.paymentTerms ?? "",
      deliveryDays: quote.deliveryDays,
      validUntil: quote.validUntil?.toISOString().slice(0, 10) ?? "",
      moq: quote.moq,
      originCountry: quote.originCountry ?? "",
    },
    lineItems: quote.lineItems.map((li) => ({
      category: li.category,
      itemName: li.itemName,
      quantity: li.quantity != null ? Number(li.quantity) : null,
      unitPrice: li.unitPrice != null ? Number(li.unitPrice) : null,
      totalPrice: li.totalPrice != null ? Number(li.totalPrice) : null,
      costPrice: li.costPrice != null ? Number(li.costPrice) : null,
    })),
    totals: {
      subtotal: quote.subtotal != null ? Number(quote.subtotal) : 0,
      internalCost: quote.internalCost != null ? Number(quote.internalCost) : 0,
      profitMargin: quote.profitMargin != null ? Number(quote.profitMargin) : null,
    },
    projectDescription: project?.description ?? null,
    supplierQuoteCount,
  });

  try {
    const raw = await createCompletion({
      systemPrompt:
        "你是青砚报价审查引擎。检查报价质量并给出专业改进建议。只输出 JSON，不要输出其他内容。",
      userPrompt: prompt,
      mode: "normal",
      temperature: 0.3,
      maxTokens: 1500,
    });

    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return NextResponse.json({ error: "AI 响应格式异常" }, { status: 502 });
    }

    const review = JSON.parse(jsonMatch[0]);
    return NextResponse.json({ review });
  } catch (e) {
    console.error("[quote/ai/review] error:", e);
    return NextResponse.json({ error: "AI 审查失败" }, { status: 502 });
  }
}
