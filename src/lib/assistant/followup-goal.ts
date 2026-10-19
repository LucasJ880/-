/**
 * QINGYAN_ASSISTANT_DURABLE_FOLLOWUP_M1 — 目标理解与服务端计划（纯函数，零 DB / 零模型）
 *
 * 职责边界：
 *   1. 识别"批量客户跟进"这一类受支持的复合目标（不是把所有消息都硬编码成跟进）；
 *   2. 把用户**明确**要求的成果拆成受约束的交付项（分析 / 邮件草稿 / 提醒）；
 *   3. 解析用户明确给出的提醒时间（绝不替用户挑时间；时区只接受用户明说或可信组织配置）；
 *   4. 生成 ServerAuthoredPlanV1 —— 它只是"计划来源"，随后必须经过
 *      createWorkforceJob → compileServerAuthoredPlan 与 LLM 计划完全相同的共享验证链。
 *
 * 这里不调用模型：结构由确定性规则提出，服务端（job.ts / executor）负责校验
 * 身份、工具、步骤、风险与审批。超出本轮边界的要求只会被**列出**，不会被执行或省略。
 */

import {
  WORKFORCE_PLAN_CONTRACT_VERSION,
  type ServerAuthoredPlanV1,
  type ServerAuthoredTaskV1,
} from "@/lib/workforce-runtime/server-plan";
import {
  FOLLOWUP_MAX_TOP_N,
  FOLLOWUP_STEP,
  FOLLOWUP_TOOL,
  FOLLOWUP_UNSUPPORTED_LABEL,
  formatInTimezone,
  wallPartsInTz,
  type FollowupDeliverable,
  type FollowupMissingInput,
  type FollowupUnsupportedCode,
} from "./followup-contract";

export { formatInTimezone };

// ─────────────────────────── 目标识别 ───────────────────────────

const MENTIONS_CUSTOMER_RE = /(客户|商机|customer|client|lead)/i;
const MENTIONS_FOLLOWUP_RE = /(跟进|回访|follow[\s-]?up)/i;
/** "选出一批客户"的信号：只有出现选择/排序意图才进入本场景（单个具名客户仍走既有场景） */
const SELECTION_RE =
  /(找出|找到|挑出|选出|筛选|列出|排出|识别出?|哪些|哪几个|最需要|最该|最应该|最值得|最急|优先|重点|top\s*\d|需要跟进的.{0,4}(客户|商机))/i;

const NEGATION_RE = /(不要|不用|无需|不必|先别|别再?|勿|暂不|不需要|不想)/;
const CLAUSE_BREAK_RE = /[，。,.;；！!？?、\n]/;

/**
 * 匹配且未被同一分句内的前置否定修饰（"不要准备邮件草稿" / "先不要邮件和提醒"
 * ≠ 要邮件草稿/提醒）。只看同一分句内紧邻的前 8 个字符。
 */
function affirmed(text: string, re: RegExp): boolean {
  const flags = re.flags.includes("g") ? re.flags : `${re.flags}g`;
  const global = new RegExp(re.source, flags);
  for (const m of text.matchAll(global)) {
    const start = m.index ?? 0;
    let before = text.slice(Math.max(0, start - 8), start);
    const parts = before.split(CLAUSE_BREAK_RE);
    before = (parts[parts.length - 1] ?? "").replace(/\s+/g, "");
    if (!NEGATION_RE.test(before)) return true;
  }
  return false;
}

const EMAIL_DRAFT_RE =
  /((邮件|email|e-mail|gmail).{0,8}(草稿|draft))|((起草|准备|拟|写|生成).{0,10}(邮件|email))/i;
const EMAIL_SEND_RE =
  /((发送|发出|直接发|帮我发|马上发|立即发|send).{0,8}(邮件|email|gmail))|(发.{0,2}邮件)|((邮件|email).{0,6}(发出去|直接发|发送出去))/i;
const REMINDER_RE = /(提醒|reminder|日历|日程|calendar)/i;
const QUOTE_RISK_RE = /(报价.{0,6}风险|风险.{0,4}报价|quote\s*risk)/i;
const ANALYSIS_ONLY_RE = /(只|仅|先只|只需|只要)(做|要|需要)?(分析|看看|排序|列出|找出)/;

