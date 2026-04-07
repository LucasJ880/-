import { NextRequest, NextResponse } from "next/server";
import { requireProjectReadAccess } from "@/lib/projects/access";
import { db } from "@/lib/db";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/projects/:id/quotes/save-ai-draft
 *
 * 将 AI 投标方案生成的报价草稿保存为正式报价单（含行项目）。
 * body: { draft: { header, lines[], summary }, templateType }
 */
export async function POST(request: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const access = await requireProjectReadAccess(request, id);
  if (access instanceof NextResponse) return access;

  const body = await request.json();
  const { draft, templateType = "export_standard" } = body;

  if (!draft) {
    return NextResponse.json({ error: "缺少 draft 数据" }, { status: 400 });
  }

  const header = draft.header ?? draft;
  const lines = Array.isArray(draft.lines) ? draft.lines : [];

  const existing = await db.projectQuote.count({ where: { projectId: id } });

  const quote = await db.projectQuote.create({
    data: {
      projectId: id,
      templateType,
      version: existing + 1,
      title: header.title ?? `AI 报价草稿 v${existing + 1}`,
      currency: header.currency ?? "CAD",
      tradeTerms: header.tradeTerms ?? null,
      paymentTerms: header.paymentTerms ?? null,
      deliveryDays: header.deliveryDays ? Number(header.deliveryDays) : null,
      originCountry: header.originCountry ?? null,
      aiGenerated: true,
      aiDraftJson: JSON.stringify(draft),
      createdById: access.user.id,
      lineItems: {
        create: lines.map((line: Record<string, unknown>, idx: number) => ({
          sortOrder: idx,
          category: (line.category as string) ?? "product",
          itemName: (line.itemName as string) ?? (line.name as string) ?? `项目 ${idx + 1}`,
          specification: (line.specification as string) ?? (line.spec as string) ?? null,
          unit: (line.unit as string) ?? null,
          quantity: line.quantity != null ? Number(line.quantity) : null,
          unitPrice: line.unitPrice != null ? Number(line.unitPrice) : null,
          totalPrice: line.totalPrice != null ? Number(line.totalPrice) : null,
          remarks: (line.remarks as string) ?? (line.notes as string) ?? null,
        })),
      },
    },
    select: { id: true, version: true, templateType: true, title: true },
  });

  return NextResponse.json({ quoteId: quote.id, version: quote.version, title: quote.title }, { status: 201 });
}
