/**
 * KPI-2 期间看板 AI 解读（OpenSpec change sales-period-narrative）— 纯函数核心（零 DB、零网络）。
 *
 * 数字只来自 KPI-1：模型输出里每个数字都要能在输入里找到，任何校验不过整段丢弃（narrative = null）。
 * config.yaml 第 7 条的唯一例外就是这里，见 change design D1。
 */

import { INSIGHT_THRESHOLDS } from "./insights";
import type { PeriodSummaryResponse } from "./load";
import { STALE_OPEN_DAYS } from "./summary-pure";
import type { PeriodCompareKind } from "./types";

export const NARRATIVE_ENV_FLAG = "SALES_PERIOD_NARRATIVE_ENABLED";
export const NARRATIVE_AUDIT_ACTION = "sales.period_narrative.generated";
export const NARRATIVE_WORKFLOW = "sales_period_narrative";
export const MAX_ITEMS = 3;
export const MAX_TEXT_CHARS = 200;

export const NARRATIVE_ACTIONS = ["chase_signature", "record_deposit", "review_rep", "fix_calendar_rule"] as const;
export type NarrativeAction = (typeof NARRATIVE_ACTIONS)[number];

export const ACTION_LABELS: Record<NarrativeAction, string> = {
  chase_signature: "催签",
  record_deposit: "补定金",
  review_rep: "看某销售",
  fix_calendar_rule: "补日程规则",
};

export type NarrativeFallbackReason =
  | "invalid_format"
  | "invalid_numbers"
  | "invalid_reference"
  | "model_error"
  | "budget_exceeded";

export interface PeriodNarrative {
  conclusion: string[];
  reasons: Array<{ text: string; insightCodes: string[] }>;
  nextSteps: Array<{ action: NarrativeAction; label: string; text: string; repName: string | null }>;
  model: string;
  generatedAt: string;
}

export interface NarrativeResult {
  narrative: PeriodNarrative | null;
  fallbackReason: NarrativeFallbackReason | null;
}

/** 开关：环境变量严格等于 "true" 才开 */
export function isPeriodNarrativeEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env[NARRATIVE_ENV_FLAG] === "true";
}

// ── 模型输入投影 ────────────────────────────────────────────────

export interface NarrativeInput {
  period: { from: string; to: string; days: number; timezone: string };
  scope: "org" | "own";
  comparison: { kind: PeriodCompareKind; from: string; to: string; totals: Record<string, number | null>; delta: Record<string, number | null> };
  totals: Record<string, number | null>;
  byRep: Array<{ name: string; wonCount: number; wonAmount: number; quotedCount: number; quotedAmount: number; conversionRate: number | null }>;
  insights: Array<{ code: string; severity: string; text: string; evidence: Record<string, number | string | null> }>;
  calendar: { bySource: Record<string, number>; byActor: Array<{ name: string; bucket: string | null; created: number }> } | null;
  thresholds: Record<string, number>;
  allowedActions: NarrativeAction[];
  truncated: boolean;
}

/** 下一步动作的前提：只有输入支持的动作才给模型选 */
export function allowedActionsFor(summary: PeriodSummaryResponse): NarrativeAction[] {
  const out: NarrativeAction[] = [];
  if (summary.totals.openQuotedCount > 0) out.push("chase_signature");
  if (summary.totals.wonWithoutDepositCount > 0) out.push("record_deposit");
  if (summary.scope === "org" && summary.byRep.length > 0) out.push("review_rep");
  if (summary.scope === "org" && (summary.calendar?.bySource.unknown ?? 0) > 0) out.push("fix_calendar_rule");
  return out;
}

/**
 * 只取聚合数字、销售姓名（本人范围只有本人一行）与洞察；不含 userId、客户、报价行、毛利与成本。
 * 日程来源只在全企业范围给出。
 */
export function projectNarrativeInput(summary: PeriodSummaryResponse): NarrativeInput {
  const org = summary.scope === "org";
  return {
    period: { ...summary.period },
    scope: summary.scope,
    comparison: {
      kind: summary.comparison.kind,
      from: summary.comparison.period.from,
      to: summary.comparison.period.to,
      totals: { ...summary.comparison.totals },
      delta: { ...summary.comparison.delta },
    },
    totals: { ...summary.totals },
    byRep: summary.byRep.map((r) => ({
      name: r.name,
      wonCount: r.wonCount,
      wonAmount: r.wonAmount,
      quotedCount: r.quotedCount,
      quotedAmount: r.quotedAmount,
      conversionRate: r.conversionRate,
    })),
    insights: summary.insights.map((i) => ({ code: i.code, severity: i.severity, text: i.text, evidence: { ...i.evidence } })),
    calendar:
      org && summary.calendar
        ? {
            bySource: { ...summary.calendar.bySource },
            byActor: (summary.calendar.byActor ?? []).map((a) => ({ name: a.name, bucket: a.bucket, created: a.created })),
          }
        : null,
    thresholds: { ...INSIGHT_THRESHOLDS, staleOpenDays: STALE_OPEN_DAYS },
    allowedActions: allowedActionsFor(summary),
    truncated: summary.truncated,
  };
}

