/**
 * 投标文件起草探针（BD-01..10）
 * 运行：npx tsx src/lib/tender-bid-draft/__tests__/bid-draft.test.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  bidDraftLlmSchema,
  complianceStatusFromFit,
  type BidDraftInputs,
} from "@/lib/tender-bid-draft/contract";
import { synthesizeBidDraft } from "@/lib/tender-bid-draft/synthesize";
import { renderBidDraftHtml } from "@/lib/tender-bid-draft/render";
import type { LlmInvoker } from "@/lib/tender-understanding/llm";

let pass = 0;
let fail = 0;
const ok = (c: boolean, n: string, d?: unknown) => {
  if (c) { pass++; console.log(`  ✓ ${n}`); }
  else { fail++; console.error(`  ✗ ${n}`, d ?? ""); }
};
const code = (p: string) =>
  readFileSync(join(process.cwd(), p), "utf-8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const baseInputs = (): BidDraftInputs => ({
  project: { id: "p1", nameZh: "Halifax 媒体监测", buyer: "Halifax Regional Municipality", tenderNumber: "HRM-2026-0395", tenderTitle: "Media Monitoring Tool", closing: "2026-09-08 14:00 Atlantic", submissionMethod: "Bids&Tenders" },
  requirements: [
    { id: "r1", code: "R-001", category: "technical", textZh: "每日 8:30 前可用", textOriginal: "Available by 8:30 a.m. AST daily.", mandatory: true, evidenceRequired: false, fit: "HAVE", noteZh: "现有平台 7:00 推送", status: "COMPLIANT" },
    { id: "r2", code: "R-002", category: "insurance", textZh: "保险", textOriginal: "Insurance per PO T&C.", mandatory: true, evidenceRequired: true, fit: null, noteZh: null, status: "TO_CONFIRM" },
    { id: "r3", code: "R-003", category: "technical", textZh: "7 用户", textOriginal: "Minimum seven (7) users.", mandatory: true, evidenceRequired: false, fit: "PARTNER", noteZh: null, status: "COMPLIANT_VIA_PARTNER" },
  ],
  facts: [{ zh: "截标 9 月 8 日", original: "Deadline September 8, 2026" }],
  criticalFacts: { buyer: "Halifax Regional Municipality" },
  analystBrief: null,
  submissionChecklist: null,
  memo: { summaryZh: "要点", riskGates: [], teamingAdviceZh: null },
  rfiCount: 3,
  pricing: { ourPriceCad: null, competitorPriceCad: 58079, note: "n" },
  org: { brandContext: "品牌名：Sunny", forbiddenClaims: "业界第一, 保证中标", memoryClaims: [{ statement: "持有 ISO 9001 认证", claimType: "certification", verificationStatus: "HUMAN_CONFIRMED" }], ownWins: [] },
  excludeNames: ["Meltwater News Canada Inc.", "Meltwater"],
});

async function main() {
  console.log("投标文件起草探针");

  // BD-01 五态 → 合规状态；未标 → TO_CONFIRM
  ok(
    complianceStatusFromFit("HAVE") === "COMPLIANT" && complianceStatusFromFit("BUILD") === "COMPLIANT_ON_AWARD" &&
      complianceStatusFromFit("PARTNER") === "COMPLIANT_VIA_PARTNER" && complianceStatusFromFit("RFI") === "CLARIFICATION_REQUESTED" &&
      complianceStatusFromFit("NO_GO") === "INTERNAL_NO_GO" && complianceStatusFromFit(null) === "TO_CONFIRM" && complianceStatusFromFit("garbage") === "TO_CONFIRM",
    "BD-01: 合规矩阵五态映射；未标/脏值 → TO_CONFIRM（不默认合规）",
  );
  // BD-02 schema 硬化：缺键/坏形不抛
  {
    const parsed = bidDraftLlmSchema.safeParse({ coverLetterEn: "x", complianceResponses: [null, { requirementCode: "R-001" }, "junk"], internalNotesZh: ["a", 1] });
    ok(parsed.success && parsed.data.executiveSummaryEn === "" && parsed.data.internalNotesZh.length === 1, "BD-02: schema 逐项预处理，缺键/脏项不拖垮整体", parsed.success ? null : parsed.error.issues.slice(0, 2));
  }
  // BD-03 合成后处理：覆盖全部要求、未标占位、竞对名剔除、禁用语替换、价格不编
  {
    const invoker: LlmInvoker = async () => ({
      content: JSON.stringify({
        coverLetterEn: "We are pleased to submit. Unlike Meltwater, we are 业界第一.",
        executiveSummaryEn: "Summary.",
        complianceResponses: [{ requirementCode: "R-001", responseEn: "Compliant: daily 7:00 push." }],
        technicalApproachEn: "Approach.",
        companyProfileEn: "ISO 9001 certified.",
        socialValueGuidanceEn: "Guidance.",
        pricingSummaryEn: "Price provided in Bid Form. [TO CONFIRM: bid price]",
        internalNotesZh: ["保险待确认"],
      }),
      model: "fake",
      elapsedMs: 1,
    });
    const { result } = await synthesizeBidDraft(baseInputs(), { invoker });
    const byCode = new Map(result!.compliance.map((c) => [c.code, c]));
    ok(
      result != null && result.compliance.length === 3 &&
        byCode.get("R-001")!.responseEn.includes("7:00") &&
        byCode.get("R-002")!.responseEn.includes("[TO CONFIRM") &&
        byCode.get("R-003")!.responseEn.startsWith("Compliant (via partner)"),
      "BD-03a: 每条要求都有响应；LLM 漏的按状态占位/标签补齐",
      result?.compliance.map((c) => `${c.code}:${c.responseEn.slice(0, 40)}`),
    );
    ok(
      !/meltwater/i.test(result!.sections.coverLetterEn) && result!.excludedNameHits === 1 && result!.sections.coverLetterEn.includes("[a third-party supplier]"),
      "BD-03b（反例守卫）: 提交面竞对/现任名称被剔除",
    );
    ok(!result!.sections.coverLetterEn.includes("业界第一") && result!.forbiddenHits === 1, "BD-03c（反例守卫）: 品牌禁用语被替换为占位");
    ok(result!.placeholders >= 2 && result!.sections.internalNotesZh.some((n) => n.includes("竞对")) && result!.sections.internalNotesZh.some((n) => n.includes("禁用语")), "BD-03d: 占位计数 + 内部注记录替换", { placeholders: result!.placeholders, notes: result!.sections.internalNotesZh });
  }
  // BD-04 模型失败 → null + errorCode，不产半成品
  {
    const bad: LlmInvoker = async () => ({ content: "not json", model: "fake", elapsedMs: 1 });
    const r = await synthesizeBidDraft(baseInputs(), { invoker: bad });
    ok(r.result === null && r.errorCode != null, "BD-04: 结构化失败 → null + errorCode（不写半成品）", r.errorCode);
  }
  // BD-05 渲染：DRAFT 横幅、占位高亮、合规表、中文内部段、转义
  {
    const invoker: LlmInvoker = async () => ({ content: JSON.stringify({ coverLetterEn: "<b>Hi</b>", executiveSummaryEn: "S", complianceResponses: [], technicalApproachEn: "T", companyProfileEn: "C", socialValueGuidanceEn: "G", pricingSummaryEn: "P [TO CONFIRM: bid price]", internalNotesZh: ["注"] }), model: "fake", elapsedMs: 1 });
    const { result } = await synthesizeBidDraft(baseInputs(), { invoker });
    const html = renderBidDraftHtml(baseInputs(), result!);
    ok(
      html.includes("AI DRAFT") && html.includes("<mark>[TO CONFIRM: bid price]</mark>") && html.includes("&lt;b&gt;Hi&lt;/b&gt;") && html.includes("内部审阅注") && html.includes("R-002") && html.includes("MANDATORY") && html.includes("HRM-2026-0395"),
      "BD-05: 横幅/占位高亮/转义/合规表/内部段/编号",
    );
  }
  // BD-06 prompt 硬规则在场
  {
    const syn = readFileSync(join(process.cwd(), "src/lib/tender-bid-draft/synthesize.ts"), "utf-8");
    ok(
      syn.includes("Never state or imply a price") && syn.includes("Never mention any competitor or incumbent supplier by name") && syn.includes("[TO CONFIRM:") && syn.includes("Do not output any overall bid/no-bid recommendation"),
      "BD-06（反例守卫）: prompt 硬规则——不编价 / 不提竞对 / 占位 / 无 GO-NO-GO",
    );
  }
  // BD-07 docType 四处注册 + 卡片挂载 + gather 来源限定
  {
    const gd = code("src/lib/projects/generate/generate-docs.ts");
    const types = code("src/lib/bid-workflow/pdf-doc-types.ts");
    const menu = readFileSync(join(process.cwd(), "src/components/project-generate/project-generate-menu.tsx"), "utf-8");
    const tab = readFileSync(join(process.cwd(), "src/components/project-detail/tabs/workbench-tab.tsx"), "utf-8");
    ok(gd.includes('"bid_draft"') && gd.includes('import(\n      "@/lib/tender-bid-draft"') && types.includes('"bid_draft"') && menu.includes('docType: "bid_draft"') && tab.includes("<BidDraftCard"), "BD-07: docType bid_draft 四处注册 + 工作台卡片挂载");
    const gather = code("src/lib/tender-bid-draft/gather.ts");
    ok(gather.includes('verificationStatus: { in: ["HUMAN_CONFIRMED", "SYSTEM_VERIFIED"] }') && gather.includes('startsWith: "own-result:"'), "BD-08: 能力依据只取已验证企业记忆 + 我方中标记录");
  }

  console.log(`\n结果：${pass} 通过，${fail} 失败`);
  if (fail > 0) process.exit(1);
}
void main().catch((e) => { console.error(e); process.exit(1); });
