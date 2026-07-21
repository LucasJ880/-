/**
 * Image Provider 错误分类 — 禁止把所有 403 都当成「模型不可用」
 */

export type ImageProviderErrorCode =
  | "MODEL_ACCESS_DENIED"
  | "ENDPOINT_ACCESS_DENIED"
  | "INVALID_IMAGE_REQUEST"
  | "MODEL_NOT_FOUND"
  | "RATE_LIMITED"
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_INTERNAL_ERROR"
  | "UNKNOWN_PROVIDER_ERROR";

export interface ProviderExecution {
  requestedModel: string;
  resolvedModel?: string;
  fallbackReason?: string;
  httpStatus?: number;
  providerErrorCode?: ImageProviderErrorCode;
  attemptNumber: number;
  bodySnippet?: string;
}

export function classifyImageProviderError(input: {
  httpStatus?: number;
  body?: string;
}): ImageProviderErrorCode {
  const status = input.httpStatus ?? 0;
  const body = (input.body || "").toLowerCase();

  if (status === 429 || body.includes("rate limit") || body.includes("rate_limit")) {
    return "RATE_LIMITED";
  }
  if (status === 404 || body.includes("model_not_found") || body.includes("does not exist")) {
    return "MODEL_NOT_FOUND";
  }
  if (
    status === 400 ||
    body.includes("invalid_request") ||
    body.includes("invalid image") ||
    body.includes("unsupported")
  ) {
    return "INVALID_IMAGE_REQUEST";
  }
  if (status === 408 || body.includes("timeout") || body.includes("timed out")) {
    return "PROVIDER_TIMEOUT";
  }
  if (status >= 500) {
    return "PROVIDER_INTERNAL_ERROR";
  }
  if (status === 403) {
    // 区分：模型权限 vs 端点/项目权限 vs 别名路由
    if (
      body.includes("does not have access to model") ||
      body.includes("model_access") ||
      body.includes("not allowed to use")
    ) {
      return "MODEL_ACCESS_DENIED";
    }
    if (
      body.includes("project") ||
      body.includes("organization") ||
      body.includes("endpoint") ||
      body.includes("api key") ||
      body.includes("insufficient_quota")
    ) {
      return "ENDPOINT_ACCESS_DENIED";
    }
    // 别名偶发 403、pinned 成功 → 更接近别名路由/权限抖动，记为 MODEL_ACCESS_DENIED
    if (body.includes("model")) {
      return "MODEL_ACCESS_DENIED";
    }
    return "ENDPOINT_ACCESS_DENIED";
  }
  if (status === 401) {
    return "ENDPOINT_ACCESS_DENIED";
  }
  return "UNKNOWN_PROVIDER_ERROR";
}

export function shouldRetryWithPinnedModel(code: ImageProviderErrorCode): boolean {
  return (
    code === "MODEL_ACCESS_DENIED" ||
    code === "MODEL_NOT_FOUND" ||
    code === "PROVIDER_INTERNAL_ERROR" ||
    code === "UNKNOWN_PROVIDER_ERROR"
  );
}