// ── 提示词 ──────────────────────────────────────────────────────

export const NARRATIVE_SYSTEM_PROMPT = [
  "你是青砚的销售数据解读助手。用户消息是一段 JSON：某企业在某个期间已经算好的销售汇总（totals）、对比期（comparison）、按人数据（byRep）、确定性洞察（insights）、日程来源（calendar）、阈值（thresholds）和允许的下一步动作（allowedActions）。",
  "请只根据这段 JSON 写一段简短解读，严格遵守以下规则：",
  '1. 只输出一个 JSON 对象，不要任何其它文字，不要 Markdown。格式：{"conclusion": ["…"], "reasons": [{"text": "…", "insightCodes": ["I3_STALE_OPEN"]}], "nextSteps": [{"action": "chase_signature", "text": "…", "repName": null}]}',
  "2. conclusion：本期结论，1 到 3 句。",
  "3. reasons：原因，0 到 3 条；每条的 insightCodes 必须从输入 insights 的 code 里选，至少一个；输入没有洞察时 reasons 为空数组。",
  "4. nextSteps：下一步，0 到 3 条；action 只能从输入 allowedActions 里选；action 为 review_rep 时 repName 必须是输入 byRep 里的某个 name，其它动作 repName 为 null；allowedActions 为空时 nextSteps 为空数组。",
  "5. 数字：只能使用输入 JSON 里出现过的数字，可以四舍五入、加千分位、把比例写成百分比；不得计算任何新数字（不要相加、相减、求平均、求差）；所有数量都用阿拉伯数字，不要写“一位”“两份”“三成”这类中文数字。",
  "6. 每段文字不超过 200 字，用中文；金额单位是加元。",
  "7. 不要提及客户，不要编造输入里没有的事实。",
].join("\n");

export function buildNarrativeUserPrompt(input: NarrativeInput): string {
  return JSON.stringify(input);
}

// ── 解析 ────────────────────────────────────────────────────────

interface RawNarrative {
  conclusion: string[];
  reasons: Array<{ text: string; insightCodes: string[] }>;
  nextSteps: Array<{ action: string; text: string; repName: string | null }>;
}

function isText(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0 && [...v].length <= MAX_TEXT_CHARS;
}

/** 去围栏、取首个 { 到最后一个 }，解析并检查结构、条数与长度 */
export function parseNarrativeOutput(raw: string): RawNarrative | null {
  if (typeof raw !== "string") return null;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const conclusion = o.conclusion;
  if (!Array.isArray(conclusion) || conclusion.length < 1 || conclusion.length > MAX_ITEMS || !conclusion.every(isText)) return null;
  const reasonsRaw = o.reasons ?? [];
  const stepsRaw = o.nextSteps ?? [];
  if (!Array.isArray(reasonsRaw) || reasonsRaw.length > MAX_ITEMS) return null;
  if (!Array.isArray(stepsRaw) || stepsRaw.length > MAX_ITEMS) return null;
  const reasons: RawNarrative["reasons"] = [];
  for (const r of reasonsRaw) {
    if (!r || typeof r !== "object") return null;
    const rr = r as Record<string, unknown>;
    if (!isText(rr.text) || !Array.isArray(rr.insightCodes) || !rr.insightCodes.every((c) => typeof c === "string")) return null;
    reasons.push({ text: rr.text, insightCodes: rr.insightCodes as string[] });
  }
  const nextSteps: RawNarrative["nextSteps"] = [];
  for (const s of stepsRaw) {
    if (!s || typeof s !== "object") return null;
    const ss = s as Record<string, unknown>;
    if (typeof ss.action !== "string" || !isText(ss.text)) return null;
    if (ss.repName !== undefined && ss.repName !== null && typeof ss.repName !== "string") return null;
    nextSteps.push({ action: ss.action, text: ss.text, repName: typeof ss.repName === "string" && ss.repName ? ss.repName : null });
  }
  return { conclusion: conclusion as string[], reasons, nextSteps };
}

// ── 引用与词表 ──────────────────────────────────────────────────

/** 原因至少引用一个输入里的洞察代码；动作在 allowedActions 内；review_rep 的姓名在按人表中，其它动作不带姓名 */
export function checkReferences(raw: RawNarrative, input: NarrativeInput): boolean {
  const codes = new Set(input.insights.map((i) => i.code));
  for (const r of raw.reasons) {
    if (r.insightCodes.length === 0 || !r.insightCodes.every((c) => codes.has(c))) return false;
  }
  const allowed = new Set<string>(input.allowedActions);
  const names = new Set(input.byRep.map((r) => r.name));
  for (const s of raw.nextSteps) {
    if (!allowed.has(s.action)) return false;
    if (s.action === "review_rep") {
      if (!s.repName || !names.has(s.repName)) return false;
    } else if (s.repName) {
      return false;
    }
  }
  return true;
}

