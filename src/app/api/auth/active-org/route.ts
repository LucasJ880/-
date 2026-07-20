import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/guards";
import {
  resolvePreferredOrgId,
  setUserActiveOrgId,
} from "@/lib/organizations/active-org";

/**
 * GET /api/auth/active-org
 * 返回当前偏好组织 + 可选列表（供前端 hydrate / 选组织页）
 */
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  const { user } = auth;

  const resolved = await resolvePreferredOrgId(user.id, user.role);
  return NextResponse.json({
    activeOrgId: resolved.orgId,
    needsSelection: resolved.needsSelection,
    organizations: resolved.organizations,
  });
}

/**
 * PATCH /api/auth/active-org
 * body: { orgId: string }
 */
export async function PATCH(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  const { user } = auth;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体格式错误" }, { status: 400 });
  }

  const orgId =
    typeof (body as { orgId?: unknown }).orgId === "string"
      ? (body as { orgId: string }).orgId.trim()
      : "";
  if (!orgId) {
    return NextResponse.json({ error: "orgId 必填" }, { status: 400 });
  }

  const saved = await setUserActiveOrgId(user.id, user.role, orgId);
  if (!saved) {
    return NextResponse.json(
      { error: "无权将该组织设为当前工作组织，或组织已归档" },
      { status: 403 }
    );
  }

  return NextResponse.json({ activeOrgId: saved });
}