const UNSUPPORTED_PATTERNS: Array<{ code: FollowupUnsupportedCode; re: RegExp }> = [
  { code: "auto_order", re: /(自动下单|帮我下单|直接下单|下采购单|place\s+(an\s+)?order)/i },
  { code: "payment", re: /(付款|支付|转账|打款|\bpay(ment)?\b)/i },
  { code: "bulk_delete", re: /(批量删除|清空(客户|数据)|删除所有|一键删除)/ },
];

const CN_DIGITS: Record<string, number> = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
};

/** "三" / "十二" / "3" → number；无法解析 → null */
export function parseSmallNumber(raw: string): number | null {
  const s = raw.trim();
  if (/^\d{1,3}$/.test(s)) return Number(s);
  if (!s || s.length > 3) return null;
  if (s === "十") return 10;
  if (s.length === 1) return CN_DIGITS[s] ?? null;
  if (s.startsWith("十")) {
    const unit = CN_DIGITS[s[1]];
    return unit === undefined ? null : 10 + unit;
  }
  if (s.length === 2 && s[1] === "十") {
    const tens = CN_DIGITS[s[0]];
    return tens === undefined ? null : tens * 10;
  }
  if (s.length === 3 && s[1] === "十") {
    const tens = CN_DIGITS[s[0]];
    const unit = CN_DIGITS[s[2]];
    return tens === undefined || unit === undefined ? null : tens * 10 + unit;
  }
  return null;
}

const NUM = "([一二两三四五六七八九十\\d]{1,3})";
const TOP_N_PATTERNS = [
  new RegExp(`(?:前|top)\\s*${NUM}`, "i"),
  new RegExp(`${NUM}\\s*(?:个|位|家|名)[^，。,.；;]{0,8}(?:客户|商机)`),
];

function parseRequestedTopN(text: string): number | null {
  for (const re of TOP_N_PATTERNS) {
    const m = text.match(re);
    if (m) {
      const n = parseSmallNumber(m[1]);
      if (n && n > 0) return n;
    }
  }
  return null;
}

/** 是否是本轮支持的"批量客户跟进"复合目标（纯文本判定，不含权限） */
export function isFollowupBatchGoal(text: string): boolean {
  const t = text.trim();
  if (t.length < 6) return false;
  return (
    MENTIONS_CUSTOMER_RE.test(t) &&
    MENTIONS_FOLLOWUP_RE.test(t) &&
    SELECTION_RE.test(t)
  );
}

// ─────────────────────────── 时间与时区 ───────────────────────────

const TZ_ALIASES: Array<{ re: RegExp; tz: string }> = [
  { re: /(多伦多|东部时间|美东|toronto|eastern|\bE[SD]?T\b)/i, tz: "America/Toronto" },
  { re: /(温哥华|太平洋时间|美西|vancouver|pacific|\bP[SD]?T\b)/i, tz: "America/Vancouver" },
  { re: /(北京时间|中国时间|上海时间|beijing|shanghai)/i, tz: "Asia/Shanghai" },
  { re: /(\bUTC\b|\bGMT\b)/i, tz: "UTC" },
];

export function isValidTimeZone(tz: string | null | undefined): tz is string {
  if (!tz || typeof tz !== "string") return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

/** 用户在文本中**明确**给出的时区（别名或 IANA 名） */
export function resolveExplicitTimezone(text: string): string | null {
  const iana = text.match(/\b([A-Z][a-z]+\/[A-Z][A-Za-z_]+)\b/);
  if (iana && isValidTimeZone(iana[1])) return iana[1];
  for (const a of TZ_ALIASES) {
    if (a.re.test(text)) return a.tz;
  }
  return null;
}

/** 业务时区下的墙钟时间 → UTC 瞬间（DST 安全：两轮偏移校正） */
export function zonedWallTimeToUtc(
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  tz: string,
): Date {
  const target = Date.UTC(y, mo - 1, d, h, mi);
  let guess = target;
  for (let i = 0; i < 3; i++) {
    const w = wallPartsInTz(new Date(guess), tz);
    const asUtc = Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi);
    const diff = target - asUtc;
    if (diff === 0) break;
    guess += diff;
  }
  return new Date(guess);
}

