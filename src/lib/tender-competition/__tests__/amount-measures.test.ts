/**
 * TI-3a 历史金额口径（纯逻辑 + 源码断言）
 * 运行：npx tsx src/lib/tender-competition/__tests__/amount-measures.test.ts
 * 覆盖任务书验收项 A15（评标总价、实付、预算估计各有类型，永不相加）。
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { AMOUNT_MEASURES, AMOUNT_MEASURE_ZH, sumSameMeasure, summarizeByMeasure, type MeasuredAmount } from "../amount-measures";

let passed = 0;
function ok(name: string, cond: boolean) { assert.equal(cond, true, name); passed += 1; console.log(`  ✓ ${name}`); }
const a = (measure: MeasuredAmount["measure"], amount: string, currency = "CAD"): MeasuredAmount => ({ measure, amount, currency });

console.log("tender-competition amount-measures");

{
  ok("九个口径：采购资料的六个 + 授标值、预算估计 + 未识别", AMOUNT_MEASURES.length === 9 && ["CEILING", "EVALUATED", "COMMITTED", "ORDERED", "INVOICED", "PAID", "AWARD_VALUE", "ESTIMATE", "UNKNOWN"].every((m) => (AMOUNT_MEASURES as readonly string[]).includes(m)));
  ok("每个口径都有中文名", AMOUNT_MEASURES.every((m) => AMOUNT_MEASURE_ZH[m].length > 0));
  const mixed = sumSameMeasure([a("EVALUATED", "120000.00"), a("PAID", "86500.00")]);
  ok("评标价与实付不相加", !mixed.ok && mixed.code === "MIXED_MEASURE" && mixed.messageZh.includes("口径不同"));
  const fx = sumSameMeasure([a("PAID", "100.00", "CAD"), a("PAID", "100.00", "usd")]);
  ok("币种不同不相加", !fx.ok && fx.code === "MIXED_CURRENCY");
  const paid = sumSameMeasure([a("PAID", "86500.00"), a("PAID", "13500.00")]);
  ok("同口径同币种可相加：实付 100,000.00", paid.ok && paid.total.toFixed(2) === "100000.00" && paid.measure === "PAID" && paid.count === 2);
  ok("未识别口径不能求和", (() => { const r = sumSameMeasure([a("UNKNOWN", "1.00")]); return !r.ok && r.code === "UNKNOWN_MEASURE"; })());
  ok("空清单 / 无法解析的金额 → 拒绝", !sumSameMeasure([]).ok && !sumSameMeasure([a("PAID", "abc")]).ok);
  ok("预算估计与授标值也不相加", !sumSameMeasure([a("ESTIMATE", "150000"), a("AWARD_VALUE", "120000")]).ok);
}
{
  const s = summarizeByMeasure([a("EVALUATED", "120000.00"), a("PAID", "86500.00"), a("PAID", "13500.00"), a("ESTIMATE", "150000.00"), a("UNKNOWN", "999.00")]);
  const pick = (m: string) => s.groups.find((g) => g.measure === m)?.total;
  ok("按口径分别汇总：评标价 120,000.00、实付 100,000.00、预算估计 150,000.00", s.groups.length === 3 && pick("EVALUATED") === "120000.00" && pick("PAID") === "100000.00" && pick("ESTIMATE") === "150000.00");
  ok("结果里没有跨口径的总数", !/"(grandTotal|total|sum|overall)"\s*:/.test(JSON.stringify({ ...s, groups: undefined })) && !Object.keys(s).some((k) => /total|sum/i.test(k)));
  ok("未识别口径被排除并如实说明", s.excluded.length === 1 && s.excluded[0].count === 1 && s.excluded[0].reasonZh.includes("未识别"));
  const multi = summarizeByMeasure([a("PAID", "10", "CAD"), a("PAID", "20", "USD")]);
  ok("同口径不同币种分成两组", multi.groups.length === 2 && multi.groups.every((g) => g.measure === "PAID"));
}
{
  // 源码断言：线索层是纯函数；不发信、不联系对手、不推断对手价格
  const dir = join(process.cwd(), "src/lib/tender-competition");
  const sources = readdirSync(dir).filter((f) => f.endsWith(".ts")).map((f) => ({ f, text: readFileSync(join(dir, f), "utf8") }));
  ok("目录下有 5 个源码文件", sources.length === 5);
  const banned = /@\/lib\/db\b|@\/lib\/ai\b|\bfetch\s*\(\s*["'`h]|createCompletion|\bdb\.[a-zA-Z]+\.(find|create|update|delete|upsert)|sendGmail|requestApproval|google-email/;
  ok("没有数据库 / 网络 / 模型调用 / 发信的引用", sources.every((s) => !banned.test(s.text)));
  ok("没有竞争对手投标价、成本、毛利的字段", sources.every((s) => !/(competitor|rival|importer)(Bid|Price|Cost|Margin)/i.test(s.text)));
}

console.log(`\ntender-competition amount-measures: ${passed} passed`);
