/**
 * RFQ-AUTO-3 个人开关「自动起草的轮次带跟进授权」— 纯逻辑（读 / 写组织设置里的那一格）
 *
 * 存在 Organization.settingsJson.tenderRfq.autoDraftFollowUp[userId]（零 schema）：
 *   开 = { enabled: true, at: ISO 时间 }；关 = 没有这个键。
 * 默认关。读的时候严格解析：形状不对一律当作关。写的时候只动本人的那一格，
 * tenderRfq 下的其它设置、别人的开关、settingsJson 的其它键都原样保留。
 *
 * 不放进 museBridge.userPrefs：那一份只认四个字段，Muse 下一次写偏好会把多出来的键丢掉；
 * 而且那里的键能在 Muse 里改，这个开关只能由本人在网页上（看得到授权范围与模板的地方）开。
 */

export const AUTO_DRAFT_OPTIN_KEY = "autoDraftFollowUp" as const;
export const AUTO_DRAFT_OPTIN_AUDIT_ACTION = "tender.rfq_followup.auto_draft_optin" as const;

const asObject = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const validUserId = (userId: unknown): userId is string => typeof userId === "string" && userId.length > 0 && userId.length <= 64;

/** 这个人在这个组织里有没有开启。坏数据、别的类型、enabled 不是字面量 true，都算没开。 */
export function readAutoDraftFollowUpOptIn(settingsJson: unknown, userId: string): boolean {
  if (!validUserId(userId)) return false;
  const all = asObject(asObject(asObject(settingsJson).tenderRfq)[AUTO_DRAFT_OPTIN_KEY]);
  if (!Object.prototype.hasOwnProperty.call(all, userId)) return false;
  const mine = asObject(all[userId]);
  return mine.enabled === true && typeof mine.at === "string" && mine.at.length > 0;
}

/**
 * 写回（纯函数）。状态没变 → changed: false，next 就是传入的对象本身（调用方据此不写库、不写审计）。
 */
export function withAutoDraftFollowUpOptIn(
  settingsJson: unknown,
  userId: string,
  enabled: boolean,
  now: Date,
): { changed: boolean; next: Record<string, unknown> } {
  const base = asObject(settingsJson);
  if (!validUserId(userId) || readAutoDraftFollowUpOptIn(settingsJson, userId) === enabled) return { changed: false, next: base };
  const tenderRfq = { ...asObject(base.tenderRfq) };
  const all = { ...asObject(tenderRfq[AUTO_DRAFT_OPTIN_KEY]) };
  if (enabled) all[userId] = { enabled: true, at: now.toISOString() };
  else delete all[userId];
  if (Object.keys(all).length > 0) tenderRfq[AUTO_DRAFT_OPTIN_KEY] = all;
  else delete tenderRfq[AUTO_DRAFT_OPTIN_KEY];
  return { changed: true, next: { ...base, tenderRfq } };
}
