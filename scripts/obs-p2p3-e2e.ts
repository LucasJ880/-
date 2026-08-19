/**
 * 观察期包2+包3 — 真实 E2E（隔离实库，零模型 / 零 blob / 零 cron tick）
 *
 * P3：① flags 命中 → auto-enqueue 改派 workforce（真实创建 Job，零 legacy run）
 *     ② 重放幂等（at-most-one Job）
 *     ③ flag 关闭但存在活跃 workforce run → 兜底拒起 legacy
 * P2：④ 终态化 REVIEW_REQUIRED → 恰 N 条完成通知（N=收件人数）；重复终态化/
 *        重放通知均不增量（sourceKey 幂等）
 *     ⑤ 失败 → 恰 N 条失败通知；cancelled → 0 条
 *
 * 用法（仅隔离分支）：
 *   DATABASE_URL=... DIRECT_URL=... DATABASE_ENVIRONMENT=isolated \
 *     npx tsx scripts/obs-p2p3-e2e.ts
 */

import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { enqueueTenderPackageIfReady } from "@/lib/tender-auto-analysis/enqueue-package";
import { getTenderPackageReadiness } from "@/lib/tender-auto-analysis/package-ready";
import {
  finalizeWorkforceTenderCanonicalV2Run,
  failWorkforceTenderAnalysisRun,
  TENDER_WORKFORCE_ANALYSIS_VERSION,
  TENDER_AGENT_RUN_STATUS,
} from "@/lib/tender-workforce/analysis-run-service";
import { notifyTenderRunSucceeded } from "@/lib/tender-auto-analysis/alerts";

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

function setWorkforceFlags(orgId: string, on: boolean) {
  const v = on ? "1" : "";
  process.env.TENDER_AUTO_PACKAGE_ANALYSIS_ENABLED = "1";
  process.env.TENDER_AUTO_PACKAGE_ANALYSIS_ORG_ALLOWLIST = orgId;
  process.env.WORKFORCE_RUNTIME_ENABLED = v;
  process.env.WORKFORCE_RUNTIME_ORG_ALLOWLIST = on ? orgId : "";
  process.env.TENDER_WORKFORCE_ANALYSIS_ENABLED = v;
  process.env.TENDER_WORKFORCE_ANALYSIS_ORG_ALLOWLIST = on ? orgId : "";
  process.env.TENDER_WORKFORCE_DETERMINISTIC_PLAN_ENABLED = v;
  process.env.TENDER_WORKFORCE_DETERMINISTIC_PLAN_ORG_ALLOWLIST = on ? orgId : "";
  process.env.AGENT_RUNTIME_V2_ENABLED = v;
  process.env.AGENT_RUNTIME_V2_ORG_ALLOWLIST = on ? orgId : "";
  process.env.AGENT_RUNTIME_V2_MAX_STEPS = "9";
}

async function notifCount(prefix: string): Promise<number> {
  return db.notification.count({ where: { sourceKey: { startsWith: prefix } } });
}

