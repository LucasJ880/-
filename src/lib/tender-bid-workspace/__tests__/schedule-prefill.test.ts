/**
 * FIX-2 价格表从招标分析带入 — 纯逻辑测试（收集 / 读取 / 数量与单位的规则 / 生成粘贴文本）+ 接线断言
 * 运行：npx tsx src/lib/tender-bid-workspace/__tests__/schedule-prefill.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mapV2Result } from "@/lib/tender-auto-analysis/v2-map";
import { CRITICAL_FACT_TYPES, type AnalysisResultV2, type CriticalFactSlotV2, type CriticalFactType } from "@/lib/tender-understanding/contract";
import { PRICE_SCHEDULE_UOMS } from "@/lib/tender-price-schedule/contract";
import { MAX_SCHEDULE_LINES } from "../contract";
import { parseSchedulePaste } from "../paste-import";
import {
  PREFILL_MAX_ROWS,
  SCHEDULE_CANDIDATES_MAX,
  SCHEDULE_CANDIDATES_VERSION,
  buildSchedulePrefill,
  collectScheduleCandidates,
  normalizeUomText,
  parseQuantityText,
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

const ev = (pageNumber: number) => [{ documentId: "d1", pageNumber, snippet: "x" }];
const req = (id: string, o: Partial<{ statement: string; object: string | null; quantity: string | null; unit: string | null; status: string; page: number }> = {}) => ({
  id, statement: o.statement ?? `Supply item ${id}`, object: o.object === undefined ? `Item ${id}` : o.object, quantity: o.quantity ?? null, unit: o.unit ?? null, status: o.status ?? "ACTIVE", evidence: ev(o.page ?? 3),
});
const fact = (claim: string, o: Partial<{ factType: string; rawValue: string | null; status: string; page: number }> = {}) => ({
  factType: o.factType ?? "quantity", claim, rawValue: o.rawValue ?? null, status: o.status ?? "ACTIVE", evidence: ev(o.page ?? 7),
});
const C = (description: string, quantityText: string | null, unitText: string | null = null, o: Partial<ScheduleCandidate> = {}): ScheduleCandidate => ({ source: "requirement", code: null, description, quantityText, unitText, page: 3, ...o });

/* ---------- 1. 收集数量线索 ---------- */
console.log("入库：收集数量线索");
{
  const block = collectScheduleCandidates({
    requirements: [
      req("R1", { object: "Twin Mattress Cover", quantity: "2,367", unit: "Each", page: 12 }),
      req("R2", { quantity: null, unit: null }),
      req("R3", { quantity: "500", unit: "EA", status: "SUPERSEDED" }),
      req("R4", { quantity: "40", unit: null, status: "NEEDS_REVIEW", object: null, statement: "Provide  forty\n pillow\tprotectors" }),
      req("R5", { quantity: null, unit: "Box", status: "CONFLICT" }),
    ],
    facts: [
      fact("Estimated annual volume of laundry bags", { rawValue: "approx. 120 per year", page: 9 }),
      fact("Owner: Example County", { factType: "buyer" }),
      fact("Old quantity", { rawValue: "999", status: "SUPERSEDED" }),
      fact("Up to 300 units per order"),
    ],
  });
  ok("带版本号", block.version === SCHEDULE_CANDIDATES_VERSION && block.version === 1);
  ok("带数量或单位的有效要求被收下：原文原样（2,367 不改成 2367、Each 不改写），带要求编号与页码", JSON.stringify(block.items[0]) === JSON.stringify({ source: "requirement", code: "R1", description: "Twin Mattress Cover", quantityText: "2,367", unitText: "Each", page: 12 }));
  ok("待复核（NEEDS_REVIEW）的要求也收；没有「对象」时用整句，换行与制表符并成一个空格", block.items[1].code === "R4" && block.items[1].description === "Provide forty pillow protectors" && block.items[1].unitText === null);
  ok("不带数量与单位的要求、被取代的、有冲突的都不收", !block.items.some((i) => ["R2", "R3", "R5"].includes(i.code ?? "")));
  ok("有效的数量类事实被收下：数量原文取原文值，没有单位，没有要求编号", JSON.stringify(block.items[2]) === JSON.stringify({ source: "fact", code: null, description: "Estimated annual volume of laundry bags", quantityText: "approx. 120 per year", unitText: null, page: 9 }));
  ok("事实没有原文值时，数量原文取它的说法", block.items[3].quantityText === "Up to 300 units per order");
  ok("不是数量类的事实、被取代的事实不收；一共 4 条", block.items.length === 4);
  ok("没有任何数量线索时是一个空清单（不是没有这个键）", JSON.stringify(collectScheduleCandidates({ requirements: [req("R1")], facts: [] })) === JSON.stringify({ version: 1, items: [] }));
  const many = collectScheduleCandidates({ requirements: Array.from({ length: SCHEDULE_CANDIDATES_MAX + 50 }, (_, i) => req(`R${i}`, { quantity: String(i + 1) })), facts: [] });
  ok(`一份分析最多存 ${SCHEDULE_CANDIDATES_MAX} 条`, many.items.length === SCHEDULE_CANDIDATES_MAX);
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
    facts: [{ id: "f1", factType: "quantity", claim: "Estimated annual laundry bags", rawValue: "approx. 120 per year", normalizedValue: null, confidence: "HIGH", evidence: ev(9), sourceRole: "BASE_TENDER", status: "ACTIVE" }],
    requirements: [
      { ...base, id: "REQ-001", statement: "Supply 2,367 twin mattress covers.", object: "Twin Mattress Cover", quantity: "2,367", unit: "Each", status: "ACTIVE", evidence: ev(12) },
      { ...base, id: "REQ-002", statement: "Covers shall be flame retardant.", object: null, quantity: null, unit: null, status: "ACTIVE", evidence: ev(13) },
      { ...base, id: "REQ-003", statement: "Old line.", object: "Old", quantity: "5", unit: "EA", status: "SUPERSEDED", evidence: ev(14) },
    ],
    mandatoryRequirementIds: [], submissionChecklist: [], risks: [], conflicts: [], clarifications: [], resolvedAmbiguities: [], addendumChanges: [], nextActions: [], limitations: [], unknowns: [],
    evidenceCoverage: { factsWithEvidence: 1, factsTotal: 1, requirementsWithEvidence: 3, requirementsTotal: 3 },
    metadata: { analyzerVersion: "tender-understanding-v2", resultVersion: "tender-analysis-result-v2", projectId: "p1", startedAt: "", finishedAt: "", wallTimeMs: 0, llmCalls: 1, llmFailures: 0, models: ["m"], promptUsages: [], pages: 14, windows: 1, rejectedCandidates: [], inputChars: 0, outputChars: 0 },
  } as unknown as AnalysisResultV2;
  const mapped = mapV2Result(result);
  const pricing = mapped.sections.find((s) => s.sectionKey === "PRICING_EVALUATION");
  const stored = readScheduleCandidates(pricing?.structuredJson);
  ok("入库的「价格与评标」一节带着数量线索：那条带数量的要求与那条数量类事实，共 2 条", stored.state === "present" && stored.items.length === 2 && stored.items[0].code === "REQ-001" && stored.items[0].quantityText === "2,367" && stored.items[0].unitText === "Each" && stored.items[0].page === 12 && stored.items[1].source === "fact" && stored.items[1].quantityText === "approx. 120 per year", pricing?.structuredJson);
  ok("入库的要求本身没有变（数量线索是另外保留的）", mapped.requirements.length === 2 && Object.keys(mapped.requirements[0]).sort().join() === "category,chineseTranslation,complianceStatus,evidenceRequired,mandatory,originalRequirement,requirementCode,sourcePage,sourceRefs");
  ok("别的节的结构化字段没有被动到", mapped.sections.filter((s) => s.sectionKey !== "PRICING_EVALUATION").every((s) => !JSON.stringify(s.structuredJson ?? null).includes("scheduleCandidates")));
  const prefill = buildSchedulePrefill(stored.state === "present" ? stored.items : []);
  ok("从入库的内容带入：两行，数量 2367 / 120，单位 Each / 空", prefill.rows.map((r) => `${r.lineNo}|${r.description}|${r.quantity}|${r.uom}`).join(";") === "1|Twin Mattress Cover|2367|Each;2|Estimated annual laundry bags|120|");
}

