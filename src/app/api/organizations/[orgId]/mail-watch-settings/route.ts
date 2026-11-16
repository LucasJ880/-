/**
 * /api/organizations/[orgId]/mail-watch-settings（MAIL-2 · spec mail/inbound-watch）
 *   GET  读取该组织的客户来信提醒开关与已勾选的成员数（不含任何成员的用户 id 与游标）
 *   PUT  只接受 { enabled: boolean }；只改组织开关，不动任何成员的勾选与游标
 *
 * 授权：sales.settings.manage（与日历观察设置同一口径：岗位模式下由持键的管理岗位决定，旧模式企业为企业管理员；
 * 平台 super_admin 经授权引擎视为持有）。平台开关 MAIL_WATCH_ENABLED 关闭时两个方法都返回 404。
 */
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { authorize, humanPrincipal } from "@/lib/authorization";
import { isMailWatchAllowed } from "@/lib/env/runtime-isolation";
import { loadOrgMailWatch, saveOrgMailWatch } from "@/lib/mail-watch/settings";
import type { AuthUser } from "@/lib/auth";

const SETTINGS_PERMISSION = "sales.settings.manage";

const notOpen = () => NextResponse.json({ error: "暂未开放" }, { status: 404 });

async function denied(user: AuthUser, orgId: string): Promise<NextResponse | null> {
  const decision = await authorize({ principal: humanPrincipal(user, orgId), orgId, permission: SETTINGS_PERMISSION });
  if (decision.allowed) return null;
  return NextResponse.json({ error: "无权管理客户来信提醒设置", reasonCode: decision.reasonCode }, { status: 403 });
}

export const GET = withAuth<{ orgId: string }>(async (_request, ctx, user) => {
  if (!isMailWatchAllowed()) return notOpen();
  const { orgId } = await ctx.params;
  const deny = await denied(user, orgId);
  if (deny) return deny;
  const settings = await loadOrgMailWatch(orgId);
  if (!settings) return NextResponse.json({ error: "组织不存在" }, { status: 404 });
  return NextResponse.json({ settings });
});

export const PUT = withAuth<{ orgId: string }>(async (request, ctx, user) => {
  if (!isMailWatchAllowed()) return notOpen();
  const { orgId } = await ctx.params;
  const deny = await denied(user, orgId);
  if (deny) return deny;
  const body = await request.json().catch(() => null);
  const result = await saveOrgMailWatch({ orgId, actorUserId: user.id, body });
  if (!result.ok) return NextResponse.json({ error: result.message, code: result.code }, { status: result.status });
  return NextResponse.json({ settings: result.settings });
});
