/**
 * CHAIN-1b Alberta 授标的人工录入（纯函数：校验与规整、来源键、结果说法、固定文字）
 *
 * 人把自己在 Alberta Purchasing Connection（APC）上看到的授标公告录进来：来源人工录入（USER_ENTRY）、
 * 带 APC 公告链接、信任级待人工复核（NEEDS_REVIEW），组织管理员确认后才进入统计。
 * 这里只做字符串解析（new URL），不发起任何网络请求；链接只保存，系统不打开它。
 * 这个文件也给页面用（客户端），不依赖 node 模块；来源键在 award-manual-entry-key.ts（服务端）。
 */
export const APC_HOST = "purchasing.alberta.ca";
export const MANUAL_APC_SOURCE_PREFIX = "manual:apc:";
export const AWARD_MANUAL_ENTRY_AUDIT_ACTION = "tender.award_manual_entry";

export const MANUAL_ENTRY_LIMITS = { buyer: 200, winner: 200, url: 2048, solicitation: 100, scope: 2000, maxAmount: 1_000_000_000_000 } as const;
export const MANUAL_ENTRY_CURRENCIES = ["CAD", "USD"] as const;
export type ManualEntryCurrency = (typeof MANUAL_ENTRY_CURRENCIES)[number];

export const MANUAL_ENTRY_TEXT = {
  formTitle: "录入 Alberta 授标（APC）",
  formNote: "只录入你在 Alberta Purchasing Connection（APC）上自己看到的授标公告。系统不会打开这个链接。录入后标为「待人工复核」，组织管理员确认属实后才进入统计、可比价格和历史中标者。",
  buyerHint: "照公告原文填写；与项目里的采购方写法一致，系统才能把它们对上。",
  scopeHint: "同类采购照公告标题写同一句，可比价格才算得上。",
  listSource: "人工录入 · APC 公告",
  pendingStat: "待确认（AI 提取 / 人工录入）",
  flagOff: "组织授标情报尚未启用",
  missingBuyer: "请填写采购方。",
  missingWinner: "请填写中标方。",
  missingUrl: "请填写 APC 公告链接。",
  badUrl: "APC 公告链接要以 https://purchasing.alberta.ca/ 开头，并指向具体的公告。",
  badDate: "授标日期要写成 年-月-日，且不能晚于今天。",
  badAmount: "合同金额要是不小于 0 的数字，最多两位小数。",
  badCurrency: "币种只能是 CAD 或 USD。",
  tooLong: (field: string, max: number) => `${field}太长了（最多 ${max} 字）。`,
  created: "已录入，等组织管理员复核。",
  needsReview: "已录入；和已有的一条记录可能重复，等组织管理员裁决。",
  attachedBySolicitation: "已有同一条授标（招标编号与中标方相同），这条公告链接已挂到那条记录上。",
  attachedByDateAmount: "已有同一条授标（中标方、授标日期、金额都相同），这条公告链接已挂到那条记录上。",
  alreadyEntered: "这条公告的这个中标方已经录过了。",
} as const;

export type ManualEntryInput = {
  buyerName: string;
  winnerName: string;
  apcUrl: string;
  solicitationNumber: string | null;
  /** UTC 零点 */
  awardDate: Date | null;
  contractAmount: number | null;
  currency: ManualEntryCurrency | null;
  scopeSummary: string | null;
};

export type ManualEntryParse =
  | { ok: true; value: ManualEntryInput }
  | { ok: false; code: string; messageZh: string };

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/**
 * APC 链接：先解析、再规整（去掉 # 之后、主机名小写、去掉路径末尾所有的 /），规整后才判。
 * 返回规整后的序列化结果（origin + pathname + search）；不合格返回 null。
 */
export function normalizeApcUrl(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  let u: URL;
  try {
    u = new URL(text);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.hostname.toLowerCase() !== APC_HOST || u.port !== "" || u.username !== "" || u.password !== "") return null;
  const path = u.pathname.replace(/\/+$/, "");
  if (!path) return null;
  return `https://${APC_HOST}${path}${u.search}`;
}

/** 授标日期：真实存在的 YYYY-MM-DD（往返一致）且不晚于今天（UTC 日期 + 1 天容差） */
export function parseAwardDate(raw: string, now: Date): Date | null | "INVALID" {
  const text = raw.trim();
  if (!text) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return "INVALID";
  const d = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== text) return "INVALID";
  const latest = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + 24 * 3600 * 1000;
  if (d.getTime() > latest) return "INVALID";
  return d;
}

function parseAmount(raw: unknown): number | null | "INVALID" {
  if (raw === null || raw === undefined || (typeof raw === "string" && raw.trim() === "")) return null;
  const text = typeof raw === "number" ? String(raw) : typeof raw === "string" ? raw.trim().replace(/,/g, "") : "";
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return "INVALID";
  const n = Number(text);
  if (!Number.isFinite(n) || n < 0 || n > MANUAL_ENTRY_LIMITS.maxAmount) return "INVALID";
  return n;
}

