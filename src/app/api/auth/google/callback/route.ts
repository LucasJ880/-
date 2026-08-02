import { NextRequest, NextResponse } from "next/server";
import { handleCallback, GOOGLE_OAUTH_STATE_COOKIE } from "@/lib/google-calendar";
import { getCurrentUser } from "@/lib/auth";

function redirectWithClearedState(request: NextRequest, path: string) {
  const response = NextResponse.redirect(new URL(path, request.url));
  response.cookies.set(GOOGLE_OAUTH_STATE_COOKIE, "", { maxAge: 0, path: "/" });
  return response;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const error = searchParams.get("error");

  if (error) {
    return redirectWithClearedState(request, "/settings?google=error&reason=" + error);
  }

  if (!code) {
    return redirectWithClearedState(request, "/settings?google=error&reason=no_code");
  }

  // state 防 CSRF：必须与授权跳转时种下的 cookie 一致
  const state = searchParams.get("state");
  const expectedState = request.cookies.get(GOOGLE_OAUTH_STATE_COOKIE)?.value;
  if (!state || !expectedState || state !== expectedState) {
    return redirectWithClearedState(request, "/settings?google=error&reason=state_mismatch");
  }

  try {
    const user = await getCurrentUser(request);
    if (!user) {
      return redirectWithClearedState(request, "/settings?google=error&reason=no_user");
    }

    await handleCallback(code, user.id);
    return redirectWithClearedState(request, "/settings?google=success");
  } catch (err) {
    console.error("Google OAuth callback error:", err);
    return redirectWithClearedState(request, "/settings?google=error&reason=token_fail");
  }
}
