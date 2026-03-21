import { NextRequest, NextResponse } from "next/server";

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

/** 统一错误响应 */
export function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
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

/** 统一的 try-catch 路由包装器 */
export function withErrorHandler(
  handler: (
    request: NextRequest,
    ctx: { params: Promise<Record<string, string>> }
  ) => Promise<NextResponse>
) {
  return async (
    request: NextRequest,
    ctx: { params: Promise<Record<string, string>> }
  ) => {
    try {
      return await handler(request, ctx);
    } catch (err) {
      console.error("[API Error]", err);
      const message =
        err instanceof Error ? err.message : "服务器内部错误";
      return NextResponse.json(
        { error: message },
        { status: 500 }
      );
    }
  };
}
