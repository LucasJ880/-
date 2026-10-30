/**
 * GET /api/cockpit/posts — 组织驾驶舱岗位总览（A-2，只读）
 *
 * 鉴权：withAuth（登录 + 账号 active）→ resolveWorkforceApiOrgForUser（只读组织解析，
 * 多可用组织不代选 → 403 needsSelection）→ 与首页 `/` 相同的管理层判定（否则 403）。
 * 七个岗位的心跳 / 健康度 / 待审批 / 需要你 / 近 7 天动作 / KPI，以及去重后的"等你 N 件"。无任何写入路径。
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { getOrgPostsCockpit, resolveCockpitViewer } from "@/lib/cockpit/posts-read-model";

export const GET = withAuth(async (_request, _ctx, user) => {
  const resolved = await resolveCockpitViewer(user);
  if (!resolved.ok) return NextResponse.json(resolved.body, { status: resolved.status });
  return NextResponse.json(await getOrgPostsCockpit(resolved.viewer));
});
