/**
 * 抽取 prompt A/B：单元归属正确率（真实模型调用，成本受控）
 *
 * 基线（@3）来自生产 run 的 workerCursor 缓存输出——零成本；
 * 处理组（当前仓库 prompt 版本）只对**引错单元最集中的窗口**重新调用模型。
 *
 * 指标（同一套重放口径，不依赖任何主观判断）：
 *   - misattributed：引文逐字存在于本文档另一单元 → 模型引错了单元号
 *   - notFound     ：引文在本文档内根本不存在 → 改写/臆造
 *   - accepted     ：过完整 verifyCandidates 后进入业务结果的条数
 *
 * 用法：
 *   RUN_ID=<runId> WINDOWS=20 npx tsx scripts/tender-extract-prompt-ab.ts
 */

import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import type {
  AnalyzerInput,
  ExtractionOutputV2,
} from "@/lib/tender-understanding/contract";
import {
  collectWindowCandidates,
  runExtractionWindow,
} from "@/lib/tender-understanding/analyzer";
import { buildAllWindows, type SectionWindow } from "@/lib/tender-understanding/manifest";
import { createUnifiedRuntimeInvoker } from "@/lib/tender-understanding/llm";
import { normalizeForMatch } from "@/lib/tender-understanding/normalize";
import { verifyCandidates } from "@/lib/tender-understanding/verify";
import { PROMPT_EXTRACT } from "@/lib/tender-understanding/prompts";

