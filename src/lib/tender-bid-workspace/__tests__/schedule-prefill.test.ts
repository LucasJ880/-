/**
 * FIX-2 价格表从招标分析带入 — 纯逻辑测试（收集 / 读取 / 数量与单位的规则 / 生成粘贴文本 / 面板的判断）+ 接线断言
 * 运行：npx tsx src/lib/tender-bid-workspace/__tests__/schedule-prefill.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mapV2Result } from "@/lib/tender-auto-analysis/v2-map";
import { CRITICAL_FACT_TYPES, REQUIREMENT_CATEGORIES, type AnalysisResultV2, type CriticalFactSlotV2, type CriticalFactType } from "@/lib/tender-understanding/contract";
import { dedupeRequirements } from "@/lib/tender-understanding/dedupe";
import { applyAddendumPrecedence } from "@/lib/tender-understanding/precedence";
import { PRICE_SCHEDULE_UOMS } from "@/lib/tender-price-schedule/contract";
import { MAX_SCHEDULE_LINES, priceScheduleLineSchema } from "../contract";
import { parseSchedulePaste } from "../paste-import";
import {
  NON_LINE_CATEGORIES,
  PREFILL_MAX_ROWS,
  SCHEDULE_CANDIDATES_MAX,
  SCHEDULE_CANDIDATES_VERSION,
  buildSchedulePrefill,
  collectScheduleCandidates,
  normalizeUomText,
  parseQuantityText,
  prefillClickAction,
  prefillIsStale,
  prefillTextToApply,
  readScheduleCandidates,
  schedulePrefillMessageZh,
  type ScheduleCandidate,
} from "../schedule-prefill";

let passed = 0;
function ok(name: string, cond: boolean, detail?: unknown) {
  assert.equal(cond, true, detail === undefined ? name : `${name}\n${JSON.stringify(detail, null, 2)}`);
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const ev = (pageNumber: number, snippet = "x", documentId = "d1") => ({ documentId, pageNumber, snippet });
type ReqOpt = Partial<{ statement: string; object: string | null; quantity: unknown; unit: unknown; status: string; category: string; evidence: ReturnType<typeof ev>[] }>;
const req = (id: string, o: ReqOpt = {}) => ({
  id, category: o.category ?? "PRODUCT", statement: o.statement ?? `Supply item ${id}`, object: o.object === undefined ? `Item ${id}` : o.object,
  quantity: (o.quantity ?? null) as string | null, unit: (o.unit ?? null) as string | null, status: o.status ?? "ACTIVE", evidence: o.evidence ?? [ev(3)],
});
const fact = (id: string, claim: string, o: Partial<{ factType: string; rawValue: string | null; status: string; evidence: ReturnType<typeof ev>[] }> = {}) => ({
  id, factType: o.factType ?? "quantity", claim, rawValue: o.rawValue ?? null, status: o.status ?? "ACTIVE", evidence: o.evidence ?? [ev(7)],
});
const C = (description: string, quantityText: string | null, unitText: string | null = null, o: Partial<ScheduleCandidate> = {}): ScheduleCandidate => ({ source: "requirement", code: null, description, quantityText, unitText, page: 3, sourceZh: null, inConflict: false, ...o });

/* ---------- 1. 收集数量线索 ---------- */
console.log("入库：收集数量线索");
{
  const block = collectScheduleCandidates({
    manifest: { documents: [{ documentId: "d1", name: "Spec.pdf" }, { documentId: "x1", name: "Pricing.xlsx" }] },
    requirements: [
      req("R1", { object: "Twin Mattress Cover", quantity: "2,367", unit: "Each", evidence: [ev(12)] }),
      req("R2", { quantity: null, unit: null }),
      req("R3", { quantity: "500", unit: "EA", status: "SUPERSEDED" }),
      req("R4", { quantity: "40", unit: null, object: null, statement: "Provide  forty\n pillow\tprotectors\u0000​ here" }),
      req("R5", { quantity: null, unit: "Box", evidence: [ev(5, "x", "x1")] }),
    ],
    facts: [
      fact("f1", "Estimated annual volume of laundry bags", { rawValue: "approx. 120 per year", evidence: [ev(9)] }),
      fact("f2", "Owner: Example County", { factType: "buyer" }),
      fact("f3", "Old quantity", { rawValue: "999", status: "SUPERSEDED" }),
      fact("f4", "Up to 300 units per order"),
    ],
  }, { unitLabelOf: (doc, page) => (doc === "x1" ? `Sheet「Pricing」· 行 ${page}–40` : null) });
  ok("带版本号与总条数", block.version === SCHEDULE_CANDIDATES_VERSION && block.version === 1 && block.total === 5);
  ok("带数量或单位的有效要求被收下：文字原样（2,367 不改成 2367、Each 不改写），带要求编号、页码与出处（文件名 · 第 N 页）", JSON.stringify(block.items[0]) === JSON.stringify({ source: "requirement", code: "R1", description: "Twin Mattress Cover", quantityText: "2,367", unitText: "Each", page: 12, sourceZh: "Spec.pdf · 第 12 页", inConflict: false }), block.items[0]);
  ok("没有「对象」时用整句；换行、制表符、NUL、零宽字符都并成一个空格", block.items[1].code === "R4" && block.items[1].description === "Provide forty pillow protectors here" && block.items[1].unitText === null);
  ok("表格等非 PDF 的出处用它自己的定位写法，不说成「第 N 页」", block.items[2].code === "R5" && block.items[2].sourceZh === "Pricing.xlsx · Sheet「Pricing」· 行 5–40", block.items[2]);
  ok("不带数量与单位的要求、被取代的要求不收", !block.items.some((i) => ["R2", "R3"].includes(i.code ?? "")));
  ok("数量类事实：数量取它的原文值，没有单位，没有要求编号", JSON.stringify(block.items[3]) === JSON.stringify({ source: "fact", code: null, description: "Estimated annual volume of laundry bags", quantityText: "approx. 120 per year", unitText: null, page: 9, sourceZh: "Spec.pdf · 第 9 页", inConflict: false }));
  ok("事实没有原文值时，不拿它的整句说法当数量（数量为空；说明里照样看得到这句话）", block.items[4].description === "Up to 300 units per order" && block.items[4].quantityText === null);
  ok("不是数量类的事实、被取代的事实不收", block.items.length === 5);
  ok("没有任何数量线索时是一个空清单（不是没有这个键）", JSON.stringify(collectScheduleCandidates({ requirements: [req("R1")], facts: [] })) === JSON.stringify({ version: 1, total: 0, items: [] }));
  const many = collectScheduleCandidates({ requirements: Array.from({ length: SCHEDULE_CANDIDATES_MAX + 20 }, (_, i) => req(`R${i}`, { quantity: String(i + 1) })), facts: [fact("f1", "Late fact", { rawValue: "5" })] });
  ok(`一份分析最多存 ${SCHEDULE_CANDIDATES_MAX} 条，但记下原本一共有多少条`, many.items.length === SCHEDULE_CANDIDATES_MAX && many.total === SCHEDULE_CANDIDATES_MAX + 21);

  // 类别：不是价格表行的要求不收
  const cats = collectScheduleCandidates({ requirements: REQUIREMENT_CATEGORIES.map((c) => req(`R-${c}`, { category: c, quantity: "3", unit: "sets" })), facts: [] });
  const kept = cats.items.map((i) => (i.code ?? "").slice(2)).sort().join();
  ok("投标资料、质保、保函、保险、安全、样品、深化图、培训、踏勘、工期、报告这些类别的要求不是价格表的行，不收；其余类别照收", kept === "COMMERCIAL,DELIVERY,INSTALLATION,MANDATORY,OTHER,PERFORMANCE,PRICING,PRODUCT,TECHNICAL" && REQUIREMENT_CATEGORIES.filter((c) => NON_LINE_CATEGORIES.has(c)).length === 12 && [...NON_LINE_CATEGORIES].every((c) => (REQUIREMENT_CATEGORIES as readonly string[]).includes(c)), kept);

  // 类型不对的字段不让入库整个失败
  const odd = collectScheduleCandidates({ requirements: [req("R1", { quantity: 5, unit: { a: 1 } }), req("R2", { quantity: 7 as unknown, unit: "EA" })], facts: [] });
  ok("数量、单位不是字符串（上游出了错）：不抛错，当作没有", odd.items.length === 1 && odd.items[0].code === "R2" && odd.items[0].quantityText === null && odd.items[0].unitText === "EA");

  // 超长的文字：截断处有「…」，不会被当成一个完整的数量（审查发现的问题：160 字截断把一段话截成了「2,」）
  const long = "Estimated annual quantity for the first contract year across all participating facilities listed in Appendix B of this request for proposals is approximately 2,400 units; year two 3,000 units";
  const longBlock = collectScheduleCandidates({ requirements: [], facts: [fact("f1", "Annual quantity", { rawValue: long }), fact("f2", "Very long", { rawValue: `${"x".repeat(320)} 5` })] });
  ok("191 个字符的数量文字整段保留（不再在 160 字处截断）", longBlock.items[0].quantityText === long);
  ok("这段文字里有两个数字：不带入（原来被截成只剩「2,」，取出了 2）", parseQuantityText(longBlock.items[0].quantityText).ok === false && buildSchedulePrefill(longBlock.items).rows.length === 0);
  ok("超过上限的文字截断并以「…」结尾", longBlock.items[1].quantityText?.length === 300 && longBlock.items[1].quantityText.endsWith("…"));
}

