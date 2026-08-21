/**
 * 合规矩阵可用性批次 — 真实 E2E（隔离实库 + 真实模型翻译）
 *
 * 在生产快照分支上对真实 run 的真实英文要求跑翻译服务并写回，验证：
 *   译文真中文 / 数字与标准号保留 / 语义字段零触碰 / 幂等（重跑零花费）。
 *
 * 用法（仅隔离分支）：
 *   DATABASE_URL=... DIRECT_URL=... DATABASE_ENVIRONMENT=isolated \
 *     npx tsx scripts/bid-fit-usability-e2e.ts
 */

import { db } from "@/lib/db";
import { needsChineseTranslation } from "@/lib/tender-auto-analysis/requirement-lang";
import { translateRequirementTexts } from "@/lib/tender-auto-analysis/requirement-translate";

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

async function main() {
  assertIsolated();
  console.log("合规矩阵可用性批次 — 真实 E2E");

  // 取英文要求最多的 run（生产快照上的真实抽取结果）
  const runs = await db.tenderAnalysisRun.findMany({
    where: { status: { in: ["REVIEW_REQUIRED", "APPROVED"] } },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { id: true, projectId: true },
  });
  let target: { runId: string; rows: { id: string; chineseTranslation: string; mandatory: boolean; complianceStatus: string }[] } | null = null;
  for (const r of runs) {
    const rows = await db.tenderExtractedRequirement.findMany({
      where: { analysisRunId: r.id },
      orderBy: [{ mandatory: "desc" }, { requirementCode: "asc" }],
      take: 200,
      select: { id: true, chineseTranslation: true, mandatory: true, complianceStatus: true },
    });
    if (rows.filter((x) => needsChineseTranslation(x.chineseTranslation)).length >= 10) {
      target = { runId: r.id, rows };
      break;
    }
  }
  if (!target) throw new Error("快照上找不到含 ≥10 条英文要求的 run");
  const englishBefore = target.rows.filter((x) =>
    needsChineseTranslation(x.chineseTranslation),
  ).length;
  console.log(`  目标 run=${target.runId} 共 ${target.rows.length} 条，英文 ${englishBefore} 条`);
  ok(englishBefore >= 10, `E2E-01: 生产形态复现——中文字段里躺着 ${englishBefore} 条英文`);

  // 真模型翻译并写回（与 translate 端点同一服务面）
  const updates: { id: string; zh: string }[] = [];
  const t0 = Date.now();
  const out = await translateRequirementTexts(
    target.rows.map((r) => r.chineseTranslation),
    { apply: (idx, zh) => updates.push({ id: target!.rows[idx]!.id, zh }) },
  );
  console.log(`  翻译耗时 ${Math.round((Date.now() - t0) / 1000)}s`, out);
  ok(
    out.translated >= Math.floor(englishBefore * 0.8) && out.failed <= englishBefore - out.translated,
    `E2E-02: 真实模型批量翻译成功（translated=${out.translated}/${englishBefore}）`,
    out,
  );

  // 数字/标准号保留抽查：找一条含数字的原文，断言译文含同样数字串
  const numbered = updates
    .map((u) => ({ u, src: target!.rows.find((r) => r.id === u.id)! }))
    .filter(({ src }) => /\d{2,}/.test(src.chineseTranslation));
  const keep = numbered.slice(0, 5).every(({ u, src }) => {
    const nums = src.chineseTranslation.match(/\d{2,}(?:[.,]\d+)?/g) ?? [];
    return nums.every((n) => u.zh.includes(n));
  });
  ok(
    numbered.length === 0 || keep,
    `E2E-03: 数字/金额/标准号逐字保留（抽查 ${Math.min(5, numbered.length)} 条）`,
    numbered.slice(0, 2).map(({ u, src }) => ({ src: src.chineseTranslation.slice(0, 80), zh: u.zh.slice(0, 80) })),
  );

  // 写回 + 语义字段零触碰验证
  await db.$transaction(
    updates.map((u) =>
      db.tenderExtractedRequirement.update({
        where: { id: u.id },
        data: { chineseTranslation: u.zh },
      }),
    ),
  );
  // 精确复查同一批（run 总条数可能超取样窗，无序 take 会混入未翻条目）
  const after = await db.tenderExtractedRequirement.findMany({
    where: { id: { in: target.rows.map((r) => r.id) } },
    select: { id: true, chineseTranslation: true, mandatory: true, complianceStatus: true, originalRequirement: true },
  });
  const englishAfter = after.filter((x) => needsChineseTranslation(x.chineseTranslation)).length;
  ok(
    englishAfter <= englishBefore - out.translated,
    `E2E-04: 写回后英文条数 ${englishBefore} → ${englishAfter}`,
  );
  const semanticsDrift = after.filter((a) => {
    const b = target!.rows.find((r) => r.id === a.id);
    return b && (a.mandatory !== b.mandatory || a.complianceStatus !== b.complianceStatus);
  });
  ok(
    semanticsDrift.length === 0 &&
      after.every((a) => a.originalRequirement.trim().length > 0),
    "E2E-05: 语义字段（mandatory/complianceStatus）零触碰；原文完整保留",
    semanticsDrift.slice(0, 3),
  );

  // 幂等：重跑同批 → 已翻条目全部 skip，零模型花费（translated=0）
  const rerun = await translateRequirementTexts(
    after.map((r) => r.chineseTranslation),
    {
      invoker: async () => {
        throw new Error("SHOULD_NOT_CALL_MODEL_WHEN_ALL_CHINESE");
      },
      apply: () => {},
    },
  );
  ok(
    rerun.translated === 0 && rerun.failed === englishAfter,
    `E2E-06: 幂等重跑——已翻条目零模型花费（仅残留 ${englishAfter} 条英文会再试）`,
    rerun,
  );

  console.log(`\n结果：${pass} 通过，${fail} 失败`);
  await db.$disconnect();
  if (fail > 0) process.exit(1);
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
