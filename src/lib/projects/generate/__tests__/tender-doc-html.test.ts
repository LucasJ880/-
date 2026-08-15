/**
 * FB-4/5 — 内部决策备忘录 vs 供应商 RFQ 语义分离（纯测）
 * 运行：npx tsx src/lib/projects/generate/__tests__/tender-doc-html.test.ts
 */
import { buildInternalDecisionMemoHtml, buildSupplierRfqHtml } from "../tender-doc-html";
import type { TenderAnalystSynthesisV1 } from "@/lib/tender-analyst/contract";

let pass = 0, fail = 0;
const ok = (c: boolean, n: string) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.error("  ✗ " + n); } };

const item = (id: string, impact: string, phase: string) => ({
  id, titleZh: "泡沫密度要求", explanationZh: "密度不低于 50kg/m3。【F-011,R-026】",
  whyItMattersZh: "不达标即技术不合格。", phase, impact, severity: "HIGH",
  supportingRequirementIds: ["R-1"], supportingFactIds: [], supportingRiskIds: [],
}) as TenderAnalystSynthesisV1["keyRequirements"][number];

const syn = {
  version: "tender-analyst-synthesis/v1", language: "zh-CN",
  coverage: { uploaded: 5, eligible: 4, analyzed: 4, excluded: [{ filename: "a.docx", fileType: "docx", parseStatus: "done", contentHashReady: true, pageCount: null, exclusionReason: "非 PDF" }] },
  executiveBrief: { oneLinerZh: "监所床垫供货项目。", whatIsBeingBoughtZh: "一体式泡沫床垫。", bidderTakeawayZh: "先锁检测报告。", keyPoints: ["约 16,500 张/年"] },
  scope: { overviewZh: "供货范围概述。", deliverables: ["床垫"], quantities: ["16,500/年"], deliveryScope: ["安大略"], exclusionsOrUnknowns: ["预算未知"] },
  keyRequirements: [item("KR-1", "BID_FATAL", "BID_SUBMISSION")],
  technicalRequirements: [item("TR-1", "BID_REQUIRED", "TECHNICAL_COMPLIANCE")],
  commercialAndDelivery: [item("CD-1", "CONTRACT_ONLY", "POST_AWARD")],
  risksAndGaps: [{ titleZh: "交付时间缺失", explanationZh: "Schedule 1 缺。", impactZh: "影响成本。", recommendedActionZh: "澄清。", severity: "HIGH", supportingIds: ["R-1"] }],
  clarifications: [{ questionZh: "请提供 Schedule 1。", reasonZh: "缺失。", ifNotResolvedZh: "无法报价。", priority: "HIGH", clarificationIds: [], supportingIds: ["R-1"] }],
  currentAssessment: { status: "NEEDS_CLARIFICATION", summaryZh: "澄清后报价。", reasons: ["数量依据缺"], mustResolveBeforePricing: ["Schedule 1"] },
  nextActions: [{ order: 1, actionZh: "发澄清函", reasonZh: "解锁报价", targetArea: "clarifications" }],
  qa: { status: "PASS", issues: [], needsHumanReview: false },
  evidenceIndex: {}, telemetry: { analystLatencyMs: 0, reviewLatencyMs: 0, totalLlmCalls: 0, llmFailures: 0, model: null },
} as unknown as TenderAnalystSynthesisV1;

const h = { projectName: "测试项目", clientOrganization: "Buyer", solicitationNumber: "COS-1", closeDate: "2026-09-04", orgName: "Sunny", generatedAt: "2026-08-13" };

console.log("tender-doc-html");
const memo = buildInternalDecisionMemoHtml(h, syn);
const rfq = buildSupplierRfqHtml(h, syn);
ok(memo.includes("MANAGEMENT DECISION MEMO"), "内部=决策备忘录");
ok(memo.includes("有条件推进"), "建议结论映射中文");
ok(memo.includes("报价前必须解决的前置条件") && memo.includes("Schedule 1"), "前置条件表");
ok(memo.includes("待管理层补充") && memo.includes("不评估公司能力"), "能力表=人工框架,不编造");
ok(!memo.includes("【F-011"), "备忘录无内嵌引用码");
ok(rfq.includes("符合性确认") && rfq.includes("□ 满足"), "供应商=确认+报价表");
ok(!rfq.includes("MANAGEMENT DECISION MEMO") && !rfq.includes("风险与缺口") && !rfq.includes("建议结论"), "供应商文件不含内部判断");
ok(!rfq.includes("CONFIDENTIAL"), "供应商文件无内部密级头");
ok(rfq.includes("泡沫密度要求") && !rfq.includes("【F-011"), "RFQ 含技术要求且无引用码");
ok(memo !== rfq, "两类文档内容不同");
console.log(`\ntender-doc-html: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
