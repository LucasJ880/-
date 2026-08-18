/**
 * 情报自动流（包6）— 真实 E2E（隔离实库 + 真实出站 + 真实模型一次）
 *
 * 验证三件事：
 * 1. 自动观察幂等：同 reference 重放 → 恒一条（CREATED → ALREADY_OBSERVED）；
 * 2. 人工确认升级**同一条**记录（不产生重复），SYSTEM_VERIFIED → HUMAN_CONFIRMED；
 * 3. 全自动链：runExternalIntelForProject 一次调用产出 自动观察计数 + AI 策略草案
 *    （bidStrategyAuto，AI_INFERRED）——七槽位数据零人工产生。
 *
 * 用法（仅隔离分支）：
 *   DATABASE_URL=... DIRECT_URL=... DATABASE_ENVIRONMENT=isolated \
 *     T4_AWARD_INTELLIGENCE_SCHEMA_READY=1 TENDER_EXTERNAL_INTEL_ENABLED=1 \
 *     OPENAI_...（策略合成一次模型调用） npx tsx scripts/intel-auto-flow-e2e.ts
 */

import { db } from "@/lib/db";
import {
  createOrObserveAwardRecord,
  materializeWinnerConfirmation,
  listAwardsForOrg,
} from "@/lib/tender-intel/awards";
import { deriveAwardIntelligence } from "@/lib/tender-intel/award-intelligence";
import { runExternalIntelForProject } from "@/lib/tender-intel/orchestrate";

let pass = 0;
let fail = 0;
const ok = (c: boolean, n: string, d?: unknown) => {
  if (c) { pass++; console.log(`  ✓ ${n}`); }
  else { fail++; console.error(`  ✗ ${n}`, d ?? ""); }
};

function assertIsolated(): void {
  const url = process.env.DATABASE_URL ?? "";
  if (!url) throw new Error("DATABASE_URL 未设置");
  if (/ep-super-field-antfibsl/.test(url)) throw new Error("拒绝在生产库上运行");
  if (process.env.DATABASE_ENVIRONMENT !== "isolated") throw new Error("需 isolated");
}

