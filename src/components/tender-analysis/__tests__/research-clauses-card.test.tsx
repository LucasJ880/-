/**
 * TREE-3 招标要求页「标书条款（调研树）」卡片：各状态渲染出来的文字（服务端静态渲染，无浏览器 / 无 DB），
 * 以及接口回应 → 显示不显示（404 / 读取中 / 出错 / 没有调研树都不显示）。
 * 运行：npx tsx src/components/tender-analysis/__tests__/research-clauses-card.test.tsx
 */
import assert from "node:assert/strict";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  RESEARCH_CLAUSES_TEXT,
  ResearchClausesCard,
  ResearchClausesPanel,
  clausesCardStateOf,
  keepOnError,
  shouldPollClauses,
  startedAtZh,
  visibleClausesOf,
} from "../research-clauses-card";
import { CLAUSE_CLARIFICATIONS, notStatedFindings, verifyClauseDecision, findClauseSnippets } from "@/lib/tender-research-tree/clauses";
import type { ResearchClausesView, ResearchTreeView } from "@/lib/tender-research-tree/view";

let passed = 0;
function ok(name: string, cond: boolean, detail?: unknown) {
  assert.equal(cond, true, detail === undefined ? name : `${name}\n${typeof detail === "string" ? detail : JSON.stringify(detail, null, 2)}`);
  passed += 1;
  console.log(`  ✓ ${name}`);
}
const text = (m: string) => m.replace(/<!--.*?-->/g, "").replace(/<[^>]+>/g, "").replace(/&quot;/g, '"').replace(/&#x27;/g, "'");
const panel = (clauses: ResearchClausesView) => text(renderToStaticMarkup(<ResearchClausesPanel clauses={clauses} />));

const snips = findClauseSnippets([
  { documentId: "d1", documentTitle: "RFP-24062-27-057.pdf", pageNumber: 7, unitKind: "page", unitLabel: null, text: "Equivalent products will be considered provided that product data sheets are submitted." },
  { documentId: "d1", documentTitle: "RFP-24062-27-057.pdf", pageNumber: 9, unitKind: "page", unitLabel: null, text: "Brand X model 12. No substitutes will be accepted." },
]);
const stats = { documentCount: 1, pagesWithText: 2, scannedPages: 0, snippetCount: snips.length };
const s7 = snips.find((s) => s.pageNumber === 7)!.id;
const s9 = snips.find((s) => s.pageNumber === 9)!.id;
const found = verifyClauseDecision(
  {
    local_content: { answer: "not_stated", citations: [] },
    brand: { answer: "specified", citations: [{ snippet: s9, excerpt: "Brand Z is the only acceptable product" }] },
    equivalents: { answer: "accepted", citations: [{ snippet: s7, excerpt: "Equivalent products will be considered" }], proof: { snippet: s7, excerpt: "product data sheets are submitted" } },
  },
  snips,
  stats,
);

console.log("查完");
{
  const m = panel({ state: "done", status: "found", statusZh: "写明了 1 项", reasonZh: "在 1 份标书的 2 页里找到 2 段相关条款", messagesZh: [], findings: found });
  ok("短标签与理由", m.includes("写明了 1 项") && m.includes("找到 2 段相关条款"));
  ok("三问都在", m.includes(RESEARCH_CLAUSES_TEXT.questions.local_content) && m.includes(RESEARCH_CLAUSES_TEXT.questions.brand) && m.includes(RESEARCH_CLAUSES_TEXT.questions.equivalents));
  ok("接受等效品，带文件名与第 7 页、原文", m.includes("接受等效品") && m.includes("RFP-24062-27-057.pdf · 第 7 页") && m.includes("Equivalent products will be considered"), m);
  ok("出处对不上的写明", m.includes(RESEARCH_CLAUSES_TEXT.downgraded));
  ok("等效品要交的证明，挂在等效品那一问下面", m.includes(RESEARCH_CLAUSES_TEXT.proofTitle) && m.includes("product data sheets are submitted") && m.indexOf(RESEARCH_CLAUSES_TEXT.proofTitle) > m.indexOf("接受等效品"));
  ok("品牌一问的措辞", m.includes(RESEARCH_CLAUSES_TEXT.questions.brand) && m.includes("是否限定品牌（不接受替代）"));
  ok("未写明的两问有澄清草稿，写明系统不会自动发出、指向正式澄清", m.includes(CLAUSE_CLARIFICATIONS.local_content.en) && m.includes(CLAUSE_CLARIFICATIONS.brand.en) && !m.includes(CLAUSE_CLARIFICATIONS.equivalents.en) && m.includes("系统不会自动发出") && m.includes("正式澄清（RFI）") && m.includes(`意思：${CLAUSE_CLARIFICATIONS.brand.zh}`));
  ok("没有内部说法（条款员、模型、三问、TREE）", !/条款员|模型|三问|TREE-|这一支/.test(m), m);
  const raw = renderToStaticMarkup(<ResearchClausesPanel clauses={{ state: "done", status: "found", statusZh: "写明了 1 项", reasonZh: null, messagesZh: [], findings: found }} />);
  ok("只读：没有按钮、输入框或表单", !/<button|<input|<textarea|<form/.test(raw));
}

console.log("都未写明 / 未接通 / 在查");
{
  const none = panel({ state: "done", status: "none", statusZh: "都未写明", reasonZh: "关键词规则在 1 份标书的 3 页里没有命中，没有请求模型", messagesZh: ["三问在标书里都没有写明，已给澄清问题草稿"], findings: notStatedFindings(stats) });
  ok("都未写明：三条草稿", none.includes("都未写明") && Object.values(CLAUSE_CLARIFICATIONS).every((c) => none.includes(c.en)));
  const un = panel({ state: "done", status: "unavailable", statusZh: "未接通", reasonZh: null, messagesZh: ["未接通：项目里还没有解析好的标书文件，没法查条款"], findings: null });
  ok("未接通：写原因句，没有答案与草稿", un.includes("未接通") && un.includes("没有解析好的标书文件") && !un.includes("澄清问题草稿"));
  ok("在查：正在查标书条款", panel({ state: "pending" }).includes(RESEARCH_CLAUSES_TEXT.pending));
  ok("未接通时只写原因句，不重复「未接通」短标签", (un.match(/未接通/g) ?? []).length === 1, un);
  const stopped = panel({ state: "stopped", messageZh: "这次调研没有跑完，标书条款没有查完" });
  ok("调研停下了：写原因，不说在查", stopped.includes("没有跑完") && !stopped.includes(RESEARCH_CLAUSES_TEXT.pending));
  const conflictView = verifyClauseDecision(
    {
      local_content: { answer: "not_stated", citations: [] },
      brand: { answer: "specified", citations: [{ snippet: s9, excerpt: "No substitutes will be accepted" }] },
      equivalents: { answer: "accepted", citations: [{ snippet: s7, excerpt: "Equivalent products will be considered" }] },
    },
    snips,
    stats,
  );
  const cm = panel({ state: "done", status: "found", statusZh: "写明了 2 项", reasonZh: null, messagesZh: [], findings: conflictView });
  ok("限定品牌与接受等效品同时成立：提示看原文", cm.includes(RESEARCH_CLAUSES_TEXT.conflict));
  const stamped = text(renderToStaticMarkup(<ResearchClausesPanel clauses={{ state: "pending" }} startedAt="2026-11-23T10:05:00.000Z" />));
  ok("显示调研发起时间", stamped.includes(RESEARCH_CLAUSES_TEXT.startedAt) && /2026-11-23 \d{2}:05/.test(stamped), stamped);
  ok("发起时间读不出就不显示", startedAtZh("not a date") === null && startedAtZh(null) === null);
}

console.log("显示不显示");
{
  const tree: ResearchTreeView = { job: { id: "j1", status: "running", createdAt: "t" }, clauses: { state: "pending" } };
  ok("404（开关关）→ 不显示", visibleClausesOf(clausesCardStateOf(404, null)) === null && clausesCardStateOf(404, null).kind === "hidden");
  ok("500 → 不显示", visibleClausesOf(clausesCardStateOf(500, null)) === null);
  ok("读取中 → 不显示", visibleClausesOf({ kind: "loading" }) === null);
  ok("还没有调研树 → 不显示", visibleClausesOf(clausesCardStateOf(200, { job: null, clauses: null })) === null);
  ok("有树 → 显示", visibleClausesOf(clausesCardStateOf(200, tree))?.state === "pending");
  ok("首屏（读取中）什么都不渲染", renderToStaticMarkup(<ResearchClausesCard projectId="p1" />) === "");
  ok("在查时要再读；查完、停下、404 不再读", shouldPollClauses(clausesCardStateOf(200, tree)) && !shouldPollClauses(clausesCardStateOf(200, { ...tree, clauses: { state: "stopped", messageZh: "x" } })) && !shouldPollClauses(clausesCardStateOf(404, null)));
  const okState = clausesCardStateOf(200, tree);
  ok("重读时出错：保留上一次读到的（卡片不一闪消失）；第一次就出错 → 不显示", keepOnError(okState, { kind: "error" }) === okState && keepOnError({ kind: "loading" }, { kind: "error" }).kind === "error" && keepOnError(okState, { kind: "hidden" }).kind === "hidden");
}

console.log(`\n结果: ${passed} 通过, 0 失败`);
