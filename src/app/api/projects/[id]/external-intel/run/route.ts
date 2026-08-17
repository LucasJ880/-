import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireProjectWriteAccess } from "@/lib/projects/access";
import { isExternalIntelEnabled } from "@/lib/tender-intel/canadabuys";
import {
  runExternalIntelForProject,
  isExternalIntelRateLimited,
  EXTERNAL_INTEL_STATUS_KEY,
  type ExternalIntelStatus,
} from "@/lib/tender-intel/orchestrate";

/**
 * 观察期包5 — 手动触发外部情报检索（情报 tab「立即检索外部情报」按钮）。
 *
 * 覆盖「分析已完成但情报错过自动时机」的存量项目：与两条管线的自动触发
 * 走同一编排服务（M1 授标检索 / M2 Web 检索 / M2.5 AI 分析师），
 * 结果仅作候选存入调查室，人工确认门不变。
 *
 * 写权限门（触发出站检索 + 写调查室）；60s 简单频控防连点。
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;
  const access = await requireProjectWriteAccess(request, projectId);
  if (access instanceof NextResponse) return access;

  if (!isExternalIntelEnabled()) {
    return NextResponse.json(
      { ok: false, code: "DISABLED", error: "外部情报未启用" },
      { status: 409 },
    );
  }

  const room = await db.bidIntelligenceRoom.findUnique({
    where: { projectId },
    select: { summaryJson: true },
  });
  const status = (
    (room?.summaryJson as Record<string, unknown>) ?? {}
  )[EXTERNAL_INTEL_STATUS_KEY] as ExternalIntelStatus | undefined;
  if (isExternalIntelRateLimited(status ?? null, Date.now())) {
    return NextResponse.json(
      { ok: false, code: "RATE_LIMITED", error: "刚刚已检索过，请稍后再试" },
      { status: 429 },
    );
  }

  const outcome = await runExternalIntelForProject({
    projectId,
    trigger: "manual",
  });
  return NextResponse.json({ ok: outcome.status !== "error", outcome });
}
