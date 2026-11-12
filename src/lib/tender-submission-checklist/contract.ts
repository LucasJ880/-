/**
 * FLOW-H4b 交付前检查清单——规则与类型（纯函数，零 DB / 网络 / 模型）
 *
 * 清单在读取时现算：当前可用的那份招标分析里，强制的、提交类的、人已确认的要求，每条一项，能回到原文。
 * 系统只列出该备什么、显示人标的状态，不替人判断某一条是否真的备好了。
 */

/** 提交类要求的类别——与招标分析生成提交清单时用的那七个相同（库里存的是小写） */
export const SUBMISSION_CHECKLIST_CATEGORIES = ["submission", "administrative", "pricing", "samples", "shop_drawings", "bonding", "insurance"] as const;
export type SubmissionChecklistCategory = (typeof SUBMISSION_CHECKLIST_CATEGORIES)[number];
export const SUBMISSION_CATEGORY_ZH: Record<SubmissionChecklistCategory, string> = {
  submission: "提交要求",
  administrative: "行政与资格文件",
  pricing: "报价文件",
  samples: "样品",
  shop_drawings: "深化图",
  bonding: "保证金 / 保函",
  insurance: "保险",
};
const isSubmissionCategory = (c: string): c is SubmissionChecklistCategory => (SUBMISSION_CHECKLIST_CATEGORIES as readonly string[]).includes(c);

/** 清单项的状态：待办、备好了、不适用。存在这条要求的交付物行上 */
export const CHECKLIST_ITEM_STATUSES = ["PENDING", "DONE", "WAIVED"] as const;
export type ChecklistItemStatus = (typeof CHECKLIST_ITEM_STATUSES)[number];
export const CHECKLIST_STATUS_ZH: Record<ChecklistItemStatus, string> = { PENDING: "待办", DONE: "备好了", WAIVED: "不适用" };

export const SUBMISSION_CHECKLIST_AUDIT_ACTION = "tender.submission_checklist.item";

/** 要求编号 → 交付物行的键。与招标分析投影交付物时用的派生方式相同（同一条要求落在同一行上）。 */
export function checklistKeyOf(requirementCode: string): string {
  const slug = requirementCode.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60);
  return `req_${slug || "unknown"}`;
}

/** 库里的一条要求（只取清单要用的列） */
export type ChecklistRequirement = {
  requirementCode: string;
  category: string;
  mandatory: boolean;
  /** AI_EXTRACTED | CONFIRMED | REJECTED */
  reviewStatus: string;
  /** NOT_ASSESSED | PARTIAL | COMPLIANT | NON_COMPLIANT | NEEDS_CLARIFICATION */
  complianceStatus: string;
  chineseTranslation: string | null;
  originalRequirement: string;
  sourcePage: number | null;
};

export type ChecklistLine = {
  key: string;
  requirementCode: string;
  category: string;
  categoryZh: string;
  /** 中文（没有中文时是原文） */
  textZh: string;
  /** 招标文件原文 */
  originalText: string;
  sourcePage: number | null;
};
export type ChecklistItem = ChecklistLine & {
  status: ChecklistItemStatus;
  /** 两条要求的编号派生出同一个键时，后一条不能单独标状态（否则会改到前一条） */
  tickable: boolean;
};

/** 招标文件写明的一项提交条件；found = false 表示分析里没有找到 */
export type ChecklistCondition = { slot: string; labelZh: string; found: boolean; textZh: string };

export type SubmissionChecklistView = {
  /** 有没有可用的分析（等待审核或已批准） */
  hasAnalysis: boolean;
  /** 这份分析批准了没有（没批准时清单仍然显示，页面提示还在审核中） */
  analysisApproved: boolean;
  /** 要备齐的：强制、提交类、已确认 */
  toPrepare: ChecklistItem[];
  /** 还没确认的：强制、提交类、还没人确认——不算进要备齐的，也不藏起来 */
  unconfirmed: ChecklistLine[];
  /** 废标风险：当前判为不满足的强制要求（任何类别；已驳回的不算） */
  risks: ChecklistLine[];
  /** 项目上的截标时间、提问截止时间 */
  closesAt: string | null;
  questionCloseAt: string | null;
  /** 招标文件写明的提交条件（提交方式、保证金、保险、截标时间原文） */
  conditions: ChecklistCondition[];
  progress: { total: number; done: number; waived: number; pending: number };
  /** 这个人能不能标状态 */
  canEdit: boolean;
};

const CONDITION_SLOTS: ReadonlyArray<{ slot: string; labelZh: string }> = [
  { slot: "submission_method", labelZh: "提交方式" },
  { slot: "closing_datetime", labelZh: "截标时间（招标文件原文）" },
  { slot: "bond", labelZh: "保证金 / 保函" },
  { slot: "insurance", labelZh: "保险" },
];
export const CONDITION_NOT_FOUND_ZH = "招标文件里没有找到，请自行核对";

function conditionsOf(criticalFacts: unknown): ChecklistCondition[] {
  const cf = criticalFacts && typeof criticalFacts === "object" && !Array.isArray(criticalFacts) ? (criticalFacts as Record<string, unknown>) : {};
  return CONDITION_SLOTS.map(({ slot, labelZh }) => {
    const v = cf[slot];
    const o = v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
    const text = o && o.status === "KNOWN" && typeof o.text === "string" && o.text.trim() ? o.text.trim() : null;
    return text ? { slot, labelZh, found: true, textZh: text } : { slot, labelZh, found: false, textZh: CONDITION_NOT_FOUND_ZH };
  });
}

