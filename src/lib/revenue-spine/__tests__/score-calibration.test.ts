/**
 * Revenue Spine — 评分校准（B-4）纯函数测试，无 DB。
 *   结局口径（won / lost / 未定、报价判定）、维度归一与分桶边界、命中率与区分度、无法评估、等级表、
 *   建议权重（最大余数法、保留无法评估维度、和恒等于现有总额）、样本不足 / 无信号、policy 片段可合并、确定性
 * 运行：npx tsx src/lib/revenue-spine/__tests__/score-calibration.test.ts
 *
 * 公开仓库：只用虚构数据。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_REVENUE_SPINE_POLICY, mergeRevenueSpinePolicy } from "../policy";
import {
  CALIBRATION_DIMENSIONS,
  CALIBRATION_MIN_DECIDED,
  QUOTE_REACHED_STAGES,
  bucketOf,
  calibrationPolicySnippet,
  calibrationSnippetText,
  computeScoreCalibration,
  normalizedDimensions,
  outcomeOfStage,
  parseCalibrationDays,
  quoteResolved,
  reachedQuote,
  suggestWeights,
  type CalibrationDimensionKey,
  type CalibrationRow,
  type ScoreCalibrationReport,
} from "../score-calibration";

let pass = 0;
function ok(name: string, fn: () => void) {
  fn();
  pass++;
  console.log(`  ✓ ${name}`);
}

const NOW = new Date("2026-10-24T12:00:00Z");
const W = DEFAULT_REVENUE_SPINE_POLICY.scoring.weights; // 25 / 20 / 20 / 15 / 10 / 10
const KEYS = CALIBRATION_DIMENSIONS.map((d) => d.key);

/** 六维得分（满分取默认权重） */
function dims(s: Record<CalibrationDimensionKey, number>, max: Partial<Record<CalibrationDimensionKey, number>> = {}) {
  return CALIBRATION_DIMENSIONS.map(({ key, label }) => ({ key, label, score: s[key], max: max[key] ?? W[key], reason: "虚构理由" }));
}

function row(over: Partial<CalibrationRow> & { stage: string }): CalibrationRow {
  return { grade: null, dimensions: [], quoteSent: false, onboardingTest: false, ...over };
}

function times<T>(n: number, f: (i: number) => T): T[] {
  return Array.from({ length: n }, (_, i) => f(i));
}

const close = (a: number | null, b: number) => {
  assert.ok(a !== null, "期望数值，实际为空");
  assert.ok(Math.abs((a as number) - b) < 1e-12, `${a} ≠ ${b}`);
};

const dim = (r: ScoreCalibrationReport, key: CalibrationDimensionKey) => r.dimensions.find((d) => d.key === key)!;

// ── 固定样本：32 个已定 + 3 个未定 + 3 个排除 ──────────────────────────────
// A 10 赢：各维看好，战略 0；B 2 赢：多数不看好；C 15 输：战略看好；D 5 输：与 A 同分
const A = { productFit: 25, commercialPotential: 20, buyerQuality: 14, intent: 15, completeness: 10, strategicValue: 0 };
const B = { productFit: 5, commercialPotential: 8, buyerQuality: 10, intent: 3, completeness: 10, strategicValue: 0 };
const C = { productFit: 5, commercialPotential: 8, buyerQuality: 6, intent: 3, completeness: 10, strategicValue: 10 };
const D = A;

const FIXED: CalibrationRow[] = [
  ...times(10, () => row({ stage: "won", grade: "HOT", dimensions: dims(A) })),
  ...times(2, () => row({ stage: "won", grade: "MEDIUM", dimensions: dims(B) })),
  ...times(15, (i) => row({ stage: "lost", grade: "LOW", dimensions: dims(C), quoteSent: i < 5 })),
  ...times(5, () => row({ stage: "lost", grade: "HIGH", dimensions: dims(D), quoteSent: true })),
  // 未定
  row({ stage: "rfq_ready", grade: "HOT", dimensions: dims(A) }),
  row({ stage: "quoted", grade: null, dimensions: dims(A) }),
  row({ stage: "nurture", grade: "BOGUS", dimensions: dims(A) }),
  // 排除：入驻测试已赢、入驻测试 + 不合格（只计测试）、普通不合格
  row({ stage: "won", grade: "HOT", dimensions: dims(A), onboardingTest: true }),
  row({ stage: "disqualified", grade: "LOW", dimensions: dims(C), onboardingTest: true }),
  row({ stage: "disqualified", grade: "LOW", dimensions: dims(C) }),
];