type DateExpr =
  | { kind: "absolute"; y: number | null; mo: number; d: number }
  | { kind: "relative_days"; days: number }
  | { kind: "weekday"; weekday: number; nextWeek: boolean };

const WEEKDAY: Record<string, number> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  日: 7,
  天: 7,
};

function findDateExpr(text: string): DateExpr | null {
  const iso = text.match(/(\d{4})\s*[-/年.]\s*(\d{1,2})\s*[-/月.]\s*(\d{1,2})\s*[日号]?/);
  if (iso) {
    return { kind: "absolute", y: Number(iso[1]), mo: Number(iso[2]), d: Number(iso[3]) };
  }
  const md = text.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]/);
  if (md) return { kind: "absolute", y: null, mo: Number(md[1]), d: Number(md[2]) };
  const rel = text.match(/(大后天|后天|明天|今天|today|tomorrow)/i);
  if (rel) {
    const k = rel[1].toLowerCase();
    const days =
      k === "今天" || k === "today"
        ? 0
        : k === "明天" || k === "tomorrow"
          ? 1
          : k === "后天"
            ? 2
            : 3;
    return { kind: "relative_days", days };
  }
  const wk = text.match(/(下(?:个)?)?(?:周|星期|礼拜)([一二三四五六日天])/);
  if (wk) return { kind: "weekday", weekday: WEEKDAY[wk[2]], nextWeek: Boolean(wk[1]) };
  return null;
}

type TimeExpr = { h: number; mi: number };

function findTimeExpr(text: string): TimeExpr | null {
  const hhmm = text.match(/(?:^|[^\d])([01]?\d|2[0-3])\s*[:：]\s*([0-5]\d)(?!\d)/);
  const ampm = text.match(/(\d{1,2})(?::([0-5]\d))?\s*(am|pm)\b/i);
  const cn = text.match(
    /(凌晨|早上|早晨|上午|中午|下午|傍晚|晚上)?\s*([一二两三四五六七八九十\d]{1,3})\s*(?:点|时)\s*(半|(\d{1,2}|[一二三四五]十[一二三四五六七八九]?|[一二三四五六七八九十]{1,2})\s*分?)?/,
  );
  const periodBefore = text.match(/(凌晨|早上|早晨|上午|中午|下午|傍晚|晚上)/);

  let h: number | null = null;
  let mi = 0;
  let period: string | null = null;
  if (ampm) {
    h = Number(ampm[1]) % 12;
    if (ampm[3].toLowerCase() === "pm") h += 12;
    mi = ampm[2] ? Number(ampm[2]) : 0;
  } else if (hhmm) {
    h = Number(hhmm[1]);
    mi = Number(hhmm[2]);
    period = periodBefore?.[1] ?? null;
  } else if (cn) {
    const hv = parseSmallNumber(cn[2]);
    if (hv === null) return null;
    h = hv;
    period = cn[1] ?? periodBefore?.[1] ?? null;
    if (cn[3] === "半") mi = 30;
    else if (cn[4]) mi = parseSmallNumber(cn[4]) ?? 0;
  }
  if (h === null || h > 24 || mi > 59) return null;
  if (period && /下午|傍晚|晚上/.test(period) && h < 12) h += 12;
  if (period === "中午" && h < 11) h += 12;
  if (period === "凌晨" && h === 12) h = 0;
  if (h === 24) h = 0;
  return { h, mi };
}

export type ReminderTimeParse =
  | { kind: "none" }
  | { kind: "incomplete"; missing: FollowupMissingInput[]; reason: string }
  | {
      kind: "ok";
      startAt: string;
      timezone: string;
      timezoneSource: "user_explicit" | "org_profile";
      local: string;
    };

/**
 * 解析用户**明确**给出的提醒时间。
 * - 只有日期没有钟点、只有钟点没有日期 → incomplete（绝不补默认值）
 * - 时区：用户明说 > 可信组织配置（MarketingBrandProfile.timezone）；都没有 → incomplete
 * - 已过去 / 超过一年 → incomplete（要求用户重新给出）
 */
