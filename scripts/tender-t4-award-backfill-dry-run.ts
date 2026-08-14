/**
 * T4 §9 — 青砚自身已结 Tender → AwardRecord 候选盘点（DRY-RUN ONLY）
 *
 * 只读扫描：不写任何行。生产 backfill 被禁止——本脚本仅输出 inventory，
 * 真正 materialize 必须走 canonical service + 人工批准，且只在隔离 DB 演练。
 *
 * 运行（隔离 DB / 本地）：
 *   DATABASE_URL=... DIRECT_URL=... npx tsx scripts/tender-t4-award-backfill-dry-run.ts
 *
 * 安全：检测到生产 DB 端点前缀（ep-super-field-antfibsl）立即拒绝执行。
 */

const PROD_ENDPOINT_PREFIX = "ep-super-field-antfibsl";

for (const key of ["DATABASE_URL", "DIRECT_URL"]) {
  const v = process.env[key] ?? "";
  if (v.includes(PROD_ENDPOINT_PREFIX)) {
    console.error(`REFUSED: ${key} 指向生产数据库端点（${PROD_ENDPOINT_PREFIX}*）。`);
    console.error("本脚本禁止在生产库上运行（即使只读）。请使用隔离 Neon 分支。");
    process.exit(1);
  }
}

import { db } from "../src/lib/db";

type Bucket = "CAN_MATERIALIZE" | "NEEDS_REVIEW" | "MISSING_EVIDENCE";

(async () => {
  const closed = await db.project.findMany({
    where: { workDomain: "tender", tenderStatus: { in: ["won", "lost"] } },
    select: {
      id: true,
      orgId: true,
      name: true,
      tenderStatus: true,
      winningBidPrice: true,
      ourBidPrice: true,
      currency: true,
      awardDate: true,
      intelligenceRoom: { select: { summaryJson: true } },
    },
  });

  const rows: Array<{ id: string; name: string; status: string; bucket: Bucket; why: string }> = [];

  for (const p of closed) {
    const sj = (p.intelligenceRoom?.summaryJson as Record<string, unknown>) ?? {};
    const ext = (sj.externalConfirmed as Record<string, unknown>) ?? {};
    const confirmedWinner =
      typeof ext.previousWinner === "string" && ext.previousWinner.trim()
        ? (ext.previousWinner as string).trim()
        : null;

    let bucket: Bucket;
    let why: string;
    if (p.tenderStatus === "won") {
      // 我方中标：winner 身份 = 本组织（PROJECT_RECORD 一等事实）
      const amount = p.winningBidPrice ?? p.ourBidPrice;
      if (amount != null && p.awardDate) {
        bucket = "CAN_MATERIALIZE";
        why = `won：金额 ${amount}（${p.currency ?? "?"}）+ awardDate 齐备（source=PROJECT_RECORD）`;
      } else {
        bucket = "MISSING_EVIDENCE";
        why = `won 但缺 ${amount == null ? "金额" : ""}${amount == null && !p.awardDate ? "+" : ""}${!p.awardDate ? "awardDate" : ""}`;
      }
    } else {
      // lost：对手中标——winner 只能来自人工确认的外部事实，绝不猜
      if (confirmedWinner && p.winningBidPrice != null) {
        bucket = "CAN_MATERIALIZE";
        why = `lost：人工确认中标方「${confirmedWinner}」+ 中标价齐备`;
      } else if (confirmedWinner) {
        bucket = "NEEDS_REVIEW";
        why = `lost：有人工确认中标方「${confirmedWinner}」但缺中标价——需人工补录/确认金额`;
      } else {
        bucket = "MISSING_EVIDENCE";
        why = "lost：中标方未知（无人工确认的外部事实）——留待外部情报确认";
      }
    }
    rows.push({ id: p.id, name: p.name, status: p.tenderStatus ?? "?", bucket, why });
  }

  const submitted = await db.project.count({
    where: { workDomain: "tender", tenderStatus: "submitted" },
  });

  const count = (b: Bucket) => rows.filter((r) => r.bucket === b).length;
  console.log("═══ T4 award backfill DRY-RUN inventory（零写入） ═══");
  for (const r of rows) {
    console.log(`  [${r.bucket}] ${r.name} (${r.status}) — ${r.why}`);
  }
  console.log("──────────────────────────────────────────");
  console.log(`TOTAL_CLOSED = ${rows.length}`);
  console.log(`CAN_MATERIALIZE = ${count("CAN_MATERIALIZE")}`);
  console.log(`NEEDS_REVIEW = ${count("NEEDS_REVIEW")}`);
  console.log(`MISSING_EVIDENCE = ${count("MISSING_EVIDENCE")}`);
  console.log(`(参考) SUBMITTED_AWAITING_RESULT = ${submitted}（未结，不在 backfill 范围）`);
  console.log("PRODUCTION_BACKFILL = FORBIDDEN（materialize 须经 canonical service + 人工批准）");
  process.exit(0);
})().catch((e) => {
  console.error("dry-run 失败：", e instanceof Error ? e.message : e);
  process.exit(1);
});
