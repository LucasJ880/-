/**
 * 证据拒收离线重放（只读生产库，零 LLM 调用）
 *
 * 生产 run 的 workerCursor 缓存了每个窗口的**原始模型输出**；本脚本把它们与
 * AnalyzerInput 一起重放 verifyCandidates，把每条被拒候选的原因、单元类型、
 * 引文与单元原文摆出来——用于定位「非 PDF 单元拒收率飙升」的真实成因，
 * 而不是靠猜去改 prompt。
 *
 * 用法：
 *   RUN_ID=<runId> npx tsx scripts/tender-evidence-rejection-replay.ts [--dump=20]
 */

import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import type {
  AnalyzerInput,
  ExtractionOutputV2,
} from "@/lib/tender-understanding/contract";
import { collectWindowCandidates } from "@/lib/tender-understanding/analyzer";
import { buildAllWindows } from "@/lib/tender-understanding/manifest";
import { verifyCandidates } from "@/lib/tender-understanding/verify";
import { normalizeForMatch } from "@/lib/tender-understanding/normalize";

if (!process.env.DATABASE_URL) {
  for (const line of readFileSync("/Users/user/Desktop/青砚/.env", "utf-8").split("\n")) {
    const m = line.match(/^\s*(DATABASE_URL|DIRECT_URL)\s*=\s*"?([^"\n]+)"?\s*$/);
    if (m) process.env[m[1]] = m[2];
  }
}

const prisma = new PrismaClient();
const RUN_ID = process.env.RUN_ID ?? "";
const DUMP = Number(
  process.argv.find((a) => a.startsWith("--dump="))?.split("=")[1] ?? "12",
);

