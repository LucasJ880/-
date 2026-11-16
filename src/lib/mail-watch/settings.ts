/**
 * MAIL-2 客户来信提醒的配置：组织开关与成员本人的勾选（spec mail/inbound-watch）。
 *
 * 配置与游标存 Organization.settingsJson.mailWatch，所有写入经 mutateOrgSettings（锁行 → 读最新 → 只改自己那块）：
 *   - 组织开关只改 enabled，不动任何成员的勾选与游标；
 *   - 成员勾选只增删本人那一项，取消勾选即连游标一起删除。
 * userId 只取调用方传入的登录态，本文件不读请求体里的任何用户标识。
 */

import { db } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit/logger";
import { getEmailProvider, hasGmailReadScope } from "@/lib/google-email";
import { mutateOrgSettings } from "@/lib/organizations/settings-write";
import {
  SETTINGS_AUDIT_ACTION,
  SETTINGS_TARGET_TYPE,
  optIn,
  optOut,
  publicOrgView,
  readMailWatch,
  setOrgEnabled,
  withMailWatch,
} from "./pure";
import type { MailWatchOptInStatus } from "./ui-pure";

export type OrgMailWatchView = ReturnType<typeof publicOrgView>;

export type SaveOrgResult =
  | { ok: true; settings: OrgMailWatchView }
  | { ok: false; status: number; code: "INVALID_SETTINGS" | "NOT_FOUND"; message: string };

/** 组织开关与已勾选人数（不含任何成员的用户 id 与游标）；组织不存在 → null */
export async function loadOrgMailWatch(orgId: string): Promise<OrgMailWatchView | null> {
  const org = await db.organization.findUnique({ where: { id: orgId }, select: { settingsJson: true } });
  if (!org) return null;
  return publicOrgView(readMailWatch(org.settingsJson));
}

/** 请求体只接受 { enabled: boolean }：多一个字段、少这个字段、类型不对都拒绝 */
export function parseOrgBody(body: unknown): { ok: true; enabled: boolean } | { ok: false; message: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, message: "请求体必须是 { enabled: boolean }" };
  const keys = Object.keys(body as Record<string, unknown>);
  const enabled = (body as Record<string, unknown>).enabled;
  if (keys.length !== 1 || keys[0] !== "enabled" || typeof enabled !== "boolean") {
    return { ok: false, message: "请求体只接受 enabled（布尔值）一个字段" };
  }
  return { ok: true, enabled };
}

/** 保存组织开关并写审计（保存前后的开关值） */
export async function saveOrgMailWatch(input: { orgId: string; actorUserId: string; body: unknown }): Promise<SaveOrgResult> {
  const parsed = parseOrgBody(input.body);
  if (!parsed.ok) return { ok: false, status: 400, code: "INVALID_SETTINGS", message: parsed.message };
  const res = await mutateOrgSettings(input.orgId, (fresh) => {
    const latest = readMailWatch(fresh);
    const next = setOrgEnabled(latest, parsed.enabled);
    return { next: withMailWatch(fresh, next), result: { before: latest.enabled, after: next } };
  });
  if (!res.found) return { ok: false, status: 404, code: "NOT_FOUND", message: "组织不存在" };
  await writeAuditLog(db, {
    userId: input.actorUserId,
    orgId: input.orgId,
    action: SETTINGS_AUDIT_ACTION,
    targetType: SETTINGS_TARGET_TYPE,
    targetId: input.orgId,
    beforeData: { enabled: res.result.before },
    afterData: { enabled: res.result.after.enabled },
  });
  return { ok: true, settings: publicOrgView(res.result.after) };
}

/** 请求体里只取 optedIn（布尔值）；其它字段——包括任何用户标识——一律不看 */
export function parseOptInBody(body: unknown): { ok: true; optedIn: boolean } | { ok: false; message: string } {
  const optedIn = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>).optedIn : undefined;
  if (typeof optedIn !== "boolean") return { ok: false, message: "请求体需要 optedIn（布尔值）" };
  return { ok: true, optedIn };
}

/** 当前成员在当前组织的勾选状态、组织开关与本人邮箱的读信权限状态 */
export async function loadMemberOptIn(input: { orgId: string; userId: string; canManageOrg: boolean }): Promise<MailWatchOptInStatus | null> {
  const [org, provider] = await Promise.all([
    db.organization.findUnique({ where: { id: input.orgId }, select: { settingsJson: true } }),
    getEmailProvider(input.userId),
  ]);
  if (!org) return null;
  const config = readMailWatch(org.settingsJson);
  const gmailConnected = Boolean(provider?.accessToken);
  return {
    orgEnabled: config.enabled,
    optedIn: Boolean(config.mailboxes[input.userId]),
    gmailConnected,
    hasReadScope: gmailConnected && hasGmailReadScope(provider?.grantedScopes),
    canManageOrg: input.canManageOrg,
  };
}

/**
 * 勾选 / 取消勾选本人。勾选不重置已有的游标；取消勾选连游标一起删除。
 * 组织开关没开时也允许勾选（三道开关缺一不读，勾选本身不产生任何读取）；页面上此时不可勾。
 */
export async function saveMemberOptIn(input: { orgId: string; userId: string; optedIn: boolean; now?: Date }): Promise<{ found: boolean }> {
  const now = input.now ?? new Date();
  const res = await mutateOrgSettings(input.orgId, (fresh) => {
    const latest = readMailWatch(fresh);
    const next = input.optedIn ? optIn(latest, input.userId, now) : optOut(latest, input.userId);
    // 没有变化就不写
    if (next === latest) return { result: null };
    return { next: withMailWatch(fresh, next), result: null };
  });
  return { found: res.found };
}
