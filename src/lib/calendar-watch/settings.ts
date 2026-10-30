/**
 * CAL-1 日历观察配置：读取与保存（GET / PUT /api/organizations/[orgId]/calendar-watch-settings 的服务层）。
 *
 * Google 日历列表与连接读取可注入，隔离库测试不打真 Google。
 */

import { db } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit/logger";
import {
  GoogleTokenExpiredError,
  getGoogleProvider,
  listGoogleCalendars,
  type GoogleCalendarInfo,
} from "@/lib/google-calendar";
import {
  applySettingsUpdate,
  publicView,
  readCalendarWatch,
  SETTINGS_AUDIT_ACTION,
  validateCalendarWatchInput,
  withCalendarWatch,
} from "./pure";

export type CalendarWatchSettingsErrorCode = "READER_NOT_CONNECTED" | "CALENDAR_NOT_ACCESSIBLE" | "INVALID_SETTINGS" | "GOOGLE_API_ERROR" | "NOT_FOUND";

export type SaveSettingsResult =
  | { ok: true; settings: ReturnType<typeof publicView> }
  | { ok: false; status: number; code: CalendarWatchSettingsErrorCode; message: string };

export interface SettingsDeps {
  listCalendars?: (userId: string) => Promise<GoogleCalendarInfo[]>;
  hasProvider?: (userId: string) => Promise<boolean>;
}

async function defaultHasProvider(userId: string): Promise<boolean> {
  const p = await getGoogleProvider(userId);
  return Boolean(p?.accessToken);
}

export async function loadCalendarWatchSettings(orgId: string) {
  const org = await db.organization.findUnique({ where: { id: orgId }, select: { settingsJson: true } });
  if (!org) return null;
  return publicView(readCalendarWatch(org.settingsJson));
}

/**
 * 校验并保存：字段合法 → 合并后为开启时查读取账号的 Google 连接与日历可见性 → 写回（保留游标）→ 审计。
 * 合并后为关闭时不查 Google，保证 { enabled: false } 回滚不被失效的授权挡住。
 */
export async function saveCalendarWatchSettings(input: {
  orgId: string;
  actorUserId: string;
  body: unknown;
  deps?: SettingsDeps;
}): Promise<SaveSettingsResult> {
  const { orgId } = input;
  const org = await db.organization.findUnique({ where: { id: orgId }, select: { settingsJson: true } });
  if (!org) return { ok: false, status: 404, code: "NOT_FOUND", message: "组织不存在" };

  const [members, profiles] = await Promise.all([
    db.organizationMember.findMany({
      where: { orgId, status: "active", user: { status: "active" } },
      select: { userId: true },
    }),
    db.roleProfile.findMany({ where: { orgId, status: "active" }, select: { key: true } }),
  ]);
  const current = readCalendarWatch(org.settingsJson);
  const v = validateCalendarWatchInput(input.body, current, {
    activeMemberIds: new Set(members.map((m) => m.userId)),
    positionKeys: new Set(profiles.map((p) => p.key)),
  });
  if (!v.ok) return { ok: false, status: 400, code: v.code ?? "INVALID_SETTINGS", message: v.message };
  const fields = v.fields;

  if (fields.enabled && fields.readerUserId) {
    const hasProvider = input.deps?.hasProvider ?? defaultHasProvider;
    const listCalendars = input.deps?.listCalendars ?? listGoogleCalendars;
    if (!(await hasProvider(fields.readerUserId))) {
      return { ok: false, status: 400, code: "READER_NOT_CONNECTED", message: "读取账号还没有在青砚连接 Google 日历" };
    }
    let calendars: GoogleCalendarInfo[];
    try {
      calendars = await listCalendars(fields.readerUserId);
    } catch (err) {
      if (err instanceof GoogleTokenExpiredError) {
        return { ok: false, status: 400, code: "READER_NOT_CONNECTED", message: "读取账号的 Google 日历授权已失效，请重新连接" };
      }
      return { ok: false, status: 502, code: "GOOGLE_API_ERROR", message: err instanceof Error ? err.message : "Google 日历列表读取失败" };
    }
    const visible = new Set(calendars.map((c) => c.id));
    const missing = fields.calendarIds.filter((id) => !visible.has(id));
    if (missing.length) {
      return { ok: false, status: 400, code: "CALENDAR_NOT_ACCESSIBLE", message: `读取账号看不到这些日历：${missing.join("、")}` };
    }
  }

  // 写回前重读一次，减少与执行器回写游标的竞争窗口
  const fresh = await db.organization.findUnique({ where: { id: orgId }, select: { settingsJson: true } });
  const latest = readCalendarWatch(fresh?.settingsJson ?? null);
  const next = applySettingsUpdate(latest, fields);
  await db.organization.update({
    where: { id: orgId },
    data: { settingsJson: withCalendarWatch(fresh?.settingsJson ?? null, next) as object },
  });
  const before = publicView(latest);
  const after = publicView(next);
  await writeAuditLog(db, {
    userId: input.actorUserId,
    orgId,
    action: SETTINGS_AUDIT_ACTION,
    targetType: "organization_calendar_watch",
    targetId: orgId,
    beforeData: before,
    afterData: after,
  });
  return { ok: true, settings: after };
}
