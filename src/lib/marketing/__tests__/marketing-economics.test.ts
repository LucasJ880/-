import { parseMarketingCsv } from "../csv-import";
import { calculateMarketingEconomics, normalizeMarketingEconomics } from "../economics";
import { mapGa4RowToMetricValues } from "../providers/ga4-mapper";
import { mapPaidMediaRowToMetricValues } from "../providers/paid-media-mapper";

let failed = 0;
function check(name: string, ok: boolean) {
  if (ok) console.log(`✓ ${name}`);
  else { failed += 1; console.error(`✗ ${name}`); }
}

const paid = mapPaidMediaRowToMetricValues(
  { date: "2026-08-01", leads: 10, spend: 500 },
  "google_ads",
);
check("平台未提供有效线索时保持 0", paid.qualifiedLeads === 0);
check("按日导入不会伪装为周数据", paid.granularity === "daily" && paid.periodEnd === "2026-08-01");

const ga4 = mapGa4RowToMetricValues({ date: "2026-08-01", conversions: 5 });
check("GA4 转化不会冒充 CRM 有效线索", ga4.leads === 5 && ga4.qualifiedLeads === 0);

const economics = calculateMarketingEconomics({
  revenue: 5000,
  adSpend: 1000,
  otherMarketingCost: 200,
  grossMarginRate: 0.4,
});
check("ROAS 只使用广告花费", economics.roas === 5);
check("ROI 使用毛利与全部营销成本", Math.abs((economics.roi ?? 0) - 2 / 3) < 0.00001);
check("40% 毛利率保本 ROAS 为 2.5", economics.breakEvenRoas === 2.5);
check("缺少毛利率时不伪造 ROI", calculateMarketingEconomics({ revenue: 5000, adSpend: 1000 }).roi === null);

const normalized = normalizeMarketingEconomics({
  defaultGrossMarginRate: 0.4,
  targetRoas: 3,
  targetRoi: 0.5,
  attributionWindowDays: 90,
  currency: "cad",
  productMargins: [{ product: "Zebra Blinds", grossMarginRate: 0.42 }],
});
check("经济模型统一币种并保存产品毛利率", normalized.currency === "CAD" && normalized.productMargins[0]?.grossMarginRate === 0.42);

const rows = parseMarketingCsv(
  "日期,花费,曝光,点击,线索,转化价值\n2026-08-01,\"1,200\",10000,220,8,5000",
);
check("历史 CSV 可识别中英文平台字段", rows.length === 1 && rows[0]?.spend === 1200 && rows[0]?.revenue === 5000);
check("CSV 历史日数据明确标记 daily", rows[0]?.granularity === "daily");

console.log(failed === 0 ? "\nmarketing-economics 检查通过" : `\n失败 ${failed}`);
if (failed > 0) process.exit(1);
