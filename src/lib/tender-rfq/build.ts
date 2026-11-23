/**
 * Tender RFQ（P1-1）— 结构化询价单生成器（纯函数，零 DB / 零 LLM）
 *
 * 输入：已人工确认的要求（reviewStatus=CONFIRMED）+ 已确认/高置信的关键事实 + 我方抬头。
 * 输出：供应商可逐行回复的 RFQ 文档——行项带 requirementCode 与来源页码，
 *       数量阶梯、Incoterm/目的地、交期、回复截止、编号问题清单。
 *
 * 纪律：
 *   1. 只用 CONFIRMED 的要求；AI_EXTRACTED / REJECTED 一律不进供应商视野。
 *   2. 只收供应商相关类别（产品/技术/交付/质保/样品/安全/包装类），
 *      行政/投标/保证金/保险等买方侧要求不发给供应商。
 *   3. 任何字段命中 china-supplier-brief 的敏感模式 → 整个文档 build 失败（不是 scrub）。
 *      供应商永远看不到估值、我方报价、毛利、预算。
 *   4. 文档里没写的（数量、交付地）保持 null，渲染为「请报价时注明/按贵司标准」，不编造。
 *   6. RFQ-PDF-2：行项只用要求编号称呼（不另编序号、不带来源页码），按四组排好；数量阶梯只认人填的，
 *      没填时照印数量事实的原文；回复截止按组织时区算且不晚于截标前一天；缺中文译文的行项标出来。
 *      邮件正文与附件（attachment.ts）都照这里排好的顺序与用词渲染，两边不会不一样。
 *   5. CHAIN-4b：对供应商只用中性询价编号称呼项目（不写项目名）；目的地只写人工填写的或
 *      分析地点里的「城市, 省」；任何字段命中本项目的禁出清单或邮箱 / 电话格式 → 整个文档失败。
 */

import type { RequirementCategoryV2 } from "@/lib/tender-understanding/contract";
import { containsSensitiveSupplierBriefText } from "@/lib/bid-workflow/china-supplier-brief";
import { needsChineseTranslation } from "@/lib/tender-auto-analysis/requirement-lang";
import {
  cityLevelDestination,
  identityLeakMessageZh,
  scanIdentity,
  type IdentityHit,
  type IdentitySegment,
  type ProjectIdentityDenyList,
} from "@/lib/bid-workflow/project-identity-deny";

export const RFQ_CONTRACT_VERSION = "tender-rfq/v1" as const;

/** 进入供应商视野的要求类别 */
export const SUPPLIER_FACING_CATEGORIES: readonly RequirementCategoryV2[] = [
  "PRODUCT",
  "TECHNICAL",
  "PERFORMANCE",
  "DELIVERY",
  "WARRANTY",
  "SAMPLES",
  "SAFETY",
  "SHOP_DRAWINGS",
  "INSTALLATION",
  "TRAINING",
];

/**
 * 旧式类别代码（V1 分析引擎写入）→ 标准类别。只列确有归属的代码；
 * 不在表里的（如 mandatory_general）一律视为未知，不进询价单。
 */
const LEGACY_CATEGORY_MAP: Readonly<Record<string, RequirementCategoryV2>> = {
  MANDATORY_TECHNICAL: "TECHNICAL",
};

/**
 * 把入库的类别写法归一成标准类别：去首尾空白 → 转大写 → 旧式代码映射。
 * 库里的类别是小写（V2 入库时 toLowerCase）或旧式代码（V1），不能直接与大写清单比较。
 * 返回 null = 不属于供应商侧（含未知与空），调用方按 not_supplier_facing 处理，不猜归属。
 */
export function normalizeSupplierFacingCategory(raw: string | null | undefined): RequirementCategoryV2 | null {
  const upper = (raw ?? "").trim().toUpperCase();
  if (!upper) return null;
  const category = LEGACY_CATEGORY_MAP[upper] ?? upper;
  return (SUPPLIER_FACING_CATEGORIES as readonly string[]).includes(category) ? (category as RequirementCategoryV2) : null;
}

export type RfqRequirementInput = {
  requirementCode: string;
  category: string;
  originalRequirement: string;
  chineseTranslation: string | null;
  mandatory: boolean;
  reviewStatus: string;
  sourcePage: number | null;
};