// ── 数字比对 ────────────────────────────────────────────────────

export interface NumberToken {
  raw: string;
  value: number;
  decimals: number;
  unit: "" | "%" | "万";
}

/** 中文数字 + 计量词一律拒绝（宁可误杀，回落是安全方向） */
export const CHINESE_NUMERAL_RE = /[零〇一二两三四五六七八九十百千万亿]+[份单条个位天名次笔倍成]/;

const INSIGHT_CODE_RE = /\bI\d+_[A-Z0-9_]+\b/g;
const NUMBER_RE = /(?:C\$|CA\$|\$|CAD\s?)?\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?\s?(%|％|万)?/g;

/** 文本里的数字（去掉洞察代码后切词；千分位与货币符号不计，按绝对值） */
export function extractNumberTokens(text: string): NumberToken[] {
  const out: NumberToken[] = [];
  const cleaned = text.replace(INSIGHT_CODE_RE, " ");
  for (const m of cleaned.matchAll(NUMBER_RE)) {
    const intPart = m[1].replace(/,/g, "");
    const frac = m[2] ?? "";
    const unit = m[3] === "％" ? "%" : ((m[3] ?? "") as NumberToken["unit"]);
    out.push({ raw: m[0].trim(), value: Number(frac ? `${intPart}.${frac}` : intPart), decimals: frac.length, unit });
  }
  return out;
}

function roundTo(v: number, d: number): number {
  const f = 10 ** d;
  return Math.round((Math.abs(v) + Number.EPSILON) * f) / f;
}

function same(a: number, b: number): boolean {
  return Math.abs(a - b) < 1e-9 * Math.max(1, Math.abs(b));
}

/** 输入里所有数值：递归收集数字字段，并从字符串（洞察文字、日期）里切出数字 */
export function collectInputNumbers(input: NarrativeInput): number[] {
  const out: number[] = [];
  const walk = (v: unknown) => {
    if (typeof v === "number") {
      if (Number.isFinite(v)) out.push(v);
    } else if (typeof v === "string") {
      for (const d of v.split(/[-/]/)) if (/^\d+$/.test(d)) out.push(Number(d));
      for (const t of extractNumberTokens(v)) out.push(t.value);
    } else if (Array.isArray(v)) {
      v.forEach(walk);
    } else if (v && typeof v === "object") {
      Object.values(v).forEach(walk);
    }
  };
  walk({ ...input, allowedActions: [] });
  return out;
}

/** 一个数字 x（d 位小数）命中：原值 / ×100 写成百分比 / ÷10000 写成万，按 d 位取整后相等 */
export function isAllowedNumber(token: NumberToken, inputNumbers: readonly number[]): boolean {
  const d = token.decimals;
  const x = token.value;
  for (const v of inputNumbers) {
    if (token.unit === "万") {
      if (same(roundTo(v / 10000, d), x)) return true;
      continue;
    }
    if (same(roundTo(v, d), x)) return true;
    if (token.unit === "%" && same(roundTo(v * 100, d), x)) return true;
  }
  return false;
}

/** 返回第一处对不上的数字；全部命中返回 null */
export function findUnknownNumber(texts: readonly string[], input: NarrativeInput): string | null {
  const numbers = collectInputNumbers(input);
  for (const text of texts) {
    const zh = text.match(CHINESE_NUMERAL_RE);
    if (zh) return zh[0];
    for (const t of extractNumberTokens(text)) {
      if (!isAllowedNumber(t, numbers)) return t.raw;
    }
  }
  return null;
}

// ── 汇总 ────────────────────────────────────────────────────────

/** 解析 → 引用与词表 → 数字；任一不过整段丢弃 */
export function finalizeNarrative(params: { rawText: string; input: NarrativeInput; model: string; now: Date }): NarrativeResult {
  const raw = parseNarrativeOutput(params.rawText);
  if (!raw) return { narrative: null, fallbackReason: "invalid_format" };
  if (!checkReferences(raw, params.input)) return { narrative: null, fallbackReason: "invalid_reference" };
  const texts = [...raw.conclusion, ...raw.reasons.map((r) => r.text), ...raw.nextSteps.map((s) => s.text)];
  if (findUnknownNumber(texts, params.input) !== null) return { narrative: null, fallbackReason: "invalid_numbers" };
  return {
    narrative: {
      conclusion: raw.conclusion,
      reasons: raw.reasons,
      nextSteps: raw.nextSteps.map((s) => ({
        action: s.action as NarrativeAction,
        label: ACTION_LABELS[s.action as NarrativeAction],
        text: s.text,
        repName: s.repName,
      })),
      model: params.model,
      generatedAt: params.now.toISOString(),
    },
    fallbackReason: null,
  };
}

/** 模型调用异常 → 回落原因（月费用硬上限的报错以"配额限制"开头） */
export function fallbackForError(err: unknown): NarrativeFallbackReason {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.startsWith("配额限制") ? "budget_exceeded" : "model_error";
}
