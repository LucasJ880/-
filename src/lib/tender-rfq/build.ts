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
 *   5. CHAIN-4b：对供应商只用中性询价编号称呼项目（不写项目名）；目的地只写人工填写的或
 *      分析地点里的「城市, 省」；任何字段命中本项目的禁出清单或邮箱 / 电话格式 → 整个文档失败。
 */

import type { RequirementCategoryV2 } from "@/lib/tender-understanding/contract";
import { containsSensitiveSupplierBriefText } from "@/lib/bid-workflow/china-supplier-brief";
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
  /** 我方对供应商的抬头（tenderProfile.quoteHeader.companyName；缺省用项目所属组织名） */
  buyerDisplayName: string;
  /** 投标截标日（ISO）；回复截止 = 截标 − replyLeadDays，且不早于今天+2 */
  closeDate: string | null;
  now: Date;
  requirements: RfqRequirementInput[];
  facts: RfqFactInput[];
  /** 希望供应商报价的数量阶梯；为空时按事实槽位 quantity 单档，再为空则留给供应商注明 */
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

export type RfqLineItem = {
  seq: number;
  requirementCode: string;
  category: string;
  specZh: string;
  specOriginal: string;
  mandatory: boolean;
  sourcePage: number | null;
};

export type RfqQuestion = { seq: number; text: string; relatedCodes: string[] };

