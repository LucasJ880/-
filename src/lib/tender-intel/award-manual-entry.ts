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
  formNote: "只录入你在 Alberta Purchasing Connection（APC）上亲眼看到的授标公告。系统只保存这个链接，不会自动访问它；复核的人会点开核对。录入后先列在下表、标为「待人工复核」，不计入金额、周期、可比价格和已确认的竞争对手；经人工确认属实后才计入（一般由组织管理员在下表确认）。",
  collapsedNote: "把在 APC 上看到的中标结果录进来，经人工确认后计入统计。",
  noticeGroup: "公告信息",
  winnerGroup: "这个中标方",
  buyerHint: "先从候选里选（本组织招标项目和已有授标里用过的写法）；候选里没有，再照公告上的采购方原文填。大小写、标点、开头的 The 不影响匹配，其余要和项目里的采购方一字不差，系统才能对上。",
  solicitationHint: "照公告上的招标编号原样填，用来区分同一采购方的不同招标。公告上找不到就留空，不要填链接里的 AB-… 编号：编号和已有记录对不上时，系统会把它标为疑似重复，等组织管理员裁决。",
  urlHint: "在 APC 打开这条公告，从浏览器地址栏复制，只要到编号为止（…/posting/AB-年份-编号）。搜索结果页、附件下载链接不行。",
  amountHint: "一条公告有几个中标方就录几条；金额填这个中标方自己的合同金额。公告只给总额或预估值时留空。",
  scopeHint: "写一句能反复用的采购内容，不带年份、编号、地点（例如 Snow removal services）。大小写和标点不影响；同一采购方、同一句、同一币种的已确认记录满 3 条，才会算出可比价格。",
  clearNotice: "换一条公告（清空）",
  listSource: "人工录入 · APC 公告",
  listSourceAria: "在新窗口打开 APC 公告",
  pendingStat: "待确认（AI 提取 / 人工录入，不计入统计）",
  duplicateStat: "疑似重复待裁决（不计入统计）",
  adminHint: "你是组织管理员：「AI 提取·待确认」「待人工复核」（含人工录入）和「疑似重复」可以确认或撤回。人工录入的记录，确认前先点「人工录入 · APC 公告」打开原公告核对。填错的撤回后重录：项目结果回项目里重新标记，人工录入在上方表单重新录入。",
  emptyManual: "在 APC 上看到的 Alberta 授标，也可以用上方「录入 Alberta 授标（APC）」直接录入，经人工确认后计入。",
  hiddenByFilter: "已录入，但被当前筛选条件挡住了，清空筛选可以看到。",
  forbidden: "你在本组织没有录入权限（需要成员及以上角色），请联系组织管理员。",
  failed: "没有录入成功，请稍后再试。",
  network: "网络出错，请稍后再试。",
  submit: "录入",
  submitting: "正在录入…",
  tooLarge: "请求太大",
  orgMissing: "组织不存在",
  tooManyRetracted: "这条公告的这个中标方撤回过太多次，没有录入；请联系组织管理员。",
  flagOff: "组织授标情报尚未启用",
  missingBuyer: "请填写采购方。",
  missingWinner: "请填写中标方。",
  missingUrl: "请填写 APC 公告链接。",
  badUrl: "这不是一条 APC 公告的链接。请在 APC 打开这条公告，复制地址栏里形如 https://purchasing.alberta.ca/posting/AB-2026-07664 的链接（搜索结果页、附件链接都不行）。",
  badDate: "授标日期要写成 年-月-日，且在 1900 年到今天之间。",
  badAmount: "合同金额只填数字（可以带千分位逗号和 $），不能为负，最多两位小数。",
  badCurrency: "币种只能是 CAD 或 USD。",
  tooLong: (field: string, max: number) => `${field}太长了（最多 ${max} 字）。`,
  created: "已录入，等组织管理员复核。",
  needsReview: "已录入；和已有的一条记录可能重复，等组织管理员裁决。",
  attachedBySolicitation: "已有同一条授标（招标编号与中标方相同），这条公告链接已挂到那条记录上。那条记录原有的内容和可信度不变（你这次填的没有写进去）；有出入请告诉组织管理员。",
  attachedByDateAmount: "已有同一条授标（中标方、授标日期、金额都相同），这条公告链接已挂到那条记录上。那条记录原有的内容（含招标编号与采购方）和可信度不变（你这次填的没有写进去）；有出入请告诉组织管理员。",
  alreadyEntered: "这条公告的这个中标方已经录过了（同一公告同一中标方只录一条；中了几个标段的请合成一条，金额合计或留空）。",
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

