/**
 * CHAIN-4a 询价 PDF 附件 — 内容排版与指纹（纯函数，零 DB / 零 LLM）
 *
 * 附件只来自询价单本身（build.ts 已筛好、已过敏感词表与招标身份防护的 RfqDocument），
 * 用固定模板重排：不读原标书、不读项目、不读收件人，所以同一轮各家同一份。
 * 内容指纹 = 渲染出的 HTML 的 SHA-256：Chromium 的 PDF 带生成时刻（字节不可复现，design D1），
 * 所以审批哈希覆盖的是内容；实际发出的 PDF 字节的 SHA-256 记进审计。
 */

import { createHash } from "node:crypto";
import { rfqCommercialTermsZh, type RfqDocument } from "./build";
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
export const RFQ_ATTACHMENT_TEMPLATE_VERSION = 1;
export const RFQ_ATTACHMENT_MIME = "application/pdf" as const;
export const RFQ_ATTACHMENT_TITLE_ZH = "询价单 / 符合性确认表";
export const RFQ_ATTACHMENT_FOOTER_ZH = "请直接回复发来本询价单的邮件：可以在邮件里按序号逐条写明，也可以打印本表填写后拍照或扫描作为附件发回。某项无法满足请直接说明。";
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

const DRAFTED_ON_LABEL = "起草日期";

type Row = { seq: string; code: string; kind: string; spec: string; original: string | null; page: string | null };

type Model = {
  title: string;
  meta: Array<{ label: string; value: string }>;
  scopeNote: string | null;
  rows: Row[];
  terms: Array<{ label: string; value: string }>;
  questions: string[];
  materials: string[];
  footer: string;
  signature: string;
};

function model(doc: RfqDocument, draftedOn: string): Model {
  return {
    title: RFQ_ATTACHMENT_TITLE_ZH,
    meta: [
      { label: "询价编号", value: doc.reference },
      { label: "询价方", value: doc.buyerDisplayName },
      { label: DRAFTED_ON_LABEL, value: draftedOn },
      { label: "回复截止", value: doc.replyBy ?? "请尽快" },
    ],
    scopeNote: doc.scopeNote,
    // 与 renderRfqEmail 同序同条数：行项、问题、需提供的材料
    rows: doc.lineItems.map((i) => ({
      seq: String(i.seq),
      code: i.requirementCode,
      kind: i.mandatory ? "强制" : "评分",
      spec: i.specZh,
      original: i.specOriginal && i.specOriginal !== i.specZh ? i.specOriginal : null,
      page: i.sourcePage ? `招标文件 p.${i.sourcePage}` : null,
    })),
    terms: rfqCommercialTermsZh(doc),
    questions: doc.questions.map((q) => `Q${q.seq}. ${q.text}`),
    materials: [...doc.attachmentsRequested],
    footer: RFQ_ATTACHMENT_FOOTER_ZH,
    signature: doc.buyerDisplayName,
  };
}

/**
 * 附件里供应商看得到的每一段文字（未转义），身份检查与测试用。
 * omitDraftedOn：起草日期是系统生成的日期，与 CHAIN-4b 供应商侧文件的生成日期一样不参与禁出清单比对。
 */
export function rfqAttachmentTextBlocks(doc: RfqDocument, opts: { draftedOn: string; omitDraftedOn?: boolean }): string[] {
  const m = model(doc, opts.draftedOn);
  return [
    m.title,
    ...m.meta.flatMap((x) => (opts.omitDraftedOn && x.label === DRAFTED_ON_LABEL ? [x.label] : [x.label, x.value])),
    ...(m.scopeNote ? [SCOPE_LABEL, m.scopeNote] : []),
    ...SECTION_TITLES.slice(0, 1),
    ...TABLE_HEAD,
    ...m.rows.flatMap((r) => [r.seq, r.code, r.kind, r.spec, ...(r.original ? [`原文：${r.original}`] : []), ...(r.page ? [r.page] : [])]),
    SECTION_TITLES[1],
    ...m.terms.map((t) => `${t.label}：${t.value}`),
    ...(m.questions.length ? [SECTION_TITLES[2], ...m.questions] : []),
    ...(m.materials.length ? [SECTION_TITLES[3], ...m.materials] : []),
    m.footer,
    ...RFQ_ATTACHMENT_SIGNOFF_ZH,
    m.signature,
    pageFooterText(m.meta[0].value),
  ];
}

/** 每页页脚（询价编号 + 页码；页码由打印时填） */
function pageFooterText(reference: string): string {
  return `${reference} · 第 N / M 页`;
}

const SCOPE_LABEL = "范围说明";

const SECTION_TITLES = ["一、规格要求（「是否满足」栏请填：满足 / 部分满足 / 不满足）", "二、商务条件", "三、请在回复中逐条回答", "四、请随报价提供"] as const;
const TABLE_HEAD = ["序号", "要求编号", "类型", "规格", "是否满足", "说明（差异 / 偏离）"] as const;

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

