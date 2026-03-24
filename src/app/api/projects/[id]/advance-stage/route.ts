import { NextRequest, NextResponse } from "next/server";
import { requireProjectWriteAccess } from "@/lib/projects/access";
import {
  advanceProjectStage,
  STAGE_ORDER,
} from "@/lib/tender/stage-transition";
import type { TenderStage } from "@/lib/tender/types";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const access = await requireProjectWriteAccess(request, id);
  if (access instanceof NextResponse) return access;
  const { user } = access;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体格式错误" }, { status: 400 });
  }

  const { targetStage, reason, source, humanConfirmed, confidence, evidence } = body as {
    targetStage?: string;
    reason?: string;
    source?: string;
    humanConfirmed?: boolean;
    confidence?: number;
    evidence?: string[];
  };

  if (!targetStage || !STAGE_ORDER.includes(targetStage as TenderStage)) {
    return NextResponse.json(
      { error: "无效的目标阶段", validStages: STAGE_ORDER },
      { status: 422 }
    );
  }

  if (!reason || typeof reason !== "string") {
    return NextResponse.json({ error: "必须提供推进原因" }, { status: 422 });
  }

  const validSources = ["ai_suggestion", "manual"] as const;
  const resolvedSource = validSources.includes(source as typeof validSources[number])
    ? (source as typeof validSources[number])
    : "manual";

  const result = await advanceProjectStage({
    projectId: id,
    targetStage: targetStage as TenderStage,
    reason,
    source: resolvedSource,
    actor: { id: user.id, name: user.name, email: user.email },
    humanConfirmed: humanConfirmed === true,
    confidence: typeof confidence === "number" ? confidence : undefined,
    evidence: Array.isArray(evidence) ? evidence : undefined,
  });

  // no_op: 幂等成功，前端按成功处理
  if (result.decision === "no_op") {
    return NextResponse.json({
      decision: "no_op",
      reason: result.reason,
    });
  }

  if (!result.success) {
    // deny → 403; require_human_review 未确认 → 409
    const status = result.decision === "deny" ? 403 : 409;
    return NextResponse.json(
      {
        decision: result.decision,
        reason: result.reason,
      },
      { status }
    );
  }

  return NextResponse.json({
    decision: result.decision,
    reason: result.reason,
    project: result.project,
  });
}