const report = computeScoreCalibration(FIXED, { weights: W, windowDays: 90, now: NOW });

console.log("\n结局口径");

ok("赢 = won、输 = lost，其余（含培育 / 搁置 / 开放阶段）未定", () => {
  assert.equal(outcomeOfStage("won"), "won");
  assert.equal(outcomeOfStage("lost"), "lost");
  for (const s of ["nurture", "stale", "new_inquiry", "quoted", "negotiation", "completed"]) assert.equal(outcomeOfStage(s), "open");
});

ok("报价及之后的阶段 = 开放态中报价前之后的部分 + won（引用阶段常量）", () => {
  assert.deepEqual([...QUOTE_REACHED_STAGES], ["quoted", "follow_up", "sample", "negotiation", "won"]);
});

ok("场景「丢单前报过价」：lost + QUOTE_SENT → 输、曾报价、已见分晓", () => {
  assert.equal(reachedQuote("lost", true), true);
  assert.equal(quoteResolved("lost", true), true);
  const r = computeScoreCalibration([row({ stage: "lost", quoteSent: true })], { weights: W, windowDays: 90, now: NOW });
  assert.equal(r.sample.lost, 1);
  assert.equal(r.sample.quoted, 1);
  assert.equal(r.sample.quoteResolved, 1);
});

ok("场景「报价前仍在推进」：rfq_ready 无报价 → 不进赢单率，也不进报价率分母", () => {
  assert.equal(reachedQuote("rfq_ready", false), false);
  assert.equal(quoteResolved("rfq_ready", false), false);
  const r = computeScoreCalibration([row({ stage: "rfq_ready" })], { weights: W, windowDays: 90, now: NOW });
  assert.equal(r.sample.n, 1);
  assert.equal(r.sample.decided, 0);
  assert.equal(r.sample.quoteResolved, 0);
  assert.equal(r.sample.winRate, null);
  assert.equal(r.sample.quoteRate, null);
});

ok("场景「培育中」：lost → nurture 按未定，不进赢单率；已离开报价前阶段 → 报价已见分晓、未报价", () => {
  const r = computeScoreCalibration([row({ stage: "nurture" })], { weights: W, windowDays: 90, now: NOW });
  assert.equal(r.sample.open, 1);
  assert.equal(r.sample.decided, 0);
  assert.equal(r.sample.quoteResolved, 1);
  assert.equal(r.sample.quoted, 0);
});

ok("与 /revenue 同口径：cockpit.ts 按 stage = won 计成交；transition.ts 进入 quoted 才写 QUOTE_SENT", () => {
  const cockpit = readFileSync(join(process.cwd(), "src/lib/revenue-spine/cockpit.ts"), "utf8");
  assert.match(cockpit, /stage: "won"/);
  const transition = readFileSync(join(process.cwd(), "src/lib/revenue-spine/transition.ts"), "utf8");
  assert.match(transition, /quoted: \["QUOTE_SENT"\]/);
});

console.log("\n样本计数与排除");

ok("场景「入驻测试与不合格」：两条都命中只计测试；排除的不进任何比率", () => {
  assert.equal(report.sample.excludedOnboardingTest, 2);
  assert.equal(report.sample.excludedDisqualified, 1);
  assert.equal(report.sample.n, 35);
  assert.equal(report.sample.decided, 32);
  assert.equal(report.sample.won, 12);
  assert.equal(report.sample.lost, 20);
  assert.equal(report.sample.open, 3);
  close(report.sample.winRate, 12 / 32);
});

ok("报价：已见分晓 34（32 已定 + quoted + nurture）、曾报价 23（12 赢 + 10 输 + quoted）", () => {
  assert.equal(report.sample.quoteResolved, 34);
  assert.equal(report.sample.quoted, 23);
  close(report.sample.quoteRate, 23 / 34);
});

