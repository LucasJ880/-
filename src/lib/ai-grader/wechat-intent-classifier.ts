/**
 * 统一微信 Grader 意图分类器（确定性优先，规则型，无 LLM / 无 DB）
 *
 * 职责：接收微信用户文本，输出统一 WechatIntentResult，供 gateway 收敛路由到
 * Daily / Customer / Quote / Project 四个 Grader 或回落普通 chat。
 *
 * 设计原则：
 * - 不调用 LLM、不查库、无写副作用
 * - 不确定即回 CHAT，不为触发 Grader 而过度匹配
 * - 明确词（项目 / 报价 / 客户）优先于泛泛表达
 * - 优先级：CANCEL > CONFIRM > PROJECT > QUOTE > CUSTOMER > DAILY > CHAT
 * - 纯数字 / 取消仍由 gateway 的 handleWeChatPendingReply 先行处理；
 *   本分类器也能识别它们，供未来统一路由使用。
 */

export type WechatGraderIntent =
  | "DAILY_BRIEF"
  | "CUSTOMER_FOLLOWUP"
  | "CHECK_CUSTOMER"
  | "QUOTE_RISK"
  | "CHECK_QUOTE"
  | "PROJECT_HEALTH"
  | "CHECK_PROJECT"
  | "CONFIRM_PENDING_ACTION"
  | "CANCEL_PENDING_ACTION"
  | "CHAT";

export type WechatIntentTargetType = "CUSTOMER" | "QUOTE" | "PROJECT" | "OPPORTUNITY";

/** 短期上下文中可用于解析指代的字段（不含正文） */
export type WechatGraderContextState = {
  lastCustomerId?: string;
  lastCustomerName?: string;
  lastOpportunityId?: string;
  lastQuoteId?: string;
  lastProjectId?: string;
  lastProjectName?: string;
  lastIntent?: string;
  lastGraderType?: "DAILY_BRIEF" | "CUSTOMER_FOLLOWUP" | "QUOTE_RISK" | "PROJECT_HEALTH";
  /** 微信可视化挂起状态（发图后等待 SKU）；null 表示显式清除 */
  pendingVisualizer?: {
    imagePathname: string;
    mimeType: string;
    width: number;
    height: number;
    windows: Array<{
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      confidence: number;
    }>;
    stage: "awaiting_sku" | "generated";
    lastSku?: string;
  } | null;
};

export type WechatIntentResult = {
  intent: WechatGraderIntent;
  confidence: number;
  targetType?: WechatIntentTargetType;
  targetName?: string;
  targetId?: string;
  actionIndex?: number;
  reason?: string;
  needsClarification?: boolean;
  clarificationMessage?: string;
  resolvedFromContext?: boolean;
};

export interface ClassifyOptions {
  context?: WechatGraderContextState | null;
}

const CHAT: WechatIntentResult = { intent: "CHAT", confidence: 0 };

const CANCEL_WORDS = ["取消", "不用了", "算了", "撤销", "cancel"];
const CONFIRM_WORDS = ["确认", "执行", "确定"];

const CLARIFY_PROJECT = "请告诉我具体项目名称，例如：帮我检查 W0103 项目";
const CLARIFY_QUOTE = "请告诉我具体客户或报价名称，例如：帮我检查 Lucas 的报价";
const CLARIFY_CUSTOMER = "请告诉我具体客户名称，例如：帮我看 Lucas";

// ── 各类停用词（命中视为「无有效名称」→ 澄清） ───────────────
const PROJECT_STOPWORDS = new Set(["这个", "那个", "该", "项目", "这个项目", "该项目", "今天", "现在", "他", "她", "它"]);
const QUOTE_STOPWORDS = new Set(["这个", "那个", "这份", "那份", "客户", "报价", "今天", "现在", "他", "她", "它"]);
const CUSTOMER_STOPWORDS = new Set([
  "这个客户", "该客户", "这位客户", "那个客户", "那位客户", "客户",
  "这个", "那个", "今天", "现在", "他", "她", "它",
]);