/* ---------- 冲突与合并：经真实的去重与补遗优先级 ---------- */
console.log("说法不一致的、合并过的要求（真实的去重与补遗处理）");
{
  const input = { projectId: "p", documents: [{ documentId: "base", name: "Tender.pdf", sourceRole: "BASE_TENDER", pages: [] }, { documentId: "add1", name: "Addendum1.pdf", sourceRole: "ADDENDUM", pages: [] }] } as never;
  const cand = (doc: string, page: number, statement: string, quantity: string, snippet: string) => ({ category: "PRODUCT", statement, actor: "Vendor", action: "supply", object: "Twin Mattress Cover", mandatory: true, mandatorySignal: "shall", deadline: null, quantity, unit: "Each", submissionStage: null, technicalArea: null, revisionAction: null, revisionTargetHint: null, sourceDocumentId: doc, pageNumber: page, sourceSnippet: snippet, confidence: "HIGH" });
  // 招标文件写 2,367，补遗写 2,900，补遗里没有「改为」之类的话 → 分析不替人选，两条都标待复核
  const res = applyAddendumPrecedence(input, dedupeRequirements(input, [
    cand("base", 12, "The Vendor shall supply 2,367 twin mattress covers to the County facilities.", "2,367", "Vendor shall supply 2,367 twin mattress covers"),
    cand("add1", 2, "Quantity of twin mattress covers required for all County facilities during the term is 2,900 pieces in total as listed.", "2,900", "twin mattress covers 2,900"),
  ] as never));
  ok("（前提）真实流程里这两条要求都是待复核，并有一条未解决的冲突", res.requirements.length === 2 && res.requirements.every((r) => r.status === "NEEDS_REVIEW") && res.conflicts.some((c) => c.resolution === "UNRESOLVED"), res.requirements.map((r) => r.status));
  const block = collectScheduleCandidates({ requirements: res.requirements, facts: [], conflicts: res.conflicts });
  const p = buildSchedulePrefill(block.items);
  ok("两条都记下并标明「说法不一致」", block.items.length === 2 && block.items.every((i) => i.inConflict));
  ok("带入时两条都不成为行（原来会带入 2367 与 2900 两行、没有任何提示）；列在「没带入」里并说明", p.rows.length === 0 && p.skipped.length === 2 && p.skipped.every((k) => k.reasonZh === "分析发现这里有两处说法不一致，还没有定") && p.skipped.map((k) => k.quantityText).join() === "2,367,2,900", p);
  ok("只在冲突清单里出现、状态仍是有效的要求，同样标明", collectScheduleCandidates({ requirements: [req("R9", { quantity: "5", unit: "EA" })], facts: [], conflicts: [{ itemIds: ["R9"], resolution: "UNRESOLVED" }] }).items[0].inConflict === true);
  ok("已由补遗解决的冲突不算", collectScheduleCandidates({ requirements: [req("R9", { quantity: "5", unit: "EA" })], facts: [], conflicts: [{ itemIds: ["R9"], resolution: "RESOLVED_BY_ADDENDUM" }] }).items[0].inConflict === false);
  ok("说法不一致的数量类事实：记下并标明，带入时不成为行", (() => { const b = collectScheduleCandidates({ requirements: [], facts: [fact("f1", "Qty A", { rawValue: "10", status: "CONFLICT" }), fact("f2", "Qty B", { rawValue: "12" })], conflicts: [{ itemIds: ["f2"], resolution: "UNRESOLVED" }] }); return b.items.length === 2 && b.items.every((i) => i.inConflict) && buildSchedulePrefill(b.items).rows.length === 0; })());

  // 两句很像的话被合并成一条：数量取自其中一处，出处要指向那一处
  const merged = dedupeRequirements(input, [
    cand("base", 30, "Vendor shall supply twin mattress covers to Site B.", "250", "Site B twin mattress covers 250"),
    cand("base", 12, "Vendor shall supply twin mattress covers to Site A as scheduled.", "100", "Site A twin mattress covers 100"),
  ] as never).map((m) => m.requirement);
  ok("（前提）真实的去重把它们并成一条：数量 100，出处依次是第 30、12 页", merged.length === 1 && merged[0].quantity === "100" && merged[0].evidence.map((e) => e.pageNumber).join() === "30,12", merged.map((m) => [m.quantity, m.evidence.map((e) => e.pageNumber)]));
  const mb = collectScheduleCandidates({ requirements: merged, facts: [], manifest: { documents: [{ documentId: "base", name: "Tender.pdf" }] } });
  ok("页码取原文片段里出现了这个数量的那一处（第 12 页），不是排在第一的第 30 页", mb.items[0].page === 12 && mb.items[0].sourceZh === "Tender.pdf · 第 12 页", mb.items[0]);
  ok("片段里都找不到这个数字时，用第一处", collectScheduleCandidates({ requirements: [req("R1", { quantity: "77", evidence: [ev(4, "no digits"), ev(8, "none either")] })], facts: [] }).items[0].page === 4);
  ok("片段里的 1,100 不算对上 100（不拿一个更大的数字的一部分去对）", collectScheduleCandidates({ requirements: [req("R1", { quantity: "100", evidence: [ev(4, "total 1,100 units"), ev(8, "Site A: 100 units")] })], facts: [] }).items[0].page === 8);
}

