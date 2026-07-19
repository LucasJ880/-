/**
 * POST /api/projects/[id]/tender-result
 * 标记招标结果并尝试生成复盘草稿（人工确认前仅为 draft）
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { requireProjectWriteAccess } from "@/lib/projects/access";
import {
  isTenderResult,
  markProjectTenderResult,
} from "@/lib/projects/tender-result";
import { logAudit, AUDIT_ACTIONS, AUDIT_TARGETS } from "@/lib/audit/logger";

export const POST = withAuth(async (request, ctx, user) => {
  const { id: projectId } = await ctx.params;
  const access = await requireProjectWriteAccess(request, projectId);
  if (access instanceof NextResponse) return access;

  const body = await request.json().catch(() => ({}));
  if (!isTenderResult(body.result)) {
    return NextResponse.json(
      {
        error: "result 无效",
        valid: ["won", "lost", "no_bid", "cancelled"],
      },
      { status: 400 },
    );
  }

  const numOrNull = (v: unknown): number | null | undefined => {
    if (v === undefined) return undefined;
    if (v === null || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };

  const ourBidPrice = numOrNull(body.ourBidPrice);
  const winningBidPrice = numOrNull(body.winningBidPrice);
  if (body.ourBidPrice !== undefined && ourBidPrice === undefined) {
    return NextResponse.json({ error: "ourBidPrice 无效" }, { status: 400 });
  }
  if (body.winningBidPrice !== undefined && winningBidPrice === undefined) {
    return NextResponse.json({ error: "winningBidPrice 无效" }, { status: 400 });
  }

  try {
    const result = await markProjectTenderResult({
      projectId,
      result: body.result,
      ourBidPrice,
      winningBidPrice,
      currency: typeof body.currency === "string" ? body.currency : undefined,
      awardDate:
        body.awardDate === undefined
          ? undefined
          : body.awardDate === null || body.awardDate === ""
            ? null
            : body.awardDate,
      note: typeof body.note === "string" ? body.note : undefined,
      actorUserId: user.id,
    });

    await logAudit({
      userId: user.id,
      orgId: result.project.orgId ?? undefined,
      projectId,
      action: AUDIT_ACTIONS.STATUS_CHANGE,
      targetType: AUDIT_TARGETS.PROJECT,
      targetId: projectId,
      beforeData: result.before,
      afterData: {
        tenderStatus: result.project.tenderStatus,
        ourBidPrice: result.project.ourBidPrice,
        winningBidPrice: result.project.winningBidPrice,
        currency: result.project.currency,
        awardDate: result.project.awardDate,
        reviewDraftId: result.review?.id ?? null,
      },
      request,
    });

    return NextResponse.json({
      project: {
        id: result.project.id,
        tenderStatus: result.project.tenderStatus,
        ourBidPrice: result.project.ourBidPrice,
        winningBidPrice: result.project.winningBidPrice,
        currency: result.project.currency,
        awardDate: result.project.awardDate,
      },
      review: result.review,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "标记失败" },
      { status: 400 },
    );
  }
});
