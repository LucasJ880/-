import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireProjectReadAccess } from "@/lib/projects/access";
import { requireSupplierIntelAccess } from "@/lib/supplier-intel/access";

type Ctx = { params: Promise<{ projectId: string }> };

/** 核验依据候选的上限——资质核验只需要挑出那一份扫描件 */
const PICKER_CAP = 50;

/**
 * S3-B：资质核验的「档案依据」选择器（只读）。
 *
 * 为什么需要它：S1 冻结设计里，**非**官方登记库来源的资质（厂家社媒/官网/画册/人工登记）
 * 只能凭一份独立档案（TenderArchiveItem，例如证书扫描件）才能核验。没有这个选择器，
 * 这类资质在界面上永远无法被核验——只能靠知道内部 ID 的人手敲。
 *
 * 这不是新的档案模型，只是按项目读出**已有**档案条目；受限级（RESTRICTED）不列出。
 * 项目门走 canonical requireProjectReadAccess，与其它项目级读取一致。
 */
export async function GET(request: NextRequest, ctx: Ctx) {
  const tenant = await requireSupplierIntelAccess(request);
  if (tenant instanceof NextResponse) return tenant;

  const { projectId } = await ctx.params;
  const access = await requireProjectReadAccess(request, projectId);
  if (access instanceof NextResponse) return access;
  if (access.project.orgId !== tenant.orgId) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  const rows = await db.tenderArchiveItem.findMany({
    where: { orgId: tenant.orgId, projectId, accessClass: { not: "RESTRICTED" } },
    orderBy: { capturedAt: "desc" },
    take: PICKER_CAP,
    select: {
      id: true, kind: true, mimeType: true, capturedAt: true, sourceUrl: true, projectDocumentId: true,
    },
  });
  const docIds = rows.map((r) => r.projectDocumentId).filter((v): v is string => Boolean(v));
  const docs = docIds.length
    ? await db.projectDocument.findMany({
        where: { id: { in: docIds }, projectId },
        select: { id: true, title: true },
      })
    : [];
  const title = new Map(docs.map((d) => [d.id, d.title]));

  return NextResponse.json({
    items: rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      mimeType: r.mimeType,
      capturedAt: r.capturedAt.toISOString(),
      title: (r.projectDocumentId ? title.get(r.projectDocumentId) : null) ?? null,
      sourceHost: (() => {
        try {
          return r.sourceUrl ? new URL(r.sourceUrl).host : null;
        } catch {
          return null;
        }
      })(),
    })),
  });
}
