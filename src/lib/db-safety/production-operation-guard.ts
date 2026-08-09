/**
 * Production Operation Guard — 合法生产运维操作的受控执行门禁
 *
 * 与 assertSafeTestDatabase（src/lib/testing/）的关系（两者不合并，安全模型不同）：
 *   - assertSafeTestDatabase：TEST / FIXTURE / ACCEPTANCE 入口，生产库永远禁止，
 *     任何信号组合都不能放行；
 *   - assertProductionOperationAllowed（本模块）：AUTHORIZED PRODUCTION
 *     MAINTENANCE（backfill / cleanup / data repair / revoke / production seed /
 *     bulk update），目标不是 BLOCK PRODUCTION，而是强制流程：
 *     VERIFY TARGET → DRY RUN → SHOW IMPACT → EXPLICIT CONFIRMATION → EXECUTE。
 *
 * 强制规则：
 *   1. 目标校验多信号：声明 targetEnvironment 必须与实际 DB plane 一致
 *      （production ↔ 已知生产 endpoint；staging ↔ 已知 staging endpoint；
 *      preview/local ↔ 非生产）。声明 production 连的是 preview → BLOCK；
 *      声明 preview 连的是 production → BLOCK。未识别远程 host → BLOCK。
 *      不靠 NODE_ENV 单一判断。
 *   2. 写操作默认 dry-run：无 --apply 时只允许 inspect / impact 计算 / 报告，
 *      guard 判定为 DRY_RUN_ONLY（writeAllowed=false）。
 *   3. --apply 必须携带 operation-specific confirmation phrase（含本次 dry-run
 *      算出的影响行数），不存在长期固定 secret 可以无限执行所有操作：
 *        已知影响：  PRODUCTION:<OPERATION_NAME>:<rows>
 *        未知影响：  PRODUCTION:<OPERATION_NAME>:IMPACT_UNKNOWN:I_ACCEPT_UNPREDICTABLE_IMPACT
 *      （前缀为 targetEnvironment 大写；行数变化则 phrase 失效，天然强制重跑 dry-run）
 *   4. 影响未知（IMPACT_UNKNOWN）或声明 NO_SAFE_DRY_RUN 的操作要求上面的更强 phrase。
 *   5. 租户数据操作必须显式 org scope（orgId + 组织名）；全库维护需显式声明
 *      global + 原因，防止 WHERE 缺失导致全库操作。
 *   6. 日志/审计绝不打印 DATABASE_URL / password / API key / confirmation
 *      token 值；只打印 host / database 名 / operation / org / impact。
 *
 * DB 身份判定完全复用既有实现（不造第三套）：
 *   - URL host/database 解析：src/lib/testing/assert-safe-test-database.ts inspectDbUrl
 *   - production / staging / other plane：src/lib/env/runtime-isolation.ts classifyDbPlane
 *   - local host 判定：src/lib/testing/assert-safe-test-database.ts classifyDbHost
 *
 * 本模块只能被 scripts / 测试引用，禁止进入 Next.js 应用运行时代码路径。
 */

import os from "node:os";
import { classifyDbPlane, type DbPlane } from "@/lib/env/runtime-isolation";
import {
  classifyDbHost,
  inspectDbUrl,
  type UrlInspect,
} from "@/lib/testing/assert-safe-test-database";

export type ProductionOperationType =
  | "READ_ONLY"
  | "PRODUCTION_WRITE"
  | "DESTRUCTIVE_PRODUCTION_WRITE"
  | "MIGRATION"
  | "BACKUP"
  | "RESTORE";

export type OperationTargetEnvironment =
  | "production"
  | "staging"
  | "preview"
  | "local";

export type OperationImpact =
  | { kind: "known"; rows: number; summary?: string }
  | { kind: "unknown"; reason: string }
  | { kind: "not_applicable" };

export type OperationScope =
  | { kind: "org"; orgId: string; orgName: string }
  | { kind: "global"; reason: string };

