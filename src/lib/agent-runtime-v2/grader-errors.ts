/**
 * Grader 错误分类：仅已知可降级错误允许 fallback。
 */

export const DEGRADABLE_GRADER_ERRORS = new Set([
  "MODEL_TIMEOUT",
  "PROVIDER_UNAVAILABLE",
  "FEATURE_NOT_CONFIGURED",
]);

export const FATAL_GRADER_ERRORS = new Set([
  "ORG_CONTEXT_MISMATCH",
  "NO_MEMBERSHIP",
  "WORKSPACE_ACCESS_DENIED",
  "AUTHORIZATION_ERROR",
  "DATABASE_ERROR",
  "UNKNOWN_ERROR",
]);

export type ClassifiedGraderError = {
  code: string;
  degradable: boolean;
  message: string;
};

export function classifyGraderError(err: unknown): ClassifiedGraderError {
  const message = err instanceof Error ? err.message : String(err);
  const codeFromObj =
    err && typeof err === "object" && "code" in err
      ? String((err as { code?: unknown }).code ?? "")
      : "";
  const upper = `${codeFromObj} ${message}`.toUpperCase();

  const tryMatch = (code: string) =>
    codeFromObj === code ||
    upper.includes(code) ||
    upper.includes(code.replace(/_/g, " "));

  for (const code of DEGRADABLE_GRADER_ERRORS) {
    if (tryMatch(code) || (code === "MODEL_TIMEOUT" && /timeout|timed out/i.test(message))) {
      return { code, degradable: true, message };
    }
    if (
      code === "PROVIDER_UNAVAILABLE" &&
      /provider|ECONNREFUSED|ENOTFOUND|503|502/i.test(message)
    ) {
      return { code, degradable: true, message };
    }
    if (
      code === "FEATURE_NOT_CONFIGURED" &&
      /not configured|feature.?disabled|GMAIL_DRAFT_DISABLED/i.test(message)
    ) {
      return { code, degradable: true, message };
    }
  }

  if (tryMatch("ORG_CONTEXT_MISMATCH") || /org.?mismatch|跨组织/i.test(message)) {
    return { code: "ORG_CONTEXT_MISMATCH", degradable: false, message };
  }
  if (tryMatch("NO_MEMBERSHIP") || /no.?membership|无企业成员/i.test(message)) {
    return { code: "NO_MEMBERSHIP", degradable: false, message };
  }
  if (
    tryMatch("WORKSPACE_ACCESS_DENIED") ||
    /workspace.?denied|workspace.?access/i.test(message)
  ) {
    return { code: "WORKSPACE_ACCESS_DENIED", degradable: false, message };
  }
  if (
    tryMatch("AUTHORIZATION_ERROR") ||
    /unauthorized|forbidden|403|权限/i.test(message)
  ) {
    return { code: "AUTHORIZATION_ERROR", degradable: false, message };
  }
  if (
    tryMatch("DATABASE_ERROR") ||
    /prisma|database|ECONNRESET|P1001|P2025/i.test(message)
  ) {
    return { code: "DATABASE_ERROR", degradable: false, message };
  }

  return { code: "UNKNOWN_ERROR", degradable: false, message };
}