/* ---------- 2. 读存下的线索 ---------- */
console.log("读存下的线索");
{
  const good = { scheduleCandidates: { version: 1, items: [C("A", "5", "EA"), { source: "fact", code: null, description: "B", quantityText: "7", unitText: null, page: 2 }] }, other: 1 };
  const r = readScheduleCandidates(good);
  ok("认得出当前版本的内容", r.state === "present" && r.items.length === 2 && r.items[1].source === "fact");
  ok("没有这个键 / 整块为空 / 不是对象 → 这份分析是在本功能之前做的", [null, undefined, {}, { count: 3 }, "x", 5, [], { scheduleCandidates: null }, { scheduleCandidates: [] }].every((v) => readScheduleCandidates(v).state === "absent"));
  ok("版本不认识 / items 不是列表 → 同样当作没有（不猜旧数据的形状）", readScheduleCandidates({ scheduleCandidates: { version: 2, items: [] } }).state === "absent" && readScheduleCandidates({ scheduleCandidates: { version: 1, items: "x" } }).state === "absent");
  ok("有键但清单为空 → 有数据、0 条（与「没有键」不同）", JSON.stringify(readScheduleCandidates({ scheduleCandidates: { version: 1, items: [] } })) === JSON.stringify({ state: "present", items: [] }));
  const dirty = readScheduleCandidates({ scheduleCandidates: { version: 1, items: [null, "x", { description: "" }, { description: "  ok  \n item ", quantityText: 5, unitText: ["x"], page: -1, code: "c".repeat(80), source: "weird", price: 99 }] } });
  ok("坏的条目丢掉；字段类型不对的当作没有；多余的字段不带出来", dirty.state === "present" && dirty.items.length === 1 && JSON.stringify(dirty.items[0]) === JSON.stringify({ source: "requirement", code: null, description: "ok item", quantityText: null, unitText: null, page: null }));
}

