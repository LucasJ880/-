import { NextRequest, NextResponse } from "next/server";
import {
  getSessionFromRequest,
  verifySession,
  clearSessionCookie,
} from "@/lib/auth/session";
import { logAudit, AUDIT_ACTIONS, AUDIT_TARGETS } from "@/lib/audit/logger";

export async function POST(request: NextRequest) {
  const token = getSessionFromRequest(request);
  let userId: string | undefined;

  if (token) {
    const payload = await verifySession(token);
    userId = payload?.sub;
  }

  const response = NextResponse.json({ ok: true });
  clearSessionCookie(response);

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
