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
import { db } from "@/lib/db";

type Ctx = { params: Promise<{ id: string }> };

const CHECKLIST_SOURCE = "ai_checklist";
const CHECKLIST_URL = "internal://bid-checklist";

async function loadStoredChecklist(projectId: string) {
  const doc = await db.projectDocument.findFirst({
    where: { projectId, source: CHECKLIST_SOURCE },
    orderBy: { createdAt: "desc" },
    select: { aiSummaryJson: true, createdAt: true },
  });
  if (!doc?.aiSummaryJson) return null;
  try {
    const parsed = JSON.parse(doc.aiSummaryJson) as Record<string, unknown>;
    return {
      ...parsed,
      generatedAt:
        (typeof parsed.generatedAt === "string" && parsed.generatedAt) ||
        doc.createdAt.toISOString(),
    };
  } catch {
    return null;
  }
}

async function saveChecklist(projectId: string, userId: string, payload: unknown) {
  const existing = await db.projectDocument.findFirst({
    where: { projectId, source: CHECKLIST_SOURCE },
    select: { id: true },
  });
  const json = JSON.stringify(payload);
  if (existing) {
    await db.projectDocument.update({
      where: { id: existing.id },
      data: {
        aiSummaryJson: json,
        aiSummaryStatus: "done",
        parseStatus: "done",
        title: "投标准备清单",
      },
    });
    return;
  }
  await db.projectDocument.create({
    data: {
      projectId,
      title: "投标准备清单",
      url: CHECKLIST_URL,
      fileType: "json",
      source: CHECKLIST_SOURCE,
      uploadedById: userId,
      parseStatus: "done",
      aiSummaryStatus: "done",
      aiSummaryJson: json,
      sortOrder: 9999,
    },
  });
}

/**
 * GET /api/projects/:id/checklist — 读取已存清单（不触发 AI）
 */
export async function GET(request: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const access = await requireProjectReadAccess(request, id);
  if (access instanceof NextResponse) return access;

  const checklist = await loadStoredChecklist(id);
  return NextResponse.json({ checklist });
}

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
    const payload = {
      ...result,
      generatedAt: new Date().toISOString(),
    };

    await saveChecklist(id, access.user.id, payload);

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

    return NextResponse.json(payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : "AI 服务调用失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
