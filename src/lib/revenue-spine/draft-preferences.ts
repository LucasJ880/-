/**
 * Revenue Spine — FDE 首封回复草稿的团队偏好（B-3，openspec change fde-preferences-in-draft）
 *
 * 来源：revenue_spine.policy 的 fde 段（老板 / 管理员经 PUT /api/revenue/policy 写入即"已确认"），不经 employee-ai。
 * - 开关 fde.useConfirmedPreferences 关闭（默认）→ resolveDraftPreferences 返回 null，调用方不传偏好，草稿逐字节不变；
 * - 开启 → 逐条校验，违规项忽略、其余照用：
 *   文案（问候 / 结束语 / 敬语 / 替换词）过草稿守卫与买家原话风险检查，不含数字（含全角）与数字词、换行，不超长；
 *   问候含且只含一个 {name}，其它文案不含花括号；禁用词不含数字、换行；替换词不能含任何禁用词（免得链式替换）；
 *   必问 / 免问必须是可追问的 RFQ 字段，必填不能免问，与必问冲突的免问忽略，重复只算一次。
 * - 违规偏好写一条审计（只记键名与原因，不记文案），同一组织同一组违规只记一次；失败不影响起草。
 *
 * 纯函数 + 依赖可注入的审计；不调用 LLM。
 */

import { createHash } from "node:crypto";
import { unsafeToRepeat } from "./inquiry-risks";
import type { DraftPreferenceText, RevenueSpinePolicy } from "./policy";
import { checkDraftGuardrails, countBannedPhrases, type DraftTemplatePreferences } from "./reply-draft";
import { MISSING_FIELD_TIERS, type QuestionPreferences } from "./rfq/missing-info";
import type { RfqField } from "./rfq/types";

export const DRAFT_PREFERENCE_TEXT_MAX = 120;
export const BANNED_PHRASE_MIN = 2;
export const BANNED_PHRASE_MAX = 60;
export const BANNED_PHRASES_LIMIT = 30;
export const DRAFT_PREFERENCES_IGNORED_AUDIT_ACTION = "revenue_spine.draft_preferences.ignored";
export const DRAFT_PREFERENCES_AUDIT_TARGET = "revenue_spine_policy";

export interface IgnoredPreference {
  key: string;
  reason: string;
}

export interface ResolvedDraftPreferences extends DraftTemplatePreferences, QuestionPreferences {
  priorityQuestions: RfqField[];
  skippedQuestions: RfqField[];
  bannedPhrases: Array<{ phrase: string; replacement: string; key: string }>;
  /** 生效的偏好键名 */
  applied: string[];
  /** 被忽略的偏好：键名与原因（不含文案） */
  ignored: IgnoredPreference[];
}

const ASKABLE = new Map(MISSING_FIELD_TIERS.map((t) => [t.field as string, t]));
const LANGS = ["zh", "en"] as const;

/** 任何数字字符：含全角"２４"、阿拉伯-印度数字、"½"、"③"、"Ⅲ"（Unicode 数字类 \p{N}） */
const ANY_DIGIT_RE = /\p{N}/u;
/** 控制字符（换行另报），以及草稿模板挡住片段用的私用区分隔符 U+E000 / U+E001 */
const CONTROL_RE = /[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f\uE000\uE001]/;

/**
 * 偏好文案（问候 / 结束语 / 敬语 / 替换词）只是措辞，不许写出天数、数量、金额或任何商务条款。
 * 三道规则，宁可多拦：误拦只是这条偏好被忽略并记审计，管理员换个说法即可。
 * 先去掉常见的客套用语（"祝您一天愉快"、"No one"、"double-check"），免得误拦。
 */
const NUMBER_WORD_ALLOW_RE =
  /一天愉快|新的一年|一路顺风|一切|一起|一直|一定|一些|一下|一点|统一|唯一|第一时间|万事如意|十分(?!钟)|万分|千万(?![件个套米码箱只条张双对元块美欧英])|\bno one\b|\bone more\b|\bone-stop\b|\bone of\b|\bdouble[- ]check\w*/gi;
