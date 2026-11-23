/**
 * BIDPAGE-1「标书与报价」页的「下一步」与三个分区的一句状态（纯函数，零 DB / 网络 / 模型；前后端共用）
 *
 * 查表按先后命中第一条（任务书 BIDPAGE-1；与任务书的出入见 openspec/changes/bid-page-v2-shell/design.md D3）：
 *   1. 招标分析没批准、而且还没往下走（没发过询价、没有还在用的引擎报价）
 *   2. 我方报价已定
 *   3. 有未定的报价（草稿 / 待批准 / 已批准但没选为我方报价 / 我方报价有新版待定）
 *   4. 没有供应商
 *   5. 没发过询价（有待批的发询价卡时说等批准）
 *   6. 已发询价、没有一家报价、还有人在等 → 等供应商回复
 *   7. 已发询价、没有一家报价、没人在等、有待批的发询价卡 → 等批准后发出
 *   8. 已发询价、没有一家报价、没人在等、有人回了没报价 → 看供应商回复，把报价录入
 *   9. 其余（有人报价了，或问过的都没报价）→ 开始做报价
 * 每家供应商按它最近一次发出的那一轮的状态算（同一家在旧轮次拒绝、新轮次重发在等，算在等）；「已报价」只要任何一轮报过就算。
 * 这里只出结论与要去的位置，不执行任何动作。
 * 金额只在 canViewAmounts 为真（且报价功能开通、我方报价已定）时出现在文字与 quote.amount 里；为假时任何文字里都没有数字金额。
 * 任何人都拿不到成本、毛利、供应商报价——这里的输入里本来就没有它们。
 */

export const BID_PAGE_SECTIONS = ["sourcing", "quote", "documents"] as const;
export type BidPageSection = (typeof BID_PAGE_SECTIONS)[number];

export const BID_PAGE_SECTION_TITLES_ZH: Record<BidPageSection, string> = {
  sourcing: "① 找供应商、询价",
  quote: "② 定报价",
  documents: "③ 出文件",
};

/** 去某个分区的按钮文字（去掉序号） */
const SECTION_GO_ZH: Record<BidPageSection, string> = {
  sourcing: "去「找供应商、询价」",
  quote: "去「定报价」",
  documents: "去「出文件」",
};

export type BidPageRule =
  | "requirements_unapproved"
  | "bid_decided"
  | "quote_draft"
  | "no_suppliers"
  | "rfq_pending_approval"
  | "no_rfq_sent"
  | "waiting_replies"
  | "replies_to_record"
  | "start_quote";

/** 每条规则指向哪里（规格「下一步指向哪里」的对应表） */
export const BID_PAGE_RULE_TARGET: Record<BidPageRule, "requirements" | BidPageSection> = {
  requirements_unapproved: "requirements",
  // 我方报价是逐行报价时改去 ②（按招标方价格表导出在 ② 底部），见 actionOf（BIDPAGE-3 design D10）
  bid_decided: "documents",
  quote_draft: "quote",
  no_suppliers: "sourcing",
  rfq_pending_approval: "sourcing",
  no_rfq_sent: "sourcing",
  waiting_replies: "sourcing",
  replies_to_record: "sourcing",
  start_quote: "quote",
};

/** 这些规则要做的事在带金额的区块里（起草 / 批准询价、录报价、做报价、定报价）：看不到金额的人做不了 */
const RULES_NEEDING_AMOUNTS: ReadonlySet<BidPageRule> = new Set(["no_rfq_sent", "rfq_pending_approval", "replies_to_record", "start_quote", "quote_draft"]);

/** 顺带一句的固定写法 */
export const ANALYSIS_UNAPPROVED_ALSO_ZH = "招标分析还没批准";
export const NEEDS_FINANCE_ALSO_ZH = "这一步要项目负责人或有财务查看权的同事来做";

export type BidPageTarget = { kind: "section"; section: BidPageSection } | { kind: "tab"; tab: "requirements" };

