import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isSuperAdmin } from "@/lib/rbac/roles";
import { withAuth } from "@/lib/common/api-helpers";

export const GET = withAuth(async (request, ctx, user) => {
  if (!isSuperAdmin(user.role)) {
    return NextResponse.json({ error: "无权限" }, { status: 403 });
  }

  const keyword = request.nextUrl.searchParams.get("keyword")?.trim() || "";
  const status = request.nextUrl.searchParams.get("intakeStatus") || "pending_dispatch";
  const page = Math.max(1, parseInt(request.nextUrl.searchParams.get("page") || "1", 10));
  const pageSize = Math.min(50, Math.max(1, parseInt(request.nextUrl.searchParams.get("pageSize") || "20", 10)));

  const where: Record<string, unknown> = { intakeStatus: status };

  if (keyword) {
    where.OR = [
      { name: { contains: keyword } },
      { clientOrganization: { contains: keyword } },
      { solicitationNumber: { contains: keyword } },
    ];
  }

  const [items, total] = await Promise.all([
    db.project.findMany({
      where,
      include: {
        owner: { select: { id: true, name: true, email: true } },
        org: { select: { id: true, name: true } },
        externalRef: true,
        intelligence: { select: { recommendation: true, fitScore: true, riskLevel: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    db.project.count({ where }),
  ]);

  return NextResponse.json({ items, total, page, pageSize });
});
