/** 情报运维双件套 E2E：真实 CKAN 出站 + 盯梢变更检测（隔离库，注入 fetch）。 */
import { db } from "@/lib/db";
import { searchContractsByVendor, summarizeVendorContracts } from "@/lib/tender-intel/canadabuys";
import { checkTenderWatch } from "@/lib/tender-intel/watch";
let pass = 0; let fail = 0;
const ok = (c: boolean, n: string, d?: unknown) => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.error(`  ✗ ${n}`, d ?? ""); } };
function assertIsolated() {
  const url = process.env.DATABASE_URL ?? "";
  if (!url || /ep-super-field-antfibsl/.test(url) || process.env.DATABASE_ENVIRONMENT !== "isolated") throw new Error("需隔离分支");
}
async function main() {
  assertIsolated();
  // ① 真实出站：Meltwater 全量联邦合同（对齐用户手工验证点）
  const vc = await searchContractsByVendor({ vendor: "Meltwater" });
  const sum = summarizeVendorContracts(vc.rows);
  ok(vc.ok && vc.total >= 100, `E2E-01: 全量资源真实命中（total=${vc.total}）`);
  ok(
    vc.rows.some((r) => Math.abs((r.contractValue ?? 0) - 42540.75) < 0.01),
    "E2E-02: 含用户验证过的 ESDC $42,540.75 数据点",
  );
  ok(
    sum.sampleSize >= 30 && (sum.median ?? 0) > 10000 && (sum.median ?? 0) < 200000,
    `E2E-03: 价格带汇总合理（n=${sum.sampleSize} 中位=$${sum.median}）`,
  );

  // ② 盯梢：隔离库真实项目，注入 fetch 两次不同内容 → 恰一条通知 + 重复 tick 幂等
  const project = await db.project.findFirst({
    where: { workDomain: "tender", orgId: { not: null } },
    orderBy: { createdAt: "desc" },
    select: { id: true, orgId: true, ownerId: true },
  });
  if (!project?.orgId) throw new Error("无项目");
  const room = await db.bidIntelligenceRoom.upsert({
    where: { projectId: project.id },
    create: { orgId: project.orgId, projectId: project.id },
    update: {},
    select: { id: true, summaryJson: true },
  });
  const sj = (room.summaryJson ?? {}) as Record<string, unknown>;
  await db.bidIntelligenceRoom.update({
    where: { id: room.id },
    data: { summaryJson: JSON.parse(JSON.stringify({ ...sj, tenderWatch: { url: "https://example.org/tender" } })) },
  });
  const page = (body: string) => (async () => new Response(body, { status: 200 })) as unknown as typeof fetch;
  const r1 = await checkTenderWatch(project.id, { fetchImpl: page("<body>Addenda: 0</body>") });
  ok(r1.status === "unchanged", `E2E-04: 基线抓取只记 hash 不通知（${r1.status}）`);
  const r2 = await checkTenderWatch(project.id, { fetchImpl: page("<body>Addenda: 1 — new</body>") });
  const n1 = await db.notification.count({ where: { sourceKey: { startsWith: `tender-watch:${project.id}:` } } });
  ok(r2.status === "changed" && n1 === 1, `E2E-05: 变更检测 → 恰 1 条通知（${r2.status}, n=${n1}）`);
  const r3 = await checkTenderWatch(project.id, { fetchImpl: page("<body>Addenda: 1 — new</body>") });
  const n2 = await db.notification.count({ where: { sourceKey: { startsWith: `tender-watch:${project.id}:` } } });
  ok(r3.status === "unchanged" && n2 === 1, `E2E-06: 同内容重复 tick 零新通知（幂等）`);
  console.log(`\n结果：${pass} 通过，${fail} 失败`);
  await db.$disconnect();
  if (fail > 0) process.exit(1);
}
void main().catch((e) => { console.error(e); process.exit(1); });
