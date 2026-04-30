/**
 * TradeQuote → SalesQuote 转换自查
 * pnpm exec tsx scripts/trade-quote-sales-conversion-audit.ts
 */

import { readFileSync } from "fs";
import { join } from "path";
import { db } from "@/lib/db";
import { mapTradeQuoteStatusToSalesQuoteStatus } from "@/lib/trade/trade-quote-sales-quote";

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
  console.log("=== audit:trade-quote-sales-conversion ===\n");

  assert("map_draft", mapTradeQuoteStatusToSalesQuoteStatus("draft") === "draft");
  assert("map_sent", mapTradeQuoteStatusToSalesQuoteStatus("sent") === "sent");
  assert("map_negotiating", mapTradeQuoteStatusToSalesQuoteStatus("negotiating") === "viewed");
  assert("map_accepted", mapTradeQuoteStatusToSalesQuoteStatus("accepted") === "accepted");

  try {
    await db.salesQuote.findFirst({
      select: { sourceTradeQuoteId: true, orgId: true },
    });
    ok("prisma_salesQuote_sourceTradeQuoteId");
  } catch (e) {
    fail("prisma_salesQuote_sourceTradeQuoteId", e instanceof Error ? e.message : String(e));
  }

  const schema = readFileSync(join(process.cwd(), "prisma", "schema.prisma"), "utf8");
  assert("schema_salesQuote_sourceTradeQuoteId", /sourceTradeQuoteId\s+String\?\s+@unique/.test(schema));

  const libPath = join(process.cwd(), "src", "lib", "trade", "trade-quote-sales-quote.ts");
  const lib = readFileSync(libPath, "utf8");
  assert("lib_resolve_loadTradeQuoteForOrg", /loadTradeQuoteForOrg/.test(lib));
  assert("lib_assert_customer_org", /assertSalesCustomerInOrgForMutation/.test(lib));
  assert("lib_no_prisma_default_org", !/orgId:\s*["']default["']/.test(lib));

  const prevPath = join(
    process.cwd(),
    "src",
    "app",
    "api",
    "trade",
    "quotes",
    "[id]",
    "sales-conversion-preview",
    "route.ts",
  );
  const prev = readFileSync(prevPath, "utf8");
  assert("api_preview_resolveTradeOrgId", /resolveTradeOrgId/.test(prev));

  const convPath = join(
    process.cwd(),
    "src",
    "app",
    "api",
    "trade",
    "quotes",
    "[id]",
    "convert-to-sales-quote",
    "route.ts",
  );
  const conv = readFileSync(convPath, "utf8");
  assert("api_convert_resolveTradeOrgId", /resolveTradeOrgId/.test(conv));
  assert("api_convert_log_activity", /logActivity/.test(conv));
  assert("api_convert_body_orgId", /bodyOrgId/.test(conv));

  const dupGuard =
    lib.includes("sourceTradeQuoteId: quote.id") &&
    lib.includes("where: { sourceTradeQuoteId: quote.id }");
  assert("lib_duplicate_guard_sourceTradeQuoteId", dupGuard);

  console.log("");
  if (failed) {
    console.error(`共 ${failed} 项失败`);
    process.exit(1);
  }
  console.log("全部通过（HTTP 边界用例请在集成环境补充）");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
