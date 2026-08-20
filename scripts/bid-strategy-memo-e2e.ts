/** 批次一 E2E（隔离快照 + 真实模型）：Halifax 真实数据 → 备忘录 v2 落库。 */
import { db } from "@/lib/db";
import { runExternalIntelForProject } from "@/lib/tender-intel/orchestrate";
let pass = 0; let fail = 0;
const ok = (c: boolean, n: string, d?: unknown) => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.error(`  ✗ ${n}`, d ?? ""); } };
function assertIsolated() {
  const url = process.env.DATABASE_URL ?? "";
  if (!url || /ep-super-field-antfibsl/.test(url) || process.env.DATABASE_ENVIRONMENT !== "isolated") throw new Error("需隔离分支");
}
async function main() {
  assertIsolated();
  const projectId = "cmt0lt29v0001jw04sicip1at"; // Halifax（真实 86 事实 + incumbentLead 已记录）
  const out = await runExternalIntelForProject({ projectId, trigger: "manual" });
  ok(out.status !== "error" && out.strategyGenerated === true, `E2E-01: 全链无异常且备忘录生成（${JSON.stringify(out)}）`);
  const room = await db.bidIntelligenceRoom.findUniqueOrThrow({ where: { projectId }, select: { summaryJson: true } });
  const sj = (room.summaryJson ?? {}) as Record<string, unknown>;
  const memo = sj.bidStrategyMemo as Record<string, unknown> | undefined;
  ok(!!memo && memo.label === "AI_INFERRED" && String(memo.version).includes("v2"), "E2E-02: 备忘录 v2 落库（AI_INFERRED）");
  const gates = (memo?.riskGates as unknown[]) ?? [];
  const rfis = (memo?.strategicRfis as unknown[]) ?? [];
  ok(gates.length >= 2 && rfis.length >= 1, `E2E-03: 风险门 ${gates.length} 条 + 策略级 RFI ${rfis.length} 条`);
  ok(!("goNoGo" in (memo ?? {})) && !String(memo?.summaryZh ?? "").match(/^(GO|NO-GO)$/), "E2E-04（反例守卫）: 无整体 GO/NO-GO 裁决字段");
  const landscape = String(memo?.competitiveLandscapeZh ?? "");
  console.log("  竞争格局（实录）:", landscape.slice(0, 180));
  console.log("  评分演算（实录）:", String(memo?.scoringAnalysisZh ?? "").slice(0, 180));
  ok(landscape.length > 20, "E2E-05: 竞争格局非空（incumbentLead 已入输入面）");
  console.log(`\n结果：${pass} 通过，${fail} 失败`);
  await db.$disconnect();
  if (fail > 0) process.exit(1);
}
void main().catch((e) => { console.error(e); process.exit(1); });