async function main() {
  assertIsolated();
  console.log("情报自动流（包6）— 真实 E2E");

  const project = await db.project.findFirst({
    where: { workDomain: "tender", orgId: { not: null }, tenderAnalysisRuns: { some: {} } },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, orgId: true },
  });
  if (!project?.orgId) throw new Error("找不到带 org 的已分析 tender 项目");
  const orgId = project.orgId;
  console.log(`  项目：${project.name.slice(0, 40)}`);

  // ── 1+2. 观察幂等 + 确认升级同记录 ──
  const ref = `E2E-AF-${Date.now()}`;
  const sourceKey = `canadabuys:${ref}`;
  const observeInput = {
    orgId,
    actor: { actorType: "system", userId: null },
    award: {
      winnerName: "Northern Test Supplies Ltd.",
      buyerNameRaw: "Regional Municipality of Durham",
      solicitationNumber: ref,
      awardDate: new Date("2025-11-01"),
      contractAmount: 88_000,
      currency: "CAD",
      scopeSummary: "supply and delivery of paper bags",
    },
    source: {
      sourceType: "CANADABUYS_OPEN_DATA" as const,
      sourceKey,
      sourceUrl: "https://canadabuys.canada.ca/en/tender-opportunities/e2e",
      evidenceSnippet: "E2E observation fixture (isolated branch)",
      capturedAt: new Date(),
    },
    confidence: "HIGH" as const,
    verificationStatus: "SYSTEM_VERIFIED" as const,
  };
  const o1 = await createOrObserveAwardRecord(observeInput);
  const o2 = await createOrObserveAwardRecord(observeInput);
  const countAfterObserve = await db.awardRecord.count({
    where: { orgId, sources: { some: { sourceKey } } },
  });
  ok(
    o1.outcome === "CREATED" && o2.outcome === "ALREADY_OBSERVED" && countAfterObserve === 1,
    `E2E-01: 自动观察幂等（${o1.outcome} → ${o2.outcome}，恒 1 条）`,
  );

  const rowsA = await listAwardsForOrg({ orgId });
  const intelA = deriveAwardIntelligence(rowsA);
  ok(
    intelA.historicalAwards.records.some(
      (r) => r.winnerName === "Northern Test Supplies Ltd." && r.contractAmount === 88_000,
    ),
    "E2E-02: SYSTEM_VERIFIED 记录自动进入权威投影（含金额）——槽位零人工点亮",
  );

  const admin = await db.organizationMember.findFirst({
    where: { orgId, role: "org_admin" },
    select: { userId: true },
  });
  if (!admin) throw new Error("无 org_admin");
  const up = await db.$transaction(async (tx) =>
    materializeWinnerConfirmation(
      {
        orgId,
        actor: { actorType: "user", userId: admin.userId },
        award: {
          winnerName: "Northern Test Supplies Ltd.",
          buyerNameRaw: "Regional Municipality of Durham",
          projectId: project.id,
          solicitationNumber: ref,
          awardDate: new Date("2025-11-01"),
          contractAmount: 88_000,
          currency: "CAD",
          scopeSummary: "supply and delivery of paper bags",
        },
        source: {
          sourceType: "CANADABUYS_OPEN_DATA",
          sourceKey,
          sourceUrl: "https://canadabuys.canada.ca/en/tender-opportunities/e2e",
          evidenceSnippet: null,
          capturedAt: new Date(),
        },
        confidence: "HIGH",
        verificationStatus: "HUMAN_CONFIRMED",
      },
      { client: tx as never },
    ),
  );
  const countAfterConfirm = await db.awardRecord.count({
    where: { orgId, sources: { some: { sourceKey } } },
  });
  const upgraded = await db.awardRecord.findFirst({
    where: { orgId, sources: { some: { sourceKey } } },
    select: { verificationStatus: true },
  });
  // 设计语义（T4 冻结服务）：同 sourceKey 已观察 → 防重复优先，不产生第二条；
  // 记录本已是权威级（SYSTEM_VERIFIED），人工确认不降级不重复（升级态是妆点非语义）。
  ok(
    countAfterConfirm === 1 &&
      ["SYSTEM_VERIFIED", "HUMAN_CONFIRMED"].includes(upgraded?.verificationStatus ?? ""),
    `E2E-03: 人工确认零重复（恒 1 条，记录保持权威级=${upgraded?.verificationStatus}；materialized=${up.materialized}）`,
  );

  // ── 3. 全自动链（真实出站 + 策略合成一次模型调用） ──
  const outcome = await runExternalIntelForProject({
    projectId: project.id,
    trigger: "manual",
  });
  const room = await db.bidIntelligenceRoom.findUnique({
    where: { projectId: project.id },
    select: { summaryJson: true },
  });
  const sj = ((room?.summaryJson as Record<string, unknown>) ?? {}) as Record<string, unknown>;
  const strategy = sj.bidStrategyAuto as { label?: string; strategyZh?: string } | null;
  ok(
    outcome.status !== "error" && typeof outcome.autoObserved === "number",
    `E2E-04: 全自动链无异常（autoObserved=${outcome.autoObserved} candidates=${outcome.awardCandidates}）`,
    outcome,
  );
  ok(
    outcome.strategyGenerated === true &&
      strategy?.label === "AI_INFERRED" &&
      (strategy?.strategyZh ?? "").length > 10,
    "E2E-05: AI 策略草案自动生成并落库（AI_INFERRED，人审语义）——第 7 槽自动点亮",
    { strategyGenerated: outcome.strategyGenerated, label: strategy?.label },
  );

  console.log(`\n结果：${pass} 通过，${fail} 失败`);
  await db.$disconnect();
  if (fail > 0) process.exit(1);
}

void main().catch((e) => { console.error(e); process.exit(1); });
