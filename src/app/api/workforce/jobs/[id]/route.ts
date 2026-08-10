/**
 * GET /api/workforce/jobs/:id — Workforce Job 只读视图（Lane D / P1-P2）
 *
 * 鉴权：withAuth（登录 + 账号 active）→ org 访问解析（Final Review FIX A：
 * activeOrgId 仅是偏好，必须经 canUserUseOrg 现查重授权；stale/revoked/
 * archived 偏好不得使用；多可用 org 不随机代选）→ getWorkforceJobView
 * 内部 orgId+runId+runType 三条件查询。
 * 跨 org / 不存在 / 非 workforce_job 统一 404，不区分（防枚举）。
 *
 * 2D-1：org 解析装配收敛到 resolveWorkforceApiOrgForUser（与列表路由
 * 共用一份 org access 逻辑）；响应形状不变。
 *
 * 本阶段不透出内部时间线开关（Admin/Operator 面专属，API 恒为用户视图）；
 * 无任何写入路径（服务层 Reader 类型只有 findFirst/findMany）。
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import {
  getWorkforceJobView,
  resolveWorkforceApiOrgForUser,
  workforceOrgFailureHttp,
} from "@/lib/workforce-runtime/read-model";

export const GET = withAuth<{ id: string }>(async (_req, ctx, user) => {
  const { id } = await ctx.params;

  const resolution = await resolveWorkforceApiOrgForUser({
    id: user.id,
    role: user.role,
  });
  if (!resolution.ok) {
    const { status, body } = workforceOrgFailureHttp(resolution.reason);
    return NextResponse.json(body, { status });
  }

  const result = await getWorkforceJobView({ orgId: resolution.orgId, jobId: id });
  if (!result.ok) {
    return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  }
  return NextResponse.json({ job: result.view });
});