// ── 入口 ───────────────────────────────────────────────────────

export function classifyWechatGraderIntent(
  content: string,
  opts?: ClassifyOptions,
): WechatIntentResult {
  const text = (content ?? "").trim();
  if (!text) return CHAT;
  const context = opts?.context ?? null;

  // 1. 取消
  if (isCancel(text)) {
    return { intent: "CANCEL_PENDING_ACTION", confidence: 1 };
  }

  // 2. 确认（纯数字 / 确认词）
  const num = pureNumber(text);
  if (num !== null) {
    return { intent: "CONFIRM_PENDING_ACTION", confidence: 1, actionIndex: num };
  }
  if (CONFIRM_WORDS.includes(text)) {
    return { intent: "CONFIRM_PENDING_ACTION", confidence: 0.9 };
  }

  // 3~5. 明确词意图：项目 > 报价 > 客户（显式名永远优先于上下文）
  // 6. 纯指代（他/她/它/刚刚那个）→ 按上下文最近 Grader 类型解析
  // 7. DAILY_BRIEF（泛意图）
  return (
    classifyProject(text, context) ??
    classifyQuote(text, context) ??
    classifyCustomer(text, context) ??
    resolvePronoun(text, context) ??
    classifyDaily(text) ??
    CHAT
  );
}

// ── PROJECT ────────────────────────────────────────────────────

const PROJECT_GATE = /项目|project|deadline|截止|工单|安装|样品|布料|rfi|submittal/i;
const PROJECT_GLOBAL = [
  "哪些项目有风险", "哪些项目快截止", "哪些项目快到 deadline", "哪些项目快到deadline",
  "今天有哪些项目要处理", "哪些项目要处理", "项目体检", "项目风险",
];

function classifyProject(text: string, context: WechatGraderContextState | null): WechatIntentResult | null {
  if (!PROJECT_GATE.test(text)) return null;

  if (PROJECT_GLOBAL.some((t) => text.includes(t))) {
    return { intent: "PROJECT_HEALTH", confidence: 0.9, reason: "project global trigger" };
  }

  // P1: 帮我看/检查 X 这个?项目
  const p1 = text.match(/帮我(?:看一?下|看看|看|检查一?下|检查)\s*([^\s，,。.？?！!]{1,30}?)\s*(?:这个)?项目/);
  if (p1) return projectCheck(p1[1], context);

  // P2: X 项目 (现在)?(健康吗/有没有风险/怎么样/deadline/快到期/快截止)
  const p2 = text.match(
    /([^\s，,。.？?！!]{1,30}?)\s*项目\s*(?:现在)?\s*(?:健康吗|健不健康|健康么|有没有风险|有风险吗|有风险么|怎么样|deadline|快到.{0,4}deadline|快截止|快到期|到期)/i,
  );
  if (p2) return projectCheck(p2[1], context);

  // 无名指代 → 上下文解析；无则澄清
  if (/这个项目|该项目|帮我检查项目|检查项目|帮我看项目/.test(text)) {
    return projectFromContext(context) ?? clarify("CHECK_PROJECT", "PROJECT", CLARIFY_PROJECT);
  }

  return null;
}

function projectCheck(raw: string, context: WechatGraderContextState | null): WechatIntentResult {
  const name = cleanName(raw);
  if (!name || PROJECT_STOPWORDS.has(name)) {
    return projectFromContext(context) ?? clarify("CHECK_PROJECT", "PROJECT", CLARIFY_PROJECT);
  }
  return { intent: "CHECK_PROJECT", confidence: 0.9, targetType: "PROJECT", targetName: name };
}

function projectFromContext(context: WechatGraderContextState | null): WechatIntentResult | null {
  if (context?.lastProjectId || context?.lastProjectName) {
    return {
      intent: "CHECK_PROJECT",
      confidence: 0.85,
      targetType: "PROJECT",
      targetName: context.lastProjectName,
      targetId: context.lastProjectId,
      resolvedFromContext: true,
      reason: "resolved_from_context",
    };
  }
  return null;
}

