/**
 * TI-2 核算表视图与 Markdown 渲染（纯逻辑 + 源码断言 + 样例文件校验）
 * 运行：npx tsx src/lib/tender-bid-cost/__tests__/sheet-view.test.ts
 * 重新生成样例文件：UPDATE_SAMPLE=1 npx tsx src/lib/tender-bid-cost/__tests__/sheet-view.test.ts
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { computeCostScenario } from "../pricing";
import { renderCostSheetMarkdown } from "../render-markdown";
import { buildCostSheetView, MARK_INCOMPLETE, MARK_INDICATIVE_PRICE, MARK_SENSITIVITY_DUTY } from "../sheet-view";
import { GOLDEN_SCENARIO } from "./fixtures/golden";
import { OTTAWA_SAMPLE_DOC_HEADER, OTTAWA_SAMPLE_DOC_PATH, OTTAWA_SYNTHETIC_SCENARIO } from "./fixtures/ottawa-synthetic-scenario";

let passed = 0;
function ok(name: string, cond: boolean) { assert.equal(cond, true, name); passed += 1; console.log(`  ✓ ${name}`); }
const MONEY = /-?\d{1,3}(?:,\d{3})*\.\d{2}(?!\d)/g;
const cents = (s: string) => Math.round(Number(s.replace(/,/g, "")) * 100);

console.log("tender-bid-cost sheet-view");

{
  const s = computeCostScenario(GOLDEN_SCENARIO);
  assert.ok(s.ok);
  const view = buildCostSheetView(s);
  const md = renderCostSheetMarkdown(view);
  ok("四块齐全：行项、合计、假设与出处、阻断与提示", ["## 行项", "## 合计", "## 假设与出处", "## 阻断与提示"].every((h) => md.includes(h)) && view.groups.length === 2 && view.assumptions.length > 0);
  ok("按进口、本地分组，各有小计", view.groups.map((g) => g.labelZh).join("/") === "进口/本地" && view.groups[0].subtotal.directCost === "164.12" && view.groups[1].subtotal.directCost === "750.00");
  ok("Markdown 出现 164.12、750.00、914.12、1,252.20", ["164.12", "750.00", "914.12", "1,252.20"].every((n) => md.includes(n)));
  const viewText = JSON.stringify(view);
  const figures = md.match(MONEY) ?? [];
  ok(`Markdown 里的 ${figures.length} 个金额全部出自视图`, figures.length > 20 && figures.every((f) => viewText.includes(f)));
  ok("合计块：毛利率 27.0%、加成率 37.0%、扣预备金后 25.0%、进口 GST 现金流 4.96",
    view.totals.grossMarginPct === "27.0%" && view.totals.markupPct === "37.0%" && view.totals.netMarginPct === "25.0%" && view.totals.importGstCash === "4.96");
  ok("报价标明不含 HST，表内没有 HST 金额", view.totals.taxNote === "不含 HST" && md.includes("报价（不含 HST）") && !/HST[^）\n|]*\d/.test(md));
  ok("金标情景没有任何标记，阻断块写「无。」", view.totals.marks.length === 0 && view.blockers.length === 0 && md.includes("无。"));
  ok("每行显示证据类别", view.groups.every((g) => g.rows.every((r) => r.evidence === "已签报价")));
  ok("假设与出处：汇率、关税、进口 GST、预备金、定价口径都在", ["汇率 USD → CAD", "第 1 行关税率", "进口 GST", "预备金：风险预备金", "定价口径"].every((k) => view.assumptions.some((a) => a.item === k)));
  ok("汇率与已核实关税带来源与日期", view.assumptions.find((a) => a.item === "汇率 USD → CAD")?.asOf === "2026-11-01" && !!view.assumptions.find((a) => a.item === "第 1 行关税率")?.basisKind.startsWith("已核实"));
}
{
  const partial = computeCostScenario({ ...GOLDEN_SCENARIO, lines: [{ ...GOLDEN_SCENARIO.lines[0], duty: null, fx: { rateCadPerUnit: "1.40", source: "MANUAL" } }, GOLDEN_SCENARIO.lines[1]] });
  assert.ok(partial.ok);
  const view = buildCostSheetView(partial);
  const md = renderCostSheetMarkdown(view);
  ok("为空的行显示「—」而不是 0", view.groups[0].rows[0].directCost === "—" && view.groups[0].rows[0].unitBid === "—");
  ok("阻断块列出该行与全部原因", view.blockers.length === 1 && view.blockers[0].lineNo === 1 && view.blockers[0].reasons.includes("缺关税率") && view.blockers[0].reasons.includes("缺汇率日期") && md.includes("第 1 行"));
  ok("合计块标「不完整」", view.totals.marks.includes(MARK_INCOMPLETE));
}
{
  const note = "整柜装不下的部分走拼柜";
  const blended = computeCostScenario({
    ...GOLDEN_SCENARIO,
    freight: { blendNote: note, plans: [
      { key: "fcl", mode: "FCL", charges: [{ label: "海运费", amountCad: "10", allocation: "BY_VALUE" }] },
      { key: "lcl", mode: "LCL", charges: [{ label: "拼柜费", amountCad: "5", allocation: "BY_VALUE" }] },
    ] },
  });
  assert.ok(blended.ok);
  const view = buildCostSheetView(blended);
  const md = renderCostSheetMarkdown(view);
  ok("混合运费：假设与出处块、阻断与提示块都显示说明",
    view.assumptions.some((a) => a.item === "运费方案混合" && a.value === note) && view.notices.some((n) => n.includes(note)) && md.split(note).length === 3);
}
{
  const s = computeCostScenario(OTTAWA_SYNTHETIC_SCENARIO);
  assert.ok(s.ok);
  const view = buildCostSheetView(s, { title: "成本核算表（样例）" });
  const rows = view.groups.flatMap((g) => g.rows);
  ok("渥太华样例：行项块 18 行（进口 15 + 本地 3）", rows.length === 18 && view.groups[0].rows.length === 15 && view.groups[1].rows.length === 3);
  ok("3 行平台标价被标出，合计块带「含指示性价格」", rows.filter((r) => r.evidence === "平台标价").length === 3 && view.totals.marks.includes(MARK_INDICATIVE_PRICE));
  ok("未核实关税：合计块与进口行都带标记", view.totals.marks.includes(MARK_SENSITIVITY_DUTY) && view.groups[0].rows.every((r) => r.marks.includes(MARK_SENSITIVITY_DUTY)));
  ok("第 12 行显示超购 768 件", rows.find((r) => r.lineNo === 12)!.marks.some((m) => m === "超购 768 件"));
  const sumOf = (pick: (r: (typeof rows)[number]) => string) => rows.reduce((a, r) => a + cents(pick(r)), 0);
  ok("合计块各项等于逐行之和", sumOf((r) => r.directCost) === cents(view.totals.directCost) && sumOf((r) => r.extended) === cents(view.totals.bidExclHst) && sumOf((r) => r.profit) === cents(view.totals.profit));
  ok("整票运费 6,950.00 全部分摊到进口行，本地行只有境内运费", cents(view.groups[0].subtotal.freight) === 695000 && cents(view.groups[1].subtotal.freight) === 260000);
  ok("每行五个分项相加等于直接成本", rows.every((r) => cents(r.goods) + cents(r.duty) + cents(r.freight) + cents(r.localDelivery) + cents(r.other) === cents(r.directCost)));

  const doc = OTTAWA_SAMPLE_DOC_HEADER + renderCostSheetMarkdown(view);
  const path = join(process.cwd(), OTTAWA_SAMPLE_DOC_PATH);
  if (process.env.UPDATE_SAMPLE === "1") { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, doc, "utf8"); }
  ok("样例文件存在且与当前渲染一致", existsSync(path) && readFileSync(path, "utf8") === doc);
  ok("样例文件头注明合成数据", doc.startsWith("> **合成数据，不是报价。**"));
}
{
  // 源码断言：纯函数，不碰数据库、网络、模型；不推断竞争对手
  const dir = join(process.cwd(), "src/lib/tender-bid-cost");
  const sources = readdirSync(dir).filter((f) => f.endsWith(".ts")).map((f) => ({ f, text: readFileSync(join(dir, f), "utf8") }));
  ok("目录下有 7 个源码文件", sources.length === 7);
  const banned = /@\/lib\/db\b|@\/lib\/ai\b|\bfetch\s*\(|createCompletion|\bdb\.[a-zA-Z]+\.(find|create|update|delete|upsert)/;
  ok("没有数据库 / 网络 / 模型调用的引用", sources.every((s) => !banned.test(s.text)));
  ok("没有竞争对手成本或毛利的字段", sources.every((s) => !/competitor(Cost|Price|Margin)|rival/i.test(s.text)));
}

console.log(`\ntender-bid-cost sheet-view: ${passed} passed`);
