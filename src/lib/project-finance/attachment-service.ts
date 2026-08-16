/**
 * T2-P1.5 费用票据证据 — 不可变附件（镜像 TenderArchiveItem 语义）
 *
 * - 存储 I/O 复用既有 putPrivateBlob（Vercel Blob private + proxyUrl），不再造第二套文件系统。
 * - 内容寻址：contentHash = sha256(bytes)；同 expense 同 hash 幂等（unique 约束）。
 * - create-only：原件永不 update/delete；AI/OCR/审核流程不得覆盖。
 * - 校验复用 validateUploadedFileAsync（magic-byte 反欺骗 + exec 黑名单）。
 */
import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { putPrivateBlob } from "@/lib/files/blob-access";
import { validateUploadedFileAsync } from "@/lib/files/upload-guard";
import { FinanceContractError, FinanceTenantError } from "./types";

const RECEIPT_MAX_BYTES = 15 * 1024 * 1024;
const RECEIPT_EXTS = ["jpg", "jpeg", "png", "webp", "heic", "pdf"];

function inferKind(mime: string, ext: string): string {
  if (mime === "application/pdf" || ext === "pdf") return "invoice";
  if (mime.startsWith("image/")) return "receipt";
  return "other";
}

export interface AddExpenseAttachmentInput {
  orgId: string;
  projectId: string;
  expenseSubmissionId: string;
  file: File;
  uploadedById: string;
  capturedAt?: Date;
}

export async function addExpenseAttachment(input: AddExpenseAttachmentInput) {
  // 归属校验：expense 必须属于该 org/project
  const expense = await db.projectExpenseSubmission.findFirst({
    where: { id: input.expenseSubmissionId, orgId: input.orgId, projectId: input.projectId },
    select: { id: true, status: true },
  });
  if (!expense) throw new FinanceTenantError("expense not found in project/organization");
  // 已终态（APPROVED/REJECTED）不再允许改动证据集合
  if (expense.status === "APPROVED" || expense.status === "REJECTED") {
    throw new FinanceContractError(`费用已 ${expense.status}，证据集合冻结`, 409);
  }

  const validated = await validateUploadedFileAsync(input.file, {
    maxSize: RECEIPT_MAX_BYTES,
    allowedExtensions: RECEIPT_EXTS,
    checkMagicBytes: true,
  });
  if (!validated.ok) {
    throw new FinanceContractError(validated.reason ?? "票据文件校验失败", 400);
  }

  const contentHash = createHash("sha256").update(validated.buffer).digest("hex");

  // 幂等：同 expense 同 hash → 返回既有（原件不可变，不重复上传）
  const existing = await db.projectExpenseAttachment.findUnique({
    where: {
      expenseSubmissionId_contentHash: {
        expenseSubmissionId: input.expenseSubmissionId,
        contentHash,
      },
    },
  });
  if (existing) return existing;

  const pathname = `projects/${input.projectId}/expenses/${input.expenseSubmissionId}/${contentHash.slice(0, 16)}_${validated.safeName}`;
  const blob = await putPrivateBlob({
    pathname,
    body: validated.buffer,
    contentType: validated.mime,
  });

  return db.projectExpenseAttachment.create({
    data: {
      orgId: input.orgId,
      projectId: input.projectId,
      expenseSubmissionId: input.expenseSubmissionId,
      kind: inferKind(validated.mime, validated.ext),
      originalFilename: validated.safeName,
      mimeType: validated.mime,
      fileSize: validated.size,
      contentHash,
      storageKey: blob.pathname,
      blobUrl: blob.proxyUrl,
      uploadedById: input.uploadedById,
      capturedAt: input.capturedAt ?? new Date(),
    },
  });
}

export async function listExpenseAttachments(
  orgId: string,
  projectId: string,
  expenseSubmissionId: string,
) {
  return db.projectExpenseAttachment.findMany({
    where: { orgId, projectId, expenseSubmissionId },
    orderBy: { createdAt: "asc" },
  });
}