/** 英文数字词与"a week"这类数量说法 */
const NUMBER_WORD_EN_RE =
  /\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|dozens?|half|twice|double|triple|fortnight|couple|third|quarter)\b|\b(?:a|an|per|each)\s+(?:day|week|month|year|hour)s?\b/i;
/** 中文数词（含大写）：后跟单位，或连着两个以上（"五百"、"一千"、"十五"、"壹佰"） */
const ZH_NUMERAL = "〇零一二两三四五六七八九十百千万亿半壹贰叁肆伍陆柒捌玖拾佰仟";
const NUMBER_WORD_ZH_RE = new RegExp(
  `[${ZH_NUMERAL}]\\s*(?:来|多|余|几)?\\s*(?:天|日|周|星期|个月|月|年|小时|钟头|分钟|件|个|套|米|码|箱|只|条|张|双|对|美元|美金|元|块|欧元|英镑|成|折|%|％)|[${ZH_NUMERAL}]{2,}|百分之`,
);
/** 商务条款用语：起订 / 交期 / 价格 / 折扣 / 赠送 / 样品 / 运费 / 付款 / 保证 … */
const COMMERCIAL_TERM_RE =
  /起订|交期|交货|发货|出货|货期|价|折|送(?!上)|赠|免费|包邮|样品|打样|运费|付款|定金|订金|账期|保证|质保|退款|赔偿|\b(?:moq|minimum order|prices?|pricing|cost|costs|discounts?|samples?|deliver(?:y|ed|ies)?|ship(?:ping|ped|ment)?|lead[- ]time|production|payments?|deposit|warranty|guarantee[sd]?|refunds?|quot(?:e|es|ed|ation))\b|\bfree\s+(?:of|samples?|shipping|delivery)\b/i;

/** 文案的共同规则；返回违规原因，合规返回 null。{name} 由调用方先去掉 */
function textProblem(text: string): string | null {
  if (/[\r\n]/.test(text)) return "含换行";
  if (CONTROL_RE.test(text)) return "含控制字符";
  if (ANY_DIGIT_RE.test(text)) return "含数字";
  const plain = text.replace(NUMBER_WORD_ALLOW_RE, " ");
  if (NUMBER_WORD_EN_RE.test(plain) || NUMBER_WORD_ZH_RE.test(plain)) return "含数字词";
  if (text.length > DRAFT_PREFERENCE_TEXT_MAX) return `超过 ${DRAFT_PREFERENCE_TEXT_MAX} 字`;
  const violations = checkDraftGuardrails(text);
  if (violations.length) return `含商务承诺：${violations.join("、")}`;
  if (COMMERCIAL_TERM_RE.test(text)) return "含商务条款用语";
  if (unsafeToRepeat(text)) return "含不宜写进邮件的内容";
  return null;
}

function greetingProblem(text: string): string | null {
  const names = text.split("{name}").length - 1;
  if (names === 0) return "缺少 {name}";
  if (names > 1) return "{name} 只能出现一次";
  const rest = text.replace("{name}", "");
  if (/[{}]/.test(rest)) return "不能含其它花括号";
  return textProblem(rest);
}

function plainTextProblem(text: string): string | null {
  if (/[{}]/.test(text)) return "不能含花括号";
  return textProblem(text);
}

/**
 * 解析并校验偏好。开关关闭返回 null（调用方据此完全不改草稿）。
 * 确定性：同一 policy 永远得到同一结果，ignored 按偏好出现顺序。
 */
