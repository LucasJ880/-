/**
 * /api/organizations/[orgId]/calendar-watch-settings（CAL-1 · spec calendar/change-attribution）
 *   GET  读取日历观察配置与各日历运行状态（不含同步令牌 / 分页令牌）
 *   PUT  合并保存用户字段（enabled / readerUserId / calendarIds / websiteBookerEmails / websiteMarkers /
 *        memberEmailAliases / notifyPositions / baselineFromDays）；游标由系统维护，PUT 不覆盖
 *
 * 授权：sales.settings.manage（岗位模式下 org_admin 不再代表管理者；平台 super_admin 经授权引擎视为持有）。
 * 错误码：READER_NOT_CONNECTED / CALENDAR_NOT_ACCESSIBLE / INVALID_SETTINGS（400）。
 */
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { authorize, humanPrincipal } from "@/lib/authorization";
import { loadCalendarWatchSettings, saveCalendarWatchSettings } from "@/lib/calendar-watch/settings";
import type { AuthUser } from "@/lib/auth";

const SETTINGS_PERMISSION = "sales.settings.manage";

async function denied(user: AuthUser, orgId: string): Promise<NextResponse | null> {
  const decision = await authorize({ principal: humanPrincipal(user, orgId), orgId, permission: SETTINGS_PERMISSION });
  if (decision.allowed) return null;
  return NextResponse.json({ error: "无权管理日历观察设置", reasonCode: decision.reasonCode }, { status: 403 });
}

export const GET = withAuth<{ orgId: string }>(async (_request, ctx, user) => {
  const { orgId } = await ctx.params;
  const deny = await denied(user, orgId);
  if (deny) return deny;
  const settings = await loadCalendarWatchSettings(orgId);
  if (!settings) return NextResponse.json({ error: "组织不存在" }, { status: 404 });
  return NextResponse.json({ settings });
});

export const PUT = withAuth<{ orgId: string }>(async (request, ctx, user) => {
  const { orgId } = await ctx.params;
  const deny = await denied(user, orgId);
  if (deny) return deny;
  const body = await request.json().catch(() => null);
  const result = await saveCalendarWatchSettings({ orgId, actorUserId: user.id, body });
  if (!result.ok) return NextResponse.json({ error: result.message, code: result.code }, { status: result.status });
  return NextResponse.json({ settings: result.settings });
});
