/**
 * POST /api/operations/content-plan/generate
 * AI 批量生成选题（品牌记忆 + 账号组 persona + 近期选题去重）
 * body: { orgId?, days?, perDayPerGroup?, groupName?, startDate? }
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { requireOpsPermission, OPS_CONTENT_DRAFT } from "@/lib/operations/access";
import { resolveRequestOrgIdForUser } from "@/lib/auth/resolve-request-org";
import { generateContentPlan } from "@/lib/operations/content-plan";

export const POST = withAuth(async (request, _ctx, user) => {
  const body = await request.json().catch(() => ({}));
  const orgRes = await resolveRequestOrgIdForUser(user, body.orgId);
  if (!orgRes.ok) return orgRes.response;
  const denied = await requireOpsPermission(user, orgRes.orgId, OPS_CONTENT_DRAFT, "无权生成选题（需要运营起草权限）");
  if (denied) return denied;

  let startDate: Date | undefined;
  if (body.startDate) {
    startDate = new Date(body.startDate);
    if (Number.isNaN(startDate.getTime())) {
      return NextResponse.json({ error: "startDate 非法" }, { status: 400 });
    }
  }

  try {
    const result = await generateContentPlan({
      orgId: orgRes.orgId,
      userId: user.id,
      days: Number.isInteger(body.days) ? body.days : 7,
      perDayPerGroup: Number.isInteger(body.perDayPerGroup) ? body.perDayPerGroup : 1,
      groupName: body.groupName ? String(body.groupName).trim() : undefined,
      startDate,
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "选题生成失败" },
      { status: 400 },
    );
  }
});