/* ---------- 经真实的入库映射 ---------- */
console.log("入库映射（mapV2Result）");
{
  const criticalFacts = (() => { const out = {} as Record<CriticalFactType, CriticalFactSlotV2>; for (const k of CRITICAL_FACT_TYPES) out[k] = { status: "UNKNOWN" }; return out; })();
  const base = { category: "PRODUCT", actor: null, action: null, mandatory: true, mandatorySignal: null, deadline: null, submissionStage: null, technicalArea: null, addendumDisposition: "NEW", supersededById: null, confidence: "HIGH" };
  const result = {
    contractVersion: "tender-analysis-result-v2",
    manifest: { documents: [{ documentId: "d1", name: "Spec.pdf", sourceRole: "BASE_TENDER" }] },
    projectSummary: "Supply bedding.",
    criticalFacts,
    facts: [{ id: "f1", factType: "quantity", claim: "Estimated annual laundry bags", rawValue: "120 bags", normalizedValue: null, confidence: "HIGH", evidence: [ev(9)], sourceRole: "BASE_TENDER", status: "ACTIVE" }],
    requirements: [
      { ...base, id: "REQ-001", statement: "Supply 2,367 twin mattress covers.", object: "Twin Mattress Cover", quantity: "2,367", unit: "Each", status: "ACTIVE", evidence: [ev(12)] },
      { ...base, id: "REQ-002", statement: "Covers shall be flame retardant.", object: null, quantity: null, unit: null, status: "ACTIVE", evidence: [ev(13)] },
      { ...base, id: "REQ-003", statement: "Old line.", object: "Old", quantity: "5", unit: "EA", status: "SUPERSEDED", evidence: [ev(14)] },
      { ...base, id: "REQ-004", category: "WARRANTY", statement: "Warranty of five years.", object: "Warranty", quantity: "5", unit: "years", status: "ACTIVE", evidence: [ev(15)] },
    ],
    mandatoryRequirementIds: [], submissionChecklist: [], risks: [], conflicts: [], clarifications: [], resolvedAmbiguities: [], addendumChanges: [], nextActions: [], limitations: [], unknowns: [],
    evidenceCoverage: { factsWithEvidence: 1, factsTotal: 1, requirementsWithEvidence: 4, requirementsTotal: 4 },
    metadata: { analyzerVersion: "tender-understanding-v2", resultVersion: "tender-analysis-result-v2", projectId: "p1", startedAt: "", finishedAt: "", wallTimeMs: 0, llmCalls: 1, llmFailures: 0, models: ["m"], promptUsages: [], pages: 15, windows: 1, rejectedCandidates: [], inputChars: 0, outputChars: 0 },
  } as unknown as AnalysisResultV2;
  const mapped = mapV2Result(result, { unitLabelOf: () => null });
  const pricing = mapped.sections.find((s) => s.sectionKey === "PRICING_EVALUATION");
  const stored = readScheduleCandidates(pricing?.structuredJson);
  ok("入库的「价格与评标」一节带着数量线索：那条带数量的产品要求与那条数量类事实，共 2 条（被取代的、质保类的不在其中）", stored.state === "present" && stored.items.length === 2 && stored.total === 2 && stored.items[0].code === "REQ-001" && stored.items[0].quantityText === "2,367" && stored.items[0].unitText === "Each" && stored.items[0].page === 12 && stored.items[0].sourceZh === "Spec.pdf · 第 12 页" && stored.items[1].source === "fact" && stored.items[1].quantityText === "120 bags", pricing?.structuredJson);
  ok("入库的要求本身没有变（数量线索是另外保留的）", mapped.requirements.length === 3 && Object.keys(mapped.requirements[0]).sort().join() === "category,chineseTranslation,complianceStatus,evidenceRequired,mandatory,originalRequirement,requirementCode,sourcePage,sourceRefs");
  ok("别的节的结构化字段没有被动到", mapped.sections.filter((s) => s.sectionKey !== "PRICING_EVALUATION").every((s) => !JSON.stringify(s.structuredJson ?? null).includes("scheduleCandidates")));
  ok("映射把定位标签的解析器传了进去（表格来源的出处不会被说成页码）", (() => { const m = mapV2Result(result, { unitLabelOf: (_d, p) => `Sheet「价格表」· 行 ${p}` }); const s = readScheduleCandidates(m.sections.find((x) => x.sectionKey === "PRICING_EVALUATION")?.structuredJson); return s.state === "present" && s.items[0].sourceZh === "Spec.pdf · Sheet「价格表」· 行 12"; })());
  const prefill = buildSchedulePrefill(stored.state === "present" ? stored.items : []);
  ok("从入库的内容带入：两行，数量 2367 / 120，单位 Each / Bag（事实的单位取自它的数量文字）", prefill.rows.map((r) => `${r.lineNo}|${r.description}|${r.quantity}|${r.uom}`).join(";") === "1|Twin Mattress Cover|2367|Each;2|Estimated annual laundry bags|120|Bag", prefill.rows);
  ok("入库的数量线索能存进 JSON（没有 NUL 之类存不进去的字符）", !JSON.stringify(mapV2Result({ ...result, requirements: [{ ...result.requirements[0], object: "Bad\u0000Object", quantity: "5\u0000", unit: "EA\u0000" }] } as AnalysisResultV2).sections).includes("\\u0000"));
}

