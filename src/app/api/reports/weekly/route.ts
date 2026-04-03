import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getVisibleProjectIds } from "@/lib/projects/visibility";
import { isAIConfigured } from "@/lib/ai/config";
import { generateProgressSummary, type ProgressSummaryResult } from "@/lib/progress/generate-summary";
import { logAudit, AUDIT_ACTIONS, AUDIT_TARGETS } from "@/lib/audit/logger";

/**
 * POST /api/reports/weekly
 *
 * 对用户可见的所有活跃项目批量生成 project_progress_summary。
 * 周报 = 多个项目的进展摘要汇总，共享底层数据源和生成器，但面向"周期复盘"。
 */
export async function POST(request: NextRequest) {
  const user = await getCurrentUser(request);
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  if (!isAIConfigured()) {
    return NextResponse.json({ error: "AI 服务未配置" }, { status: 500 });
  }

  const projectIds = await getVisibleProjectIds(user.id, user.role);
  const projectWhere = projectIds !== null
    ? { id: { in: projectIds }, status: "active" }
    : { status: "active" };

  const projects = await db.project.findMany({
    where: projectWhere,
    select: { id: true, name: true },
    orderBy: { updatedAt: "desc" },
    take: 10,
  });

  if (projects.length === 0) {
    return NextResponse.json({ error: "暂无活跃项目" }, { status: 404 });
  }

  const results: Array<{
    projectId: string;
    projectName: string;
    summary: ProgressSummaryResult | null;
    error?: string;
  }> = [];

  for (const project of projects) {
    try {
      const result = await generateProgressSummary(project.id);
      results.push({
        projectId: project.id,
        projectName: project.name,
        summary: result,
        ...(result ? {} : { error: "生成失败" }),
      });
    } catch (err) {
      results.push({
        projectId: project.id,
        projectName: project.name,
        summary: null,
        error: err instanceof Error ? err.message : "生成失败",
      });
    }
  }

  const successful = results.filter((r) => r.summary);

  await logAudit({
    userId: user.id,
    action: AUDIT_ACTIONS.AI_ANALYZE,
    targetType: AUDIT_TARGETS.REPORT,
    afterData: {
      doc_type: "weekly_report",
      totalProjects: projects.length,
      successCount: successful.length,
    },
    request,
  });

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    totalProjects: projects.length,
    successCount: successful.length,
    failCount: results.length - successful.length,
    projects: results.map((r) => ({
      projectId: r.projectId,
      projectName: r.projectName,
      summary: r.summary ? r.summary.output : null,
      meta: r.summary ? r.summary.meta : null,
      error: r.error,
    })),
  });
}
