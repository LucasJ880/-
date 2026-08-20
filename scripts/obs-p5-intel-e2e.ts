/**
 * 观察期包5 — 外部情报编排真实 E2E（隔离实库 + 真实出站检索）
 *
 * 在生产快照分支上验证两个真实场景（正是生产诊断出的两种卡死态）：
 *   A. 项目**没有**调查室（时序倒置受害者）→ 编排自动建房 + 状态落库；
 *   B. 项目有调查室但从未获得外部情报键 → 手动触发补跑成功。
 *
 * 真实出站：M1 open.canada.ca CKAN（无需密钥）；M2 需 TAVILY_API_KEY
 * （本地缺失时验证优雅降级）；M2.5 需 OPENAI_*（有候选才会调用，一次）。
 *
 * 用法（仅隔离分支）：
 *   DATABASE_URL=... DIRECT_URL=... DATABASE_ENVIRONMENT=isolated \
 *     TENDER_EXTERNAL_INTEL_ENABLED=1 npx tsx scripts/obs-p5-intel-e2e.ts
 */

import { db } from "@/lib/db";
import {
  runExternalIntelForProject,
  isExternalIntelRateLimited,
  EXTERNAL_INTEL_STATUS_KEY,
  type ExternalIntelStatus,
} from "@/lib/tender-intel/orchestrate";

let pass = 0;
let fail = 0;
const ok = (c: boolean, n: string, d?: unknown) => {
  if (c) { pass++; console.log(`  ✓ ${n}`); }
  else { fail++; console.error(`  ✗ ${n}`, d ?? ""); }
};

function assertIsolated(): void {
  const url = process.env.DATABASE_URL ?? "";
  if (!url) throw new Error("DATABASE_URL 未设置");
  if (/ep-super-field-antfibsl/.test(url)) {
    throw new Error("拒绝在生产库上运行（fail-closed）");
  }
  if (process.env.DATABASE_ENVIRONMENT !== "isolated") {
    throw new Error("DATABASE_ENVIRONMENT 必须为 isolated");
  }
}

async function roomState(projectId: string) {
  const room = await db.bidIntelligenceRoom.findUnique({
    where: { projectId },
    select: { id: true, summaryJson: true },
  });
  const sj = ((room?.summaryJson as Record<string, unknown>) ?? {}) as Record<
    string,
    unknown
  >;
  return {
    exists: Boolean(room),
    keys: Object.keys(sj),
    status: (sj[EXTERNAL_INTEL_STATUS_KEY] ?? null) as ExternalIntelStatus | null,
  };
}

async function main() {
  assertIsolated();
  console.log("观察期包5 — 外部情报编排真实 E2E");

  // 场景 A：有分析记录但没有调查室的 tender 项目（时序倒置受害者）
  const noRoom = await db.project.findFirst({
    where: {
      workDomain: "tender",
      intelligenceRoom: null,
      tenderAnalysisRuns: { some: {} },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true },
  });
  if (!noRoom) throw new Error("快照上找不到「有分析、无调查室」的项目");
  console.log(`  场景 A：${noRoom.name.slice(0, 50)}`);

  const beforeA = await roomState(noRoom.id);
  ok(!beforeA.exists, "E2E-01: 前置确认——该项目当前没有调查室（旧实现会静默丢弃）");

  const outcomeA = await runExternalIntelForProject({
    projectId: noRoom.id,
    trigger: "manual",
  });
  const afterA = await roomState(noRoom.id);
  ok(
    afterA.exists,
    "E2E-02: 编排自动创建调查室（房间不再是前置条件）",
    outcomeA,
  );
  ok(
    afterA.status !== null &&
      afterA.status.trigger === "manual" &&
      ["ran", "skipped", "error"].includes(afterA.status.status),
    `E2E-03: 显式状态已落库（status=${afterA.status?.status} reason=${afterA.status?.reason ?? "-"}）`,
    afterA.status,
  );
  ok(
    outcomeA.status !== "error",
    `E2E-04: 真实出站编排无异常（award=${outcomeA.awardCandidates} web=${outcomeA.webDomains} analyzed=${outcomeA.analyzed}）`,
    outcomeA,
  );
  if (outcomeA.status === "ran") {
    ok(
      afterA.keys.includes("externalCandidates") || afterA.keys.includes("webIntel"),
      "E2E-05: 检索结果真实落库（不再依赖房间恰好先存在）",
      afterA.keys,
    );
  } else {
    ok(
      afterA.status?.reason != null,
      `E2E-05: 无结果也有显式原因（${afterA.status?.reason}），不再无痕`,
    );
  }

  // 场景 B：有调查室但从未有外部情报键的项目（生产 08-31 SK 形态）
  const stuck = await db.project.findFirst({
    where: {
      workDomain: "tender",
      id: { not: noRoom.id },
      intelligenceRoom: { isNot: null },
      tenderAnalysisRuns: { some: {} },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true },
  });
  if (stuck) {
    console.log(`  场景 B：${stuck.name.slice(0, 50)}`);
    const beforeB = await roomState(stuck.id);
    const outcomeB = await runExternalIntelForProject({
      projectId: stuck.id,
      trigger: "manual",
    });
    const afterB = await roomState(stuck.id);
    ok(
      afterB.status !== null && outcomeB.status !== "error",
      `E2E-06: 存量卡死态可手动解救（before keys=${beforeB.keys.length} → status=${afterB.status?.status} award=${outcomeB.awardCandidates}）`,
      outcomeB,
    );
    ok(
      isExternalIntelRateLimited(afterB.status, Date.now()),
      "E2E-07: 刚跑完立即处于频控窗口（连点被 60s 频控拒绝）",
    );
  } else {
    console.log("  场景 B：快照上无符合条件项目，跳过（E2E-06/07 不计）");
  }

  console.log(`\n结果：${pass} 通过，${fail} 失败`);
  await db.$disconnect();
  if (fail > 0) process.exit(1);
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