/* ---------- 3. 数量的取法 ---------- */
console.log("数量：恰好一个数字才取");
{
  const q = (t: string | null) => { const r = parseQuantityText(t); return r.ok ? r.quantity : r.reason; };
  ok("一个数字：取它", q("2367") === "2367" && q("120") === "120" && q("12.5") === "12.5");
  ok("千分位逗号去掉：2,367 → 2367；1,234,567 → 1234567", q("2,367") === "2367" && q("1,234,567") === "1234567");
  ok("带文字的估计量、上限：只有一个数字就取（原文会列在旁边供核对）", q("approx. 120 per year") === "120" && q("Up to 300 units per order") === "300" && q("estimated 2,500 EA") === "2500");
  ok("范围不取：100-200、100 – 200、100 to 200、between 100 and 200、100~200", ["100-200", "100 – 200", "100 to 200", "between 100 and 200", "100~200", "50 至 80"].every((t) => q(t) === "range"));
  ok("不止一个数字不取（不猜取哪个）：3 lots of 50、Item 3: 120 EA、120 (2 per room)", ["3 lots of 50", "Item 3: 120 EA", "120 (2 per room)", "4 x 25"].every((t) => q(t) === "multiple"));
  ok("没有数字不取：as required、TBD、待定", ["as required", "TBD", "待定", "various"].every((t) => q(t) === "no_number"));
  ok("没有写数量", q(null) === "missing" && q("") === "missing" && q("   ") === "missing");
  ok("金额与百分比不是件数：$5,000、10% 不算数；和件数一起出现时只取件数", q("$5,000") === "no_number" && q("10%") === "no_number" && q("120 units at $45") === "120" && q("up to 10% over 500") === "500");
  ok("「1,23」这种不是千分位的写法不合并（当成两个数字，不取）", q("1,23") === "multiple");
  ok("确定性：同样的输入两次结果相同", JSON.stringify(parseQuantityText("approx. 120 per year")) === JSON.stringify(parseQuantityText("approx. 120 per year")));
}

/* ---------- 单位对照 ---------- */
console.log("单位：固定对照，认不出的原样保留");
{
  const cases: Array<[string, string]> = [["EA", "Each"], ["ea.", "Each"], ["each", "Each"], ["pcs", "Each"], ["Piece", "Each"], ["units", "Each"], ["Boxes", "Box"], ["bx", "Box"], ["rolls", "Roll"], ["PR", "Pair"], ["sets", "Set"], ["cs", "Case"], ["Bags", "Bag"], ["pkg", "Pack"], ["KGS", "kg"], ["metres", "m"], ["Feet", "ft"], ["sq ft", "sqft"], ["SF", "sqft"], ["Square Feet", "sqft"]];
  ok("对照表里的写法都规整到单位目录", cases.every(([raw, want]) => normalizeUomText(raw) === want), cases.filter(([raw, want]) => normalizeUomText(raw) !== want));
  ok("规整出来的每一个都在价格表的单位目录里", cases.every(([, want]) => (PRICE_SCHEDULE_UOMS as readonly string[]).includes(want)));
  ok("目录里的每个单位都有自己的写法能对上", PRICE_SCHEDULE_UOMS.every((u) => normalizeUomText(u) === u && normalizeUomText(u.toUpperCase()) === u));
  ok("认不出的原样保留，不猜：LF（延长英尺）不会变成 ft；dozen、lot、yd 都原样", normalizeUomText("LF") === "LF" && normalizeUomText("dozen") === "dozen" && normalizeUomText("lot") === "lot" && normalizeUomText("yd") === "yd");
  ok("没有单位 → 空", normalizeUomText(null) === "" && normalizeUomText("  ") === "");
}

