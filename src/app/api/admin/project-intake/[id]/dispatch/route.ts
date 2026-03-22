import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { isSuperAdmin } from "@/lib/rbac/roles";
import { dispatchProject } from "@/lib/project-intake/service";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser(request);
  if (!user || !isSuperAdmin(user.role)) {
    return NextResponse.json({ error: "无权限" }, { status: 403 });
  }

  const { id } = await params;
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
}
