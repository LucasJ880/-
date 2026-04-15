import { NextResponse } from "next/server";
import { isSuperAdmin } from "@/lib/rbac/roles";
import { dispatchProject } from "@/lib/project-intake/service";
import { withAuth } from "@/lib/common/api-helpers";

export const POST = withAuth(async (request, ctx, user) => {
  if (!isSuperAdmin(user.role)) {
    return NextResponse.json({ error: "无权限" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const body = await request.json().catch(() => ({}));

  const orgId = typeof body.orgId === "string" ? body.orgId.trim() : "";
  if (!orgId) {
    return NextResponse.json({ error: "必须指定目标组织" }, { status: 400 });
  }

  try {
    const updated = await dispatchProject(
      id,
      {
        orgId,
        ownerUserId: body.ownerUserId || undefined,
        memberUserIds: Array.isArray(body.memberUserIds) ? body.memberUserIds : undefined,
        note: body.note || undefined,
      },
      user.id,
      request
    );

    return NextResponse.json({
      ok: true,
      project: { id: updated.id, intakeStatus: updated.intakeStatus },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "分发失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
});
