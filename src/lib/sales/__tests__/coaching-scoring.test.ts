/**
 * Coaching 归因评分逻辑单元测试
 *
 * 测试 contributionScore 计算规则和 effectiveness 加权公式
 * 这些是纯逻辑，不依赖数据库
 *
 * 用法: npx tsx src/lib/sales/__tests__/coaching-scoring.test.ts
 */

let pass = 0;
let fail = 0;

function check(condition: boolean, msg: string) {
  if (condition) {
    pass++;
    console.log(`  ✅ ${msg}`);
  } else {
    fail++;
    console.error(`  ❌ ${msg}`);
  }
}

// ── contributionScore 计算规则 ──
// 从 coaching-service.ts attributeOutcome 中提取的评分逻辑

function calcContributionScore(
  adopted: boolean | null,
  outcome: "won" | "lost",
): number {
  let score = 0.5;
  if (adopted === true && outcome === "won") score = 0.9;
  else if (adopted === true && outcome === "lost") score = 0.2;
  else if (adopted === false && outcome === "won") score = 0.4;
  else if (adopted === false && outcome === "lost") score = 0.5;
  return score;
}

console.log("\n── contributionScore 评分规则 ──");

check(calcContributionScore(true, "won") === 0.9, "采纳 + 成单 = 0.9（最高）");
check(calcContributionScore(true, "lost") === 0.2, "采纳 + 丢单 = 0.2（最低）");
check(calcContributionScore(false, "won") === 0.4, "未采纳 + 成单 = 0.4（中低）");
check(calcContributionScore(false, "lost") === 0.5, "未采纳 + 丢单 = 0.5（中性）");
check(calcContributionScore(null, "won") === 0.5, "未决定 + 成单 = 0.5（默认）");
check(calcContributionScore(null, "lost") === 0.5, "未决定 + 丢单 = 0.5（默认）");

// ── 评分排序一致性 ──

console.log("\n── 评分排序一致性 ──");

const scores = {
  adoptedWon: calcContributionScore(true, "won"),
  notAdoptedWon: calcContributionScore(false, "won"),
  notAdoptedLost: calcContributionScore(false, "lost"),
  adoptedLost: calcContributionScore(true, "lost"),
};

check(
  scores.adoptedWon > scores.notAdoptedWon,
  "采纳+成单 > 未采纳+成单",
);
check(
  scores.notAdoptedLost > scores.adoptedLost,
  "未采纳+丢单 > 采纳+丢单（采纳了还丢单，说明建议无效）",
);
check(
  scores.adoptedWon > scores.adoptedLost,
  "采纳+成单 > 采纳+丢单",
);

// ── updateInsightEffectiveness 加权公式 ──
// 从 coaching-service.ts 提取的权重逻辑

interface MockRecord {
  adopted: boolean | null;
  outcome: "won" | "lost";
  contributionScore: number;
}

function calcEffectiveness(records: MockRecord[]): number {
  if (records.length < 2) return -1; // 样本不足不计算

  let weightedSum = 0;
  let totalWeight = 0;

  for (const r of records) {
    let weight = 0.3;
    if (r.adopted === true && r.outcome === "won") weight = 1.0;
    else if (r.adopted === true && r.outcome === "lost") weight = 0.8;
    else if (r.adopted === false && r.outcome === "won") weight = 0.3;
    else if (r.adopted === false && r.outcome === "lost") weight = 0.2;

    const score = r.contributionScore ?? 0.5;
    weightedSum += score * weight;
    totalWeight += weight;
  }

  const eff = totalWeight > 0 ? weightedSum / totalWeight : 0.5;
  return Math.max(0, Math.min(1, eff));
}

console.log("\n── effectiveness 加权公式 ──");

// 全是采纳+成单 → 高 effectiveness
const allGood: MockRecord[] = [
  { adopted: true, outcome: "won", contributionScore: 0.9 },
  { adopted: true, outcome: "won", contributionScore: 0.9 },
  { adopted: true, outcome: "won", contributionScore: 0.9 },
];
const allGoodEff = calcEffectiveness(allGood);
check(allGoodEff === 0.9, `全采纳+全成单 → 0.9 (got ${allGoodEff})`);

