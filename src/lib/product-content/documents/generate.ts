import { db } from "@/lib/db";
import { putPrivateBlob } from "@/lib/files/blob-access";
import { readBlobBuffer } from "@/lib/files/blob-access";
import { generateProductCopy } from "@/lib/product-content/copy/generate";
import { generateWordDocument } from "@/lib/product-content/documents/word";
import { generatePdfDocument } from "@/lib/product-content/documents/pdf";
import { generateExcelDocument } from "@/lib/product-content/documents/excel";
import { generateZipDocument } from "@/lib/product-content/documents/zip";
import {
  getLatestSnapshotPayload,
  type SnapshotPayload,
  type SnapshotPurpose,
} from "@/lib/product-content/jobs/snapshot";
import { recordCostEntry } from "@/lib/product-content/cost/ledger";
import type { DocumentPurpose } from "@/lib/product-content/types";

function asString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function recordFromJson(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = asString(v);
  }
  return out;
}

async function upsertGeneratedDocument(input: {
  orgId: string;
  jobId: string;
  docType: string;
  blobPathname: string;
  fileName: string;
  metadata?: Record<string, unknown>;
  status?: string;
}) {
  const existing = await db.generatedDocument.findFirst({
    where: { orgId: input.orgId, jobId: input.jobId, docType: input.docType },
    orderBy: { version: "desc" },
  });

  if (existing) {
    return db.generatedDocument.update({
      where: { id: existing.id },
      data: {
        blobPathname: input.blobPathname,
        fileName: input.fileName,
        version: existing.version + 1,
        status: input.status ?? "draft",
        metadata: input.metadata as object,
      },
    });
  }

  return db.generatedDocument.create({
    data: {
      orgId: input.orgId,
      jobId: input.jobId,
      docType: input.docType,
      blobPathname: input.blobPathname,
      fileName: input.fileName,
      status: input.status ?? "draft",
      metadata: input.metadata as object,
    },
  });
}

function copyFromSnapshot(payload: SnapshotPayload | null) {
  if (!payload?.copy) return null;
  return payload.copy as {
    productNameEn?: string | null;
    titleEn?: string | null;
    shortDescriptionEn?: string | null;
    longDescriptionEn?: string | null;
    specificationsJson?: unknown;
    packagingJson?: unknown;
    careInstructionsEn?: string | null;
    missingInformationJson?: unknown;
  };
}