async function main() {
  assertIsolated();
  console.log("观察期包2+包3 — 真实 E2E");

  // 找一个 readiness=ready 的真实 tender 项目
  const candidates = await db.project.findMany({
    where: { workDomain: "tender", orgId: { not: null } },
    orderBy: { createdAt: "desc" },
    take: 8,
    select: { id: true, name: true, orgId: true, ownerId: true },
  });
  let target: (typeof candidates)[number] | null = null;
  for (const c of candidates) {
    const r = await getTenderPackageReadiness(c.id);
    if (r.ready) { target = c; break; }
  }
  if (!target?.orgId) throw new Error("快照上找不到 readiness=ready 的项目");
  console.log(`  项目：${target.name.slice(0, 40)}`);
  const orgId = target.orgId;
  const t0 = new Date();

  // ── ① P3 改派 ──
  setWorkforceFlags(orgId, true);
  const r1 = await enqueueTenderPackageIfReady({
    projectId: target.id,
    userId: target.ownerId,
    orgId,
    trigger: "process_next_done",
  });
  const legacyAfter = await db.tenderAnalysisRun.count({
    where: {
      projectId: target.id,
      analysisVersion: { not: TENDER_WORKFORCE_ANALYSIS_VERSION },
      createdAt: { gte: t0 },
    },
  });
  ok(
    r1.enqueued && r1.pipeline === "workforce" && !!r1.runId && legacyAfter === 0,
    `E2E-01: flags 命中 → 改派 workforce（job=${r1.runId?.slice(0, 8)}…，零 legacy run）`,
    r1,
  );

  // ── ② 重放幂等（两次调用之间零新建 Job） ──
  const tMid = new Date();
  const r2 = await enqueueTenderPackageIfReady({
    projectId: target.id,
    userId: target.ownerId,
    orgId,
    trigger: "process_next_done",
  });
  const newJobs = await db.agentRun.count({
    where: { runType: "workforce_job", createdAt: { gte: tMid } },
  });
  ok(
    r2.pipeline === "workforce" && r2.runId === r1.runId && newJobs === 0,
    `E2E-02: 重放幂等（同一 Job，零新建；reason=${r2.reason}）`,
    r2,
  );

  // ── ③ flag 关闭 + 活跃 workforce run → 兜底拒起 legacy ──
  setWorkforceFlags(orgId, false);
  const fixtureRun = await db.tenderAnalysisRun.create({
    data: {
      orgId,
      projectId: target.id,
      createdById: target.ownerId,
      analysisVersion: TENDER_WORKFORCE_ANALYSIS_VERSION,
      status: TENDER_AGENT_RUN_STATUS.running,
      idempotencyKey: `p2p3e2e:${randomUUID()}`,
      sourceHashFingerprint: `p2p3e2e-fp-${randomUUID().slice(0, 8)}`,
    },
    select: { id: true },
  });
  const r3 = await enqueueTenderPackageIfReady({
    projectId: target.id,
    userId: target.ownerId,
    orgId,
    trigger: "process_next_done",
  });
  ok(
    !r3.enqueued && r3.reason === "workforce_active",
    `E2E-03: flag 关闭但 workforce 活跃 → 兜底拒起 legacy（reason=${r3.reason}）`,
    r3,
  );

  // ── ④ P2 完成通知（恰 N 条 + 双重幂等） ──
  const okPrefix = `tender-run-succeeded:${fixtureRun.id}`;
  await db.tenderAnalysisRun.update({
    where: { id: fixtureRun.id },
    data: {
      summaryJson: {
        analystSynthesis: {
          coverage: { analyzed: 3, uploaded: 4 },
          keyRequirements: [{}, {}],
          risksAndGaps: [{}],
          clarifications: [],
          qa: { needsHumanReview: true },
        },
      },
    },
  });
  const fin1 = await finalizeWorkforceTenderCanonicalV2Run({
    orgId,
    projectId: target.id,
    analysisRunId: fixtureRun.id,
  });
  const n1 = await notifCount(okPrefix);
  ok(
    fin1.ok && n1 >= 1,
    `E2E-04: 终态化 REVIEW_REQUIRED → 完成通知恰 ${n1} 条（=收件人数）`,
  );
  const fin2 = await finalizeWorkforceTenderCanonicalV2Run({
    orgId,
    projectId: target.id,
    analysisRunId: fixtureRun.id,
  });
  await notifyTenderRunSucceeded(fixtureRun.id);
  const n2 = await notifCount(okPrefix);
  ok(
    !fin2.ok && n2 === n1,
    `E2E-05: 重复终态化被拒 + 通知重放零增量（${n1} → ${n2}，DUPLICATE=0）`,
  );

  // ── ⑤ 失败通知 + cancelled 不打扰 ──
  const failRun = await db.tenderAnalysisRun.create({
    data: {
      orgId,
      projectId: target.id,
      createdById: target.ownerId,
      analysisVersion: TENDER_WORKFORCE_ANALYSIS_VERSION,
      status: TENDER_AGENT_RUN_STATUS.running,
      idempotencyKey: `p2p3e2e:${randomUUID()}`,
      sourceHashFingerprint: `p2p3e2e-fp-${randomUUID().slice(0, 8)}`,
    },
    select: { id: true },
  });
  await failWorkforceTenderAnalysisRun({
    orgId,
    analysisRunId: failRun.id,
    errorCode: "worker_failed",
    errorMessage: "e2e 注入失败",
  });
  const nf = await notifCount(`tender-run-failed:${failRun.id}`);
  ok(nf >= 1, `E2E-06: AGENT_FAILED → 失败通知恰 ${nf} 条`);

  const cancelRun = await db.tenderAnalysisRun.create({
    data: {
      orgId,
      projectId: target.id,
      createdById: target.ownerId,
      analysisVersion: TENDER_WORKFORCE_ANALYSIS_VERSION,
      status: TENDER_AGENT_RUN_STATUS.running,
      idempotencyKey: `p2p3e2e:${randomUUID()}`,
      sourceHashFingerprint: `p2p3e2e-fp-${randomUUID().slice(0, 8)}`,
    },
    select: { id: true },
  });
  await failWorkforceTenderAnalysisRun({
    orgId,
    analysisRunId: cancelRun.id,
    errorCode: "cancelled",
    errorMessage: "用户重新发起分析",
  });
  const nc = await notifCount(`tender-run-failed:${cancelRun.id}`);
  ok(nc === 0, "E2E-07: cancelled（用户重新分析）零通知（不打扰）");

  console.log(`\n结果：${pass} 通过，${fail} 失败`);
  await db.$disconnect();
  if (fail > 0) process.exit(1);
}

void main().catch((e) => { console.error(e); process.exit(1); });
