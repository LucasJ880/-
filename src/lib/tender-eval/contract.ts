/**
 * Tender Real Evaluation Benchmark — Case Contract (tender-eval/v1)
 *
 * 评估专用契约：描述一个「真实/接近真实 Tender 考卷」的文档集与人工确认的黄金答案。
 *
 * 边界（重要）：
 * - 本目录不得被任何生产代码 import（评估基础设施，非业务行为）。
 * - Golden Answer 只能来自「人读源文件」得出的结论，逐条附 sourceQuote 以便人工复核；
 *   禁止把 AI/抽取器输出反向抄成 Golden Answer。
 * - goldenAnswerMethod 未达到 HUMAN_CONFIRMED 前，运行结果只能作为「临时基线」，
 *   Scorecard 会显式标注 golden 状态。
 */

import type { PageInput } from "@/lib/tender-auto-analysis/extract/types";

export const TENDER_EVAL_CONTRACT_VERSION = "tender-eval/v1" as const;

/* ---------------------------------- 归一化值 ---------------------------------- */

/**
 * 关键事实不做文本相似度比较，用归一化值判等：
 * date: "2026-08-13" == "Aug 13 2026"；money/quantity/duration 同理带单位归一。
 */
export type NormalizedValue =
  | { kind: "date"; /** YYYY-MM-DD */ value: string }
  | { kind: "datetime"; /** YYYY-MM-DD */ date: string; /** HH:MM 24h */ time: string; tz: string | null }
  | { kind: "money"; amount: number; currency: string | null }
  | { kind: "quantity"; value: number; unit: string | null }
  | { kind: "duration"; days: number }
  | { kind: "boolean"; value: boolean }
  | {
      kind: "text";
      /** 归一化后的主值（小写、去多余空白） */
      value: string;
      /** 判等别名（任一命中即视为相等），同样做归一化比较 */
      aliases?: string[];
    };

/* ---------------------------------- 证据引用 ---------------------------------- */

export type GoldenEvidenceRef = {
  documentId: string;
  /** 允许多页时列出全部可接受页码；空数组 = 该条目无页级证据要求 */
  pageNumbers: number[];
  /** 源文件原文引文（人工从文件抄录，供复核与 evidence 校验） */
  sourceQuote: string;
};

/* ---------------------------------- 黄金事实 ---------------------------------- */

export type GoldenFactField =
  | "buyer"
  | "tender_number"
  | "tender_title"
  | "solicitation_type"
  | "issue_date"
  | "closing_datetime"
  | "enquiry_deadline"
  | "site_visit"
  | "location"
  | "scope"
  | "quantity"
  | "product_type"
  | "motorized_or_manual"
  | "motor_requirements"
  | "fabric_requirements"
  | "warranty"
  | "bond"
  | "insurance"
  | "delivery"
  | "installation"
  | "training"
  | "submittal_requirements"
  | "samples"
  | "shop_drawing"
  | "mandatory_forms"
  | "pricing_instructions"
  | "offer_validity"
  | "evaluation_method"
  | "contract_period"
  | "eligibility"
  | "addenda_count"
  | (string & {});

export type GoldenFact = {
  factId: string;
  field: GoldenFactField;
  /** 人读原文的中文描述（报告展示用） */
  description: string;
  expected: NormalizedValue;
  /** 关键事实（计入 Critical Fact Accuracy） */
  critical: boolean;
  evidence: GoldenEvidenceRef[];
  /**
   * 抽取输出定位锚词组：组内 AND、组间 OR（全部小写）。
   * 命中即为候选条目（含 factKey 名、内容关键词）；不参与值判等。
   */
  matchAnchors: string[][];
  notes?: string;
};

/* ---------------------------------- 黄金要求 ---------------------------------- */

export type GoldenRequirementImportance = "CRITICAL" | "HIGH" | "NORMAL";

export type GoldenRequirement = {
  goldenId: string;
  /** 源文件要求原文（或紧凑转写，须与 sourceQuote 一致可核） */
  text: string;
  category:
    | "mandatory_technical"
    | "technical"
    | "commercial"
    | "submission"
    | "eligibility"
    | "compliance"
    | "delivery"
    | "warranty"
    | (string & {});
  mandatory: boolean;
  evidence: GoldenEvidenceRef[];
  importance: GoldenRequirementImportance;
  /**
   * 判 MATCHED 的锚词组（全部小写）。任一 anchor 组命中即候选；
   * anchor 组内为 AND（都出现），组间为 OR。
   */
  matchAnchors: string[][];
  notes?: string;
};

/* ---------------------------------- 歧义 / 风险 / 澄清 ---------------------------------- */

export type GoldenAmbiguity = {
  ambiguityId: string;
  description: string;
  /** 期望系统行为：至少标记歧义 / 必须产生澄清问题 */
  expected: "FLAGGED" | "CLARIFICATION_REQUIRED";
  evidence: GoldenEvidenceRef[];
  matchAnchors: string[][];
};

