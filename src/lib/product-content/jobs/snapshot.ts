import { createHash } from "crypto";
import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { listMissingFields } from "@/lib/product-content/industry-packs/home-textile";

export type SnapshotPurpose = "INTERNAL_DRAFT" | "CUSTOMER_REVIEW" | "FORMAL_EXTERNAL";

export interface SnapshotPayload {
  capturedAt: string;
  purpose: SnapshotPurpose;
  contentHash: string;
  approvalId?: string | null;
  job: {
    id: string;
    title: string;
    status: string;
    selectedSku: string | null;
    industryPack: string;
    documentPurpose: string;
  };
  productFacts: Array<{
    fieldKey: string;
    value: unknown;
    status: string;
    sourceType: string;
  }>;
  /** @deprecated 使用 productFacts；保留兼容 */
  facts: Array<{ fieldKey: string; value: unknown; status: string; sourceType: string }>;
  approvedCopy: Record<string, unknown> | null;
  /** @deprecated 使用 approvedCopy */
  copy: Record<string, unknown> | null;
  approvedVisualIds: string[];
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
  openConflicts: string[];
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

export function computeSnapshotContentHash(
  payload: Omit<SnapshotPayload, "contentHash" | "capturedAt">,
): string {
  return createHash("sha256").update(stableStringify(payload)).digest("hex");
}

export async function createProductContentSnapshot(
  orgId: string,
  jobId: string,
  userId: string,
  purpose: SnapshotPurpose,
  opts?: { approvalId?: string | null },
) {
  const job = await db.productContentJob.findFirst({
    where: { id: jobId, orgId },
    include: {
      facts: {
        where: { status: { in: ["extracted", "confirmed", "needs_review"] } },
        orderBy: { fieldKey: "asc" },
      },
      conflicts: { where: { status: "open" }, select: { id: true, fieldKey: true } },
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

  const productFacts = job.facts.map((f) => ({
    fieldKey: f.fieldKey,
    value: f.value,
    status: f.status,
    sourceType: f.sourceType,
  }));

  const approvedCopy = job.copy
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
    : null;

  const openConflicts = job.conflicts.map((c) => `${c.fieldKey}:${c.id}`);

  const base = {
    purpose,
    approvalId: opts?.approvalId ?? null,
    job: {
      id: job.id,
      title: job.title,
      status: job.status,
      selectedSku: job.selectedSku,
      industryPack: job.industryPack,
      documentPurpose: job.documentPurpose,
    },
    productFacts,
    facts: productFacts,
    approvedCopy,
    copy: approvedCopy,
    approvedVisualIds: approvedVisuals.map((v) => v.id),
    approvedVisuals,
    qaSummaries,
    missingFields: missing.map((f) => ({ key: f.key, label: f.label })),
    openConflicts,
  };

  const contentHash = computeSnapshotContentHash(base);
  const payload: SnapshotPayload = {
    ...base,
    capturedAt: new Date().toISOString(),
    contentHash,
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

export async function getLatestSnapshot(orgId: string, jobId: string, purpose?: SnapshotPurpose) {
  return db.productContentSnapshot.findFirst({
    where: {
      orgId,
      jobId,
      ...(purpose ? { purpose } : {}),
    },
    orderBy: { version: "desc" },
  });
}

export async function getLatestSnapshotPayload(
  orgId: string,
  jobId: string,
  purpose?: SnapshotPurpose,
): Promise<SnapshotPayload | null> {
  const snapshot = await getLatestSnapshot(orgId, jobId, purpose);
  if (!snapshot) return null;
  return snapshot.payloadJson as unknown as SnapshotPayload;
}