/* ---------- 生成粘贴文本 ---------- */
console.log("生成价格表的行");
{
  const items = [
    C("Twin Mattress Cover", "2,367", "Each", { page: 12 }),
    C("Laundry bags", "approx. 120 per year", null, { source: "fact", page: 9 }),
    C("Pillows", "100-200", "EA"),
    C("Blankets", "as required", "EA"),
    C("Sheets", "3 lots of 50", "EA"),
    C("Twin  Mattress\tCover", "2367", "ea"), // 与第 1 条说明、数量、单位都相同（规整后）→ 重复
    C("Curtain track", "40", "LF"),
    C("Towels", null, "Box"),
  ];
  const p = buildSchedulePrefill(items);
  ok("能确定的带入，行号从 1 连续", p.rows.map((r) => `${r.lineNo}:${r.description}:${r.quantity}:${r.uom}`).join("|") === "1:Twin Mattress Cover:2367:Each|2:Laundry bags:120:|3:Curtain track:40:LF");
  ok("不能确定的不带入，各有原因", p.skipped.map((k) => `${k.description}=${k.reasonZh}`).join("|") === "Pillows=数量是一个范围|Blankets=数量原文里没有数字|Sheets=数量原文里有不止一个数字|Towels=没有写数量");
  ok("说明、数量、单位都相同的重复线索只留一条（也不算进「没带入」）", p.rows.filter((r) => r.description === "Twin Mattress Cover").length === 1 && p.skipped.length === 4);
  ok("每一行带着原文与页码供人核对", p.rows[0].quantityText === "2,367" && p.rows[0].unitText === "Each" && p.rows[0].page === 12 && p.rows[1].unitText === null && p.rows[1].source === "fact");
  ok("生成的文本：每行「行号 ⇥ 说明 ⇥ 数量 ⇥ 单位」", p.text === "1\tTwin Mattress Cover\t2367\tEach\n2\tLaundry bags\t120\t\n3\tCurtain track\t40\tLF");

  const parsed = parseSchedulePaste(p.text);
  ok("交给既有的粘贴解析：有单位的行逐项相同（行号、说明、数量、单位），尺寸、包装数、认证要求为空", !parsed.skippedHeader && parsed.lines.map((l) => `${l.lineNo}:${l.description}:${l.quantity}:${l.uom}:${l.packCount}:${l.dimensions}:${l.certificationGate}`).join("|") === "1:Twin Mattress Cover:2367:Each:null:null:null|3:Curtain track:40:LF:null:null:null", parsed);
  ok("没有单位的那一行，既有的解析照常报「缺少单位」（由人补，不是悄悄带进去）", parsed.issues.length === 1 && parsed.issues[0].row === 2 && parsed.issues[0].messageZh.includes("缺少单位"));

  const tricky = buildSchedulePrefill([C('Cover,\t"Queen"\nsize, 60" x 80"', "15", "EA"), C("  ", "5", "EA"), C("Plain", "8", "EA")]);
  const parsedTricky = parseSchedulePaste(tricky.text);
  ok("说明里有制表符、换行、引号、逗号：不会把一行拆成两行或多出一列；空说明的线索丢掉", tricky.rows.length === 2 && parsedTricky.lines.length === 2 && parsedTricky.issues.length === 0 && parsedTricky.lines[0].quantity === "15" && parsedTricky.lines[0].uom === "Each" && parsedTricky.lines[0].description === tricky.rows[0].description && !tricky.rows[0].description.includes("\t") && !tricky.rows[0].description.includes("\n"), { text: tricky.text, parsed: parsedTricky });

  ok(`一次最多带入的行数与价格表的上限一致（${MAX_SCHEDULE_LINES}）`, PREFILL_MAX_ROWS === MAX_SCHEDULE_LINES);
  const capped = buildSchedulePrefill(Array.from({ length: 5 }, (_, i) => C(`Item ${i}`, String(i + 1), "EA")), 3);
  ok("超过上限的列在「没带入」里并说明", capped.rows.length === 3 && capped.skipped.length === 2 && capped.skipped[0].reasonZh.includes("超过一次最多 3 行"));
  ok("没有线索 → 空文本、0 行", JSON.stringify(buildSchedulePrefill([])) === JSON.stringify({ text: "", rows: [], skipped: [] }));
  ok("结果里没有价格、成本、毛利之类的字段", Object.keys(p.rows[0]).sort().join() === "description,lineNo,page,quantity,quantityText,source,unitText,uom" && Object.keys(p.skipped[0]).sort().join() === "description,page,quantityText,reasonZh");
}

