import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

const COOKIE_NAME = "qy_session";

const PUBLIC_PATHS = [
  "/api/auth/register",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/wechat",
  "/api/health",
  "/api/v1",
  "/api/cron",
  // PostFlow worker（自建服务器 server-to-server，route 内 Bearer token 鉴权）
  "/api/operations/worker",
  "/api/sales/quotes/share",
  "/api/trade/webhook",
  "/api/messaging/wecom/callback",
  // Visualizer 客户分享（token 鉴权在 route 内部，无登录态）
  "/api/visualizer/share",
  "/sales/share/visualizer",
  "/login",
  "/register",
  "/quote",
  // 大厅展示大屏（纯静态品牌内容，无业务数据）
  "/display",
];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + "/")
  );
}

async function isValidToken(token: string): Promise<boolean> {
  try {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      console.error("[middleware] JWT_SECRET is not set — rejecting request");
      return false;
    }
    const key = new TextEncoder().encode(secret);
    await jwtVerify(token, key);
    return true;
  } catch {
    return false;
  }
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token || !(await isValidToken(token))) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "未登录" },
        { status: 401, headers: { "x-auth-reason": "session" } }
      );
    }
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
