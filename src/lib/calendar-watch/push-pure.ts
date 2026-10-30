/**
 * CAL-3 日历变更推送（纯函数）：渠道选择、推送文案（不含邮箱）、Muse 事件输入。spec calendar/change-push
 *
 * 收件人、时机与条数沿用 CAL-1；这里只决定"走 Muse 还是站内"和"推什么字"。
 */

import { buildMuseEvent, type EmitMuseEventInput } from "@/lib/muse-bridge/events-pure";
import { SOURCE_LABEL } from "./pure";
import type { CalendarNotificationDraft, LedgerAfterData } from "./types";

export type PushChannel = "muse" | "site";

/** 每轮最多推几条微信：批量导入 / 删除时不刷屏、不拖垮 cron；超出的只在站内 / Muse */
export const MAX_WECHAT_PUSHES_PER_RUN = 30;

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

/** 本地部分 + @ + 任意（可为空）域名：标题截断在邮箱中间（`john@acme`、`john@`）也要盖住 */
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]*/g;
export const maskEmails = (text: string) => text.replace(EMAIL, "[邮箱]");

/**
 * 微信 / Muse 文案：标题沿用 CAL-1 通知标题，正文只有来源与命中规则（不带创建者邮箱）；
 * 标题里可能出现的邮箱（创建者未匹配到成员姓名、或日程标题手写了邮箱）一律替换。
 */
export function pushText(draft: CalendarNotificationDraft, entry: LedgerAfterData): { title: string; body: string } {
  const body = `来源：${SOURCE_LABEL[entry.attribution.source] ?? entry.attribution.source}（${entry.attribution.rule}）`;
  return { title: maskEmails(draft.title), body: maskEmails(body) };
}

/** 事件发生时间：Google 更新时间，缺失或不合法时用本轮时间 */
export function occurredAtOf(updated: string | null | undefined, now: Date): Date {
  const ms = Date.parse(updated ?? "");
  return Number.isFinite(ms) ? new Date(ms) : now;
}

/**
 * 能否走 Muse：信封成立，且摘要不会被出站脱敏整段替换
 *（否则已绑定的人铃铛里只剩一句脱敏提示，看不到改了什么——改走站内）
 */
export function museEnvelopeClean(input: EmitMuseEventInput): boolean {
  const env = buildMuseEvent(input);
  return env !== null && env.summary === input.summary.slice(0, 300);
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