export type ProductionOperationRequest = {
  /** 大写蛇形操作名，如 BACKFILL_TRADE_PROSPECT_STAGE */
  operationName: string;
  operationType: ProductionOperationType;
  /** 操作者显式声明的目标环境（脚本经 --target= / 默认值传入） */
  targetEnvironment: OperationTargetEnvironment;
  scriptName: string;
  scope: OperationScope;
  /** --apply 存在（请求真实写入） */
  apply: boolean;
  /**
   * 本次运行是否已先行完成同口径 dry-run 计算（apply 流程要求：
   * 先 inspect 算 impact，再带 impact 调 guard，再写）。
   */
  dryRunCompleted: boolean;
  /** 该操作无法安全 dry-run（如外部副作用不可回放）；要求更强 confirmation */
  noSafeDryRun?: boolean;
  estimatedImpact: OperationImpact;
  /** 缺省时从 env.PRODUCTION_OPERATION_CONFIRM 读取 */
  confirmationToken?: string;
  env?: NodeJS.ProcessEnv;
};

export type ProductionOperationBlockCode =
  | "DB_IDENTITY_UNRESOLVED"
  | "TARGET_DB_MISMATCH"
  | "UNKNOWN_DB_IDENTITY"
  | "RUNTIME_SIGNAL_CONFLICT"
  | "MISSING_ORG_SCOPE"
  | "REQUIRE_DRY_RUN_FIRST"
  | "CONFIRMATION_REQUIRED"
  | "CONFIRMATION_MISMATCH";

export type ProductionOperationAllowMode =
  | "READ_ONLY_VERIFIED"
  | "DRY_RUN_ONLY"
  | "WRITE_ALLOWED";

export type ProductionOperationVerdict = {
  safe: boolean;
  allowMode: ProductionOperationAllowMode | null;
  /** 只有 WRITE_ALLOWED 时为 true */
  writeAllowed: boolean;
  blockCodes: ProductionOperationBlockCode[];
  targetEnvironment: OperationTargetEnvironment;
  actualDbPlane: DbPlane | "local";
  databaseHost: string | null;
  databaseName: string | null;
  /**
   * apply 所需 confirmation phrase（由公开信息推导：目标 + 操作名 + 影响行数）。
   * 报告仅在 dry-run 指引中打印它；操作者提供的 token 值绝不回显。
   */
  expectedConfirmationPhrase: string | null;
  modeDescription: string;
};

export class ProductionOperationGuardError extends Error {
  readonly verdict: ProductionOperationVerdict;
  constructor(verdict: ProductionOperationVerdict) {
    super(
      `BLOCKED: 生产操作未获授权（${verdict.blockCodes.join(", ")}）`,
    );
    this.name = "ProductionOperationGuardError";
    this.verdict = verdict;
  }
}

const WRITE_TYPES: ReadonlySet<ProductionOperationType> = new Set([
  "PRODUCTION_WRITE",
  "DESTRUCTIVE_PRODUCTION_WRITE",
  "MIGRATION",
  "RESTORE",
]);

export const IMPACT_UNKNOWN_OVERRIDE_SUFFIX =
  "IMPACT_UNKNOWN:I_ACCEPT_UNPREDICTABLE_IMPACT";

/**
 * 构造 apply 所需的 operation-specific confirmation phrase。
 * 已知影响时把行数编进 phrase：行数一变 phrase 即失效，强制重新 dry-run。
 */
export function buildOperationConfirmationPhrase(
  targetEnvironment: OperationTargetEnvironment,
  operationName: string,
  impact: OperationImpact,
  noSafeDryRun = false,
): string {
  const prefix = `${targetEnvironment.toUpperCase()}:${operationName.trim().toUpperCase()}`;
  if (!noSafeDryRun && impact.kind === "known") {
    return `${prefix}:${impact.rows}`;
  }
  return `${prefix}:${IMPACT_UNKNOWN_OVERRIDE_SUFFIX}`;
}

function isolatedMarkerPresent(env: NodeJS.ProcessEnv): boolean {
  const canonical = (env.DATABASE_ENVIRONMENT || "").trim().toLowerCase();
  const alias = (env.TEST_DATABASE_MODE || "").trim().toLowerCase();
  return canonical === "isolated" || alias === "isolated";
}

type ActualDb =
  | { plane: DbPlane | "local"; inspect: UrlInspect }
  | null;

