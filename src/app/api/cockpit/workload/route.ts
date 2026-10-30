/**
 * GET /api/cockpit/workload — 组织驾驶舱工作量 / 无用功（A-4，只读）
 *
 * 鉴权同 /api/cockpit/posts（withAuth → resolveWorkforceApiOrgForUser → 管理层判定）。
 * 查询参数（fail-closed）：days 7..30（缺省 14）；非法 → 400。
 * 按岗位 × 组织本地日汇总 AI 运行 / 待审批的提出与结局 / 护栏拦截 / 用量与成本，并给出疑似无用功规则结果。无任何写入路径。
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { resolveCockpitViewer } from "@/lib/cockpit/posts-read-model";
import { parseWorkloadDays } from "@/lib/cockpit/workload";
import { getOrgWorkload } from "@/lib/cockpit/workload-read-model";

export const GET = withAuth(async (request, _ctx, user) => {
  const resolved = await resolveCockpitViewer(user);
  if (!resolved.ok) return NextResponse.json(resolved.body, { status: resolved.status });
  const days = parseWorkloadDays(request.nextUrl.searchParams.get("days"));
  if (!days.ok) return NextResponse.json({ error: days.error }, { status: 400 });
  return NextResponse.json(await getOrgWorkload(resolved.viewer, days.days));
});
