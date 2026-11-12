/**
 * VIS-1e 以岗位预览：开启与退出（spec authorization/position-preview「开启与退出预览」「开启条件」「预览审计」）
 *
 * POST   — 只认平台 super_admin。body `{ orgId, positionKeys }`。依次校验：企业存在（404）、岗位模式
 *          （PREVIEW_ORG_NOT_POSITION_MODE）、本人是 active 成员（PREVIEW_NOT_MEMBER）、岗位 1–10 个且都是该企业 active 的
 *          人类岗位（PREVIEW_POSITION_INVALID）。成功写 `qy_preview` 并返回 `{ orgId, orgName, positions, expiresAt }`。
 * DELETE — 只需会话：清 cookie，返回 `{ ok: true }`。预览中豁免代理拒写。
 *
 * 审计按平台动作写（orgId 为空，企业在 targetId / afterData），不进企业的驾驶舱时间线；不含 token。
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, requirePlatformSuperAdmin } from "@/lib/auth/guards";
import { hasPositionTemplates } from "@/lib/authorization/role-defaults";
import { logAudit, AUDIT_ACTIONS, AUDIT_TARGETS } from "@/lib/audit/logger";
import { normalizePositionKeys, signPreviewToken } from "@/lib/preview/token";
import { clearPreviewCookie, setPreviewCookie } from "@/lib/preview/cookie";
import { getRequestPreview } from "@/lib/preview/server";
import { logPreviewEnded } from "@/lib/preview/audit";

function bad(code: string, error: string) {
  return NextResponse.json({ error, code }, { status: 400 });
}

export async function POST(request: NextRequest) {
  const auth = await requirePlatformSuperAdmin(request);
  if (auth instanceof NextResponse) return auth;
  const userId = auth.user.id;

  const body = (await request.json().catch(() => null)) as { orgId?: unknown; positionKeys?: unknown } | null;
  const orgId = typeof body?.orgId === "string" ? body.orgId.trim() : "";
  const org = orgId
    ? await db.organization.findUnique({ where: { id: orgId }, select: { id: true, name: true, status: true, industryPackId: true } })
    : null;
  if (!org || org.status !== "active") return NextResponse.json({ error: "组织不存在" }, { status: 404 });
  if (!hasPositionTemplates(org.industryPackId)) {
    return bad("PREVIEW_ORG_NOT_POSITION_MODE", "只能预览岗位模式的企业");
  }
  const member = await db.organizationMember.findUnique({
    where: { orgId_userId: { orgId: org.id, userId } },
    select: { status: true },
  });
  if (member?.status !== "active") return bad("PREVIEW_NOT_MEMBER", "只能预览本人是成员的企业");

  const keys = normalizePositionKeys(body?.positionKeys);
  const profiles = keys
    ? await db.roleProfile.findMany({
        where: { orgId: org.id, key: { in: keys }, status: "active", principalType: "HUMAN" },
        select: { key: true, name: true },
      })
    : [];
  if (!keys || profiles.length !== keys.length) {
    return bad("PREVIEW_POSITION_INVALID", "请选择 1–10 个本企业在用的岗位");
  }
  const nameOf = new Map(profiles.map((p) => [p.key, p.name]));
  const positions = keys.map((key) => ({ key, name: nameOf.get(key) ?? key }));

  const { token, expiresAt } = await signPreviewToken({ userId, orgId: org.id, keys });
  const response = NextResponse.json({ orgId: org.id, orgName: org.name, positions, expiresAt: expiresAt.toISOString() });
  setPreviewCookie(response, token);
  await logAudit({
    userId,
    action: AUDIT_ACTIONS.PREVIEW_STARTED,
    targetType: AUDIT_TARGETS.ORG,
    targetId: org.id,
    afterData: { orgId: org.id, positionKeys: keys, expiresAt: expiresAt.toISOString() },
    request,
  });
  return response;
}

export async function DELETE(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  const preview = await getRequestPreview(request, auth.user.id);
  const response = NextResponse.json({ ok: true });
  clearPreviewCookie(response);
  if (preview) await logPreviewEnded(auth.user.id, preview, request, "exit");
  return response;
}
