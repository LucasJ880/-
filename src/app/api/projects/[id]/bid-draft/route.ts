import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireProjectReadAccess } from "@/lib/projects/access";
import { resolveOrgTimezone } from "@/lib/automation/registry";
import { PENDING_ANALYSIS_DRAFT_HINT_ZH, isDecisionGatesEnabledForOrg, isNoGoDecision, noGoDraftReminderZh } from "@/lib/tender-decision-gates/gates";

async function gatesOf(
  orgId: string | null,
  room: { orgId: string; goDecision: string | null; goDecidedAt: Date | null } | null,
  run: { status: string } | null,
): Promise<{ noGoZh: string | null; pendingAnalysisZh: string | null }> {
  let noGoZh: string | null = null;
  // 与询价入口同一个规则：情报室记在这个项目的组织名下、决定是 NO_GO
  if (room && room.orgId === orgId && isNoGoDecision(room.goDecision)) {
    const org = orgId ? await db.organization.findUnique({ where: { id: orgId }, select: { settingsJson: true } }) : null;
    noGoZh = noGoDraftReminderZh(room.goDecidedAt, resolveOrgTimezone(org?.settingsJson ?? null));
  }
  return { noGoZh, pendingAnalysisZh: run && run.status !== "APPROVED" ? PENDING_ANALYSIS_DRAFT_HINT_ZH : null };
}

/** 投标文件起草元信息（最近一次起草的占位/待确认计数与内部注）；生成走 generate-pdf docType=bid_draft */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;
  const access = await requireProjectReadAccess(request, projectId);
  if (access instanceof NextResponse) return access;
  const gates = isDecisionGatesEnabledForOrg(access.project.orgId);
  const run = await db.tenderAnalysisRun.findFirst({
    where: { projectId, status: { in: ["REVIEW_REQUIRED", "APPROVED"] } },
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true, summaryJson: true },
  });
  const room = await db.bidIntelligenceRoom.findUnique({ where: { projectId }, select: { summaryJson: true, orgId: true, goDecision: true, goDecidedAt: true } });
  const rsj = ((room?.summaryJson as Record<string, unknown>) ?? {}) as Record<string, unknown>;
  const matrix = (((run?.summaryJson as Record<string, unknown>) ?? {}).bidFitMatrix ?? {}) as Record<string, unknown>;
  const reqCount = run
    ? await db.tenderExtractedRequirement.count({ where: { analysisRunId: run.id } })
    : 0;
  const latestDoc = await db.projectGeneratedDocument.findFirst({
    where: { projectId, docType: "bid_draft" },
    orderBy: { createdAt: "desc" },
    select: { id: true, createdAt: true, version: true },
  }).catch(() => null);
  return NextResponse.json({
    runId: run?.id ?? null,
    requirementCount: reqCount,
    markedCount: Object.keys(matrix).length,
    draft: rsj.bidDraft ?? null,
    latestDoc,
    // FLOW-H5：开关开着时才有——No-Go 的提醒、当前分析是否已批准（起草前的提示）
    ...(gates ? { gates: await gatesOf(access.project.orgId, room, run) } : {}),
  });
}
