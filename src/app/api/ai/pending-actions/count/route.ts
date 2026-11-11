/**
 * GET /api/ai/pending-actions/count
 * 轻量接口：返回当前用户"未过期的 pending 草稿"数量。
 * 给侧边栏红点用，避免每次拉 50 条完整列表。
 *
 * VIS-1d：与「待我确认」列表同一组条件（处理人范围 ∩ 审批的可见集合 ∩ 当前企业）+ 未过期；
 * 当前企业取 resolveAssistantOrgId（与列表相同），解析不出时只数本人的个人草稿，照旧返回 200。
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { countMyPendingActions } from "@/lib/approval/pending-mine";
import { resolveAssistantOrgId } from "@/lib/assistant/thread-org";

export const GET = withAuth(async (request, _ctx, user) => {
  const orgRes = await resolveAssistantOrgId(request, user);
  const count = await countMyPendingActions(user.id, orgRes.ok ? orgRes.orgId : null);
  return NextResponse.json({ count });
});
