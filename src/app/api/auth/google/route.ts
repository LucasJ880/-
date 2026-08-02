import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getAuthUrl, GOOGLE_OAUTH_STATE_COOKIE } from "@/lib/google-calendar";

export async function GET() {
  const id = process.env.GOOGLE_CLIENT_ID?.trim();
  const secret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  const redirect = process.env.GOOGLE_REDIRECT_URI?.trim();
  if (!id || !secret || !redirect) {
    return NextResponse.json(
      {
        error:
          "Google OAuth 未配置。请在部署环境中设置 GOOGLE_CLIENT_ID、GOOGLE_CLIENT_SECRET 与 GOOGLE_REDIRECT_URI（须与 Google 控制台重定向 URI 完全一致）",
      },
      { status: 500 }
    );
  }

  // state 防 CSRF：随机值走 HttpOnly cookie，callback 侧比对
  const state = randomUUID();
  const url = getAuthUrl(state);
  const response = NextResponse.redirect(url);
  response.cookies.set(GOOGLE_OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return response;
}
