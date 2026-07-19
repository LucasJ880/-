/**
 * 付费渠道映射与归一化
 * 运行：npx tsx src/lib/marketing/__tests__/paid-media-mapper.test.ts
 */

import { normalizeProviderHint } from "../channel-providers";
import { normalizeInboundMetricRow } from "../ingest-metrics";
import {
  buildPaidMediaIngestionKey,
  mapPaidMediaRowToMetricValues,
  weekEndFromStart,
} from "../providers/paid-media-mapper";

let failed = 0;
function check(name: string, ok: boolean) {
  if (ok) console.log(`✓ ${name}`);
  else {
    failed += 1;
    console.error(`✗ ${name}`);
  }
}

check("facebook→meta", normalizeProviderHint("facebook") === "meta");
check("xhs→xiaohongshu", normalizeProviderHint("xhs") === "xiaohongshu");
check("adwords→google_ads", normalizeProviderHint("adwords") === "google_ads");
check("weekEnd", weekEndFromStart("2026-01-05") === "2026-01-11");

const mapped = mapPaidMediaRowToMetricValues(
  {
    weekStart: "2026-01-05",
    cost: 1500,
    conversions: 10,
    clicks: 200,
    currency: "cad",
    channelAccountId: "acc1",
  },
  "google_ads",
);
check("spend from cost", mapped.spend === 1500);
check("leads from conversions", mapped.leads === 10);
check("weekly granularity", mapped.granularity === "weekly");
check("currency upper", mapped.currency === "CAD");
check(
  "ingestionKey",
  buildPaidMediaIngestionKey({
    provider: "meta",
    weekStart: "2026-01-05",
    channelAccountId: "acc1",
  }) === "meta:acc1:2026-01-05",
);

const normalized = normalizeInboundMetricRow({
  raw: {
    weekStart: "2026-02-02",
    spend: 800,
    qualifiedLeads: 4,
    externalAccountId: "act_123",
  },
  providerHint: "xiaohongshu",
  channelAccountId: "qy-acc",
});
check("xhs source", normalized.source === "xiaohongshu");
check("xhs account bound", normalized.values.channelAccountId === "qy-acc");
check(
  "xhs key",
  normalized.ingestionKey.startsWith("xiaohongshu:") &&
    normalized.ingestionKey.includes("2026-02-02"),
);

console.log(failed === 0 ? "\npaid-media-mapper 检查通过" : `\n失败 ${failed}`);
if (failed > 0) process.exit(1);