function resolveActualDb(env: NodeJS.ProcessEnv): {
  actual: DbPlane | "local";
  database: UrlInspect;
  direct: UrlInspect;
  unresolved: boolean;
  mixed: boolean;
} {
  const database = inspectDbUrl(env.DATABASE_URL);
  const direct = inspectDbUrl(env.DIRECT_URL);
  const unresolved =
    database.kind !== "ok" || direct.kind === "malformed";

  const planeOf = (u: UrlInspect, raw: string | undefined): ActualDb => {
    if (u.kind !== "ok") return null;
    if (classifyDbHost(u.host, env) === "local") {
      return { plane: "local", inspect: u };
    }
    return { plane: classifyDbPlane(raw, env), inspect: u };
  };

  const dbPlane = planeOf(database, env.DATABASE_URL);
  const directPlane = planeOf(direct, env.DIRECT_URL);
  const mixed =
    dbPlane !== null &&
    directPlane !== null &&
    dbPlane.plane !== directPlane.plane;

  // 任一 URL 命中生产 → 实际身份按生产处理（fail-closed 方向）
  let actual: DbPlane | "local" = dbPlane?.plane ?? "unresolved";
  if (dbPlane?.plane === "production" || directPlane?.plane === "production") {
    actual = "production";
  }
  return { actual, database, direct, unresolved, mixed };
}

/**
 * 纯函数评估：不读全局、不打印、不抛错，便于单元测试。
 */
export function evaluateProductionOperation(
  req: ProductionOperationRequest,
): ProductionOperationVerdict {
  const env = req.env ?? process.env;
  const target = req.targetEnvironment;
  const blockCodes: ProductionOperationBlockCode[] = [];

  // ── 1) DB 身份解析（fail-closed：解析不出来 / 两个 URL 身份不一致就不放行）──
  const { actual, database, unresolved, mixed } = resolveActualDb(env);
  if (unresolved || mixed) {
    blockCodes.push("DB_IDENTITY_UNRESOLVED");
  }

  // ── 2) 声明目标 vs 实际 DB plane（双向校验）──
  if (!unresolved && !mixed) {
    if (target === "production") {
      if (actual === "other") {
        // 未识别远程 host：可能是 rotation 后的新生产 endpoint，也可能连错库，
        // 都不允许在"声明生产"下操作 —— 先把 endpoint 加入已知名单再来。
        blockCodes.push("UNKNOWN_DB_IDENTITY");
      } else if (actual !== "production") {
        blockCodes.push("TARGET_DB_MISMATCH");
      }
    } else if (actual === "production") {
      // 声明非生产但连的是生产库
      blockCodes.push("TARGET_DB_MISMATCH");
    } else if (target === "staging") {
      if (actual !== "staging") {
        blockCodes.push(
          actual === "other" ? "UNKNOWN_DB_IDENTITY" : "TARGET_DB_MISMATCH",
        );
      }
    } else if (target === "local") {
      if (actual !== "local") blockCodes.push("TARGET_DB_MISMATCH");
    } else {
      // preview：local 或（未识别远程 + 显式 isolated 标记，与 #76 口径一致）
      if (actual === "staging") {
        blockCodes.push("TARGET_DB_MISMATCH");
      } else if (actual === "other" && !isolatedMarkerPresent(env)) {
        blockCodes.push("UNKNOWN_DB_IDENTITY");
      }
    }
  }

  // ── 3) 运行时信号冲突（多信号，不靠 NODE_ENV 单判）──
  const nodeEnv = (env.NODE_ENV || "").trim().toLowerCase();
  const vercelEnv = (env.VERCEL_ENV || "").trim().toLowerCase();
  const qre = (env.QINGYAN_RUNTIME_ENV || "").trim().toLowerCase();
  const expectedPlane = (env.QINGYAN_EXPECTED_DB_PLANE || "")
    .trim()
    .toLowerCase();
  if (qre && (qre === "production") !== (target === "production")) {
    blockCodes.push("RUNTIME_SIGNAL_CONFLICT");
  }
  if (
    expectedPlane &&
    ((expectedPlane === "production") !== (target === "production") ||
      (expectedPlane === "staging" && target !== "staging"))
  ) {
    blockCodes.push("RUNTIME_SIGNAL_CONFLICT");
  }
  if (vercelEnv && (vercelEnv === "production") !== (target === "production")) {
    blockCodes.push("RUNTIME_SIGNAL_CONFLICT");
  }
  if (nodeEnv === "test" && target === "production" && req.apply) {
    // 测试上下文绝不允许对生产 apply（该场景属于 assertSafeTestDatabase 管辖）
    blockCodes.push("RUNTIME_SIGNAL_CONFLICT");
  }

  // ── 4) org scope：租户操作必须显式 orgId + 组织名 ──
  if (req.scope.kind === "org") {
    if (!req.scope.orgId.trim() || !req.scope.orgName.trim()) {
      blockCodes.push("MISSING_ORG_SCOPE");
    }
  }

  // ── 5) 操作流程门禁 ──
  const isWrite = WRITE_TYPES.has(req.operationType);
  let allowMode: ProductionOperationAllowMode | null = null;
  let writeAllowed = false;
  let expectedConfirmationPhrase: string | null = null;

  if (isWrite) {
    expectedConfirmationPhrase = buildOperationConfirmationPhrase(
      target,
      req.operationName,
      req.estimatedImpact,
      req.noSafeDryRun ?? false,
    );
  }

  if (!isWrite) {
    allowMode = "READ_ONLY_VERIFIED";
  } else if (!req.apply) {
    allowMode = "DRY_RUN_ONLY";
  } else {
    // apply：dry-run 前置 + operation-specific confirmation
    if (!req.dryRunCompleted && !req.noSafeDryRun) {
      blockCodes.push("REQUIRE_DRY_RUN_FIRST");
    }
    const token = (
      req.confirmationToken ??
      env.PRODUCTION_OPERATION_CONFIRM ??
      ""
    ).trim();
    if (!token) {
      blockCodes.push("CONFIRMATION_REQUIRED");
    } else if (token !== expectedConfirmationPhrase) {
      blockCodes.push("CONFIRMATION_MISMATCH");
    }
    if (blockCodes.length === 0) {
      allowMode = "WRITE_ALLOWED";
      writeAllowed = true;
    }
  }

  const safe = blockCodes.length === 0;
  if (!safe) {
    allowMode = null;
    writeAllowed = false;
  }

  return {
    safe,
    allowMode,
    writeAllowed,
    blockCodes,
    targetEnvironment: target,
    actualDbPlane: actual,
    databaseHost: database.host,
    databaseName: database.database,
    expectedConfirmationPhrase,
    modeDescription: safe
      ? (allowMode as string)
      : `blocked (${blockCodes.join(", ")})`,
  };
}

