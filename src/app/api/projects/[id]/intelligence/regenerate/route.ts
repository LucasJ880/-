import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { generateProjectIntelligence } from "@/lib/files/ai-intelligence";
import { requireProjectReadAccess } from "@/lib/projects/access";

/**
 * POST /api/projects/:id/intelligence/regenerate
 *
 * 重新触发 AI 情报分析，基于当前最新的项目文档重新生成报告。
 * 适用于：新增了文档/附件后需要刷新分析。
 *
 * 权限（FIX-21）：项目读权限，处理函数第一步，放在 try 之外（否则守卫抛错会被吞成「重新分析失败」500）。
 */
export const POST = withAuth(async (request, ctx, user) => {
  const { id: projectId } = await ctx.params;
  const access = await requireProjectReadAccess(request, projectId);
  if (access instanceof NextResponse) return access;

  try {
    await generateProjectIntelligence(projectId);
    const { refreshStructuredSummary } = await import(
      "@/lib/projects/structured-summary"
    );
    const { recomputeProjectSimilarities } = await import(
      "@/lib/projects/similarity"
    );
    await refreshStructuredSummary(projectId);
    await recomputeProjectSimilarities({
      projectId,
      userId: user.id,
      role: user.role,
    }).catch((e) =>
      console.warn("[intelligence/regenerate] similarity failed", e),
    );
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[intelligence/regenerate] Error:", err);
    return NextResponse.json(
      { error: "重新分析失败，请稍后重试" },
      { status: 500 },
    );
  }
});
