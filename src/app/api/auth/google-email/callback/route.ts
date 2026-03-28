import { NextRequest, NextResponse } from "next/server";
import { handleEmailCallback } from "@/lib/google-email";
import { getCurrentUser } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const error = searchParams.get("error");

  if (error) {
    return NextResponse.redirect(
      new URL("/settings?gmail=error&reason=" + error, request.url)
    );
  }

  if (!code) {
    return NextResponse.redirect(
      new URL("/settings?gmail=error&reason=no_code", request.url)
    );
  }

  try {
    const user = await getCurrentUser(request);
    if (!user) {
      return NextResponse.redirect(
        new URL("/settings?gmail=error&reason=no_user", request.url)
      );
    }

    await handleEmailCallback(code, user.id);
    return NextResponse.redirect(new URL("/settings?gmail=success", request.url));
  } catch (err) {
    console.error("Gmail OAuth callback error:", err);
    return NextResponse.redirect(
      new URL("/settings?gmail=error&reason=token_fail", request.url)
    );
  }
}
