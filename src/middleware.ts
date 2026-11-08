import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { loginRedirectPath } from "@/lib/auth/safe-next";
import { canAccessMarketingWorkspace, isMarketingApiPath } from "@/lib/marketing/route-access";
import { applyRouteGate, isStaticImagePath } from "@/lib/navigation/route-gate";
import { ROUTE_GATE_LOADER } from "@/lib/navigation/context-server";

const COOKIE_NAME = "qy_session";

const PUBLIC_PATHS = [
  "/api/auth/register",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/wechat",
  "/api/health",
  "/api/v1",
  "/api/cron",
  // Trade daily cron（Vercel Cron Bearer；路由内 requireTradeCronSecret）
  "/api/trade/cron",
  // PostFlow worker（自建服务器 server-to-server，route 内 Bearer token 鉴权）
  "/api/operations/worker",
  "/api/sales/quotes/share",
  "/api/trade/webhook",
  "/api/webhooks/firecrawl",
  "/api/messaging/wecom/callback",
  // Muse Bridge（server-to-server，route 内 Bearer ApiToken 鉴权：system=muse-bridge + muse:bridge）
  "/api/bridge/muse",
  // Visualizer 客户分享（token 鉴权在 route 内部，无登录态）
  "/api/visualizer/share",
  "/sales/share/visualizer",
  "/login",
  "/register",
  "/quote",
  // 大厅展示大屏（纯静态品牌内容，无业务数据）
  "/display",
  // 嵌入询盘表单脚本（public/embed/inquiry.js，静态文件，无业务数据；提交走 /api/trade/webhook/website/embed）
  "/embed",
];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + "/")
  );
}

async function verifiedSession(token: string): Promise<{ sub: string; role: string } | null> {
  try {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      console.error("[middleware] JWT_SECRET is not set — rejecting request");
      return null;
    }
    const key = new TextEncoder().encode(secret);
    const { payload } = await jwtVerify(token, key);
    return {
      sub: typeof payload.sub === "string" ? payload.sub : "",
      role: typeof payload.role === "string" ? payload.role : "",
    };
  } catch {
    return null;
  }
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // VIS-1a：public/ 图片在登录检查之前放行（与改动前 matcher 按图片扩展名排除一致；
  // 已登录区路径即使带图片扩展名也不在此列，照样要登录并经路由门）
  if (isStaticImagePath(pathname)) {
    return NextResponse.next();
  }

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  const token = request.cookies.get(COOKIE_NAME)?.value;
  const session = token ? await verifiedSession(token) : null;
  if (!token || session === null) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "未登录" },
        { status: 401, headers: { "x-auth-reason": "session" } }
      );
    }
    // COLLAB-2：带上原路径与查询串，登录后回到原页面（原路径为 / 时不带 next）
    return NextResponse.redirect(
      new URL(loginRedirectPath(pathname, request.nextUrl.search), request.url),
    );
  }

  const role = session.role;
  // 旧模式（无行业包企业）营销只读接口：JWT 平台角色 sales 拦截（API 层，不在 VIS-1a 范围；页面由路由门判定）
  if (isMarketingApiPath(pathname) && !canAccessMarketingWorkspace(role)) {
    return NextResponse.json(
      { error: "销售账号无权访问营销工作区" },
      { status: 403 },
    );
  }

  if (pathname === "/api" || pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  // VIS-1a 路由门（spec navigation/route-gate）：已登录页面请求在渲染前按导航注册表判定，
  // 不满足 302 到落地页；判定输入与侧栏同一构造器（context-server）
  const gated = await applyRouteGate(request, session.sub, ROUTE_GATE_LOADER);
  return gated ?? NextResponse.next();
}

export const config = {
  // VIS-1a：路由门要查库，跑在 Node.js runtime（Next 16 middleware 支持；design D1）
  runtime: "nodejs",
  // 不再按图片扩展名整体排除：图片在函数开头放行，已登录区路径带扩展名照样判定（design D5）
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