function describeImpact(impact: OperationImpact): string {
  if (impact.kind === "known") {
    return `${impact.rows} rows${impact.summary ? ` — ${impact.summary}` : ""}`;
  }
  if (impact.kind === "unknown") return `IMPACT_UNKNOWN (${impact.reason})`;
  return "n/a (read-only)";
}

function describeScope(scope: OperationScope): string {
  if (scope.kind === "org") {
    return `Organization: ${scope.orgName} (${scope.orgId})`;
  }
  return `GLOBAL — ${scope.reason}`;
}

function printOperationReport(
  req: ProductionOperationRequest,
  verdict: ProductionOperationVerdict,
): void {
  const out = verdict.safe ? console.log : console.error;
  const line = "═".repeat(55);
  out(line);
  out("PRODUCTION OPERATION GUARD");
  out(`Operation: ${req.operationName} (${req.operationType})`);
  out(`Script: ${req.scriptName}`);
  out(`Target: ${verdict.targetEnvironment}`);
  out(`Host: ${verdict.databaseHost ?? "(unresolved)"}`);
  out(`Database: ${verdict.databaseName ?? "(unresolved)"}`);
  out(`DB Plane: ${verdict.actualDbPlane}`);
  out(describeScope(req.scope));
  out(`Estimated impact: ${describeImpact(req.estimatedImpact)}`);
  out(`Dry Run: ${req.apply ? "NO (--apply)" : "YES (default)"}`);
  if (req.noSafeDryRun) out("NO_SAFE_DRY_RUN: 该操作无法安全 dry-run");
  // 绝不回显操作者提供的 token 值
  const provided = Boolean(
    (req.confirmationToken ?? (req.env ?? process.env).PRODUCTION_OPERATION_CONFIRM ?? "").trim(),
  );
  out(`Confirmation: ${provided ? "provided" : "absent"}`);
  out(`Mode: ${verdict.modeDescription}`);
  out(`WRITE_ALLOWED = ${verdict.writeAllowed ? "YES" : "NO"}`);
  if (
    verdict.safe &&
    verdict.allowMode === "DRY_RUN_ONLY" &&
    verdict.expectedConfirmationPhrase
  ) {
    out(
      `To apply: 重跑并加 --apply，且 PRODUCTION_OPERATION_CONFIRM=${verdict.expectedConfirmationPhrase}`,
    );
  }
  out(line);
}