export type RfqDocument = {
  contractVersion: typeof RFQ_CONTRACT_VERSION;
  /** 对供应商的中性询价编号（RFQ-{组织}-{年份}-{5 位码}） */
  reference: string;
  buyerDisplayName: string;
  scopeNote: string | null;
  lineItems: RfqLineItem[];
  quantityTiers: number[] | null;
  quantityNote: string | null;
  incoterm: string | null;
  destination: string | null;
  requiredLeadTimeNote: string | null;
  replyBy: string | null;
  questions: RfqQuestion[];
  /** 供应商必须随报价提供的材料（从 SAMPLES / SHOP_DRAWINGS / SAFETY 派生） */
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

/** 只属于我方内部、绝不可能合法出现在招标要求原文里的字段/词 */
const INTERNAL_FIELD_PATTERNS: RegExp[] = [/estimatedValue/i, /ourBidPrice/i, /winningBidPrice/i, /毛利/, /利润率/, /底价/, /我方预算/, /中标概率/];

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function fact(facts: RfqFactInput[], type: string): RfqFactInput | null {
  const ok = facts.filter(
    (f) => f.type === type && (f.manuallyConfirmed || f.confidence === "HIGH" || f.confidence === "VERIFIED"),
  );
  return ok[0] ?? null;
}

function parseQuantity(text: string | null): number | null {
  if (!text) return null;
  const m = text.replace(/,/g, "").match(/(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function computeReplyBy(closeDate: string | null, now: Date, replyLeadDays = 7): string | null {
  if (!closeDate) return null;
  const close = new Date(closeDate);
  if (Number.isNaN(close.getTime())) return null;
  const candidate = new Date(close.getTime() - replyLeadDays * DAY);
  const floor = new Date(now.getTime() + 2 * DAY);
  return iso(candidate < floor ? floor : candidate);
}

/** 从行项派生标准问题：每条强制要求一个「能否满足」，加上交期/MOQ/有效期/认证四条固定项。 */
function deriveQuestions(items: RfqLineItem[], extra: string[]): RfqQuestion[] {
  const out: RfqQuestion[] = [];
  let seq = 1;
  const mandatory = items.filter((i) => i.mandatory);
  if (mandatory.length) {
    out.push({
      seq: seq++,
      text: `以下强制要求请逐条回复「满足 / 部分满足（说明差异）/ 不满足」：${mandatory.map((i) => i.requirementCode).join("、")}`,
      relatedCodes: mandatory.map((i) => i.requirementCode),
    });
  }
  out.push({ seq: seq++, text: "各数量档的单价（含包装），以及最小起订量（MOQ）。", relatedCodes: [] });
  out.push({ seq: seq++, text: "收到订单后的生产交期（天），以及是否有现货。", relatedCodes: [] });
  out.push({ seq: seq++, text: "报价有效期（具体日期）。", relatedCodes: [] });
  out.push({ seq: seq++, text: "可提供的认证/检测报告清单（如有，请随报价附上）。", relatedCodes: [] });
  for (const q of extra) {
    const t = q.trim();
    if (t) out.push({ seq: seq++, text: t, relatedCodes: [] });
  }
  return out;
}

function deriveAttachments(items: RfqLineItem[]): string[] {
  const set = new Set<string>();
  for (const i of items) {
    if (i.category === "SAMPLES") set.add("样品（按行项说明的规格）");
    if (i.category === "SHOP_DRAWINGS") set.add("图纸 / 技术资料");
    if (i.category === "SAFETY") set.add("安全/合规证书或检测报告");
    if (i.category === "WARRANTY") set.add("质保条款书面说明");
  }
  return [...set];
}

export function buildRfqDocument(input: RfqBuildInput): RfqBuildResult {
  const excluded: RfqDocument["excluded"] = [];
  const items: RfqLineItem[] = [];
  let seq = 1;
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
    items.push({
      seq: seq++,
      requirementCode: r.requirementCode,
      category,
      specZh: (r.chineseTranslation ?? "").trim() || r.originalRequirement.trim(),
      specOriginal: r.originalRequirement.trim(),
      mandatory: r.mandatory,
      sourcePage: r.sourcePage,
    });
  }
  if (items.length === 0) {
    return {
      ok: false,
      errorCode: "NO_CONFIRMED_REQUIREMENTS",
      message: "没有已确认且属于供应商侧的要求，先在青砚「招标要求」里逐条确认后再生成询价。",
    };
  }

  const qtyFact = fact(input.facts, "quantity");
  const tiers =
    input.quantityTiers && input.quantityTiers.length
      ? [...new Set(input.quantityTiers.filter((n) => Number.isFinite(n) && n > 0))].sort((a, b) => a - b)
      : (() => {
          const q = parseQuantity(qtyFact?.contentOriginal ?? qtyFact?.contentZh ?? null);
          return q ? [q] : null;
        })();
  const quantityNote = tiers ? null : "招标文件未明确数量，请按贵司常规阶梯（如 100 / 500 / 1000）分别报价。";

  const deliveryFact = fact(input.facts, "delivery");
  const locationFact = fact(input.facts, "location");
  // CHAIN-4b：人工填写的目的地照用；没填时只取分析地点里的「城市, 省」，地点原文（常是精确地址）不再印进询价
  const humanDestination = input.destination?.trim() || null;
  const destination =
    humanDestination ?? cityLevelDestination(locationFact?.contentOriginal) ?? cityLevelDestination(locationFact?.contentZh) ?? null;
  const requiredLeadTimeNote = deliveryFact ? deliveryFact.contentZh : null;

  const doc: RfqDocument = {
    contractVersion: RFQ_CONTRACT_VERSION,
    reference: input.identity.reference,
    buyerDisplayName: input.buyerDisplayName,
    scopeNote: input.scopeNote?.trim() || null,
    lineItems: items,
    quantityTiers: tiers,
    quantityNote,
    incoterm: input.incoterm ?? null,
    destination,
    requiredLeadTimeNote,
    replyBy: computeReplyBy(input.closeDate, input.now, input.replyLeadDays),
    questions: deriveQuestions(items, input.extraQuestions ?? []),
    attachmentsRequested: deriveAttachments(items),
    excluded,
  };

  // 出站硬闸（两档）：
  //  - 人工自由文本（范围说明/自定义问题/抬头/目的地）用 china-supplier-brief 的全量模式（含 cost/budget/金额）；
  //  - 招标原文行项只用"我方内部字段"窄模式——招标文件本身常含 "at no additional cost" / "$" 这类合法词，
  //    不能因此拒发；而估值/我方报价/毛利/预算这些永远不该出现在要求原文里，出现即说明数据被污染。
  const freeText = [doc.buyerDisplayName, doc.scopeNote ?? "", humanDestination ?? "", ...(input.extraQuestions ?? [])];
  const specText = [doc.requiredLeadTimeNote ?? "", ...doc.lineItems.flatMap((i) => [i.specZh, i.specOriginal])];
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
    { where: "补充说明", text: doc.scopeNote ?? "", kind: "human" },
    { where: "目的地", text: doc.destination ?? "", kind: humanDestination ? "human" : "tender" },
    ...(input.extraQuestions ?? []).map((q, i): IdentitySegment => ({ where: `第 ${i + 1} 条附加问题`, text: q, kind: "human" })),
    { where: "交付要求", text: doc.requiredLeadTimeNote ?? "", kind: "tender" },
    ...doc.lineItems.map((i): IdentitySegment => ({ where: `要求 ${i.requirementCode}`, text: `${i.specZh}\n${i.specOriginal}`, kind: "tender" })),
  ];
  return segs;
}

/* ---------------------------------- 渲染 ---------------------------------- */

/** 商务条件（邮件正文与 CHAIN-4a 附件共用同一份，两边不会写得不一样） */
export function rfqCommercialTermsZh(doc: RfqDocument): Array<{ label: string; value: string }> {
  const out = [
    { label: "数量", value: doc.quantityTiers ? doc.quantityTiers.map((n) => `${n}`).join(" / ") + "（请分档报价）" : (doc.quantityNote ?? "") },
    { label: "贸易条款", value: `${doc.incoterm ?? "请注明报价贸易条款"}${doc.destination ? `，目的地 ${doc.destination}` : ""}` },
  ];
  if (doc.requiredLeadTimeNote) out.push({ label: "交付要求", value: doc.requiredLeadTimeNote });
  out.push({ label: "回复截止", value: doc.replyBy ?? "请尽快" });
  return out;
}

/** CHAIN-4a：带附件时正文里的那一句 */
export function rfqAttachmentBodyLineZh(filename: string): string {
  return `附件《${filename}》是上面清单的表格版，方便转给技术同事核对；可以直接在邮件里按编号回复，也可以填好表格随报价一起发回。`;
}

/** 供应商邮件正文（中文为主，规格保留原文以免翻译歧义）。 */
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
  L.push("一、规格要求（请逐条确认）");
  for (const i of doc.lineItems) {
    const tag = i.mandatory ? "【强制】" : "【评分】";
    const page = i.sourcePage ? `（招标文件 p.${i.sourcePage}）` : "";
    L.push(`${i.seq}. ${tag}${i.requirementCode} ${i.specZh}${page}`);
    if (i.specOriginal && i.specOriginal !== i.specZh) L.push(`   原文：${i.specOriginal}`);
  }
  L.push("");
  L.push("二、商务条件");
  for (const c of rfqCommercialTermsZh(doc)) L.push(`- ${c.label}：${c.value}`);
  L.push("");
  L.push("三、请在回复中逐条回答");
  for (const q of doc.questions) L.push(`Q${q.seq}. ${q.text}`);
  if (doc.attachmentsRequested.length) {
    L.push("");
    L.push("四、请随报价提供");
    for (const a of doc.attachmentsRequested) L.push(`- ${a}`);
  }
  L.push("");
  // CHAIN-4a：带附件的卡多这一句（不写页数：执行时重新生成 PDF，页数以卡上为准）
  if (opts?.attachmentFilename) {
    L.push(rfqAttachmentBodyLineZh(opts.attachmentFilename));
    L.push("");
  }
  L.push("为便于比对，请按上述编号逐项回复；若某项无法满足请直说，我们更看重准确。");
  L.push("");
  L.push(doc.buyerDisplayName);
  return { subject, body: L.join("\n") };
}
