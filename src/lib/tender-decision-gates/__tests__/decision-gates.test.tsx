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
    const notesAt = card.indexOf("<BidDraftGateNotes gates={data.gates} basedOnApprovedAnalysis={data.draft?.basedOnApprovedAnalysis} />");
    const draftBlockAt = card.indexOf("{data.draft ? (\n        <div className=\"mt-2 rounded-lg");
    ok("卡片把提醒放在起草按钮下面、上一份草稿那一块之外（还没起草过时也看得到），不拦按钮", notesAt > 0 && draftBlockAt > notesAt && /^      <BidDraftGateNotes gates=\{data\.gates\} basedOnApprovedAnalysis=\{data\.draft\?\.basedOnApprovedAnalysis\} \/>$/m.test(card) && (card.match(/<BidDraftGateNotes /g) ?? []).length === 1 && !/disabled=\{[^}]*gates/.test(card));
    const menu = read("src/components/project-generate/project-generate-menu.tsx");
    ok("「标书与报价」的生成菜单：起草项下面显示同样的提醒（取起草元信息的 gates），不拦", menu.includes('{o.docType === "bid_draft" ? <div className="px-3 pb-2"><BidDraftGateNotes gates={draftGates} /></div> : null}') && menu.includes("apiJson<{ gates?: BidDraftGates }>(`/api/projects/${projectId}/bid-draft`).then((r) => setDraftGates(r.gates))") && !/disabled=\{[^}]*draftGates/.test(menu));
  }

  console.log("「下一步」卡片指向询价时");
  {
    const { rfqEntryReasons } = await import("@/lib/tender-next-step/web-next-step");
    ok("入口可用、不投：先列不投的提醒，再列「点问供应商要价」", JSON.stringify(rfqEntryReasons({ rfqEntry: { enabled: true, messageZh: "", noGoZh: "投标决定是不投" } })) === JSON.stringify(["投标决定是不投", "点「问供应商要价」：按已确认的要求起草，发出前要你批准"]));
    ok("入口不可用、不投：同样先列提醒", rfqEntryReasons({ rfqEntry: { enabled: false, messageZh: "还没有确认的要求", noGoZh: "投标决定是不投" } })[0] === "投标决定是不投");
    ok("没有提醒（开关关、不是不投、没传）：与原来相同", JSON.stringify(rfqEntryReasons({ rfqEntry: { enabled: true, messageZh: "" } })) === JSON.stringify(["点「问供应商要价」：按已确认的要求起草，发出前要你批准"]) && JSON.stringify(rfqEntryReasons({ rfqEntry: { enabled: true, messageZh: "", noGoZh: null } })) === JSON.stringify(rfqEntryReasons({ rfqEntry: { enabled: true, messageZh: "" } })));
    ok("下一步取数：把入口返回的那条提醒交给卡片", read("src/lib/tender-next-step/service.ts").includes("rfqEntry: { enabled: entry.state.enabled, messageZh: entry.state.message, noGoZh: entry.decisionNoGoZh ?? null }"));
  }

  console.log("接线");
  {
    const gen = read("src/lib/projects/generate/generate-docs.ts");
    ok("生成文件：投标文件起草走 buildBidDraftDocument（行为由隔离库测试用假的合成走一遍）", gen.includes("htmlOverride = await buildBidDraftDocument({ projectId: project.id, orgId: input.orgId, userId: input.userId });") && !gen.includes("synthesizeBidDraft("));
    const gather = read("src/lib/tender-bid-draft/gather.ts");
    ok("取数：所用分析的状态与起草取的是同一行", gather.includes("select: { id: true, status: true, summaryJson: true },") && gather.includes('basisOut.current = { runId: run.id, approved: run.status === "APPROVED" };'));
    ok("提示词不变：合成只拿起草的输入", !read("src/lib/tender-bid-draft/synthesize.ts").includes("basis"));
    const entry = read("src/lib/tender-rfq/web-entry.ts");
    ok("询价入口：开关开着、这个组织这个项目的决定是 NO_GO 时多一条提醒并单独返回；入口可用与否照旧", entry.includes('where: { projectId: project.id, orgId: input.orgId, goDecision: "NO_GO" }') && entry.includes("const state = decisionNoGoZh ? { ...baseState, warnings: [...baseState.warnings, decisionNoGoZh] } : baseState;") && entry.includes("...(decisionNoGoZh ? { decisionNoGoZh } : {}),") && entry.includes("const noGo = isDecisionGatesEnabledForOrg(input.orgId)"));
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