console.log("\n维度归一与分桶");

ok("场景「分桶边界」：0.399 / 0.4 / 0.7 / 1 → 低 / 中 / 高 / 高；14/20、7/10 稳定归入高桶", () => {
  assert.deepEqual([0.399, 0.4, 0.7, 1].map(bucketOf), ["low", "mid", "high", "high"]);
  assert.equal(bucketOf(14 / 20), "high");
  assert.equal(bucketOf(7 / 10), "high");
  assert.equal(bucketOf(0), "low");
});

ok("按当时满分归一：满分 30 时 15 分 = 0.5，与满分 20 时 10 分可比", () => {
  const a = normalizedDimensions(dims({ ...A, productFit: 15 }, { productFit: 30 }));
  const b = normalizedDimensions(dims({ ...A, productFit: 10 }, { productFit: 20 }));
  assert.equal(a.productFit, 0.5);
  assert.equal(b.productFit, 0.5);
});

ok("满分 ≤ 0、得分非数字、缺维度、未知键、非数组：该维不计；重复键取第一条；超界截到 0–1", () => {
  const v = normalizedDimensions([
    { key: "productFit", score: 5, max: 0 },
    { key: "commercialPotential", score: "10", max: 20 },
    { key: "intent", score: 30, max: 15 },
    { key: "intent", score: 0, max: 15 },
    { key: "completeness", score: -3, max: 10 },
    { key: "unknown", score: 1, max: 1 },
    null,
  ]);
  assert.deepEqual(v, { intent: 1, completeness: 0 });
  assert.deepEqual(normalizedDimensions(null), {});
  assert.deepEqual(normalizedDimensions({ productFit: 1 }), {});
  const r = computeScoreCalibration([row({ stage: "won", dimensions: [{ key: "intent", score: 3, max: 0 }] })], { weights: W, windowDays: 90, now: NOW });
  assert.equal(dim(r, "intent").evaluated, 0);
  assert.equal(r.sample.decided, 1);
});

ok("Product Fit 分桶：低 17（赢 2）、中 0（比率为空）、高 15（赢 10）+ 3 个未定计入样本数", () => {
  const pf = dim(report, "productFit");
  assert.equal(pf.evaluated, 35);
  assert.deepEqual(
    { n: pf.buckets.low.n, decided: pf.buckets.low.decided, won: pf.buckets.low.won },
    { n: 17, decided: 17, won: 2 },
  );
  close(pf.buckets.low.winRate, 2 / 17);
  assert.equal(pf.buckets.mid.n, 0);
  assert.equal(pf.buckets.mid.winRate, null);
  assert.equal(pf.buckets.mid.quoteRate, null);
  assert.equal(pf.buckets.high.n, 18);
  assert.equal(pf.buckets.high.decided, 15);
  close(pf.buckets.high.winRate, 10 / 15);
  // 高桶报价：已见分晓 15 + quoted + nurture = 17；曾报价 10 赢 + 5 D + quoted = 16
  assert.equal(pf.buckets.high.quoteResolved, 17);
  assert.equal(pf.buckets.high.quoted, 16);
});

console.log("\n命中率与区分度");

ok("Product Fit：命中 25 / 32，区分度 = 10/15 − 2/17", () => {
  const pf = dim(report, "productFit");
  assert.equal(pf.decided, 32);
  assert.equal(pf.hits, 25);
  close(pf.hitRate, 25 / 32);
  assert.deepEqual({ d: pf.favorable.decided, w: pf.favorable.won }, { d: 15, w: 10 });
  assert.deepEqual({ d: pf.unfavorable.decided, w: pf.unfavorable.won }, { d: 17, w: 2 });
  close(pf.lift, 10 / 15 - 2 / 17);
  assert.equal(pf.evaluable, true);
});

ok("Buyer Quality：看好 17 赢 12、不看好 15 赢 0 → 区分度 12/17，命中 27", () => {
  const bq = dim(report, "buyerQuality");
  close(bq.lift, 12 / 17);
  assert.equal(bq.hits, 27);
});

