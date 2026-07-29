/**
 * Sales Command Center 首页聚合
 *
 * GET  — 当前组织 + 授权范围内的首页数据
 * PATCH — 更新本人（或管理员代改）月度销售目标 CAD
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import { canManageUsers } from "@/lib/rbac/roles";
import {
  resolveSalesOrgIdForRequest,
  resolveSalesScope,
} from "@/lib/sales/org-context";
import { buildSalesHome } from "@/lib/sales/home";

export const GET = withAuth(async (request, _ctx, user) => {
  const orgRes = await resolveSalesOrgIdForRequest(request, user);
  if (!orgRes.ok) return orgRes.response;

  const scope = await resolveSalesScope(user, orgRes.orgId);
  if (!scope.allowed) {
    return NextResponse.json(
      { error: "无权查看销售首页", reasonCode: scope.reasonCode },
      { status: 403 },
    );
  }

  const dbUser = await db.user.findUnique({
    where: { id: user.id },
    select: { name: true, salesMonthlyTargetCad: true },
  });

  const data = await buildSalesHome({
    userId: user.id,
    userName: dbUser?.name || user.name || "销售",
    orgId: orgRes.orgId,
    ownOnly: scope.ownOnly,
    targetAmount: dbUser?.salesMonthlyTargetCad ?? null,
  });

  return NextResponse.json(data);
});

export const PATCH = withAuth(async (request, _ctx, user) => {
  const orgRes = await resolveSalesOrgIdForRequest(request, user);
  if (!orgRes.ok) return orgRes.response;

  const scope = await resolveSalesScope(user, orgRes.orgId);
  if (!scope.allowed) {
    return NextResponse.json(
      { error: "无权设置销售目标", reasonCode: scope.reasonCode },
      { status: 403 },
    );
  }

  let body: { targetAmount?: number | null; userId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "无效请求体" }, { status: 400 });
  }

  const targetUserId = body.userId?.trim() || user.id;
  if (targetUserId !== user.id && !canManageUsers(user.role)) {
    return NextResponse.json(
      { error: "仅可修改本人目标，或由管理角色代设" },
      { status: 403 },
    );
  }

  const raw = body.targetAmount;
  if (raw !== null && raw !== undefined) {
    if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) {
      return NextResponse.json(
        { error: "目标金额须为非负数字" },
        { status: 400 },
      );
    }
  }

  const updated = await db.user.update({
    where: { id: targetUserId },
    data: {
      salesMonthlyTargetCad:
        raw === null || raw === undefined ? null : Math.round(raw * 100) / 100,
    },
    select: { id: true, salesMonthlyTargetCad: true },
  });

  return NextResponse.json({
    targetAmount: updated.salesMonthlyTargetCad,
  });
});
