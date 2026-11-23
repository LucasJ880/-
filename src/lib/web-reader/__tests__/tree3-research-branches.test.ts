/**
 * TREE-3 三个子代理：条款员、往期同标员（联邦合同公开数据一步）、同类项目员的授标记录
 * （假搜索 / 假模型 / 假联邦数据 / TREE-1 真读页层 + 假网络 / 内存游标）。
 * 无 DB、无外网：npx tsx src/lib/web-reader/__tests__/tree3-research-branches.test.ts
 */

import type { AdapterContext } from "@/lib/agent-runtime-v2/adapters";
import { LostLeaseError, type RunFence } from "@/lib/agent-runtime/lease";
import { readPublicPage } from "@/lib/web-reader";
import type { LlmCallRequest } from "@/lib/tender-understanding/llm";
import type { TavilyDetailedResult } from "@/lib/tender-intel/tavily-client";
import { html, makeWorld, openSession, RESEARCH_JOB, type World } from "./fake-world";
import { runResearchBranch, type BranchRunDeps } from "@/lib/tender-research-tree/branch-run";
import { summarizeTree } from "@/lib/tender-research-tree/trunk";
import type { OpenDataResult, RequirementFactsRow, ResearchProjectRow, ResearchStore, TenderPagesRow, CursorRow, CursorWrite } from "@/lib/tender-research-tree/deps";
import { RESEARCH_STEP_IDS, TEXT_ZH } from "@/lib/tender-research-tree/fork-rules";
import { RESEARCH_CLAUSES_PROMPT_VERSION } from "@/lib/tender-research-tree/clauses";
import type { OpenDataRow } from "@/lib/tender-research-tree/awards";
import type { ResearchHandoffV1 } from "@/lib/tender-research-tree/types";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail).slice(0, 2000) : "");
  }
}

const ORG = "org1";
const JOB = "job1";
const META = { ...(RESEARCH_JOB.metadata as Record<string, unknown>), researchProjectId: "p1" };
const PROJECT: ResearchProjectRow = {
  id: "p1",
  orgId: ORG,
  workDomain: "tender",
  name: "Office Chairs Replacement",
  clientOrganization: "Treasury Board of Canada Secretariat",
  solicitationNumber: "24062-27-057",
  location: "Ottawa",
  category: "Furniture",
  closeDate: new Date("2026-12-01T00:00:00Z"),
  estimatedValue: 987654,
  ourBidPrice: 876543,
  winningBidPrice: null,
};
const ENV_ON = { TENDER_RESEARCH_TREE_ENABLED: "1", TENDER_EXTERNAL_INTEL_ENABLED: "1", TAVILY_API_KEY: "test-key" };
const NO_PAGES: TenderPagesRow = { documentCount: 0, emptyDocumentCount: 0, scannedPages: 0, pages: [] };

type Harness = {
  world: World;
  rows: CursorWrite[];
  prompts: LlmCallRequest[];
  invokerVersions: Array<string | undefined>;
  searches: string[];
  openDataQueries: string[];
  storeCalls: string[];
  deps: BranchRunDeps;
  ctx: (stepKey: string, over?: Partial<AdapterContext>) => AdapterContext;
};

