/**
 * FLOW-H5 两道闸生效——规则与文字（纯函数）+ 开关
 *
 * 只提醒，不拦（方案 §9 第 6 条：No-Go 常被翻案，硬拦会逼人去改记录）：
 *   - 投标决定是不投（No-Go）之后去询价或起草投标文件，页面上有一句话；
 *   - 基于还没批准的分析起草投标文件，起草前、起草后都写明「基于未确认的要求」。
 */

function envBool(v: string | undefined): boolean {
  if (!v) return false;
  const s = v.trim().toLowerCase();
  return s === "1" || s === "true" || s === "on" || s === "yes";
}

function envList(v: string | undefined): string[] {
  return (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

/**
 * TENDER_DECISION_GATES_ENABLED：未设 / 为假 = 关。
 * TENDER_DECISION_GATES_ORG_ALLOWLIST：逗号分隔的组织 id；为空 = 对所有组织生效。
 * 关闭时询价入口、起草元信息与生成的草稿都与原来相同。
 */
export function isDecisionGatesEnabledForOrgWithEnv(orgId: string | null | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!envBool(env.TENDER_DECISION_GATES_ENABLED)) return false;
  if (!orgId) return false;
  const allowlist = envList(env.TENDER_DECISION_GATES_ORG_ALLOWLIST);
  return allowlist.length === 0 || allowlist.includes(orgId);
}

export function isDecisionGatesEnabledForOrg(orgId: string | null | undefined): boolean {
  return isDecisionGatesEnabledForOrgWithEnv(orgId, process.env);
}

/** 投标决定是不投：以情报室上的决定为准（GO / HOLD / NO_GO） */
export function isNoGoDecision(goDecision: string | null | undefined): boolean {
  return goDecision === "NO_GO";
}

function dayInZone(d: Date, timeZone: string): string {
  return d.toLocaleDateString("zh-CN", { timeZone, year: "numeric", month: "long", day: "numeric" });
}

/** 询价入口上的提醒 */
export function noGoRfqReminderZh(decidedAt: Date | null, timeZone: string): string {
  return `投标决定是不投（No-Go${decidedAt ? `，${dayInZone(decidedAt, timeZone)}定的` : ""}）：照常可以询价，请确认是否还要问供应商要价`;
}

/** 投标文件起草卡片上的提醒 */
export function noGoDraftReminderZh(decidedAt: Date | null, timeZone: string): string {
  return `投标决定是不投（No-Go${decidedAt ? `，${dayInZone(decidedAt, timeZone)}定的` : ""}）：照常可以起草，请确认是否还要准备投标文件`;
}

/** 起草前：当前分析还没批准 */
export const PENDING_ANALYSIS_DRAFT_HINT_ZH = "当前分析还没批准，起草会基于未确认的要求";
/** 起草后：这份草稿基于未批准的分析 */
export const UNCONFIRMED_BASIS_DRAFT_NOTE_ZH = "这份草稿是基于还没批准的分析起草的（要求未确认）";
/** 草稿文件里的横幅（草稿本身是英文的提交稿草案） */
export const UNCONFIRMED_BASIS_BANNER_EN =
  "BASED ON UNCONFIRMED REQUIREMENTS — the tender analysis behind this draft had not been approved when it was generated. Re-check every requirement against the approved analysis before relying on this draft.";
