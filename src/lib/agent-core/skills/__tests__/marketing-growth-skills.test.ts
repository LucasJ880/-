/**
 * 营销增长技能 — GEO / CRO / MMM 准备度
 * 运行：npx tsx src/lib/agent-core/skills/__tests__/marketing-growth-skills.test.ts
 */

import { MARKETING_GROWTH_SKILLS } from "../marketing-growth-seed";
import { OPERATIONS_SKILLS } from "../operations-seed";

let total = 0;
let failed = 0;

function expect(condition: boolean, message: string) {
  total += 1;
  if (condition) {
    console.log(`✓ ${message}`);
    return;
  }
  failed += 1;
  console.error(`✗ ${message}`);
}

const bySlug = Object.fromEntries(MARKETING_GROWTH_SKILLS.map((s) => [s.slug, s]));

expect(MARKETING_GROWTH_SKILLS.length === 3, "营销增长技能 3 条（含 MMM）");
expect(OPERATIONS_SKILLS.length === 23, "不破坏现有 23 条运营技能");

const geo = bySlug["marketing-geo-audit"];
expect(geo.outputFormat === "json", "GEO 输出 JSON");
expect(
  geo.systemPrompt.includes("不得假装") || geo.systemPrompt.includes("输入不足"),
  "GEO 不假装抓取",
);
expect(geo.systemPrompt.includes("Schema"), "GEO 覆盖 Schema");

const cro = bySlug["marketing-cro-audit"];
expect(cro.systemPrompt.includes("最多") && cro.systemPrompt.includes("3"), "CRO 最多三实验");
expect(cro.systemPrompt.includes("人工审批点"), "CRO 实验含人工审批点");
expect(
  cro.systemPrompt.includes("不得直接执行") || cro.systemPrompt.includes("PendingAction"),
  "CRO 不直接投放",
);

const mmm = bySlug["mmm-data-readiness"];
expect(mmm.domain === "analytics", "MMM 属 analytics 域");
expect(mmm.systemPrompt.includes("禁止声称已运行 Meridian"), "不伪跑 Meridian");
expect(mmm.outputSchema != null, "MMM 有 outputSchema");

const geoFixture = {
  websiteUrl: "https://sunnyshutter.example",
  pageContent: "<h1>Custom Blinds Toronto</h1><p>We install motorized shades.</p>",
  technicalSignals: "robots.txt allow; no JSON-LD LocalBusiness",
};
expect(geoFixture.technicalSignals.includes("no JSON-LD"), "GEO Fixture 含缺口");

const croFixture = {
  campaignObjective: "预约量房",
  adMessage: "Free measure in GTA",
  landingPageContent: "Contact us form with 12 fields",
  funnelMetrics: "CTR 3%; LP→Lead 0.8%",
};
expect(croFixture.landingPageContent.includes("12 fields"), "CRO Fixture 表单摩擦");

console.log(
  `\n${failed === 0 ? "✅" : "❌"} marketing-growth-skills: ${total - failed}/${total} 通过`,
);
if (failed > 0) process.exit(1);
