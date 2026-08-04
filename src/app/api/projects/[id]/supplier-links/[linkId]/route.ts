import { NextRequest, NextResponse } from "next/server";
import { requireProjectWriteAccess } from "@/lib/projects/access";
import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit/logger";
import { normalizeSupplierLinkRole } from "@/lib/bid-workflow/supplier-link-roles";

type Ctx = { params: Promise<{ id: string; linkId: string }> };

async function loadOwnedLink(
  projectId: string,
  linkId: string,
  orgId: string,
) {
  return db.projectSupplierLink.findFirst({
    where: { id: linkId, projectId, orgId },
    include: {
      supplier: { select: { id: true, orgId: true, name: true } },
    },
  });
}

export async function PATCH(request: NextRequest, ctx: Ctx) {
  const { id, linkId } = await ctx.params;
  const access = await requireProjectWriteAccess(request, id);
  if (access instanceof NextResponse) return access;
  const { user, project } = access;
  if (!project.orgId) {
    return NextResponse.json({ error: "项目缺少组织" }, { status: 422 });
  }

  const existing = await loadOwnedLink(id, linkId, project.orgId);
  if (!existing) {
    return NextResponse.json({ error: "关联不存在" }, { status: 404 });
  }
  if (existing.supplier.orgId !== project.orgId) {
    return NextResponse.json({ error: "跨组织供应商不可操作" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体格式错误" }, { status: 400 });
  }

  const data: Record<string, unknown> = {};
  if (body.role != null) {
    const role = normalizeSupplierLinkRole(String(body.role));
    if (!role) {
      return NextResponse.json({ error: "无效 role" }, { status: 422 });
    }
    data.role = role;
    data.selected = role === "selected";
  }
  if (typeof body.inquiryStatus === "string") {
    data.inquiryStatus = body.inquiryStatus.slice(0, 64);
  }
  if (typeof body.quoteStatus === "string") {
    data.quoteStatus = body.quoteStatus.slice(0, 64);
  }
  if (typeof body.sampleStatus === "string") {
    data.sampleStatus = body.sampleStatus.slice(0, 64);
  }
  if (typeof body.evidenceStatus === "string") {
    data.evidenceStatus = body.evidenceStatus.slice(0, 64);
  }
  if (typeof body.techMatch === "string" || body.techMatch === null) {
    data.techMatch =
      typeof body.techMatch === "string" ? body.techMatch.slice(0, 128) : null;
  }
  if (typeof body.rejectReason === "string" || body.rejectReason === null) {
    data.rejectReason =
      typeof body.rejectReason === "string"
        ? body.rejectReason.slice(0, 2000)
        : null;
  }
  if (typeof body.notes === "string" || body.notes === null) {
    data.notes =
      typeof body.notes === "string" ? body.notes.slice(0, 4000) : null;
  }
  if (typeof body.selected === "boolean") {
    data.selected = body.selected;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "无更新字段" }, { status: 422 });
  }

  const link = await db.projectSupplierLink.update({
    where: { id: existing.id },
    data,
  });

  await logAudit({
    userId: user.id,
    orgId: project.orgId,
    projectId: id,
    action: "project_supplier_link_updated",
    targetType: "project_supplier_link",
    targetId: link.id,
    beforeData: {
      role: existing.role,
      inquiryStatus: existing.inquiryStatus,
      selected: existing.selected,
    },
    afterData: data,
  });

  return NextResponse.json({ link });
}

export async function DELETE(request: NextRequest, ctx: Ctx) {
  const { id, linkId } = await ctx.params;
  const access = await requireProjectWriteAccess(request, id);
  if (access instanceof NextResponse) return access;
  const { user, project } = access;
  if (!project.orgId) {
    return NextResponse.json({ error: "项目缺少组织" }, { status: 422 });
  }

  const existing = await loadOwnedLink(id, linkId, project.orgId);
  if (!existing) {
    return NextResponse.json({ error: "关联不存在" }, { status: 404 });
  }

  await db.projectSupplierLink.delete({ where: { id: existing.id } });

  await logAudit({
    userId: user.id,
    orgId: project.orgId,
    projectId: id,
    action: "project_supplier_unlinked",
    targetType: "project_supplier_link",
    targetId: existing.id,
    beforeData: {
      supplierId: existing.supplierId,
      role: existing.role,
      supplierName: existing.supplier.name,
    },
  });

  return NextResponse.json({
    ok: true,
    deletedLinkId: existing.id,
    supplierRetained: true,
  });
}
