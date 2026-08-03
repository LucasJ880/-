import { NextRequest, NextResponse } from "next/server";
import {
  requireProjectReadAccess,
  requireProjectWriteAccess,
} from "@/lib/projects/access";
import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit/logger";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const access = await requireProjectReadAccess(request, id);
  if (access instanceof NextResponse) return access;

  try {
    const links = await db.projectSupplierLink.findMany({
      where: { projectId: id },
      include: {
        supplier: {
          select: {
            id: true,
            name: true,
            region: true,
            category: true,
            contactName: true,
            status: true,
          },
        },
      },
      orderBy: { updatedAt: "desc" },
    });
    return NextResponse.json({ links });
  } catch (err) {
    console.error("[supplier-links GET]", err);
    return NextResponse.json({ links: [], unavailable: true });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const access = await requireProjectWriteAccess(request, id);
  if (access instanceof NextResponse) return access;
  const { user, project } = access;
  if (!project.orgId) {
    return NextResponse.json({ error: "项目缺少组织" }, { status: 422 });
  }

  let body: { supplierId?: string; role?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体格式错误" }, { status: 400 });
  }
  if (!body.supplierId) {
    return NextResponse.json({ error: "supplierId 必填" }, { status: 422 });
  }

  const supplier = await db.supplier.findFirst({
    where: { id: body.supplierId, orgId: project.orgId },
    select: { id: true },
  });
  if (!supplier) {
    return NextResponse.json({ error: "供应商不存在" }, { status: 404 });
  }

  const existing = await db.projectSupplierLink.findUnique({
    where: {
      projectId_supplierId: { projectId: id, supplierId: body.supplierId },
    },
  });
  if (existing) {
    return NextResponse.json({ link: existing, created: false });
  }

  const link = await db.projectSupplierLink.create({
    data: {
      orgId: project.orgId,
      projectId: id,
      supplierId: body.supplierId,
      role: body.role || "candidate",
    },
  });

  await logAudit({
    userId: user.id,
    orgId: project.orgId,
    projectId: id,
    action: "project_supplier_linked",
    targetType: "project_supplier_link",
    targetId: link.id,
    afterData: { supplierId: body.supplierId },
  });

  return NextResponse.json({ link, created: true });
}
