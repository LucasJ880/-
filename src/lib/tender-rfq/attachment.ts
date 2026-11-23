/**
 * CHAIN-4a 询价 PDF 附件 — 内容排版与指纹（纯函数，零 DB / 零 LLM）
 *
 * 附件只来自询价单本身（build.ts 已筛好、已过敏感词表与招标身份防护的 RfqDocument），
 * 用固定模板重排：不读原标书、不读项目、不读收件人，所以同一轮各家同一份。
 * 内容指纹 = 渲染出的 HTML 的 SHA-256：Chromium 的 PDF 带生成时刻（字节不可复现，design D1），
 * 所以审批哈希覆盖的是内容；实际发出的 PDF 字节的 SHA-256 记进审计。
 */

import { createHash } from "node:crypto";
import { RFQ_MISSING_ZH_NOTE, rfqLineGroups, rfqMaterialsZh, rfqQuantityZh, rfqTradeTermsZh, type RfqDocument } from "./build";
import type { InboundMissingField } from "./inbound-contract";
import type { IdentitySegment } from "@/lib/bid-workflow/project-identity-deny";

export {
  RFQ_ATTACHMENT_CHANGED_CARD_ZH,
  RFQ_ATTACHMENT_CHANGED_EXEC_ZH,
  RFQ_ATTACHMENT_EXEC_FAILED_ZH,
  RFQ_ATTACHMENT_IDENTITY_CARD_ZH,
  RFQ_ATTACHMENT_TEMPLATE_CARD_ZH,
  RFQ_ATTACHMENT_TEMPLATE_EXEC_ZH,
  attachmentSizeLabelZh,
  attachmentSummaryZh,
  readPayloadAttachment,
  rfqAttachmentAutoDraftFailedZh,
  rfqAttachmentFailedMessageZh,
  rfqAttachmentIdentityExecZh,
  rfqAttachmentPreviewHref,
} from "./attachment-view";
export type { RfqAttachmentDraftParams, RfqAttachmentPreview, RfqPayloadAttachment } from "./attachment-view";

export const RFQ_ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;
/**
 * 附件版式版本。改了附件模板（本文件的文字 / 结构 / 样式）或询价单的生成规则（build.ts 里会进附件的部分）时 SHALL 加一：
 * 旧版本起草的卡执行时按「系统更新了版式」拒发，而不是误报「内容变了」。attachment.test.ts 的定版指纹用例会提醒。
 */
export const RFQ_ATTACHMENT_TEMPLATE_VERSION = 2;
export const RFQ_ATTACHMENT_MIME = "application/pdf" as const;
export const RFQ_ATTACHMENT_TITLE_ZH = "询价单";
/** 回复方式（回信解析读不了图片与扫描件，所以请对方发可复制文字的文件） */
export const RFQ_ATTACHMENT_FOOTER_ZH = "请把回复发给发来本询价单的联系人：按编号逐条写明，或把填好的表以 Excel / 可复制文字的 PDF 发回，请不要只发照片或扫描件。做不到的请直接写明，我们更看重准确。";
/** 规格确认表上方的一句：原文是写给投标人（我方）的，工厂只需确认产品与资料 */
export const RFQ_ATTACHMENT_SPEC_NOTE_ZH = "以下是最终客户的要求。原文里的 bidder / vendor / supplier 指我方，贵司只需确认产品与资料能否满足。";
/**
 * 报价表的六个栏目 ↔ 回信解析的六个缺字段（inbound-contract.ts INBOUND_MISSING_FIELDS）。
 * 类型上必须覆盖每一个缺字段：回信解析多一个字段而这里没有栏目，编译不过。
 */