function makeHarness(opts: {
  decide?: (i: number, req: LlmCallRequest) => unknown;
  search?: (q: string) => TavilyDetailedResult;
  openData?: (q: string) => OpenDataResult;
  pages?: TenderPagesRow;
  req?: RequirementFactsRow;
  env?: Record<string, string | undefined>;
  settings?: unknown;
  project?: ResearchProjectRow;
  rows?: CursorWrite[];
}): Harness {
  const world = makeWorld();
  const rows: CursorWrite[] = opts.rows ?? [];
  const prompts: LlmCallRequest[] = [];
  const invokerVersions: Array<string | undefined> = [];
  const searches: string[] = [];
  const openDataQueries: string[] = [];
  const storeCalls: string[] = [];
  let callIndex = 0;
  let offset = 0;
  const now = () => world.now() + offset;
  const store: ResearchStore = {
    loadJob: async (id) => (storeCalls.push("loadJob"), { id, orgId: ORG, status: "running", metadata: META }),
    loadProject: async () => (storeCalls.push("loadProject"), opts.project ?? PROJECT),
    loadOrgSettings: async () => (storeCalls.push("loadOrgSettings"), opts.settings ?? null),
    loadCursorRows: async (_o, _j, take) => {
      storeCalls.push("loadCursorRows");
      const out: CursorRow[] = rows.map((r) => ({ branchKey: r.branchKey, seq: r.seq, kind: r.kind, data: JSON.parse(JSON.stringify(r.data)) }));
      return out.slice(0, take);
    },
    writeCursorRow: async (_c, row) => {
      storeCalls.push(`write:${row.kind}`);
      rows.push(JSON.parse(JSON.stringify(row)));
    },
    writeRoomSummary: async () => (storeCalls.push("writeRoomSummary"), true),
    loadTenderPages: async () => (storeCalls.push("loadTenderPages"), opts.pages ?? NO_PAGES),
    loadRequirementFacts: async () => (storeCalls.push("loadRequirementFacts"), opts.req ?? { quantity: null, contractDays: null }),
  };
  const deps: BranchRunDeps = {
    store,
    external: {
      now,
      env: opts.env ?? ENV_ON,
      search: async (q) => {
        searches.push(q);
        return opts.search ? opts.search(q) : { status: "EMPTY", hits: [], httpStatus: 200 };
      },
      openData: async (q) => {
        openDataQueries.push(q);
        return opts.openData ? opts.openData(q) : { ok: true, rows: [], note: null };
      },
      invokerFor: (input) => {
        invokerVersions.push(input.promptVersion);
        return async (req) => {
          prompts.push(req);
          const i = callIndex++;
          offset += 1_000;
          const d = opts.decide ? opts.decide(i, req) : { next: { action: "finish" } };
          if (d instanceof Error) throw d;
          return { content: typeof d === "string" ? d : JSON.stringify(d), model: "fake-model", elapsedMs: 1 };
        };
      },
      openReadSession: async () => openSession(world, { job: { ...RESEARCH_JOB, metadata: META } }),
      readPage: (url, c) => readPublicPage(url, c),
    },
  };
  const fence: RunFence = {
    runId: JOB,
    check: async () => true,
    guard: async (fn) => fn({} as never),
  };
  const ctx = (stepKey: string, over: Partial<AdapterContext> = {}): AdapterContext =>
    ({
      orgId: ORG,
      userId: "u1",
      role: "admin",
      runId: JOB,
      stepKey,
      operationKey: `op:${stepKey}`,
      priorEvidence: {},
      runFence: fence,
      executionBudget: { deadlineAt: now() + 240_000, tickBudgetMs: 240_000 },
      ...over,
    }) as AdapterContext;
  return { world, rows, prompts, invokerVersions, searches, openDataQueries, storeCalls, deps, ctx };
}

function handoffOf(r: { ok: boolean; data?: Record<string, unknown> }): ResearchHandoffV1 {
  return (r.data?.researchHandoff ?? null) as ResearchHandoffV1;
}

const filler = "General terms and conditions apply to this solicitation. ".repeat(12);
function tenderPages(texts: Array<[number, string]>): TenderPagesRow {
  return {
    documentCount: 1,
    emptyDocumentCount: 0,
    scannedPages: 0,
    pages: texts.map(([n, t]) => ({ documentId: "doc1", documentTitle: "RFP-24062-27-057.pdf", pageNumber: n, unitKind: "page", unitLabel: null, text: t })),
  };
}
const EQUIV_PAGE7 = `${filler} 7.3 Equivalent Products. Equivalent products will be considered provided that product data sheets are submitted with the bid. ${filler}`;

