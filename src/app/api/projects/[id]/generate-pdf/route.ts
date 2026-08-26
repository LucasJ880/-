import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import { requireProjectWriteAccess } from "@/lib/projects/access";
import {
  generateProjectDocument,
  type GenerateDocType,
} from "@/lib/projects/generate/generate-docs";
import { isProxyUrl, toProxyUrl } from "@/lib/files/blob-access";
import {
  isProjectPdfDocType,
  PROJECT_PDF_DOC_TYPES,
} from "@/lib/bid-workflow/pdf-doc-types";

// CJK-PDF 包：Chromium 冷启动 + 渲染需要余量（生成文档为低频动作）
// 备忘录 v2 全文多轮推理 + Chromium 渲染同函数；Fluid Compute 下 Pro 可到 800s——
// 若平台计划不支持，部署会直接失败（staging 先证伪），届时回退 300 + 纯断点续跑。
export const maxDuration = 800;
const ROUTE_BUDGET_MS = 800_000;

const ALLOWED: GenerateDocType[] = [...PROJECT_PDF_DOC_TYPES];

function asBrowserUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (isProxyUrl(url)) return url;
  // 历史数据可能存了私有 Blob 直链 → 转代理，否则浏览器 Forbidden
  if (/blob\.vercel-storage\.com/i.test(url) || /^https?:\/\//i.test(url)) {
    return toProxyUrl(url);
  }
  return toProxyUrl(url);
}

export const GET = withAuth(async (request, ctx) => {
  const { id: projectId } = await ctx.params;
  const access = await requireProjectWriteAccess(request, projectId);
  if (access instanceof NextResponse) return access;

  const docs = await db.projectGeneratedDocument.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    take: 30,
  });
  return NextResponse.json({
    documents: docs.map((d) => ({
      ...d,
      fileUrl: asBrowserUrl(d.fileUrl),
      blobUrl: asBrowserUrl(d.blobUrl),
    })),
  });
});

export const POST = withAuth(async (request, ctx, user) => {
  const { id: projectId } = await ctx.params;
  const access = await requireProjectWriteAccess(request, projectId);
  if (access instanceof NextResponse) return access;

  const body = await request.json().catch(() => ({}));
  const docTypeRaw = String(body.docType || "");
  if (!isProjectPdfDocType(docTypeRaw) || !ALLOWED.includes(docTypeRaw)) {
    return NextResponse.json(
      { error: "docType 无效", allowed: ALLOWED },
      { status: 400 },
    );
  }
  const docType = docTypeRaw as GenerateDocType;
  const previewOnly = body.previewOnly === true;
  const includePublicHistoricalAmounts =
    body.includePublicHistoricalAmounts === true;
  const confirmNotes =
    typeof body.confirmNotes === "string" ? body.confirmNotes : null;

  try {
    const doc = await generateProjectDocument({
      projectId,
      orgId: access.project.orgId,
      userId: user.id,
      docType,
      previewOnly,
      includePublicHistoricalAmounts,
      confirmNotes,
      // v2 断点续跑：给 PDF 渲染与落库留 ~2 分钟余量
      deadlineMs: Date.now() + ROUTE_BUDGET_MS - 120_000,
    });
    if (previewOnly && "previewText" in doc) {
      return NextResponse.json({
        previewOnly: true,
        previewText: doc.previewText,
        includePublicHistoricalAmounts,
        fontLimitation:
          docType === "china_supplier_brief"
            ? "Chinese text may render poorly under Helvetica; full CJK font embed deferred."
            : null,
      });
    }
    if ("inProgress" in doc && doc.inProgress) {
      return NextResponse.json({ inProgress: true, statusZh: doc.statusZh, progress: doc.progress });
    }
    const fileUrl = asBrowserUrl(doc.fileUrl);
    const blobUrl = asBrowserUrl(doc.blobUrl);
    if (!doc.id) {
      return NextResponse.json(
        { error: "生成未写入 ProjectGeneratedDocument" },
        { status: 500 },
      );
    }
    return NextResponse.json({
      document: {
        ...doc,
        id: doc.id,
        fileUrl,
        blobUrl,
      },
      fontLimitation:
        docType === "china_supplier_brief"
          ? "Chinese text may render poorly under Helvetica; full CJK font embed deferred."
          : null,
    });
  } catch (e) {
    console.error("[generate-pdf]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "生成失败" },
      { status: 500 },
    );
  }
});