/** 出错时指向的字段（表单据此标出那一格） */
export type ManualEntryField = "buyerName" | "winnerName" | "apcUrl" | "solicitationNumber" | "awardDate" | "contractAmount" | "currency" | "scopeSummary";

export type ManualEntryParse =
  | { ok: true; value: ManualEntryInput }
  | { ok: false; code: string; field: ManualEntryField; messageZh: string };

/** 字符串去空白；数字按原样转成字符串（接口调用方传数字时不静默丢掉）；其余当没填 */
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : typeof v === "number" && Number.isFinite(v) ? String(v) : "");

/** APC 公告的路径：/posting/AB-年份-编号（Lucas 2026-11-20 给的样例 https://purchasing.alberta.ca/posting/AB-2026-07664；编号 4–6 位） */
const APC_POSTING_PATH = /^\/posting\/(AB-\d{4}-\d{4,6})\/*$/i;

/**
 * APC 链接：先解析、再规整，规整后才判：协议 https、主机恰为 purchasing.alberta.ca、没有端口与用户名密码、
 * 路径恰为 /posting/AB-年份-编号（末尾的 / 不算）。
 * 返回统一的写法 https://purchasing.alberta.ca/posting/AB-…（编号大写；# 与 ? 之后都去掉——同一条公告只有一种写法）；不合格返回 null。
 */
export function normalizeApcUrl(raw: string): string | null {
  let text = raw.trim();
  if (!text) return null;
  // 只复制了主机名开头的（没有 https://）替人补上
  if (/^purchasing\.alberta\.ca(\/|$)/i.test(text)) text = `https://${text}`;
  let u: URL;
  try {
    u = new URL(text);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.hostname.toLowerCase() !== APC_HOST || u.port !== "" || u.username !== "" || u.password !== "") return null;
  const m = APC_POSTING_PATH.exec(u.pathname);
  if (!m) return null;
  return `https://${APC_HOST}/posting/${m[1].toUpperCase()}`;
}

/** 授标日期：真实存在的 YYYY-MM-DD（往返一致），不早于 1900-01-01，不晚于今天（按 UTC 日期，留一天时区余量，即不晚于 UTC 明天） */
export function parseAwardDate(raw: string, now: Date): Date | null | "INVALID" {
  const text = raw.trim();
  if (!text) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return "INVALID";
  const d = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== text) return "INVALID";
  if (d.getTime() < Date.UTC(1900, 0, 1)) return "INVALID";
  const latest = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + 24 * 3600 * 1000;
  if (d.getTime() > latest) return "INVALID";
  return d;
}

/**
 * 合同金额：先 NFKC（全角数字与全角逗号变半角）、去掉开头的 $ 与空白；逗号只认千分位（1,234,567.89），
 * 当小数点用的逗号（1234,56）不认，免得差 100 倍。
 */
function parseAmount(raw: unknown): number | null | "INVALID" {
  if (raw === null || raw === undefined || (typeof raw === "string" && raw.trim() === "")) return null;
  let text = typeof raw === "number" ? String(raw) : typeof raw === "string" ? raw.normalize("NFKC").trim().replace(/^\$\s*/, "") : "";
  if (/,/.test(text)) {
    if (!/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(text)) return "INVALID";
    text = text.replace(/,/g, "");
  }
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return "INVALID";
  const n = Number(text);
  if (!Number.isFinite(n) || n < 0 || n > MANUAL_ENTRY_LIMITS.maxAmount) return "INVALID";
  return n;
}

