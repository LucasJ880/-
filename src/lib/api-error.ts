/**
 * 服务端 API 统一错误响应助手
 *
 * 所有 API route 推荐使用此函数返回错误，确保格式一致。
 */

import { NextResponse } from "next/server";

interface ApiErrorOptions {
  status?: number;
  code?: string;
  details?: unknown;
}

export function apiError(message: string, opts: ApiErrorOptions = {}) {
  const { status = 500, code, details } = opts;
  return NextResponse.json(
    {
      error: message,
      ...(code ? { code } : {}),
      ...(details !== undefined ? { details } : {}),
    },
    { status }
  );
}

export const ApiErrors = {
  unauthorized: () => apiError("未登录", { status: 401, code: "UNAUTHORIZED" }),
  forbidden: (msg = "无权执行此操作") => apiError(msg, { status: 403, code: "FORBIDDEN" }),
  notFound: (entity = "资源") => apiError(`${entity}不存在`, { status: 404, code: "NOT_FOUND" }),
  badRequest: (msg: string) => apiError(msg, { status: 400, code: "BAD_REQUEST" }),
  internal: (msg = "服务器内部错误") => apiError(msg, { status: 500, code: "INTERNAL_ERROR" }),
} as const;
