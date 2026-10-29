/**
 * CAL-3 日历变更推送（纯函数）：渠道选择、推送文案（不含邮箱）、Muse 事件输入。spec calendar/change-push
 *
 * 收件人、时机与条数沿用 CAL-1；这里只决定"走 Muse 还是站内"和"推什么字"。
 */

import type { EmitMuseEventInput } from "@/lib/muse-bridge/events-pure";
import { SOURCE_LABEL } from "./pure";
import type { CalendarNotificationDraft, LedgerAfterData } from "./types";

export type PushChannel = "muse" | "site";

/** Muse 开启、企业放行、收件人已绑定 → Muse；否则站内 */
export function chooseChannel(input: {
  museEnabled: boolean;
  orgAllowed: boolean;
  boundUserIds: ReadonlySet<string>;
  userId: string;
}): PushChannel {
  return input.museEnabled && input.orgAllowed && input.boundUserIds.has(input.userId) ? "muse" : "site";
}

/** Muse 事件落库用的站内通知键（与 emitMuseEvent 一致） */
export const museSourceKey = (sourceKey: string) => `muse:${sourceKey}`;

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
export const maskEmails = (text: string) => text.replace(EMAIL, "[邮箱]");

/**
 * 微信 / Muse 文案：标题沿用 CAL-1 通知标题，正文只有来源与命中规则（不带创建者邮箱）；
 * 标题里可能出现的邮箱（创建者未匹配到成员姓名、或日程标题手写了邮箱）一律替换。
 */
export function pushText(draft: CalendarNotificationDraft, entry: LedgerAfterData): { title: string; body: string } {
  const body = `来源：${SOURCE_LABEL[entry.attribution.source] ?? entry.attribution.source}（${entry.attribution.rule}）`;
  return { title: maskEmails(draft.title), body: maskEmails(body) };
}

/** `calendar.changed` 事件输入：eventId = CAL-1 通知键；只通知、不带动作 */
export function calendarChangedEventInput(input: {
  sourceKey: string;
  orgId: string;
  userId: string;
  text: { title: string; body: string };
  occurredAt: Date;
}): EmitMuseEventInput {
  return {
    eventId: input.sourceKey,
    type: "calendar.changed",
    orgId: input.orgId,
    userId: input.userId,
    summary: `${input.text.title}\n${input.text.body}`,
    occurredAt: input.occurredAt.toISOString(),
  };
}