export function parseExplicitReminderTime(
  text: string,
  ctx: { now: Date; orgTimezone: string | null },
): ReminderTimeParse {
  const dateExpr = findDateExpr(text);
  const timeExpr = findTimeExpr(text);
  if (!dateExpr && !timeExpr) return { kind: "none" };

  const explicitTz = resolveExplicitTimezone(text);
  const tz = explicitTz ?? (isValidTimeZone(ctx.orgTimezone) ? ctx.orgTimezone : null);
  const missing: FollowupMissingInput[] = [];
  if (!dateExpr || !timeExpr) missing.push("reminder_time");
  if (!tz) missing.push("timezone");
  if (missing.length > 0) {
    return {
      kind: "incomplete",
      missing,
      reason: !dateExpr
        ? "缺少提醒日期"
        : !timeExpr
          ? "缺少具体钟点"
          : "缺少可信时区",
    };
  }

  const today = wallPartsInTz(ctx.now, tz!);
  let y = today.y;
  let mo = today.mo;
  let d = today.d;
  const shiftDays = (days: number) => {
    const base = new Date(Date.UTC(today.y, today.mo - 1, today.d + days));
    y = base.getUTCFullYear();
    mo = base.getUTCMonth() + 1;
    d = base.getUTCDate();
  };
  const de = dateExpr!;
  if (de.kind === "absolute") {
    mo = de.mo;
    d = de.d;
    y = de.y ?? today.y;
    if (de.y === null) {
      // 未写年份：取最近的未来日期（今天之前的月日 → 明年）
      const thisYear = Date.UTC(today.y, mo - 1, d);
      const todayUtc = Date.UTC(today.y, today.mo - 1, today.d);
      if (thisYear < todayUtc) y = today.y + 1;
    }
  } else if (de.kind === "relative_days") {
    shiftDays(de.days);
  } else {
    const cur = today.weekday;
    const days = de.nextWeek
      ? 7 - cur + de.weekday
      : (de.weekday - cur + 7) % 7;
    shiftDays(days);
  }

  const check = new Date(Date.UTC(y, mo - 1, d));
  if (
    mo < 1 ||
    mo > 12 ||
    check.getUTCMonth() !== mo - 1 ||
    check.getUTCDate() !== d
  ) {
    return { kind: "incomplete", missing: ["reminder_time"], reason: "日期不存在" };
  }

  const te = timeExpr!;
  const startAt = zonedWallTimeToUtc(y, mo, d, te.h, te.mi, tz!);
  if (startAt.getTime() <= ctx.now.getTime()) {
    return { kind: "incomplete", missing: ["reminder_time"], reason: "提醒时间已经过去" };
  }
  if (startAt.getTime() - ctx.now.getTime() > 366 * 86_400_000) {
    return { kind: "incomplete", missing: ["reminder_time"], reason: "提醒时间超过一年" };
  }
  return {
    kind: "ok",
    startAt: startAt.toISOString(),
    timezone: tz!,
    timezoneSource: explicitTz ? "user_explicit" : "org_profile",
    local: formatInTimezone(startAt.toISOString(), tz!),
  };
}

// ─────────────────────────── 目标 → 交付项 ───────────────────────────

export type FollowupReminderRequest =
  | { status: "not_requested" }
  | {
      status: "scheduled";
      startAt: string;
      timezone: string;
      timezoneSource: "user_explicit" | "org_profile";
      local: string;
    }
  | { status: "missing"; missing: FollowupMissingInput[]; reason: string };

export type FollowupGoalSpec = {
  topN: number;
  /** 用户原话要求的数量（可能超过本轮上限） */
  requestedTopN: number | null;
  deliverables: FollowupDeliverable[];
  quoteRiskRequested: boolean;
  emailSendRequested: boolean;
  unsupported: FollowupUnsupportedCode[];
  reminder: FollowupReminderRequest;
};

/**
 * 批量客户跟进目标 → 受约束的交付项。非本场景返回 null（调用方保持既有行为）。
 * "只分析" → 不准备邮件草稿/提醒；"只要草稿" → 不加提醒；"发邮件" → 降级为草稿并显式列出。
 */
