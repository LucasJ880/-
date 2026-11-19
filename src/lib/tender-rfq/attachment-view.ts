/**
 * CHAIN-4a 询价 PDF 附件 — 卡上显示用的读取与文案（纯函数，不依赖 Node，可被客户端组件引用）
 */

/** 发询价卡载荷里的附件（PendingAction.payload.attachment）。不存 PDF 字节。 */
export type RfqPayloadAttachment = {
  version: 1;
  filename: string;
  mimeType: "application/pdf";
  /** 起草时生成的那份 PDF 的页数与字节数（卡上显示用；执行时重新生成，内容相同） */
  pages: number;
  sizeBytes: number;
  /** 附件渲染内容（HTML）的 SHA-256 十六进制；进载荷哈希，执行前重排比对 */
  contentHash: string;
  /** 起草时的附件版式版本（与当前版本不同 → 执行时按「系统更新了版式」拒发） */
  templateVersion: number;
  /** 重新排出同一份内容所需的起草参数（项目资料在执行时现读） */
  draft: RfqAttachmentDraftParams;
};

export type RfqAttachmentDraftParams = {
  /** 起草时的询价编号（邮件标题里的那个；组织代码或时区之后改了也不影响这张卡） */
  reference: string;
  /** 起草时刻（ISO），决定回复截止 */
  draftedAt: string;
  /** 起草日期（组织时区 YYYY-MM-DD），印在附件上 */
  draftedOn: string;
  replyLeadDays: number;
  scopeNote: string | null;
  extraQuestions: string[];
  destination: string | null;
  quantityTiers: number[];
};

/**
 * 卡上一封邮件预览带的附件信息。
 * stale：读卡时按执行器同样的方式重排比对（不生成 PDF）的结果——changed = 内容在起草后变了，template = 系统更新了版式；
 * 两种情况批准后都会被拒发，面板提前说并不给批准。null = 一致（或没核对）。
 */
export type RfqAttachmentPreview = { filename: string; pages: number; sizeBytes: number; previewHref: string | null; stale?: "changed" | "template" | null };

/** 从载荷里读附件；形状不对一律当作没有（卡上不显示，执行器另有严格校验） */
export function readPayloadAttachment(payload: unknown): RfqPayloadAttachment | null {
  if (!payload || typeof payload !== "object") return null;
  const a = (payload as { attachment?: unknown }).attachment;
  if (!a || typeof a !== "object") return null;
  const x = a as Partial<RfqPayloadAttachment>;
  if (x.version !== 1 || typeof x.filename !== "string" || !x.filename || typeof x.contentHash !== "string" || !/^[0-9a-f]{64}$/.test(x.contentHash)) return null;
  if (typeof x.pages !== "number" || typeof x.sizeBytes !== "number" || typeof x.templateVersion !== "number" || !x.draft || typeof x.draft !== "object") return null;
  const d = x.draft as Partial<RfqAttachmentDraftParams>;
  if (typeof d.reference !== "string" || !d.reference || typeof d.draftedAt !== "string" || typeof d.draftedOn !== "string" || typeof d.replyLeadDays !== "number") return null;
  return {
    version: 1,
    filename: x.filename,
    mimeType: "application/pdf",
    pages: x.pages,
    sizeBytes: x.sizeBytes,
    contentHash: x.contentHash,
    templateVersion: x.templateVersion,
    draft: {
      reference: d.reference,
      draftedAt: d.draftedAt,
      draftedOn: d.draftedOn,
      replyLeadDays: d.replyLeadDays,
      scopeNote: typeof d.scopeNote === "string" ? d.scopeNote : null,
      extraQuestions: Array.isArray(d.extraQuestions) ? d.extraQuestions.filter((q): q is string => typeof q === "string") : [],
      destination: typeof d.destination === "string" ? d.destination : null,
      quantityTiers: Array.isArray(d.quantityTiers) ? d.quantityTiers.filter((n): n is number => typeof n === "number" && Number.isFinite(n)) : [],
    },
  };
}

/** 大小：不足 1 MB 按 KB 取整（至少 1 KB），否则 MB 保留一位小数 */
export function attachmentSizeLabelZh(bytes: number): string {
  const MB = 1024 * 1024;
  if (bytes < MB) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / MB).toFixed(1)} MB`;
}

/** 「{文件名}（{页数} 页，{大小}）」 */
export function attachmentSummaryZh(a: { filename: string; pages: number; sizeBytes: number }): string {
  return `${a.filename}（${a.pages} 页，${attachmentSizeLabelZh(a.sizeBytes)}）`;
}

/** 预览接口地址 */
export function rfqAttachmentPreviewHref(projectId: string, actionId: string): string {
  return `/api/projects/${encodeURIComponent(projectId)}/tender-rfq/attachment?actionId=${encodeURIComponent(actionId)}`;
}

/** 起草时附件失败（网页送审、Muse 共用）；不含错误码与异常原文 */
export function rfqAttachmentFailedMessageZh(reason: "render_failed" | "too_large"): string {
  return reason === "too_large"
    ? "询价附件（PDF）超过 5 MB，这一轮没有建。要求条数太多时请分几轮询价。"
    : "询价附件（PDF）没能生成（生成出错），这一轮没有建。稍后重试；一直不行请联系管理员。";
}

/** 执行时：内容在起草后变了（卡已作废，不能再驳回，所以说「重新发起」） */
export const RFQ_ATTACHMENT_CHANGED_EXEC_ZH = "询价附件的内容在起草后变了（要求、关键事实或截标日期有改动），这张卡一封都没有发，请重新发起一轮询价";
/** 执行时：系统更新了附件版式 */
export const RFQ_ATTACHMENT_TEMPLATE_EXEC_ZH = "系统更新了询价附件的版式，这张卡一封都没有发，请重新发起一轮询价";
/** 卡上 / 预览：内容在起草后变了（卡还在待批，可以驳回） */
export const RFQ_ATTACHMENT_CHANGED_CARD_ZH = "询价附件的内容在起草后变了（要求、关键事实或截标日期有改动），批准后会被拒发。请驳回这张卡，再重新发起一轮询价。";
/** 卡上 / 预览：系统更新了附件版式 */
export const RFQ_ATTACHMENT_TEMPLATE_CARD_ZH = "系统更新了询价附件的版式，这张卡批准后会被拒发。请驳回这张卡，再重新发起一轮询价。";

/** 自动起草时附件失败 */
export const RFQ_ATTACHMENT_AUTO_DRAFT_FAILED_ZH = "询价附件（PDF）没能生成，没有自动起草。可以在询价入口手动发起。";

/** 执行时附件 PDF 生成失败 */
export const RFQ_ATTACHMENT_EXEC_FAILED_ZH = "询价附件（PDF）没能生成，这张卡一封都没有发，请稍后重新发起一轮询价";
