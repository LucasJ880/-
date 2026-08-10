/**
 * GET /api/workforce/jobs/:id — Workforce Job 只读视图（Lane D / P1-P2）
 *
 * 鉴权复用现有栈：withAuth（登录 + 账号 active）→ 活跃 org membership
 * 解析 → getWorkforceJobView 内部 orgId+runId+runType 三条件查询。
 * 跨 org / 不存在 / 非 workforce_job 统一 404，不区分（防枚举）。
 *
 * 本阶段不透出 includeInternal（internal timeline 属 2D Admin 面）；
 * 无任何写入路径（服务层 Reader 类型只有 findFirst/findMany）。
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import { getUserActiveOrgId } from "@/lib/organizations/active-org";
import { getWorkforceJobView } from "@/lib/workforce-runtime/read-model";

async function resolveOrg(userId: string): Promise<string | null> {
  const active = await getUserActiveOrgId(userId);
  if (active) return active;
  const membership = await db.organizationMember.findFirst({
    where: { userId, status: "active" },
    select: { orgId: true },
  });
  return membership?.orgId ?? null;
}

export const GET = withAuth<{ id: string }>(async (_req, ctx, user) => {
  const { id } = await ctx.params;
  const orgId = await resolveOrg(user.id);
  if (!orgId) return NextResponse.json({ error: "无组织" }, { status: 403 });

  const result = await getWorkforceJobView({ orgId, jobId: id });
  if (!result.ok) {
    return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  }
  return NextResponse.json({ job: result.view });
});
