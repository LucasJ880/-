import { NextRequest, NextResponse } from "next/server";
import { requireProjectReadAccess } from "@/lib/projects/access";
import { db } from "@/lib/db";
import { legacyQuoteListBody, legacyQuoteWriteForbiddenZh } from "@/lib/quote/finance-view";
import { resolveLegacyQuoteCaps } from "@/lib/quote/legacy-access";

type Ctx = { params: Promise<{ id: string }> };

/**
 * FIX-26：只列旧报价单（所属组织为空；报价引擎、逐行报价、只报总价建的报价经旧接口一律 409，这里也不列）；
 * 没有财务查看权的人每份 profitMargin 为 null、带 costHidden；所有人多带 capabilities。总额照旧。
 */
export async function GET(request: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const access = await requireProjectReadAccess(request, id);
  if (access instanceof NextResponse) return access;

  const caps = await resolveLegacyQuoteCaps(access);

  const quotes = await db.projectQuote.findMany({
    where: { projectId: id, orgId: null },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      templateType: true,
      version: true,
      status: true,
      title: true,
      currency: true,
      totalAmount: true,
      profitMargin: true,
      aiGenerated: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { lineItems: true } },
    },
  });

  return NextResponse.json(legacyQuoteListBody(quotes, caps));
}

/** FIX-26：新建要能编辑报价（与报价引擎同口径），否则 403、不读请求体、不写库 */
export async function POST(request: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const access = await requireProjectReadAccess(request, id);
  if (access instanceof NextResponse) return access;

  const caps = await resolveLegacyQuoteCaps(access);
  if (!caps.canEdit) {
    return NextResponse.json({ error: legacyQuoteWriteForbiddenZh(caps.hintReason) }, { status: 403 });
  }

  const body = await request.json();
  const templateType = body.templateType ?? "export_standard";

  const existing = await db.projectQuote.count({ where: { projectId: id } });

  const quote = await db.projectQuote.create({
    data: {
      projectId: id,
      templateType,
      version: existing + 1,
      title: body.title ?? `报价单 v${existing + 1}`,
      currency: body.currency ?? "CAD",
      createdById: access.user.id,
    },
    select: { id: true, version: true, templateType: true },
  });

  return NextResponse.json(quote, { status: 201 });
}
