import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import { requireProjectWriteAccess } from "@/lib/projects/access";
import {
  generateProjectDocument,
  type GenerateDocType,
} from "@/lib/projects/generate/generate-docs";
import { isProxyUrl, toProxyUrl } from "@/lib/files/blob-access";

const ALLOWED: GenerateDocType[] = [
  "supplier_rfq",
  "internal_analysis",
  "teammate_tasks",
  "tech_confirm",
  "owner_clarification",
];

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
  const docType = body.docType as GenerateDocType;
  if (!ALLOWED.includes(docType)) {
    return NextResponse.json({ error: "docType 无效" }, { status: 400 });
  }

  try {
    const doc = await generateProjectDocument({
      projectId,
      orgId: access.project.orgId,
      userId: user.id,
      docType,
    });
    return NextResponse.json({
      document: {
        ...doc,
        fileUrl: asBrowserUrl(doc.fileUrl),
        blobUrl: asBrowserUrl(doc.blobUrl),
      },
    });
  } catch (e) {
    console.error("[generate-pdf]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "生成失败" },
      { status: 500 },
    );
  }
});