const lineOf = (r: ChecklistRequirement): ChecklistLine => ({
  key: checklistKeyOf(r.requirementCode),
  requirementCode: r.requirementCode,
  category: r.category,
  categoryZh: isSubmissionCategory(r.category) ? SUBMISSION_CATEGORY_ZH[r.category] : r.category,
  textZh: (r.chineseTranslation ?? "").trim() || r.originalRequirement.trim(),
  originalText: r.originalRequirement.trim(),
  sourcePage: r.sourcePage,
});

const byCategoryThenCode = (a: ChecklistLine, b: ChecklistLine) => {
  const ia = (SUBMISSION_CHECKLIST_CATEGORIES as readonly string[]).indexOf(a.category), ib = (SUBMISSION_CHECKLIST_CATEGORIES as readonly string[]).indexOf(b.category);
  const ca = ia < 0 ? 99 : ia, cb = ib < 0 ? 99 : ib;
  return ca !== cb ? ca - cb : a.requirementCode.localeCompare(b.requirementCode, "en", { numeric: true });
};

const asStatus = (v: unknown): ChecklistItemStatus => ((CHECKLIST_ITEM_STATUSES as readonly string[]).includes(String(v)) ? (v as ChecklistItemStatus) : "PENDING");

/**
 * 生成清单。
 *   requirements：当前可用的那份分析的全部要求；没有可用的分析时传 null。
 *   statusByKey：这份分析的交付物行上已有的状态（键 → 状态）。库里别的值（比如 IN_PROGRESS）按待办算。
 */
export function buildSubmissionChecklist(input: {
  requirements: ChecklistRequirement[] | null;
  analysisStatus: string | null;
  statusByKey: Readonly<Record<string, string>>;
  criticalFacts: unknown;
  closeDate: Date | null;
  questionCloseDate: Date | null;
  canEdit: boolean;
}): SubmissionChecklistView {
  const reqs = input.requirements ?? [];
  const mandatory = reqs.filter((r) => r.mandatory === true);
  const inScope = mandatory.filter((r) => isSubmissionCategory(r.category));

  const seen = new Set<string>();
  const toPrepare: ChecklistItem[] = inScope
    .filter((r) => r.reviewStatus === "CONFIRMED")
    .map(lineOf)
    .sort(byCategoryThenCode)
    .map((line) => {
      const tickable = !seen.has(line.key);
      seen.add(line.key);
      return { ...line, status: tickable ? asStatus(input.statusByKey[line.key]) : "PENDING", tickable };
    });
  const unconfirmed = inScope.filter((r) => r.reviewStatus === "AI_EXTRACTED").map(lineOf).sort(byCategoryThenCode);
  const risks = mandatory.filter((r) => r.complianceStatus === "NON_COMPLIANT" && r.reviewStatus !== "REJECTED").map(lineOf).sort(byCategoryThenCode);

  const done = toPrepare.filter((i) => i.status === "DONE").length;
  const waived = toPrepare.filter((i) => i.status === "WAIVED").length;
  return {
    hasAnalysis: input.requirements !== null,
    analysisApproved: input.analysisStatus === "APPROVED",
    toPrepare,
    unconfirmed,
    risks,
    closesAt: input.closeDate ? input.closeDate.toISOString() : null,
    questionCloseAt: input.questionCloseDate ? input.questionCloseDate.toISOString() : null,
    conditions: input.requirements === null ? [] : conditionsOf(input.criticalFacts),
    progress: { total: toPrepare.length, done, waived, pending: toPrepare.length - done - waived },
    canEdit: input.canEdit,
  };
}

/** 标状态的请求体：{ status: "PENDING" | "DONE" | "WAIVED" } */
export function parseItemStatus(body: unknown): { ok: true; status: ChecklistItemStatus } | { ok: false; error: string } {
  const o = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  if (!o || typeof o.status !== "string" || !(CHECKLIST_ITEM_STATUSES as readonly string[]).includes(o.status)) return { ok: false, error: "状态只能是待办、备好了或不适用" };
  return { ok: true, status: o.status as ChecklistItemStatus };
}

/** 页面最上面的一句话 */
export function checklistSummaryZh(view: Pick<SubmissionChecklistView, "hasAnalysis" | "toPrepare" | "unconfirmed" | "risks" | "progress">): string {
  if (!view.hasAnalysis) return "还没有可用的招标分析：先上传招标文件并完成分析，清单从已确认的要求里生成";
  const parts: string[] = [];
  if (view.progress.total === 0) parts.push(view.unconfirmed.length > 0 ? "还没有已确认的提交类强制要求" : "这份招标分析里没有提交类的强制要求");
  else parts.push(`要备齐 ${view.progress.total} 项：${view.progress.done} 项备好了${view.progress.waived > 0 ? `，${view.progress.waived} 项不适用` : ""}，还差 ${view.progress.pending} 项`);
  if (view.unconfirmed.length > 0) parts.push(`另有 ${view.unconfirmed.length} 项还没确认`);
  if (view.risks.length > 0) parts.push(`${view.risks.length} 项强制要求当前判为不满足`);
  return parts.join("；");
}