export function resolveDraftPreferences(policy: Pick<RevenueSpinePolicy, "fde">): ResolvedDraftPreferences | null {
  const fde = policy.fde;
  if (!fde?.useConfirmedPreferences) return null;
  const p = fde.preferences;
  const applied: string[] = [];
  const ignored: IgnoredPreference[] = [];

  const texts = (name: "greeting" | "closing" | "valediction", check: (t: string) => string | null): DraftPreferenceText => {
    const out: DraftPreferenceText = { zh: null, en: null };
    for (const lang of LANGS) {
      const raw = p[name]?.[lang];
      if (raw === null || raw === undefined) continue;
      const key = `${name}.${lang}`;
      const value = raw.trim();
      const problem = value ? check(value) : "为空";
      if (problem) ignored.push({ key, reason: problem });
      else {
        out[lang] = value;
        applied.push(key);
      }
    }
    return out;
  };
  const greeting = texts("greeting", greetingProblem);
  const closing = texts("closing", plainTextProblem);
  const valediction = texts("valediction", plainTextProblem);

  const priorityQuestions: RfqField[] = [];
  p.priorityQuestions.forEach((raw, i) => {
    const key = `priorityQuestions[${i}]`;
    const f = raw.trim();
    if (!ASKABLE.has(f)) ignored.push({ key, reason: "不是可追问的字段" });
    else if (priorityQuestions.includes(f as RfqField)) ignored.push({ key, reason: "重复" });
    else priorityQuestions.push(f as RfqField);
  });
  const skippedQuestions: RfqField[] = [];
  p.skippedQuestions.forEach((raw, i) => {
    const key = `skippedQuestions[${i}]`;
    const f = raw.trim();
    const tier = ASKABLE.get(f);
    if (!tier) ignored.push({ key, reason: "不是可追问的字段" });
    else if (tier.required) ignored.push({ key, reason: "必填字段不能免问" });
    else if (priorityQuestions.includes(f as RfqField)) ignored.push({ key, reason: "与必问冲突" });
    else if (skippedQuestions.includes(f as RfqField)) ignored.push({ key, reason: "重复" });
    else skippedQuestions.push(f as RfqField);
  });
  if (priorityQuestions.length) applied.push("priorityQuestions");
  if (skippedQuestions.length) applied.push("skippedQuestions");

  const candidates: Array<{ key: string; phrase: string; replacement: string }> = [];
  p.bannedPhrases.forEach((b, i) => {
    const key = `bannedPhrases[${i}]`;
    const phrase = b.phrase.trim();
    const replacement = b.replacement.trim();
    let problem: string | null = null;
    if (candidates.length >= BANNED_PHRASES_LIMIT) problem = `超出上限（${BANNED_PHRASES_LIMIT} 条）`;
    else if (/[\r\n]/.test(phrase)) problem = "禁用词含换行";
    else if (CONTROL_RE.test(phrase)) problem = "禁用词含控制字符";
    else if (ANY_DIGIT_RE.test(phrase)) problem = "禁用词含数字";
    else if (phrase.length < BANNED_PHRASE_MIN || phrase.length > BANNED_PHRASE_MAX) problem = `禁用词长度须为 ${BANNED_PHRASE_MIN}–${BANNED_PHRASE_MAX} 字`;
    else if (candidates.some((x) => x.phrase.toLowerCase() === phrase.toLowerCase())) problem = "重复";
    else if (replacement) {
      const r = plainTextProblem(replacement);
      if (r) problem = `替换词${r}`;
    }
    if (problem) ignored.push({ key, reason: problem });
    else candidates.push({ key, phrase, replacement });
  });
  // 替换词里含任何禁用词（含自己）会链式替换（A→B 之后 B→C），这样的条目整条忽略。
  // 上限按通过前面规则的条数算（链式被拒的也占名额）
  const allPhrases = candidates.map((c) => c.phrase);
  const bannedPhrases: Array<{ phrase: string; replacement: string; key: string }> = [];
  for (const c of candidates) {
    if (c.replacement && countBannedPhrases(c.replacement, allPhrases) > 0) ignored.push({ key: c.key, reason: "替换词含禁用词" });
    else bannedPhrases.push(c);
  }
  // ignored 按偏好出现顺序：禁用词的条目按下标排回原位
  const bannedIndex = (k: string) => Number(/^bannedPhrases\[(\d+)\]$/.exec(k)?.[1] ?? -1);
  const firstBanned = ignored.findIndex((i) => bannedIndex(i.key) >= 0);
  if (firstBanned >= 0) ignored.splice(firstBanned, ignored.length - firstBanned, ...ignored.slice(firstBanned).sort((a, b) => bannedIndex(a.key) - bannedIndex(b.key)));
  if (bannedPhrases.length) applied.push("bannedPhrases");

  return { greeting, closing, valediction, priorityQuestions, skippedQuestions, bannedPhrases, applied, ignored };
}

