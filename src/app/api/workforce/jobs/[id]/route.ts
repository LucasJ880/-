/**
 * GET /api/workforce/jobs/:id — Workforce Job 只读视图（Lane D / P1-P2）
 *
 * 鉴权：withAuth（登录 + 账号 active）→ org 访问解析（Final Review FIX A：
 * activeOrgId 仅是偏好，必须经 canUserUseOrg 现查重授权；stale/revoked/
 * archived 偏好不得使用；多可用 org 不随机代选）→ getWorkforceJobView
 * 内部 orgId+runId+runType 三条件查询。
 * 跨 org / 不存在 / 非 workforce_job 统一 404，不区分（防枚举）。
 *
 * 本阶段不透出 includeInternal（internal timeline 属 2D Admin 面）；
 * 无任何写入路径（服务层 Reader 类型只有 findFirst/findMany）。
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import {
  canUserUseOrg,
  getUserActiveOrgId,
} from "@/lib/organizations/active-org";
import {
  getWorkforceJobView,
  resolveWorkforceApiOrg,
} from "@/lib/workforce-runtime/read-model";

export const GET = withAuth<{ id: string }>(async (_req, ctx, user) => {
  const { id } = await ctx.params;

  const resolution = await resolveWorkforceApiOrg(
    { userId: user.id, userRole: user.role },
    {
      getActiveOrgId: getUserActiveOrgId,
      canUseOrg: canUserUseOrg,
      listActiveMembershipOrgIds: async (userId) => {
        const memberships = await db.organizationMember.findMany({
          where: { userId, status: "active" },
          select: { orgId: true },
        });
        return memberships.map((m) => m.orgId);
      },
    },
  );
  if (!resolution.ok) {
    if (resolution.reason === "ORG_SELECTION_REQUIRED") {
      return NextResponse.json(
        { error: "请先选择工作组织", needsSelection: true },
        { status: 403 },
      );
    }
    return NextResponse.json({ error: "无组织" }, { status: 403 });
  }

  const result = await getWorkforceJobView({ orgId: resolution.orgId, jobId: id });
  if (!result.ok) {
    return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  }
  return NextResponse.json({ job: result.view });
});
