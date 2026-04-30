/**
 * TradeProspect.stage P1-C 自查
 *
 *   pnpm exec tsx scripts/trade-stage-audit.ts
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import {
  TRADE_PROSPECT_STAGES,
  TRADE_PROSPECT_STAGE_OPTIONS,
  parseStrictTradeProspectStage,
  normalizeTradeProspectStage,
  tradeProspectLegacyStageKeys,
  isUnrecognizedTradeProspectStage,
} from "@/lib/trade/stage";

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

async function dryRunBackfillStats() {
  const { db } = await import("@/lib/db");
  const { normalizeTradeProspectStage } = await import("@/lib/trade/stage");
  const groups = await db.tradeProspect.groupBy({
    by: ["stage"],
    _count: { id: true },
  });
  let need = 0;
  for (const g of groups) {
    const raw = g.stage ?? "";
    if (raw !== normalizeTradeProspectStage(raw)) need += g._count.id;
  }
  ok(`backfill_dry_run_need_change_rows=${need}`);
  await db.$disconnect();
}

async function main() {
  console.log("=== audit:trade-stage ===\n");

  for (const s of TRADE_PROSPECT_STAGES) {
    const r = parseStrictTradeProspectStage(s);
    assert(`strict_ok:${s}`, r.ok && r.stage === s);
  }
  assert("strict_rejects_outreach_sent", !parseStrictTradeProspectStage("outreach_sent").ok);
  assert("strict_rejects_low_confidence", !parseStrictTradeProspectStage("low_confidence").ok);

  for (const k of tradeProspectLegacyStageKeys()) {
    assert(
      `legacy_mapped:${k}`,
      !isUnrecognizedTradeProspectStage(k),
      `normalize=${normalizeTradeProspectStage(k)}`,
    );
  }

  assert(
    "stage_options_count",
    TRADE_PROSPECT_STAGE_OPTIONS.length === TRADE_PROSPECT_STAGES.length,
    String(TRADE_PROSPECT_STAGE_OPTIONS.length),
  );

  const badLiterals = [
    'stage: "outreach_sent"',
    'stage: "outreach_draft"',
    'stage: "outreach_ready"',
    'stage: "quote_created"',
    'stage: "low_confidence"',
  ];
  const watchWritePaths = [
    "src/lib/trade/pipeline.ts",
    "src/lib/trade/research-service.ts",
    "src/lib/trade/quote-service.ts",
    "src/lib/trade/service.ts",
    "src/lib/secretary/actions.ts",
    "src/lib/trade/cron-jobs.ts",
    "src/app/api/trade/prospects/[id]/send/route.ts",
    "src/app/api/trade/prospects/[id]/reply/route.ts",
    "src/app/api/trade/prospects/[id]/outreach/route.ts",
  ];
  for (const rel of watchWritePaths) {
    const p = join(process.cwd(), rel);
    if (!existsSync(p)) {
      fail(`missing_file:${rel}`);
      continue;
    }
    const content = readFileSync(p, "utf8");
    for (const b of badLiterals) {
      assert(`no_forbidden_write:${rel}:${b}`, !content.includes(b));
    }
  }

  await dryRunBackfillStats();

  console.log("");
  if (failed > 0) {
    console.error(`共 ${failed} 项失败`);
    process.exit(1);
  }
  console.log("全部通过");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
