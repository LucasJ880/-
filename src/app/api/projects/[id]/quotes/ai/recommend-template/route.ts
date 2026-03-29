import { NextRequest, NextResponse } from "next/server";
import { requireProjectReadAccess } from "@/lib/projects/access";
import { db } from "@/lib/db";
import { createCompletion } from "@/lib/ai/client";
import { getQuoteTemplatePrompt } from "@/lib/ai/prompts";
import type { TemplateType } from "@/lib/quote/types";

type Ctx = { params: Promise<{ id: string }> };

const VALID_TEMPLATES: string[] = [
  "export_standard",
  "gov_procurement",
  "project_install",
  "service_labor",
];

export async function POST(request: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const access = await requireProjectReadAccess(request, id);
  if (access instanceof NextResponse) return access;

  const project = await db.project.findUnique({
    where: { id },
    select: {
      name: true,
      clientOrganization: true,
      category: true,
      sourceSystem: true,
      tenderStatus: true,
      description: true,
      location: true,
    },
  });

  if (!project) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  const prompt = getQuoteTemplatePrompt({ project });

  try {
    const raw = await createCompletion({
      systemPrompt: "你是青砚报价模板推荐引擎。只输出 JSON，不要输出其他内容。",
      userPrompt: prompt,
      mode: "normal",
      temperature: 0.3,
      maxTokens: 200,
    });

    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return NextResponse.json({ error: "AI 响应格式异常" }, { status: 502 });
    }

    const result = JSON.parse(jsonMatch[0]) as {
      templateType: string;
      reason: string;
      confidence: string;
    };

    if (!VALID_TEMPLATES.includes(result.templateType)) {
      result.templateType = "export_standard";
    }

    return NextResponse.json({
      templateType: result.templateType as TemplateType,
      reason: result.reason,
      confidence: result.confidence,
    });
  } catch (e) {
    console.error("[quote/ai/recommend-template] error:", e);
    return NextResponse.json(
      { error: "AI 推荐失败", templateType: "export_standard", reason: "默认推荐", confidence: "low" },
      { status: 200 }
    );
  }
}
