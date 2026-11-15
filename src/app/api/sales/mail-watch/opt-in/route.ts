/**
 * /api/sales/mail-watch/opt-in（MAIL-2 · spec mail/inbound-watch）
 *   GET  当前登录成员在当前组织的「客户来信提醒」勾选状态、组织开关、本人邮箱的读信权限状态
 *   PUT  { optedIn: boolean }：只改当前登录成员本人的勾选；取消勾选即删除本人的游标
 *
 * 用户只取登录态：请求体里的其它字段（包括任何用户标识）一律不看，不能替别人勾选。
 * 只有邮箱绑定页（/settings/email）对其放行的成员可以调用。平台开关关闭时返回 404。
 */
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { authorize, humanPrincipal } from "@/lib/authorization";
import { isMailWatchAllowed } from "@/lib/env/runtime-isolation";
import { loadNavigationContextForOrg } from "@/lib/navigation/context-server";
import { canOpenHref } from "@/lib/navigation/landing";
import { resolveSalesOrgIdForRequest } from "@/lib/sales/org-context";
import { loadMemberOptIn, parseOptInBody, saveMemberOptIn } from "@/lib/mail-watch/settings";
import type { AuthUser } from "@/lib/auth";

const MAIL_SETTINGS_HREF = "/settings/email";
const SETTINGS_PERMISSION = "sales.settings.manage";

const notOpen = () => NextResponse.json({ error: "暂未开放" }, { status: 404 });

async function pageDenied(user: AuthUser, orgId: string): Promise<NextResponse | null> {
  if (canOpenHref(MAIL_SETTINGS_HREF, await loadNavigationContextForOrg(user, orgId))) return null;
  return NextResponse.json({ error: "无权使用客户来信提醒" }, { status: 403 });
}

async function statusFor(user: AuthUser, orgId: string) {
  const decision = await authorize({ principal: humanPrincipal(user, orgId), orgId, permission: SETTINGS_PERMISSION });
  return loadMemberOptIn({ orgId, userId: user.id, canManageOrg: decision.allowed });
}

export const GET = withAuth(async (request, _ctx, user) => {
  if (!isMailWatchAllowed()) return notOpen();
  const orgRes = await resolveSalesOrgIdForRequest(request, user);
  if (!orgRes.ok) return orgRes.response;
  const deny = await pageDenied(user, orgRes.orgId);
  if (deny) return deny;
  const status = await statusFor(user, orgRes.orgId);
  if (!status) return NextResponse.json({ error: "组织不存在" }, { status: 404 });
  return NextResponse.json({ status });
});

export const PUT = withAuth(async (request, _ctx, user) => {
  if (!isMailWatchAllowed()) return notOpen();
  const orgRes = await resolveSalesOrgIdForRequest(request, user);
  if (!orgRes.ok) return orgRes.response;
  const deny = await pageDenied(user, orgRes.orgId);
  if (deny) return deny;
  const parsed = parseOptInBody(await request.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.message, code: "INVALID_BODY" }, { status: 400 });
  // userId 只取登录态
  const saved = await saveMemberOptIn({ orgId: orgRes.orgId, userId: user.id, optedIn: parsed.optedIn });
  if (!saved.found) return NextResponse.json({ error: "组织不存在" }, { status: 404 });
  const status = await statusFor(user, orgRes.orgId);
  return NextResponse.json({ status });
});
