/**
 * POST /api/ai/pending-actions/[id]
 * body: { decision: "approve" | "reject", reason?: string }
 *
 * 批准 → 调 executor 执行真实副作用 → 返回 { ok, resultRef, message }
 * 拒绝 → 只标状态，不执行
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import {
  executePendingAction,
  rejectPendingAction,
} from "@/lib/pending-actions/executor";

export const POST = withAuth(async (request, ctx, user) => {
  const { id } = await ctx.params;

  const action = await db.pendingAction.findUnique({
    where: { id },
    select: {
      id: true,
      type: true,
      status: true,
      createdById: true,
      title: true,
      preview: true,
      expiresAt: true,
    },
  });
  if (!action) {
    return NextResponse.json({ error: "草稿不存在" }, { status: 404 });
  }
  if (action.createdById !== user.id) {
    return NextResponse.json({ error: "无权操作" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const decision = body.decision;
  const reason = typeof body.reason === "string" ? body.reason : undefined;

  if (decision === "approve") {
    const result = await executePendingAction(id, {
      userId: user.id,
      role: user.role,
    });
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error ?? "执行失败" },
        { status: 400 },
      );
    }
    return NextResponse.json({
      ok: true,
      status: "executed",
      resultRef: result.resultRef,
      message: result.message,
    });
  }

  if (decision === "reject") {
    const result = await rejectPendingAction(
      id,
      { userId: user.id, role: user.role },
      reason,
    );
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error ?? "拒绝失败" },
        { status: 400 },
      );
    }
    return NextResponse.json({ ok: true, status: "rejected" });
  }

  return NextResponse.json(
    { error: "decision 必须为 approve 或 reject" },
    { status: 400 },
  );
});
