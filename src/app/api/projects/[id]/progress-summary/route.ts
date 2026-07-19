import { NextRequest, NextResponse } from "next/server";
import { requireProjectReadAccess } from "@/lib/projects/access";
import { isAIConfigured } from "@/lib/ai/config";
import {
  generateProgressSummary,
  getLatestSummary,
} from "@/lib/progress/generate-summary";
import { logAudit, AUDIT_ACTIONS, AUDIT_TARGETS } from "@/lib/audit/logger";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/projects/:id/progress-summary
 * 读取最新已生成摘要（不触发 AI）
 */
export async function GET(request: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const access = await requireProjectReadAccess(request, id);
  if (access instanceof NextResponse) return access;

  const latest = await getLatestSummary(id);
  if (!latest) {
    return NextResponse.json({ summary: null });
  }

  let output: Record<string, unknown> = {};
  try {
    output = JSON.parse(latest.outputJson || "{}") as Record<string, unknown>;
  } catch {
    output = {};
  }

  return NextResponse.json({
    summary: {
      ...output,
      overallStatus: latest.overallStatus,
      statusLabel: latest.statusLabel,
      executiveSummary: latest.executiveSummary,
      generatedAt: latest.createdAt.toISOString(),
      _meta: {
        id: latest.id,
        prompt_version: latest.promptVersion,
        model: latest.modelUsed,
        used_fallback: latest.usedFallback,
        trigger_type: latest.triggerType,
      },
    },
  });
}

/**
 * POST /api/projects/:id/progress-summary
 *
 * 生成 project_progress_summary（独立 doc_type）。
 * 返回完整的 7 章节结构化输出 + metadata。
 */
export async function POST(request: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;

  const access = await requireProjectReadAccess(request, id);
  if (access instanceof NextResponse) return access;

  if (!isAIConfigured()) {
    return NextResponse.json({ error: "AI 服务未配置" }, { status: 500 });
  }

  const body = await request.json().catch(() => ({}));
  const triggerType =
    body?.trigger === "auto" || body?.trigger === "agent" ? "agent" : "manual";

  try {
    const result = await generateProgressSummary(id, triggerType);

    if (!result) {
      return NextResponse.json({ error: "无法生成项目进展摘要（数据不足或 AI 调用失败）" }, { status: 502 });
    }

    await logAudit({
      userId: access.user.id,
      projectId: id,
      action: AUDIT_ACTIONS.AI_ANALYZE,
      targetType: AUDIT_TARGETS.PROJECT,
      targetId: id,
      afterData: {
        doc_type: "project_progress_summary",
        overallStatus: result.output.overallStatus,
        prompt_version: result.meta.prompt_version,
        used_fallback: result.meta.used_fallback,
      },
      request,
    });

    return NextResponse.json({
      ...result.output,
      _meta: result.meta,
      generatedAt: result.meta.generated_at,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "AI 服务调用失败";
    console.error("[ProgressSummary API]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
