/**
 * CHAIN-4a 询价 PDF 附件 — 起草时生成与检查、执行 / 预览前按载荷重排与核对（服务端）
 *
 * 起草：渲染 HTML → 模板文字过禁出清单 → 生成一次 PDF（确认生成得了、拿页数与大小）→ 字节丢弃，载荷只记元数据与内容指纹。
 * 执行 / 预览：用执行时的项目资料（截标日期、禁出清单、当前可用分析的要求与关键事实）+ 载荷里定格的起草参数与发件抬头
 *   重排 → 指纹一致才生成 PDF。两处用同一个函数，所以「预览看到的」=「批准后会发的」。
 *
 * PDF 生成函数可注入（测试用），缺省为服务端 Chromium（src/lib/pdf/html-to-pdf.ts）。
 */

import { db } from "@/lib/db";
import { describeIdentityHits, scanIdentity, type IdentityHit, type ProjectIdentityDenyList } from "@/lib/bid-workflow/project-identity-deny";
import { loadProjectIdentity } from "@/lib/bid-workflow/project-identity-sources";
import { buildRfqDocument, type RfqDocument } from "./build";
import {
  RFQ_ATTACHMENT_CHANGED_CARD_ZH,
  RFQ_ATTACHMENT_CHANGED_EXEC_ZH,
  RFQ_ATTACHMENT_MIME,
  RFQ_ATTACHMENT_TEMPLATE_CARD_ZH,
  RFQ_ATTACHMENT_TEMPLATE_EXEC_ZH,
  RFQ_ATTACHMENT_TEMPLATE_VERSION,
  checkRfqAttachmentPdf,
  countPdfPages,
  rfqAttachmentContentHash,
  rfqAttachmentFilename,
  rfqAttachmentTemplateSegments,
  renderRfqAttachmentHtml,
  type RfqAttachmentDraftParams,
  type RfqPayloadAttachment,
} from "./attachment";
import type { TenderSendRfqPayload } from "./types";

export type RfqAttachmentPdfRenderer = (html: string) => Promise<Buffer>;
let testRenderer: RfqAttachmentPdfRenderer | null = null;

/** 仅测试：注入 PDF 生成函数（null = 恢复缺省） */
export function __setRfqAttachmentPdfRendererForTest(renderer: RfqAttachmentPdfRenderer | null): void {
  testRenderer = renderer;
}

async function defaultRenderer(html: string): Promise<Buffer> {
  const { renderHtmlToPdf } = await import("@/lib/pdf/html-to-pdf");
  return renderHtmlToPdf(html);
}

export type RfqAttachmentFailReason = "render_failed" | "too_large";

/** 生成 PDF 并检查；任何异常都归为 render_failed（原文只进服务端日志） */
export async function renderRfqAttachmentPdf(html: string): Promise<{ ok: true; pdf: Buffer } | { ok: false; reason: RfqAttachmentFailReason }> {
  let pdf: Buffer;
  try {
    pdf = await (testRenderer ?? defaultRenderer)(html);
  } catch (err) {
    console.warn("[tender-rfq] attachment pdf render failed:", err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300));
    return { ok: false, reason: "render_failed" };
  }
  const checked = checkRfqAttachmentPdf(pdf);
  return checked.ok ? { ok: true, pdf } : checked;
}

/* ---------------------------------- 起草 ---------------------------------- */

export type DraftRfqAttachmentResult =
  | { ok: true; attachment: RfqPayloadAttachment }
  | { ok: false; reason: RfqAttachmentFailReason }
  | { ok: false; reason: "identity"; hits: IdentityHit[] };

export async function draftRfqAttachment(input: {
  doc: RfqDocument;
  /** 已把招标原文（规格、交付要求、从地点派生的目的地）留空的那一份，用来查模板文字 */
  templateOnlyDoc: RfqDocument;
  denyList: ProjectIdentityDenyList;
  draft: RfqAttachmentDraftParams;
}): Promise<DraftRfqAttachmentResult> {
  const opts = { draftedOn: input.draft.draftedOn };
  const hits = scanIdentity(input.denyList, rfqAttachmentTemplateSegments(input.templateOnlyDoc, opts));
  if (hits.length) return { ok: false, reason: "identity", hits };
  const html = renderRfqAttachmentHtml(input.doc, opts);
  const rendered = await renderRfqAttachmentPdf(html);
  if (!rendered.ok) return rendered;
  return {
    ok: true,
    attachment: {
      version: 1,
      filename: rfqAttachmentFilename(input.doc.reference),
      mimeType: RFQ_ATTACHMENT_MIME,
      pages: countPdfPages(rendered.pdf),
      sizeBytes: rendered.pdf.length,
      contentHash: rfqAttachmentContentHash(html),
      templateVersion: RFQ_ATTACHMENT_TEMPLATE_VERSION,
      draft: input.draft,
    },
  };
}