async function main() {
  /* ── 条款员 ── */
  console.log("\n[条款员]");
  {
    const pages = tenderPages([
      [3, filler],
      [7, EQUIV_PAGE7],
    ]);
    const h = makeHarness({
      pages,
      decide: (_i, req) => {
        const sid = /\[(S\d+)\]/.exec(req.userPrompt)?.[1] ?? "S1";
        return {
          local_content: { answer: "not_stated", citations: [] },
          brand: { answer: "not_stated", citations: [] },
          equivalents: {
            answer: "accepted",
            citations: [{ snippet: sid, excerpt: "Equivalent products will be considered" }],
            proof: { snippet: sid, excerpt: "product data sheets are submitted with the bid" },
          },
        };
      },
    });
    const r = await runResearchBranch(h.ctx(RESEARCH_STEP_IDS.clauses), h.deps);
    const ho = handoffOf(r);
    const eq = ho.clauses?.questions.find((q) => q.key === "equivalents");
    ok(ho.status === "found" && ho.statusZh === "写明了 1 项" && eq?.answerZh === "接受等效品", "含 Equivalent Products 条款 → 接受等效品", ho);
    ok(eq?.citations[0]?.pageLabelZh === "第 7 页" && eq.citations[0].documentTitle === "RFP-24062-27-057.pdf", "引文带文件名与「第 7 页」", eq);
    ok(ho.clauses?.proof?.excerpt.includes("data sheets") === true, "等效证明");
    ok(ho.clauses!.questions.filter((q) => q.clarification).length === 2, "另两问未写明，各一条澄清草稿");
    ok(h.prompts.length === 1 && h.invokerVersions[0] === RESEARCH_CLAUSES_PROMPT_VERSION && ho.usage.modelCalls === 1, "一次模型请求（条款员的提示词版本）", { p: h.prompts.length, v: h.invokerVersions });
    ok(h.searches.length + h.openDataQueries.length + h.world.log.length === 0 && ho.usage.searches === 0 && ho.usage.reads === 0, "不联网：搜索、联邦数据、读页都是 0");
    ok(JSON.stringify(h.rows.map((x) => x.kind)) === JSON.stringify(["model_call", "decision", "finish"]), "游标：先记请求、再记结论、交单", h.rows.map((x) => x.kind));
    ok(/<untrusted>/.test(h.prompts[0]!.userPrompt) && h.prompts[0]!.userPrompt.includes("Equivalent products will be considered") && !h.prompts[0]!.userPrompt.includes("第 7 页"), "段落放在不可信块里，提示里不给页码");
    ok(!JSON.stringify(h.rows).includes("General terms and conditions"), "审计里没有标书正文");
    // 已交单再执行：原样交回，不再请求
    const again = handoffOf(await runResearchBranch(h.ctx(RESEARCH_STEP_IDS.clauses), h.deps));
    ok(h.prompts.length === 1 && JSON.stringify(again) === JSON.stringify(ho), "已交单再执行：原样交回，不再请求模型");
  }
  {
    const h = makeHarness({ pages: tenderPages([[1, filler], [2, "The supplier shall deliver 500 chairs to Ottawa."]]) });
    const ho = handoffOf(await runResearchBranch(h.ctx(RESEARCH_STEP_IDS.clauses), h.deps));
    ok(
      ho.status === "none" && ho.statusZh === "都未写明" && h.prompts.length === 0 && ho.clauses!.questions.every((q) => q.answer === "not_stated" && q.clarification) && /没有命中，没有请求模型/.test(String(ho.reasonZh)),
      "两种条款都没有 → 未写明 + 澄清草稿，模型请求为 0",
      ho,
    );
  }
  {
    const h = makeHarness({});
    const ho = handoffOf(await runResearchBranch(h.ctx(RESEARCH_STEP_IDS.clauses), h.deps));
    ok(ho.status === "unavailable" && ho.notFound[0]?.messageZh === TEXT_ZH.clausesNoDocs && ho.clauses === null && h.prompts.length === 0, "没有标书 → 未接通");
    const h2 = makeHarness({ pages: { documentCount: 0, emptyDocumentCount: 1, scannedPages: 12, pages: [] } });
    const ho2 = handoffOf(await runResearchBranch(h2.ctx(RESEARCH_STEP_IDS.clauses), h2.deps));
    ok(ho2.notFound[0]?.messageZh === TEXT_ZH.clausesScannedOnly && h2.prompts.length === 0, "都是扫描件 → 未接通（没有文字可查）");
  }
  {
    const h = makeHarness({ pages: tenderPages([[7, EQUIV_PAGE7]]), decide: () => "this is not json" });
    const ho = handoffOf(await runResearchBranch(h.ctx(RESEARCH_STEP_IDS.clauses), h.deps));
    ok(ho.status === "unavailable" && ho.notFound[0]?.messageZh === TEXT_ZH.clausesModelFailed && ho.clauses === null && h.prompts.length === 2 && ho.usage.modelCalls === 1, "格式不对（两次尝试）→ 未接通，不交任何答案与草稿", { ho, p: h.prompts.length });
    const h2 = makeHarness({ pages: tenderPages([[7, EQUIV_PAGE7]]), decide: () => ({ local_content: { answer: "maybe" }, brand: {}, equivalents: {} }) });
    const ho2 = handoffOf(await runResearchBranch(h2.ctx(RESEARCH_STEP_IDS.clauses), h2.deps));
    ok(ho2.status === "unavailable" && ho2.clauses === null, "答案不在枚举里 → 过不了结构校验 → 未接通");
  }
  {
    // 请求过一次、没交单就中断：续跑不再请求
    const rows: CursorWrite[] = [{ orgId: ORG, userId: "u1", jobId: JOB, branchKey: RESEARCH_STEP_IDS.clauses, seq: 0, kind: "model_call", data: { turn: 1, at: 1 } }];
    const h = makeHarness({ rows, pages: tenderPages([[7, EQUIV_PAGE7]]), decide: () => ({}) });
    const ho = handoffOf(await runResearchBranch(h.ctx(RESEARCH_STEP_IDS.clauses), h.deps));
    ok(ho.status === "unavailable" && ho.notFound[0]?.messageZh === TEXT_ZH.clausesModelUsed && h.prompts.length === 0, "请求过一次后续跑：不再请求模型，交未接通", ho);
  }
  {
    const h = makeHarness({ pages: tenderPages([[7, EQUIV_PAGE7]]), decide: () => ({}) });
    const r = await runResearchBranch(h.ctx(RESEARCH_STEP_IDS.clauses, { executionBudget: { deadlineAt: h.deps.external.now() + 60_000, tickBudgetMs: 60_000 } }), h.deps);
    ok(r.ok && "continuation" in r && !!r.continuation && h.prompts.length === 0 && h.rows.length === 0, "剩余时间不够一次请求：先让出，不记请求、不请求", r);
  }
  {
    const h = makeHarness({ pages: tenderPages([[7, EQUIV_PAGE7]]), settings: { researchTree: { limits: { modelCallsPerBranch: 0 } } }, decide: () => ({}) });
    const ho = handoffOf(await runResearchBranch(h.ctx(RESEARCH_STEP_IDS.clauses), h.deps));
    ok(ho.status === "limit" && h.prompts.length === 0, "组织把模型请求调到 0：不请求，交到上限", ho);
  }
  {
    const h = makeHarness({ env: { TENDER_RESEARCH_TREE_ENABLED: "0" }, pages: tenderPages([[7, EQUIV_PAGE7]]) });
    const ho = handoffOf(await runResearchBranch(h.ctx(RESEARCH_STEP_IDS.clauses), h.deps));
    ok(ho.status === "flag_off" && h.storeCalls.length === 0 && h.prompts.length === 0, "开关关：条款员不读标书、不请求", h.storeCalls);
  }

  /* ── 往期同标：联邦合同公开数据 ── */
  console.log("\n[往期同标员：先查联邦合同公开数据]");
  const row = (vendor: string, value: number, date: string, owner: string, ref: string): OpenDataRow => ({
    vendorName: vendor,
    descriptionEn: "Supply of office chairs",
    contractValue: value,
    contractDate: date,
    buyerName: null,
    ownerOrg: owner,
    referenceNumber: ref,
    sourceUrl: "https://open.canada.ca/data/en/api/3/action/datastore_search?resource_id=x&q=Office%20Chairs",
  });
  const FED: OpenDataResult = {
    ok: true,
    note: null,
    rows: [
      row("CHAIRCO LTD", 230000, "2023-04-01", "Treasury Board of Canada Secretariat", "R-2023-1"),
      row("SEATING INC", 180000, "2021-06-01", "Treasury Board of Canada Secretariat", "R-2021-9"),
      row("OTHER FURNITURE", 99000, "2024-01-01", "Fisheries and Oceans Canada", "R-2024-3"),
    ],
  };
  {
    const h = makeHarness({ openData: () => FED, decide: () => ({ next: { action: "finish" } }) });
    const ho = handoffOf(await runResearchBranch(h.ctx(RESEARCH_STEP_IDS.priorAwards), h.deps));
    const recs = ho.records ?? [];
    ok(recs.length === 2 && recs.every((r) => r.source === "open_data" && r.currency === "CAD" && r.referenceNumber), "同一采购方的 2 行转成来自联邦数据的记录", recs.map((r) => [r.fields.winner?.value, r.referenceNumber]));
    ok(ho.status === "found" && ho.statusZh === "查到 2 条", "交单：查到 2 条（记录数）", ho.statusZh);
    ok(h.openDataQueries.length === 2 && ho.usage.searches === 2 && h.searches.length === 0, "两个检索词各算一次搜索（模型说结束，没有网页搜索）", { q: h.openDataQueries, u: ho.usage });
    ok(h.openDataQueries.some((q) => q.includes("Office Chairs")) && h.openDataQueries.every((q) => !/987654|876543/.test(q)), "检索词来自项目名与采购方");
    const first = h.prompts[0]!.userPrompt;
    ok(first.includes("联邦合同公开数据") && first.includes("OTHER FURNITURE") && /<untrusted>[\s\S]*CHAIRCO LTD[\s\S]*<\/untrusted>/.test(first), "全部行作为不可信资料交给模型（含不同采购方的那行）");
    const kinds = h.rows.map((x) => x.kind);
    ok(JSON.stringify(kinds.slice(0, 4)) === JSON.stringify(["search_sent", "open_data_result", "search_sent", "open_data_result"]) && kinds[4] === "model_call", "游标：联邦数据先记后查，都在第一次模型请求之前", kinds);
    // 续跑：不再查联邦数据，记录还在
    const rows2 = h.rows.filter((x) => x.kind !== "finish" && x.kind !== "model_call" && x.kind !== "decision");
    const h2 = makeHarness({ rows: rows2, openData: () => FED, decide: () => ({ next: { action: "finish" } }) });
    const ho2 = handoffOf(await runResearchBranch(h2.ctx(RESEARCH_STEP_IDS.priorAwards), h2.deps));
    ok(h2.openDataQueries.length === 0 && (ho2.records ?? []).length === 2 && ho2.usage.searches === 2, "续跑：联邦数据不再查，记录从游标恢复", { q: h2.openDataQueries, n: ho2.records?.length });
    ok(h2.prompts[0]!.userPrompt.includes("CHAIRCO LTD"), "续跑的第一次模型请求仍看得到联邦数据的行");
  }
  {
    const h = makeHarness({ settings: { researchTree: { limits: { searchesPerBranch: 2 } } }, openData: () => FED, search: () => ({ status: "EMPTY", hits: [], httpStatus: 200 }), decide: () => ({ next: { action: "search", query: "chair award" } }) });
    const ho = handoffOf(await runResearchBranch(h.ctx(RESEARCH_STEP_IDS.priorAwards), h.deps));
    ok(h.searches.length === 0 && ho.usage.searches === 2 && (ho.records ?? []).length === 2, "每支搜索额度 2、联邦数据用了 2 次：网页搜索一次都不发", { s: h.searches, u: ho.usage });
  }
  {
    const p = { ...PROJECT, name: "Budget Office Chairs", clientOrganization: null };
    const h = makeHarness({ project: p, openData: () => FED, decide: () => ({ next: { action: "finish" } }) });
    const ho = handoffOf(await runResearchBranch(h.ctx(RESEARCH_STEP_IDS.priorAwards), h.deps));
    ok(h.openDataQueries.length === 0 && !JSON.stringify(h.rows).includes("Budget") && ho.reasonZh === TEXT_ZH.openDataBlocked, "检索词带敏感词：不发、不记审计，理由写明", { q: h.openDataQueries, r: ho.reasonZh });
  }
  {
    const h = makeHarness({ env: { ...ENV_ON, TENDER_EXTERNAL_INTEL_ENABLED: "0" }, openData: () => FED });
    const ho = handoffOf(await runResearchBranch(h.ctx(RESEARCH_STEP_IDS.priorAwards), h.deps));
    ok(h.openDataQueries.length === 0 && ho.reasonZh === TEXT_ZH.openDataOff && ho.status === "unavailable", "外部情报开关没开：联邦数据不查，理由写明", ho);
  }
  {
    const h = makeHarness({ openData: () => ({ ok: false, rows: [], note: "数据源返回 HTTP 503" }), decide: () => ({ next: { action: "finish" } }) });
    const ho = handoffOf(await runResearchBranch(h.ctx(RESEARCH_STEP_IDS.priorAwards), h.deps));
    ok((ho.records ?? []).length === 0 && h.prompts.length === 1 && ho.status === "none", "联邦数据出错：照常往下查（没有记录）", ho);
  }
  {
    const h = makeHarness({ project: { ...PROJECT, name: "办公椅采购", clientOrganization: "示例部门" }, openData: () => FED, decide: () => ({ next: { action: "finish" } }) });
    const ho = handoffOf(await runResearchBranch(h.ctx(RESEARCH_STEP_IDS.priorAwards), h.deps));
    ok(h.openDataQueries.length === 0 && ho.reasonZh === TEXT_ZH.openDataNoQuery, "项目名没有英文检索词：不查，理由写明");
  }

  /* ── 同类项目员：记录、单价、可比度 ── */
  console.log("\n[同类项目员：授标记录]");
  const A = "https://www.example-city.ca/awards/2024-chairs";
  const AWARDS_PAGE =
    "<html><body><h1>Awards</h1>" +
    "<p>Lot 1: The City of Example awarded RFT-2024-12 to Chairco Ltd. Total value: $230,000.00 for 10,000 office chairs, delivery included.</p>" +
    "<p>Lot 2: The Town of Other awarded RFT-2024-30 to Seating Inc. Total value: US$200,000 for 8,000 office chairs.</p>" +
    "<p>" + "Background text. ".repeat(30) + "</p></body></html>";
  const HITS: TavilyDetailedResult = { status: "SUCCESS", httpStatus: 200, hits: [{ title: "2024 chair awards", url: A, snippet: "awards" }] };
  {
    const h = makeHarness({
      search: () => HITS,
      req: { quantity: 20000, contractDays: 1095 },
      decide: (i) =>
        [
          { next: { action: "search", query: "office chairs contract award Canada 2024" } },
          { next: { action: "read", url: A } },
          {
            facts: [
              { factType: "award_amount", value: "$230,000.00", excerpt: "Total value: $230,000.00 for 10,000 office chairs", group: "a1" },
              { factType: "quantity", value: "10,000", excerpt: "Total value: $230,000.00 for 10,000 office chairs", group: "a1" },
              { factType: "scope_basis", value: "freight", excerpt: "10,000 office chairs, delivery included", group: "a1" },
              { factType: "award_amount", value: "US$200,000", excerpt: "Total value: US$200,000 for 8,000 office chairs", group: "a2" },
              { factType: "quantity", value: "8,000", excerpt: "Total value: US$200,000 for 8,000 office chairs", group: "a2" },
            ],
            next: { action: "finish" },
          },
        ][i],
    });
    h.world.handlers.set(A, () => html(AWARDS_PAGE));
    const ho = handoffOf(await runResearchBranch(h.ctx(RESEARCH_STEP_IDS.similar), h.deps));
    const recs = ho.records ?? [];
    ok(recs.length === 2 && ho.statusZh === "查到 2 条", "同一页两组 → 两条记录", recs.map((r) => r.fields));
    ok(recs[0]!.unitPrice === "23.00" && recs[0]!.currency === "CAD" && recs[0]!.currencyBasis === "site", "第一条：单价 23.00、币种按网站推断 CAD", recs[0]);
    ok(recs[1]!.unitPrice === "25.00" && recs[1]!.currency === "USD" && recs[1]!.currencyBasis === "stated", "第二条：单价 25.00、写明 USD（不换汇）", recs[1]);
    ok(JSON.stringify(recs[0]!.basis) === '["freight"]' && recs[1]!.basis.length === 0, "口径：含运费 / 不明");
    ok(recs[0]!.comparability.quantityInRange === "yes" && recs[0]!.comparability.recent === "unknown", "可比度：数量相近按项目的 20000 算", recs[0]!.comparability);
    ok(h.prompts.every((p) => p.userPrompt.includes("数量：20000") && p.userPrompt.includes("合同期（天）：1095")), "交给模型的项目资料有数量与合同期");
    ok(h.prompts.every((p) => !/987654|876543/.test(p.userPrompt)), "提示里仍没有估值与我方报价");
    const summary = summarizeTree({ jobId: JOB, startedAt: null, finishedAt: "t", priorEvidence: { research_similar: { researchHandoff: ho } } });
    const json = JSON.stringify(summary);
    ok(summary.branches[2]!.recordCount === 2 && !/23\.00|25\.00|230,000|200,000|https?:/.test(json), "树干摘要：记录数，没有单价、金额与网址", json.slice(0, 300));
  }
  {
    const h = makeHarness({
      search: () => HITS,
      decide: (i) =>
        [
          { next: { action: "search", query: "office chairs award" } },
          { next: { action: "read", url: A } },
          { facts: [{ factType: "buyer", value: "City of Example", excerpt: "The City of Example awarded RFT-2024-12" }], next: { action: "finish" } },
        ][i],
    });
    h.world.handlers.set(A, () => html(AWARDS_PAGE));
    const ho = handoffOf(await runResearchBranch(h.ctx(RESEARCH_STEP_IDS.similar), h.deps));
    ok(ho.status === "none" && ho.found.length === 1 && (ho.records ?? []).length === 0 && ho.notFound[0]?.messageZh === TEXT_ZH.noneScattered, "只收下了采购方名：没查到，原因句写只有零散事实", ho);
  }
  {
    const h = makeHarness({
      search: () => HITS,
      decide: (i) =>
        i === 0
          ? { next: { action: "search", query: "office chairs award" } }
          : i === 1
            ? { next: { action: "read", url: A } }
            : i === 2
              ? {
                  facts: [
                    { factType: "award_amount", value: "$230,000.00", excerpt: "Total value: $230,000.00 for 10,000 office chairs" },
                    { factType: "quantity", value: "10,000", excerpt: "Total value: $230,000.00 for 10,000 office chairs" },
                  ],
                  next: { action: "search", query: "more chair awards" },
                }
              : "not json",
    });
    h.world.handlers.set(A, () => html(AWARDS_PAGE));
    const ho = handoffOf(await runResearchBranch(h.ctx(RESEARCH_STEP_IDS.similar), h.deps));
    ok(ho.status === "found" && (ho.records ?? []).length === 1 && ho.found.length === 2 && ho.usage.modelCalls === 6, "之后模型连续 3 次格式不对：不收那几轮的东西，已核对的记录照常交回", { s: ho.status, n: ho.records?.length, u: ho.usage });
  }
  {
    const h = makeHarness({
      search: () => HITS,
      decide: (i) =>
        [
          { next: { action: "search", query: "office chairs award" } },
          { next: { action: "read", url: A } },
          { facts: [{ factType: "currency", value: "CAD", excerpt: "Total value: US$200,000 for 8,000 office chairs" }, { factType: "scope_basis", value: "installation", excerpt: "10,000 office chairs, delivery included" }], next: { action: "finish" } },
        ][i],
    });
    h.world.handlers.set(A, () => html(AWARDS_PAGE));
    const ho = handoffOf(await runResearchBranch(h.ctx(RESEARCH_STEP_IDS.similar), h.deps));
    ok(ho.found.length === 0 && ho.rejectedFacts === 2, "币种与摘录对不上、口径摘录没有提示词：都丢", ho);
  }

  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  if (err instanceof LostLeaseError) console.error("lost lease", err);
  console.error(err);
  process.exit(1);
});
