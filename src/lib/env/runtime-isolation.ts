/**
 * Wave1.5 Staging 隔离 — fail-closed 运行时防线
 *
 * 规则：
 * - 优先显式环境标识（QINGYAN_RUNTIME_ENV / VERCEL_ENV），不用 hostname 单独判定 Production
 * - 非 Production 若命中生产数据库 allowlist endpoint → 拒绝写副作用 / cron / worker
 * - 非 Production 默认关闭真实邮件、Gmail Draft、微信/企微、外部 webhook 副作用、自动 cron 消费
 * - 绝不打印连接串或 Secret
 */

import { createHash } from "node:crypto";
import { NextResponse } from "next/server";

export type QingyanRuntimeEnv = "production" | "staging" | "preview" | "development" | "test";

/** 已知生产 Neon endpoint 前缀（allowlist；可被 env 扩展） */
const DEFAULT_PRODUCTION_DB_ENDPOINT_PREFIXES = [
  "ep-super-field-antfibsl",
] as const;

function envFlag(name: string): boolean {
  const v = (process.env[name] || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

export function resolveQingyanRuntimeEnv(): QingyanRuntimeEnv {
  const explicit = (process.env.QINGYAN_RUNTIME_ENV || "").trim().toLowerCase();
  if (
    explicit === "production" ||
    explicit === "staging" ||
    explicit === "preview" ||
    explicit === "development" ||
    explicit === "test"
  ) {
    return explicit;
  }
  const vercel = (process.env.VERCEL_ENV || "").trim().toLowerCase();
  if (vercel === "production") return "production";
  if (vercel === "preview") return "preview";
  if (vercel === "development") return "development";
  if ((process.env.NODE_ENV || "").toLowerCase() === "test") return "test";
  if ((process.env.NODE_ENV || "").toLowerCase() === "production") {
    // NODE_ENV=production alone is insufficient for "production data plane"
    return "development";
  }
  return "development";
}

export function isProductionRuntimeEnv(): boolean {
  return resolveQingyanRuntimeEnv() === "production";
}

function productionDbEndpointPrefixes(): string[] {
  const extra = (process.env.QINGYAN_PRODUCTION_DB_ENDPOINT_PREFIXES || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return [...DEFAULT_PRODUCTION_DB_ENDPOINT_PREFIXES.map((s) => s.toLowerCase()), ...extra];
}

export function extractDbEndpointPrefix(databaseUrl: string | undefined | null): string | null {
  if (!databaseUrl) return null;
  try {
    const normalized = databaseUrl.replace(/^postgresql:/i, "http:");
    const host = new URL(normalized).hostname.toLowerCase();
    const first = host.split(".")[0] || "";
    // strip -pooler suffix for comparison
    return first.replace(/-pooler$/, "") || null;
  } catch {
    return null;
  }
}

export function isProductionDatabaseUrl(databaseUrl: string | undefined | null): boolean {
  const prefix = extractDbEndpointPrefix(databaseUrl);
  if (!prefix) return false;
  return productionDbEndpointPrefixes().some(
    (p) => prefix === p || prefix.startsWith(p),
  );
}

export type IsolationViolationCode =
  | "PROD_DB_ON_NON_PROD_RUNTIME"
  | "PROD_CRON_SECRET_ON_NON_PROD"
  | "SIDE_EFFECT_DISABLED"
  | "CRON_DISABLED_NON_PROD"
  | "WORKER_DISABLED_NON_PROD";

export type IsolationAssessment = {
  runtimeEnv: QingyanRuntimeEnv;
  dbEndpointPrefix: string | null;
  usingProductionDb: boolean;
  ok: boolean;
  violations: IsolationViolationCode[];
};

export function assessRuntimeIsolation(): IsolationAssessment {
  const runtimeEnv = resolveQingyanRuntimeEnv();
  const dbUrl = process.env.DATABASE_URL || process.env.DIRECT_URL || null;
  const dbEndpointPrefix = extractDbEndpointPrefix(dbUrl);
  const usingProductionDb = isProductionDatabaseUrl(dbUrl);
  const violations: IsolationViolationCode[] = [];

  if (runtimeEnv !== "production" && usingProductionDb) {
    violations.push("PROD_DB_ON_NON_PROD_RUNTIME");
  }

  // Non-prod must not reuse production cron secret fingerprint via explicit marker.
  // If QINGYAN_PRODUCTION_CRON_SECRET_SHA256 is set, compare sha of current CRON_SECRET.
  const prodCronSha = (process.env.QINGYAN_PRODUCTION_CRON_SECRET_SHA256 || "")
    .trim()
    .toLowerCase();
  const cron = (process.env.CRON_SECRET || "").trim();
  if (runtimeEnv !== "production" && prodCronSha && cron) {
    const sha = createHash("sha256").update(cron, "utf8").digest("hex");
    if (sha === prodCronSha) {
      violations.push("PROD_CRON_SECRET_ON_NON_PROD");
    }
  }

  return {
    runtimeEnv,
    dbEndpointPrefix,
    usingProductionDb,
    ok: violations.length === 0,
    violations,
  };
}

/** 非 Production 默认关闭真实外发；仅显式测试开关可开启安全测试通道 */
export function isRealEmailSendAllowed(): boolean {
  if (isProductionRuntimeEnv()) return true;
  return envFlag("QINGYAN_ALLOW_REAL_EMAIL_NON_PROD");
}

export function isGmailDraftAllowed(): boolean {
  if (isProductionRuntimeEnv()) {
    return envFlag("GMAIL_DRAFT_ENABLED");
  }
  // unit test runtime: keep legacy GMAIL_DRAFT_ENABLED behavior
  if (resolveQingyanRuntimeEnv() === "test") {
    return envFlag("GMAIL_DRAFT_ENABLED");
  }
  // staging/preview/development: require explicit non-prod allow
  return envFlag("GMAIL_DRAFT_ENABLED") && envFlag("QINGYAN_ALLOW_GMAIL_DRAFT_NON_PROD");
}

export function isRealWechatSendAllowed(): boolean {
  if (isProductionRuntimeEnv()) return true;
  return envFlag("QINGYAN_ALLOW_REAL_WECHAT_NON_PROD");
}

export function isExternalWebhookSideEffectAllowed(): boolean {
  if (isProductionRuntimeEnv()) return true;
  return envFlag("QINGYAN_ALLOW_EXTERNAL_WEBHOOK_NON_PROD");
}

export function isCronExecutionAllowed(): boolean {
  const a = assessRuntimeIsolation();
  if (!a.ok) return false;
  if (a.runtimeEnv === "production" || a.runtimeEnv === "test") return true;
  // Preview/dev/staging: cron disabled unless explicit allow
  return envFlag("QINGYAN_ALLOW_CRON_NON_PROD");
}

export function isWorkerExecutionAllowed(): boolean {
  const a = assessRuntimeIsolation();
  if (!a.ok) return false;
  if (a.runtimeEnv === "production" || a.runtimeEnv === "test") return true;
  return envFlag("QINGYAN_ALLOW_WORKER_NON_PROD");
}

export function isolationForbiddenResponse(
  code: IsolationViolationCode | "ISOLATION_VIOLATION",
  status = 503,
): NextResponse {
  return NextResponse.json(
    {
      error: "环境隔离检查失败，已拒绝执行",
      code,
    },
    { status },
  );
}

/** 写副作用 / cron / worker 统一入口 */
export function assertNonProdSideEffectsAllowed(
  kind: "write" | "cron" | "worker" | "email" | "wechat" | "webhook" | "gmail_draft",
): NextResponse | null {
  const a = assessRuntimeIsolation();
  if (!a.ok) {
    return isolationForbiddenResponse(a.violations[0] || "ISOLATION_VIOLATION");
  }
  if (a.runtimeEnv === "production") return null;

  switch (kind) {
    case "cron":
      if (!isCronExecutionAllowed()) {
        return isolationForbiddenResponse("CRON_DISABLED_NON_PROD");
      }
      break;
    case "worker":
      if (!isWorkerExecutionAllowed()) {
        return isolationForbiddenResponse("WORKER_DISABLED_NON_PROD");
      }
      break;
    case "email":
      if (!isRealEmailSendAllowed()) {
        return isolationForbiddenResponse("SIDE_EFFECT_DISABLED");
      }
      break;
    case "gmail_draft":
      if (!isGmailDraftAllowed()) {
        return isolationForbiddenResponse("SIDE_EFFECT_DISABLED");
      }
      break;
    case "wechat":
      if (!isRealWechatSendAllowed()) {
        return isolationForbiddenResponse("SIDE_EFFECT_DISABLED");
      }
      break;
    case "webhook":
      if (!isExternalWebhookSideEffectAllowed()) {
        return isolationForbiddenResponse("SIDE_EFFECT_DISABLED");
      }
      break;
    case "write":
      // write allowed on staging/dev only if not on prod DB (already checked)
      break;
  }
  return null;
}

export function healthIsolationSnapshot(): {
  runtimeEnv: QingyanRuntimeEnv;
  dbEndpointPrefix: string | null;
  isolationOk: boolean;
  violations: IsolationViolationCode[];
} {
  const a = assessRuntimeIsolation();
  return {
    runtimeEnv: a.runtimeEnv,
    dbEndpointPrefix: a.dbEndpointPrefix,
    isolationOk: a.ok,
    violations: a.violations,
  };
}
