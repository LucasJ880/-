import { NextRequest, NextResponse } from "next/server";
import { requireProjectReadAccess } from "@/lib/projects/access";
import { db } from "@/lib/db";
import { createCompletion } from "@/lib/ai/client";
import { getQuoteDraftPrompt } from "@/lib/ai/prompts";
import { buildMemoryBlock, getProjectAiMemory } from "@/lib/ai/memory";
import type { TemplateType } from "@/lib/quote/types";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const access = await requireProjectReadAccess(request, id);
  if (access instanceof NextResponse) return access;

  const body = await request.json();
  const templateType = (body.templateType ?? "export_standard") as TemplateType;

  const [project, inquiryItems, memory] = await Promise.all([
    db.project.findUnique({
      where: { id },
      select: {
        name: true,
        clientOrganization: true,
        description: true,
        closeDate: true,
        location: true,
        currency: true,
      },
    }),
    db.inquiryItem.findMany({
      where: {
        inquiry: { projectId: id },
        status: "quoted",
      },
      select: {
        unitPrice: true,
        totalPrice: true,
        currency: true,
        deliveryDays: true,
        quoteNotes: true,
        supplier: { select: { name: true } },
      },
      take: 10,
    }),
    getProjectAiMemory(id),
  ]);

  if (!project) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  const inquiryScope = await db.projectInquiry.findFirst({
    where: { projectId: id },
    orderBy: { roundNumber: "desc" },
    select: { title: true },
  });

  const supplierQuotes = inquiryItems.map((item) => ({
    supplierName: item.supplier.name,
    totalPrice: item.totalPrice?.toString() ?? null,
    unitPrice: item.unitPrice?.toString() ?? null,
    currency: item.currency,
    deliveryDays: item.deliveryDays,
    quoteNotes: item.quoteNotes,
  }));

  const prompt = getQuoteDraftPrompt({
    project: {
      ...project,
      closeDate: project.closeDate?.toISOString().slice(0, 10) ?? null,
    },
    supplierQuotes,
    templateType,
    inquiryScope: inquiryScope?.title ?? null,
    memory: buildMemoryBlock(memory),
  });

  try {
    const raw = await createCompletion({
      systemPrompt:
        "你是青砚报价草稿生成引擎。基于真实数据生成结构化 JSON 报价草稿。只输出 JSON，不要输出其他内容。",
      userPrompt: prompt,
      mode: "normal",
      temperature: 0.4,
      maxTokens: 2000,
    });

    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return NextResponse.json({ error: "AI 响应格式异常" }, { status: 502 });
    }

    const draft = JSON.parse(jsonMatch[0]);

    return NextResponse.json({
      draft,
      supplierQuoteCount: supplierQuotes.length,
    });
  } catch (e) {
    console.error("[quote/ai/generate-draft] error:", e);
    return NextResponse.json({ error: "AI 生成失败" }, { status: 502 });
  }
}