export const RFQ_QUOTE_FIELD_LABELS: Readonly<Record<InboundMissingField, string>> = {
  price: "单价（含包装）",
  currency: "币种",
  incoterm: "贸易条款",
  moq: "最小起订量",
  deliveryDays: "生产交期（天）",
  validUntil: "报价有效期至",
};
/** 「是否满足」的三个勾选框 */
export const RFQ_ATTACHMENT_CHECKS_ZH = ["□ 满足", "□ 部分满足", "□ 不满足"] as const;
/** 空白签章栏（不印任何供应商名称；供应商自己填） */
export const RFQ_ATTACHMENT_SIGNOFF_ZH = ["供应商名称：＿＿＿＿＿＿＿＿", "填写人 / 电话：＿＿＿＿＿＿＿＿", "日期：＿＿＿＿＿＿（盖章）"] as const;
export const RFQ_ATTACHMENT_CSP = "default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:";
/** 身份检查里附件模板文字的位置名 */
export const RFQ_ATTACHMENT_SEGMENT_WHERE = "询价附件";

export function rfqAttachmentFilename(reference: string): string {
  return `询价单-${reference}.pdf`;
}

/** 起草日期：组织时区的 YYYY-MM-DD */
export function rfqAttachmentDraftedOn(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/* ---------------------------------- 内容模型 ---------------------------------- */

const DRAFTED_ON_LABEL = "询价日期";
const OTHER_TIER_ZH = "其他数量档";
const EXTRA_TITLE_ZH = "请另外回答";
const MATERIALS_TITLE_ZH = "请随报价提供";
const NUMERALS = ["一", "二", "三", "四", "五", "六"] as const;
const TABLE_HEAD = ["编号", "要求", "类型", "是否满足", "差异说明"] as const;
const QUOTE_HEAD = ["数量", RFQ_QUOTE_FIELD_LABELS.price, RFQ_QUOTE_FIELD_LABELS.currency, RFQ_QUOTE_FIELD_LABELS.incoterm, "备注"] as const;
const QUOTE_BOXES = [RFQ_QUOTE_FIELD_LABELS.moq, RFQ_QUOTE_FIELD_LABELS.deliveryDays, RFQ_QUOTE_FIELD_LABELS.validUntil] as const;

type Row = { code: string; kind: string; spec: string; original: string | null };

type Model = {
  title: string;
  buyer: string;
  /** 联系人 / 邮箱（没有的不出现） */
  contact: Array<{ label: string; value: string }>;
  /** 询价编号 / 询价日期 / 回复截止 */
  ref: Array<{ label: string; value: string; strong?: boolean }>;
  /** 询价内容：范围说明（有时）/ 数量 / 贸易条款 / 交付要求（有时） */
  terms: Array<{ label: string; value: string }>;
  /** 报价表的数量档（人填的）；没填时一行空数量 */
  tiers: string[];
  incoterm: string;
  groups: Array<{ title: string; rows: Row[] }>;
  extraQuestions: string[];
  materials: { derived: string[]; groupTitle: string; group: readonly string[] };
  /** 各节标题（按实际出现的节顺序编号） */
  sections: { content: string; quote: string; spec: string; extra: string | null; materials: string };
  footer: string;
};

function model(doc: RfqDocument, draftedOn: string): Model {
  const terms: Model["terms"] = [];
  if (doc.scopeNote) terms.push({ label: "范围说明", value: doc.scopeNote });
  terms.push({ label: "数量", value: rfqQuantityZh(doc) });
  terms.push({ label: "贸易条款", value: rfqTradeTermsZh(doc) });
  if (doc.requiredLeadTimeNote) terms.push({ label: "交付要求", value: doc.requiredLeadTimeNote });
  const hasExtra = doc.extraQuestions.length > 0;
  let n = 0;
  const title = (t: string) => `${NUMERALS[n++]}、${t}`;
  return {
    title: RFQ_ATTACHMENT_TITLE_ZH,
    buyer: doc.buyerDisplayName,
    contact: [
      ...(doc.contactName ? [{ label: "联系人", value: doc.contactName }] : []),
      ...(doc.contactEmail ? [{ label: "邮箱", value: doc.contactEmail }] : []),
    ],
    ref: [
      { label: "询价编号", value: doc.reference },
      { label: DRAFTED_ON_LABEL, value: draftedOn },
      { label: "回复截止", value: doc.replyBy ?? "请尽快", strong: true },
    ],
    terms,
    tiers: doc.quantityTiers ? doc.quantityTiers.map((t) => `${t}`) : [""],
    incoterm: doc.incoterm ?? "",
    // 与 renderRfqEmail 同序同条数：build.ts 已按「组序 → 要求编号」排好
    groups: rfqLineGroups(doc).map((g) => ({
      title: `${g.titleZh}（${g.items.length} 条）`,
      rows: g.items.map((i) => ({
        code: i.requirementCode,
        kind: i.kind,
        spec: i.missingZh ? RFQ_MISSING_ZH_NOTE : i.specZh,
        original: i.specOriginal && (i.missingZh || i.specOriginal !== i.specZh) ? i.specOriginal : null,
      })),
    })),
    extraQuestions: [...doc.extraQuestions],
    materials: rfqMaterialsZh(doc),
    sections: {
      content: title("询价内容"),
      quote: title("报价"),
      spec: title("规格确认"),
      extra: hasExtra ? title(EXTRA_TITLE_ZH) : null,
      materials: title(MATERIALS_TITLE_ZH),
    },
    footer: RFQ_ATTACHMENT_FOOTER_ZH,
  };
}

/**
 * 附件里供应商看得到的每一段文字（未转义），身份检查与测试用。
 * omitDraftedOn：询价日期是系统生成的日期，与 CHAIN-4b 供应商侧文件的生成日期一样不参与禁出清单比对。
 */
export function rfqAttachmentTextBlocks(doc: RfqDocument, opts: { draftedOn: string; omitDraftedOn?: boolean }): string[] {
  const m = model(doc, opts.draftedOn);
  return [
    m.title,
    m.buyer,
    ...m.contact.flatMap((x) => [x.label, x.value]),
    ...m.ref.flatMap((x) => (opts.omitDraftedOn && x.label === DRAFTED_ON_LABEL ? [x.label] : [x.label, x.value])),
    m.sections.content,
    ...m.terms.map((t) => `${t.label}：${t.value}`),
    m.sections.quote,
    ...QUOTE_HEAD,
    ...m.tiers,
    OTHER_TIER_ZH,
    ...(m.incoterm ? [m.incoterm] : []),
    ...QUOTE_BOXES,
    m.sections.spec,
    RFQ_ATTACHMENT_SPEC_NOTE_ZH,
    ...TABLE_HEAD,
    ...m.groups.flatMap((g) => [g.title, ...g.rows.flatMap((r) => [r.code, r.kind, r.spec, ...(r.original ? [r.original] : []), ...RFQ_ATTACHMENT_CHECKS_ZH])]),
    ...(m.sections.extra ? [m.sections.extra, ...m.extraQuestions] : []),
    m.sections.materials,
    ...m.materials.derived,
    m.materials.groupTitle,
    ...m.materials.group,
    m.footer,
    ...RFQ_ATTACHMENT_SIGNOFF_ZH,
    pageFooterText(doc.reference),
  ];
}

/** 每页页脚（询价编号 + 页码；页码由打印时填） */
function pageFooterText(reference: string): string {
  return `${reference} · 第 N / M 页`;
}

/* ---------------------------------- HTML ---------------------------------- */

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** 多行文字：转义后换行变 <br> */
function escLines(s: string): string {
  return esc(s).replace(/\r?\n/g, "<br>");
}

/** CSS 字符串里的值：只留安全字符（询价编号本来就只有字母数字与连字符） */
function cssString(s: string): string {
  return s.replace(/[^A-Za-z0-9 .\-]/g, "");
}

/**
 * 版式（RFQ-PDF-2）：A4 竖版；正文 9.5pt；表头与组标题 9pt；勾选栏 8pt；各节标题 11pt；标题 20pt；
 * 颜色只有黑、深灰与浅灰底（黑白打印清楚）。规格确认表五列定宽：编号 11%、要求 47%、类型 7%、是否满足 15%、差异说明 20%。
 */
const CSS_BASE = [
  "body{font-family:'Noto Sans SC','PingFang SC','Microsoft YaHei',sans-serif;font-size:9.5pt;color:#000;line-height:1.45;margin:0}",
  "h1{font-size:20pt;margin:0 0 2px;font-weight:700;line-height:1.2}",
  "h2{font-size:11pt;margin:12px 0 5px;font-weight:700;break-after:avoid;page-break-after:avoid}",
  ".head{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;border-bottom:1.5px solid #000;padding-bottom:6px}",
  ".buyer{font-size:11pt;font-weight:700}",
  ".contact{color:#444}",
  ".contact span{margin-right:18px}",
  "table{border-collapse:collapse}",
  "table.ref td{padding:1px 0 1px 10px;vertical-align:top}",
  "table.ref td.k{color:#444;padding-left:0;white-space:nowrap}",
  "table.kv{width:100%}",
  "table.kv td{padding:1px 8px 1px 0;vertical-align:top}",
  "table.kv td.k{width:5em;color:#444;white-space:nowrap}",
  "table.grid{width:calc(100% - 1px);table-layout:fixed}",
  "table.grid th,table.grid td{border:1px solid #888;padding:3px 5px;vertical-align:top;text-align:left}",
  "table.grid th{background:#eee;font-size:9pt;font-weight:700}",
  "tr{break-inside:avoid;page-break-inside:avoid}",
  "table.quote td{height:15pt}",
  "table.boxes{margin-top:-1px}",
  "table.boxes td{height:15pt}",
  "table.boxes .k{color:#444;font-size:9pt}",
  ".note{margin:0 0 5px;color:#444}",
  "th.c,td.c{width:11%}",
  "td.c{overflow-wrap:anywhere;word-break:break-all}",
  "th.s,td.s{width:47%}",
  "th.k,td.k{width:7%}",
  "th.y,td.y{width:15%}",
  "td.y{font-size:8pt;white-space:nowrap;line-height:1.5}",
  "th.e,td.e{width:20%}",
  "tr.grp td{background:#f5f5f5;font-size:9pt;font-weight:700;break-after:avoid;page-break-after:avoid}",
  ".en{color:#444;margin-top:1px;line-height:1.35}",
  "ol{margin:2px 0;padding-left:20px}",
  "ul.chk{list-style:none;margin:2px 0;padding:0}",
  ".sub{margin:6px 0 2px;font-size:9pt;font-weight:700}",
  ".tail{break-inside:avoid;page-break-inside:avoid;margin-top:12px}",
  ".reply{margin:0 0 6px}",
  ".signoff{border:1px solid #888;padding:8px 10px;display:flex;flex-wrap:wrap;gap:6px 28px}",
].join("");

/** 每页底部居中：询价编号 + 第 N / M 页（Chromium 的 @page 边距盒） */
function pageCss(reference: string): string {
  return `@page{size:A4;@bottom-center{content:"${cssString(reference)} · 第 " counter(page) " / " counter(pages) " 页";font-family:'Noto Sans SC',sans-serif;font-size:8pt;color:#444}}`;
}

/**
 * 附件 HTML。对同样的输入输出完全相同（不含生成时刻、随机数、收件人）。
 * `<meta charset="utf-8">` 必须原样保留：html-to-pdf 在它之后注入中文字体。
 * englishPt：英文对照的字号。只有样张脚本传 7.5；起草、执行、菜单生成都不传（= 8），所以线上只有一种版式、内容指纹稳定。
 */
export function renderRfqAttachmentHtml(doc: RfqDocument, opts: { draftedOn: string; englishPt?: 8 | 7.5 }): string {
  const m = model(doc, opts.draftedOn);
  const englishPt = opts.englishPt === 7.5 ? 7.5 : 8;
  const H: string[] = [];
  // CSP：不执行任何脚本、不发任何网络请求（只允许内联样式与 data: 字体 / 图片）——招标原文是第三方文本，
  // 即使将来哪里漏了转义，也不会在服务器的 Chromium 里跑脚本或去访问外部地址
  H.push('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">');
  H.push(`<meta http-equiv="Content-Security-Policy" content="${RFQ_ATTACHMENT_CSP}">`);
  H.push(`<title>${esc(m.title)} ${esc(doc.reference)}</title><style>${pageCss(doc.reference)}${CSS_BASE}.en{font-size:${englishPt}pt}</style></head><body>`);

  // 首屏：标题 + 我方抬头 + 联系人 / 邮箱；右侧询价编号 / 询价日期 / 回复截止（加粗）
  H.push('<div class="head"><div>');
  H.push(`<h1>${esc(m.title)}</h1><div class="buyer">${esc(m.buyer)}</div>`);
  if (m.contact.length) H.push(`<div class="contact">${m.contact.map((x) => `<span>${esc(x.label)}：${esc(x.value)}</span>`).join("")}</div>`);
  H.push("</div>");
  H.push(`<table class="ref">${m.ref.map((x) => `<tr><td class="k">${esc(x.label)}</td><td>${x.strong ? `<strong>${esc(x.value)}</strong>` : esc(x.value)}</td></tr>`).join("")}</table>`);
  H.push("</div>");

  H.push(`<h2>${esc(m.sections.content)}</h2>`);
  H.push(`<table class="kv">${m.terms.map((t) => `<tr><td class="k">${esc(t.label)}</td><td>${escLines(t.value)}</td></tr>`).join("")}</table>`);

  // 报价表：每个数量档一行 + 「其他数量档」；下面三格
  H.push(`<h2>${esc(m.sections.quote)}</h2>`);
  H.push(`<table class="grid quote"><thead><tr>${QUOTE_HEAD.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>`);
  for (const t of [...m.tiers, OTHER_TIER_ZH]) H.push(`<tr><td>${esc(t)}</td><td></td><td></td><td>${esc(m.incoterm)}</td><td></td></tr>`);
  H.push("</tbody></table>");
  H.push(`<table class="grid boxes"><tr>${QUOTE_BOXES.map((b) => `<td><span class="k">${esc(b)}：</span></td>`).join("")}</tr></table>`);

  // 规格确认表：编号 / 要求 / 类型 / 是否满足 / 差异说明；按组，表头每页重复，行不跨页
  H.push(`<h2>${esc(m.sections.spec)}</h2>`);
  H.push(`<p class="note">${esc(RFQ_ATTACHMENT_SPEC_NOTE_ZH)}</p>`);
  const headClass = ["c", "s", "k", "y", "e"];
  H.push(`<table class="grid req"><thead><tr>${TABLE_HEAD.map((h, i) => `<th class="${headClass[i]}">${esc(h)}</th>`).join("")}</tr></thead><tbody>`);
  const checks = RFQ_ATTACHMENT_CHECKS_ZH.map((c) => esc(c)).join("<br>");
  for (const g of m.groups) {
    H.push(`<tr class="grp"><td colspan="5">${esc(g.title)}</td></tr>`);
    for (const r of g.rows) {
      const spec = `<div>${escLines(r.spec)}</div>${r.original ? `<div class="en">${escLines(r.original)}</div>` : ""}`;
      H.push(`<tr><td class="c">${esc(r.code)}</td><td class="s">${spec}</td><td class="k">${esc(r.kind)}</td><td class="y">${checks}</td><td class="e"></td></tr>`);
    }
  }
  H.push("</tbody></table>");

  if (m.sections.extra) H.push(`<h2>${esc(m.sections.extra)}</h2><ol>${m.extraQuestions.map((q) => `<li>${escLines(q)}</li>`).join("")}</ol>`);

  // 请随报价提供：勾选清单——按要求类别派生的项，然后固定的一组
  H.push(`<h2>${esc(m.sections.materials)}</h2>`);
  if (m.materials.derived.length) H.push(`<ul class="chk">${m.materials.derived.map((x) => `<li>□ ${escLines(x)}</li>`).join("")}</ul>`);
  H.push(`<p class="sub">${esc(m.materials.groupTitle)}：</p><ul class="chk">${m.materials.group.map((x) => `<li>□ ${esc(x)}</li>`).join("")}</ul>`);

  // 回复方式 + 签章栏：包在一个不拆页的块里，签章栏不会单独落到下一页
  H.push('<div class="tail">');
  H.push(`<p class="reply">${esc(m.footer)}</p>`);
  H.push(`<div class="signoff">${RFQ_ATTACHMENT_SIGNOFF_ZH.map((x) => `<span>${esc(x)}</span>`).join("")}</div>`);
  H.push("</div>");
  H.push("</body></html>");
  return H.join("\n");
}

/** 内容指纹：附件 HTML 的 SHA-256（十六进制 64 位） */
export function rfqAttachmentContentHash(html: string): string {
  return createHash("sha256").update(html, "utf8").digest("hex");
}

/**
 * 附件模板自带的固定文字（身份检查用）：把招标原文（规格、交付要求、从地点派生的目的地）留空后的整份文字，
 * 按「我方撰写」过禁出清单（项目名称类也查）——与 CHAIN-4b 对邮件模板句子的做法相同。
 * 调用方传入的 doc 应是已留空招标原文的那一份（service 里的 templateOnly）。
 */
export function rfqAttachmentTemplateSegments(templateOnlyDoc: RfqDocument, opts: { draftedOn: string }): IdentitySegment[] {
  return [{ where: RFQ_ATTACHMENT_SEGMENT_WHERE, text: rfqAttachmentTextBlocks(templateOnlyDoc, { ...opts, omitDraftedOn: true }).join("\n"), kind: "authored" }];
}

/* ---------------------------------- PDF ---------------------------------- */

/** PDF 页数：数 `/Type /Page` 对象（不含 /Pages）；数不到时取 /Count 的最大值；至少 1 */
export function countPdfPages(pdf: Buffer): number {
  const s = pdf.toString("latin1");
  const pages = (s.match(/\/Type\s*\/Page(?![A-Za-z])/g) ?? []).length;
  if (pages > 0) return pages;
  const counts = [...s.matchAll(/\/Count\s+(\d+)/g)].map((m) => Number(m[1])).filter((n) => Number.isFinite(n));
  return Math.max(1, ...counts);
}

/**
 * 生成出来的字节能不能发：是 PDF（魔数）、嵌入了中文字体、大小在上限内。
 * 中文字体：html-to-pdf 找不到 Noto Sans SC 时只记一条警告、照样产出 PDF（2026-08-26 生产上出过「全文中文空白」）；
 * 附件里一定有中文（标题就是），所以 PDF 里必须有 /BaseFont /XXXXXX+NotoSansSC…，没有就当生成失败，不把中文空白的 PDF 发给供应商。
 */
export function checkRfqAttachmentPdf(pdf: Buffer): { ok: true } | { ok: false; reason: "render_failed" | "too_large" } {
  if (!Buffer.isBuffer(pdf) || pdf.length < 5 || !pdf.subarray(0, 5).toString("latin1").startsWith("%PDF-")) return { ok: false, reason: "render_failed" };
  if (!/\/BaseFont\s*\/(?:[A-Z]{6}\+)?NotoSansSC/.test(pdf.toString("latin1"))) return { ok: false, reason: "render_failed" };
  if (pdf.length > RFQ_ATTACHMENT_MAX_BYTES) return { ok: false, reason: "too_large" };
  return { ok: true };
}

export function sha256Hex(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}
