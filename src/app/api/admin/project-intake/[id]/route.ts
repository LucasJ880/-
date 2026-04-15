import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isSuperAdmin } from "@/lib/rbac/roles";
import { withAuth } from "@/lib/common/api-helpers";

export const GET = withAuth(async (request, ctx, user) => {
  if (!isSuperAdmin(user.role)) {
    return NextResponse.json({ error: "无权限" }, { status: 403 });
  }

  const { id } = await ctx.params;

  const project = await db.project.findUnique({
    where: { id },
    include: {
      owner: { select: { id: true, name: true, email: true } },
      org: { select: { id: true, name: true } },
      externalRef: true,
      intelligence: true,
      documents: true,
      members: {
        include: { user: { select: { id: true, name: true, email: true } } },
      },
    },
  });

  if (!project) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  return NextResponse.json(project);
});