export type BidTenderStatus = "AUTHORITATIVE" | "QUOTE_REVISION_PENDING" | "NONE";

export type BidPageFacts = {
  now: Date;
  /** 当前这份分析的状态（与项目页「下一步」同一条取法）；没有分析为 null */
  analysisStatus: string | null;
  /** 本项目的供应商（关联卡里没标「未入选」的 + 没取消的询价轮次里的）去重后的家数 */
  supplierCount: number;
  /** 本项目待批、未过期的发询价卡张数 */
  pendingRfqApprovals: number;
  inquiry: {
    /** 没取消的轮次里，发出过询价的供应商家数（去重） */
    askedCount: number;
    /** 其中最近一次发出后已回（已回复 / 已报价 / 已拒绝）的家数 */
    respondedCount: number;
    /** 任何一轮报过价的家数 */
    quotedCount: number;
    /** 最近一次是「已回复」、但没有一轮报过价的家数 */
    repliedNoQuoteCount: number;
    /** 最近一次还在等回复的家数（轮次没结束、发出不到 90 天） */
    waitingCount: number;
    /** 这些在等的供应商里最早的发出时间；没有在等的、或在等的都没有发出时间为 null */
    waitingSince: Date | null;
  };
  quote: {
    /** 报价功能是否开通（报价引擎开关） */
    available: boolean;
    bid: {
      status: BidTenderStatus;
      version: number | null;
      amount: { value: number; currency: string } | null;
      /** 我方报价是逐行报价（BIDPAGE-3）：「已定」的按钮去 ②（导出在那里）；不知道 / 不是 → ③ */
      lineMode?: boolean;
    };
    /** 最新一份还没定的引擎报价（草稿 / 待批准）；没有为 null */
    openDraft: { status: "draft" | "review"; version: number } | null;
    /** 还没有我方报价时，已批准（或已中标）、可以选为我方报价的报价份数 */
    approvedUnselected: number;
  };
  documents: {
    /** 看的人有没有项目编辑权限（生成文件要它） */
    canGenerate: boolean;
    /** 已生成的文件种类数 */
    generatedKinds: number;
  };
  /** 同时有报价内部成本权限与财务查看权（任务书附录 C 决定 C；与报价功能开没开无关） */
  canViewAmounts: boolean;
};

export type BidPageView = {
  rule: BidPageRule;
  headlineZh: string;
  reasonZh: string | null;
  /** 顺带一句（招标分析还没批准、但项目已经往下走了；这一步要有财务查看权的人来做） */
  alsoZh: string | null;
  action: { labelZh: string; target: BidPageTarget };
  /** 打开页面时展开哪个分区（「下一步」指向招标要求时展开 ①） */
  expanded: BidPageSection;
  sections: Record<BidPageSection, { statusZh: string }>;
  quote: { decided: boolean; amount?: { value: number; currency: string } };
  /** 看的人能不能看金额、报价功能开没开、能不能生成文件：新页面据此决定挂不挂既有区块 */
  viewer: { canViewAmounts: boolean; quoteAvailable: boolean; canGenerate: boolean };
};

const DAY = 86_400_000;

const CURRENCY_ZH: Record<string, string> = { CAD: "加元", USD: "美元", CNY: "人民币", EUR: "欧元", GBP: "英镑" };

/** 两位小数、千分位；币种写中文名，认不出的原样写代码；不是有限数时写「—」 */
export function formatMoneyZh(value: number, currency: string): string {
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) >= 1e15) return "—";
  const fixed = (Math.round((value + Number.EPSILON) * 100) / 100).toFixed(2);
  const neg = fixed.startsWith("-") && !/^-0\.00$/.test(fixed);
  const [int, frac] = (fixed.startsWith("-") ? fixed.slice(1) : fixed).split(".");
  const grouped = int!.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const cur = CURRENCY_ZH[currency.toUpperCase()] ?? currency.toUpperCase();
  return `${neg ? "-" : ""}${grouped}.${frac} ${cur}`;
}

