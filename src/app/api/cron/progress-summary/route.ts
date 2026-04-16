import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isAIConfigured } from "@/lib/ai/config";
import { generateProgressSummary } from "@/lib/progress/generate-summary";

export const maxDuration = 60;

/**
 * GET /api/cron/progress-summary
 *
 * Vercel Cron 定时调用：为所有活跃项目自动生成进展摘要。
 * 跳过 24 小时内已生成过摘要的项目。
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isAIConfigured()) {
    return NextResponse.json({ error: "AI 服务未配置" }, { status: 500 });
  }

  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const projects = await db.project.findMany({
    where: {
      status: "active",
      NOT: {
        progressSummaries: {
          some: { createdAt: { gte: oneDayAgo } },
        },
      },
    },
    select: { id: true, name: true, ownerId: true },
    orderBy: { updatedAt: "desc" },
    take: 10,
  });

  if (projects.length === 0) {
    return NextResponse.json({
      scannedAt: now.toISOString(),
      message: "所有项目 24h 内已有摘要",
      generated: 0,
    });
  }

  const results: Array<{ projectId: string; projectName: string; status: string }> = [];

  for (const project of projects) {
    try {
      const result = await generateProgressSummary(project.id, "cron");
      results.push({
        projectId: project.id,
        projectName: project.name,
        status: result ? `ok (${result.output.overallStatus})` : "failed",
      });
    } catch (err) {
      results.push({
        projectId: project.id,
        projectName: project.name,
        status: `error: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  await db.auditLog.create({
    data: {
      userId: projects[0]?.ownerId ?? "system",
      action: "cron_progress_summary",
      targetType: "project_progress_summary",
      targetId: "batch",
      afterData: JSON.stringify({
        scannedAt: now.toISOString(),
        projectCount: projects.length,
        successCount: results.filter((r) => r.status.startsWith("ok")).length,
      }),
    },
  });

  return NextResponse.json({
    scannedAt: now.toISOString(),
    generated: results.filter((r) => r.status.startsWith("ok")).length,
    total: projects.length,
    results,
  });
}
