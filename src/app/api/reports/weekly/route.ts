import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getVisibleProjectIds } from "@/lib/projects/visibility";
import { getProjectDeepContext } from "@/lib/ai/context";
import { createCompletion } from "@/lib/ai/client";
import { isAIConfigured } from "@/lib/ai/config";
import {
  getProgressSummaryPrompt,
  type ProgressSummaryContext,
} from "@/lib/ai/prompts";
import { logAudit, AUDIT_ACTIONS, AUDIT_TARGETS } from "@/lib/audit/logger";

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

  const results: {
    projectId: string;
    projectName: string;
    summary: Record<string, unknown> | null;
    error?: string;
  }[] = [];

  for (const project of projects) {
    try {
      const deep = await getProjectDeepContext(project.id);
      if (!deep) {
        results.push({ projectId: project.id, projectName: project.name, summary: null, error: "数据加载失败" });
        continue;
      }

      const summaryCtx: ProgressSummaryContext = {
        project: {
          name: deep.project.name,
          clientOrganization: deep.project.clientOrganization,
          tenderStatus: deep.project.tenderStatus,
          priority: deep.project.priority,
          closeDate: deep.project.closeDate,
          location: deep.project.location ?? null,
          estimatedValue: deep.project.estimatedValue,
          currency: deep.project.currency,
          description: deep.project.description ?? null,
        },
        taskStats: deep.taskStats,
        recentDiscussion: deep.recentDiscussion,
        inquiries: deep.inquiries,
        members: deep.members,
        documents: deep.documents,
      };

      const raw = await createCompletion({
        systemPrompt: getProgressSummaryPrompt(summaryCtx),
        userPrompt: "请生成项目进展摘要",
        temperature: 0.3,
      });

      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        results.push({
          projectId: project.id,
          projectName: project.name,
          summary: JSON.parse(jsonMatch[0]),
        });
      } else {
        results.push({ projectId: project.id, projectName: project.name, summary: null, error: "AI 返回格式异常" });
      }
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
  const failed = results.filter((r) => !r.summary);

  await logAudit({
    userId: user.id,
    action: AUDIT_ACTIONS.AI_ANALYZE,
    targetType: AUDIT_TARGETS.REPORT,
    afterData: {
      totalProjects: projects.length,
      successCount: successful.length,
    },
    request,
  });

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    totalProjects: projects.length,
    successCount: successful.length,
    failCount: failed.length,
    projects: results,
  });
}