/* ---------- 给人看的那句话 ---------- */
console.log("说明文字");
{
  const p = buildSchedulePrefill([C("A", "5", "EA"), C("B", "7", null), C("C", "1-2", "EA")]);
  const msg = schedulePrefillMessageZh("ready", p);
  ok("带入了几行、几行没有单位、几条没带入，都写明；并写明要逐行核对、还没有保存", msg.includes("带入了 2 行") && msg.includes("1 行没有单位") && msg.includes("1 条数量看不准") && msg.includes("逐行核对") && msg.includes("还没有保存"));
  ok("没有可用的分析 / 分析是旧的：各有说明", schedulePrefillMessageZh("no_analysis", p).includes("还没有可用的招标分析") && schedulePrefillMessageZh("legacy_analysis", p).includes("重新分析后才能带入"));
  ok("分析里一条带数量的都没有：照实说，提示照旧粘贴", schedulePrefillMessageZh("ready", { rows: [], skipped: [] }).includes("没有抽到带数量的行"));
}

/* ---------- 接线（源码断言） ---------- */
console.log("接线");
{
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  const route = read("src/app/api/projects/[id]/bid-workspace/schedule-candidates/route.ts");
  const service = read("src/lib/tender-bid-workspace/schedule-prefill-service.ts");
  const panel = read("src/components/tender/bid-workspace-panel.tsx");
  const pure = read("src/lib/tender-bid-workspace/schedule-prefill.ts");
  ok("接口：只有 GET；项目读权限；功能开关关闭 404；组织取自项目记录", /export async function GET/.test(route) && !/export async function (POST|PUT|PATCH|DELETE)/.test(route) && route.includes("requireProjectReadAccess(request, projectId)") && route.includes("isBidWorkspaceEnabledForOrg(orgId)") && route.includes("access.project.orgId") && route.includes("status: 404"));
  ok("读取：只读，没有任何写库的调用", !/\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/.test(service) && !/logAudit|writeAuditLog/.test(service));
  ok("读取：按项目与组织取最新一份等待审核或已批准的分析；按要求编号去掉已驳回的", service.includes('where: { projectId: input.projectId, orgId: input.orgId, status: { in: ["REVIEW_REQUIRED", "APPROVED"] } }') && service.includes('reviewStatus: "REJECTED"') && service.includes('sectionKey: "PRICING_EVALUATION"'));
  ok("纯函数文件零依赖（前后端共用）", !/^import /m.test(pure));
  ok("面板：带入只把文本填进粘贴框（setText），保存仍是原来那个按钮；带入的函数里没有调用保存", /if \(data\.state === "ready" && data\.rows\.length > 0\) setText\(data\.text\);/.test(panel) && !/loadPrefill[\s\S]{0,900}onSave\(/.test(panel.slice(panel.indexOf("const loadPrefill"), panel.indexOf("const askPrefill"))));
  ok("面板：粘贴框里已有内容时先确认再替换", /const askPrefill = \(\) => \(text\.trim\(\) \? setConfirmReplace\(true\) : void loadPrefill\(\)\);/.test(panel) && panel.includes("确定替换"));
  ok("面板的测试标记齐全", ["bw-schedule-prefill", "bw-schedule-prefill-confirm", "bw-schedule-prefill-message", "bw-schedule-prefill-rows", "bw-schedule-prefill-skipped"].every((id) => panel.includes(`data-testid="${id}"`)));
}

console.log(`\n✓ schedule-prefill: ${passed} 项断言全部通过`);
