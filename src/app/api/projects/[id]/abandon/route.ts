import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireProjectWriteAccess } from "@/lib/projects/access";
import { logAudit, AUDIT_ACTIONS, AUDIT_TARGETS } from "@/lib/audit/logger";
import { onProjectAbandoned } from "@/lib/project-discussion/system-events";
import { getProjectStage } from "@/lib/tender/stage";

const ABANDONABLE_STAGES = new Set([
  "interpretation",
  "supplier_inquiry",
  "supplier_quote",
  "submission",
]);

function toISO(v: unknown): string | null {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const access = await requireProjectWriteAccess(request, id);
  if (access instanceof NextResponse) return access;
  const { user, project } = access;

  if (project.status === "abandoned") {
    return NextResponse.json(
      { error: "项目已经被放弃" },
      { status: 400 }
    );
  }

  const p = project as Record<string, unknown>;
  const currentStage = getProjectStage({
    createdAt: toISO(p.createdAt),
    tenderStatus: (p.tenderStatus as string) ?? null,
    publicDate: toISO(p.publicDate),
    questionCloseDate: toISO(p.questionCloseDate),
    closeDate: toISO(p.closeDate),
    dueDate: toISO(p.dueDate),
    distributedAt: toISO(p.distributedAt),
    dispatchedAt: toISO(p.dispatchedAt),
    interpretedAt: toISO(p.interpretedAt),
    supplierInquiredAt: toISO(p.supplierInquiredAt),
    supplierQuotedAt: toISO(p.supplierQuotedAt),
    submittedAt: toISO(p.submittedAt),
    awardDate: toISO(p.awardDate),
    intakeStatus: (p.intakeStatus as string) ?? null,
  });

  if (!ABANDONABLE_STAGES.has(currentStage)) {
    return NextResponse.json(
      { error: "当前阶段不允许放弃项目，项目需至少到达「项目解读」阶段" },
      { status: 400 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const reason = typeof body.reason === "string" ? body.reason.trim() : undefined;

  const now = new Date();

  const updated = await db.$transaction(async (tx) => {
    const result = await tx.project.update({
      where: { id },
      data: {
        status: "abandoned",
        abandonedAt: now,
        abandonedStage: currentStage,
        abandonedById: user.id,
        abandonedReason: reason || null,
      },
    });

    await onProjectAbandoned(id, user.name, user.id, currentStage, reason, tx);

    return result;
  });

  await logAudit({
    userId: user.id,
    orgId: project.orgId ?? undefined,
    projectId: id,
    action: AUDIT_ACTIONS.ABANDON_PROJECT,
    targetType: AUDIT_TARGETS.PROJECT,
    targetId: id,
    beforeData: { status: project.status, stage: currentStage },
    afterData: { status: "abandoned", abandonedStage: currentStage, reason },
    request,
  });

  return NextResponse.json({
    success: true,
    project: {
      id: updated.id,
      status: updated.status,
      abandonedAt: updated.abandonedAt,
      abandonedStage: updated.abandonedStage,
    },
  });
}