// 全是采纳+丢单 → 低 effectiveness
const allBad: MockRecord[] = [
  { adopted: true, outcome: "lost", contributionScore: 0.2 },
  { adopted: true, outcome: "lost", contributionScore: 0.2 },
];
const allBadEff = calcEffectiveness(allBad);
check(Math.abs(allBadEff - 0.2) < 1e-10, `全采纳+全丢单 → ≈0.2 (got ${allBadEff})`);

// 混合场景
const mixed: MockRecord[] = [
  { adopted: true, outcome: "won", contributionScore: 0.9 },
  { adopted: true, outcome: "lost", contributionScore: 0.2 },
  { adopted: false, outcome: "won", contributionScore: 0.4 },
];
const mixedEff = calcEffectiveness(mixed);
check(mixedEff > 0.2 && mixedEff < 0.9, `混合场景 0.2 < eff < 0.9 (got ${mixedEff.toFixed(3)})`);

// 样本不足
check(calcEffectiveness([{ adopted: true, outcome: "won", contributionScore: 0.9 }]) === -1, "单条记录不计算 effectiveness");
check(calcEffectiveness([]) === -1, "空记录不计算 effectiveness");

// ── effectiveness 范围边界 ──

console.log("\n── effectiveness 范围边界 ──");

check(allGoodEff >= 0 && allGoodEff <= 1, `最优场景 effectiveness ∈ [0, 1] (got ${allGoodEff})`);
check(allBadEff >= 0 && allBadEff <= 1, `最差场景 effectiveness ∈ [0, 1] (got ${allBadEff})`);

// ── 权重逻辑验证 ──

console.log("\n── 权重分配合理性 ──");

// 采纳后成单的权重最高（1.0），因为这是最直接的正面证据
// 采纳后丢单权重次之（0.8），负面信号同样重要
// 未采纳的事件权重低，因为因果关系不明确
function getWeight(adopted: boolean | null, outcome: "won" | "lost"): number {
  if (adopted === true && outcome === "won") return 1.0;
  if (adopted === true && outcome === "lost") return 0.8;
  if (adopted === false && outcome === "won") return 0.3;
  if (adopted === false && outcome === "lost") return 0.2;
  return 0.3;
}

check(getWeight(true, "won") > getWeight(true, "lost"), "正面证据权重 > 负面证据权重");
check(getWeight(true, "won") > getWeight(false, "won"), "采纳权重 > 未采纳权重");
check(getWeight(true, "lost") > getWeight(false, "lost"), "采纳丢单权重 > 未采纳丢单权重");
check(getWeight(false, "won") > getWeight(false, "lost"), "未采纳成单权重 > 未采纳丢单权重");

// ── daysToOutcome 计算 ──

console.log("\n── daysToOutcome 天数计算 ──");

function calcDays(createdAt: Date, outcomeAt: Date): number {
  return Math.ceil((outcomeAt.getTime() - createdAt.getTime()) / 86_400_000);
}

const d1 = new Date("2026-01-01T00:00:00Z");
const d2 = new Date("2026-01-11T00:00:00Z");
check(calcDays(d1, d2) === 10, "10天间隔 → daysToOutcome = 10");

const d3 = new Date("2026-01-01T00:00:00Z");
const d4 = new Date("2026-01-01T12:00:00Z");
check(calcDays(d3, d4) === 1, "半天 → ceil = 1");

const d5 = new Date("2026-01-01T00:00:00Z");
const d6 = new Date("2026-01-01T00:00:00Z");
check(calcDays(d5, d6) === 0, "同一时刻 → 0");

// ── Summary ──

console.log("\n═══════════════════════════════════════");
console.log(`  Coaching 归因测试: ${pass}/${pass + fail} 通过, ${fail} 失败`);
console.log("═══════════════════════════════════════\n");

if (fail > 0) process.exit(1);