export function parseFollowupGoal(
  text: string,
  ctx: { now: Date; orgTimezone: string | null },
): FollowupGoalSpec | null {
  const t = text.trim();
  if (!isFollowupBatchGoal(t)) return null;

  const analysisOnly = ANALYSIS_ONLY_RE.test(t);
  const emailSendRequested = affirmed(t, EMAIL_SEND_RE);
  const emailDrafts =
    !analysisOnly && (affirmed(t, EMAIL_DRAFT_RE) || emailSendRequested);
  const reminders = !analysisOnly && affirmed(t, REMINDER_RE);

  const unsupported: FollowupUnsupportedCode[] = [];
  for (const u of UNSUPPORTED_PATTERNS) {
    if (affirmed(t, u.re)) unsupported.push(u.code);
  }
  if (emailSendRequested) unsupported.push("send_email");

  const requestedTopN = parseRequestedTopN(t);
  const topN = Math.max(1, Math.min(requestedTopN ?? FOLLOWUP_MAX_TOP_N, FOLLOWUP_MAX_TOP_N));

  const deliverables: FollowupDeliverable[] = ["analysis"];
  if (emailDrafts) deliverables.push("email_drafts");
  if (reminders) deliverables.push("reminders");

  let reminder: FollowupReminderRequest = { status: "not_requested" };
  if (reminders) {
    const parsed = parseExplicitReminderTime(t, ctx);
    if (parsed.kind === "ok") {
      reminder = {
        status: "scheduled",
        startAt: parsed.startAt,
        timezone: parsed.timezone,
        timezoneSource: parsed.timezoneSource,
        local: parsed.local,
      };
    } else if (parsed.kind === "incomplete") {
      reminder = { status: "missing", missing: parsed.missing, reason: parsed.reason };
    } else {
      reminder = {
        status: "missing",
        missing: isValidTimeZone(ctx.orgTimezone)
          ? ["reminder_time"]
          : ["reminder_time", "timezone"],
        reason: "未提供提醒时间",
      };
    }
  }

  return {
    topN,
    requestedTopN,
    deliverables,
    quoteRiskRequested: affirmed(t, QUOTE_RISK_RE),
    emailSendRequested,
    unsupported,
    reminder,
  };
}

// ─────────────────────────── 补充信息（续接） ───────────────────────────

export type FollowupContinuationAnswer =
  | { kind: "not_an_answer" }
  | { kind: "still_incomplete"; missing: FollowupMissingInput[]; reason: string }
  | {
      kind: "reminder_time";
      startAt: string;
      timezone: string;
      timezoneSource: "user_explicit" | "org_profile";
      local: string;
      /** 用户点名的客户（父任务的优先客户之一）；空 = 父任务全部优先客户 */
      targetCustomerIds: string[];
    };

/**
 * 用户对"请补充提醒时间"的回答。只接受明确时间；可点名父任务已选出的客户。
 * 新的完整批量跟进目标不算回答（调用方会把它当新任务）。
 */
export function parseFollowupContinuationAnswer(
  text: string,
  ctx: {
    now: Date;
    orgTimezone: string | null;
    parentCustomers: Array<{ customerId: string; customerName: string }>;
  },
): FollowupContinuationAnswer {
  const t = text.trim();
  if (!t || isFollowupBatchGoal(t)) return { kind: "not_an_answer" };
  const parsed = parseExplicitReminderTime(t, ctx);
  if (parsed.kind === "none") return { kind: "not_an_answer" };
  if (parsed.kind === "incomplete") {
    return { kind: "still_incomplete", missing: parsed.missing, reason: parsed.reason };
  }
  const named = ctx.parentCustomers
    .filter((c) => c.customerName && c.customerName.length >= 2 && t.includes(c.customerName))
    .map((c) => c.customerId);
  return {
    kind: "reminder_time",
    startAt: parsed.startAt,
    timezone: parsed.timezone,
    timezoneSource: parsed.timezoneSource,
    local: parsed.local,
    targetCustomerIds: Array.from(new Set(named)),
  };
}