/** 校验与规整表单；第一处错误返回那句话（顺序：采购方、中标方、链接、编号、日期、金额、币种、摘要） */
export function parseManualEntry(body: unknown, now: Date): ManualEntryParse {
  const b = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const fail = (code: string, messageZh: string, field: ManualEntryField): ManualEntryParse => ({ ok: false, code, field, messageZh });
  const buyer = str(b.buyerName);
  if (!buyer) return fail("MISSING_BUYER", MANUAL_ENTRY_TEXT.missingBuyer, "buyerName");
  if (buyer.length > MANUAL_ENTRY_LIMITS.buyer) return fail("TOO_LONG", MANUAL_ENTRY_TEXT.tooLong("采购方", MANUAL_ENTRY_LIMITS.buyer), "buyerName");
  const winner = str(b.winnerName);
  if (!winner) return fail("MISSING_WINNER", MANUAL_ENTRY_TEXT.missingWinner, "winnerName");
  if (winner.length > MANUAL_ENTRY_LIMITS.winner) return fail("TOO_LONG", MANUAL_ENTRY_TEXT.tooLong("中标方", MANUAL_ENTRY_LIMITS.winner), "winnerName");
  const rawUrl = str(b.apcUrl);
  if (!rawUrl) return fail("MISSING_URL", MANUAL_ENTRY_TEXT.missingUrl, "apcUrl");
  // 原文先查长度（规整后的统一写法总是很短）
  if (rawUrl.length > MANUAL_ENTRY_LIMITS.url) return fail("TOO_LONG", MANUAL_ENTRY_TEXT.tooLong("APC 公告链接", MANUAL_ENTRY_LIMITS.url), "apcUrl");
  const url = normalizeApcUrl(rawUrl);
  if (!url) return fail("BAD_URL", MANUAL_ENTRY_TEXT.badUrl, "apcUrl");
  const solicitation = str(b.solicitationNumber);
  if (solicitation.length > MANUAL_ENTRY_LIMITS.solicitation) return fail("TOO_LONG", MANUAL_ENTRY_TEXT.tooLong("招标编号", MANUAL_ENTRY_LIMITS.solicitation), "solicitationNumber");
  const date = parseAwardDate(str(b.awardDate), now);
  if (date === "INVALID") return fail("BAD_DATE", MANUAL_ENTRY_TEXT.badDate, "awardDate");
  const amount = parseAmount(b.contractAmount);
  if (amount === "INVALID") return fail("BAD_AMOUNT", MANUAL_ENTRY_TEXT.badAmount, "contractAmount");
  let currency: ManualEntryCurrency | null = null;
  if (amount !== null) {
    const c = str(b.currency).toUpperCase() || "CAD";
    if (!(MANUAL_ENTRY_CURRENCIES as readonly string[]).includes(c)) return fail("BAD_CURRENCY", MANUAL_ENTRY_TEXT.badCurrency, "currency");
    currency = c as ManualEntryCurrency;
  }
  const scope = str(b.scopeSummary);
  if (scope.length > MANUAL_ENTRY_LIMITS.scope) return fail("TOO_LONG", MANUAL_ENTRY_TEXT.tooLong("范围摘要", MANUAL_ENTRY_LIMITS.scope), "scopeSummary");
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
  // 只差大小写 / 空白 / 标点也算同一个编号（与写入服务的规范化同一口径）
  const key = (v: string | null) => (v ?? "").toUpperCase().replace(/[^\p{L}\p{N}]+/gu, "");
  return key(submittedSolicitation) && key(submittedSolicitation) === key(targetSolicitation) ? "ATTACHED_BY_SOLICITATION" : "ATTACHED_BY_DATE_AMOUNT";
}

/** 列表里显示的 APC 链接：只认人工录入、manual:apc: 来源，再校验一次主机 */
export function listableApcUrl(source: { sourceType: string; sourceKey: string; sourceUrl: string | null }): string | null {
  if (source.sourceType !== "USER_ENTRY" || !source.sourceKey.startsWith(MANUAL_APC_SOURCE_PREFIX) || !source.sourceUrl) return null;
  return normalizeApcUrl(source.sourceUrl);
}