export type RfqFactInput = {
  /** CRITICAL_FACT_TYPES 之一（quantity / delivery / location / closing_datetime / scope / warranty …） */
  type: string;
  contentZh: string;
  contentOriginal: string | null;
  confidence: string;
  manuallyConfirmed: boolean;
};

export type RfqBuildInput = {
  /**
   * CHAIN-4b：本项目的禁出清单与对供应商的中性询价编号（project-identity-sources 读出）。必填——
   * 任何调用方都绕不过身份检查；项目名称不再是入参，询价单无从印出它。
   */
  identity: { denyList: ProjectIdentityDenyList; reference: string };
  /** 我方对供应商的抬头（组织询价设置里的发件抬头） */
  buyerDisplayName: string;
  /** RFQ-PDF-2：联系人（组织投标档案报价抬头里的默认经办人）；为空不印 */
  contactName?: string | null;
  /** RFQ-PDF-2：印在询价单抬头的邮箱 = 询价设置里的展示发件人（不是授权邮箱）；不传则不印 */
  contactEmail?: string | null;
  /** 投标截标日（ISO）；回复截止见 computeReplyBy */
  closeDate: string | null;
  now: Date;
  /** RFQ-PDF-2：组织时区（回复截止按当地日期算，与禁出清单里的截标日期同一口径）；缺省 UTC */
  timeZone?: string;
  requirements: RfqRequirementInput[];
  facts: RfqFactInput[];
  /** 希望供应商报价的数量阶梯（人填的）；为空时照印数量事实的原文，再没有则留给供应商注明 */
  quantityTiers?: number[];
  incoterm?: "EXW" | "FOB" | "CIF" | "DDP" | "DAP" | null;
  destination?: string | null;
  /** 回复截止提前量（天），默认 7 */
  replyLeadDays?: number;
  /** 追加的自定义问题（人工编辑） */
  extraQuestions?: string[];
  /** 本轮询价范围说明（人工编辑） */
  scopeNote?: string | null;
};

/** RFQ-PDF-2：行项的四个组（顺序即询价单上的顺序）；组内按要求编号升序 */
export const RFQ_LINE_GROUPS: ReadonlyArray<{ key: RfqLineGroupKey; titleZh: string; categories: readonly RequirementCategoryV2[] }> = [
  { key: "product", titleZh: "产品与规格", categories: ["PRODUCT", "TECHNICAL", "PERFORMANCE"] },
  { key: "safety", titleZh: "安全与认证", categories: ["SAFETY"] },
  { key: "samples", titleZh: "样品与图纸", categories: ["SAMPLES", "SHOP_DRAWINGS"] },
  { key: "service", titleZh: "交付、质保与服务", categories: ["DELIVERY", "WARRANTY", "INSTALLATION", "TRAINING"] },
];
export type RfqLineGroupKey = "product" | "safety" | "samples" | "service";

/** 没有中文译文的行项，中文位置印这一句，其下照印原文 */
export const RFQ_MISSING_ZH_NOTE = "（暂无中文译文，以原文为准）";

export type RfqLineItem = {
  requirementCode: string;
  category: string;
  group: RfqLineGroupKey;
  /** 工厂看得懂的类型用词（原「强制 / 评分」） */
  kind: "必须" | "加分";
  specZh: string;
  specOriginal: string;
  mandatory: boolean;
  /** 中文一栏不是中文（没有译文，或译文仍是外文） */
  missingZh: boolean;
};

export type RfqQuestion = { seq: number; text: string; relatedCodes: string[] };