/* ---------- 2. 读存下的线索 ---------- */
console.log("读存下的线索");
{
  const good = { scheduleCandidates: { version: 1, total: 2, items: [C("A", "5", "EA"), { source: "fact", code: null, description: "B", quantityText: "7", unitText: null, page: 2, sourceZh: "Doc.pdf · 第 2 页", inConflict: false }] }, other: 1 };
  const r = readScheduleCandidates(good);
  ok("认得出当前版本的内容", r.state === "present" && r.items.length === 2 && r.items[1].source === "fact" && r.items[1].sourceZh === "Doc.pdf · 第 2 页" && r.total === 2);
  ok("没有这个键 / 整块为空 / 不是对象 → 这份分析是在本功能之前做的", [null, undefined, {}, { count: 3 }, { kind: "pricing_evaluation" }, "x", 5, [], { scheduleCandidates: null }, { scheduleCandidates: [] }].every((v) => readScheduleCandidates(v).state === "absent"));
  ok("版本不认识 / items 不是列表 → 同样当作没有（不猜旧数据的形状）", readScheduleCandidates({ scheduleCandidates: { version: 2, items: [] } }).state === "absent" && readScheduleCandidates({ scheduleCandidates: { version: 1, items: "x" } }).state === "absent");
  ok("有键但清单为空 → 有数据、0 条（与「没有键」不同）", JSON.stringify(readScheduleCandidates({ scheduleCandidates: { version: 1, total: 0, items: [] } })) === JSON.stringify({ state: "present", items: [], total: 0 }));
  ok("存的时候超出上限、只存了一部分：读得出原本一共有多少条", (() => { const x = readScheduleCandidates({ scheduleCandidates: { version: 1, total: 321, items: [C("A", "5", "EA")] } }); return x.state === "present" && x.total === 321; })());
  const dirty = readScheduleCandidates({ scheduleCandidates: { version: 1, items: [null, "x", { description: "" }, { description: "  ok  \n item ", quantityText: 5, unitText: ["x"], page: -1, code: "c".repeat(80), source: "weird", price: 99 }] } });
  ok("坏的条目丢掉；字段类型不对的当作没有；多余的字段不带出来；读不出「没有冲突」的当作有冲突（宁可不带入）", dirty.state === "present" && dirty.items.length === 1 && JSON.stringify(dirty.items[0]) === JSON.stringify({ source: "requirement", code: null, description: "ok item", quantityText: null, unitText: null, page: null, sourceZh: null, inConflict: true }), dirty);
}

