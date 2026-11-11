/**
 * RFQ-AUTO-3 个人开关「自动起草的轮次带跟进授权」— 纯逻辑（记录的形状与状态判定）
 *
 * 状态 = 这个人在这个组织里最近一条开关记录（AuditLog，零 schema；与 RFQ-AUTO-1「停止自动跟进」同一做法：记录即状态）。
 * 只追加、不改写——不放进 Organization.settingsJson：那一块被好几处整块读、整块写（定时任务的游标、Muse 的偏好与绑定、
 * 管理员改设置……），放在里面的话，人刚关掉的开关可能被别处的一次旧数据回写悄悄恢复成开。
 *
 * 开启时记下当时的邮件模板指纹：人开启时看到的是那一版模板，模板之后改了，开关就失效（lapsed），要重新看过再开。
 */

export const AUTO_DRAFT_OPTIN_AUDIT_ACTION = "tender.rfq_followup.auto_draft_optin" as const;
/** 审计对象类型；targetId = 这个人的用户号 */
export const AUTO_DRAFT_OPTIN_TARGET = "tender_rfq_auto_followup_optin" as const;

export type OptInRecord = { enabled: boolean; templateHash: string | null };
/** off = 没开（默认）；on = 开着且模板没变；lapsed = 开过，但模板之后改了，需重新开启 */
export type OptInState = "off" | "on" | "lapsed";

const HASH_RE = /^[0-9a-f]{16}$/;

/** 写进审计 afterData 的内容：开 = { enabled: true, templateHash }；关 = { enabled: false } */
export function optInAuditData(enabled: boolean, templateHash: string): { enabled: true; templateHash: string } | { enabled: false } {
  return enabled ? { enabled: true, templateHash } : { enabled: false };
}

/**
 * 严格解析一条开关记录。形状不对（不是对象、enabled 不是布尔、开着却没有合规的模板指纹）→ null，
 * 调用方按「没开」处理。
 */
export function parseOptInRecord(afterData: string | null | undefined): OptInRecord | null {
  if (!afterData) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(afterData);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (o.enabled === false) return { enabled: false, templateHash: null };
  if (o.enabled === true && typeof o.templateHash === "string" && HASH_RE.test(o.templateHash)) return { enabled: true, templateHash: o.templateHash };
  return null;
}

/** 最近一条记录 + 现在的模板指纹 → 状态。没有记录或记录不合规 → off。 */
export function optInState(latest: OptInRecord | null, currentTemplateHash: string): OptInState {
  if (!latest || !latest.enabled) return "off";
  return latest.templateHash === currentTemplateHash ? "on" : "lapsed";
}

/** 这次设置要不要写一条新记录：状态已经是想要的那样就不写（lapsed 时开或关都要写） */
export function optInNeedsWrite(current: OptInState, enabled: boolean): boolean {
  return enabled ? current !== "on" : current !== "off";
}
