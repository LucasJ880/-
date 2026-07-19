/**
 * 七维提议：维度映射与惩罚逻辑的轻量断言（不连库）
 * 运行：npx tsx src/lib/marketing/__tests__/audit-from-signals.test.ts
 */

import { clampScore, MARKETING_DIMENSIONS, scoreToGrade } from "../constants";
import {
  buildGa4IngestionKey,
  mapGa4RowToMetricValues,
} from "../providers/ga4-mapper";

let failed = 0;
function check(name: string, ok: boolean) {
  if (ok) console.log(`✓ ${name}`);
  else {
    failed += 1;
    console.error(`✗ ${name}`);
  }
}

check("七维常量数量为 7", MARKETING_DIMENSIONS.length === 7);
check("clampScore 边界", clampScore(-1) === 0 && clampScore(150) === 100);
check("scoreToGrade B", scoreToGrade(85) === "B");

const mapped = mapGa4RowToMetricValues({
  date: "2026-07-19",
  propertyId: "123",
  sessions: 100,
  screenPageViews: 250,
  engagedSessions: 40,
  conversions: 5,
  eventName: "generate_lead",
  eventCount: 3,
  spend: 12.5,
  currency: "cad",
  channelAccountId: "acc1",
});
check("GA4 sessions→impressions", mapped.impressions === 100);
check("GA4 views", mapped.views === 250);
check("GA4 leads 取 max(event, conversions)", mapped.leads === 5);
check("GA4 currency 大写", mapped.currency === "CAD");
check(
  "ingestionKey 稳定",
  buildGa4IngestionKey({
    date: "2026-07-19",
    propertyId: "123",
    channelAccountId: "acc1",
  }) === "ga4:123:2026-07-19:acc1",
);

if (failed > 0) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log("\naudit/ga4 mapper 检查通过");