/* ---------- 3. 数量的取法 ---------- */
console.log("数量：整段文字就是一个数字才取");
{
  const q = (t: string | null, unit: string | null = null) => { const r = parseQuantityText(t, unit); return r.ok ? r.quantity : r.reason; };
  const all = (pairs: Array<[string, string] | [string, string, string]>) => pairs.filter(([t, want, unit]) => q(t, unit ?? null) !== want).map(([t, want, unit]) => `${JSON.stringify(t)}${unit ? ` [${unit}]` : ""} → ${q(t, unit ?? null)}（应为 ${want}）`);
  const bad = (pairs: Array<[string, string] | [string, string, string]>) => { const wrong = all(pairs); return { pass: wrong.length === 0, wrong }; };

  let r = bad([["2367", "2367"], ["120", "120"], ["12.5", "12.5"], ["2,367", "2367"], ["1,234,567", "1234567"], ["2,367.5", "2367.5"], ["120.", "120"], ["0.125", "0.125", "kg"]]);
  ok("一个数字：取它；千位逗号去掉；句末的句号不碍事", r.pass, r.wrong);
  r = bad([["approx. 120", "120"], ["approximately 2,400", "2400"], ["about 50", "50"], ["est. 300", "300"], ["estimated 2,500 EA", "2500"], ["~120", "120"], ["qty: 24", "24"], ["Quantity: 24", "24"], ["total 80", "80"], ["约 500件", "500"], ["共 30 套", "30"]]);
  ok("前面可以有「大约」「数量」这类词，后面可以跟一个认得的单位", r.pass, r.wrong);
  ok("数量文字里跟着的单位会被带出来（事实没有单独的单位字段时用得上）", (() => { const x = parseQuantityText("2,367 each"); const y = parseQuantityText("120"); return x.ok && x.unitInText === "each" && y.ok && y.unitInText === null; })());
  ok("跟着的词不在单位对照里，但就是分析给出的那个单位：照取（12 dozen，单位 dozen）", q("12 dozen", "dozen") === "12" && q("40 LF", "LF") === "40");

  r = bad([["100-200", "range"], ["100 – 200", "range"], ["100 to 200", "range"], ["100 through 200", "range"], ["100 thru 200", "range"], ["100 — 200", "range"], ["100 到 200", "range"], ["between 100 and 200", "range"], ["100~200", "range"], ["50 至 80", "range"], ["approx 1,000-1,500", "range"]]);
  ok("范围不取", r.pass, r.wrong);
  r = bad([["3 lots of 50", "multiple"], ["120 (2 per room)", "multiple"], ["4 x 25", "multiple"], ["120 each x 2 sites", "multiple"], ["1,23", "multiple"], ["12,5", "multiple"], ["2 367", "multiple"], ["10 000", "multiple"], ["1/2 inch", "multiple"], ["#10 envelopes 5000", "multiple"], ["5'x7' rugs: 40", "multiple"], ["Size 36: 50", "multiple"]]);
  ok("不止一个数字不取（不猜取哪个）；空格分千位、逗号当小数点的写法也不取", r.pass, r.wrong);
  r = bad([["as required", "no_number"], ["TBD", "no_number"], ["待定", "no_number"], ["１２３", "no_number"]]);
  ok("没有数字不取（全角数字不认）", r.pass, r.wrong);
  ok("没有给数量", q(null) === "missing" && q("") === "missing" && q("   ") === "missing");

  // 审查逐条跑出来的「悄悄取错」：现在一条都不取
  r = bad([["$5,000", "money"], ["5,000$", "money"], ["1,200.50$", "money"], ["$1 500", "money"], ["$12 500 per unit", "money"], ["$ 5 000", "money"], ["$1.000,50", "money"], ["€ 1.200,50", "money"], ["$1,5", "money"], ["CAD 5000", "money"], ["USD 1,000", "money"], ["5 dollars", "money"], ["10%", "money"], ["10 percent", "money"], ["120 units at $45", "money"], ["up to 10% over 500", "money"], ["5000 元", "money"]]);
  ok("金额与百分比不是数量：货币符号在前在后、货币代码、dollars、percent 都认", r.pass, r.wrong);
  r = bad([["5k", "unclear"], ["5 thousand", "unclear"], ["2.5 million", "unclear"], ["12 dozen", "unclear"], ["two 40ft containers", "unclear"], ["40ft", "unclear"], ["qty: 24/case", "unclear"], ["-5", "unclear"]]);
  ok("带倍数的（5k、5 thousand、12 dozen）、数字不是数量本身的：不取（原来取成 5、5、12）", r.pass, r.wrong);
  r = bad([["Item 3", "unclear"], ["Type 2", "unclear"], ["see Table 3", "unclear"], ["Dec 2026", "unclear"], ["3-year", "unclear"], ["4-ply", "unclear"], ["M8 bolts", "unclear"], ["3M tape", "unclear"], ["ISO 9001", "unclear"], ["Grade 304", "unclear"], ["A4", "unclear"], ["50 °C", "unclear"], ["a) 5", "unclear"], ["i. 500", "unclear"]]);
  ok("编号、型号、日期里的数字不是数量：不取（原来取成 3、2026、9001……）", r.pass, r.wrong);
  r = bad([["<100", "unclear"], ["≥100", "unclear"], ["minimum 50", "unclear"], ["no more than 50", "unclear"], ["Up to 300 units per order", "unclear"], ["50 per month", "unclear"], ["50/month", "unclear"], ["approx. 120 per year", "unclear"]]);
  ok("上限、下限、按期间计的用量（每年、每月）：不取——填多少由人定", r.pass, r.wrong);
  r = bad([[".5", "unclear"], [".5 kg", "unclear"], ["0,500 kg", "ambiguous"], ["0500", "ambiguous"], ["1.500", "ambiguous"], ["12.500", "ambiguous"], ["2,500 kg", "ambiguous"], ["2,500", "ambiguous", "kg"], ["1,200 ft", "ambiguous"], ["1,5", "multiple"]]);
  ok("写法有歧义的不取：1.500（欧式的一千五？）、0,500、「2,500 kg」（逗号可能是小数点）", r.pass, r.wrong);
  ok("同样是「2,500」，单位是件数（Each）时照取——件数不会是小数", q("2,500", "Each") === "2500" && q("2,500 pcs") === "2500" && q("12,500 kg") === "ambiguous");
  r = bad([["5", "time", "years"], ["5 years", "time"], ["90", "time", "days"], ["12 months", "time"], ["3", "time", "个月"], ["48 hours", "time"]]);
  ok("单位是时间的（质保 5 年、有效期 90 天）不是价格表的数量：不取", r.pass, r.wrong);
  ok("数量是 0、位数多得不像数量的：不取", q("0") === "zero" && q("0.0") === "zero" && q("1234567890") === "unclear");
  ok("确定性：同样的输入两次结果相同", JSON.stringify(parseQuantityText("approx. 120 ea")) === JSON.stringify(parseQuantityText("approx. 120 ea")));
}

/* ---------- 单位对照 ---------- */
console.log("单位：固定对照，认不出的原样保留");
{
  const cases: Array<[string, string]> = [["EA", "Each"], ["ea.", "Each"], ["each", "Each"], ["pcs", "Each"], ["Piece", "Each"], ["units", "Each"], ["Boxes", "Box"], ["bx", "Box"], ["rolls", "Roll"], ["PR", "Pair"], ["sets", "Set"], ["cs", "Case"], ["Bags", "Bag"], ["pkg", "Pack"], ["KGS", "kg"], ["metres", "m"], ["m", "m"], ["Feet", "ft"], ["sq ft", "sqft"], ["SF", "sqft"], ["Square Feet", "sqft"], ["件", "Each"], ["套", "Set"]];
  ok("对照表里的写法都规整到单位目录", cases.every(([raw, want]) => normalizeUomText(raw) === want), cases.filter(([raw, want]) => normalizeUomText(raw) !== want));
  ok("规整出来的每一个都在价格表的单位目录里", cases.every(([, want]) => (PRICE_SCHEDULE_UOMS as readonly string[]).includes(want)));
  ok("目录里的每个单位自己的写法都能对上", PRICE_SCHEDULE_UOMS.every((u) => normalizeUomText(u) === u));
  ok("认不出的原样保留，不猜：LF（延长英尺）不会变成 ft；dozen、lot、yd 都原样", normalizeUomText("LF") === "LF" && normalizeUomText("dozen") === "dozen" && normalizeUomText("lot") === "lot" && normalizeUomText("yd") === "yd");
  ok("单独一个大写的 M 不规整成米（它在北美采购里也表示每千件）", normalizeUomText("M") === "M" && normalizeUomText("m") === "m");
  ok("没有单位 → 空；长的单位文字原样返回、不截断", normalizeUomText(null) === "" && normalizeUomText("  ") === "" && normalizeUomText("Each per the attached schedule") === "Each per the attached schedule");
}