export async function generateProductDocuments(
  orgId: string,
  jobId: string,
  userId: string,
  opts?: { formalOnly?: boolean; purpose?: DocumentPurpose },
) {
  const job = await db.productContentJob.findFirst({ where: { id: jobId, orgId } });
  if (!job) throw new Error("产品内容任务不存在");

  const purpose: DocumentPurpose =
    opts?.purpose ?? (job.documentPurpose as DocumentPurpose) ?? "INTERNAL_DRAFT";
  const isDraft = purpose === "INTERNAL_DRAFT";
  const useSnapshot =
    purpose === "FORMAL_EXTERNAL" || purpose === "CUSTOMER_REVIEW";

  const snapshot = useSnapshot
    ? await getLatestSnapshotPayload(orgId, jobId, purpose as SnapshotPurpose)
    : null;

  let copy = await db.productCopy.findUnique({ where: { jobId } });
  if (!copy) {
    copy = await generateProductCopy(orgId, jobId, userId);
  }

  const snapshotCopy = copyFromSnapshot(snapshot);
  const productName =
    snapshotCopy?.productNameEn ?? copy.productNameEn ?? job.title;
  const title = snapshotCopy?.titleEn ?? copy.titleEn ?? productName;
  const shortDescription =
    snapshotCopy?.shortDescriptionEn ?? copy.shortDescriptionEn ?? "";
  const longDescription =
    snapshotCopy?.longDescriptionEn ?? copy.longDescriptionEn ?? "";
  const specifications = recordFromJson(
    snapshotCopy?.specificationsJson ?? copy.specificationsJson,
  );
  const packaging = recordFromJson(snapshotCopy?.packagingJson ?? copy.packagingJson);
  const missingInformation = Array.isArray(
    snapshotCopy?.missingInformationJson ?? copy.missingInformationJson,
  )
    ? ((snapshotCopy?.missingInformationJson ?? copy.missingInformationJson) as string[])
    : snapshot?.missingFields.map((f) => f.key) ?? [];

  const assets = await db.productAsset.findMany({ where: { orgId, jobId } });
  const visualOutputs = await db.visualOutput.findMany({
    where: {
      orgId,
      visualJob: { jobId },
      status: isDraft
        ? { in: ["generated", "approved", "locked"] }
        : { in: ["approved", "locked"] },
    },
    include: { visualJob: true },
  });

  const draftBanner = isDraft
    ? "DRAFT — NOT FOR EXTERNAL USE / 内部草稿，禁止对外使用"
    : undefined;

  const productInfo: Record<string, string> = {
    product_name: productName,
    title,
    sku: job.selectedSku ?? "",
    document_purpose: purpose,
  };
  const marketingCopy: Record<string, string> = {
    short_description: shortDescription,
    long_description: longDescription,
    care_instructions: copy.careInstructionsEn ?? "",
  };

  const assetManifest = [
    ...assets.map((a) => ({
      fileName: a.fileName ?? a.blobPathname.split("/").pop() ?? "asset",
      role: a.roleConfirmed ?? a.roleAuto,
      path: a.blobPathname,
    })),
    ...visualOutputs.map((v) => ({
      fileName: v.blobPathname?.split("/").pop() ?? "visual.png",
      role: v.visualJob.sceneType,
      path: v.blobPathname ?? "",
    })),
  ];

  const wordBuffer = await generateWordDocument({
    title,
    draftBanner,
    paragraphs: [
      draftBanner ?? "",
      shortDescription,
      "",
      longDescription,
      "",
      "Specifications:",
      ...Object.entries(specifications).map(([k, v]) => `${k}: ${v}`),
      missingInformation.length
        ? `\nMissing information: ${missingInformation.join(", ")}`
        : "",
    ].filter(Boolean),
  });

  const pdfBuffer = await generatePdfDocument({
    title: isDraft ? "Product Sheet (DRAFT)" : "Product Sheet",
    productName,
    draftBanner,
    sections: [
      { heading: "Overview", lines: [shortDescription] },
      { heading: "Description", lines: [longDescription] },
      {
        heading: "Specifications",
        lines: Object.entries(specifications).map(([k, v]) => `${k}: ${v}`),
      },
      {
        heading: "Packaging",
        lines: Object.entries(packaging).map(([k, v]) => `${k}: ${v}`),
      },
      ...(missingInformation.length
        ? [{ heading: "Missing Fields", lines: missingInformation }]
        : []),
    ],
  });

  const excelBuffer = await generateExcelDocument({
    productInfo,
    specifications,
    packaging,
    marketingCopy,
    missingInformation,
    assetManifest,
  });

  const prefix = `product-content/${orgId}/${jobId}`;

  const wordPut = await putPrivateBlob({
    pathname: `${prefix}/03_Word/product-sheet.docx`,
    body: wordBuffer,
    contentType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
  const pdfPut = await putPrivateBlob({
    pathname: `${prefix}/04_PDF/product-sheet.pdf`,
    body: pdfBuffer,
    contentType: "application/pdf",
  });
  const excelPut = await putPrivateBlob({
    pathname: `${prefix}/05_Excel/product-data.xlsx`,
    body: excelBuffer,
    contentType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });

  const sourceFiles: Array<{ path: string; buffer: Buffer }> = [];
  for (const asset of assets) {
    const blob = await readBlobBuffer(asset.blobPathname);
    if (blob) {
      sourceFiles.push({
        path: asset.fileName ?? asset.blobPathname.split("/").pop() ?? "source",
        buffer: blob.buffer,
      });
    }
  }

  const approvedImages: Array<{ path: string; buffer: Buffer }> = [];
  for (const out of visualOutputs) {
    if (!out.blobPathname) continue;
    const blob = await readBlobBuffer(out.blobPathname);
    if (blob) {
      approvedImages.push({
        path: out.blobPathname.split("/").pop() ?? "visual.png",
        buffer: blob.buffer,
      });
    }
  }

  const zipBuffer = await generateZipDocument({
    sourceFiles,
    approvedImages,
    wordBuffer,
    pdfBuffer,
    excelBuffer,
    manifest: {
      jobId,
      orgId,
      title: job.title,
      purpose,
      generatedAt: new Date().toISOString(),
      assetCount: assetManifest.length,
      draft: isDraft,
    },
  });

  const zipPut = await putPrivateBlob({
    pathname: `${prefix}/package.zip`,
    body: zipBuffer,
    contentType: "application/zip",
  });

  const docStatus = purpose === "FORMAL_EXTERNAL" ? "approved" : "draft";
  const docMeta = { assetCount: assetManifest.length, purpose, draft: isDraft };

  const [wordDoc, pdfDoc, excelDoc, zipDoc] = await Promise.all([
    upsertGeneratedDocument({
      orgId,
      jobId,
      docType: "word",
      blobPathname: wordPut.pathname,
      fileName: "product-sheet.docx",
      metadata: docMeta,
      status: docStatus,
    }),
    upsertGeneratedDocument({
      orgId,
      jobId,
      docType: "pdf",
      blobPathname: pdfPut.pathname,
      fileName: "product-sheet.pdf",
      metadata: docMeta,
      status: docStatus,
    }),
    upsertGeneratedDocument({
      orgId,
      jobId,
      docType: "excel",
      blobPathname: excelPut.pathname,
      fileName: "product-data.xlsx",
      metadata: docMeta,
      status: docStatus,
    }),
    upsertGeneratedDocument({
      orgId,
      jobId,
      docType: "zip",
      blobPathname: zipPut.pathname,
      fileName: "package.zip",
      metadata: docMeta,
      status: docStatus,
    }),
  ]);

  await db.productContentJob.update({
    where: { id: jobId },
    data: { documentPurpose: purpose },
  });

  await recordCostEntry({
    orgId,
    jobId,
    category: "document",
    estimatedCents: 1,
    actualCents: 1,
    meta: { purpose, docTypes: ["word", "pdf", "excel", "zip"] },
  }).catch(() => undefined);

  return { wordDoc, pdfDoc, excelDoc, zipDoc, purpose };
}
