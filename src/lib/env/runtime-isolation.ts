/**
 * Wave1.5 Staging 隔离 — fail-closed 运行时防线（白名单）
 *
 * - 运行环境必须与 dbPlane 白名单匹配（非仅生产黑名单）
 * - 支持 QINGYAN_EXPECTED_DB_PLANE / QINGYAN_ALLOWED_DB_ENDPOINT_PREFIXES / fingerprints
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

export type DbPlane = "production" | "staging" | "other" | "unresolved";

const DEFAULT_PRODUCTION_DB_ENDPOINT_PREFIXES = [
  "ep-super-field-antfibsl",
] as const;

const DEFAULT_STAGING_DB_ENDPOINT_PREFIXES = [
  "ep-floral-sea-au07ycff",
] as const;

export const NON_PROD_SIDE_EFFECT_DISABLED = "NON_PROD_SIDE_EFFECT_DISABLED";

export type IsolationViolationCode =
  | "PROD_DB_ON_NON_PROD_RUNTIME"
  | "DB_PLANE_MISMATCH"
  | "PROD_CRON_SECRET_ON_NON_PROD"
  | "PROD_WORKER_TOKEN_ON_NON_PROD"
  | "RUNTIME_ENV_MISMATCH"
  | "DB_ENDPOINT_UNRESOLVED"
  | "SIDE_EFFECT_DISABLED"
  | "CRON_DISABLED_NON_PROD"
  | "WORKER_DISABLED_NON_PROD"
  | "NON_PROD_SIDE_EFFECT_DISABLED";

export type SideEffectKind =
  | "write"
  | "cron"
  | "worker"
  | "email"
  | "wechat"
  | "webhook"
  | "gmail_draft";

const SAFE_MESSAGES: Record<IsolationViolationCode, string> = {
  PROD_DB_ON_NON_PROD_RUNTIME: "非生产运行时不得连接生产数据库",
  DB_PLANE_MISMATCH: "数据库平面与运行环境预期不匹配",
  PROD_CRON_SECRET_ON_NON_PROD: "非生产环境不得使用生产 CRON_SECRET",
  PROD_WORKER_TOKEN_ON_NON_PROD: "非生产环境不得使用生产 worker token",
  RUNTIME_ENV_MISMATCH: "运行时环境声明冲突",
  DB_ENDPOINT_UNRESOLVED: "数据库 endpoint 缺失或无法解析",
  SIDE_EFFECT_DISABLED: "该外部环境副作用已被禁用",
  CRON_DISABLED_NON_PROD: "非生产环境默认禁止 cron",
  WORKER_DISABLED_NON_PROD: "非生产环境默认禁止 worker",
  NON_PROD_SIDE_EFFECT_DISABLED: "非生产环境已禁止该副作用",
};

/** 配置/平面类隔离错误（保留真实 code） */
export class RuntimeIsolationError extends Error {
  readonly code: IsolationViolationCode;
  readonly kind: SideEffectKind;
  constructor(
    code: IsolationViolationCode,
    kind: SideEffectKind,
    message?: string,
  ) {
    super(message || SAFE_MESSAGES[code] || "环境隔离检查失败");
    this.name = "RuntimeIsolationError";
    this.code = code;
    this.kind = kind;
  }
}

