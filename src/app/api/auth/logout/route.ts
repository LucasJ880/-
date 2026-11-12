import { NextRequest, NextResponse } from "next/server";
import {
  getSessionFromRequest,
  verifySession,
  clearSessionCookie,
} from "@/lib/auth/session";
import { logAudit, AUDIT_ACTIONS, AUDIT_TARGETS } from "@/lib/audit/logger";
import { clearPreviewCookie } from "@/lib/preview/cookie";
import { getRequestPreview } from "@/lib/preview/server";
import { logPreviewEnded } from "@/lib/preview/audit";

export async function POST(request: NextRequest) {
  const token = getSessionFromRequest(request);
  let userId: string | undefined;

  if (token) {
    const payload = await verifySession(token);
    userId = payload?.sub;
  }

  const response = NextResponse.json({ ok: true });
  clearSessionCookie(response);
  // VIS-1e：登出同时清掉以岗位预览的 cookie；带有效预览时记一条预览结束
  clearPreviewCookie(response);
  const preview = userId ? await getRequestPreview(request, userId) : null;
  if (userId && preview) await logPreviewEnded(userId, preview, request, "logout");

  if (userId) {
    await logAudit({
      userId,
      action: AUDIT_ACTIONS.LOGOUT,
      targetType: AUDIT_TARGETS.USER,
      targetId: userId,
      request,
    });
  }

  return response;
}