/* ---------------------------------- 执行 / 预览 / 读卡前重排 ---------------------------------- */

export type RebuildRfqAttachmentResult =
  | { ok: true; html: string }
  /** changed = 内容在起草后变了（或排不出来了）；template = 系统更新了附件版式 */
  | { ok: false; stale: "changed" | "template" }
  | { ok: false; stale: "identity"; hits: IdentityHit[] };

/**
 * 按「执行时的项目资料 + 载荷里定格的起草参数与发件抬头」重排附件内容，比对内容指纹（不生成 PDF）。
 * 与 prepareRfqRound 的 buildRfqDocument 入参一一对应（design D2）：项目资料现读（截标日期、禁出清单、当前可用分析的
 * 要求与关键事实），起草参数（询价编号、起草时刻与日期、回复截止提前量、发起人填写的栏目）与发件抬头、贸易条款取载荷。
 */
export async function rebuildRfqAttachment(
  payload: Pick<TenderSendRfqPayload, "projectId" | "fromName" | "incoterm">,
  attachment: RfqPayloadAttachment,
): Promise<RebuildRfqAttachmentResult> {
  if (attachment.templateVersion !== RFQ_ATTACHMENT_TEMPLATE_VERSION) return { ok: false, stale: "template" };
  const project = await db.project.findUnique({ where: { id: payload.projectId }, select: { closeDate: true } });
  const identity = await loadProjectIdentity(payload.projectId);
  if (!project || !identity) return { ok: false, stale: "changed" };
  // 动态导入：service.ts 起草时会调本模块，静态互相导入会成环
  const { loadRfqRequirementInputs } = await import("./service");
  const { requirements, facts } = await loadRfqRequirementInputs(payload.projectId);
  const d = attachment.draft;
  const built = buildRfqDocument({
    identity: { denyList: identity.denyList, reference: d.reference },
    buyerDisplayName: payload.fromName,
    closeDate: project.closeDate ? project.closeDate.toISOString() : null,
    now: new Date(d.draftedAt),
    requirements,
    facts,
    quantityTiers: d.quantityTiers.length ? d.quantityTiers : undefined,
    incoterm: payload.incoterm ?? null,
    destination: d.destination,
    replyLeadDays: d.replyLeadDays,
    extraQuestions: d.extraQuestions,
    scopeNote: d.scopeNote,
  });
  if (!built.ok) return built.errorCode === "IDENTITY_LEAK" ? { ok: false, stale: "identity", hits: built.hits } : { ok: false, stale: "changed" };
  const html = renderRfqAttachmentHtml(built.doc, { draftedOn: d.draftedOn });
  if (rfqAttachmentContentHash(html) !== attachment.contentHash) return { ok: false, stale: "changed" };
  return { ok: true, html };
}

/** 执行器用：重排结果 → 错误码与说明（卡已作废，说「重新发起」） */
export function rebuildFailureForExec(r: Exclude<RebuildRfqAttachmentResult, { ok: true }>): { errorCode: string; message: string } {
  if (r.stale === "template") return { errorCode: "RFQ_ATTACHMENT_TEMPLATE_CHANGED", message: RFQ_ATTACHMENT_TEMPLATE_EXEC_ZH };
  if (r.stale === "identity") return { errorCode: "RFQ_IDENTITY_LEAK", message: `询价附件含招标身份信息（命中：${describeIdentityHits(r.hits)}），这张卡一封都没有发，请改正后重新发起一轮询价` };
  return { errorCode: "RFQ_ATTACHMENT_CHANGED", message: RFQ_ATTACHMENT_CHANGED_EXEC_ZH };
}

/** 卡上 / 预览用：卡还在待批，说「驳回后重新发起」 */
export function rebuildFailureForCard(r: Exclude<RebuildRfqAttachmentResult, { ok: true }>): { stale: "changed" | "template"; message: string } {
  if (r.stale === "template") return { stale: "template", message: RFQ_ATTACHMENT_TEMPLATE_CARD_ZH };
  return { stale: "changed", message: RFQ_ATTACHMENT_CHANGED_CARD_ZH };
}