const CSS_BASE = [
  "body{font-family:'Noto Sans SC','PingFang SC','Microsoft YaHei',sans-serif;font-size:10.5pt;color:#1f2328;line-height:1.5;margin:0}",
  "h1{font-size:16pt;margin:0 0 8px}",
  "h2{font-size:12pt;margin:16px 0 6px}",
  "table{width:calc(100% - 1px);border-collapse:collapse}",
  "th,td{border:1px solid #9aa4ae;padding:4px 6px;vertical-align:top;text-align:left}",
  "th{background:#eef1f4;font-weight:700}",
  "table.meta td{border:none;padding:1px 8px 1px 0}",
  "table.meta td.k{color:#57606a;width:6em}",
  "tr{page-break-inside:avoid}",
  ".orig{color:#57606a;font-size:9pt;margin-top:2px}",
  ".page{color:#57606a;font-size:9pt}",
  "table.req{table-layout:fixed}",
  "th.n,td.n{width:2.6em;white-space:nowrap}",
  "th.c,td.c{width:4.6em;white-space:nowrap}",
  "th.k,td.k{width:2.8em;white-space:nowrap}",
  "th.y,td.y{width:12%}",
  "th.e,td.e{width:22%}",
  ".signoff{margin-top:14px;display:flex;flex-wrap:wrap;gap:6px 24px}",
  "ul,ol{margin:4px 0;padding-left:20px}",
  ".foot{margin-top:16px}",
].join("");

/** 每页底部居中：询价编号 + 第 N / M 页（Chromium 的 @page 边距盒） */
function pageCss(reference: string): string {
  return `@page{size:A4;@bottom-center{content:"${cssString(reference)} · 第 " counter(page) " / " counter(pages) " 页";font-family:'Noto Sans SC',sans-serif;font-size:8pt;color:#57606a}}`;
}

/**
 * 附件 HTML。对同样的输入输出完全相同（不含生成时刻、随机数、收件人）。
 * `<meta charset="utf-8">` 必须原样保留：html-to-pdf 在它之后注入中文字体。
 */
export function renderRfqAttachmentHtml(doc: RfqDocument, opts: { draftedOn: string }): string {
  const m = model(doc, opts.draftedOn);
  const H: string[] = [];
  // CSP：不执行任何脚本、不发任何网络请求（只允许内联样式与 data: 字体 / 图片）——招标原文是第三方文本，
  // 即使将来哪里漏了转义，也不会在服务器的 Chromium 里跑脚本或去访问外部地址
  H.push('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">');
  H.push(`<meta http-equiv="Content-Security-Policy" content="${RFQ_ATTACHMENT_CSP}">`);
  H.push(`<title>${esc(m.title)} ${esc(doc.reference)}</title><style>${pageCss(doc.reference)}${CSS_BASE}</style></head><body>`);
  H.push(`<h1>${esc(m.title)}</h1>`);
  H.push(`<table class="meta">${m.meta.map((x) => `<tr><td class="k">${esc(x.label)}</td><td>${esc(x.value)}</td></tr>`).join("")}</table>`);
  if (m.scopeNote) H.push(`<p><strong>${SCOPE_LABEL}</strong>：${escLines(m.scopeNote)}</p>`);
  H.push(`<h2>${esc(SECTION_TITLES[0])}</h2>`);
  const headClass = ["n", "c", "k", "", "y", "e"];
  H.push(`<table class="req"><thead><tr>${TABLE_HEAD.map((h, i) => `<th${headClass[i] ? ` class="${headClass[i]}"` : ""}>${esc(h)}</th>`).join("")}</tr></thead><tbody>`);
  for (const r of m.rows) {
    const spec = [
      `<div>${escLines(r.spec)}</div>`,
      r.original ? `<div class="orig">原文：${escLines(r.original)}</div>` : "",
      r.page ? `<div class="page">${esc(r.page)}</div>` : "",
    ].join("");
    H.push(`<tr><td class="n">${esc(r.seq)}</td><td class="c">${esc(r.code)}</td><td class="k">${esc(r.kind)}</td><td>${spec}</td><td class="y"></td><td class="e"></td></tr>`);
  }
  H.push("</tbody></table>");
  H.push(`<h2>${esc(SECTION_TITLES[1])}</h2><ul>${m.terms.map((t) => `<li>${esc(t.label)}：${escLines(t.value)}</li>`).join("")}</ul>`);
  if (m.questions.length) H.push(`<h2>${esc(SECTION_TITLES[2])}</h2><ul>${m.questions.map((q) => `<li>${escLines(q)}</li>`).join("")}</ul>`);
  if (m.materials.length) H.push(`<h2>${esc(SECTION_TITLES[3])}</h2><ul>${m.materials.map((x) => `<li>${escLines(x)}</li>`).join("")}</ul>`);
  H.push(`<p class="foot">${esc(m.footer)}</p>`);
  H.push(`<div class="signoff">${RFQ_ATTACHMENT_SIGNOFF_ZH.map((x) => `<span>${esc(x)}</span>`).join("")}</div>`);
  H.push(`<p>${esc(m.signature)}</p>`);
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