ok("Strategic Value：区分度为负（−12/17）", () => {
  close(dim(report, "strategicValue").lift, -12 / 17);
});

ok("场景「无法评估」：Completeness 已定商机全部看好 → 无法评估、区分度为空", () => {
  const c = dim(report, "completeness");
  assert.equal(c.evaluable, false);
  assert.equal(c.lift, null);
  assert.equal(c.unfavorable.decided, 0);
  assert.equal(c.unfavorable.winRate, null);
  close(c.hitRate, 12 / 32);
});

ok("场景「命中率与区分度」：看好 2 赢 2、不看好 2 赢 0 → 命中率 1、区分度 1", () => {
  const fav = dims({ ...B, intent: 15 });
  const unfav = dims({ ...B, intent: 0 });
  const r = computeScoreCalibration(
    [row({ stage: "won", dimensions: fav }), row({ stage: "won", dimensions: fav }), row({ stage: "lost", dimensions: unfav }), row({ stage: "lost", dimensions: unfav })],
    { weights: W, windowDays: 90, now: NOW },
  );
  assert.equal(dim(r, "intent").hitRate, 1);
  assert.equal(dim(r, "intent").lift, 1);
});

console.log("\n等级表");

ok("固定样本：HOT 赢单率 1（未定的 rfq_ready 计样本不计已定）、LOW 0、非四级等级不入表", () => {
  const g = Object.fromEntries(report.grades.map((x) => [x.grade, x]));
  assert.deepEqual(report.grades.map((x) => x.grade), ["HOT", "HIGH", "MEDIUM", "LOW"]);
  assert.equal(g.HOT.n, 11);
  assert.equal(g.HOT.decided, 10);
  assert.equal(g.HOT.winRate, 1);
  assert.equal(g.HIGH.winRate, 0);
  assert.equal(g.HIGH.quoteRate, 1);
  assert.equal(g.MEDIUM.winRate, 1);
  assert.equal(g.LOW.winRate, 0);
  close(g.LOW.quoteRate, 5 / 15);
  const sum = report.grades.reduce((s, x) => s + x.n, 0);
  assert.equal(sum, 33); // 35 − quoted(null) − nurture(BOGUS)
});

ok("场景「等级表」：HOT 3 赢 2、LOW 5 赢 0", () => {
  const rows = [
    ...times(2, () => row({ stage: "won", grade: "HOT" })),
    row({ stage: "lost", grade: "HOT" }),
    ...times(5, () => row({ stage: "lost", grade: "LOW" })),
  ];
  const r = computeScoreCalibration(rows, { weights: W, windowDays: 90, now: NOW });
  const hot = r.grades.find((x) => x.grade === "HOT")!;
  const low = r.grades.find((x) => x.grade === "LOW")!;
  close(hot.winRate, 2 / 3);
  assert.equal(low.winRate, 0);
  assert.equal(r.grades.find((x) => x.grade === "HIGH")!.winRate, null);
});

console.log("\n建议权重");

ok("固定样本：完整度无法评估保留 10，其余 90 按区分度正部分配 → 21 / 21 / 27 / 21 / 10 / 0", () => {
  assert.equal(report.status, "ok");
  assert.deepEqual(report.suggestedWeights, {
    productFit: 21,
    commercialPotential: 21,
    buyerQuality: 27,
    intent: 21,
    completeness: 10,
    strategicValue: 0,
  });
  assert.deepEqual(
    report.dimensions.map((d) => d.suggestedWeight),
    [21, 21, 27, 21, 10, 0],
  );
});

ok("场景「保留无法评估维度」：完整度现有 10 → 建议仍 10，其余五维之和 90", () => {
  const s = report.suggestedWeights!;
  assert.equal(s.completeness, 10);
  assert.equal(KEYS.filter((k) => k !== "completeness").reduce((a, k) => a + s[k], 0), 90);
});