/** 金额门：能看报价内部成本，且有财务查看权（与报价功能开没开无关；我方报价金额另要报价功能开通） */
export function canViewBidAmounts(input: { canViewInternal: boolean; financeCanReadAll: boolean }): boolean {
  return input.canViewInternal && input.financeCanReadAll;
}

function analysisReasonZh(status: string | null): string {
  switch ((status ?? "").toUpperCase()) {
    case "":
      return "还没有招标分析，先到那里发起分析";
    case "PENDING":
    case "EXTRACTING":
    case "ANALYZING":
    case "RUNNING":
    case "SUPERSEDED":
      return "招标分析还在进行，完成后再确认";
    case "FAILED":
      return "上次招标分析没有完成，需要重新分析";
    default:
      return "招标分析还没批准";
  }
}

function sourcingStatusZh(f: BidPageFacts): string {
  if (f.inquiry.askedCount > 0) return `${f.inquiry.askedCount} 家已询价，${f.inquiry.respondedCount} 家已回`;
  if (f.pendingRfqApprovals > 0) return "询价已起草，等批准";
  if (f.supplierCount > 0) return `${f.supplierCount} 家供应商，还没询价`;
  return "还没有供应商";
}

function quoteStatusZh(f: BidPageFacts): string {
  const q = f.quote;
  if (!q.available) return "报价功能未开通";
  if (q.bid.status === "AUTHORITATIVE") {
    return f.canViewAmounts && q.bid.amount && Number.isFinite(q.bid.amount.value)
      ? `我方报价 ${formatMoneyZh(q.bid.amount.value, q.bid.amount.currency)}，已定`
      : "我方报价已定";
  }
  if (q.bid.status === "QUOTE_REVISION_PENDING") return "我方报价有新版待定";
  if (q.openDraft) return `${q.openDraft.status === "review" ? "待批准" : "草稿"}（第 ${q.openDraft.version} 版），未定`;
  if (q.approvedUnselected > 0) return `已批准 ${q.approvedUnselected} 份，还没选为我方报价`;
  return "还没有报价";
}

function documentsStatusZh(f: BidPageFacts): string {
  if (!f.documents.canGenerate) return "生成文件需要项目编辑权限";
  return f.documents.generatedKinds > 0 ? `已生成 ${f.documents.generatedKinds} 种文件` : "还没有生成文件";
}

function actionOf(rule: BidPageRule, f: BidPageFacts): { labelZh: string; target: BidPageTarget } {
  const t = rule === "bid_decided" && f.quote.bid.lineMode === true ? "quote" : BID_PAGE_RULE_TARGET[rule];
  if (t === "requirements") return { labelZh: "去「招标要求」", target: { kind: "tab", tab: "requirements" } };
  return { labelZh: SECTION_GO_ZH[t], target: { kind: "section", section: t } };
}

