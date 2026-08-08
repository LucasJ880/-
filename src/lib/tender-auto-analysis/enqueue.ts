/**
 * 上传后自动入队 TenderAnalysisRun（HTTP 路径禁止调用 LLM）
 * Phase 1.1.1：入队单位为当前 Project 的 Tender Package（多文档），非单 PDF。
 */

import { db } from "@/lib/db";
import type { TenderAnalysisStatus } from "./constants";
import { canAutoEnqueueAnalysis } from "./gate";
import { sha256Content } from "./hash";
import {
  isPdfFileType,
  suggestionWhenGateClosed,
} from "./enqueue-helpers";
import { enqueueTenderPackageAnalysis } from "./enqueue-package";

export type MaybeEnqueueInput = {
  projectId: string;
  documentId: string;
  buffer: Buffer;
  fileType: string;
  title: string;
  userId: string;
  orgId: string;
};

export type MaybeEnqueueResult = {
  enqueued: boolean;
  runId?: string;
  status?: TenderAnalysisStatus | string;
  reason?: string;
  suggestion?: "mark_as_tender";
  documentCount?: number;
  packageFingerprint?: string;
};

/**
 * 上传成功后尝试入队自动分析。
 * - 写 contentHash 后按 package 重建 FULL Run
 * - 门闸关闭时绝不改 workDomain
 * - 不再因第二份普通 PDF 创建 INCREMENTAL / 单文档 SUPERSEDE
 */
export async function maybeEnqueueTenderAnalysisAfterUpload(
  input: MaybeEnqueueInput,
): Promise<MaybeEnqueueResult> {
  const contentHash = sha256Content(input.buffer);

  await db.projectDocument.update({
    where: { id: input.documentId },
    data: { contentHash },
  });

  const project = await db.project.findUnique({
    where: { id: input.projectId },
    select: {
      id: true,
      orgId: true,
      workDomain: true,
      intelligenceRoom: { select: { id: true } },
    },
  });

  if (!project) {
    return { enqueued: false, reason: "project_not_found" };
  }

  const orgId = (project.orgId ?? input.orgId ?? "").trim();
  if (!orgId) {
    return { enqueued: false, reason: "missing_org" };
  }

  const gate = canAutoEnqueueAnalysis({
    workDomain: project.workDomain,
    hasIntelligenceRoom: Boolean(project.intelligenceRoom),
  });

  if (!gate.ok) {
    const hint = suggestionWhenGateClosed({
      title: input.title,
      fileType: input.fileType,
    });
    return {
      enqueued: false,
      reason: gate.reason,
      ...hint,
    };
  }

  if (!isPdfFileType(input.fileType)) {
    return { enqueued: false, reason: "unsupported_file_type" };
  }

  const result = await enqueueTenderPackageAnalysis({
    projectId: input.projectId,
    userId: input.userId,
    orgId,
    forceIncludeDocumentIds: [input.documentId],
  });

  return {
    enqueued: result.enqueued,
    runId: result.runId,
    status: result.status,
    reason: result.reason,
    suggestion: result.suggestion,
    documentCount: result.documentCount,
    packageFingerprint: result.packageFingerprint,
  };
}

export {
  enqueueTenderPackageAnalysis,
  reanalyzeTenderPackage,
} from "./enqueue-package";
