/**
 * Phase C — Tender Package Ready Gate
 *
 * "Upload Complete != Package Ready"。自动分析必须等到整个 package 稳定可枚举，
 * 而不是浏览器最后一个 upload 成功就立即触发。最低就绪条件（任务书 §二）：
 *   - 本项目存在有效招标 PDF（Document record 已建）
 *   - 没有文件仍处于 parsing/pending（预处理未完成 → DOCUMENT_PROCESSING）
 *   - 有效文件 contentHash 已就绪（或可从 blob 回填）
 *   - package 可稳定枚举（非空）
 *
 * 纯函数 assessPackageReadiness 便于单测；getTenderPackageReadiness 负责取数。
 * 注意：本 gate 只做"是否就绪"判定，不改变 getTenderPackageDocuments 的既有纳入口径
 * （后者在 worker 侧仍可自愈解析）。就绪门用于"自动触发时机"，避免分析半包。
 */

import { db } from "@/lib/db";
import { isPdfFileType } from "./enqueue-helpers";

export type PackageReadinessCode =
  | "NO_PACKAGE_DOCUMENTS"
  | "DOCUMENT_PROCESSING"
  | "MISSING_CONTENT_HASH";

export type PackageReadiness =
  | { ready: true; documentCount: number }
  | {
      ready: false;
      code: PackageReadinessCode;
      documentCount: number;
      pendingCount?: number;
    };

/** 就绪判定所需的最小行形状（便于纯函数测试）。 */
export type ReadinessRow = {
  fileType: string | null | undefined;
  parseStatus: string;
  contentHash: string | null | undefined;
  /** blobUrl 存在 → contentHash 可按需回填，不算缺失 */
  hasBlob: boolean;
  /** 历史 INCREMENTAL 唯一 ADDENDUM 文档：不计入常规 package 候选 */
  addendumOnly: boolean;
};

/** reason 字符串（供 enqueue 结果规范化复用）。 */
export function readinessReason(code: PackageReadinessCode): string {
  switch (code) {
    case "NO_PACKAGE_DOCUMENTS":
      return "no_package_documents";
    case "DOCUMENT_PROCESSING":
      return "document_processing";
    case "MISSING_CONTENT_HASH":
      return "missing_content_hash";
  }
}

/**
 * 纯函数：给定项目内文档行，判定 package 是否就绪。
 * 候选 = 可解析 PDF（非 failed、非 addendum-only）。
 */
export function assessPackageReadiness(
  rows: ReadonlyArray<ReadinessRow>,
): PackageReadiness {
  const candidates = rows.filter(
    (r) =>
      isPdfFileType(r.fileType ?? "") &&
      r.parseStatus !== "failed" &&
      !r.addendumOnly,
  );

  if (candidates.length === 0) {
    return { ready: false, code: "NO_PACKAGE_DOCUMENTS", documentCount: 0 };
  }

  // 任一候选仍在解析/待解析 → 预处理未完成，尚不能安全分析半包。
  const stillProcessing = candidates.filter(
    (r) => r.parseStatus === "pending" || r.parseStatus === "parsing",
  );
  if (stillProcessing.length > 0) {
    return {
      ready: false,
      code: "DOCUMENT_PROCESSING",
      documentCount: candidates.length,
      pendingCount: stillProcessing.length,
    };
  }

  // 全部解析完成后，contentHash 必须就绪（或可回填）；不得静默丢文件。
  const missingHash = candidates.filter(
    (r) => !(r.contentHash ?? "").trim() && !r.hasBlob,
  );
  if (missingHash.length > 0) {
    return {
      ready: false,
      code: "MISSING_CONTENT_HASH",
      documentCount: candidates.length,
    };
  }

  return { ready: true, documentCount: candidates.length };
}

/** 历史 INCREMENTAL 唯一 ADDENDUM 文档集合（与 package.ts 口径一致）。 */
async function addendumOnlyDocumentIds(
  projectId: string,
): Promise<Set<string>> {
  const incremental = await db.tenderAnalysisRun.findMany({
    where: { projectId, runKind: "INCREMENTAL" },
    select: { documents: { select: { documentId: true, role: true } } },
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

/** 取数并判定当前项目 tender package 是否就绪。 */
export async function getTenderPackageReadiness(
  projectId: string,
): Promise<PackageReadiness> {
  const [rows, addendumOnly] = await Promise.all([
    db.projectDocument.findMany({
      where: { projectId },
      select: {
        id: true,
        fileType: true,
        parseStatus: true,
        contentHash: true,
        blobUrl: true,
      },
    }),
    addendumOnlyDocumentIds(projectId),
  ]);

  return assessPackageReadiness(
    rows.map((r) => ({
      fileType: r.fileType,
      parseStatus: r.parseStatus,
      contentHash: r.contentHash,
      hasBlob: Boolean(r.blobUrl),
      addendumOnly: addendumOnly.has(r.id),
    })),
  );
}