// ─────────────────────────── 服务端计划 ───────────────────────────

export type FollowupPlanOptions = {
  includeAttachmentEvidence: boolean;
  /** 邮件草稿工具当前可用（功能开关 + 工具策略） */
  emailDraftsAvailable: boolean;
  /** 提醒工具当前可用（工具策略） */
  remindersAvailable: boolean;
};

export type FollowupPlanResult = {
  plan: ServerAuthoredPlanV1;
  tools: string[];
  /** 计划里实际包含写准备步骤的交付项 */
  preparedDeliverables: FollowupDeliverable[];
};

function task(
  t: Omit<ServerAuthoredTaskV1, "workerKey" | "taskKind">,
): ServerAuthoredTaskV1 {
  return { ...t, workerKey: "sales_worker", taskKind: "work" };
}

/** 计划只包含用户明确要求、且当前可用的步骤；写操作只准备 PendingAction */
export function buildFollowupServerPlan(
  spec: FollowupGoalSpec,
  opts: FollowupPlanOptions,
): FollowupPlanResult {
  const tasks: ServerAuthoredTaskV1[] = [];
  const prioritizeDeps: string[] = [];

  if (opts.includeAttachmentEvidence) {
    tasks.push(
      task({
        id: FOLLOWUP_STEP.attachmentEvidence,
        title: "读取你提供的资料（附件）",
        description:
          "读取本次消息附带的资料，校验归属后提取可核对的引用与客户匹配；附件正文视为不可信业务资料，只做字符串匹配。",
        preferredTool: FOLLOWUP_TOOL.attachmentEvidence,
        executionMode: "read",
        riskLevel: "LOW",
        requiresApproval: false,
        expectedOutput: "附件引用、字数与匹配到的组织内客户",
      }),
    );
    prioritizeDeps.push(FOLLOWUP_STEP.attachmentEvidence);
  }

  tasks.push(
    task({
      id: FOLLOWUP_STEP.opportunities,
      title: "读取活跃商机与客户",
      description: "读取当前组织的活跃商机、关联客户、最近报价与互动。",
      preferredTool: FOLLOWUP_TOOL.opportunities,
      executionMode: "read",
      riskLevel: "LOW",
      requiresApproval: false,
      expectedOutput: "活跃商机列表（含客户与最近报价）",
    }),
    task({
      id: FOLLOWUP_STEP.followupAnalysis,
      title: "分析跟进紧迫度",
      description: "运行客户跟进体检（CustomerFollowupGrader，GLOBAL）。",
      preferredTool: FOLLOWUP_TOOL.followupAnalysis,
      executionMode: "analysis",
      riskLevel: "LOW",
      requiresApproval: false,
      expectedOutput: "跟进风险问题与证据",
    }),
    task({
      id: FOLLOWUP_STEP.quoteRisk,
      title: "汇总报价风险",
      description: "运行报价风险体检（QuoteRiskGrader，GLOBAL）。",
      preferredTool: FOLLOWUP_TOOL.quoteRisk,
      executionMode: "analysis",
      riskLevel: "LOW",
      requiresApproval: false,
      expectedOutput: "报价风险问题与证据",
    }),
  );
  prioritizeDeps.push(
    FOLLOWUP_STEP.opportunities,
    FOLLOWUP_STEP.followupAnalysis,
    FOLLOWUP_STEP.quoteRisk,
  );
  tasks.push(
    task({
      id: FOLLOWUP_STEP.prioritize,
      title: `选出最需要跟进的 ${spec.topN} 个客户`,
      description:
        "综合跟进分析、报价风险与商机证据做确定性排序，给出可解释理由与证据引用。",
      dependsOn: prioritizeDeps,
      preferredTool: FOLLOWUP_TOOL.prioritize,
      executionMode: "analysis",
      riskLevel: "LOW",
      requiresApproval: false,
      expectedOutput: `最多 ${spec.topN} 个优先客户及理由`,
    }),
  );

  const prepared: FollowupDeliverable[] = [];
  if (spec.deliverables.includes("email_drafts") && opts.emailDraftsAvailable) {
    prepared.push("email_drafts");
  }
  if (
    spec.deliverables.includes("reminders") &&
    spec.reminder.status === "scheduled" &&
    opts.remindersAvailable
  ) {
    prepared.push("reminders");
  }
  if (prepared.length > 0) {
    tasks.push(
      task({
        id: FOLLOWUP_STEP.prepareActions,
        title:
          prepared.length === 2
            ? "准备邮件草稿与跟进提醒（逐项待你确认）"
            : prepared[0] === "email_drafts"
              ? "准备跟进邮件草稿（逐项待你确认）"
              : "准备跟进提醒（逐项待你确认）",
        description:
          "为优先客户逐个生成待确认动作：Gmail 草稿只在确认后创建、绝不发送；提醒只在确认后写入日历。",
        dependsOn: [FOLLOWUP_STEP.prioritize],
        preferredTool: FOLLOWUP_TOOL.prepareActions,
        executionMode: "write",
        riskLevel: "HIGH",
        requiresApproval: true,
        expectedOutput: "每个客户一张待确认卡片",
      }),
    );
  }

  const completionCriteria: ServerAuthoredPlanV1["completionCriteria"] = [
    {
      id: "c_data",
      description: "已读取活跃商机与客户数据",
      verificationType: "tool_result",
      evidenceStepIds: [FOLLOWUP_STEP.opportunities],
    },
    {
      id: "c_analysis",
      description: "已完成跟进紧迫度与报价风险分析",
      verificationType: "tool_result",
      evidenceStepIds: [FOLLOWUP_STEP.followupAnalysis, FOLLOWUP_STEP.quoteRisk],
    },
    {
      id: "c_prioritized",
      description: `已选出最多 ${spec.topN} 个优先跟进客户`,
      verificationType: "tool_result",
      evidenceStepIds: [FOLLOWUP_STEP.prioritize],
    },
  ];
  if (opts.includeAttachmentEvidence) {
    completionCriteria.push({
      id: "c_attachments",
      description: "已读取并引用用户提供的资料",
      verificationType: "tool_result",
      evidenceStepIds: [FOLLOWUP_STEP.attachmentEvidence],
    });
  }

  const tools = Array.from(
    new Set(tasks.map((t) => t.preferredTool).filter((x): x is string => !!x)),
  );
  return {
    plan: {
      contractVersion: WORKFORCE_PLAN_CONTRACT_VERSION,
      objective: `找出最需要跟进的 ${spec.topN} 个客户并汇总报价风险${
        prepared.includes("email_drafts") ? "，准备邮件草稿" : ""
      }${prepared.includes("reminders") ? "，准备跟进提醒" : ""}`,
      summary:
        "读取商机/客户/报价 → 跟进与报价风险分析 → 确定性排序 → 写操作只生成待确认动作（不发送、不自动执行）",
      completionCriteria,
      tasks,
      assumptions: ["当前组织为服务端确认的 activeOrg", "写操作必须经 PendingAction"],
    },
    tools,
    preparedDeliverables: prepared,
  };
}

