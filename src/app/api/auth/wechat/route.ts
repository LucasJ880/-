import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

const WECHAT_QR_URL = "https://open.weixin.qq.com/connect/qrconnect";
const STATE_COOKIE = "qy_wx_state";

export async function GET(request: NextRequest) {
  const appId = process.env.WECHAT_OPEN_APP_ID?.trim();
  if (!appId) {
    return NextResponse.json(
      { error: "微信登录未配置，请设置 WECHAT_OPEN_APP_ID" },
      { status: 500 },
    );
  }

  const origin = new URL(request.url).origin;
  const redirectUri = `${origin}/api/auth/wechat/callback`;

  const state = crypto.randomBytes(16).toString("hex");

  const next = request.nextUrl.searchParams.get("next") || "/";

  const params = new URLSearchParams({
    appid: appId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "snsapi_login",
    state,
  });

  const wechatUrl = `${WECHAT_QR_URL}?${params.toString()}#wechat_redirect`;

  const response = NextResponse.redirect(wechatUrl);

  response.cookies.set(STATE_COOKIE, `${state}:${next}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 300,
  });

  return response;
}
