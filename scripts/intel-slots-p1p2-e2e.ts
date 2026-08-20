/**
 * 情报阶段1+2 — 真实 E2E（隔离实库，零模型零出站）
 *
 * 在生产快照分支上验证「第一桶金」闭环：
 * 人工标记 won → AwardRecord（我方中标事实，幂等）+ Buyer canonical
 * → T4 七域投影立即可见（历史中标/竞争对手/买家画像亮起）。
 *
 * 用法（仅隔离分支）：
 *   DATABASE_URL=... DIRECT_URL=... DATABASE_ENVIRONMENT=isolated \
 *     T4_AWARD_INTELLIGENCE_SCHEMA_READY=1 npx tsx scripts/intel-slots-p1p2-e2e.ts
 */

import { db } from "@/lib/db";
import { markProjectTenderResult } from "@/lib/projects/tender-result";
import { deriveAwardIntelligence } from "@/lib/tender-intel/award-intelligence";

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
  console.log("情报阶段1+2 — 真实 E2E（结果回灌 → 投影亮起）");

  const project = await db.project.findFirst({
    where: { workDomain: "tender", orgId: { not: null }, clientOrganization: { not: null } },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, orgId: true, clientOrganization: true },
  });
  if (!project?.orgId) throw new Error("快照上找不到带 org+买家的 tender 项目");
  const admin = await db.organizationMember.findFirst({
    where: { orgId: project.orgId, role: "org_admin" },
    select: { userId: true },
  });
  if (!admin) throw new Error("org 无 org_admin 成员");
  console.log(`  项目：${project.name.slice(0, 40)} · 买家：${project.clientOrganization}`);

  const sourceKey = `own-result:${project.id}`;
  const before = await db.awardRecord.count({
    where: { orgId: project.orgId, sources: { some: { sourceKey } } },
  });
  ok(before === 0, "E2E-01: 前置——该项目尚无 own-result 授标事实");

  const r1 = await markProjectTenderResult({
    projectId: project.id,
    result: "won",
    winningBidPrice: 123456,
    currency: "CAD",
    awardDate: new Date("2026-08-15"),
    actorUserId: admin.userId,
  });
  ok(
    r1.canonicalBackfill?.award === "written" && !!r1.canonicalBackfill?.awardRecordId,
    `E2E-02: 标记 won → 我方 award 事实写入（${r1.canonicalBackfill?.awardRecordId}）`,
    r1.canonicalBackfill,
  );
  ok(
    ["created", "matched"].includes(r1.canonicalBackfill?.buyer ?? ""),
    `E2E-03: 买家沉淀 T3 Buyer canonical（${r1.canonicalBackfill?.buyer}）`,
    r1.canonicalBackfill,
  );

  const r2 = await markProjectTenderResult({
    projectId: project.id,
    result: "won",
    actorUserId: admin.userId,
  });
  const after = await db.awardRecord.count({
    where: { orgId: project.orgId, sources: { some: { sourceKey } } },
  });
  ok(
    after === 1,
    `E2E-04: 重复标记幂等（sourceKey 恒一条，实得 ${after}；二次回灌=${r2.canonicalBackfill?.award}）`,
  );

  const rows = await db.awardRecord.findMany({
    where: { orgId: project.orgId, status: { not: "RETRACTED" } },
  });
  const intel = deriveAwardIntelligence(
    rows as Parameters<typeof deriveAwardIntelligence>[0],
  );
  const org = await db.organization.findUnique({
    where: { id: project.orgId }, select: { name: true },
  });
  ok(
    intel.historicalAwards.status === "CONFIRMED" &&
      intel.historicalAwards.records.some((x) => x.winnerName === org?.name),
    "E2E-05: 七域投影亮起——历史中标 CONFIRMED 且含我方中标事实",
  );
  ok(
    intel.buyerPattern.buyers.some(
      (b) => b.buyerName === project.clientOrganization,
    ),
    "E2E-06: 买家画像域出现该买家（回灌带 buyerNameRaw）",
    intel.buyerPattern.buyers.map((b) => b.buyerName),
  );

  const buyer = await db.buyer.findFirst({
    where: { orgId: project.orgId },
    select: { canonicalName: true, status: true },
  });
  ok(
    buyer !== null,
    `E2E-07: T3 Buyer 表从 0 到 1（${buyer?.canonicalName} / ${buyer?.status}）`,
  );

  console.log(`\n结果：${pass} 通过，${fail} 失败`);
  await db.$disconnect();
  if (fail > 0) process.exit(1);
}

void main().catch((e) => { console.error(e); process.exit(1); });