/* ---------- 生成粘贴文本 ---------- */
console.log("生成价格表的行");
{
  const items = [
    C("Twin Mattress Cover", "2,367", "Each", { page: 12, sourceZh: "Spec.pdf · 第 12 页" }),
    C("Laundry bags", "120", null, { source: "fact", page: 9 }),
    C("Pillows", "100-200", "EA"),
    C("Blankets", "as required", "EA"),
    C("Sheets", "3 lots of 50", "EA"),
    C("Twin  Mattress\tCover", "2367", "ea", { page: 40 }), // 说明、数量、单位都与第 1 行相同（规整后）
    C("Curtain track", "40", "LF"),
    C("Towels", null, "Box"),
    C("Bath mats", "60 pcs", null),
    C("Robes", "15 each", "Box"),
    C("Warranty period", "5", "years"),
    C("Mattress (addendum)", "2,900", "Each", { inConflict: true }),
    C("Odd unit", "9", "Each per the attached schedule"),
  ];
  const p = buildSchedulePrefill(items);
  ok("能确定的带入，行号从 1 连续", p.rows.map((r) => `${r.lineNo}:${r.description}:${r.quantity}:${r.uom}`).join("|") === "1:Twin Mattress Cover:2367:Each|2:Laundry bags:120:|3:Twin Mattress Cover:2367:Each|4:Curtain track:40:LF|5:Bath mats:60:Each|6:Odd unit:9:", p.rows);
  ok("不能确定的不带入，各有原因", p.skipped.map((k) => `${k.description}=${k.reasonZh}`).join("|") === "Pillows=数量是一个范围|Blankets=数量里没有数字|Sheets=数量里有不止一个数字|Towels=分析没有给出数量|Robes=数量里写的单位与分析给出的单位不一致|Warranty period=单位是时间，不是价格表的数量|Mattress (addendum)=分析发现这里有两处说法不一致，还没有定", p.skipped);
  ok("说明、数量、单位都相同的两行不合并（可能确实是两行），只标出与哪一行相同", p.rows[2].sameAsLine === 1 && p.rows[2].page === 40 && p.rows.filter((r) => r.sameAsLine !== null).length === 1 && p.rows[0].sameAsLine === null);
  ok("说明与数量相同但单位不同的，不算相同；说明只差大小写的算相同", (() => { const x = buildSchedulePrefill([C("Glove", "10", "Box"), C("Glove", "10", "Pair"), C("GLOVE", "10", "bx"), C("Glove", "11", "Box")]); return x.rows.map((r) => r.sameAsLine).join() === ",,1,"; })());
  ok("分析没有单独给单位时，用数量文字里跟着的那个（60 pcs → Each）", p.rows[4].uom === "Each" && p.rows[4].unitText === null && p.rows[4].quantityText === "60 pcs");
  ok("比价格表的单位上限还长的「单位」不带入（留空由人填），原文在旁边", p.rows[5].uom === "" && p.rows[5].unitText === "Each per the attached schedule");
  ok("每一行带着分析给出的文字与出处供人核对", p.rows[0].quantityText === "2,367" && p.rows[0].unitText === "Each" && p.rows[0].page === 12 && p.rows[0].sourceZh === "Spec.pdf · 第 12 页" && p.rows[1].source === "fact");
  ok("没带入的条目同样带着分析给出的数量、单位与出处", p.skipped[0].quantityText === "100-200" && p.skipped[0].unitText === "EA" && p.skipped[0].page === 3);
  ok("生成的文本：每行「行号 ⇥ 说明 ⇥ 数量 ⇥ 单位」", p.text === "1\tTwin Mattress Cover\t2367\tEach\n2\tLaundry bags\t120\t\n3\tTwin Mattress Cover\t2367\tEach\n4\tCurtain track\t40\tLF\n5\tBath mats\t60\tEach\n6\tOdd unit\t9\t");

  const parsed = parseSchedulePaste(p.text);
  ok("交给既有的粘贴解析：有单位的行逐项相同（行号、说明、数量、单位），尺寸、包装数、认证要求为空", !parsed.skippedHeader && parsed.lines.map((l) => `${l.lineNo}:${l.description}:${l.quantity}:${l.uom}:${l.packCount}:${l.dimensions}:${l.certificationGate}`).join("|") === "1:Twin Mattress Cover:2367:Each:null:null:null|3:Twin Mattress Cover:2367:Each:null:null:null|4:Curtain track:40:LF:null:null:null|5:Bath mats:60:Each:null:null:null", parsed);
  ok("没有单位的行，既有的解析照常报「缺少单位」（由人补，不是悄悄带进去）", parsed.issues.length === 2 && parsed.issues.map((i) => i.row).join() === "2,6" && parsed.issues.every((i) => i.messageZh.includes("缺少单位")));
  ok("带入的每一行都过得了价格表行的结构校验（说明、数量、单位的长度）", p.rows.filter((r) => r.uom).every((r) => priceScheduleLineSchema.safeParse({ lineNo: r.lineNo, description: r.description, quantity: r.quantity, uom: r.uom }).success));

  // 说明里的各种字符
  const tricky = buildSchedulePrefill([
    C('Cover,\t"Queen"\nsize, 60" x 80"', "15", "EA"),
    C("  ", "5", "EA"),
    C('"Deluxe" pillow 20" x 30"', "8", "EA"),
    C('Pipe 12"" dia', "3", "EA"),
    C('"Queen"', "2", "EA"),
    C("Line sep\u0085next\u000bvt\u0000nul​zw\rcr", "4", "EA"),
    C("=HYPERLINK(\"http://x\")", "1", "EA"),
  ]);
  const parsedTricky = parseSchedulePaste(tricky.text);
  ok("说明里有制表符、换行、各种分隔符与控制字符：不会把一行拆成两行或多出一列；空说明的线索丢掉", tricky.rows.length === 6 && parsedTricky.lines.length === 6 && parsedTricky.issues.length === 0 && tricky.text.split("\n").length === 6 && tricky.text.split("\n").every((l) => l.split("\t").length === 4) && tricky.rows[4].description === "Line sep next vt nul zw cr", { text: tricky.text, parsed: parsedTricky });
  ok("说明里有双引号（英寸、带引号的品名）：粘贴解析读回来与带入的说明逐字相同（原来首尾的引号会被吃掉）", parsedTricky.lines.every((l, i) => l.description === tricky.rows[i].description) && tricky.rows[1].description === '"Deluxe" pillow 20" x 30"' && tricky.rows[2].description === 'Pipe 12"" dia' && tricky.rows[3].description === '"Queen"', parsedTricky.lines.map((l) => l.description));

  ok(`一次最多带入的行数与价格表的上限一致（${MAX_SCHEDULE_LINES}）`, PREFILL_MAX_ROWS === MAX_SCHEDULE_LINES);
  const capped = buildSchedulePrefill(Array.from({ length: 5 }, (_, i) => C(`Item ${i}`, String(i + 1), "EA")), { maxRows: 3 });
  ok("超过上限的列在「没带入」里并说明", capped.rows.length === 3 && capped.skipped.length === 2 && capped.skipped[0].reasonZh.includes("超过一次最多 3 行"));
  ok("分析里的线索比存下的多：结果里写明原本一共多少条", buildSchedulePrefill([C("A", "1", "EA")], { total: 321 }).truncatedFrom === 321 && buildSchedulePrefill([C("A", "1", "EA")]).truncatedFrom === null);
  ok("没有线索 → 空文本、0 行", JSON.stringify(buildSchedulePrefill([])) === JSON.stringify({ text: "", rows: [], skipped: [], truncatedFrom: null }));
  ok("结果里没有价格、成本、毛利之类的字段", Object.keys(p.rows[0]).sort().join() === "description,lineNo,page,quantity,quantityText,sameAsLine,source,sourceZh,unitText,uom" && Object.keys(p.skipped[0]).sort().join() === "description,page,quantityText,reasonZh,sourceZh,unitText");
}

