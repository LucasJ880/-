/**
 * FB-4/5 — 内部决策备忘录（纯测）
 * RFQ-PDF-1：分析综合版的「供应商询价与符合性确认表」已删除（供应商询价单只从已确认的要求排出，
 * 见 src/lib/tender-rfq/__tests__/sheet-download.test.ts）；这里留内部备忘录的用例，
 * 以及「CHAIN-4b 之前的供应商表抬头过禁出清单会命中」这条防护用例（夹具是当时的真实产物）。
 * 运行：npx tsx src/lib/projects/generate/__tests__/tender-doc-html.test.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { buildInternalDecisionMemoHtml } from "../tender-doc-html";
import * as tenderDocHtml from "../tender-doc-html";
import type { TenderAnalystSynthesisV1 } from "@/lib/tender-analyst/contract";
import { buildProjectIdentityDenyList, scanIdentity } from "@/lib/bid-workflow/project-identity-deny";

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

const h = { projectName: "测试项目", clientOrganization: "Buyer Agency", solicitationNumber: "COS-1", closeDate: "2026-09-04", orgName: "Sunny", generatedAt: "2026-08-13" };
/** 去标签、还原三个转义，得到读者看到的文字（只给下面的夹具用） */
const htmlToText = (html: string): string =>
  html.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

console.log("tender-doc-html");
const memo = buildInternalDecisionMemoHtml(h, syn);
ok(memo.includes("MANAGEMENT DECISION MEMO"), "内部=决策备忘录");
ok(memo.includes("有条件推进"), "建议结论映射中文");
ok(memo.includes("报价前必须解决的前置条件") && memo.includes("Schedule 1"), "前置条件表");
ok(memo.includes("待管理层补充") && memo.includes("不评估公司能力"), "能力表=人工框架,不编造");
ok(!memo.includes("【F-011"), "备忘录无内嵌引用码");
ok(Object.keys(tenderDocHtml).every((k) => !/supplier/i.test(k)), "本模块不再导出任何供应商侧模板（RFQ-PDF-1）");

// —— 内部文件照旧；CHAIN-4b 之前的供应商表抬头会被禁出清单拦下 ——
ok(["测试项目", "COS-1", "Buyer Agency", "2026-09-04"].every((x) => memo.includes(x)), "内部决策备忘录：照旧印项目名称、项目编号、采购方、投标截止");
const deny = buildProjectIdentityDenyList({
  projectName: "测试项目", solicitationNumber: "COS-1", clientOrganization: "Buyer Agency", closeDate: new Date("2026-09-04T16:00:00Z"), timeZone: "America/Toronto",
  facts: { tenderNumber: [], buyer: [], projectTitle: [], closingDatetime: [], location: [] }, allowedEmails: [],
});
const before = readFileSync(path.join(process.cwd(), "src/lib/projects/generate/__tests__/fixtures/supplier-rfq-before-chain-4b.html"), "utf8");
const beforeHits = scanIdentity(deny, [{ where: "文件抬头", text: htmlToText(before), kind: "authored" }]).map((x) => x.category);
ok(["tender_number", "buyer_name", "close_date"].every((c) => beforeHits.includes(c as never)), "改前的抬头（夹具）过同一项目的禁出清单：命中招标编号、采购方名称、截标日期");

// 源码断言：身份命中在写文件之前抛出，接口回 422
const src = readFileSync(path.join(process.cwd(), "src/lib/projects/generate/generate-docs.ts"), "utf8");
const svc = readFileSync(path.join(process.cwd(), "src/lib/tender-rfq/sheet-download-service.ts"), "utf8");
const route = readFileSync(path.join(process.cwd(), "src/app/api/projects/[id]/generate-pdf/route.ts"), "utf8");
ok(/e instanceof SupplierIdentityLeakError/.test(route) && /errorCode: e\.errorCode \}, \{ status: 422 \}/.test(route), "生成接口：身份命中返回 422 与 errorCode（其它错误仍是 500）");
ok(/throw new SupplierIdentityLeakError/.test(svc) && src.indexOf("await buildProjectRfqSheet(") > 0 && src.indexOf("await buildProjectRfqSheet(") < src.indexOf("return persistGeneratedFile("), "供应商询价单命中时在落库之前抛出（不写文件、不建记录）");
ok(!/supplierFacing|SUPPLIER_DOC_TYPES/.test(src) && /const fullText = `\$\{DOC_TITLES\[docType\]\}\\n\\nProject: \$\{project\.name\}/.test(src), "旧的文本路径只剩内部文件：正文开头照旧写 Project: 项目名");
console.log(`\ntender-doc-html: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
