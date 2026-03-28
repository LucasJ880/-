import { NextRequest, NextResponse } from "next/server";
import { requireProjectReadAccess } from "@/lib/projects/access";
import { compareQuotes, toPrismaHttpError } from "@/lib/inquiry/service";
import { db } from "@/lib/db";
import { createCompletion } from "@/lib/ai/client";
import {
  getQuoteAnalysisPrompt,
  type QuoteAnalysisContext,
} from "@/lib/ai/prompts";
import { isAIConfigured } from "@/lib/ai/config";

type Params = { params: Promise<{ id: string; inquiryId: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  const { id: projectId, inquiryId } = await params;
  const access = await requireProjectReadAccess(request, projectId);
  if (access instanceof NextResponse) return access;

  if (!isAIConfigured()) {
    return NextResponse.json(
      { error: "AI 功能未配置" },
      { status: 503 }
    );
  }

  try {
    const rows = await compareQuotes({ projectId, inquiryId });
    if (rows.length === 0) {
      return NextResponse.json(
        { error: "暂无已报价的供应商，无法进行分析" },
        { status: 400 }
      );
    }

    const inquiry = await db.projectInquiry.findUnique({
      where: { id: inquiryId },
      include: {
        project: {
          select: {
            name: true,
            description: true,
            closeDate: true,
          },
        },
      },
    });

    if (!inquiry) {
      return NextResponse.json(
        { error: "询价轮次不存在" },
        { status: 404 }
      );
    }

    const ctx: QuoteAnalysisContext = {
      project: {
        name: inquiry.project.name,
        description: inquiry.project.description,
        closeDate: inquiry.project.closeDate?.toISOString().slice(0, 10) ?? null,
      },
      inquiry: {
        roundNumber: inquiry.roundNumber,
        title: inquiry.title,
        scope: inquiry.scope,
      },
      quotes: rows.map((r) => ({
        supplierName: r.supplierName,
        unitPrice: r.unitPrice?.toString() ?? null,
        totalPrice: r.totalPrice?.toString() ?? null,
        currency: r.currency,
        deliveryDays: r.deliveryDays,
        quoteNotes: r.quoteNotes,
        isSelected: r.isSelected,
      })),
    };

    const systemPrompt = getQuoteAnalysisPrompt(ctx);
    const raw = await createCompletion({
      systemPrompt,
      userPrompt: `请分析以上 ${rows.length} 家供应商的报价，给出对比结论和推荐。`,
      mode: "normal",
      temperature: 0.3,
    });

    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return NextResponse.json(
        { error: "AI 返回格式异常", raw },
        { status: 502 }
      );
    }

    const analysis = JSON.parse(jsonMatch[0]);
    return NextResponse.json({
      analysis,
      quotesCount: rows.length,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    const { msg, status } = toPrismaHttpError(err);
    return NextResponse.json({ error: msg }, { status });
  }
}
