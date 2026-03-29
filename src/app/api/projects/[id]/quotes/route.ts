import { NextRequest, NextResponse } from "next/server";
import { requireProjectReadAccess } from "@/lib/projects/access";
import { db } from "@/lib/db";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const access = await requireProjectReadAccess(request, id);
  if (access instanceof NextResponse) return access;

  const quotes = await db.projectQuote.findMany({
    where: { projectId: id },
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

  return NextResponse.json({ quotes });
}

export async function POST(request: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const access = await requireProjectReadAccess(request, id);
  if (access instanceof NextResponse) return access;

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
