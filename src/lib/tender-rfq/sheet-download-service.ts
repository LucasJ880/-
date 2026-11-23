/**
 * RFQ-PDF-1 「一键生成文档」里的供应商询价单 — 读项目资料、排版、生成并检查 PDF（服务端）
 *
 * 只产出内容与字节，不落库（落库在 projects/generate/generate-docs.ts）、不建询价轮次、不建审批卡、不发信，
 * 也不读询价附件开关：这是内部成员下载的文件，不是出站。
 * 失败一律在写任何东西之前抛出：招标身份命中抛 SupplierIdentityLeakError，其余抛 SupplierRfqSheetError。
 */

import { db } from "@/lib/db";
import { SupplierIdentityLeakError } from "@/lib/bid-workflow/project-identity-deny";
import { loadProjectIdentity } from "@/lib/bid-workflow/project-identity-sources";
import { RFQ_ATTACHMENT_TEMPLATE_VERSION, countPdfPages, rfqAttachmentContentHash } from "./attachment";
import { renderCheckedRfqSheet } from "./attachment-service";
import { loadRfqRequirementInputs } from "./service";
import { SupplierRfqSheetError, composeRfqSheet, rfqSheetRenderFailureCode } from "./sheet-download";

export type ProjectRfqSheet = {
  /** 对供应商的中性询价编号 */
  reference: string;
  /** 询价单的渲染内容（与询价附件同一个模板） */
  html: string;
  /** 已过检查的 PDF 字节（是 PDF、内嵌中文字体、不超过 5 MB） */
  pdf: Buffer;
  pages: number;
  /** 渲染内容的 SHA-256；同一项目、同一时刻、发起人什么都没填时等于询价附件的内容指纹 */
  contentHash: string;
  templateVersion: number;
  draftedAt: string;
  draftedOn: string;
  replyLeadDays: number;
  /** 没有中文译文的要求条数（生成结果里据此带一句提醒） */
  missingTranslationCount: number;
};

export async function buildProjectRfqSheet(input: { projectId: string; now?: Date }): Promise<ProjectRfqSheet> {
  const now = input.now ?? new Date();
  const project = await db.project.findUnique({
    where: { id: input.projectId },
    select: { id: true, closeDate: true, org: { select: { settingsJson: true } } },
  });
  const identity = project ? await loadProjectIdentity(project.id) : null;
  if (!project || !identity) throw new Error("项目不存在");

  const { requirements, facts } = await loadRfqRequirementInputs(project.id);
  const composed = composeRfqSheet({
    identity: { denyList: identity.denyList, reference: identity.reference },
    orgSettingsJson: project.org?.settingsJson ?? null,
    closeDate: project.closeDate,
    now,
    requirements,
    facts,
  });
  if (!composed.ok) {
    if (composed.errorCode === "IDENTITY_LEAK") throw new SupplierIdentityLeakError(composed.hits);
    throw new SupplierRfqSheetError(composed.errorCode);
  }

  const rendered = await renderCheckedRfqSheet({
    doc: composed.doc,
    templateOnlyDoc: composed.templateOnlyDoc,
    denyList: identity.denyList,
    draftedOn: composed.draftedOn,
  });
  if (!rendered.ok) {
    if (rendered.reason === "identity") throw new SupplierIdentityLeakError(rendered.hits);
    throw new SupplierRfqSheetError(rfqSheetRenderFailureCode(rendered.reason));
  }

  return {
    reference: composed.doc.reference,
    html: rendered.html,
    pdf: rendered.pdf,
    pages: countPdfPages(rendered.pdf),
    contentHash: rfqAttachmentContentHash(rendered.html),
    templateVersion: RFQ_ATTACHMENT_TEMPLATE_VERSION,
    draftedAt: composed.draftedAt,
    draftedOn: composed.draftedOn,
    replyLeadDays: composed.replyLeadDays,
    missingTranslationCount: composed.doc.missingTranslationCount,
  };
}
