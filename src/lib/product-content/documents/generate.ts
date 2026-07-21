import { db } from "@/lib/db";
import { putPrivateBlob } from "@/lib/files/blob-access";
import { readBlobBuffer } from "@/lib/files/blob-access";
import { generateProductCopy } from "@/lib/product-content/copy/generate";
import { generateWordDocument } from "@/lib/product-content/documents/word";
import { generatePdfDocument } from "@/lib/product-content/documents/pdf";
import { generateExcelDocument } from "@/lib/product-content/documents/excel";
import { generateZipDocument } from "@/lib/product-content/documents/zip";
import {
  getLatestSnapshot,
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
  const c = payload?.approvedCopy ?? payload?.copy;
  if (!c) return null;
  return c as {
    productNameEn?: string | null;
    titleEn?: string | null;
    shortDescriptionEn?: string | null;
    longDescriptionEn?: string | null;
    sellingPointsJson?: unknown;
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
  opts?: { formalOnly?: boolean; purpose?: DocumentPurpose; snapshotId?: string },
) {
  const job = await db.productContentJob.findFirst({ where: { id: jobId, orgId } });
  if (!job) throw new Error("产品内容任务不存在");

  const purpose: DocumentPurpose =
    opts?.purpose ?? (job.documentPurpose as DocumentPurpose) ?? "INTERNAL_DRAFT";
  const isDraft = purpose === "INTERNAL_DRAFT";

  const snapshotRow = opts?.snapshotId
    ? await db.productContentSnapshot.findFirst({
        where: { id: opts.snapshotId, orgId, jobId },
      })
    : await getLatestSnapshot(orgId, jobId, purpose as SnapshotPurpose);

  // 批准后的文档必须绑定 Snapshot；无 snapshot 时仅 INTERNAL_DRAFT 预览可走 live DB
  const snapshot = snapshotRow
    ? (snapshotRow.payloadJson as unknown as SnapshotPayload)
    : null;
  if (!isDraft && !snapshot) {
    throw new Error("正式文档必须基于 Approved Snapshot 生成，请先批准任务");
  }

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
  const sellingPointsRaw =
    snapshotCopy?.sellingPointsJson ?? copy.sellingPointsJson;
  const sellingPoints = Array.isArray(sellingPointsRaw)
    ? (sellingPointsRaw as string[])
    : [];
  const specifications = recordFromJson(
    snapshotCopy?.specificationsJson ?? copy.specificationsJson,
  );
  const packaging = recordFromJson(snapshotCopy?.packagingJson ?? copy.packagingJson);

  // 缺失字段：快照优先；正式包标注 To Be Confirmed，禁止推断
  const missingKeys =
    snapshot?.missingFields.map((f) => f.key) ??
    (Array.isArray(copy.missingInformationJson)
      ? (copy.missingInformationJson as string[])
      : []);
  const missingInformation = missingKeys.map(
    (k) => `${k}: To Be Confirmed`,
  );

  for (const key of [
    "category",
    "material",
    "fabric_composition",
    "size",
    "color",
  ] as const) {
    if (missingKeys.includes(key) && !specifications[key]) {
      specifications[key] = "To Be Confirmed";
    }
  }

  // 事实字段从 snapshot 写入 specifications（已确认值）
  if (snapshot?.productFacts?.length) {
    for (const f of snapshot.productFacts) {
      if (f.status === "confirmed" || f.status === "extracted") {
        const v = asString(f.value);
        if (v && !specifications[f.fieldKey]) specifications[f.fieldKey] = v;
      }
    }
  }

  const assets = await db.productAsset.findMany({ where: { orgId, jobId } });

  // 正式/批准文档：只用 snapshot 中的批准图；草稿预览可用 live
  let visualPaths: Array<{ id: string; sceneType: string; path: string }> = [];
  if (snapshot?.approvedVisuals?.length) {
    visualPaths = snapshot.approvedVisuals
      .filter((v) => v.blobPathname)
      .map((v) => ({
        id: v.id,
        sceneType: v.sceneType,
        path: v.blobPathname!,
      }));
  } else {
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
    visualPaths = visualOutputs
      .filter((v) => v.blobPathname)
      .map((v) => ({
        id: v.id,
        sceneType: v.visualJob.sceneType,
        path: v.blobPathname!,
      }));
  }

  const draftBanner = isDraft
    ? "INTERNAL DRAFT — NOT FOR EXTERNAL USE / 内部草稿，禁止对外使用"
    : undefined;

  const sku =
    (snapshot?.job.selectedSku || job.selectedSku || specifications.sku || "") ||
    (missingKeys.includes("sku") ? "To Be Confirmed" : "");

  const productInfo: Record<string, string> = {
    product_name: productName,
    title,
    sku,
    category: specifications.category || "To Be Confirmed",
    color: specifications.color || "To Be Confirmed",
    size: specifications.size || "To Be Confirmed",
    material: specifications.material || "To Be Confirmed",
    fabric_composition: specifications.fabric_composition || "To Be Confirmed",
    document_purpose: purpose,
    snapshot_version: snapshotRow ? String(snapshotRow.version) : "",
    content_hash: snapshot?.contentHash ?? "",
  };
  const marketingCopy: Record<string, string> = {
    short_description: shortDescription,
    long_description: longDescription,
    care_instructions:
      snapshotCopy?.careInstructionsEn ?? copy.careInstructionsEn ?? "",
    selling_points: sellingPoints.join(" | "),
  };

  const assetManifest = [
    ...assets.map((a) => ({
      fileName: a.fileName ?? a.blobPathname.split("/").pop() ?? "asset",
      role: a.roleConfirmed ?? a.roleAuto,
      path: a.blobPathname,
    })),
    ...visualPaths.map((v) => ({
      fileName: v.path.split("/").pop() ?? "visual.png",
      role: v.sceneType,
      path: v.path,
      visualOutputId: v.id,
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
      "Selling Points:",
      ...sellingPoints.map((p, i) => `${i + 1}. ${p}`),
      "",
      "Specifications:",
      ...Object.entries(specifications).map(([k, v]) => `${k}: ${v}`),
      missingInformation.length
        ? `\nMissing information (To Be Confirmed):\n${missingInformation.join("\n")}`
        : "",
      snapshot?.contentHash
        ? `\nSnapshot v${snapshotRow?.version} hash: ${snapshot.contentHash}`
        : "",
    ].filter(Boolean),
  });

  const pdfBuffer = await generatePdfDocument({
    title: isDraft ? "Product Sheet (INTERNAL DRAFT)" : "Product Sheet",
    productName,
    draftBanner,
    sections: [
      { heading: "Overview", lines: [shortDescription] },
      { heading: "Description", lines: [longDescription] },
      {
        heading: "Selling Points",
        lines: sellingPoints.length ? sellingPoints : ["To Be Confirmed"],
      },
      {
        heading: "Specifications",
        lines: Object.entries(specifications).map(([k, v]) => `${k}: ${v}`),
      },
      {
        heading: "Packaging",
        lines: Object.entries(packaging).map(([k, v]) => `${k}: ${v}`),
      },
      ...(missingInformation.length
        ? [{ heading: "Missing Fields (To Be Confirmed)", lines: missingInformation }]
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
  for (const out of visualPaths) {
    const blob = await readBlobBuffer(out.path);
    if (blob) {
      approvedImages.push({
        path: `${out.sceneType}-${out.path.split("/").pop() ?? "visual.png"}`,
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
      snapshotId: snapshotRow?.id ?? null,
      snapshotVersion: snapshotRow?.version ?? null,
      contentHash: snapshot?.contentHash ?? null,
      approvedVisualIds: snapshot?.approvedVisualIds ?? visualPaths.map((v) => v.id),
      missingFields: missingKeys,
      sku,
      productName,
      sellingPoints,
    },
  });

  const zipPut = await putPrivateBlob({
    pathname: `${prefix}/package.zip`,
    body: zipBuffer,
    contentType: "application/zip",
  });

  const docStatus = purpose === "FORMAL_EXTERNAL" ? "approved" : "draft";
  const docMeta = {
    assetCount: assetManifest.length,
    purpose,
    draft: isDraft,
    snapshotId: snapshotRow?.id ?? null,
    snapshotVersion: snapshotRow?.version ?? null,
    contentHash: snapshot?.contentHash ?? null,
  };

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
