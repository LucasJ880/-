import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { generateProjectIntelligence } from "@/lib/files/ai-intelligence";

/**
 * POST /api/projects/:id/intelligence/regenerate
 *
 * 重新触发 AI 情报分析，基于当前最新的项目文档重新生成报告。
 * 适用于：新增了文档/附件后需要刷新分析。
 */
export const POST = withAuth(async (_request, ctx) => {
  const { id: projectId } = await ctx.params;

  try {
    await generateProjectIntelligence(projectId);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[intelligence/regenerate] Error:", err);
    return NextResponse.json(
      { error: "重新分析失败，请稍后重试" },
      { status: 500 },
    );
  }
});
