/**
 * Tender Analyst Synthesis — SEM-01..10 语义矩阵（纯测，合成 fixture，不含真实客户文本）
 * 运行：npx tsx src/lib/tender-analyst/__tests__/analyst-synthesis.test.ts
 */

import type {
  AnalysisResultV2,
  TenderRequirementV2,
} from "@/lib/tender-understanding/contract";
import { buildTenderAnalystContext } from "../context";
import { validateTenderAnalystSynthesis } from "../validate";
import { hydrateEvidenceIndex } from "../hydrate";
import { runAnalystSynthesis } from "../synthesize";
import {
  ANALYST_SYSTEM_PROMPT,
} from "../prompts";
import {
  analystLlmOutputSchema,
  type AnalystLlmOutput,
} from "../contract";
import type { LlmInvoker } from "@/lib/tender-understanding/llm";
import { EXTRACT_SYSTEM_PROMPT } from "@/lib/tender-understanding/prompts";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`);
  }
}

/* ------------------------------ 合成 fixture ------------------------------ */

const ev = (documentId: string, pageNumber: number, snippet: string) => ({
  documentId,
  pageNumber,
  snippet,
});

const req = (
  id: string,
  category: TenderRequirementV2["category"],
  statement: string,
  extra: Partial<TenderRequirementV2> = {},
): TenderRequirementV2 => ({
  id,
  category,
  statement,
  actor: "Vendor",
  action: null,
  object: null,
  mandatory: true,
  mandatorySignal: "must",
  deadline: null,
  quantity: null,
  unit: null,
  submissionStage: null,
  technicalArea: null,
  status: "ACTIVE",
  supersededById: null,
  evidence: [ev("doc-main", 3, "synthetic snippet")],
  confidence: "HIGH",
  ...extra,
});

const RESULT: AnalysisResultV2 = {
  contractVersion: "tender-analysis-result/v2" as AnalysisResultV2["contractVersion"],
  manifest: {
    documents: [
      { documentId: "doc-main", name: "Main RFB.pdf", sourceRole: "BASE_TENDER", pageCount: 40 },
      { documentId: "doc-add", name: "Addendum 1.pdf", sourceRole: "ADDENDUM", pageCount: 2 },
    ],
  } as AnalysisResultV2["manifest"],
  projectSummary: "Synthetic procurement of widgets for a public buyer.",
  criticalFacts: {} as AnalysisResultV2["criticalFacts"],
  facts: [
    {
      id: "fact-close",
      factType: "closing_datetime",
      claim: "Bids close on 2099-01-01 at 14:00 local time.",
      rawValue: "2099-01-01 14:00",
      normalizedValue: null,
      confidence: "HIGH",
      evidence: [ev("doc-add", 1, "closing date is changed to 2099-01-01")],
      sourceRole: "ADDENDUM",
      status: "ACTIVE",
    },
  ],
  requirements: [
    // SEM-01：发票邮寄 → COMMERCIAL / post-award（绝不 TECHNICAL / BID_FATAL）
    req("req-invoice", "COMMERCIAL", "Vendor must email invoices to the buyer accounts mailbox.", {
      submissionStage: "post-award",
    }),
    // SEM-02：Form A 未随标提交 → 拒标（BID_FATAL 合法依据）
    req("req-forma", "SUBMISSION", "Failure to submit Form A with the bid will result in the bid being rejected.", {
      mandatorySignal: "will result in the bid being rejected",
      submissionStage: "with bid",
    }),
    // SEM-03：产品密度 → TECHNICAL
    req("req-density", "TECHNICAL", "Widget foam density shall be no less than 50 kg/m3.", {
      technicalArea: "material",
    }),
    // SEM-04：Procurement Card 条款 → COMMERCIAL
    req("req-pcard", "COMMERCIAL", "Vendor must accept payment by Procurement Card without surcharge.", {
      submissionStage: "post-award",
    }),
    // SEM-05：保密/记录保存 → ADMINISTRATIVE post-award
    req("req-conf", "ADMINISTRATIVE", "Vendor must retain records for seven years after contract expiry.", {
      submissionStage: "post-award",
    }),
  ],
  mandatoryRequirementIds: ["req-invoice", "req-forma", "req-density", "req-pcard", "req-conf"],
  unknowns: [{ field: "delivery", note: "Delivery schedule referenced but not present." }],
  risks: [
    {
      id: "risk-schedule",
      severity: "IMPORTANT",
      riskType: "MISSING_FORM",
      description: "Schedule 1 (delivery timetable) is referenced but not included in the package.",
      relatedRequirementIds: [],
      relatedFactIds: [],
      evidence: [ev("doc-main", 12, "as set out in Schedule 1")],
      reasonCode: "MISSING_REFERENCED_DOC",
    },
  ],
  clarifications: [
    {
      id: "clar-schedule",
      question: "Please provide Schedule 1 (delivery timetable).",
      reason: "Referenced but missing; affects cost and delivery planning.",
      priority: "HIGH",
      relatedRequirementIds: [],
      supportingEvidence: [ev("doc-main", 12, "as set out in Schedule 1")],
      whatIsUnknown: "delivery timetable",
      businessImpact: "cannot price logistics",
    },
  ],
  resolvedAmbiguities: [],
  addendumChanges: [
    {
      id: "chg-close",
      addendumDocumentId: "doc-add",
      action: "EXTENDS",
      supersededRequirementId: null,
      activeRequirementId: null,
      note: "Closing date extended by Addendum 1.",
      evidence: [ev("doc-add", 1, "closing date is changed")],
    },
  ],
  conflicts: [],
  submissionChecklist: [{ requirementId: "req-forma", statement: "Submit Form A with the bid." }],
  evidenceCoverage: {
    factsWithEvidence: 1,
    factsTotal: 1,
    requirementsWithEvidence: 5,
    requirementsTotal: 5,
  },
  limitations: [],
  metadata: {
    analyzerVersion: "v2" as AnalysisResultV2["metadata"]["analyzerVersion"],
    resultVersion: "v2" as AnalysisResultV2["metadata"]["resultVersion"],
    projectId: "p1",
    startedAt: "",
    finishedAt: "",
    wallTimeMs: 0,
    llmCalls: 0,
    llmFailures: 0,
    models: [],
    promptUsages: [],
    pages: 42,
    windows: 4,
    rejectedCandidates: [],
    inputChars: 0,
    outputChars: 0,
  },
};

const keyItem = (
  id: string,
  over: Partial<AnalystLlmOutput["keyRequirements"][number]>,
): AnalystLlmOutput["keyRequirements"][number] => ({
  id,
  titleZh: "合成标题",
  explanationZh: "合成解释。",
  whyItMattersZh: "合成原因。",
  phase: "BID_SUBMISSION",
  impact: "BID_REQUIRED",
  severity: "HIGH",
  supportingRequirementIds: [],
  supportingFactIds: [],
  supportingRiskIds: [],
  ...over,
});

const baseSynthesis = (): AnalystLlmOutput => ({
  executiveBrief: {
    oneLinerZh: "这是一个合成采购项目。",
    whatIsBeingBoughtZh: "采购合成部件。",
    bidderTakeawayZh: "先确认 Schedule 1 再报价。",
    keyPoints: ["Form A 必须随标提交"],
  },
  scope: {
    overviewZh: "合成范围。",
    deliverables: ["合成部件"],
    quantities: [],
    deliveryScope: [],
    exclusionsOrUnknowns: ["交付时间表未提供"],
  },
  keyRequirements: [],
  technicalRequirements: [],
  commercialAndDelivery: [],
  risksAndGaps: [],
  clarifications: [],
  currentAssessment: {
    status: "NEEDS_CLARIFICATION",
    summaryZh: "需澄清 Schedule 1 后再报价。",
    reasons: ["交付时间表缺失"],
    mustResolveBeforePricing: ["Schedule 1"],
  },
  nextActions: [
    { order: 1, actionZh: "向采购方索取 Schedule 1", reasonZh: "影响物流成本", targetArea: "clarifications" },
  ],
});

console.log("tender-analyst semantic matrix");

/* SEM-01：invoice 条款 BID_FATAL/TECHNICAL 误分类必须被拦截 */
{
  const s = baseSynthesis();
  s.keyRequirements = [
    keyItem("KR-1", {
      impact: "BID_FATAL",
      severity: "CRITICAL",
      phase: "POST_AWARD",
      supportingRequirementIds: ["req-invoice"],
    }),
  ];
  s.technicalRequirements = [
    keyItem("TR-1", { phase: "TECHNICAL_COMPLIANCE", supportingRequirementIds: ["req-invoice"] }),
  ];
  const v = validateTenderAnalystSynthesis(s, RESULT);
  const kr = v.sanitized.keyRequirements[0];
  ok(kr?.impact === "BID_REQUIRED", "SEM-01: invoice 条款 BID_FATAL → 降级 BID_REQUIRED");
  ok(kr?.severity !== "CRITICAL", "SEM-01: 降级后不保留 CRITICAL");
  ok(v.sanitized.technicalRequirements.length === 0, "SEM-01: invoice 不得进入 technicalRequirements");
  ok(v.issues.length >= 2, "SEM-01: 问题被记录");
}

/* SEM-02：Form A 拒标条款 → BID_FATAL 合法 */
{
  const s = baseSynthesis();
  s.keyRequirements = [
    keyItem("KR-1", {
      impact: "BID_FATAL",
      severity: "CRITICAL",
      supportingRequirementIds: ["req-forma"],
    }),
  ];
  const v = validateTenderAnalystSynthesis(s, RESULT);
  ok(v.sanitized.keyRequirements[0]?.impact === "BID_FATAL", "SEM-02: 明确拒标措辞 → BID_FATAL 保留");
}

/* SEM-03：技术密度条款 → technicalRequirements 合法 */
{
  const s = baseSynthesis();
  s.technicalRequirements = [
    keyItem("TR-1", {
      phase: "TECHNICAL_COMPLIANCE",
      impact: "BID_REQUIRED",
      supportingRequirementIds: ["req-density"],
    }),
  ];
  const v = validateTenderAnalystSynthesis(s, RESULT);
  ok(v.sanitized.technicalRequirements.length === 1, "SEM-03: TECHNICAL 支撑 → 技术区保留");
}

/* SEM-04/05：Procurement Card / 保密记录 → 不得成为 technical；BID_FATAL 不成立 */
{
  const s = baseSynthesis();
  s.technicalRequirements = [
    keyItem("TR-1", { supportingRequirementIds: ["req-pcard"] }),
    keyItem("TR-2", { supportingRequirementIds: ["req-conf"] }),
  ];
  s.keyRequirements = [
    keyItem("KR-1", {
      impact: "BID_FATAL",
      supportingRequirementIds: ["req-conf"],
    }),
  ];
  const v = validateTenderAnalystSynthesis(s, RESULT);
  ok(v.sanitized.technicalRequirements.length === 0, "SEM-04/05: PCard/保密 不得进入技术区");
  ok(v.sanitized.keyRequirements[0]?.impact !== "BID_FATAL", "SEM-05: post-award 义务不得 BID_FATAL");
}

/* SEM-06：缺失交付时间表 → risk + clarification 可被引用并 hydrate */
{
  const s = baseSynthesis();
  s.risksAndGaps = [
    {
      titleZh: "交付时间表缺失",
      explanationZh: "Schedule 1 被引用但未包含。",
      impactZh: "影响成本与履约安排。",
      recommendedActionZh: "确认是否缺少 Schedule 1。",
      severity: "HIGH",
      supportingIds: ["risk-schedule", "clar-schedule"],
    },
  ];
  const v = validateTenderAnalystSynthesis(s, RESULT);
  ok(v.sanitized.risksAndGaps.length === 1, "SEM-06: 缺口风险保留");
  const idx = hydrateEvidenceIndex(v.sanitized, RESULT);
  ok(Boolean(idx["risk-schedule"]) && idx["risk-schedule"].evidence[0]?.pageNumber === 12, "SEM-06: 证据 hydrate 到 p.12");
}

/* SEM-07：补遗改期 → context 携带 addendumChanges + 最新 close fact */
{
  const ctx = buildTenderAnalystContext(RESULT);
  ok(ctx.addendumChanges.length === 1 && ctx.addendumChanges[0].action === "EXTENDS", "SEM-07: context 携带补遗变更");
  ok(ctx.facts.some((f) => f.id === "fact-close"), "SEM-07: 最新截标事实在 context 中");
}

/* SEM-08：中文输出纪律来自 prompt 硬规则；schema 强制 *Zh 字段 */
{
  ok(/Simplified Chinese/.test(ANALYST_SYSTEM_PROMPT), "SEM-08: prompt 要求简体中文输出");
  ok(/never translate or alter original evidence/i.test(ANALYST_SYSTEM_PROMPT), "SEM-08: 原文证据不翻译不篡改");
  const parsed = analystLlmOutputSchema.safeParse(baseSynthesis());
  ok(parsed.success, "SEM-08: zh 契约 schema 可解析");
}

/* SEM-09：raw 条款全保留（context），keyRequirements 有上限（≠全部 binding） */
{
  const ctx = buildTenderAnalystContext(RESULT);
  ok(ctx.requirements.length === 5, "SEM-09: context 保留全部 raw 条款");
  const tooMany = baseSynthesis();
  tooMany.keyRequirements = Array.from({ length: 41 }, (_, i) =>
    keyItem(`KR-${i}`, { supportingRequirementIds: ["req-forma"] }),
  );
  ok(!analystLlmOutputSchema.safeParse(tooMany).success, "SEM-09: keyRequirements 超上限被 schema 拒绝");
}

/* SEM-10：无 supporting ID 的关键结论不得持久化 */
{
  const s = baseSynthesis();
  s.keyRequirements = [keyItem("KR-1", { supportingRequirementIds: [] })];
  s.risksAndGaps = [
    {
      titleZh: "无证据风险",
      explanationZh: "……",
      impactZh: "……",
      recommendedActionZh: "……",
      severity: "HIGH",
      supportingIds: [],
    },
  ];
  const v = validateTenderAnalystSynthesis(s, RESULT);
  ok(v.sanitized.keyRequirements.length === 0, "SEM-10: 无支撑关键要求被移除");
  ok(v.sanitized.risksAndGaps.length === 0, "SEM-10: 无支撑风险被移除");
  ok(v.removedCount === 2, "SEM-10: removedCount=2");
}

/* 不存在的 ID 必须剔除（§26） */
{
  const s = baseSynthesis();
  s.keyRequirements = [
    keyItem("KR-1", { supportingRequirementIds: ["req-forma", "req-GHOST"] }),
  ];
  const v = validateTenderAnalystSynthesis(s, RESULT);
  ok(
    v.sanitized.keyRequirements[0]?.supportingRequirementIds.join(",") === "req-forma",
    "§26: 不存在的实体 ID 被剔除",
  );
  ok(v.issues.some((i) => i.includes("req-GHOST")), "§26: 剔除有记录");
}

/* 两段式编排（deterministic 注入 invoker）：PASS A 违规 → 校验 + QA 修订 → 最终消毒 */
async function twoPassCase() {
  const draft = baseSynthesis();
  draft.keyRequirements = [
    keyItem("KR-1", { impact: "BID_FATAL", supportingRequirementIds: ["req-invoice"] }),
    keyItem("KR-2", { impact: "BID_FATAL", severity: "CRITICAL", supportingRequirementIds: ["req-forma"] }),
  ];
  const revised = baseSynthesis();
  revised.keyRequirements = [
    keyItem("KR-2", { impact: "BID_FATAL", severity: "CRITICAL", supportingRequirementIds: ["req-forma"] }),
    keyItem("KR-3", { impact: "CONTRACT_ONLY", phase: "POST_AWARD", severity: "LOW", supportingRequirementIds: ["req-invoice"] }),
  ];
  const invoker: LlmInvoker = async (r) => {
    if (r.promptName === "tender-analyst-synthesis") {
      return { content: JSON.stringify(draft), model: "scripted", elapsedMs: 1 };
    }
    return {
      content: JSON.stringify({
        verdict: "REVISED",
        issues: ["invoice clause was not bid-fatal; reclassified"],
        needsHumanReview: false,
        revised,
      }),
      model: "scripted",
      elapsedMs: 1,
    };
  };
  const out = await runAnalystSynthesis({
    result: RESULT,
    coverage: { uploaded: 5, eligible: 4, analyzed: 4, excluded: [
      { filename: "checklist.docx", fileType: "docx", parseStatus: "done", contentHashReady: true, pageCount: null, exclusionReason: "非 PDF 无页级 citation" },
    ] },
    invoker,
  });
  ok(out.synthesis !== null, "两段式: 产出 synthesis");
  ok(out.synthesis?.qa.status === "REVISED", "两段式: QA REVISED 被采纳");
  ok(out.synthesis?.keyRequirements.some((k) => k.id === "KR-3" && k.impact === "CONTRACT_ONLY"), "两段式: QA 重分类生效");
  ok(out.synthesis?.coverage.uploaded === 5 && out.synthesis?.coverage.excluded.length === 1, "两段式: coverage 透传（上传5/排除1）");
  ok(out.llmCalls === 2, "两段式: 两次 LLM 调用被计数");
  ok(Boolean(out.synthesis && out.synthesis.evidenceIndex["req-forma"]), "两段式: evidenceIndex 已 hydrate");
}

/* extraction prompt 纪律（§11） */
{
  ok(/NEVER "TECHNICAL"/.test(EXTRACT_SYSTEM_PROMPT), "§11: 抽取 prompt 禁止 invoice/PCard→TECHNICAL");
  ok(/post-award/.test(EXTRACT_SYSTEM_PROMPT), "§11: 抽取 prompt 带 submissionStage 纪律");
}

twoPassCase()
  .then(() => {
    console.log(`\ntender-analyst: ${pass} passed, ${fail} failed`);
    process.exit(fail > 0 ? 1 : 0);
  })
  .catch((e) => {
    console.error("two-pass case crashed:", e);
    process.exit(1);
  });
