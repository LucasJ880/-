/**
 * Wave1.5 Staging 隔离 — fail-closed 运行时防线
 *
 * - 优先显式环境标识（QINGYAN_RUNTIME_ENV / VERCEL_ENV）
 * - staging/preview：DATABASE_URL 缺失或无法解析 → fail-closed
 * - 非 Production 命中生产 DB endpoint → 拒绝写/cron/worker
 * - 非 Production 默认关闭真实邮件、Gmail Draft、微信/企微、外部 webhook、cron、worker
 * - 绝不打印连接串或 Secret
 */

import { createHash } from "node:crypto";
import { NextResponse } from "next/server";

export type QingyanRuntimeEnv =
  | "production"
  | "staging"
  | "preview"
  | "development"
  | "test";

const DEFAULT_PRODUCTION_DB_ENDPOINT_PREFIXES = [
  "ep-super-field-antfibsl",
] as const;

const DEFAULT_STAGING_DB_ENDPOINT_PREFIXES = [
  "ep-floral-sea-au07ycff",
] as const;

export const NON_PROD_SIDE_EFFECT_DISABLED = "NON_PROD_SIDE_EFFECT_DISABLED";

export class NonProdSideEffectDisabledError extends Error {
  readonly code = NON_PROD_SIDE_EFFECT_DISABLED;
  constructor(message = "非生产环境已禁止该副作用") {
    super(message);
    this.name = "NonProdSideEffectDisabledError";
  }
}