function emitAuditLog(
  req: ProductionOperationRequest,
  verdict: ProductionOperationVerdict,
): void {
  // V1 审计：structured log（脚本输出即 artifact），不新增 DB 模型。
  // 只含 host/database/operation/org/impact，不含连接串或 token。
  let user = "unknown";
  try {
    user = os.userInfo().username;
  } catch {
    // 某些受限环境拿不到用户名，保持 unknown
  }
  const record = {
    at: new Date().toISOString(),
    user,
    operation: req.operationName,
    operationType: req.operationType,
    script: req.scriptName,
    target: verdict.targetEnvironment,
    dbHost: verdict.databaseHost,
    dbName: verdict.databaseName,
    dbPlane: verdict.actualDbPlane,
    scope:
      req.scope.kind === "org"
        ? { kind: "org", orgId: req.scope.orgId, orgName: req.scope.orgName }
        : { kind: "global", reason: req.scope.reason },
    impact: describeImpact(req.estimatedImpact),
    apply: req.apply,
    result: verdict.safe ? verdict.allowMode : verdict.blockCodes,
  };
  const emit = verdict.safe ? console.log : console.error;
  emit(`[production-operation-audit] ${JSON.stringify(record)}`);
}

/**
 * 写入前的统一断言：打印操作报告 + 审计日志；未获授权时抛
 * ProductionOperationGuardError（进程非零退出）。
 */
export function assertProductionOperationAllowed(
  req: ProductionOperationRequest,
): ProductionOperationVerdict {
  const verdict = evaluateProductionOperation(req);
  printOperationReport(req, verdict);
  emitAuditLog(req, verdict);
  if (!verdict.safe) {
    throw new ProductionOperationGuardError(verdict);
  }
  return verdict;
}

/**
 * 脚本入口的目标预校验（在任何查询之前调用）：只验证 DB 身份 / 目标一致性 /
 * 运行时信号，不涉及 confirmation。dry-run 阶段的读查询也必须先过这一步。
 */
export function verifyOperationDatabaseTarget(
  params: {
    operationName: string;
    scriptName: string;
    targetEnvironment: OperationTargetEnvironment;
  },
  env: NodeJS.ProcessEnv = process.env,
): ProductionOperationVerdict {
  const verdict = evaluateProductionOperation({
    operationName: params.operationName,
    operationType: "READ_ONLY",
    targetEnvironment: params.targetEnvironment,
    scriptName: params.scriptName,
    scope: { kind: "global", reason: "target pre-verification (read-only)" },
    apply: false,
    dryRunCompleted: false,
    estimatedImpact: { kind: "not_applicable" },
    env,
  });
  if (!verdict.safe) {
    console.error(
      `[production-operation-guard] 目标预校验失败：${verdict.modeDescription}`,
    );
    throw new ProductionOperationGuardError(verdict);
  }
  return verdict;
}

/** 从 argv / env 读取操作者显式声明的目标环境（--target=xxx 优先）。 */
export function resolveDeclaredTargetEnvironment(
  argv: string[],
  env: NodeJS.ProcessEnv,
  fallback: OperationTargetEnvironment,
): OperationTargetEnvironment {
  const fromArg = argv
    .map((a) => /^--target=(.+)$/.exec(a)?.[1])
    .find(Boolean);
  const raw = (fromArg ?? env.PRODUCTION_OPERATION_TARGET ?? "")
    .trim()
    .toLowerCase();
  if (
    raw === "production" ||
    raw === "staging" ||
    raw === "preview" ||
    raw === "local"
  ) {
    return raw;
  }
  return fallback;
}
