/**
 * 模型错误分类。禁止对 schema/auth/参数错误 retry，避免 retry storm。
 */

export type ModelErrorClass = "retryable" | "non_retryable" | "model_access";

function errorText(err: unknown): string {
  if (err && typeof err === "object") {
    const anyErr = err as { status?: number; message?: string; code?: string };
    const status = anyErr.status != null ? String(anyErr.status) : "";
    const code = anyErr.code ?? "";
    const message = anyErr.message ?? "";
    return `${status} ${code} ${message}`.toLowerCase();
  }
  return String(err ?? "").toLowerCase();
}

export function classifyModelError(err: unknown): ModelErrorClass {
  const text = errorText(err);
  const status =
    err && typeof err === "object" && "status" in err
      ? Number((err as { status?: number }).status)
      : Number.NaN;

  if (
    text.includes("model_not_found") ||
    text.includes("does not have access to model") ||
    text.includes("invalid model") ||
    (status === 404 && text.includes("model"))
  ) {
    return "model_access";
  }

  if (
    status === 401 ||
    text.includes("invalid_api_key") ||
    text.includes("incorrect api key")
  ) {
    return "non_retryable";
  }

  if (
    text.includes("invalid_schema") ||
    text.includes("invalid schema") ||
    text.includes("unsupported_parameter") ||
    text.includes("unsupported parameter") ||
    text.includes("unknown parameter") ||
    text.includes("invalid_request") ||
    text.includes("'none' reasoning") ||
    (text.includes("reasoning.effort") && text.includes("none")) ||
    (status === 400 && !text.includes("rate"))
  ) {
    return "non_retryable";
  }

  if (
    status === 429 ||
    status >= 500 ||
    text.includes("429") ||
    text.includes("rate limit") ||
    text.includes("timeout") ||
    text.includes("超时") ||
    text.includes("aborted") ||
    text.includes("econnreset") ||
    text.includes("fetch failed") ||
    text.includes("network")
  ) {
    return "retryable";
  }

  return "non_retryable";
}

export function isRetryableModelError(err: unknown): boolean {
  const cls = classifyModelError(err);
  return cls === "retryable" || cls === "model_access";
}
