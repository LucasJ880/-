import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser, type AuthUser } from "@/lib/auth";
import { logger } from "./logger";
import {
  generateRequestId,
  runWithRequestContext,
} from "./request-context";

// ============================================================
// API 路由通用辅助工具
// ============================================================

/** 从 URL query 提取字符串参数 */
export function queryString(
  request: NextRequest,
  key: string
): string | undefined {
  const val = request.nextUrl.searchParams.get(key);
  return val != null && val.trim() !== "" ? val.trim() : undefined;
}

/** 从 URL query 提取正整数参数 */
export function queryInt(
  request: NextRequest,
  key: string
): number | undefined {
  const raw = request.nextUrl.searchParams.get(key);
  if (!raw) return undefined;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** 统一分页参数提取 */
export function queryPagination(request: NextRequest) {
  return {
    page: queryInt(request, "page"),
    pageSize: queryInt(request, "pageSize"),
  };
}

/** 安全解析 JSON body，解析失败返回 null */
export async function safeParseBody<T = Record<string, unknown>>(
  request: NextRequest
): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

type AuthHandler = (
  request: NextRequest,
  ctx: { params: Promise<Record<string, string>> },
  user: AuthUser
) => Promise<NextResponse>;

/**
 * 认证 + try/catch + 请求上下文
 *
 * 每个请求自动：
 * - 生成 requestId（入 X-Request-Id 响应头，便于前后端对齐排查）
 * - 注入 AsyncLocalStorage，logger 自动带上 requestId / userId / route
 * - 异常结构化日志（event=api.error，带 pathname/method/err）
 */
export function withAuth(handler: AuthHandler) {
  return async (
    request: NextRequest,
    ctx: { params: Promise<Record<string, string>> }
  ) => {
    const requestId =
      request.headers.get("x-request-id") || generateRequestId();
    const route = request.nextUrl.pathname;
    const method = request.method;
    const startedAt = Date.now();

    return runWithRequestContext(
      { requestId, route, method },
      async () => {
        let response: NextResponse;
        try {
          const user = await getCurrentUser(request);
          if (!user) {
            response = NextResponse.json({ error: "未登录" }, { status: 401 });
          } else if (user.status !== "active") {
            response = NextResponse.json(
              { error: "账号已停用" },
              { status: 403 },
            );
          } else {
            // 更新上下文加上 userId
            const store = (await import("./request-context")).getRequestContext();
            if (store) store.userId = user.id;
            response = await handler(request, ctx, user);
          }
        } catch (err) {
          logger.error("api.error", {
            route,
            method,
            err,
            durationMs: Date.now() - startedAt,
          });
          response = NextResponse.json(
            { error: "服务器内部错误", requestId },
            { status: 500 },
          );
        }

        response.headers.set("x-request-id", requestId);
        return response;
      },
    ) as Promise<NextResponse>;
  };
}
