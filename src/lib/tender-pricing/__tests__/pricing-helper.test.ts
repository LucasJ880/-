/**
 * 报价表助手探针（PH-01..10）
 * 运行：npx tsx src/lib/tender-pricing/__tests__/pricing-helper.test.ts
 * 纯平面：计算层用 RFQ 自带算例校验；推导层启发式对真实 HRM 措辞；路由/卡片结构守卫。
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  breakEvenPrice,
  buildScenarios,
  otherPoints,
  priceScore,
  PRICING_MODEL_VERSION,
  type ScoringModel,
} from "@/lib/tender-pricing/calc";
import { deriveScoringModel, heuristicScoringModel } from "@/lib/tender-pricing/derive";
import type { LlmInvoker } from "@/lib/tender-understanding/llm";

let pass = 0;
let fail = 0;
const ok = (c: boolean, n: string, d?: unknown) => {
  if (c) { pass++; console.log(`  ✓ ${n}`); }
  else { fail++; console.error(`  ✗ ${n}`, d ?? ""); }
};
const code = (p: string) =>
  readFileSync(join(process.cwd(), p), "utf-8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

// HRM-2026-0395 真实措辞（p7/p8）
const HRM_TEXTS = [
  "Social Value 10% Performance Evaluation 10% Country of Origin/Nationality of Services 10% Cost 70%",
  "Suppliers who have not yet received a Supplier Performance Evaluation through the eSourcing solution will receive 60% of the available points (“meets expectations”).",
  "The bid with the lowest total cost shall receive the maximum points allocated for cost. All other bids will be prorated against the lowest cost bid using the following formula: Total Points = Max Available Pts times (lowest cost/other cost)",
  "American suppliers as defined above will receive none of the available points.",
];

async function main() {
  console.log("报价表助手探针");

  // PH-01 RFQ 自带算例：满分 90，$100k vs $130k → 69
  {
    const s = priceScore({ priceWeightPct: 90, costFormula: "lowest_over_bid" }, 130_000, 100_000);
    ok(Math.round(s.ours) === 69 && s.competitor === 90, `PH-01: RFQ p8 算例 90×(100k/130k)=69（实得 ${s.ours}）`);
  }
  // PH-02 我方更低 → 我方满分，对手按比例
  {
    const s = priceScore({ priceWeightPct: 70, costFormula: "lowest_over_bid" }, 40_000, 50_000);
    ok(s.ours === 70 && s.competitor === 56, "PH-02: 我方最低得满分 70，对手 70×40/50=56", s);
  }
  // PH-03 启发式从真实 HRM 措辞推出 70% + 公式 + 三个 10% 项 + 绩效默认 60%
  const h = heuristicScoringModel(HRM_TEXTS);
  ok(
    h != null &&
      h.priceWeightPct === 70 &&
      h.costFormula === "lowest_over_bid" &&
      h.otherCriteria.length === 3 &&
      h.otherCriteria.every((c) => c.weightPct === 10) &&
      h.otherCriteria.find((c) => c.nameZh === "绩效评估")?.ourPct === 60 &&
      h.otherCriteria.find((c) => c.nameZh === "原产地/国籍")?.ourPct === 100,
    "PH-03: 启发式推导 HRM 模型（70% / lowest_over_bid / 3×10% / 绩效默认 60% / 国籍满分）",
    h,
  );
  // PH-04 打平价：非价格项我 60%+60%+100%（不含社会价值未知→60 中性）=22 vs 对手 60/60/60=18 → gap=-4 → P=70C/66
  {
    const model: ScoringModel = h!;
    const be = breakEvenPrice(model, 50_000);
    const ours = otherPoints(model, "ours").pts;
    const comp = otherPoints(model, "competitor").pts;
    const expected = (70 * 50_000) / (70 + (comp - ours));
    ok(
      be.price != null && Math.abs(be.price - expected) < 1 && be.price > 50_000,
      `PH-04: 非价格项领先 → 打平价高于对手价（${be.price} ≈ ${Math.round(expected)}）`,
      { be, ours, comp },
    );
  }
  // PH-05 落后时须更便宜；落后超过价格满分 → null
  {
    const behind: ScoringModel = {
      version: PRICING_MODEL_VERSION,
      priceWeightPct: 70,
      costFormula: "lowest_over_bid",
      otherCriteria: [{ key: "tech", nameZh: "技术", weightPct: 30, ourPct: 50, competitorPct: 100 }],
      source: "HUMAN",
      evidenceZh: [],
      derivedAt: "t",
    };
    const be = breakEvenPrice(behind, 100_000);
    // gap = 30-15 = 15 → P = 100k×(70-15)/70 = 78,571
    ok(be.price != null && Math.abs(be.price - 78_571.43) < 1, `PH-05a: 落后 15 分 → 须报 ${be.price}（<对手价）`, be);
    const hopeless: ScoringModel = { ...behind, priceWeightPct: 10, otherCriteria: [{ key: "t", nameZh: "技术", weightPct: 90, ourPct: 0, competitorPct: 100 }] };
    ok(breakEvenPrice(hopeless, 100_000).price === null, "PH-05b: 落后幅度超过价格满分 → 无打平价（不伪造数字）");
  }
  // PH-06 情景表：含跟价/让价/打平/成本底价；按价格降序；毛利列
  {
    const r = buildScenarios(h!, { competitorPriceCad: 50_000, ourCostCad: 30_000, targetMarginPct: 25 });
    const keys = r.scenarios.map((s) => s.key);
    const sorted = [...r.scenarios].every((s, i, a) => i === 0 || a[i - 1]!.priceCad >= s.priceCad);
    const floor = r.scenarios.find((s) => s.key === "floor");
    ok(
      keys.includes("match") && keys.includes("under10") && keys.includes("breakeven") && keys.includes("floor") && sorted &&
        floor != null && Math.abs(floor.priceCad - 40_000) < 1 && floor.marginPct === 25,
      "PH-06: 情景表完整、按价降序、成本底价 = 30k/(1-25%) = 40k 毛利 25%",
      { keys, floor },
    );
  }
  // PH-07 缺对手价 → 空情景 + 显式提示（不伪造）
  {
    const r = buildScenarios(h!, { competitorPriceCad: null, ourCostCad: 30_000, targetMarginPct: 20 });
    ok(r.scenarios.length === 0 && /对手|现任/.test(r.breakEvenNoteZh), "PH-07: 无对手价 → 零情景 + 显式提示");
  }
  // PH-08 假设显式：未知得分率与非人工模型都进 assumptionsZh
  {
    const r = buildScenarios(h!, { competitorPriceCad: 50_000, ourCostCad: null, targetMarginPct: null });
    ok(
      r.assumptionsZh.some((a) => a.includes("中性假设")) && r.assumptionsZh.some((a) => a.includes("人工确认")),
      "PH-08: 未知得分率与自动推导模型均显式列入假设",
      r.assumptionsZh,
    );
  }
  // PH-09 LLM 推导：注入 invoker 返回结构 → AI_INFERRED；invoker 坏 → 回退启发式
  {
    const good: LlmInvoker = async () => ({
      content: JSON.stringify({ priceWeightPct: 70, costFormula: "lowest_over_bid", otherCriteria: [{ name: "Social Value", weightPct: 10, newSupplierDefaultPct: null }, { name: "Performance Evaluation", weightPct: 10, newSupplierDefaultPct: 60 }, { name: "Country of Origin/Nationality of Services", weightPct: 10, newSupplierDefaultPct: null }], evidence: ["Cost 70%"] }),
      model: "fake",
      elapsedMs: 1,
    });
    const d1 = await deriveScoringModel(HRM_TEXTS, { invoker: good });
    const bad: LlmInvoker = async () => { throw new Error("boom"); };
    const d2 = await deriveScoringModel(HRM_TEXTS, { invoker: bad });
    ok(
      d1.model?.source === "AI_INFERRED" && d1.model.priceWeightPct === 70 && d1.model.otherCriteria.find((c) => c.nameZh === "绩效评估")?.ourPct === 60 &&
        d2.model?.source === "HEURISTIC" && d2.model.priceWeightPct === 70,
      "PH-09: AI 推导成功 → AI_INFERRED；模型坏 → 回退启发式（零阻断）",
      { d1: d1.via, d2: d2.via },
    );
  }
  // PH-10 路由/卡片结构守卫：写权限门、频控、人工覆盖不被自动推导覆盖、禁 GO/NO-GO 措辞
  {
    const route = code("src/app/api/projects/[id]/pricing-helper/route.ts");
    ok(
      /requireProjectWriteAccess/.test(route) && /RATE_WINDOW_MS/.test(route) && /status:\s*429/.test(route) &&
        /existing\?\.source !== "HUMAN"/.test(route),
      "PH-10a: 路由=写权限门 + 60s 频控 + 人工覆盖优先于自动推导",
    );
    const card = readFileSync(join(process.cwd(), "src/components/tender/pricing-helper-card.tsx"), "utf-8");
    ok(
      card.includes('data-testid="pricing-helper"') && card.includes("不是报价决定") && !/GO\/NO-GO|No-Go 决定/.test(card),
      "PH-10b（反例守卫）: 卡片声明「假设驱动·不是报价决定」，无整体 GO/NO-GO 输出",
    );
    const tab = readFileSync(join(process.cwd(), "src/components/project-detail/tabs/workbench-tab.tsx"), "utf-8");
    ok(tab.includes("<PricingHelperCard"), "PH-10c: 挂载于工作台");
  }

  console.log(`\n结果：${pass} 通过，${fail} 失败`);
  if (fail > 0) process.exit(1);
}

void main().catch((e) => { console.error(e); process.exit(1); });
