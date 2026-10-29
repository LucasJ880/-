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
  insights: Array<{ code: string; severity: string; text: string; evidence: Record<string, number | null> }>;
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
 * 只取聚合数字、成员姓名（本人范围只有本人一行）与洞察；不含 userId、邮箱、客户、报价行、毛利与成本。
 * 洞察证据只留数值；日程来源只在全企业范围给出。
 */
export function projectNarrativeInput(summary: PeriodSummaryResponse): NarrativeInput {
  const org = summary.scope === "org";
  // 姓名缺失时取数层会回落为邮箱：不发邮箱，统一换成"未命名成员 N"（同一邮箱同一代号）
  const aliases = new Map<string, string>();
  const safeName = (n: string) => {
    if (!n.includes("@")) return n;
    if (!aliases.has(n)) aliases.set(n, `未命名成员 ${aliases.size + 1}`);
    return aliases.get(n)!;
  };
  // 证据只留数值（I5 / I6 的证据里有 userId）
  const numericEvidence = (e: Record<string, number | string | null>) =>
    Object.fromEntries(Object.entries(e).filter(([, v]) => typeof v === "number" || v === null)) as Record<string, number | null>;
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
      name: safeName(r.name),
      wonCount: r.wonCount,
      wonAmount: r.wonAmount,
      quotedCount: r.quotedCount,
      quotedAmount: r.quotedAmount,
      conversionRate: r.conversionRate,
    })),
    insights: summary.insights.map((i) => ({ code: i.code, severity: i.severity, text: i.text, evidence: numericEvidence(i.evidence) })),
    calendar:
      org && summary.calendar
        ? {
            bySource: { ...summary.calendar.bySource },
            byActor: (summary.calendar.byActor ?? []).map((a) => ({ name: safeName(a.name), bucket: a.bucket, created: a.created })),
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
  "5. 数字：只能使用输入 JSON 里出现过的数字，可以四舍五入、加千分位、把比例写成百分比；不得计算任何新数字（不要相加、相减、求平均、求差）；所有数量都用阿拉伯数字，不要写“一位”“两份”“三成”“一个”“一次”“百分之”这类含中文数字的说法，也不要用英文数字词或 k、千等单位；写正负号时必须与输入的增减方向一致。",
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
  sign: "" | "+" | "-";
  unit: "" | "%" | "万";
  /** 不支持的写法（k / M 后缀、科学计数、千 / 百 / 亿 单位）：一律不命中 */
  unsupported: boolean;
}

/** 中文数字：百分之…、数字 + 数量词、数字 + 数量级（六万、二十）一律拒绝（宁可误杀，回落是安全方向） */
const ZH_PERCENT_RE = /百分之/;
const ZH_MEASURE_RE = /[零〇一二两三四五六七八九十百千万亿]+[份单条个位天名次笔倍成元周月年家件套番季日号]/;
const ZH_MAGNITUDE_RE = /[一二两三四五六七八九][十百千万亿]/;
/** 英文数字词一律拒绝 */
const EN_NUMBER_WORD_RE =
  /\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fifteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|dozen|half)\b/i;

const NUMBER_RE =
  /(?<![\d.])([+\-−])?\s?(?:C\$|CA\$|\$|CAD\s?)?\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?(?:([eE][+\-]?\d+)|\s?(%|万|千|百|亿|[kKmMbB](?![a-zA-Z])))?/g;

/** 文本里的数字（先做 NFKC：全角数字与符号按半角处理） */
export function extractNumberTokens(text: string): NumberToken[] {
  const out: NumberToken[] = [];
  for (const m of text.normalize("NFKC").matchAll(NUMBER_RE)) {
    const intPart = m[2].replace(/,/g, "");
    const frac = m[3] ?? "";
    const suffix = m[5] ?? "";
    out.push({
      raw: m[0].trim(),
      value: Number(frac ? `${intPart}.${frac}` : intPart),
      decimals: frac.length,
      sign: m[1] === "+" ? "+" : m[1] ? "-" : "",
      unit: suffix === "%" || suffix === "万" ? suffix : "",
      unsupported: Boolean(m[4]) || (suffix !== "" && suffix !== "%" && suffix !== "万"),
    });
  }
  return out;
}

/** 输入里的数值，按用途分三组：数量与金额（plain）、比率（ratios，只用于百分比写法）、洞察文字里的百分比（percents） */
export interface InputNumbers {
  plain: number[];
  ratios: number[];
  percents: number[];
}