/* ---------- 给人看的那句话 ---------- */
console.log("说明文字");
{
  const p = buildSchedulePrefill([C("A", "5", "EA"), C("B", "7", null), C("C", "1-2", "EA"), C("a", "5", "each")], { total: 400 });
  const msg = schedulePrefillMessageZh("ready", p);
  ok("带入了几行、几行没有单位（不补会被略过）、几行可能重复、几条没带入、分析里原本多少条，都写明；并写明要逐行核对、还没有保存", msg.includes("带入了 3 行") && msg.includes("1 行没有单位") && msg.includes("保存时会被略过") && msg.includes("1 行与前面的行完全相同") && msg.includes("另有 1 条没有带入") && msg.includes("共有 400 条数量线索，只保留了前 300 条") && msg.includes("逐行核对") && msg.includes("还没有保存"), msg);
  ok("没有可用的分析 / 分析是旧的：各有说明（旧的分析不说成「重新分析就行」，写明要用新版分析）", schedulePrefillMessageZh("no_analysis", p).includes("还没有可用的招标分析") && schedulePrefillMessageZh("legacy_analysis", p).includes("用新版分析重新分析后才能带入"));
  ok("分析里一条带数量的都没有：照实说，提示照旧粘贴", schedulePrefillMessageZh("ready", { rows: [], skipped: [], truncatedFrom: null }).includes("没有抽到带数量的行"));
}

/* ---------- 面板上的判断（纯函数） ---------- */
console.log("面板：先确认再替换；带入只决定文本");
{
  ok("粘贴框是空的（或只有空白）→ 直接取；有内容 → 先确认", prefillClickAction("") === "load" && prefillClickAction("  \n\t ") === "load" && prefillClickAction("1\tA\t2\tEach") === "confirm");
  const ready = { state: "ready" as const, rows: buildSchedulePrefill([C("A", "5", "EA")]).rows, text: "1\tA\t5\tEach" };
  ok("有行可带 → 粘贴框换成带入的文本", prefillTextToApply(ready) === "1\tA\t5\tEach");
  ok("没有分析、旧的分析、一行都带不进来 → 不动粘贴框（不把人已经贴好的内容清掉）", prefillTextToApply({ state: "no_analysis", rows: [], text: "" }) === null && prefillTextToApply({ state: "legacy_analysis", rows: [], text: "" }) === null && prefillTextToApply({ state: "ready", rows: [], text: "" }) === null);
  ok("粘贴框里的内容改过之后，对照清单要标明「是带入时的」", prefillIsStale("1\tA\t5\tEach", "1\tA\t6\tEach") === true && prefillIsStale("1\tA\t5\tEach", "1\tA\t5\tEach\n") === false && prefillIsStale("1\tA\t5\tEach", "") === true);
}

