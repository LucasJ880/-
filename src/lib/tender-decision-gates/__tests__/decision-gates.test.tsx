/**
 * FLOW-H5 两道闸生效——纯逻辑、草稿横幅、卡片呈现与接线
 * 运行：npx tsx src/lib/tender-decision-gates/__tests__/decision-gates.test.tsx
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BidDraftGateNotes } from "@/components/tender/bid-draft-card";
import { bidDraftMetaOf, renderBidDraftHtml, synthesizeBidDraft, type BidDraftInputs } from "@/lib/tender-bid-draft";
import type { LlmInvoker } from "@/lib/tender-understanding/llm";
import {
  PENDING_ANALYSIS_DRAFT_HINT_ZH, UNCONFIRMED_BASIS_BANNER_EN, UNCONFIRMED_BASIS_DRAFT_NOTE_ZH,
  isDecisionGatesEnabledForOrgWithEnv, isNoGoDecision, noGoDraftReminderZh, noGoRfqReminderZh,
} from "../gates";

let passed = 0;
function ok(name: string, cond: boolean, detail?: unknown) {
  assert.equal(cond, true, detail === undefined ? name : `${name}\n${JSON.stringify(detail, null, 2)}`);
  passed += 1;
  console.log(`  ✓ ${name}`);
}
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const TZ = "America/Toronto";

const inputs = (): BidDraftInputs => ({
  project: { id: "p1", nameZh: "示例", buyer: "City of Example", tenderNumber: "T-1", tenderTitle: "Curtains", closing: "2026-12-01", submissionMethod: "portal" },
  requirements: [{ id: "r1", code: "R-001", category: "submission", textZh: "提交投标书", textOriginal: "Submit the form of tender", mandatory: true, evidenceRequired: false, fit: null, noteZh: null, status: "TO_CONFIRM" }],
  facts: [], criticalFacts: {}, analystBrief: null, submissionChecklist: null, memo: null, rfiCount: 0,
  pricing: { ourPriceCad: null, competitorPriceCad: null, note: null },
  org: { brandContext: null, forbiddenClaims: null, memoryClaims: [], ownWins: [] },
  excludeNames: [],
});

async function main() {
  console.log("文字与开关");
  {
    const at = new Date("2026-11-10T15:00:00Z");
    ok("询价入口的提醒：写明不投、哪天定的、照常可以询价", noGoRfqReminderZh(at, TZ) === "投标决定是不投（No-Go，2026年11月10日定的）：照常可以询价，请确认是否还要问供应商要价" && noGoRfqReminderZh(null, TZ) === "投标决定是不投（No-Go）：照常可以询价，请确认是否还要问供应商要价");
    ok("起草卡片的提醒：照常可以起草", noGoDraftReminderZh(at, TZ) === "投标决定是不投（No-Go，2026年11月10日定的）：照常可以起草，请确认是否还要准备投标文件");
    ok("No-Go 只认 NO_GO；GO、HOLD、没有都不算", isNoGoDecision("NO_GO") && ["GO", "HOLD", null, undefined, "", "no_go"].every((v) => !isNoGoDecision(v)));
    const on = (env: Record<string, string | undefined>, org: string | null = "org1") => isDecisionGatesEnabledForOrgWithEnv(org, env as NodeJS.ProcessEnv);
    ok("开关：默认关；1/true/on/yes 算开；名单生效；没有组织算关", !on({}) && ["1", "true", "on", "yes"].every((v) => on({ TENDER_DECISION_GATES_ENABLED: v })) && !on({ TENDER_DECISION_GATES_ENABLED: "0" }) && !on({ TENDER_DECISION_GATES_ENABLED: "1" }, null) && on({ TENDER_DECISION_GATES_ENABLED: "1", TENDER_DECISION_GATES_ORG_ALLOWLIST: "a,org1" }) && !on({ TENDER_DECISION_GATES_ENABLED: "1", TENDER_DECISION_GATES_ORG_ALLOWLIST: "a" }));
  }

  console.log("草稿文件与起草之后的元信息");
  {
    const invoker: LlmInvoker = async () => ({ content: JSON.stringify({ coverLetterEn: "Hello", executiveSummaryEn: "S", complianceResponses: [], technicalApproachEn: "T", companyProfileEn: "C", socialValueGuidanceEn: "G", pricingSummaryEn: "P", internalNotesZh: ["注"] }), model: "fake", elapsedMs: 1 });
    const { result } = await synthesizeBidDraft(inputs(), { invoker });
    ok("前提：假的合成得到一份草稿", !!result);
    const plain = renderBidDraftHtml(inputs(), result!);
    const marked = renderBidDraftHtml(inputs(), result!, { unconfirmedBasisBanner: UNCONFIRMED_BASIS_BANNER_EN });
    ok("没给横幅：与原来相同（没有「基于未确认的要求」）", !plain.includes('data-basis="unconfirmed"') && plain === renderBidDraftHtml(inputs(), result!, { unconfirmedBasisBanner: null }));
    ok("给了横幅：在 AI DRAFT 横幅之后多一行「BASED ON UNCONFIRMED REQUIREMENTS」", marked.includes('data-basis="unconfirmed"') && marked.includes("BASED ON UNCONFIRMED REQUIREMENTS") && marked.indexOf("AI DRAFT") < marked.indexOf("BASED ON UNCONFIRMED"));
    ok("横幅文字会转义", renderBidDraftHtml(inputs(), result!, { unconfirmedBasisBanner: "<b>x</b>" }).includes("&lt;b&gt;x&lt;/b&gt;"));
    const metaOff = bidDraftMetaOf(result!, null), metaOn = bidDraftMetaOf(result!, { runId: "run1", approved: false });
    ok("元信息：没有依据（开关关）时与原来的键相同；有依据时多记所用分析与是否已批准", Object.keys(metaOff).sort().join() === "excludedNameHits,forbiddenHits,generatedAt,internalNotesZh,placeholders,requirementCount,toConfirm,version" && metaOn.analysisRunId === "run1" && metaOn.basedOnApprovedAnalysis === false && bidDraftMetaOf(result!, { runId: "run2", approved: true }).basedOnApprovedAnalysis === true);
  }

  console.log("起草卡片上的提醒与标注");
  {
    const html = (p: React.ComponentProps<typeof BidDraftGateNotes>) => renderToStaticMarkup(<BidDraftGateNotes {...p} />);
    ok("开关关（没有 gates）：什么都不渲染，即使元信息里说基于未批准的分析", html({}) === "" && html({ basedOnApprovedAnalysis: false }) === "");
    ok("No-Go：显示提醒", html({ gates: { noGoZh: "投标决定是不投", pendingAnalysisZh: null } }).includes("投标决定是不投"));
    ok("当前分析还没批准：起草前提示", html({ gates: { noGoZh: null, pendingAnalysisZh: PENDING_ANALYSIS_DRAFT_HINT_ZH } }).includes("起草会基于未确认的要求"));
    ok("上一份草稿基于未批准的分析：写明", html({ gates: { noGoZh: null, pendingAnalysisZh: null }, basedOnApprovedAnalysis: false }).includes(UNCONFIRMED_BASIS_DRAFT_NOTE_ZH));
    ok("都没有（已批准、不是 No-Go、上一份基于已批准的）：不渲染", html({ gates: { noGoZh: null, pendingAnalysisZh: null }, basedOnApprovedAnalysis: true }) === "" && html({ gates: { noGoZh: null, pendingAnalysisZh: null } }) === "");
    const all = html({ gates: { noGoZh: "N", pendingAnalysisZh: "P" }, basedOnApprovedAnalysis: false });
    ok("三条都有时依次列出", [...all.matchAll(/data-note="(\w+)"/g)].map((m) => m[1]).join() === "nogo,pending,basis");
    const card = read("src/components/tender/bid-draft-card.tsx");
    ok("卡片把提醒放在起草按钮下面（不拦按钮）", card.includes("<BidDraftGateNotes gates={data.gates} basedOnApprovedAnalysis={data.draft?.basedOnApprovedAnalysis} />") && !/disabled=\{[^}]*gates/.test(card));
  }

  console.log("接线");
  {
    const gen = read("src/lib/projects/generate/generate-docs.ts");
    ok("起草：同一次取数拿到所用分析；开关开着且没批准才加横幅；元信息开关开着才多记", gen.includes("const gathered = await gatherBidDraftInputsWithBasis(") && gen.includes("{ unconfirmedBasisBanner: gates && !basis.approved ? UNCONFIRMED_BASIS_BANNER_EN : null }") && gen.includes("bidDraft: bidDraftMetaOf(result, gates ? basis : null),") && gen.includes("const { result, errorCode } = await synthesizeBidDraft(inputs);"));
    const gather = read("src/lib/tender-bid-draft/gather.ts");
    ok("取数：所用分析的状态与起草取的是同一行", gather.includes("select: { id: true, status: true, summaryJson: true },") && gather.includes('basisOut.current = { runId: run.id, approved: run.status === "APPROVED" };'));
    ok("提示词不变：合成只拿起草的输入", !read("src/lib/tender-bid-draft/synthesize.ts").includes("basis"));
    const entry = read("src/lib/tender-rfq/web-entry.ts");
    ok("询价入口：开关开着、这个组织这个项目的决定是 NO_GO 时多一条提醒；入口可用与否照旧", entry.includes('where: { projectId: project.id, orgId: input.orgId, goDecision: "NO_GO" }') && entry.includes("const state = noGo ? { ...baseState, warnings: [...baseState.warnings, noGoRfqReminderZh(noGo.goDecidedAt, timeZone)] } : baseState;") && entry.includes("const noGo = isDecisionGatesEnabledForOrg(input.orgId)"));
    const route = read("src/app/api/projects/[id]/bid-draft/route.ts");
    ok("起草元信息接口：开关开着才多返回 gates", route.includes("...(gates ? { gates: await gatesOf(access.project.orgId, room, run) } : {}),") && route.includes("const gates = isDecisionGatesEnabledForOrg(access.project.orgId);"));
    ok("规则文件是纯的", !/@\/lib\/db|prisma|fetch\(/.test(read("src/lib/tender-decision-gates/gates.ts").replace(/\/\*[\s\S]*?\*\//g, "")));
  }

  console.log(`\n✓ decision-gates: ${passed} 项断言全部通过`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
