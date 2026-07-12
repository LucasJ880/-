/**
 * POST /api/operations/video-assets/sync
 * 手动触发从 Aivora 拉取成片入库（幂等，按 externalId 去重）。
 * 定时拉取由 /api/cron/aivora-sync 承担，此接口供页面「立即同步」。
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { resolveRequestOrgIdForUser } from "@/lib/auth/resolve-request-org";
import { canManageUsers } from "@/lib/rbac/roles";
import { syncAivoraVideosForOrg } from "@/lib/operations/service";

export const POST = withAuth(async (request, _ctx, user) => {
  if (!canManageUsers(user.role)) {
    return NextResponse.json({ error: "无权触发同步" }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  const orgRes = await resolveRequestOrgIdForUser(user, body.orgId);
  if (!orgRes.ok) return orgRes.response;

  try {
    const result = await syncAivoraVideosForOrg(orgRes.orgId);
    if (!result.configured) {
      return NextResponse.json(
        { error: "Aivora 未配置（AIVORA_API_URL / AIVORA_API_KEY）" },
        { status: 400 },
      );
    }
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "同步失败" },
      { status: 502 },
    );
  }
});