// ── 违规审计 ───────────────────────────────────────────────

/** 禁用词替换后草稿多出守卫违规、这一封没做替换（buildReplyDraft 的 bannedPhrasesSkipped，按引起违规的键名）时记的原因 */
export const BANNED_PHRASE_SKIPPED_REASON = "替换后草稿多出守卫违规，本封未替换";

/** 同一组违规的指纹（与顺序无关） */
export function ignoredFingerprint(ignored: readonly IgnoredPreference[]): string {
  const canon = ignored.map((i) => `${i.key}|${i.reason}`).sort().join("\n");
  return `prefs-ignored:${createHash("sha256").update(canon).digest("hex").slice(0, 16)}`;
}

export function ignoredAuditWhere(orgId: string, fingerprint: string) {
  return {
    orgId,
    action: DRAFT_PREFERENCES_IGNORED_AUDIT_ACTION,
    targetType: DRAFT_PREFERENCES_AUDIT_TARGET,
    targetId: orgId,
    afterData: { contains: fingerprint },
  };
}

export interface IgnoredAuditDeps {
  alreadyRecorded(orgId: string, fingerprint: string): Promise<boolean>;
  audit(input: { userId: string; orgId: string; afterData: Record<string, unknown> }): Promise<void>;
}

/** 有违规偏好时记一条审计（同组织同一组违规只记一次）；返回是否新写了审计 */
export async function recordIgnoredDraftPreferences(
  input: { orgId: string; userId: string; ignored: readonly IgnoredPreference[]; employeeKey: string },
  deps: IgnoredAuditDeps = defaultIgnoredAuditDeps(),
): Promise<boolean> {
  if (!input.ignored.length) return false;
  const fingerprint = ignoredFingerprint(input.ignored);
  if (await deps.alreadyRecorded(input.orgId, fingerprint)) return false;
  await deps.audit({
    userId: input.userId,
    orgId: input.orgId,
    afterData: { fingerprint, ignored: input.ignored.slice(0, 50).map((i) => ({ key: i.key, reason: i.reason })), employeeKey: input.employeeKey },
  });
  return true;
}

/** 尽力而为：审计失败只记日志，不影响起草 */
export async function recordIgnoredDraftPreferencesSafe(
  input: Parameters<typeof recordIgnoredDraftPreferences>[0],
  deps?: IgnoredAuditDeps,
): Promise<boolean> {
  try {
    return await recordIgnoredDraftPreferences(input, deps);
  } catch (err) {
    console.warn("[draft-preferences] 违规偏好审计失败", input.orgId, err instanceof Error ? err.name : typeof err);
    return false;
  }
}

export function defaultIgnoredAuditDeps(): IgnoredAuditDeps {
  return {
    alreadyRecorded: async (orgId, fingerprint) => {
      const { db } = await import("@/lib/db");
      return Boolean(await db.auditLog.findFirst({ where: ignoredAuditWhere(orgId, fingerprint), select: { id: true } }));
    },
    audit: async (input) => {
      const { logAudit } = await import("@/lib/audit/logger");
      await logAudit({
        userId: input.userId,
        orgId: input.orgId,
        action: DRAFT_PREFERENCES_IGNORED_AUDIT_ACTION,
        targetType: DRAFT_PREFERENCES_AUDIT_TARGET,
        targetId: input.orgId,
        afterData: input.afterData,
      });
    },
  };
}