/** 校验与规整表单；第一处错误返回那句话（顺序：采购方、中标方、链接、编号、日期、金额、币种、摘要） */
export function parseManualEntry(body: unknown, now: Date): ManualEntryParse {
  const b = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const fail = (code: string, messageZh: string): ManualEntryParse => ({ ok: false, code, messageZh });
  const buyer = str(b.buyerName);
  if (!buyer) return fail("MISSING_BUYER", MANUAL_ENTRY_TEXT.missingBuyer);
  if (buyer.length > MANUAL_ENTRY_LIMITS.buyer) return fail("TOO_LONG", MANUAL_ENTRY_TEXT.tooLong("采购方", MANUAL_ENTRY_LIMITS.buyer));
  const winner = str(b.winnerName);
  if (!winner) return fail("MISSING_WINNER", MANUAL_ENTRY_TEXT.missingWinner);
  if (winner.length > MANUAL_ENTRY_LIMITS.winner) return fail("TOO_LONG", MANUAL_ENTRY_TEXT.tooLong("中标方", MANUAL_ENTRY_LIMITS.winner));
  const rawUrl = str(b.apcUrl);
  if (!rawUrl) return fail("MISSING_URL", MANUAL_ENTRY_TEXT.missingUrl);
  const url = normalizeApcUrl(rawUrl);
  if (!url) return fail("BAD_URL", MANUAL_ENTRY_TEXT.badUrl);
  if (url.length > MANUAL_ENTRY_LIMITS.url) return fail("TOO_LONG", MANUAL_ENTRY_TEXT.tooLong("APC 公告链接", MANUAL_ENTRY_LIMITS.url));
  const solicitation = str(b.solicitationNumber);
  if (solicitation.length > MANUAL_ENTRY_LIMITS.solicitation) return fail("TOO_LONG", MANUAL_ENTRY_TEXT.tooLong("招标编号", MANUAL_ENTRY_LIMITS.solicitation));
  const date = parseAwardDate(str(b.awardDate), now);
  if (date === "INVALID") return fail("BAD_DATE", MANUAL_ENTRY_TEXT.badDate);
  const amount = parseAmount(b.contractAmount);
  if (amount === "INVALID") return fail("BAD_AMOUNT", MANUAL_ENTRY_TEXT.badAmount);
  let currency: ManualEntryCurrency | null = null;
  if (amount !== null) {
    const c = str(b.currency).toUpperCase() || "CAD";
    if (!(MANUAL_ENTRY_CURRENCIES as readonly string[]).includes(c)) return fail("BAD_CURRENCY", MANUAL_ENTRY_TEXT.badCurrency);
    currency = c as ManualEntryCurrency;
  }
  const scope = str(b.scopeSummary);
  if (scope.length > MANUAL_ENTRY_LIMITS.scope) return fail("TOO_LONG", MANUAL_ENTRY_TEXT.tooLong("范围摘要", MANUAL_ENTRY_LIMITS.scope));
  return {
    ok: true,
    value: { buyerName: buyer, winnerName: winner, apcUrl: url, solicitationNumber: solicitation || null, awardDate: date, contractAmount: amount, currency, scopeSummary: scope || null },
  };
}

export type ManualEntryOutcome = "CREATED" | "NEEDS_REVIEW" | "ATTACHED_BY_SOLICITATION" | "ATTACHED_BY_DATE_AMOUNT" | "ALREADY_ENTERED";

export function manualEntryMessageZh(outcome: ManualEntryOutcome): string {
  switch (outcome) {
    case "CREATED":
      return MANUAL_ENTRY_TEXT.created;
    case "NEEDS_REVIEW":
      return MANUAL_ENTRY_TEXT.needsReview;
    case "ATTACHED_BY_SOLICITATION":
      return MANUAL_ENTRY_TEXT.attachedBySolicitation;
    case "ATTACHED_BY_DATE_AMOUNT":
      return MANUAL_ENTRY_TEXT.attachedByDateAmount;
    case "ALREADY_ENTERED":
      return MANUAL_ENTRY_TEXT.alreadyEntered;
  }
}

/** 挂到既有记录时是哪种相同：既有记录的招标编号与提交的相同 → 按编号；否则按中标方、授标日期、金额 */
export function attachCause(submittedSolicitation: string | null, targetSolicitation: string | null): "ATTACHED_BY_SOLICITATION" | "ATTACHED_BY_DATE_AMOUNT" {
  return submittedSolicitation && targetSolicitation && submittedSolicitation.trim() === targetSolicitation.trim() ? "ATTACHED_BY_SOLICITATION" : "ATTACHED_BY_DATE_AMOUNT";
}

/** 列表里显示的 APC 链接：只认人工录入、manual:apc: 来源，再校验一次主机 */
export function listableApcUrl(source: { sourceType: string; sourceKey: string; sourceUrl: string | null }): string | null {
  if (source.sourceType !== "USER_ENTRY" || !source.sourceKey.startsWith(MANUAL_APC_SOURCE_PREFIX) || !source.sourceUrl) return null;
  return normalizeApcUrl(source.sourceUrl);
}
