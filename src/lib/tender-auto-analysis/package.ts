/**
 * Phase 1.1.1 — Tender Package（同 Project 下多文档为一组分析单位）
 * 无新表：复用 TenderAnalysisRun + TenderAnalysisRunDocument（1 Run → N Docs）
 */

import { db } from "@/lib/db";
import { readBlobBuffer } from "@/lib/files/blob-access";
import type { DocumentRole } from "./constants";
import { computePackageFingerprintFromPairs, sha256Content } from "./hash";
import { isPdfFileType } from "./enqueue-helpers";

/** 单文件页数上限（page-parse 已强制） */
export { MAX_PDF_PAGES } from "./page-parse";

/** 整包页数之和上限；超过则拒绝入队，不静默截断 */
export const MAX_TENDER_PACKAGE_PAGES = 200;

export type PackageDocument = {
  documentId: string;
  contentHash: string;
  role: DocumentRole;
  filename: string;
  createdAt: Date;
  pageCount: number | null;
  parseStatus: string;
};

const ROLE_PRIORITY: Record<string, number> = {
  PRIMARY: 0,
  PRICING: 1,
  FORM: 2,
  DRAWING: 3,
  SUPPLEMENT: 4,
  ATTACHMENT: 4,
  UNKNOWN: 5,
  ADDENDUM: 9,
};

/**
 * 包内角色启发式（软分类）。
 * Important：不得仅凭文件名判定 ADDENDUM（避免第二份普通 PDF 被当成补遗）。
 */
export function classifyPackageDocumentRole(title: string): DocumentRole {
  const t = (title ?? "").trim();
  if (!t) return "UNKNOWN";
  if (/\b(pricing|price\s*form|bid\s*form|报价|价格表)\b/i.test(t)) {
    return "PRICING";
  }
  if (/\b(form|annex|schedule|表格|附表)\b/i.test(t) && !/\brfp\b/i.test(t)) {
    return "FORM";
  }
  if (/\b(drawing|图纸|图集)\b/i.test(t)) return "DRAWING";
  if (/\b(spec|specification|appendix|附件|technical)\b/i.test(t)) {
    return "SUPPLEMENT";
  }
  if (/\b(rfp|rfq|itt|itb|tender|bid\s*contract|solicitation|招标|投标)\b/i.test(t)) {
    return "PRIMARY";
  }
  // 默认 PRIMARY：允许多 PRIMARY 共存，由 ambiguity warning 提示
  return "PRIMARY";
}

export function computePackageFingerprint(
  docs: ReadonlyArray<{ documentId: string; contentHash: string }>,
): string {
  return computePackageFingerprintFromPairs(docs);
}

export function sortPackageDocuments<T extends PackageDocument>(docs: T[]): T[] {
  return [...docs].sort((a, b) => {
    const pa = ROLE_PRIORITY[a.role] ?? 5;
    const pb = ROLE_PRIORITY[b.role] ?? 5;
    if (pa !== pb) return pa - pb;
    const ta = a.createdAt.getTime();
    const tb = b.createdAt.getTime();
    if (ta !== tb) return ta - tb;
    return a.documentId.localeCompare(b.documentId);
  });
}

/**
 * 是否曾被明确标为 ADDENDUM-only（历史 INCREMENTAL Run 的唯一文档）。
 * 文件名启发式不参与。
 */
async function addendumOnlyDocumentIds(projectId: string): Promise<Set<string>> {
  const incremental = await db.tenderAnalysisRun.findMany({
    where: { projectId, runKind: "INCREMENTAL" },
    select: {
      documents: { select: { documentId: true, role: true } },
    },
    take: 50,
    orderBy: { createdAt: "desc" },
  });
  const out = new Set<string>();
  for (const run of incremental) {
    if (run.documents.length === 1 && run.documents[0]!.role === "ADDENDUM") {
      out.add(run.documents[0]!.documentId);
    }
  }
  return out;
}

export type GetTenderPackageDocumentsOptions = {
  /** 强制纳入（例如刚上传、parse 尚未 done） */
  forceIncludeDocumentIds?: string[];
};

/**
 * 当前 Project 有效投标文件包。
 * 默认：parseStatus∈{done,pending,parsing} 的 PDF，有 contentHash，非 ADDENDUM-only。
 */
export async function getTenderPackageDocuments(
  projectId: string,
  opts?: GetTenderPackageDocumentsOptions,
): Promise<PackageDocument[]> {
  const force = new Set(opts?.forceIncludeDocumentIds ?? []);
  const addendumOnly = await addendumOnlyDocumentIds(projectId);

  const rows = await db.projectDocument.findMany({
    where: { projectId },
    select: {
      id: true,
      title: true,
      fileType: true,
      contentHash: true,
      pageCount: true,
      parseStatus: true,
      createdAt: true,
      blobUrl: true,
    },
    orderBy: { createdAt: "asc" },
  });

  const candidates: PackageDocument[] = [];
  for (const row of rows) {
    if (!isPdfFileType(row.fileType)) continue;
    if (row.parseStatus === "failed") continue;
    if (addendumOnly.has(row.id) && !force.has(row.id)) continue;

    const forced = force.has(row.id);
    const parseOk =
      row.parseStatus === "done" ||
      row.parseStatus === "pending" ||
      row.parseStatus === "parsing";
    if (!parseOk && !forced) continue;

    let hash = row.contentHash?.trim() || "";
    if (!hash && row.blobUrl) {
      // 已有文件手动 package 分析：补写 contentHash，避免必须重传
      try {
        const blob = await readBlobBuffer(row.blobUrl);
        if (blob?.buffer?.length) {
          hash = sha256Content(blob.buffer);
          await db.projectDocument.update({
            where: { id: row.id },
            data: { contentHash: hash },
          });
        }
      } catch {
        hash = "";
      }
    }
    if (!hash) continue;

    candidates.push({
      documentId: row.id,
      contentHash: hash,
      role: classifyPackageDocumentRole(row.title),
      filename: row.title,
      createdAt: row.createdAt,
      pageCount: row.pageCount,
      parseStatus: row.parseStatus,
    });
  }

  return sortPackageDocuments(candidates);
}

export function packagePageCountTotal(
  docs: ReadonlyArray<{ pageCount: number | null }>,
): number | null {
  let sum = 0;
  let known = 0;
  for (const d of docs) {
    if (typeof d.pageCount === "number" && d.pageCount >= 0) {
      sum += d.pageCount;
      known += 1;
    }
  }
  if (known === 0) return null;
  return sum;
}

export function packageTooLarge(
  docs: ReadonlyArray<{ pageCount: number | null }>,
): boolean {
  const total = packagePageCountTotal(docs);
  return total != null && total > MAX_TENDER_PACKAGE_PAGES;
}

export function detectMultiplePrimaryWarning(
  docs: ReadonlyArray<{ role: string }>,
): string | null {
  const n = docs.filter((d) => d.role === "PRIMARY").length;
  if (n <= 1) return null;
  return `classification_ambiguity: ${n} documents classified as PRIMARY`;
}

export { normalizeRequirementFingerprint } from "./hash";