ok("场景「达到门槛」：30 个已定、六维区分度均为正 → 正常，六个整数和为 100（最大余数按维度顺序）", () => {
  const all = (v: number) => dims({ productFit: 25 * v, commercialPotential: 20 * v, buyerQuality: 20 * v, intent: 15 * v, completeness: 10 * v, strategicValue: 10 * v });
  const rows = [...times(15, () => row({ stage: "won", dimensions: all(1) })), ...times(15, () => row({ stage: "lost", dimensions: all(0) }))];
  const r = computeScoreCalibration(rows, { weights: W, windowDays: 90, now: NOW });
  assert.equal(r.sample.decided, CALIBRATION_MIN_DECIDED);
  assert.equal(r.status, "ok");
  assert.deepEqual(Object.values(r.suggestedWeights!), [17, 17, 17, 17, 16, 16]);
  for (const v of Object.values(r.suggestedWeights!)) assert.ok(Number.isInteger(v) && v >= 0);
});

ok("场景「样本不足」：已定 29 → 样本不足，无建议与片段，各维统计照常", () => {
  const rows = FIXED.filter((x) => x.stage !== "lost" || x.grade !== "HIGH"); // 去掉 D 组 5 个输 → 已定 27
  const r27 = computeScoreCalibration(rows, { weights: W, windowDays: 90, now: NOW });
  assert.equal(r27.sample.decided, 27);
  const r29 = computeScoreCalibration([...rows, row({ stage: "lost" }), row({ stage: "won" })], { weights: W, windowDays: 90, now: NOW });
  assert.equal(r29.sample.decided, 29);
  assert.equal(r29.status, "insufficient");
  assert.equal(r29.suggestedWeights, null);
  assert.equal(r29.policySnippet, null);
  assert.ok(r29.dimensions.every((d) => d.suggestedWeight === null));
  assert.equal(dim(r29, "productFit").decided, 27);
  assert.equal(r29.minDecided, 30);
});

ok("场景「无信号」：30 个已定、可评估维度区分度都 ≤ 0 → 无信号，不给建议", () => {
  const all = (v: number) => dims({ productFit: 25 * v, commercialPotential: 20 * v, buyerQuality: 20 * v, intent: 15 * v, completeness: 10 * v, strategicValue: 10 * v });
  const rows = [...times(15, () => row({ stage: "won", dimensions: all(0) })), ...times(15, () => row({ stage: "lost", dimensions: all(1) }))];
  const r = computeScoreCalibration(rows, { weights: W, windowDays: 90, now: NOW });
  assert.equal(r.status, "no_signal");
  assert.equal(r.suggestedWeights, null);
  assert.equal(r.policySnippet, null);
});

ok("没有可评估维度（已定商机各维全部看好）→ 无信号；唯一可评估维度为负 → 无信号", () => {
  const allFav = dims({ ...A, strategicValue: 10 });
  const none = computeScoreCalibration(
    [...times(20, () => row({ stage: "won", dimensions: allFav })), ...times(10, () => row({ stage: "lost", dimensions: allFav }))],
    { weights: W, windowDays: 90, now: NOW },
  );
  assert.equal(none.dimensions.filter((d) => d.evaluable).length, 0);
  assert.equal(none.status, "no_signal");
  // 战略维度：看好组只有输、不看好组只有赢 → 可评估但为负；其余维度全部看好 → 无法评估
  const neg = computeScoreCalibration(
    [...times(20, () => row({ stage: "won", dimensions: dims(A) })), ...times(10, () => row({ stage: "lost", dimensions: allFav }))],
    { weights: W, windowDays: 90, now: NOW },
  );
  assert.deepEqual(neg.dimensions.filter((d) => d.evaluable).map((d) => d.key), ["strategicValue"]);
  assert.equal(neg.status, "no_signal");
});