export type RfqDocument = {
  contractVersion: typeof RFQ_CONTRACT_VERSION;
  /** 对供应商的中性询价编号（RFQ-{组织}-{年份}-{5 位码}） */
  reference: string;
  buyerDisplayName: string;
  contactName: string | null;
  contactEmail: string | null;
  scopeNote: string | null;
  /** 已按「组序 → 要求编号升序」排好；邮件与附件照这个顺序渲染 */
  lineItems: RfqLineItem[];
  missingTranslationCount: number;
  /** 人填的数量阶梯；没填为 null */
  quantityTiers: number[] | null;
  /** 没填阶梯而有可用的数量事实时：事实的中文原文（带单位） */
  quantityFactZh: string | null;
  /** 两者都没有时的那句话 */
  quantityNote: string | null;
  incoterm: string | null;
  destination: string | null;
  requiredLeadTimeNote: string | null;
  replyBy: string | null;
  /** 固定问题 Q1–Q5：只进邮件正文（附件的勾选栏与报价表已经承接） */
  fixedQuestions: RfqQuestion[];
  /** 发起人填的附加问题：邮件接着 Q 编号，附件印在「请另外回答」下 */
  extraQuestions: string[];
  /** 供应商必须随报价提供的材料（从 SAMPLES / SHOP_DRAWINGS / SAFETY / WARRANTY 派生）；其后固定追加 RFQ_COMPLIANCE_EVIDENCE_ZH */
  attachmentsRequested: string[];
  /** 被排除的要求（非供应商侧或未确认），便于内部核对不是"漏了" */
  excluded: Array<{ requirementCode: string; reason: "not_confirmed" | "not_supplier_facing" }>;
};

export type RfqBuildResult =
  | { ok: true; doc: RfqDocument }
  | { ok: false; errorCode: "NO_CONFIRMED_REQUIREMENTS" | "SENSITIVE_LEAK"; message: string; offending?: string[] }
  /** CHAIN-4b：命中招标身份；hits 只有类别与位置，不含原文 */
  | { ok: false; errorCode: "IDENTITY_LEAK"; message: string; hits: IdentityHit[] };

const DAY = 86_400_000;

/**
 * 只属于我方内部、绝不可能合法出现在招标要求原文里的字段/词。
 * RFQ-PDF-2 加了带「我方 / 内部 / 目标 / our / target / internal」限定的几个；不加 cost / budget / 成本 / 预算
 * 这类单词——招标文件正文里常见（at no additional cost），那是人写的自由文本那一档才用的词表。
 */
const INTERNAL_FIELD_PATTERNS: RegExp[] = [
  /estimatedValue/i, /ourBidPrice/i, /winningBidPrice/i, /毛利/, /利润率/, /底价/, /我方预算/, /中标概率/,
  /我方报价/, /我方成本/, /内部成本/, /目标毛利/, /our\s+bid\s+price/i, /target\s+margin/i, /internal\s+cost/i,
];

/** RFQ-PDF-2：材料清单里固定追加的一组（不随要求类别变化） */
export const RFQ_COMPLIANCE_EVIDENCE_TITLE_ZH = "首次合作或尚未提供过的，请一并提供";
export const RFQ_COMPLIANCE_EVIDENCE_ZH = [
  "营业执照复印件",
  "工厂照片（车间与生产现场）",
  "劳工与安全生产制度说明",
  "原材料来源（公司与国别）",
  "材质证书",
  "BSCI / SMETA / SA8000 审核报告（如有，非强制）",
] as const;

/** 没有数量阶梯也没有数量事实时的那句话（保留「未明确」三个字：回信解析靠它判断正文没给数量） */
export const RFQ_QUANTITY_UNKNOWN_ZH = "客户未明确数量，请按贵司常规阶梯（如 100 / 500 / 1000）分别报价。";

function fact(facts: RfqFactInput[], type: string): RfqFactInput | null {
  const ok = facts.filter(
    (f) => f.type === type && (f.manuallyConfirmed || f.confidence === "HIGH" || f.confidence === "VERIFIED"),
  );
  return ok[0] ?? null;
}