// ── QUOTE ──────────────────────────────────────────────────────

const QUOTE_GATE = /报价|quote|proposal|estimate/i;
const QUOTE_GLOBAL = [
  "哪些报价有风险", "哪些报价要跟进", "哪些报价发出去没回复", "哪些报价客户看了没签",
  "哪些报价没人跟", "报价发出去后有没有人跟", "报价发出去有没有人跟", "报价风险",
];

function classifyQuote(text: string, context: WechatGraderContextState | null): WechatIntentResult | null {
  if (!QUOTE_GATE.test(text)) return null;

  if (QUOTE_GLOBAL.some((t) => text.includes(t))) {
    return { intent: "QUOTE_RISK", confidence: 0.9, reason: "quote global trigger" };
  }

  // P1: 帮我看/检查 X 的报价
  const p1 = text.match(/帮我(?:看一?下|看看|看|检查一?下|检查)\s*([^\s，,。.？?！!]{1,20}?)\s*(?:的)?报价/);
  if (p1) return quoteCheck(p1[1], context);

  // P2: X 的报价 (有没有风险/怎么样/要不要跟/有没有人跟/客户看了没签)
  const p2 = text.match(
    /([^\s，,。.？?！!]{1,20}?)\s*(?:的)?报价\s*(?:有没有风险|有风险吗|有风险么|怎么样|要不要跟|该不该跟|有没有人跟|客户看了没签|看了没签)/,
  );
  if (p2) return quoteCheck(p2[1], context);

  // 无名指代 → 上下文解析；无则澄清
  if (/这个报价|这份报价|该报价|帮我检查报价|检查报价|帮我看报价/.test(text)) {
    return quoteFromContext(context) ?? clarify("CHECK_QUOTE", "QUOTE", CLARIFY_QUOTE);
  }

  return null;
}

function quoteCheck(raw: string, context: WechatGraderContextState | null): WechatIntentResult {
  const name = cleanName(raw);
  if (!name || QUOTE_STOPWORDS.has(name)) {
    return quoteFromContext(context) ?? clarify("CHECK_QUOTE", "QUOTE", CLARIFY_QUOTE);
  }
  // 报价按客户名解析，targetType=CUSTOMER
  return { intent: "CHECK_QUOTE", confidence: 0.9, targetType: "CUSTOMER", targetName: name };
}

function quoteFromContext(context: WechatGraderContextState | null): WechatIntentResult | null {
  // 优先精确 quoteId；否则退回客户（按客户名解析其报价）
  if (context?.lastQuoteId) {
    return {
      intent: "CHECK_QUOTE",
      confidence: 0.85,
      targetType: "QUOTE",
      targetId: context.lastQuoteId,
      targetName: context.lastCustomerName,
      resolvedFromContext: true,
      reason: "resolved_from_context",
    };
  }
  if (context?.lastCustomerId || context?.lastCustomerName) {
    return {
      intent: "CHECK_QUOTE",
      confidence: 0.8,
      targetType: "CUSTOMER",
      targetId: context.lastCustomerId,
      targetName: context.lastCustomerName,
      resolvedFromContext: true,
      reason: "resolved_from_context",
    };
  }
  return null;
}

// ── CUSTOMER ───────────────────────────────────────────────────

const CUSTOMER_GLOBAL = [
  "哪些客户该联系", "哪些客户要跟进", "哪些客户需要跟进", "哪些客户该跟进",
  "今天要跟哪些客户", "今天跟哪些客户", "哪些客户要联系", "客户跟进", "销售跟进",
];