async function loadAnalyzerInput(runId: string): Promise<AnalyzerInput> {
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
  for (const p of pages) {
    byDoc.set(p.documentId, [...(byDoc.get(p.documentId) ?? []), p]);
  }
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

async function main() {
  if (!RUN_ID) throw new Error("需要 RUN_ID");

  const input = await loadAnalyzerInput(RUN_ID);
  const run = await prisma.tenderAnalysisRun.findUniqueOrThrow({
    where: { id: RUN_ID },
    select: { workerCursor: true },
  });
  const cursor = run.workerCursor as {
    windows?: { outputs?: Record<string, ExtractionOutputV2> };
  } | null;
  const outputsById = cursor?.windows?.outputs ?? {};
  const windows = buildAllWindows(input);
  const ordered = windows
    .map((w) => outputsById[w.windowId])
    .filter((o): o is ExtractionOutputV2 => Boolean(o));

  console.log(
    `窗口 ${windows.length}，缓存输出 ${ordered.length}；文档 ${input.documents.length}`,
  );

  // 单元类型索引：documentId#unit → {kind, label, text}
  const unitInfo = new Map<
    string,
    { kind: string; label: string | null; text: string; docName: string; fileType: string }
  >();
  for (const d of input.documents) {
    for (const p of d.pages) {
      unitInfo.set(`${d.documentId}#${p.pageNumber}`, {
        kind: p.unitKind ?? "page",
        label: p.unitLabel ?? null,
        text: p.contentText,
        docName: d.name,
        fileType: d.type,
      });
    }
  }

  const candidates = collectWindowCandidates(ordered);
  const verified = verifyCandidates(input, candidates);

  const groups = [
    ["facts", verified.rejected.facts],
    ["requirements", verified.rejected.requirements],
    ["risks", verified.rejected.risks],
    ["ambiguities", verified.rejected.ambiguities],
  ] as const;

  type Row = {
    group: string;
    reasonCode: string;
    unitKind: string;
    fileType: string;
    docName: string;
    unitLabel: string | null;
    pageNumber: number;
    snippet: string;
    unitText: string;
  };
  const rows: Row[] = [];
  for (const [group, list] of groups) {
    for (const r of list as Array<{
      reasonCode: string;
      candidate: { sourceDocumentId: string; pageNumber: number; sourceSnippet: string };
    }>) {
      const key = `${r.candidate.sourceDocumentId}#${r.candidate.pageNumber}`;
      const info = unitInfo.get(key);
      rows.push({
        group,
        reasonCode: r.reasonCode,
        unitKind: info?.kind ?? "(单元不存在)",
        fileType: info?.fileType ?? "?",
        docName: info?.docName ?? r.candidate.sourceDocumentId,
        unitLabel: info?.label ?? null,
        pageNumber: r.candidate.pageNumber,
        snippet: r.candidate.sourceSnippet,
        unitText: info?.text ?? "",
      });
    }
  }

  const accepted =
    verified.facts.length +
    verified.requirements.length +
    verified.risks.length +
    verified.ambiguities.length;
  console.log(`\n通过 ${accepted} 条，拒收 ${rows.length} 条`);

  // 按 (reasonCode × unitKind) 交叉统计——定位是不是非 PDF 特有
  const cross = new Map<string, number>();
  for (const r of rows) {
    const k = `${r.reasonCode} × ${r.unitKind}`;
    cross.set(k, (cross.get(k) ?? 0) + 1);
  }
  console.log("\n拒收交叉分布（原因 × 单元类型）:");
  for (const [k, n] of [...cross.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(4)}  ${k}`);
  }

  // SNIPPET_NOT_ON_PAGE 细分：决定修法的关键分类
  //   A 单元内可定位（引错单元号）→ 可安全纠正归属（引文仍逐字、位置仍真实）
  //   B 仅跨单元拼接才存在        → 不可纠正，必须让模型别跨单元拼
  //   C 文档内根本不存在          → 改写/臆造，本就该拒
  const notOnPage = rows.filter((r) => r.reasonCode === "SNIPPET_NOT_ON_PAGE");
  const unitsByDoc = new Map<string, { pageNumber: number; text: string }[]>();
  for (const d of input.documents) {
    unitsByDoc.set(
      d.documentId,
      d.pages.map((p) => ({ pageNumber: p.pageNumber, text: p.contentText })),
    );
  }
  const cls = { A_单元内可定位: 0, B_跨单元拼接: 0, C_文档内不存在: 0, A_多处歧义: 0 };
  const perKind = new Map<string, { A: number; B: number; C: number }>();
  for (const r of notOnPage) {
    const nSnippet = normalizeForMatch(r.snippet);
    const docId =
      [...unitInfo.entries()].find(
        ([k, v]) => v.docName === r.docName && k.endsWith(`#${r.pageNumber}`),
      )?.[0]?.split("#")[0] ?? "";
    const units = unitsByDoc.get(docId) ?? [];
    const hits = units.filter((u) => normalizeForMatch(u.text).includes(nSnippet));
    const joined = normalizeForMatch(units.map((u) => u.text).join("\n"));
    const bucket = perKind.get(r.unitKind) ?? { A: 0, B: 0, C: 0 };
    if (hits.length === 1) {
      cls.A_单元内可定位 += 1;
      bucket.A += 1;
    } else if (hits.length > 1) {
      cls.A_多处歧义 += 1;
      bucket.A += 1;
    } else if (joined.includes(nSnippet)) {
      cls.B_跨单元拼接 += 1;
      bucket.B += 1;
    } else {
      cls.C_文档内不存在 += 1;
      bucket.C += 1;
    }
    perKind.set(r.unitKind, bucket);
  }
  console.log(`\nSNIPPET_NOT_ON_PAGE 细分（共 ${notOnPage.length}）:`);
  console.log(`  A 单元内可定位（引错单元号，可安全纠正）: ${cls.A_单元内可定位}（其中多处歧义 ${cls.A_多处歧义}）`);
  console.log(`  B 仅跨单元拼接才存在（须改 prompt）      : ${cls.B_跨单元拼接}`);
  console.log(`  C 文档内根本不存在（改写/臆造，本该拒）  : ${cls.C_文档内不存在}`);
  console.log("  按单元类型:");
  for (const [k, v] of perKind) {
    console.log(`    ${k}: A=${v.A} B=${v.B} C=${v.C}`);
  }

  console.log(`\n样本（最多 ${DUMP} 条 SNIPPET_NOT_ON_PAGE）:`);
  for (const r of notOnPage.slice(0, DUMP)) {
    const nSnippet = normalizeForMatch(r.snippet);
    console.log(
      `\n  [${r.fileType}/${r.unitKind}] ${r.docName} · ${r.unitLabel ?? `#${r.pageNumber}`} (${r.group})`,
    );
    console.log(`    引文: 「${r.snippet.slice(0, 160).replace(/\n/g, " ⏎ ")}」`);
    console.log(`    单元前 160 字: 「${r.unitText.slice(0, 160).replace(/\n/g, " ⏎ ")}」`);
    // 最长公共前缀，看是不是"开头对、后面改写"
    let i = 0;
    const nUnit = normalizeForMatch(r.unitText);
    while (i < nSnippet.length && nUnit.includes(nSnippet.slice(0, i + 1))) i += 1;
    console.log(`    最长可匹配前缀长度: ${i}/${nSnippet.length}`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