const RATIO_KEY_RE = /rate|ratio|share/i;

/** 只收集数值字段（不从姓名、userId 等字符串里切数字）；文字只取洞察文字与日期 */
export function collectInputNumbers(input: NarrativeInput): InputNumbers {
  const out: InputNumbers = { plain: [], ratios: [], percents: [] };
  const walk = (v: unknown, key: string, ratio: boolean) => {
    if (typeof v === "number") {
      if (Number.isFinite(v)) (ratio || RATIO_KEY_RE.test(key) ? out.ratios : out.plain).push(v);
    } else if (Array.isArray(v)) {
      v.forEach((x) => walk(x, key, ratio));
    } else if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) walk(x, k, ratio);
    }
  };
  walk(input.totals, "", false);
  walk(input.comparison.totals, "", false);
  walk(input.comparison.delta, "", true);
  walk(input.byRep, "", false);
  walk(
    input.insights.map((i) => i.evidence),
    "",
    false,
  );
  walk(input.calendar, "", false);
  walk(input.thresholds, "", false);
  out.plain.push(input.period.days);
  for (const d of [input.period.from, input.period.to, input.comparison.from, input.comparison.to]) {
    for (const part of d.split("-")) if (/^\d+$/.test(part)) out.plain.push(Number(part));
  }
  for (const i of input.insights) {
    for (const t of extractNumberTokens(i.text)) (t.unit === "%" ? out.percents : out.plain).push(t.value);
  }
  return out;
}

function roundTo(v: number, d: number): number {
  const f = 10 ** d;
  return Math.round((Math.abs(v) + Number.EPSILON) * f) / f;
}

function truncTo(v: number, d: number): number {
  const f = 10 ** d;
  return Math.trunc((Math.abs(v) + Number.EPSILON) * f) / f;
}

function same(a: number, b: number): boolean {
  return Math.abs(a - b) < 1e-9 * Math.max(1, Math.abs(b));
}

/** 按 d 位四舍五入或截断后相等 */
function shown(v: number, d: number, x: number): boolean {
  return same(roundTo(v, d), x) || same(truncTo(v, d), x);
}

/** 带正负号时须与输入同号 */
function signOk(token: NumberToken, v: number): boolean {
  if (token.sign === "+") return v > 0;
  if (token.sign === "-") return v < 0;
  return true;
}

/**
 * 一个数字 x（d 位小数）命中：
 * - 百分比：比率 ×100 按 d 位取整 / 截断相等（带号须同号），或等于洞察文字里的百分比；
 * - 万：金额 ≥ 10,000 且 ÷10000 后相等，整数写法须恰好整除；
 * - 其余：数量与金额按 d 位取整 / 截断相等（带号须同号）。
 */
export function isAllowedNumber(token: NumberToken, nums: InputNumbers): boolean {
  if (token.unsupported) return false;
  const { value: x, decimals: d } = token;
  if (token.unit === "%") {
    if (nums.ratios.some((v) => signOk(token, v) && shown(v * 100, d, x))) return true;
    return token.sign === "" && nums.percents.some((p) => same(p, x));
  }
  if (token.unit === "万") {
    return nums.plain.some(
      (v) => Math.abs(v) >= 10_000 && (d >= 1 || Number.isInteger(Math.abs(v) / 10_000)) && shown(v / 10_000, d, x),
    );
  }
  return nums.plain.some((v) => signOk(token, v) && shown(v, d, x));
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 返回第一处对不上的数字或数字词；全部命中返回 null。扫描前去掉输入里的洞察代码与成员姓名 */
export function findUnknownNumber(texts: readonly string[], input: NarrativeInput): string | null {
  const nums = collectInputNumbers(input);
  const removable = [
    ...input.insights.map((i) => i.code),
    ...input.byRep.map((r) => r.name),
    ...(input.calendar?.byActor.map((a) => a.name) ?? []),
  ]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  const stripRe = removable.length ? new RegExp(removable.map(escapeRe).join("|"), "g") : null;
  for (const original of texts) {
    const text = (stripRe ? original.replace(stripRe, " ") : original).normalize("NFKC");
    const zh = text.match(ZH_PERCENT_RE) ?? text.match(ZH_MEASURE_RE) ?? text.match(ZH_MAGNITUDE_RE);
    if (zh) return zh[0];
    const en = text.match(EN_NUMBER_WORD_RE);
    if (en) return en[0];
    for (const t of extractNumberTokens(text)) {
      if (!isAllowedNumber(t, nums)) return t.raw;
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