/** 续接任务：沿用父任务已选出的客户，只准备提醒（不重复分析、不重复已完成步骤） */
export function buildFollowupContinuationPlan(): FollowupPlanResult {
  const tasks: ServerAuthoredTaskV1[] = [
    task({
      id: FOLLOWUP_STEP.carryTargets,
      title: "沿用上次分析选出的客户",
      description:
        "读取同一对话中上一跟进任务的排序结果（同组织、同发起人校验），不重新分析。",
      preferredTool: FOLLOWUP_TOOL.carryTargets,
      executionMode: "read",
      riskLevel: "LOW",
      requiresApproval: false,
      expectedOutput: "上次任务的优先客户",
    }),
    task({
      id: FOLLOWUP_STEP.prepareActions,
      title: "准备跟进提醒（逐项待你确认）",
      description: "按你给出的时间为客户逐个生成提醒待确认卡片，确认后才写入日历。",
      dependsOn: [FOLLOWUP_STEP.carryTargets],
      preferredTool: FOLLOWUP_TOOL.prepareActions,
      executionMode: "write",
      riskLevel: "HIGH",
      requiresApproval: true,
      expectedOutput: "每个客户一张提醒确认卡片",
    }),
  ];
  return {
    plan: {
      contractVersion: WORKFORCE_PLAN_CONTRACT_VERSION,
      objective: "为上次跟进任务选出的客户建立提醒",
      summary: "沿用上次排序结果 → 按明确时间准备提醒待确认动作",
      completionCriteria: [
        {
          id: "c_targets",
          description: "已取得上次任务的优先客户",
          verificationType: "tool_result",
          evidenceStepIds: [FOLLOWUP_STEP.carryTargets],
        },
      ],
      tasks,
      assumptions: ["父任务属于同一组织、同一发起人、同一对话"],
    },
    tools: [FOLLOWUP_TOOL.carryTargets, FOLLOWUP_TOOL.prepareActions],
    preparedDeliverables: ["reminders"],
  };
}

