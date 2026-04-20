import { NextRequest, NextResponse } from "next/server";
import { handleEmailCallback } from "@/lib/google-email";
import { getCurrentUser } from "@/lib/auth";

/**
 * 允许的 return_to 白名单 —— 只允许本站相对路径，避免 open redirect
 */
function resolveReturnTo(stateRaw: string | null, defaultPath: string): string {
  if (!stateRaw) return defaultPath;
  try {
    const path = decodeURIComponent(stateRaw);
    if (!path.startsWith("/") || path.startsWith("//")) return defaultPath;
    return path;
  } catch {
    return defaultPath;
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const error = searchParams.get("error");
  const state = searchParams.get("state");

  const returnTo = resolveReturnTo(state, "/settings");

  if (error) {
    return NextResponse.redirect(
      new URL(`${returnTo}?gmail=error&reason=${encodeURIComponent(error)}`, request.url)
    );
  }

  if (!code) {
    return NextResponse.redirect(
      new URL(`${returnTo}?gmail=error&reason=no_code`, request.url)
    );
  }

  try {
    const user = await getCurrentUser(request);
    if (!user) {
      return NextResponse.redirect(
        new URL(`${returnTo}?gmail=error&reason=no_user`, request.url)
      );
    }

    await handleEmailCallback(code, user.id);
    return NextResponse.redirect(new URL(`${returnTo}?gmail=success`, request.url));
  } catch (err) {
    console.error("Gmail OAuth callback error:", err);
    return NextResponse.redirect(
      new URL(`${returnTo}?gmail=error&reason=token_fail`, request.url)
    );
  }
}
