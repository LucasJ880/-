/**
 * 批次一 — 投标策略备忘录 v2 + 合规矩阵（纯平面，零 DB / 零模型）
 *
 * 对标 2026-08-20 用户人工分析样本（HRM-2026-0395）。
 * MEMO-*   备忘录契约（schema/纪律/接线）
 * FIT-*    合规矩阵（端点/卡片/权限）
 * 反例守卫：整体 GO/NO-GO 裁决不得出现；矩阵 AI 不代填。
 *
 * 运行：npx tsx src/lib/tender-intel/__tests__/bid-strategy-memo.test.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { bidStrategyMemoSchema } from "../strategy";

let pass = 0;
let fail = 0;
const ok = (c: boolean, n: string, d?: unknown) => {
  if (c) { pass++; console.log(`  ✓ ${n}`); }
  else { fail++; console.error(`  ✗ ${n}`, d ?? ""); }
};
const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");
const code = (rel: string) =>
  read(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

console.log("批次一 — 投标策略备忘录 v2 + 合规矩阵");

// ── 备忘录契约 ──
const sample = bidStrategyMemoSchema.safeParse({
  summaryZh: "价格权重主导，须以最低价策略进入",
  scoringAnalysisZh: "若价格占70%，低5.7%可抵4分绩效差",
  competitiveLandscapeZh: "疑似现任 Meltwater（未100%确认）",
  riskGates: [{ gateZh: "3个同类References", statusZh: "需解决", basisZh: "近3年无同类项目" }],
  pricingStrategyZh: "首年激进、Option年调价",
  strategicRfis: [{ questionZh: "请披露现任供应商与年费", whyZh: "定价锚点" }],
  teamingAdviceZh: "与媒体数据商组队",
  dataGapsZh: "评分权重未入 canonical",
});
ok(sample.success, "MEMO-01: schema 真实校验通过（样例=对标样本要素）");
ok(
  sample.success && sample.data.riskGates[0].statusZh === "需解决",
  "MEMO-02: 风险门三态归一（已满足/需解决/高风险）",
);
const strat = read("src/lib/tender-intel/strategy.ts");
ok(
  strat.includes("NEVER output an overall GO/NO-GO decision") &&
    strat.includes("Never invent weights, incumbents, prices"),
  "MEMO-03（反例守卫）: 禁整体裁决 + 禁发明事实（prompt 铁律）",
);
ok(
  strat.includes("do the real math") && strat.includes("dataGapsZh instead of guessing"),
  "MEMO-04: 权重在场做真实演算，缺席入数据缺口（不猜）",
);
const orch = code("src/lib/tender-intel/orchestrate.ts");
ok(
  orch.includes("tenderAnalysisFact.findMany") &&
    orch.includes("mandatory: true") &&
    orch.includes("incumbentLead"),
  "MEMO-05: 备忘录输入=canonical 事实 + 强制要求 + 现任供应商线索（文档接地）",
);
const ws = code("src/app/api/projects/[id]/workbench-summary/route.ts");
ok(
  ws.includes("bidStrategyMemo") && ws.includes("legacyDraft"),
  "MEMO-06: 工作台优先渲染备忘录，老草案仅存量兜底",
);

// ── 合规矩阵 ──
const route = read("src/app/api/projects/[id]/bid-fit/route.ts");
ok(
  route.includes("requireProjectWriteAccess") &&
    route.includes('"HAVE", "BUILD", "PARTNER", "RFI", "NO_GO"') &&
    route.includes("analysisRunId: body.runId, projectId"),
  "FIT-01: 端点=写权限门 + 五态白名单 + 跨项目写入防护",
);
ok(
  route.includes("人工判定为准——AI 不代填"),
  "FIT-02（反例守卫）: 矩阵为人工判定层（AI 不自动写标注）",
);
const card = read("src/components/tender-analysis/bid-fit-matrix-card.tsx");
ok(
  card.includes('data-testid="bid-fit-matrix"') &&
    card.includes("只看强制") &&
    card.includes("未标"),
  "FIT-03: 卡片=强制优先视图 + 未标计数 + 五态选择",
);
const tab = read("src/components/project-detail/tabs/requirements-tab.tsx");
ok(tab.includes("BidFitMatrixCard"), "FIT-04: 挂载于招标要求 tab");

// ── Lane 3：评分演算进备忘录 ──
{
  const orch = read("src/lib/tender-intel/orchestrate.ts");
  ok(
    orch.includes('import("@/lib/tender-pricing/calc")') &&
      orch.includes("heuristicScoringModel(") &&
      orch.includes("pricingAnalysis,") &&
      orch.includes("contentOriginal: true"),
    "MEMO-07: 编排装配确定性演算（启发式回退用英文原文 contentOriginal，不受中文化影响）并传入备忘录",
  );
  const strat = read("src/lib/tender-intel/strategy.ts");
  ok(
    strat.includes("SCORING MODEL & DETERMINISTIC PRICE SCENARIOS") &&
      /quote its numbers verbatim/.test(strat) &&
      /do NOT recompute/.test(strat),
    "MEMO-08（反例守卫）: 备忘录引用演算数字而非自行重算（算术留在纯函数）",
  );
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