function envFlag(name: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const v = (env[name] || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function vercelEnv(env: NodeJS.ProcessEnv = process.env): string {
  return (env.VERCEL_ENV || "").trim().toLowerCase();
}

function explicitRuntimeEnv(env: NodeJS.ProcessEnv = process.env): string {
  return (env.QINGYAN_RUNTIME_ENV || "").trim().toLowerCase();
}

/** VERCEL_ENV 与 QINGYAN_RUNTIME_ENV 冲突 */
export function detectRuntimeEnvMismatch(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const vercel = vercelEnv(env);
  const explicit = explicitRuntimeEnv(env);
  if (!explicit) return false;
  if (explicit === "production" && vercel && vercel !== "production") {
    return true;
  }
  if (
    (explicit === "staging" || explicit === "preview" || explicit === "development") &&
    vercel === "production"
  ) {
    return true;
  }
  return false;
}

export function resolveQingyanRuntimeEnv(
  env: NodeJS.ProcessEnv = process.env,
): QingyanRuntimeEnv {
  const explicit = explicitRuntimeEnv(env);
  if (
    explicit === "production" ||
    explicit === "staging" ||
    explicit === "preview" ||
    explicit === "development" ||
    explicit === "test"
  ) {
    return explicit;
  }
  const vercel = vercelEnv(env);
  if (vercel === "production") return "production";
  if (vercel === "preview") return "preview";
  if (vercel === "development") return "development";
  if ((env.NODE_ENV || "").toLowerCase() === "test") return "test";
  if ((env.NODE_ENV || "").toLowerCase() === "production") {
    return "development";
  }
  return "development";
}

/** 仅当无 mismatch 且 runtime 为 production 时视为生产数据面 */
export function isProductionRuntimeEnv(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (detectRuntimeEnvMismatch(env)) return false;
  return resolveQingyanRuntimeEnv(env) === "production";
}

function productionDbEndpointPrefixes(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const extra = (env.QINGYAN_PRODUCTION_DB_ENDPOINT_PREFIXES || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return [
    ...DEFAULT_PRODUCTION_DB_ENDPOINT_PREFIXES.map((s) => s.toLowerCase()),
    ...extra,
  ];
}

function stagingDbEndpointPrefixes(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const extra = (env.QINGYAN_STAGING_DB_ENDPOINT_PREFIXES || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return [
    ...DEFAULT_STAGING_DB_ENDPOINT_PREFIXES.map((s) => s.toLowerCase()),
    ...extra,
  ];
}

export function extractDbEndpointPrefix(
  databaseUrl: string | undefined | null,
): string | null {
  if (!databaseUrl) return null;
  try {
    const normalized = databaseUrl.replace(/^postgresql:/i, "http:");
    const host = new URL(normalized).hostname.toLowerCase();
    if (!host) return null;
    const first = host.split(".")[0] || "";
    return first.replace(/-pooler$/, "") || null;
  } catch {
    return null;
  }
}

export function isProductionDatabaseUrl(
  databaseUrl: string | undefined | null,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const prefix = extractDbEndpointPrefix(databaseUrl);
  if (!prefix) return false;
  return productionDbEndpointPrefixes(env).some(
    (p) => prefix === p || prefix.startsWith(p),
  );
}

export function classifyDbPlane(
  databaseUrl: string | undefined | null,
  env: NodeJS.ProcessEnv = process.env,
): "production" | "staging" | "other" | "unresolved" {
  const prefix = extractDbEndpointPrefix(databaseUrl);
  if (!databaseUrl || !prefix) return "unresolved";
  if (isProductionDatabaseUrl(databaseUrl, env)) return "production";
  if (
    stagingDbEndpointPrefixes(env).some(
      (p) => prefix === p || prefix.startsWith(p),
    )
  ) {
    return "staging";
  }
  return "other";
}

/** 匿名 health 用的不可逆短指纹（非完整 endpoint） */
export function dbEndpointFingerprint(
  databaseUrl: string | undefined | null,
): string | null {
  const prefix = extractDbEndpointPrefix(databaseUrl);
  if (!prefix) return null;
  return createHash("sha256").update(prefix).digest("hex").slice(0, 12);
}

export type IsolationViolationCode =
  | "PROD_DB_ON_NON_PROD_RUNTIME"
  | "PROD_CRON_SECRET_ON_NON_PROD"
  | "PROD_WORKER_TOKEN_ON_NON_PROD"
  | "RUNTIME_ENV_MISMATCH"
  | "DB_ENDPOINT_UNRESOLVED"
  | "SIDE_EFFECT_DISABLED"
  | "CRON_DISABLED_NON_PROD"
  | "WORKER_DISABLED_NON_PROD"
  | "NON_PROD_SIDE_EFFECT_DISABLED";

export type IsolationAssessment = {
  runtimeEnv: QingyanRuntimeEnv;
  dbEndpointPrefix: string | null;
  dbPlane: "production" | "staging" | "other" | "unresolved";
  usingProductionDb: boolean;
  ok: boolean;
  violations: IsolationViolationCode[];
};

export function assessRuntimeIsolation(
  env: NodeJS.ProcessEnv = process.env,
): IsolationAssessment {
  const runtimeEnv = resolveQingyanRuntimeEnv(env);
  const dbUrl = env.DATABASE_URL || env.DIRECT_URL || null;
  const dbEndpointPrefix = extractDbEndpointPrefix(dbUrl);
  const dbPlane = classifyDbPlane(dbUrl, env);
  const usingProductionDb = dbPlane === "production";
  const violations: IsolationViolationCode[] = [];

  if (detectRuntimeEnvMismatch(env)) {
    violations.push("RUNTIME_ENV_MISMATCH");
  }

  // staging/preview：必须能解析 DB；test 放宽以便 CI mock
  if (
    (runtimeEnv === "staging" || runtimeEnv === "preview") &&
    dbPlane === "unresolved"
  ) {
    violations.push("DB_ENDPOINT_UNRESOLVED");
  }

  if (runtimeEnv !== "production" && usingProductionDb) {
    violations.push("PROD_DB_ON_NON_PROD_RUNTIME");
  }

  const prodCronSha = (env.QINGYAN_PRODUCTION_CRON_SECRET_SHA256 || "")
    .trim()
    .toLowerCase();
  const cron = (env.CRON_SECRET || "").trim();
  if (runtimeEnv !== "production" && prodCronSha && cron) {
    const sha = createHash("sha256").update(cron, "utf8").digest("hex");
    if (sha === prodCronSha) {
      violations.push("PROD_CRON_SECRET_ON_NON_PROD");
    }
  }

  const prodWorkerSha = (env.QINGYAN_PRODUCTION_WORKER_TOKEN_SHA256 || "")
    .trim()
    .toLowerCase();
  const workerToken = (env.POSTFLOW_WORKER_TOKEN || "").trim();
  if (runtimeEnv !== "production" && prodWorkerSha && workerToken) {
    const sha = createHash("sha256").update(workerToken, "utf8").digest("hex");
    if (sha === prodWorkerSha) {
      violations.push("PROD_WORKER_TOKEN_ON_NON_PROD");
    }
  }

  return {
    runtimeEnv,
    dbEndpointPrefix,
    dbPlane,
    usingProductionDb,
    ok: violations.length === 0,
    violations,
  };
}

export function isRealEmailSendAllowed(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (isProductionRuntimeEnv(env)) return true;
  if (resolveQingyanRuntimeEnv(env) === "test") {
    return envFlag("QINGYAN_ALLOW_REAL_EMAIL_NON_PROD", env);
  }
  return envFlag("QINGYAN_ALLOW_REAL_EMAIL_NON_PROD", env);
}

/** Gmail Draft 唯一判定入口 */
export function isGmailDraftAllowed(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!envFlag("GMAIL_DRAFT_ENABLED", env)) return false;
  if (isProductionRuntimeEnv(env)) return true;
  if (resolveQingyanRuntimeEnv(env) === "test") {
    return true;
  }
  // staging/preview/development：必须显式允许，且不得连生产库
  const a = assessRuntimeIsolation(env);
  if (!a.ok || a.usingProductionDb) return false;
  return envFlag("QINGYAN_ALLOW_GMAIL_DRAFT_NON_PROD", env);
}

export function isRealWechatSendAllowed(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (isProductionRuntimeEnv(env)) return true;
  return envFlag("QINGYAN_ALLOW_REAL_WECHAT_NON_PROD", env);
}

export function isExternalWebhookSideEffectAllowed(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (isProductionRuntimeEnv(env)) return true;
  if (resolveQingyanRuntimeEnv(env) === "test") {
    return envFlag("QINGYAN_ALLOW_EXTERNAL_WEBHOOK_NON_PROD", env);
  }
  return envFlag("QINGYAN_ALLOW_EXTERNAL_WEBHOOK_NON_PROD", env);
}

export function isCronExecutionAllowed(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const a = assessRuntimeIsolation(env);
  if (!a.ok) return false;
  if (a.runtimeEnv === "production" || a.runtimeEnv === "test") return true;
  return envFlag("QINGYAN_ALLOW_CRON_NON_PROD", env);
}

export function isWorkerExecutionAllowed(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const a = assessRuntimeIsolation(env);
  if (!a.ok) return false;
  if (a.runtimeEnv === "production" || a.runtimeEnv === "test") return true;
  return envFlag("QINGYAN_ALLOW_WORKER_NON_PROD", env);
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

export type SideEffectKind =
  | "write"
  | "cron"
  | "worker"
  | "email"
  | "wechat"
  | "webhook"
  | "gmail_draft";

/** 写副作用 / cron / worker 统一入口（HTTP） */
export function assertNonProdSideEffectsAllowed(
  kind: SideEffectKind,
  env: NodeJS.ProcessEnv = process.env,
): NextResponse | null {
  const a = assessRuntimeIsolation(env);
  if (!a.ok) {
    return isolationForbiddenResponse(a.violations[0] || "ISOLATION_VIOLATION");
  }
  if (a.runtimeEnv === "production") return null;

  switch (kind) {
    case "cron":
      if (!isCronExecutionAllowed(env)) {
        return isolationForbiddenResponse("CRON_DISABLED_NON_PROD");
      }
      break;
    case "worker":
      if (!isWorkerExecutionAllowed(env)) {
        return isolationForbiddenResponse("WORKER_DISABLED_NON_PROD");
      }
      break;
    case "email":
      if (!isRealEmailSendAllowed(env)) {
        return isolationForbiddenResponse("SIDE_EFFECT_DISABLED");
      }
      break;
    case "gmail_draft":
      if (!isGmailDraftAllowed(env)) {
        return isolationForbiddenResponse("SIDE_EFFECT_DISABLED");
      }
      break;
    case "wechat":
      if (!isRealWechatSendAllowed(env)) {
        return isolationForbiddenResponse("NON_PROD_SIDE_EFFECT_DISABLED");
      }
      break;
    case "webhook":
      if (!isExternalWebhookSideEffectAllowed(env)) {
        return isolationForbiddenResponse("SIDE_EFFECT_DISABLED");
      }
      break;
    case "write":
      // staging/preview 在 isolation ok 时可写；生产库/缺失/mismatch 已在上方拦截
      break;
  }
  return null;
}

/** 非 HTTP 上下文（executor / gateway） */
export function assertSideEffectOrThrow(
  kind: SideEffectKind,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const res = assertNonProdSideEffectsAllowed(kind, env);
  if (!res) return;
  // NextResponse → 提取 code
  // 同步读取 body 不可行；用评估结果抛错
  const a = assessRuntimeIsolation(env);
  if (!a.ok) {
    throw new NonProdSideEffectDisabledError(
      `隔离失败: ${a.violations[0] || "ISOLATION_VIOLATION"}`,
    );
  }
  if (kind === "wechat" || kind === "email" || kind === "webhook" || kind === "gmail_draft") {
    throw new NonProdSideEffectDisabledError();
  }
  throw new NonProdSideEffectDisabledError(`副作用被拒绝: ${kind}`);
}

export function healthIsolationSnapshot(env: NodeJS.ProcessEnv = process.env): {
  runtimeEnv: QingyanRuntimeEnv;
  dbPlane: IsolationAssessment["dbPlane"];
  isolationOk: boolean;
  violations: IsolationViolationCode[];
  /** 仅非生产匿名响应可带短指纹；生产不暴露 */
  dbFingerprint: string | null;
} {
  const a = assessRuntimeIsolation(env);
  const dbUrl = env.DATABASE_URL || env.DIRECT_URL || null;
  return {
    runtimeEnv: a.runtimeEnv,
    dbPlane: a.dbPlane,
    isolationOk: a.ok,
    violations: a.violations,
    dbFingerprint:
      a.runtimeEnv === "production" ? null : dbEndpointFingerprint(dbUrl),
  };
}
