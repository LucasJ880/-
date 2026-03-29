import { NextRequest, NextResponse } from "next/server";
import { requireProjectReadAccess } from "@/lib/projects/access";
import { db } from "@/lib/db";
import { createCompletion } from "@/lib/ai/client";
import { getQuoteReviewPrompt } from "@/lib/ai/prompts";

type Ctx = { params: Promise<{ id: string; quoteId: string }> };

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