export function decideBidPageNextStep(f: BidPageFacts): BidPageView {
  const q = f.quote;
  const i = f.inquiry;
  const analysisApproved = (f.analysisStatus ?? "").toUpperCase() === "APPROVED";
  const hasQuoteActivity = q.available && (q.bid.status !== "NONE" || !!q.openDraft || q.approvedUnselected > 0);
  const movedOn = i.askedCount > 0 || hasQuoteActivity;

  const base = (rule: BidPageRule, headlineZh: string, reasonZh: string | null): BidPageView => {
    const action = actionOf(rule, f);
    const decided = q.available && q.bid.status === "AUTHORITATIVE";
    const amount =
      decided && f.canViewAmounts && q.bid.amount && Number.isFinite(q.bid.amount.value) ? { value: q.bid.amount.value, currency: q.bid.amount.currency } : undefined;
    const also = [
      rule !== "requirements_unapproved" && !analysisApproved ? ANALYSIS_UNAPPROVED_ALSO_ZH : null,
      !f.canViewAmounts && RULES_NEEDING_AMOUNTS.has(rule) ? NEEDS_FINANCE_ALSO_ZH : null,
    ].filter((x): x is string => !!x);
    return {
      rule,
      headlineZh,
      reasonZh,
      alsoZh: also.length > 0 ? also.join("；") : null,
      action,
      expanded: action.target.kind === "section" ? action.target.section : "sourcing",
      sections: { sourcing: { statusZh: sourcingStatusZh(f) }, quote: { statusZh: quoteStatusZh(f) }, documents: { statusZh: documentsStatusZh(f) } },
      quote: amount ? { decided, amount } : { decided },
      viewer: { canViewAmounts: f.canViewAmounts, quoteAvailable: q.available, canGenerate: f.documents.canGenerate },
    };
  };

  // 1. 招标分析还没批准，而且还没往下走
  if (!analysisApproved && !movedOn) {
    return base("requirements_unapproved", "先去「招标要求」确认要求", analysisReasonZh(f.analysisStatus));
  }

  // 2. 我方报价已定
  if (q.available && q.bid.status === "AUTHORITATIVE") {
    return base("bid_decided", "导出价格表 / 生成投标文件", q.bid.version != null ? `我方报价第 ${q.bid.version} 版已定` : "我方报价已定");
  }

  // 3. 有未定的报价
  if (q.available && (q.openDraft || q.bid.status === "QUOTE_REVISION_PENDING" || q.approvedUnselected > 0)) {
    const reason = q.openDraft
      ? `第 ${q.openDraft.version} 版${q.openDraft.status === "review" ? "待批准" : "是草稿"}`
      : q.bid.status === "QUOTE_REVISION_PENDING"
        ? "我方报价的新版还没定"
        : `已批准 ${q.approvedUnselected} 份，还没选为我方报价`;
    return base("quote_draft", "检查后定为我方报价", reason);
  }

  // 4. 没有供应商
  if (f.supplierCount <= 0) return base("no_suppliers", "添加供应商或起草询价", "本项目还没有供应商");

  // 5. 有供应商但没发过询价
  if (i.askedCount <= 0) {
    if (f.pendingRfqApprovals > 0) return base("rfq_pending_approval", "询价已起草，等批准后发出", `有 ${f.pendingRfqApprovals} 张发询价卡等批准`);
    return base("no_rfq_sent", "起草询价", `已有 ${f.supplierCount} 家供应商，还没发过询价`);
  }

  if (i.quotedCount <= 0) {
    // 6. 已发询价、没有一家报价、还有人在等
    if (i.waitingCount > 0) {
      const days = i.waitingSince ? Math.max(0, Math.floor((f.now.getTime() - i.waitingSince.getTime()) / DAY)) : null;
      const headline = days === null ? "等供应商回复" : days === 0 ? "等供应商回复（发出不到 1 天）" : `等供应商回复（已等 ${days} 天）`;
      const reason = i.repliedNoQuoteCount > 0 ? `${i.repliedNoQuoteCount} 家回复了、还没录入报价，其余还在等` : `已问 ${i.askedCount} 家，还没有报价`;
      return base("waiting_replies", headline, reason);
    }
    // 7. 没人在等、新一轮的发询价卡在等批准
    if (f.pendingRfqApprovals > 0) return base("rfq_pending_approval", "询价已起草，等批准后发出", `有 ${f.pendingRfqApprovals} 张发询价卡等批准`);
    // 8. 没人在等、有人回了没报价
    if (i.repliedNoQuoteCount > 0) {
      return base("replies_to_record", "看供应商回复，把报价录入", `${i.repliedNoQuoteCount} 家回复了，还没录入报价（先看回复里有没有报价）`);
    }
  }

  // 9. 其余：有人报价了，或问过的都没报价
  const reason = i.quotedCount > 0 ? `已有 ${i.quotedCount} 家报价` : `问过的 ${i.askedCount} 家都没报价，也可以再问几家`;
  return base("start_quote", "开始做报价", reason);
}