/* ---------- 接线（源码断言） ---------- */
console.log("接线");
{
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  const route = read("src/app/api/projects/[id]/bid-workspace/schedule-candidates/route.ts");
  const service = read("src/lib/tender-bid-workspace/schedule-prefill-service.ts");
  const panel = read("src/components/tender/bid-workspace-panel.tsx");
  const pure = read("src/lib/tender-bid-workspace/schedule-prefill.ts");
  const map = read("src/lib/tender-auto-analysis/v2-map.ts");
  ok("接口：只有 GET；项目读权限；功能开关关闭 404；组织取自项目记录", /export async function GET/.test(route) && !/export async function (POST|PUT|PATCH|DELETE)/.test(route) && route.includes("requireProjectReadAccess(request, projectId)") && route.includes("isBidWorkspaceEnabledForOrg(orgId)") && route.includes("access.project.orgId") && route.includes("status: 404"));
  ok("读取：只读，没有任何写库的调用", !/\.(create|createMany|update|updateMany|upsert|delete|deleteMany|\$executeRaw|\$transaction)\b/.test(service) && !/logAudit|writeAuditLog/.test(service));
  ok("读取：按项目与组织取最新一份等待审核或已批准的分析（别的状态一概不用）", service.includes('where: { projectId: input.projectId, orgId: input.orgId, status: { in: ["REVIEW_REQUIRED", "APPROVED"] } }') && service.includes('orderBy: { createdAt: "desc" }'));
  ok("读取：这一节、被驳回的要求、被驳回的事实，都只在这一份分析里找", service.includes('where: { runId_sectionKey: { runId: run.id, sectionKey: "PRICING_EVALUATION" } }') && service.includes('where: { analysisRunId: run.id, projectId: input.projectId, requirementCode: { in: codes }, reviewStatus: "REJECTED" }') && service.includes("where: { runId: run.id, manuallyConfirmed: false, confirmedById: { not: null } }"));
  ok("纯函数文件零依赖（前后端共用），里面没有调模型、没有访问数据库", !/^import /m.test(pure) && !/fetch\(|prisma|@\/lib\/db/.test(pure));
  ok("入库映射把冲突清单、文件清单（在分析结果里）与定位标签解析器都交给了收集函数", map.includes("collectScheduleCandidates(result, { unitLabelOf })"));

  // 「带入不替人保存」：带入这一段代码里不能出现任何保存的动作
  const loadSlice = panel.slice(panel.indexOf("const loadPrefill = async"), panel.indexOf("const askPrefill ="));
  ok("（前提）取到了带入的那段代码", loadSlice.length > 300 && loadSlice.includes("schedule-candidates"));
  ok("带入的代码里没有保存：不调 submit、不调 onSave、不发 PUT / POST、没有定时器", !/submit\s*\(|onSave\s*\(|method\s*:|setTimeout|setInterval|requestAnimationFrame|queueMicrotask/.test(loadSlice), loadSlice);
  ok("带入的代码只通过 prefillTextToApply 决定粘贴框的文本（那个函数有单独的测试）", /const next = prefillTextToApply\(data\);\s*if \(next !== null\) setText\(next\);/.test(loadSlice) && (loadSlice.match(/setText\(/g) ?? []).length === 1);
  ok("带入的请求是一个不带 method 的读取（GET），地址是 schedule-candidates", /apiFetch\(`\/api\/projects\/\$\{projectId\}\/bid-workspace\/schedule-candidates`\)/.test(loadSlice));
  const cardStart = panel.indexOf("function ScheduleCard(");
  const card = panel.slice(cardStart, panel.indexOf("\nfunction ", cardStart + 10));
  ok("（前提）取到了价格表这张卡片的代码", cardStart > 0 && card.includes('data-testid="bw-schedule-save"') && card.includes("const loadPrefill = async") && !card.includes("bw-line-save"));
  ok("这张卡片里保存只有一个入口：submit 只挂在保存按钮上，别处不调用；价格表只在 submit 里保存", (card.match(/onClick=\{submit\}/g) ?? []).length === 1 && /onClick=\{submit\} data-testid="bw-schedule-save"/.test(card) && !/submit\(\)/.test(card) && (card.match(/\bsubmit\b/g) ?? []).length === 2 && (card.match(/onSave\(\{ priceSchedule/g) ?? []).length === 1 && /const submit = async \(\) => \{[^}]*onSave\(\{ priceSchedule: \{ lines: parsed\.lines \} \}\)/.test(card));
  ok("「从招标分析带入」按钮点的是 askPrefill（先看粘贴框里有没有内容）", /onClick=\{askPrefill\} data-testid="bw-schedule-prefill"/.test(panel) && /const askPrefill = \(\) => \(prefillClickAction\(text\) === "confirm" \? setConfirmReplace\(true\) : void loadPrefill\(\)\);/.test(panel));
  ok("确认那一段只在需要确认时显示，「确定替换」才去取", /\{confirmReplace && \(\s*<p role="alert"[^>]*data-testid="bw-schedule-prefill-confirm"/.test(panel) && (panel.match(/void loadPrefill\(\)/g) ?? []).length === 2 && panel.includes("<button type=\"button\" className={BTN} onClick={() => void loadPrefill()}>确定替换</button>"));
  ok("取的过程中粘贴框只读（不会把人这时候敲的字冲掉）；换项目后还在路上的那次带入作废", panel.includes("readOnly={prefillBusy}") && /if \(seq !== prefillSeq\.current\) return;/.test(loadSlice) && panel.includes("useEffect(() => () => { prefillSeq.current += 1; }, [projectId]);"));
  ok("取失败时清掉上一次带入的说明（不让旧的说明挨着报错）", (loadSlice.match(/setPrefill\(null\);/g) ?? []).length === 2);
  ok("粘贴框改过之后，对照清单标明是带入时的", panel.includes("prefillIsStale(prefill.text, text)") && panel.includes('data-testid="bw-schedule-prefill-stale"'));
  ok("界面的叫法是「分析抽到的数量」，不说成「原文」（要求的数量是模型给的字段，没有逐字核对过）", panel.includes("分析抽到的数量「") && !panel.includes("数量原文"));
  ok("有问题的行不会保存——界面写明；超过 8 行的问题给出还有多少行", panel.includes("有问题的行不会保存") && panel.includes("还有 {parsed.issues.length - 8} 行有问题没有列出"));
  ok("面板的测试标记齐全", ["bw-schedule-prefill", "bw-schedule-prefill-confirm", "bw-schedule-prefill-message", "bw-schedule-prefill-rows", "bw-schedule-prefill-skipped", "bw-schedule-prefill-stale", "bw-schedule-paste-issues"].every((id) => panel.includes(`data-testid="${id}"`)));
}

console.log(`\n✓ schedule-prefill: ${passed} 项断言全部通过`);
