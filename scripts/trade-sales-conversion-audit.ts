/**
 * 外贸 → 销售 CRM 转换自查
 * pnpm exec tsx scripts/trade-sales-conversion-audit.ts
 */

import { db } from "@/lib/db";
import {
  assertCustomerInOrgOrThrow,
  emailDomain,
  websiteHost,
} from "@/lib/trade/sales-conversion";

let failed = 0;

function ok(name: string) {
  console.log(`OK  ${name}`);
}

function fail(name: string, detail?: string) {
  console.error(`FAIL ${name}`, detail ?? "");
  failed++;
}

function assert(name: string, cond: boolean, detail?: string) {
  if (cond) ok(name);
  else fail(name, detail);
}

async function main() {
  console.log("=== audit:trade-sales-conversion ===\n");

  assert("websiteHost_strips_www", websiteHost("https://www.acme.com") === "acme.com");
  assert("emailDomain_lower", emailDomain("User@EXAMPLE.org") === "example.org");

  try {
    await db.tradeProspect.findFirst({
      select: {
        convertedToSalesCustomerId: true,
        convertedToSalesOpportunityId: true,
        convertedAt: true,
        convertedById: true,
      },
    });
    ok("prisma_tradeProspect_conversion_fields");
  } catch (e) {
    fail("prisma_tradeProspect_conversion_fields", e instanceof Error ? e.message : String(e));
  }

  try {
    await db.salesOpportunity.findFirst({
      select: { sourceTradeProspectId: true },
    });
    ok("prisma_salesOpportunity_sourceTradeProspectId");
  } catch (e) {
    fail("prisma_salesOpportunity_sourceTradeProspectId", e instanceof Error ? e.message : String(e));
  }

  try {
    await assertCustomerInOrgOrThrow("nonexistent_customer_id_xxxxxxxx", "audit_placeholder_org");
    fail("assertCustomerInOrgOrThrow_should_throw");
  } catch (e) {
    const m = e instanceof Error ? e.message : "";
    assert("assertCustomer_rejects_missing", m.includes("不存在") || m.includes("归档"));
  }

  const p = await db.tradeProspect.findFirst({
    where: {
      OR: [{ convertedToSalesOpportunityId: { not: null } }, { convertedToSalesCustomerId: { not: null } }],
    },
    select: {
      id: true,
      stage: true,
      convertedToSalesCustomerId: true,
      convertedToSalesOpportunityId: true,
    },
  });
  if (p?.convertedToSalesCustomerId) {
    assert("converted_prospect_has_customer_id", p.convertedToSalesCustomerId.length > 4);
  } else {
    ok("skip_converted_prospect_shape_no_rows");
  }

  const opp = await db.salesOpportunity.findFirst({
    where: { sourceTradeProspectId: { not: null } },
    select: { id: true, sourceTradeProspectId: true },
  });
  if (opp?.sourceTradeProspectId) {
    assert("opportunity_traceable", opp.sourceTradeProspectId.length > 8);
  } else {
    ok("skip_opportunity_trace_no_rows");
  }

  console.log("");
  if (failed) {
    console.error(`共 ${failed} 项失败`);
    process.exit(1);
  }
  console.log("全部通过（跨 org HTTP 用例请在集成环境补充）");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
