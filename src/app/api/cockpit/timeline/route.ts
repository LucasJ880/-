/**
 * GET /api/cockpit/timeline — 组织驾驶舱 company.log（A-2，只读）
 *
 * 鉴权同 /api/cockpit/posts（withAuth → resolveWorkforceApiOrgForUser → 管理层判定）。
 * 查询参数（fail-closed）：limit 1..50（缺省 20）、days 1..7（缺省 7）、cursor 上一页的 nextCursor；非法 → 400。
 * 审计日志 + AI 运行事件 + 自动化运行按 (at, id) 倒序归并。无任何写入路径。
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { getOrgCompanyLog, resolveCockpitViewer } from "@/lib/cockpit/posts-read-model";
import { parseTimelineParams } from "@/lib/cockpit/timeline";

export const GET = withAuth(async (request, _ctx, user) => {
  const resolved = await resolveCockpitViewer(user);
  if (!resolved.ok) return NextResponse.json(resolved.body, { status: resolved.status });
  const params = parseTimelineParams(request.nextUrl.searchParams);
  if (!params.ok) return NextResponse.json({ error: params.error }, { status: 400 });
  return NextResponse.json(await getOrgCompanyLog(resolved.viewer, params.value));
});
