import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { listMissingFields } from "@/lib/product-content/industry-packs/home-textile";

export type SnapshotPurpose = "INTERNAL_DRAFT" | "CUSTOMER_REVIEW" | "FORMAL_EXTERNAL";

export interface SnapshotPayload {
  capturedAt: string;
  purpose: SnapshotPurpose;
  job: {
    id: string;
    title: string;
    status: string;
    selectedSku: string | null;
    industryPack: string;
    documentPurpose: string;
  };
  facts: Array<{ fieldKey: string; value: unknown; status: string; sourceType: string }>;
  copy: Record<string, unknown> | null;
  approvedVisuals: Array<{
    id: string;
    sceneType: string;
    mode: string;
    blobPathname: string | null;
    qaOverallScore: number | null;
  }>;
  qaSummaries: Array<{
    visualOutputId: string;
    overallScore: number;
    recommendedStatus: string;
    detectedChanges: unknown;
  }>;
  missingFields: Array<{ key: string; label: string }>;
}

export async function createProductContentSnapshot(
  orgId: string,
  jobId: string,
  userId: string,
  purpose: SnapshotPurpose,
) {
  const job = await db.productContentJob.findFirst({
    where: { id: jobId, orgId },
    include: {
      facts: {
        where: { status: { in: ["extracted", "confirmed", "needs_review"] } },
        orderBy: { fieldKey: "asc" },
      },
      copy: true,
      visualJobs: {
        include: {
          outputs: {
            where: { status: { in: ["approved", "locked"] } },
            include: { qaResult: true },
          },
        },
      },
    },
  });
  if (!job) throw new Error("产品内容任务不存在");

  const factRecord: Record<string, unknown> = {};
  for (const f of job.facts) factRecord[f.fieldKey] = f.value;
  const missing = listMissingFields(factRecord);

  const approvedVisuals = job.visualJobs.flatMap((vj) =>
    vj.outputs.map((o) => ({
      id: o.id,
      sceneType: vj.sceneType,
      mode: vj.mode,
      blobPathname: o.blobPathname,
      qaOverallScore: o.qaOverallScore,
    })),
  );

  const qaSummaries = job.visualJobs.flatMap((vj) =>
    vj.outputs
      .filter((o) => o.qaResult)
      .map((o) => ({
        visualOutputId: o.id,
        overallScore: o.qaResult!.overallScore,
        recommendedStatus: o.qaResult!.recommendedStatus,
        detectedChanges: o.qaResult!.detectedChangesJson,
      })),
  );

  const payload: SnapshotPayload = {
    capturedAt: new Date().toISOString(),
    purpose,
    job: {
      id: job.id,
      title: job.title,
      status: job.status,
      selectedSku: job.selectedSku,
      industryPack: job.industryPack,
      documentPurpose: job.documentPurpose,
    },
    facts: job.facts.map((f) => ({
      fieldKey: f.fieldKey,
      value: f.value,
      status: f.status,
      sourceType: f.sourceType,
    })),
    copy: job.copy
      ? {
          productNameEn: job.copy.productNameEn,
          titleEn: job.copy.titleEn,
          shortDescriptionEn: job.copy.shortDescriptionEn,
          longDescriptionEn: job.copy.longDescriptionEn,
          sellingPointsJson: job.copy.sellingPointsJson,
          specificationsJson: job.copy.specificationsJson,
          packagingJson: job.copy.packagingJson,
          careInstructionsEn: job.copy.careInstructionsEn,
          useCasesJson: job.copy.useCasesJson,
          missingInformationJson: job.copy.missingInformationJson,
          claimsToVerifyJson: job.copy.claimsToVerifyJson,
          status: job.copy.status,
          locked: job.copy.locked,
        }
      : null,
    approvedVisuals,
    qaSummaries,
    missingFields: missing.map((f) => ({ key: f.key, label: f.label })),
  };

  const latest = await db.productContentSnapshot.findFirst({
    where: { jobId },
    orderBy: { version: "desc" },
    select: { version: true },
  });
  const version = (latest?.version ?? 0) + 1;

  return db.productContentSnapshot.create({
    data: {
      orgId,
      jobId,
      version,
      purpose,
      payloadJson: payload as unknown as Prisma.InputJsonValue,
      createdById: userId,
    },
  });
}

export async function getLatestSnapshotPayload(
  orgId: string,
  jobId: string,
  purpose?: SnapshotPurpose,
): Promise<SnapshotPayload | null> {
  const snapshot = await db.productContentSnapshot.findFirst({
    where: {
      orgId,
      jobId,
      ...(purpose ? { purpose } : {}),
    },
    orderBy: { version: "desc" },
  });
  if (!snapshot) return null;
  return snapshot.payloadJson as unknown as SnapshotPayload;
}