ok("suggestWeights：余数并列按固定维度顺序补 1；和恒等于现有总额；自定义总额 110 保持", () => {
  const ks = KEYS;
  const eq = suggestWeights(ks.map((key, i) => ({ key, lift: i < 3 ? 0.2 : null, currentWeight: 0 })));
  assert.deepEqual(eq, { productFit: 0, commercialPotential: 0, buyerQuality: 0, intent: 0, completeness: 0, strategicValue: 0 });
  const three = suggestWeights(ks.map((key, i) => ({ key, lift: i < 3 ? 0.1 : null, currentWeight: i < 3 ? 100 / 3 : 0 })));
  assert.deepEqual(Object.values(three!), [34, 33, 33, 0, 0, 0]);
  const custom = suggestWeights(ks.map((key, i) => ({ key, lift: [0.3, 0.1, 0.1, 0.05, -0.2, 0.05][i], currentWeight: [30, 20, 20, 20, 10, 10][i] })));
  assert.equal(Object.values(custom!).reduce((a, b) => a + b, 0), 110);
  // 0.3 / 0.6 × 110 = 55；0.1 → 18.33；0.05 → 9.17；负 → 0
  assert.deepEqual(Object.values(custom!), [55, 19, 18, 9, 0, 9]);
  assert.equal(suggestWeights(ks.map((key) => ({ key, lift: null, currentWeight: 10 }))), null);
  assert.equal(suggestWeights(ks.map((key) => ({ key, lift: 0, currentWeight: 10 }))), null);
});

console.log("\npolicy 片段");

ok("场景「片段可合并」：以默认 policy 合并片段 → 六维权重等于建议，其余字段不变", () => {
  const snippet = report.policySnippet!;
  assert.deepEqual(Object.keys(snippet.scoring.weights), KEYS);
  const merged = mergeRevenueSpinePolicy(DEFAULT_REVENUE_SPINE_POLICY, snippet);
  assert.deepEqual(merged.scoring.weights, report.suggestedWeights);
  const strip = (p: typeof merged) => ({ ...p, scoring: { ...p.scoring, weights: null } });
  assert.deepEqual(strip(merged), strip(mergeRevenueSpinePolicy(DEFAULT_REVENUE_SPINE_POLICY, {})));
});

ok("片段文本为两空格缩进 JSON，可原样解析回片段", () => {
  const snippet = calibrationPolicySnippet(report.suggestedWeights!);
  const text = calibrationSnippetText(snippet);
  assert.deepEqual(JSON.parse(text), snippet);
  assert.match(text, /^\{\n {2}"scoring": \{\n {4}"weights": \{\n {6}"productFit": 21,/);
});

console.log("\n窗口、确定性、输出形状");

ok("窗口天数：7 → 30、365 → 180、abc → 90、缺省 → 90、45.6 → 46", () => {
  assert.equal(parseCalibrationDays("7"), 30);
  assert.equal(parseCalibrationDays("365"), 180);
  assert.equal(parseCalibrationDays("abc"), 90);
  assert.equal(parseCalibrationDays(null), 90);
  assert.equal(parseCalibrationDays(undefined), 90);
  assert.equal(parseCalibrationDays(""), 90);
  assert.equal(parseCalibrationDays("45.6"), 46);
});

ok("确定性：同一输入（含打乱顺序）得到同一份报告", () => {
  const again = computeScoreCalibration(FIXED, { weights: W, windowDays: 90, now: NOW });
  assert.deepEqual(again, report);
  const shuffled = [...FIXED].reverse();
  assert.deepEqual(computeScoreCalibration(shuffled, { weights: W, windowDays: 90, now: NOW }), report);
});

ok("输出不含 NaN / Infinity；现有权重来自 policy、缺失记 0；截断标记透传", () => {
  const walk = (v: unknown): void => {
    if (typeof v === "number") assert.ok(Number.isFinite(v), `非有限数 ${v}`);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(computeScoreCalibration([], { weights: W, windowDays: 90, now: NOW }));
  walk(report);
  const r = computeScoreCalibration([], { weights: { productFit: 30, intent: "x" }, windowDays: 30, now: NOW, truncated: true });
  assert.equal(r.currentWeights.productFit, 30);
  assert.equal(r.currentWeights.intent, 0);
  assert.equal(r.truncated, true);
  assert.equal(r.windowDays, 30);
  assert.equal(r.generatedAt, NOW.toISOString());
  assert.equal(r.status, "insufficient");
});

ok("报告只含计数、比率与权重：不含理由文本", () => {
  assert.ok(!JSON.stringify(report).includes("虚构理由"));
});

console.log(`\nscore-calibration: ${pass} passed`);
