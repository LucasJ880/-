import { NextResponse } from "next/server";
import { withAuth, safeParseBody } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import {
  SESSION_ACCESS_SELECT,
  canSeeVisualizerSession,
  resolveVisualizerViewer,
} from "@/lib/visualizer/access";
import type {
  CreateVariantRequest,
  VisualizerVariantSummary,
} from "@/lib/visualizer/types";

/** POST /api/visualizer/sessions/[id]/variants */
export const POST = withAuth(async (request, ctx, user) => {
  // PERM-4c5：按企业 + 岗位派生角色判定视觉方案"看全部"范围（修复跨企业泄露）
  const viewer = await resolveVisualizerViewer(user);
  const { id: sessionId } = await ctx.params;

  const session = await db.visualizerSession.findUnique({
    where: { id: sessionId },
    select: SESSION_ACCESS_SELECT,
  });
  if (!session) {
    return NextResponse.json({ error: "可视化方案不存在" }, { status: 404 });
  }
  if (!canSeeVisualizerSession(session, viewer)) {
    return NextResponse.json({ error: "无权操作该方案" }, { status: 403 });
  }

  const body = await safeParseBody<CreateVariantRequest>(request);
  const name = body?.name?.trim();
  const notes = body?.notes?.trim() || null;

  const count = await db.visualizerVariant.count({ where: { sessionId } });
  const resolvedName = name && name.length > 0 ? name : `方案 ${count + 1}`;

  const created = await db.visualizerVariant.create({
    data: {
      sessionId,
      name: resolvedName,
      notes,
      sortOrder: count,
    },
  });
  await db.visualizerSession.update({
    where: { id: sessionId },
    data: { updatedAt: new Date() },
  });

  const summary: VisualizerVariantSummary = {
    id: created.id,
    name: created.name,
    notes: created.notes,
    exportImageUrl: created.exportImageUrl,
    sortOrder: created.sortOrder,
    productOptionCount: 0,
    hasSalesSelection: false,
    hasCustomerSelection: false,
    createdAt: created.createdAt.toISOString(),
    updatedAt: created.updatedAt.toISOString(),
    renderJob: { status: null, tier: null, error: null, startedAt: null, stale: false },
    productOptions: [],
  };
  return NextResponse.json({ variant: summary }, { status: 201 });
});
