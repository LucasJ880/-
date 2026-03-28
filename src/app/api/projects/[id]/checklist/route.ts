import { NextRequest, NextResponse } from "next/server";
import { requireProjectReadAccess } from "@/lib/projects/access";
import { getProjectDeepContext } from "@/lib/ai/context";
import { createCompletion } from "@/lib/ai/client";
import { isAIConfigured } from "@/lib/ai/config";
import {
  getBidChecklistPrompt,
  type ProgressSummaryContext,
} from "@/lib/ai/prompts";
import { logAudit, AUDIT_ACTIONS, AUDIT_TARGETS } from "@/lib/audit/logger";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;

  const access = await requireProjectReadAccess(request, id);
  if (access instanceof NextResponse) return access;

  if (!isAIConfigured()) {
    return NextResponse.json({ error: "AI 服务未配置" }, { status: 500 });
  }

  const deep = await getProjectDeepContext(id);
  if (!deep) {
    return NextResponse.json({ error: "无法加载项目数据" }, { status: 404 });
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

  try {
    const raw = await createCompletion({
      systemPrompt: getBidChecklistPrompt(summaryCtx),
      userPrompt: "请生成投标准备清单",
      temperature: 0.3,
    });

    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return NextResponse.json(
        { error: "AI 返回格式异常", raw: raw.slice(0, 500) },
        { status: 502 }
      );
    }

    const result = JSON.parse(jsonMatch[0]);

    await logAudit({
      userId: access.user.id,
      projectId: id,
      action: AUDIT_ACTIONS.AI_ANALYZE,
      targetType: AUDIT_TARGETS.PROJECT,
      targetId: id,
      afterData: {
        type: "bid_checklist",
        overallReadiness: result.overallReadiness,
      },
      request,
    });

    return NextResponse.json({
      ...result,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "AI 服务调用失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
