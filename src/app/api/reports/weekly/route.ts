import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getVisibleProjectIds } from "@/lib/projects/visibility";
import { isAIConfigured } from "@/lib/ai/config";
import { createCompletion } from "@/lib/ai/client";
import {
  generateProgressSummary,
  type ProgressSummaryResult,
  type ProgressSummaryOutput,
} from "@/lib/progress/generate-summary";
import { logAudit, AUDIT_ACTIONS, AUDIT_TARGETS } from "@/lib/audit/logger";

interface ProjectEntry {
  projectId: string;
  projectName: string;
  summary: ProgressSummaryResult | null;
  error?: string;
}

/**
 * 基于所有项目摘要生成跨项目健康度对比汇总
 */
async function generateCrossProjectDigest(
  entries: Array<{ name: string; output: ProgressSummaryOutput }>,
): Promise<string> {
  if (entries.length === 0) return "暂无可汇总的项目数据。";

  const bullet = entries.map((e) =>
    `- ${e.name}: 状态=${e.output.overallStatus}, ${e.output.statusLabel}。管理层摘要：${e.output.executiveSummary}`
  ).join("\n");

  const prompt = `你是青砚 AI 周报分析师。以下是本周各项目的进展摘要：

${bullet}

请输出一份"跨项目健康度对比摘要"（纯文本，3-8句话），要求：
1. 总结所有项目的整体健康度分布（几个 green / yellow / red）
2. 指出最需要关注的 1-2 个项目及原因
3. 指出进展最好的项目
4. 给管理层一个简明的总体判断
5. 如果存在多个项目共同的阻塞或风险模式，指出来
6. 语言简洁有力，不要空话`;

  try {
    const text = await createCompletion({
      systemPrompt: "你是项目管理分析师，用简洁的中文输出跨项目对比分析。",
      userPrompt: prompt,
      temperature: 0.3,
      maxTokens: 1024,
      mode: "fast",
    });
    return text;
  } catch {
    return `共 ${entries.length} 个项目：` +
      `green ${entries.filter((e) => e.output.overallStatus === "green").length} / ` +
      `yellow ${entries.filter((e) => e.output.overallStatus === "yellow").length} / ` +
      `red ${entries.filter((e) => e.output.overallStatus === "red").length}。` +
      `（跨项目对比 AI 生成失败，仅展示统计）`;
  }
}

/**
 * POST /api/reports/weekly
 *
 * 对用户可见的所有活跃项目批量生成 project_progress_summary，
 * 并在最后追加一层跨项目健康度对比汇总。
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

  const results: ProjectEntry[] = [];

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

  // 跨项目健康度对比汇总
  const digestEntries = successful.map((r) => ({
    name: r.projectName,
    output: r.summary!.output,
  }));

  const healthDistribution = {
    green: digestEntries.filter((e) => e.output.overallStatus === "green").length,
    yellow: digestEntries.filter((e) => e.output.overallStatus === "yellow").length,
    red: digestEntries.filter((e) => e.output.overallStatus === "red").length,
  };

  const crossProjectDigest = await generateCrossProjectDigest(digestEntries);

  await logAudit({
    userId: user.id,
    action: AUDIT_ACTIONS.AI_ANALYZE,
    targetType: AUDIT_TARGETS.REPORT,
    afterData: {
      doc_type: "weekly_report",
      totalProjects: projects.length,
      successCount: successful.length,
      healthDistribution,
    },
    request,
  });

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    totalProjects: projects.length,
    successCount: successful.length,
    failCount: results.length - successful.length,
    healthDistribution,
    crossProjectDigest,
    projects: results.map((r) => ({
      projectId: r.projectId,
      projectName: r.projectName,
      summary: r.summary ? r.summary.output : null,
      meta: r.summary ? r.summary.meta : null,
      error: r.error,
    })),
  });
}
