/**
 * RFQ-PDF-1 「一键生成文档」里的供应商询价单 — 内容排法与不生成时的说明（纯函数，零 DB / 零 LLM）
 *
 * 菜单生成的询价单与发询价时的询价单是同一个生成器（build.ts）、同一个模板（attachment.ts）、同一套检查
 * （attachment-service.ts）。区别只有一处：菜单生成没有发起人，所以发起人填写项（数量阶梯、目的地、范围说明、
 * 附加问题）与贸易条款一律为空。不读 AI 分析综合、项目名称、项目描述与项目 AI 上下文。
 */

import { resolveOrgTimezone } from "@/lib/automation/registry";
import type { IdentityHit, ProjectIdentityDenyList } from "@/lib/bid-workflow/project-identity-deny";
import { buildRfqDocument, rfqTemplateOnlyDocument, type RfqDocument, type RfqFactInput, type RfqRequirementInput } from "./build";
import { rfqAttachmentDraftedOn } from "./attachment";
import { readTenderRfqSettings } from "./round-pure";

/** 不生成的情形（招标身份命中另由 SupplierIdentityLeakError 表达，接口同样回 422） */
export type RfqSheetFailureCode = "NO_CONFIRMED_REQUIREMENTS" | "SENSITIVE_LEAK" | "RFQ_SHEET_RENDER_FAILED" | "RFQ_SHEET_TOO_LARGE";

/**
 * 每种情形接口回什么。说明不写错误码与命中的原文；提到的地方用界面上的叫法（页签叫「招标要求」）。
 * 已确认的要求在页面上改不了（只有未确认的能确认 / 驳回），所以不让人去「减少」或「修改」，改不了的找管理员。
 * - 内容问题（没有要求 / 内部财务信息 / 太大）是 422：重试没用，要去「需求」改；
 * - PDF 没生成出来是 503：不是内容问题，稍后重试可能成功（与询价附件预览接口同一口径）。
 */
export const RFQ_SHEET_FAILURES: Readonly<Record<RfqSheetFailureCode, { status: 422 | 503; message: string }>> = {
  NO_CONFIRMED_REQUIREMENTS: { status: 422, message: "没有已确认且属于供应商侧的要求，先在青砚「招标要求」里逐条确认后再生成询价。" },
  SENSITIVE_LEAK: { status: 422, message: "询价单没有生成，也没有保存文件：内容里有不能发给供应商的字样（如毛利、利润率、底价、我方预算）。请到「招标要求」在已确认的要求里找这些字样；组织管理员另请检查「询价与落地价设置」里的「发件显示名」。改不了的请联系管理员。" },
  RFQ_SHEET_RENDER_FAILED: { status: 503, message: "询价单 PDF 没能生成，没有保存任何文件。请稍后再试；一直不行请联系管理员。" },
  RFQ_SHEET_TOO_LARGE: { status: 422, message: "询价单 PDF 超过 5 MB，没有保存。通常是要问供应商的已确认要求太多，请联系管理员处理。" },
};

/** 供应商询价单没有生成；生成接口据此回对应的状态码、错误码与说明 */
export class SupplierRfqSheetError extends Error {
  readonly status: 422 | 503;
  constructor(readonly errorCode: RfqSheetFailureCode) {
    super(RFQ_SHEET_FAILURES[errorCode].message);
    this.name = "SupplierRfqSheetError";
    this.status = RFQ_SHEET_FAILURES[errorCode].status;
  }
}

/** PDF 检查的结果 → 不生成的情形 */
export function rfqSheetRenderFailureCode(reason: "render_failed" | "too_large"): RfqSheetFailureCode {
  return reason === "too_large" ? "RFQ_SHEET_TOO_LARGE" : "RFQ_SHEET_RENDER_FAILED";
}

/** 生成记录的标题（菜单用它拼下载文件名，所以文件名里有询价编号） */
export function rfqSheetRecordTitle(reference: string, version: number): string {
  return `询价单-${reference} v${version}`;
}

export type ComposeRfqSheetInput = {
  identity: { denyList: ProjectIdentityDenyList; reference: string };
  /** 项目所属组织的设置（发件抬头、回复截止提前量、时区）；项目没有组织时为 null，按询价设置的默认值 */
  orgSettingsJson: unknown;
  closeDate: Date | null;
  /** 起草时刻（接口被调用的时刻） */
  now: Date;
  requirements: RfqRequirementInput[];
  facts: RfqFactInput[];
  env?: NodeJS.ProcessEnv;
};

export type ComposeRfqSheetResult =
  | {
      ok: true;
      doc: RfqDocument;
      /** 把招标原文留空的那一份，用来查模板文字 */
      templateOnlyDoc: RfqDocument;
      draftedAt: string;
      /** 起草日期：组织时区的 YYYY-MM-DD（与询价附件同一口径） */
      draftedOn: string;
      replyLeadDays: number;
    }
  | { ok: false; errorCode: "NO_CONFIRMED_REQUIREMENTS" | "SENSITIVE_LEAK" }
  | { ok: false; errorCode: "IDENTITY_LEAK"; hits: IdentityHit[] };

/**
 * 排出菜单询价单的内容。入参与起草询价（service.ts prepareRfqRound）调用 buildRfqDocument 时一一对应，
 * 只是发起人填写项与贸易条款固定为空——同一项目、同一时刻、发起人什么都没填时，两边排出的内容逐字节相同。
 */
export function composeRfqSheet(input: ComposeRfqSheetInput): ComposeRfqSheetResult {
  const settings = readTenderRfqSettings(input.orgSettingsJson, input.env);
  const built = buildRfqDocument({
    identity: input.identity,
    buyerDisplayName: settings.fromName,
    closeDate: input.closeDate ? input.closeDate.toISOString() : null,
    now: input.now,
    requirements: input.requirements,
    facts: input.facts,
    incoterm: null,
    destination: null,
    replyLeadDays: settings.replyLeadDays,
    extraQuestions: [],
    scopeNote: null,
  });
  if (!built.ok) {
    return built.errorCode === "IDENTITY_LEAK" ? { ok: false, errorCode: "IDENTITY_LEAK", hits: built.hits } : { ok: false, errorCode: built.errorCode };
  }
  return {
    ok: true,
    doc: built.doc,
    templateOnlyDoc: rfqTemplateOnlyDocument(built.doc, null),
    draftedAt: input.now.toISOString(),
    draftedOn: rfqAttachmentDraftedOn(input.now, resolveOrgTimezone(input.orgSettingsJson)),
    replyLeadDays: settings.replyLeadDays,
  };
}
