import { db } from "@/lib/db";
import { logAudit, AUDIT_ACTIONS } from "@/lib/audit/logger";
import { canApproveJob } from "@/lib/product-content/jobs/status";
import { setJobStatus } from "@/lib/product-content/jobs/service";
import { listMissingFields } from "@/lib/product-content/industry-packs/home-textile";
import { createProductContentSnapshot } from "@/lib/product-content/jobs/snapshot";
import { generateProductDocuments } from "@/lib/product-content/documents/generate";

const AUDIT_TARGET = "product_content_job";

export async function approveProductContentJob(input: {
  orgId: string;
  jobId: string;
  userId: string;
}) {
  const job = await db.productContentJob.findFirst({
    where: { id: input.jobId, orgId: input.orgId },
  });
  if (!job) throw new Error("产品内容任务不存在");

  const [
    openConflicts,
    pendingApprovals,
    copy,
    rejectedVisuals,
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
    db.visualOutput.count({
      where: {
        orgId: input.orgId,
        status: "rejected",
        visualJob: { jobId: input.jobId },
      },
    }),
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
    openConflictCount: openConflicts,
    pendingApprovalCount: pendingApprovals,
    hasCopy: Boolean(copy),
    hasZipDocument: false,
    rejectedVisualCount: rejectedVisuals,
    unverifiedCertificationClaims: certFacts,
    requiredFieldsMissing: missing.length,
    approvedVisualCount: approvedVisuals,
    copyApproved: copy?.status === "approved",
    purpose: "FORMAL_EXTERNAL",
  });

  if (!gate.ok) {
    throw new Error(`无法批准：${gate.reasons.join("；")}`);
  }

  await createProductContentSnapshot(
    input.orgId,
    input.jobId,
    input.userId,
    "FORMAL_EXTERNAL",
  );

  await db.productContentJob.update({
    where: { id: job.id },
    data: { documentPurpose: "FORMAL_EXTERNAL" },
  });

  await generateProductDocuments(input.orgId, input.jobId, input.userId, {
    purpose: "FORMAL_EXTERNAL",
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

  if (copy && copy.status !== "approved") {
    await db.productCopy.update({
      where: { jobId: input.jobId },
      data: { status: "approved" },
    });
  }

  await logAudit({
    userId: input.userId,
    orgId: input.orgId,
    action: AUDIT_ACTIONS.STATUS_CHANGE,
    targetType: AUDIT_TARGET,
    targetId: job.id,
    afterData: { status: "APPROVED", documentPurpose: "FORMAL_EXTERNAL" },
  });

  return updated;
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
      purpose: "FORMAL_EXTERNAL",
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
