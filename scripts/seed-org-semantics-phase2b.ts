/**
 * Phase 2B：为 Sunny / 梦馨写入独立 Glossary、业务对象、经营指标（幂等）
 *
 *   npx tsx scripts/seed-org-semantics-phase2b.ts
 */

import { db } from "@/lib/db";
import { upsertGlossaryTerm } from "../src/lib/glossary/service";
import { upsertBusinessObject } from "../src/lib/business-objects/registry";
import { upsertMetricDefinition } from "../src/lib/metrics/definitions";

const SUNNY_GLOSSARY = [
  {
    canonicalTerm: "SiteMeasure",
    displayName: "现场测量",
    aliases: ["量尺", "Measure", "Site Measure"],
    category: "fulfillment",
    language: "zh",
  },
  {
    canonicalTerm: "Installation",
    displayName: "安装",
    aliases: ["Install", "上门安装"],
    category: "fulfillment",
    language: "zh",
  },
];

const MENGXIN_GLOSSARY = [
  {
    canonicalTerm: "Sample",
    displayName: "样品",
    aliases: ["寄样", "Sample Order", "Sample"],
    category: "trade",
    language: "zh",
  },
  {
    canonicalTerm: "Inquiry",
    displayName: "询盘",
    aliases: ["海外询盘", "RFQ"],
    category: "trade",
    language: "zh",
  },
];

const SUNNY_OBJECTS = [
  { objectKey: "Customer", displayName: "客户", sourceModel: "SalesCustomer" },
  { objectKey: "Opportunity", displayName: "销售机会", sourceModel: "SalesOpportunity" },
  { objectKey: "Quote", displayName: "报价单", sourceModel: "SalesQuote" },
  { objectKey: "Bid", displayName: "投标", sourceModel: "Project" },
  { objectKey: "Project", displayName: "项目", sourceModel: "Project" },
  { objectKey: "SiteMeasure", displayName: "现场测量", sourceModel: "Measurement" },
  { objectKey: "ProductionOrder", displayName: "生产单", sourceModel: "BlindsOrder" },
  { objectKey: "Installation", displayName: "安装", sourceModel: null },
  { objectKey: "Invoice", displayName: "发票", sourceModel: null },
  { objectKey: "Payment", displayName: "收款", sourceModel: null },
  { objectKey: "Order", displayName: "窗饰订单", sourceModel: "BlindsOrder" },
];

const MENGXIN_OBJECTS = [
  { objectKey: "Buyer", displayName: "买家", sourceModel: "SalesCustomer" },
  { objectKey: "Inquiry", displayName: "询盘", sourceModel: "TradeProspect" },
  { objectKey: "Product", displayName: "产品", sourceModel: "TradeProduct" },
  { objectKey: "SKU", displayName: "货号", sourceModel: "TradeProduct" },
  { objectKey: "Sample", displayName: "样品", sourceModel: null },
  { objectKey: "Quotation", displayName: "外贸报价", sourceModel: "TradeQuote" },
  { objectKey: "PurchaseOrder", displayName: "采购单", sourceModel: null },
  { objectKey: "ProductionBatch", displayName: "生产批次", sourceModel: null },
  { objectKey: "Shipment", displayName: "出运", sourceModel: null },
  { objectKey: "Invoice", displayName: "发票", sourceModel: null },
  { objectKey: "Payment", displayName: "收款", sourceModel: null },
  { objectKey: "Supplier", displayName: "供应商", sourceModel: "Supplier" },
  { objectKey: "Order", displayName: "外贸订单", sourceModel: null },
];

type MetricSeed = {
  key: string;
  name: string;
  category: string;
  displayOrder: number;
  unit?: string;
  direction?: string;
};

const SUNNY_METRICS: MetricSeed[] = [
  { key: "active_bids", name: "进行中投标", category: "bids", displayOrder: 1 },
  { key: "bids_submitted", name: "已提交投标", category: "bids", displayOrder: 2 },
  { key: "bid_win_rate", name: "中标率", category: "bids", unit: "ratio", displayOrder: 3 },
  { key: "open_opportunity_value", name: "开放商机金额", category: "sales", unit: "currency", displayOrder: 4 },
  { key: "overdue_followups", name: "逾期跟进", category: "sales", direction: "lower_better", displayOrder: 5 },
  { key: "projects_at_risk", name: "风险项目", category: "projects", direction: "lower_better", displayOrder: 6 },
  { key: "installations_due", name: "待安装", category: "fulfillment", displayOrder: 7 },
  { key: "outstanding_receivables", name: "应收未收", category: "finance", unit: "currency", displayOrder: 8 },
];

const MENGXIN_METRICS: MetricSeed[] = [
  { key: "new_products", name: "新品数", category: "product", displayOrder: 1 },
  { key: "overseas_inquiries", name: "海外询盘", category: "trade", displayOrder: 2 },
  { key: "samples_in_progress", name: "进行中样品", category: "trade", displayOrder: 3 },
  { key: "sample_conversion_rate", name: "样品转化率", category: "trade", unit: "ratio", displayOrder: 4 },
  { key: "purchase_orders", name: "采购单", category: "supply", displayOrder: 5 },
  { key: "production_at_risk", name: "风险生产", category: "supply", direction: "lower_better", displayOrder: 6 },
  { key: "shipments_due", name: "待出运", category: "fulfillment", displayOrder: 7 },
  { key: "content_jobs_pending", name: "待处理内容任务", category: "content", displayOrder: 8 },
];

async function seedOrg(code: string, pack: {
  glossary: typeof SUNNY_GLOSSARY;
  objects: typeof SUNNY_OBJECTS;
  metrics: typeof SUNNY_METRICS;
  industryPackId: string;
}) {
  const org = await db.organization.findUnique({
    where: { code },
    select: { id: true, name: true },
  });
  if (!org) {
    console.warn(`跳过 ${code}：组织不存在，请先跑租户 seed`);
    return;
  }

  for (const g of pack.glossary) {
    await upsertGlossaryTerm({ orgId: org.id, ...g });
  }
  for (const o of pack.objects) {
    await upsertBusinessObject({
      orgId: org.id,
      industryPackId: pack.industryPackId,
      ...o,
    });
  }
  for (const m of pack.metrics) {
    await upsertMetricDefinition({
      orgId: org.id,
      key: m.key,
      name: m.name,
      category: m.category,
      unit: m.unit,
      direction: m.direction,
      displayOrder: m.displayOrder,
    });
  }
  console.log(
    `${org.name}: glossary=${pack.glossary.length} objects=${pack.objects.length} metrics=${pack.metrics.length}`,
  );
}

async function main() {
  await seedOrg("sunny-home-deco", {
    glossary: SUNNY_GLOSSARY,
    objects: SUNNY_OBJECTS,
    metrics: SUNNY_METRICS,
    industryPackId: "window_covering_services_v1",
  });
  await seedOrg("mengxin-home-textile", {
    glossary: MENGXIN_GLOSSARY,
    objects: MENGXIN_OBJECTS,
    metrics: MENGXIN_METRICS,
    industryPackId: "home_textile_trade_v1",
  });
}

main()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await db.$disconnect();
    process.exit(1);
  });