/** 某个时刻在某个时区的日期（YYYY-MM-DD）；时区无效时按 UTC */
function localDate(d: Date, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    return `${get("year")}-${get("month")}-${get("day")}`;
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

/** YYYY-MM-DD 加减天数（纯日期运算，不涉及时区） */
function shiftDate(ymd: string, days: number): string {
  return new Date(Date.parse(`${ymd}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
}

/**
 * 回复截止（YYYY-MM-DD，组织时区的日期）：
 *   「截标日 − 提前量」与「今天 + 2 天」里较晚的一个，且不晚于截标前一天；算出来早于今天（截标就在今天或已过）→ null（写「请尽快」）。
 * RFQ-PDF-2：之前按 UTC 日期、没有上限，截标前 2 天正好等于截标日期，被招标身份防护当成截标日期拦下，整份询价生成不了。
 * 回复截止永远不等于截标日期。
 */
export function computeReplyBy(closeDate: string | null, now: Date, replyLeadDays = 7, timeZone = "UTC"): string | null {
  if (!closeDate) return null;
  const close = new Date(closeDate);
  if (Number.isNaN(close.getTime())) return null;
  const closeDay = localDate(close, timeZone);
  const today = localDate(now, timeZone);
  const candidate = shiftDate(closeDay, -replyLeadDays);
  const floor = shiftDate(today, 2);
  const cap = shiftDate(closeDay, -1);
  let replyBy = candidate < floor ? floor : candidate;
  if (replyBy > cap) replyBy = cap;
  return replyBy < today ? null : replyBy;
}

/** 固定问题 Q1–Q5：必须类要求一个「能否满足」，加上单价 / 交期 / 有效期 / 认证四条。 */
function deriveFixedQuestions(items: RfqLineItem[]): RfqQuestion[] {
  const out: RfqQuestion[] = [];
  let seq = 1;
  const mandatory = items.filter((i) => i.mandatory);
  if (mandatory.length) {
    out.push({
      seq: seq++,
      text: `以下必须满足的要求请逐条回复「满足 / 部分满足（说明差异）/ 不满足」：${mandatory.map((i) => i.requirementCode).join("、")}`,
      relatedCodes: mandatory.map((i) => i.requirementCode),
    });
  }
  out.push({ seq: seq++, text: "各数量档的单价（含包装），以及最小起订量（MOQ）。", relatedCodes: [] });
  out.push({ seq: seq++, text: "收到订单后的生产交期（天），以及是否有现货。", relatedCodes: [] });
  out.push({ seq: seq++, text: "报价有效期（具体日期）。", relatedCodes: [] });
  out.push({ seq: seq++, text: "可提供的认证/检测报告清单（如有，请随报价附上）。", relatedCodes: [] });
  return out;
}

function deriveAttachments(items: RfqLineItem[]): string[] {
  const set = new Set<string>();
  for (const i of items) {
    if (i.category === "SAMPLES") set.add("样品（按要求里写的规格）");
    if (i.category === "SHOP_DRAWINGS") set.add("图纸 / 技术资料");
    if (i.category === "SAFETY") set.add("安全/合规证书或检测报告");
    if (i.category === "WARRANTY") set.add("质保条款书面说明");
  }
  return [...set];
}

const GROUP_OF = new Map<string, { key: RfqLineGroupKey; order: number }>(
  RFQ_LINE_GROUPS.flatMap((g, order) => g.categories.map((c): [string, { key: RfqLineGroupKey; order: number }] => [c, { key: g.key, order }])),
);

/** 行项按组分好（没有条目的组不出现）；邮件与附件共用 */
export function rfqLineGroups(doc: RfqDocument): Array<{ key: RfqLineGroupKey; titleZh: string; items: RfqLineItem[] }> {
  return RFQ_LINE_GROUPS.map((g) => ({ key: g.key, titleZh: g.titleZh, items: doc.lineItems.filter((i) => i.group === g.key) })).filter((g) => g.items.length > 0);
}

export function buildRfqDocument(input: RfqBuildInput): RfqBuildResult {
  const excluded: RfqDocument["excluded"] = [];
  const items: Array<RfqLineItem & { order: number }> = [];
  for (const r of input.requirements) {
    if (r.reviewStatus !== "CONFIRMED") {
      excluded.push({ requirementCode: r.requirementCode, reason: "not_confirmed" });
      continue;
    }
    const category = normalizeSupplierFacingCategory(r.category);
    if (!category) {
      excluded.push({ requirementCode: r.requirementCode, reason: "not_supplier_facing" });
      continue;
    }
    const group = GROUP_OF.get(category)!;
    const specOriginal = r.originalRequirement.trim();
    const specZh = (r.chineseTranslation ?? "").trim() || specOriginal;
    items.push({
      requirementCode: r.requirementCode,
      category,
      group: group.key,
      order: group.order,
      kind: r.mandatory ? "必须" : "加分",
      specZh,
      specOriginal,
      mandatory: r.mandatory,
      missingZh: needsChineseTranslation(specZh),
    });
  }
  if (items.length === 0) {
    return {
      ok: false,
      errorCode: "NO_CONFIRMED_REQUIREMENTS",
      message: "没有已确认且属于供应商侧的要求，先在青砚「招标要求」里逐条确认后再生成询价。",
    };
  }
  // 组序 → 要求编号升序（码点序，与输入怎么排无关）
  items.sort((a, b) => a.order - b.order || (a.requirementCode < b.requirementCode ? -1 : a.requirementCode > b.requirementCode ? 1 : 0));
  const lineItems: RfqLineItem[] = items.map(({ order: _order, ...rest }) => rest);

  // 数量：人填的阶梯 > 数量事实的原文 > 那句「未明确」
  const humanTiers = input.quantityTiers && input.quantityTiers.length
    ? [...new Set(input.quantityTiers.filter((n) => Number.isFinite(n) && n > 0))].sort((a, b) => a - b)
    : [];
  const tiers = humanTiers.length ? humanTiers : null;
  const qtyFact = tiers ? null : fact(input.facts, "quantity");
  const quantityFactZh = qtyFact ? (qtyFact.contentZh.trim() || (qtyFact.contentOriginal ?? "").trim() || null) : null;
  const quantityNote = tiers || quantityFactZh ? null : RFQ_QUANTITY_UNKNOWN_ZH;

  const deliveryFact = fact(input.facts, "delivery");
  const locationFact = fact(input.facts, "location");
  // CHAIN-4b：人工填写的目的地照用；没填时只取分析地点里的「城市, 省」，地点原文（常是精确地址）不再印进询价
  const humanDestination = input.destination?.trim() || null;
  const destination =
    humanDestination ?? cityLevelDestination(locationFact?.contentOriginal) ?? cityLevelDestination(locationFact?.contentZh) ?? null;
  const requiredLeadTimeNote = deliveryFact ? deliveryFact.contentZh : null;
  const extraQuestions = (input.extraQuestions ?? []).map((q) => q.trim()).filter(Boolean);

  const doc: RfqDocument = {
    contractVersion: RFQ_CONTRACT_VERSION,
    reference: input.identity.reference,
    buyerDisplayName: input.buyerDisplayName,
    contactName: input.contactName?.trim() || null,
    contactEmail: input.contactEmail?.trim() || null,
    scopeNote: input.scopeNote?.trim() || null,
    lineItems,
    missingTranslationCount: lineItems.filter((i) => i.missingZh).length,
    quantityTiers: tiers,
    quantityFactZh,
    quantityNote,
    incoterm: input.incoterm ?? null,
    destination,
    requiredLeadTimeNote,
    replyBy: computeReplyBy(input.closeDate, input.now, input.replyLeadDays, input.timeZone),
    fixedQuestions: deriveFixedQuestions(lineItems),
    extraQuestions,
    attachmentsRequested: deriveAttachments(lineItems),
    excluded,
  };

  // 出站硬闸（两档）：
  //  - 人工自由文本（范围说明/自定义问题/抬头/联系人/目的地）用 china-supplier-brief 的全量模式（含 cost/budget/金额）；
  //  - 招标原文（规格、译文、要求编号、交付要求、数量事实）只用"我方内部字段"窄模式——招标文件本身常含
  //    "at no additional cost" / "$" 这类合法词，不能因此拒发；而估值/我方报价/毛利/预算这些永远不该出现在
  //    招标原文里，出现即说明数据被污染。
  const freeText = [doc.buyerDisplayName, doc.contactName ?? "", doc.scopeNote ?? "", humanDestination ?? "", ...(input.extraQuestions ?? [])];
  const specText = [doc.requiredLeadTimeNote ?? "", doc.quantityFactZh ?? "", ...doc.lineItems.flatMap((i) => [i.requirementCode, i.specZh, i.specOriginal])];
  const offending = [
    ...freeText.filter((t) => containsSensitiveSupplierBriefText(t)),
    ...specText.filter((t) => INTERNAL_FIELD_PATTERNS.some((re) => re.test(t))),
  ];
  if (offending.length) {
    return {
      ok: false,
      errorCode: "SENSITIVE_LEAK",
      message: "询价内容含内部财务信息，已拒绝生成；请检查范围说明/自定义问题。",
      offending: offending.map((t) => t.slice(0, 80)),
    };
  }

  // CHAIN-4b：招标身份（敏感词之后）。逐字段扫，位置精确到栏目 / 要求编号；项目名称只查我方撰写与人工填写的部分。
  const hits = scanIdentity(input.identity.denyList, rfqIdentitySegments(doc, input, humanDestination));
  if (hits.length) return { ok: false, errorCode: "IDENTITY_LEAK", message: identityLeakMessageZh(hits), hits };
  return { ok: true, doc };
}

/** 询价单里每一处供应商看得到的文字，标明是我方撰写、人工填写还是招标原文 */
function rfqIdentitySegments(doc: RfqDocument, input: RfqBuildInput, humanDestination: string | null): IdentitySegment[] {
  const segs: IdentitySegment[] = [
    { where: "询价编号", text: doc.reference, kind: "authored" },
    { where: "我方抬头", text: doc.buyerDisplayName, kind: "authored" },
    { where: "联系人", text: doc.contactName ?? "", kind: "authored" },
    { where: "联系邮箱", text: doc.contactEmail ?? "", kind: "authored" },
    { where: "补充说明", text: doc.scopeNote ?? "", kind: "human" },
    { where: "目的地", text: doc.destination ?? "", kind: humanDestination ? "human" : "tender" },
    ...(input.extraQuestions ?? []).map((q, i): IdentitySegment => ({ where: `第 ${i + 1} 条附加问题`, text: q, kind: "human" })),
    { where: "交付要求", text: doc.requiredLeadTimeNote ?? "", kind: "tender" },
    { where: "数量", text: doc.quantityFactZh ?? "", kind: "tender" },
    ...doc.lineItems.map((i): IdentitySegment => ({ where: `要求 ${i.requirementCode}`, text: `${i.requirementCode}\n${i.specZh}\n${i.specOriginal}`, kind: "tender" })),
  ];
  return segs;
}

/**
 * 把招标原文（规格、交付要求、数量事实、从地点派生的目的地）留空的那一份询价单：模板自己写的句子用它过禁出清单
 * （项目名称类也查）。人工填写的目的地保留——它属于「人工填写」，不是招标原文。
 * 起草询价（邮件模板句子、附件模板文字）与菜单生成询价单共用，两边留空的口径不会不一样。
 */
export function rfqTemplateOnlyDocument(doc: RfqDocument, humanDestination: string | null | undefined): RfqDocument {
  return {
    ...doc,
    lineItems: doc.lineItems.map((li) => ({ ...li, specZh: "", specOriginal: "" })),
    requiredLeadTimeNote: null,
    quantityFactZh: null,
    destination: humanDestination?.trim() || null,
  };
}

/* ---------------------------------- 渲染 ---------------------------------- */

/** 数量那一行的写法（三种）：人填的阶梯 / 数量事实的原文 / 那句「未明确」 */
export function rfqQuantityZh(doc: RfqDocument): string {
  if (doc.quantityTiers) return doc.quantityTiers.map((n) => `${n}`).join(" / ") + "（请分档报价）";
  return doc.quantityFactZh ?? doc.quantityNote ?? "";
}

/** 贸易条款与目的地那一行 */
export function rfqTradeTermsZh(doc: RfqDocument): string {
  return `${doc.incoterm ?? "请注明报价贸易条款"}${doc.destination ? `，目的地 ${doc.destination}` : ""}`;
}

/** 商务条件（邮件正文用；附件的「询价内容」用同样的写法，回复截止印在抬头） */
export function rfqCommercialTermsZh(doc: RfqDocument): Array<{ label: string; value: string }> {
  const out = [
    { label: "数量", value: rfqQuantityZh(doc) },
    { label: "贸易条款", value: rfqTradeTermsZh(doc) },
  ];
  if (doc.requiredLeadTimeNote) out.push({ label: "交付要求", value: doc.requiredLeadTimeNote });
  out.push({ label: "回复截止", value: doc.replyBy ?? "请尽快" });
  return out;
}

/** 材料清单（邮件正文与附件同序同条数）：派生项，然后固定的一组 */
export function rfqMaterialsZh(doc: RfqDocument): { derived: string[]; groupTitle: string; group: readonly string[] } {
  return { derived: [...doc.attachmentsRequested], groupTitle: RFQ_COMPLIANCE_EVIDENCE_TITLE_ZH, group: RFQ_COMPLIANCE_EVIDENCE_ZH };
}

/** CHAIN-4a：带附件时正文里的那一句 */
export function rfqAttachmentBodyLineZh(filename: string): string {
  return `附件《${filename}》是上面清单的表格版，方便转给技术同事核对；可以直接在邮件里按编号回复，也可以把填好的表以 Excel 或可复制文字的 PDF 发回（请不要只发照片或扫描件）。`;
}

/** 邮件正文的结尾（「为便于比对」开头：带附件的那一句插在它前面） */
export const RFQ_EMAIL_CLOSING_ZH = "为便于比对，请按要求编号逐条回复；做不到的请直接写明，我们更看重准确。";

/**
 * 供应商邮件正文（中文为主，规格保留原文以免翻译歧义）。
 * RFQ-PDF-2：规格行按组、以要求编号开头（`{编号} 【必须】…`），不再有序号与招标文件页码；
 * 回信解析（inbound-contract.ts rfqContextFromBody）从「- 数量：」与「{编号} 【必须】」读上下文，改这两处的写法要同步改它。
 */
export function renderRfqEmail(doc: RfqDocument, opts?: { supplierName?: string | null; roundNumber?: number | null; attachmentFilename?: string | null }): {
  subject: string;
  body: string;
} {
  // CHAIN-4b：只用中性询价编号称呼项目；标题与正文都不出现项目名称
  const subject = `询价 ${doc.reference}${opts?.roundNumber ? `（第 ${opts.roundNumber} 轮）` : ""}${doc.replyBy ? ` — 请于 ${doc.replyBy} 前回复` : ""}`;
  const L: string[] = [];
  L.push(`${opts?.supplierName ? `${opts.supplierName} ` : ""}您好：`);
  L.push("");
  L.push(`${doc.buyerDisplayName} 现就询价 ${doc.reference} 邀请贵司报价，请按以下清单逐项回复。`);
  if (doc.scopeNote) L.push(`范围说明：${doc.scopeNote}`);
  L.push("");
  L.push("一、规格要求（请按编号逐条确认）");
  for (const g of rfqLineGroups(doc)) {
    L.push(`【${g.titleZh}】（${g.items.length} 条）`);
    for (const i of g.items) {
      L.push(`${i.requirementCode} 【${i.kind}】${i.missingZh ? RFQ_MISSING_ZH_NOTE : i.specZh}`);
      if (i.specOriginal && (i.missingZh || i.specOriginal !== i.specZh)) L.push(`   原文：${i.specOriginal}`);
    }
  }
  L.push("");
  L.push("二、商务条件");
  for (const c of rfqCommercialTermsZh(doc)) L.push(`- ${c.label}：${c.value}`);
  L.push("");
  L.push("三、请在回复中逐条回答");
  for (const q of doc.fixedQuestions) L.push(`Q${q.seq}. ${q.text}`);
  doc.extraQuestions.forEach((q, i) => L.push(`Q${doc.fixedQuestions.length + i + 1}. ${q}`));
  L.push("");
  L.push("四、请随报价提供");
  const materials = rfqMaterialsZh(doc);
  for (const a of materials.derived) L.push(`- ${a}`);
  L.push(`${materials.groupTitle}：`);
  for (const a of materials.group) L.push(`- ${a}`);
  L.push("");
  // CHAIN-4a：带附件的卡多这一句（不写页数：执行时重新生成 PDF，页数以卡上为准）
  if (opts?.attachmentFilename) {
    L.push(rfqAttachmentBodyLineZh(opts.attachmentFilename));
    L.push("");
  }
  L.push(RFQ_EMAIL_CLOSING_ZH);
  L.push("");
  L.push(doc.buyerDisplayName);
  return { subject, body: L.join("\n") };
}
