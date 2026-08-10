/**
 * TradeProspect.stage 历史值 → 标准值回填
 *
 * 默认 dry-run（只打印统计，不写库）
 *   pnpm exec tsx scripts/backfill-trade-prospect-stage.ts
 * 实际写入（Production Operation Guard 管控，见 docs/QINGYAN_PRODUCTION_OPERATION_GUARD.md）：
 *   PRODUCTION_OPERATION_CONFIRM=PRODUCTION:BACKFILL_TRADE_PROSPECT_STAGE:<dry-run 行数> \
 *     pnpm exec tsx scripts/backfill-trade-prospect-stage.ts --write
 * 非生产库需显式 --target=preview|staging|local。
 *
 * 需 DATABASE_URL；不在 Prisma migration 中写数据逻辑。
 */

import { db } from "@/lib/db";
import {
  normalizeTradeProspectStage,
  isUnrecognizedTradeProspectStage,
  type TradeProspectStage,
} from "@/lib/trade/stage";
import {
  assertProductionOperationAllowed,
  resolveDeclaredTargetEnvironment,
  verifyOperationDatabaseTarget,
} from "@/lib/db-safety/production-operation-guard";

const OPERATION_NAME = "BACKFILL_TRADE_PROSPECT_STAGE";
const SCRIPT_NAME = "scripts/backfill-trade-prospect-stage.ts";

async function main() {
  const write = process.argv.includes("--write");
  const target = resolveDeclaredTargetEnvironment(
    process.argv,
    process.env,
    "production",
  );

  // 任何查询之前先校验目标：声明环境必须与实际 DB 身份一致
  verifyOperationDatabaseTarget({
    operationName: OPERATION_NAME,
    scriptName: SCRIPT_NAME,
    targetEnvironment: target,
  });

  console.log(write ? "MODE: --write（申请写入）\n" : "MODE: dry-run（不写库，可加 --write）\n");

  const groups = await db.tradeProspect.groupBy({
    by: ["stage"],
    _count: { id: true },
  });

  const countsByOld = new Map<string, number>();
  const targetByOld = new Map<string, TradeProspectStage>();
  const unrecognized: { stage: string; count: number }[] = [];

  for (const g of groups) {
    const raw = g.stage ?? "";
    const c = g._count.id;
    countsByOld.set(raw, c);
    const n = normalizeTradeProspectStage(raw);
    targetByOld.set(raw, n);
    if (isUnrecognizedTradeProspectStage(raw)) {
      unrecognized.push({ stage: raw, count: c });
    }
  }

  console.log("--- 当前 DB stage 原始值 → 计数 / 归一化后 ---");
  for (const [k, c] of [...countsByOld.entries()].sort((a, b) => b[1] - a[1])) {
    const n = targetByOld.get(k)!;
    const note = k === n ? "（已是标准值）" : "";
    console.log(`  ${JSON.stringify(k)}: ${c} 条 → ${n}${note}`);
  }

  console.log("\n--- 无法识别（未在 LEGACY 映射且非标准串）---");
  if (unrecognized.length === 0) {
    console.log("  （无）");
  } else {
    for (const u of unrecognized) {
      console.log(`  ${JSON.stringify(u.stage)}: ${u.count} 条`);
    }
  }

  let rowsToChange = 0;
  for (const g of groups) {
    const raw = g.stage ?? "";
    const n = normalizeTradeProspectStage(raw);
    if (raw !== n) rowsToChange += g._count.id;
  }
  console.log(`\n需更新行数（原始 stage !== normalize(stage)）: ${rowsToChange}`);

  // Guard：dry-run 打印 impact 报告与 apply 指引；--write 时校验 confirmation
  const verdict = assertProductionOperationAllowed({
    operationName: OPERATION_NAME,
    operationType: "PRODUCTION_WRITE",
    targetEnvironment: target,
    scriptName: SCRIPT_NAME,
    scope: { kind: "global", reason: "跨组织 stage 字段归一化（无 org 维度）" },
    apply: write,
    dryRunCompleted: true,
    estimatedImpact: {
      kind: "known",
      rows: rowsToChange,
      summary: "TradeProspect.stage updateMany（按旧值分组）",
    },
  });

  if (!verdict.writeAllowed) {
    console.log("\n未执行写入（DRY_RUN_ONLY）。");
    return;
  }

  let batches = 0;
  for (const g of groups) {
    const raw = g.stage ?? "";
    const n = normalizeTradeProspectStage(raw);
    if (raw === n) continue;
    const r = await db.tradeProspect.updateMany({
      where: { stage: raw },
      data: { stage: n },
    });
    batches += r.count;
    console.log(`  updateMany stage=${JSON.stringify(raw)} → ${n}: ${r.count} 行`);
  }
  console.log(`\n写入完成，共更新 ${batches} 行（按旧值分组累加）。`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