function classifyCustomer(text: string, context: WechatGraderContextState | null): WechatIntentResult | null {
  if (CUSTOMER_GLOBAL.some((t) => text.includes(t))) {
    return { intent: "CUSTOMER_FOLLOWUP", confidence: 0.85, reason: "customer global trigger" };
  }

  // P1: 帮我看/检查 X（无需关键词闸门；项目/报价已在前面拦截）
  const p1 = text.match(/帮我(?:看一?下|看看|看|检查一?下|检查)\s*([^\s，,。.？?！!]{1,20})/);
  if (p1) return customerCheck(p1[1], context);

  // P2: X 现在要不要跟 / 该不该跟
  const p2 = text.match(/([^\s，,。.？?！!]{1,20})\s*(?:现在)?\s*(?:要不要跟|该不该跟|需不需要跟|要跟吗|跟不跟)/);
  if (p2) return customerCheck(p2[1], context);

  // P3: 仅当含「客户」关键词时 → X 怎么样 / 什么情况 / 有风险吗
  if (text.includes("客户")) {
    const p3 = text.match(
      /([^\s，,。.？?！!]{1,20})\s*(?:现在)?\s*(?:是什么情况|什么情况|怎么样|有没有风险|有风险吗|有风险么)/,
    );
    if (p3) return customerCheck(p3[1], context);
  }

  return null;
}

function customerCheck(raw: string, context: WechatGraderContextState | null): WechatIntentResult {
  const name = cleanName(raw);
  if (!name || CUSTOMER_STOPWORDS.has(name)) {
    return customerFromContext(context) ?? clarify("CHECK_CUSTOMER", "CUSTOMER", CLARIFY_CUSTOMER);
  }
  return { intent: "CHECK_CUSTOMER", confidence: 0.85, targetType: "CUSTOMER", targetName: name };
}

function customerFromContext(context: WechatGraderContextState | null): WechatIntentResult | null {
  if (context?.lastCustomerId || context?.lastCustomerName) {
    return {
      intent: "CHECK_CUSTOMER",
      confidence: 0.85,
      targetType: "CUSTOMER",
      targetName: context.lastCustomerName,
      targetId: context.lastCustomerId,
      resolvedFromContext: true,
      reason: "resolved_from_context",
    };
  }
  return null;
}

/**
 * 纯指代（他/她/它/刚刚那个）→ 按上下文最近 Grader 类型解析。
 * 仅在文本以指代词开头且无其它意图命中时触发，避免误抢普通 chat。
 */
const PRONOUN_RE = /^(他|她|它|刚刚那个|刚才那个|刚刚那位|刚才那位|刚刚那家|刚才那家)/;

function resolvePronoun(
  text: string,
  context: WechatGraderContextState | null,
): WechatIntentResult | null {
  if (!context || !PRONOUN_RE.test(text)) return null;
  switch (context.lastGraderType) {
    case "PROJECT_HEALTH":
      return projectFromContext(context);
    case "QUOTE_RISK":
      return quoteFromContext(context);
    case "CUSTOMER_FOLLOWUP":
      return customerFromContext(context);
    default:
      return null;
  }
}

// ── DAILY ──────────────────────────────────────────────────────

const DAILY_TRIGGERS = [
  "今天有什么要跟进", "今天有哪些风险", "今天我应该先做什么",
  "今日体检", "今日简报", "业务体检", "销售体检", "今天帮我看一下",
];

function classifyDaily(text: string): WechatIntentResult | null {
  if (DAILY_TRIGGERS.some((t) => text.includes(t))) {
    return { intent: "DAILY_BRIEF", confidence: 0.8, reason: "daily trigger" };
  }
  return null;
}

// ── 工具 ───────────────────────────────────────────────────────

function clarify(
  intent: WechatGraderIntent,
  targetType: WechatIntentTargetType,
  message: string,
): WechatIntentResult {
  return {
    intent,
    confidence: 0.6,
    targetType,
    needsClarification: true,
    clarificationMessage: message,
  };
}

function cleanName(raw: string): string {
  return (raw ?? "").trim().replace(/^[的了]/, "").trim();
}

function isCancel(text: string): boolean {
  const t = text.toLowerCase();
  return CANCEL_WORDS.some((w) => t === w);
}

function pureNumber(text: string): number | null {
  const m = text.match(/^(\d{1,2})$/);
  return m ? parseInt(m[1], 10) : null;
}
