/**
 * 投标文件起草（tender-bid-draft/v1）契约。
 *
 * 产物 = 英文提交稿（可直接改后提交）+ 中文审阅注。硬纪律：
 *  - 能力/资质/业绩只能来自 品牌档案 / 企业记忆已验证事实 / 我方中标记录 / 合规矩阵人工标注；
 *    没有依据 → 写成 [TO CONFIRM: …] 占位，绝不编造；
 *  - 价格绝不编造（只引用人工输入的报价或留占位）；
 *  - 提交面文字绝不出现竞争对手/现任供应商名称；
 *  - 每段都是 AI_DRAFT，人工审阅后才能提交；不含 GO/NO-GO。
 */

import { z } from "zod";

export const BID_DRAFT_VERSION = "tender-bid-draft/v1" as const;
export const BID_DRAFT_PROMPT = { name: "tender-bid-draft", version: "1" } as const;

export type ComplianceStatus =
  | "COMPLIANT"
  | "COMPLIANT_ON_AWARD"
  | "COMPLIANT_VIA_PARTNER"
  | "CLARIFICATION_REQUESTED"
  | "TO_CONFIRM"
  | "INTERNAL_NO_GO";

/** 合规矩阵人工五态 → 提交稿合规状态（未标 → TO_CONFIRM） */
export function complianceStatusFromFit(fit: string | null | undefined): ComplianceStatus {
  switch ((fit ?? "").toUpperCase()) {
    case "HAVE":
      return "COMPLIANT";
    case "BUILD":
      return "COMPLIANT_ON_AWARD";
    case "PARTNER":
      return "COMPLIANT_VIA_PARTNER";
    case "RFI":
      return "CLARIFICATION_REQUESTED";
    case "NO_GO":
      return "INTERNAL_NO_GO";
    default:
      return "TO_CONFIRM";
  }
}

export const COMPLIANCE_LABEL_EN: Record<ComplianceStatus, string> = {
  COMPLIANT: "Compliant",
  COMPLIANT_ON_AWARD: "Compliant upon award",
  COMPLIANT_VIA_PARTNER: "Compliant (via partner)",
  CLARIFICATION_REQUESTED: "Clarification requested",
  TO_CONFIRM: "[TO CONFIRM]",
  INTERNAL_NO_GO: "[INTERNAL: not met]",
};

export const PLACEHOLDER_RE = /\[TO CONFIRM[^\]]*\]/g;

const str = (max: number) =>
  z.preprocess((v) => (typeof v === "string" ? v.slice(0, max) : ""), z.string());

const complianceItem = z.preprocess(
  (v) => (v && typeof v === "object" ? v : null),
  z
    .object({
      requirementCode: str(40),
      responseEn: str(900),
    })
    .nullable(),
);

export const bidDraftLlmSchema = z.object({
  coverLetterEn: str(3000),
  executiveSummaryEn: str(4000),
  complianceResponses: z.preprocess(
    (v) => (Array.isArray(v) ? v : []),
    z.array(complianceItem),
  ),
  technicalApproachEn: str(5000),
  companyProfileEn: str(3500),
  socialValueGuidanceEn: str(2500),
  pricingSummaryEn: str(1500),
  internalNotesZh: z.preprocess(
    (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : []),
    z.array(z.string().max(400)),
  ),
});
export type BidDraftLlmOutput = z.infer<typeof bidDraftLlmSchema>;

export type BidDraftRequirement = {
  id: string;
  code: string;
  category: string;
  textZh: string;
  textOriginal: string;
  mandatory: boolean;
  evidenceRequired: boolean;
  fit: string | null;
  noteZh: string | null;
  status: ComplianceStatus;
};

export type BidDraftInputs = {
  project: {
    id: string;
    nameZh: string;
    buyer: string | null;
    tenderNumber: string | null;
    tenderTitle: string | null;
    closing: string | null;
    submissionMethod: string | null;
  };
  requirements: BidDraftRequirement[];
  facts: Array<{ zh: string; original: string }>;
  criticalFacts: Record<string, string>;
  analystBrief: unknown;
  submissionChecklist: unknown;
  memo: {
    summaryZh: string | null;
    riskGates: Array<{ gateZh: string; statusZh: string; basisZh: string }>;
    teamingAdviceZh: string | null;
  } | null;
  rfiCount: number;
  pricing: { ourPriceCad: number | null; competitorPriceCad: number | null; note: string | null };
  org: {
    brandContext: string | null;
    forbiddenClaims: string | null;
    memoryClaims: Array<{ statement: string; claimType: string; verificationStatus: string }>;
    ownWins: Array<{ buyer: string | null; title: string | null; awardDate: string | null; amount: number | null }>;
  };
  /** 提交面必须剔除的名称（竞争对手/现任） */
  excludeNames: string[];
};

export type BidDraftResult = {
  version: typeof BID_DRAFT_VERSION;
  generatedAt: string;
  sections: BidDraftLlmOutput;
  compliance: Array<BidDraftRequirement & { responseEn: string }>;
  placeholders: number;
  excludedNameHits: number;
  forbiddenHits: number;
  llmCalls: number;
};
