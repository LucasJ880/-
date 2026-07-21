import { db } from "@/lib/db";
import { logAudit, AUDIT_ACTIONS } from "@/lib/audit/logger";
import { canApproveJob } from "@/lib/product-content/jobs/status";
import {
  countBlockingRejectedVisuals,
  setJobStatus,
} from "@/lib/product-content/jobs/service";
import { listMissingFields } from "@/lib/product-content/industry-packs/home-textile";
import { createProductContentSnapshot } from "@/lib/product-content/jobs/snapshot";
import { generateProductDocuments } from "@/lib/product-content/documents/generate";
import type { DocumentPurpose } from "@/lib/product-content/types";

const AUDIT_TARGET = "product_content_job";

export async function approveProductContentJob(input: {
  orgId: string;
  jobId: string;
  userId: string;
  /** 默认 FORMAL_EXTERNAL；缺字段时用 INTERNAL_DRAFT 走水印草稿批准 */
  purpose?: DocumentPurpose;
}) {
  const purpose: DocumentPurpose = input.purpose ?? "FORMAL_EXTERNAL";
  const job = await db.productContentJob.findFirst({
    where: { id: input.jobId, orgId: input.orgId },
  });
  if (!job) throw new Error("产品内容任务不存在");

  const [
    openConflicts,
    pendingApprovals,
    copy,
    blockingRejected,
    approvedVisuals,
    certFacts,
    facts,
  ] = await Promise.all([
    db.productFactConflict.count({
      where: { orgId: input.orgId, jobId: input.jobId, status: "open" },
    }),
    db.productContentApproval.count({
      where: { orgId: input.orgId, jobId: input.jobId, status: "pending" },
    }),
    db.productCopy.findUnique({ where: { jobId: input.jobId } }),
    countBlockingRejectedVisuals(input.orgId, input.jobId),
    db.visualOutput.count({
      where: {
        orgId: input.orgId,
        status: { in: ["approved", "locked"] },
        visualJob: { jobId: input.jobId },
      },
    }),
    db.productFact.count({
      where: {
        orgId: input.orgId,
        jobId: input.jobId,
        fieldKey: "certifications",
        status: { in: ["extracted", "needs_review"] },
      },
    }),
    db.productFact.findMany({
      where: {
        orgId: input.orgId,
        jobId: input.jobId,
        status: { in: ["extracted", "confirmed", "needs_review"] },
      },
      select: { fieldKey: true, value: true },
    }),
  ]);

  const factRecord: Record<string, unknown> = {};
  for (const f of facts) factRecord[f.fieldKey] = f.value;
  const missing = listMissingFields(factRecord);

  const gate = canApproveJob({
    openConflictCount: purpose === "INTERNAL_DRAFT" ? 0 : openConflicts,
    pendingApprovalCount: pendingApprovals,
    hasCopy: Boolean(copy),
    hasZipDocument: false,
    rejectedVisualCount: blockingRejected,
    unverifiedCertificationClaims: purpose === "INTERNAL_DRAFT" ? 0 : certFacts,
    requiredFieldsMissing: purpose === "INTERNAL_DRAFT" ? 0 : missing.length,
    approvedVisualCount: approvedVisuals,
    copyApproved: purpose === "INTERNAL_DRAFT" ? Boolean(copy) : copy?.status === "approved",
    purpose,
  });

  if (purpose === "INTERNAL_DRAFT" && approvedVisuals < 1) {
    throw new Error("无法批准：至少需要 1 张已批准/锁定的视觉输出");
  }

  if (!gate.ok) {
    const prefix =
      purpose === "FORMAL_EXTERNAL"
        ? "无法批准正式外发"
        : "无法批准";
    throw new Error(`${prefix}：${gate.reasons.join("；")}${
      purpose === "FORMAL_EXTERNAL" && missing.length
        ? `；缺失字段=${missing.map((m) => m.key).join(",")}`
        : ""
    }`);
  }

  if (purpose === "FORMAL_EXTERNAL" && missing.length > 0) {
    throw new Error(
      `无法批准正式外发：仍有必填字段缺失：${missing.map((m) => m.key).join(", ")}`,
    );
  }
  if (purpose === "FORMAL_EXTERNAL" && openConflicts > 0) {
    throw new Error(`无法批准正式外发：存在 ${openConflicts} 条未解决的事实冲突`);
  }

  const snapshot = await createProductContentSnapshot(
    input.orgId,
    input.jobId,
    input.userId,
    purpose,
  );

  await db.productContentJob.update({
    where: { id: job.id },
    data: { documentPurpose: purpose },
  });

  await generateProductDocuments(input.orgId, input.jobId, input.userId, {
    purpose,
    snapshotId: snapshot.id,
  });

  const updated = await setJobStatus({
    orgId: input.orgId,
    userId: input.userId,
    jobId: input.jobId,
    status: "APPROVED",
  });

  await db.productContentJob.update({
    where: { id: job.id },
    data: { approvedById: input.userId, approvedAt: new Date() },
  });

  if (copy && copy.status !== "approved" && purpose === "INTERNAL_DRAFT") {
    // 内部草稿批准不强制改写文案状态；正式路径要求事先 approved
  }

  await logAudit({
    userId: input.userId,
    orgId: input.orgId,
    action: AUDIT_ACTIONS.STATUS_CHANGE,
    targetType: AUDIT_TARGET,
    targetId: job.id,
    afterData: {
      status: "APPROVED",
      documentPurpose: purpose,
      snapshotId: snapshot.id,
      snapshotVersion: snapshot.version,
    },
  });

  return { job: updated, snapshot };
}

export async function deliverProductContentPackage(input: {
  orgId: string;
  jobId: string;
  userId: string;
}) {
  const job = await db.productContentJob.findFirst({
    where: { id: input.jobId, orgId: input.orgId },
  });
  if (!job) throw new Error("产品内容任务不存在");

  if (job.status !== "APPROVED") {
    throw new Error("任务尚未批准，无法交付");
  }

  let zipDoc = await db.generatedDocument.findFirst({
    where: { orgId: input.orgId, jobId: input.jobId, docType: "zip" },
  });
  if (!zipDoc?.blobPathname) {
    await generateProductDocuments(input.orgId, input.jobId, input.userId, {
      purpose: (job.documentPurpose as DocumentPurpose) || "FORMAL_EXTERNAL",
    });
    zipDoc = await db.generatedDocument.findFirst({
      where: { orgId: input.orgId, jobId: input.jobId, docType: "zip" },
    });
  }
  if (!zipDoc?.blobPathname) {
    throw new Error("缺少交付 ZIP，请先生成文档包");
  }

  const updated = await setJobStatus({
    orgId: input.orgId,
    userId: input.userId,
    jobId: input.jobId,
    status: "DELIVERED",
  });

  await db.productContentJob.update({
    where: { id: job.id },
    data: { deliveredAt: new Date() },
  });

  await logAudit({
    userId: input.userId,
    orgId: input.orgId,
    action: AUDIT_ACTIONS.EXPORT,
    targetType: AUDIT_TARGET,
    targetId: job.id,
    afterData: { status: "DELIVERED", zipPath: zipDoc.blobPathname },
  });

  return { job: updated, zipDocument: zipDoc };
}