export type GoldenRiskSeverity = "CRITICAL" | "IMPORTANT";

export type GoldenRisk = {
  riskId: string;
  severity: GoldenRiskSeverity;
  description: string;
  evidence: GoldenEvidenceRef[];
  matchAnchors: string[][];
  notes?: string;
};

export type GoldenClarificationNecessity = "NECESSARY" | "USEFUL";

export type GoldenClarification = {
  clarId: string;
  /** 值得真实发给 Owner/Consultant 的问题主题 */
  topic: string;
  necessity: GoldenClarificationNecessity;
  /** 文件里其实已有答案 = 系统若再问应判 ALREADY_ANSWERED */
  answeredInDocument: boolean;
  evidence: GoldenEvidenceRef[];
  matchAnchors: string[][];
  notes?: string;
};

/* ---------------------------------- 文档集 ---------------------------------- */

export type CaseDocumentRole = "MAIN" | "ADDENDUM" | "ANNEX" | "QA_RESPONSE";

export type CaseDocument = {
  documentId: string;
  role: CaseDocumentRole;
  title: string;
  /** 页文本（与生产 PageInput 完全同构；评估直接喂真实管线） */
  pages: PageInput[];
};

/* ---------------------------------- Case 本体 ---------------------------------- */

export type CaseProvenanceKind =
  /** 完整真实招标文件文本 */
  | "REAL"
  /** 基于真实招标（可核实的编号/内容）的人工转写节选，非完整原件 */
  | "NEAR_REAL_RECONSTRUCTED"
  /** 人造文本（不得计入 REAL_TENDER_CASES） */
  | "SYNTHETIC";

export type GoldenAnswerMethod =
  /** 人（业务负责人）已逐条确认 */
  | "HUMAN_CONFIRMED"
  /** 由人读源文件逐条整理、每条带引文，等待业务负责人最终确认 */
  | "PENDING_HUMAN_CONFIRMATION";

export type TenderEvalCase = {
  contractVersion: typeof TENDER_EVAL_CONTRACT_VERSION;
  caseId: string;
  title: string;
  /** 业务项目类型，如 roller-shades-supply-install / goods-standing-offer */
  projectType: string;
  provenance: {
    kind: CaseProvenanceKind;
    /** 文本来源说明（fixture 路径 / 原始招标编号等） */
    source: string;
    redaction: "NONE" | "REDACTED" | "EXCERPTED";
    goldenAnswerMethod: GoldenAnswerMethod;
    confirmedBy: string | null;
    confirmedAt: string | null;
  };
  documentSet: CaseDocument[];
  goldenFacts: GoldenFact[];
  goldenRequirements: GoldenRequirement[];
  knownAmbiguities: GoldenAmbiguity[];
  goldenRisks: GoldenRisk[];
  goldenClarifications: GoldenClarification[];
  /**
   * 文件确实没有回答的字段：系统不得声称有值。
   * 声称即计 unsupported claim。
   */
  expectedUnknowns: {
    field: string;
    description: string;
    /** 系统输出若命中这些锚词且以确定口吻给值 → violation */
    forbiddenClaimAnchors: string[][];
  }[];
  /**
   * 幻觉探针：与本 case 文档完全无关的主题锚词组。
   * 系统澄清问题 / 风险 / 事实命中探针 → HALLUCINATED。
   */
  hallucinationProbes: string[][];
  notes: string;
};

/* ---------------------------------- Case 加载 ---------------------------------- */

export type CaseSkip = {
  caseId: string;
  skipped: true;
  reason: string;
};

export type CaseModule = {
  caseId: string;
  /** 组装文档集（真实 PDF 缺失时返回 CaseSkip，绝不合成顶替） */
  load: () => Promise<TenderEvalCase | CaseSkip>;
};

export function isCaseSkip(x: TenderEvalCase | CaseSkip): x is CaseSkip {
  return (x as CaseSkip).skipped === true;
}

/* ---------------------------------- 判定结果 ---------------------------------- */

export type RequirementVerdict =
  | "MATCHED"
  | "PARTIAL"
  | "MISSED"
  | "FALSE_POSITIVE"
  | "DUPLICATE";

export type FactVerdict =
  /** 值正确 + 证据正确 */
  | "CORRECT"
  /** 值正确但证据缺失/错误（仍算失败：正确答案 + 错误 Evidence = FAIL） */
  | "CORRECT_VALUE_BAD_EVIDENCE"
  | "WRONG_VALUE"
  | "NOT_EXTRACTED";

export type RiskVerdict = "DETECTED" | "MISSED";

export type ClarificationVerdict =
  | "NECESSARY"
  | "USEFUL"
  | "LOW_VALUE"
  | "ALREADY_ANSWERED"
  | "HALLUCINATED";