/** 通道关闭（微信/邮件/webhook/gmail） */
export class NonProdSideEffectDisabledError extends RuntimeIsolationError {
  constructor(
    message = SAFE_MESSAGES.NON_PROD_SIDE_EFFECT_DISABLED,
    kind: SideEffectKind = "wechat",
  ) {
    super("NON_PROD_SIDE_EFFECT_DISABLED", kind, message);
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

function csvList(name: string, env: NodeJS.ProcessEnv): string[] {
  return (env[name] || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/** VERCEL_ENV 与 QINGYAN_RUNTIME_ENV 冲突 */
export function detectRuntimeEnvMismatch(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const vercel = vercelEnv(env);
  const explicit = explicitRuntimeEnv(env);
  if (!explicit) return false;

  // test 不得出现在任何 Vercel 部署平面
  if (
    explicit === "test" &&
    (vercel === "production" ||
      vercel === "preview" ||
      vercel === "development")
  ) {
    return true;
  }

  if (explicit === "production" && vercel && vercel !== "production") {
    return true;
  }
  if (
    (explicit === "staging" ||
      explicit === "preview" ||
      explicit === "development") &&
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
  const extra = csvList("QINGYAN_PRODUCTION_DB_ENDPOINT_PREFIXES", env);
  return [
    ...DEFAULT_PRODUCTION_DB_ENDPOINT_PREFIXES.map((s) => s.toLowerCase()),
    ...extra,
  ];
}

function stagingDbEndpointPrefixes(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const extra = csvList("QINGYAN_STAGING_DB_ENDPOINT_PREFIXES", env);
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
): DbPlane {
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

/**
 * 解析当前 runtime 的预期 dbPlane。
 * - production / staging：硬性固定
 * - preview / development：需显式 QINGYAN_EXPECTED_DB_PLANE 或 allowlist
 * - test：本地 CI 放宽（不强制）
 */
export function resolveExpectedDbPlane(
  env: NodeJS.ProcessEnv = process.env,
): DbPlane | null {
  const runtime = resolveQingyanRuntimeEnv(env);
  const explicit = (env.QINGYAN_EXPECTED_DB_PLANE || "").trim().toLowerCase();
  if (
    explicit === "production" ||
    explicit === "staging" ||
    explicit === "other"
  ) {
    // production/staging runtime 不允许用 expected 覆盖硬性矩阵
    if (runtime === "production") return "production";
    if (runtime === "staging") return "staging";
    return explicit;
  }
  if (runtime === "production") return "production";
  if (runtime === "staging") return "staging";
  if (runtime === "test") return null;
  // preview / development：未配置 expected → null（不安全）
  return null;
}

function prefixInAllowlist(
  prefix: string | null,
  env: NodeJS.ProcessEnv,
): boolean {
  if (!prefix) return false;
  const allowed = csvList("QINGYAN_ALLOWED_DB_ENDPOINT_PREFIXES", env);
  return allowed.some((p) => prefix === p || prefix.startsWith(p));
}

function fingerprintInAllowlist(
  fingerprint: string | null,
  env: NodeJS.ProcessEnv,
): boolean {
  if (!fingerprint) return false;
  const allowed = csvList("QINGYAN_ALLOWED_DB_ENDPOINT_FINGERPRINTS", env);
  return allowed.includes(fingerprint.toLowerCase());
}

/** 当前 DB 是否满足预期平面（含 allowlist/fingerprint 等价匹配） */
export function dbMatchesExpectedPlane(
  dbPlane: DbPlane,
  databaseUrl: string | undefined | null,
  expected: DbPlane | null,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!expected) return false;
  if (dbPlane === "unresolved") return false;
  if (dbPlane === expected) return true;

  // production/staging 硬性：不得用 allowlist 把 other/staging 当成 production
  const runtime = resolveQingyanRuntimeEnv(env);
  if (runtime === "production" || runtime === "staging") {
    return dbPlane === expected;
  }

  // preview/development：allowlist / fingerprint 可证明匹配预期测试库
  const prefix = extractDbEndpointPrefix(databaseUrl);
  const fp = dbEndpointFingerprint(databaseUrl);
  if (prefixInAllowlist(prefix, env) || fingerprintInAllowlist(fp, env)) {
    return true;
  }
  return false;
}

export type IsolationAssessment = {
  runtimeEnv: QingyanRuntimeEnv;
  dbEndpointPrefix: string | null;
  dbPlane: DbPlane;
  expectedDbPlane: DbPlane | null;
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
  const expectedDbPlane = resolveExpectedDbPlane(env);
  const usingProductionDb = dbPlane === "production";
  const violations: IsolationViolationCode[] = [];

  if (detectRuntimeEnvMismatch(env)) {
    violations.push("RUNTIME_ENV_MISMATCH");
  }

  // production / staging / preview：未解析 endpoint → fail-closed
  // development 远程写也会因 expected/allowlist 失败；test 放宽
  if (
    (runtimeEnv === "production" ||
      runtimeEnv === "staging" ||
      runtimeEnv === "preview") &&
    dbPlane === "unresolved"
  ) {
    violations.push("DB_ENDPOINT_UNRESOLVED");
  }

  // 非 prod 命中生产库（显式保留历史码）
  if (runtimeEnv !== "production" && usingProductionDb) {
    violations.push("PROD_DB_ON_NON_PROD_RUNTIME");
  }

  // 白名单矩阵：expected 与 actual 必须匹配
  if (runtimeEnv === "production" || runtimeEnv === "staging") {
    if (!dbMatchesExpectedPlane(dbPlane, dbUrl, expectedDbPlane, env)) {
      // unresolved 已记 DB_ENDPOINT_UNRESOLVED；其余记 mismatch
      if (dbPlane !== "unresolved") {
        violations.push("DB_PLANE_MISMATCH");
      } else if (!violations.includes("DB_ENDPOINT_UNRESOLVED")) {
        violations.push("DB_PLANE_MISMATCH");
      }
    }
  } else if (runtimeEnv === "preview") {
    // 普通 Preview：必须显式 expected 或 allowlist，且完全匹配
    const hasAllow =
      prefixInAllowlist(dbEndpointPrefix, env) ||
      fingerprintInAllowlist(dbEndpointFingerprint(dbUrl), env);
    if (!expectedDbPlane && !hasAllow) {
      if (dbPlane !== "unresolved") {
        violations.push("DB_PLANE_MISMATCH");
      }
    } else if (
      !dbMatchesExpectedPlane(
        dbPlane,
        dbUrl,
        expectedDbPlane || (hasAllow ? "staging" : null),
        env,
      )
    ) {
      if (dbPlane !== "unresolved") {
        violations.push("DB_PLANE_MISMATCH");
      }
    }
  } else if (runtimeEnv === "development") {
    // 开发默认不安全；仅 allowlist/fingerprint 命中才视为平面 OK
    const hasAllow =
      prefixInAllowlist(dbEndpointPrefix, env) ||
      fingerprintInAllowlist(dbEndpointFingerprint(dbUrl), env);
    if (!hasAllow) {
      if (dbPlane === "unresolved") {
        // 本地无 DB 时不强制 unresolved（便于单元测试）；有 URL 则 mismatch
      } else {
        violations.push("DB_PLANE_MISMATCH");
      }
    }
  }
  // test：本地 CI 不强制平面白名单

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
    expectedDbPlane,
    usingProductionDb,
    ok: violations.length === 0,
    violations,
  };
}

/**
 * Preview 写/cron/worker：isolation ok 还不够，须 expected/allowlist 已匹配。
 * Staging runtime（QINGYAN_RUNTIME_ENV=staging）在平面匹配时可写。
 */
export function isNonProdWriteAllowed(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const a = assessRuntimeIsolation(env);
  if (!a.ok) return false;
  if (a.runtimeEnv === "production" || a.runtimeEnv === "test") return true;
  if (a.runtimeEnv === "staging") return true;
  if (a.runtimeEnv === "preview") {
    // preview 仅当 expected/allowlist 已使 isolation ok 时允许写测试
    return true;
  }
  if (a.runtimeEnv === "development") {
    // development：仅 allowlist 命中时 isolation ok → 允许
    return true;
  }
  return false;
}

export function isRealEmailSendAllowed(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (isProductionRuntimeEnv(env)) return true;
  return envFlag("QINGYAN_ALLOW_REAL_EMAIL_NON_PROD", env);
}

/** Gmail Draft 唯一判定入口 */
export function isGmailDraftAllowed(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!envFlag("GMAIL_DRAFT_ENABLED", env)) return false;
  if (isProductionRuntimeEnv(env)) return true;
  // 本地 CI test：GMAIL_DRAFT_ENABLED 已通过即可（不跑真实 API）
  if (resolveQingyanRuntimeEnv(env) === "test") {
    return true;
  }
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

function primaryViolation(
  a: IsolationAssessment,
): IsolationViolationCode {
  return a.violations[0] || "DB_PLANE_MISMATCH";
}

/** 写副作用 / cron / worker 统一入口（HTTP） */
export function assertNonProdSideEffectsAllowed(
  kind: SideEffectKind,
  env: NodeJS.ProcessEnv = process.env,
): NextResponse | null {
  const a = assessRuntimeIsolation(env);
  if (!a.ok) {
    return isolationForbiddenResponse(primaryViolation(a));
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
      if (!isNonProdWriteAllowed(env)) {
        return isolationForbiddenResponse("DB_PLANE_MISMATCH");
      }
      break;
  }
  return null;
}

function throwForDeniedKind(
  kind: SideEffectKind,
  env: NodeJS.ProcessEnv,
): never {
  const a = assessRuntimeIsolation(env);
  if (!a.ok) {
    throw new RuntimeIsolationError(primaryViolation(a), kind);
  }
  if (kind === "wechat") {
    throw new NonProdSideEffectDisabledError(undefined, "wechat");
  }
  if (kind === "email" || kind === "webhook" || kind === "gmail_draft") {
    throw new RuntimeIsolationError("SIDE_EFFECT_DISABLED", kind);
  }
  if (kind === "worker") {
    throw new RuntimeIsolationError("WORKER_DISABLED_NON_PROD", kind);
  }
  if (kind === "cron") {
    throw new RuntimeIsolationError("CRON_DISABLED_NON_PROD", kind);
  }
  throw new RuntimeIsolationError("DB_PLANE_MISMATCH", kind);
}

/** 非 HTTP 上下文（executor / gateway）——保留真实隔离 code */
export function assertSideEffectOrThrow(
  kind: SideEffectKind,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const res = assertNonProdSideEffectsAllowed(kind, env);
  if (!res) return;
  throwForDeniedKind(kind, env);
}

export function healthIsolationSnapshot(env: NodeJS.ProcessEnv = process.env): {
  runtimeEnv: QingyanRuntimeEnv;
  dbPlane: DbPlane;
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