if (!process.env.DATABASE_URL) {
  for (const line of readFileSync("/Users/user/Desktop/青砚/.env", "utf-8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const prisma = new PrismaClient();
const RUN_ID = process.env.RUN_ID ?? "";
const MAX_WINDOWS = Number(process.env.WINDOWS ?? "20");

async function loadInput(runId: string): Promise<AnalyzerInput> {
  const run = await prisma.tenderAnalysisRun.findUniqueOrThrow({
    where: { id: runId },
    select: {
      projectId: true,
      documents: {
        orderBy: { createdAt: "asc" },
        select: {
          documentId: true,
          role: true,
          contentHash: true,
          document: { select: { title: true, fileType: true } },
        },
      },
    },
  });
  const ids = run.documents.map((d) => d.documentId);
  const pages = await prisma.projectDocumentPage.findMany({
    where: { documentId: { in: ids } },
    orderBy: [{ documentId: "asc" }, { pageNumber: "asc" }],
    select: {
      documentId: true,
      pageNumber: true,
      contentText: true,
      unitKind: true,
      unitLabel: true,
    },
  });
  const byDoc = new Map<string, typeof pages>();
  for (const p of pages) byDoc.set(p.documentId, [...(byDoc.get(p.documentId) ?? []), p]);

  return {
    projectId: run.projectId,
    documents: run.documents.map((d) => ({
      documentId: d.documentId,
      name: d.document?.title ?? d.documentId,
      type: d.document?.fileType ?? "pdf",
      sourceRole:
        d.role === "ADDENDUM" ? "ADDENDUM" : d.role === "FORM" ? "FORM" : "BASE_TENDER",
      pages: (byDoc.get(d.documentId) ?? []).map((p) => ({
        pageNumber: p.pageNumber,
        contentText: p.contentText,
        unitKind: p.unitKind,
        unitLabel: p.unitLabel,
      })),
      contentHash: d.contentHash,
    })),
  };
}

type Stats = {
  candidates: number;
  misattributed: number;
  notFound: number;
  onCitedUnit: number;
  accepted: number;
};

function scoreOutputs(
  input: AnalyzerInput,
  outputs: ExtractionOutputV2[],
): Stats {
  const cand = collectWindowCandidates(outputs);
  const all = [
    ...cand.facts.map((c) => ({ ...c })),
    ...cand.requirements.map((c) => ({ ...c })),
    ...cand.risks.map((c) => ({ ...c })),
    ...cand.ambiguities.map((c) => ({ ...c })),
  ] as Array<{ sourceDocumentId: string; pageNumber: number; sourceSnippet: string }>;

  const unitText = new Map<string, string>();
  const unitsOfDoc = new Map<string, { pageNumber: number; text: string }[]>();
  for (const d of input.documents) {
    unitsOfDoc.set(
      d.documentId,
      d.pages.map((p) => ({ pageNumber: p.pageNumber, text: p.contentText })),
    );
    for (const p of d.pages) {
      unitText.set(`${d.documentId}#${p.pageNumber}`, normalizeForMatch(p.contentText));
    }
  }

  const stats: Stats = {
    candidates: all.length,
    misattributed: 0,
    notFound: 0,
    onCitedUnit: 0,
    accepted: 0,
  };
  for (const c of all) {
    const sn = normalizeForMatch(c.sourceSnippet);
    const cited = unitText.get(`${c.sourceDocumentId}#${c.pageNumber}`);
    if (cited && sn.length > 0 && cited.includes(sn)) {
      stats.onCitedUnit += 1;
      continue;
    }
    const hits = (unitsOfDoc.get(c.sourceDocumentId) ?? []).filter((u) =>
      normalizeForMatch(u.text).includes(sn),
    );
    if (hits.length >= 1) stats.misattributed += 1;
    else stats.notFound += 1;
  }

  const verified = verifyCandidates(input, cand);
  stats.accepted =
    verified.facts.length +
    verified.requirements.length +
    verified.risks.length +
    verified.ambiguities.length;
  return stats;
}

function pct(n: number, d: number): string {
  return d === 0 ? "—" : `${((n / d) * 100).toFixed(1)}%`;
}

async function main() {
  if (!RUN_ID) throw new Error("需要 RUN_ID");
  const input = await loadInput(RUN_ID);
  const run = await prisma.tenderAnalysisRun.findUniqueOrThrow({
    where: { id: RUN_ID },
    select: { workerCursor: true },
  });
  const cached =
    ((run.workerCursor as { windows?: { outputs?: Record<string, ExtractionOutputV2> } } | null)
      ?.windows?.outputs) ?? {};

  const windows = buildAllWindows(input);

  // 选窗：按「该窗口缓存输出里引错单元的条数」降序，取前 N —— 把预算花在问题最集中处
  const scored = windows
    .map((w) => {
      const out = cached[w.windowId];
      if (!out) return { w, miss: -1 };
      const s = scoreOutputs(input, [out]);
      return { w, miss: s.misattributed };
    })
    .filter((x) => x.miss >= 0)
    .sort((a, b) => b.miss - a.miss);

  const chosen = scored.slice(0, MAX_WINDOWS).filter((x) => x.miss > 0);
  const picked: SectionWindow[] = chosen.map((x) => x.w);
  const docNames = new Map(input.documents.map((d) => [d.documentId, d.name]));
  console.log(
    `选中 ${picked.length} 个窗口（基线引错单元条数合计 ${chosen.reduce((a, x) => a + x.miss, 0)}）：`,
  );
  for (const x of chosen) {
    console.log(`  · ${docNames.get(x.w.documentId)} ${x.w.windowId} (baseline miss=${x.miss})`);
  }
  if (picked.length === 0) {
    console.log("基线无引错单元，无需 A/B");
    return;
  }

  const baseOutputs = picked
    .map((w) => cached[w.windowId])
    .filter((o): o is ExtractionOutputV2 => Boolean(o));
  const base = scoreOutputs(input, baseOutputs);

  console.log(`\n重跑抽取（prompt ${PROMPT_EXTRACT.version}）…`);
  const invoker = createUnifiedRuntimeInvoker();
  const newOutputs: ExtractionOutputV2[] = [];
  let failed = 0;
  for (const [i, w] of picked.entries()) {
    let res = await runExtractionWindow(invoker, w);
    if (!res.ok) res = await runExtractionWindow(invoker, w); // 重试一次，避免单次抖动污染产量对比
    if (res.ok) newOutputs.push(res.value);
    else failed += 1;
    process.stdout.write(`\r  ${i + 1}/${picked.length}（失败 ${failed}）`);
  }
  console.log(
    `\n  窗口单元数：${picked.map((w) => w.pages.length).join(", ")}（多单元窗口是引错单元的温床）`,
  );
  console.log("");
  const treat = scoreOutputs(input, newOutputs);

  const rows: [string, keyof Stats][] = [
    ["候选总数", "candidates"],
    ["引在正确单元", "onCitedUnit"],
    ["引错单元（可纠正）", "misattributed"],
    ["文档内不存在（臆造）", "notFound"],
    ["最终通过验证", "accepted"],
  ];
  console.log(`\n窗口 ${picked.length} 个 · 基线=生产缓存(@3) · 处理组=${PROMPT_EXTRACT.version}\n`);
  console.log("  指标                    基线        处理组");
  for (const [label, key] of rows) {
    const b = base[key];
    const t = treat[key];
    const extra =
      key === "misattributed" || key === "notFound"
        ? `   (${pct(b, base.candidates)} → ${pct(t, treat.candidates)})`
        : "";
    console.log(`  ${label.padEnd(22)} ${String(b).padStart(6)} ${String(t).padStart(12)}${extra}`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