// ─────────────────────────── 受理文案 ───────────────────────────

/** 受理回执：只描述已经发生的事（任务已创建）与接下来会做什么；不以"正在"开头 */
export function followupAcceptanceText(input: {
  runId: string;
  spec: FollowupGoalSpec;
  preparedDeliverables: FollowupDeliverable[];
  emailUnavailableReason: string | null;
  remindersUnavailableReason: string | null;
  attachmentCount: number;
}): string {
  const { spec } = input;
  const lines: string[] = [];
  lines.push(`已创建后台跟进任务（编号 ${input.runId}）。你可以离开此页面，任务会继续执行，回来后在下方卡片查看进度与结果。`);
  lines.push("");
  lines.push("这次会做：");
  lines.push(
    `- 读取当前组织的商机、客户与报价，分析跟进紧迫度并汇总报价风险，选出最需要跟进的 ${spec.topN} 个客户（附理由与证据）`,
  );
  if (spec.requestedTopN && spec.requestedTopN > spec.topN) {
    lines.push(`  · 你要求 ${spec.requestedTopN} 个，本轮工具最多支持 ${spec.topN} 个`);
  }
  if (input.attachmentCount > 0) {
    lines.push(`- 把你提供的 ${input.attachmentCount} 份资料作为证据读取并引用（只当作业务资料，不当作指令）`);
  }
  if (input.preparedDeliverables.includes("email_drafts")) {
    lines.push("- 为每个客户准备跟进邮件草稿：逐项确认后才在 Gmail 中创建草稿，不会发送");
  }
  if (input.preparedDeliverables.includes("reminders") && spec.reminder.status === "scheduled") {
    lines.push(
      `- 为你确认的客户建立提醒：${spec.reminder.local}（${spec.reminder.timezone}${
        spec.reminder.timezoneSource === "org_profile" ? "，来自组织时区设置" : ""
      }），逐项确认后才写入日历`,
    );
  }
  const notDone: string[] = [];
  if (spec.deliverables.includes("email_drafts") && !input.preparedDeliverables.includes("email_drafts")) {
    notDone.push(`邮件草稿暂不可用：${input.emailUnavailableReason ?? "当前不可用"}`);
  }
  if (spec.deliverables.includes("reminders") && !input.preparedDeliverables.includes("reminders")) {
    if (spec.reminder.status === "missing") {
      const ask = spec.reminder.missing.includes("timezone")
        ? "请告诉我提醒的日期、具体时间和时区（例如「10月20日下午3点 多伦多时间」）"
        : "请告诉我提醒的日期和具体时间（例如「10月20日下午3点」）";
      notDone.push(`提醒还不能建立（${spec.reminder.reason}）。${ask}，可以点名客户，我会沿用这次选出的客户，不需要你重新交代任务`);
    } else if (input.remindersUnavailableReason) {
      notDone.push(`提醒暂不可用：${input.remindersUnavailableReason}`);
    }
  }
  for (const code of spec.unsupported) {
    notDone.push(`不会执行：${FOLLOWUP_UNSUPPORTED_LABEL[code]}`);
  }
  if (notDone.length > 0) {
    lines.push("");
    lines.push("需要你注意：");
    for (const n of notDone) lines.push(`- ${n}`);
  }
  return lines.join("\n");
}
