/**
 * 性能测试目标策略：默认只允许 localhost / git Preview。
 * Production 必须 --allow-production。禁止写操作由调用方保证。
 */

export type PerfTargetKind = "local" | "preview" | "production" | "blocked";

export function classifyPerfHostname(hostname: string): PerfTargetKind {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h === "127.0.0.1" || h === "::1" || h === "0.0.0.0") {
    return "local";
  }
  if (h.endsWith(".vercel.app") && h.startsWith("git-")) return "preview";
  if (h === "qingyan.ai" || h.endsWith(".qingyan.ai")) return "production";
  if (h === "qingyan.ca" || h.endsWith(".qingyan.ca")) return "production";
  if (h.endsWith(".vercel.app")) return "production";
  return "blocked";
}

export function assertPerfTargetAllowed(opts: {
  hostname: string;
  allowProduction: boolean;
}): { ok: true; kind: PerfTargetKind } | { ok: false; kind: PerfTargetKind; reason: string } {
  const kind = classifyPerfHostname(opts.hostname);
  if (kind === "local" || kind === "preview") return { ok: true, kind };
  if (kind === "production") {
    if (!opts.allowProduction) {
      return {
        ok: false,
        kind,
        reason: "production host refused (pass --allow-production to override)",
      };
    }
    return { ok: true, kind };
  }
  return {
    ok: false,
    kind,
    reason: "host is not localhost, git Preview, or an allowlisted production domain",
  };
}

export const PERF_SAFE_GET_PATHS = [
  "/api/health",
] as const;

/** 需登录的只读探测；默认不跑，避免无 cookie 时制造噪音 */
export const PERF_AUTH_GET_PATHS = [
  "/api/auth/me",
  "/api/projects",
  "/api/organizations",
] as const;
