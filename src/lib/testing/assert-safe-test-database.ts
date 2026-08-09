/**
 * Production Database Test Guard — 统一 fail-closed 测试库安全断言
 *
 * 背景（2026-08 事故）：governance smoke 回归在本地 shell source 了生产
 * `.env`（生产 DATABASE_URL）后以 NODE_ENV=test 直接运行，在生产库创建了
 * 测试配额策略并触发生产 AI 熔断。既有防线为何没拦住：
 *   - scripts/check-preview-db-isolation.ts 仅在 VERCEL_ENV=preview 激活，
 *     本地 shell（VERCEL_ENV 未设）直接 skip；
 *   - src/lib/env/runtime-isolation.ts 守的是 Next.js HTTP/side-effect 入口，
 *     standalone tsx 测试脚本直接调 service 层写库，完全绕过；
 *   - 个别脚本各自带 requireIsolated 检查，但事故脚本没有任何检查。
 *
 * 本模块提供所有 destructive 测试/脚本入口共用的单一断言：
 *   assertSafeTestDatabase() —— 不安全时打印安全报告并抛错（fail-closed）。
 *
 * 规则矩阵（严格执行）：
 *   - 生产库（已知生产 host/endpoint 前缀）→ 永远 BLOCK，任何信号组合
 *     （包括 opt-in token）都不能放行；
 *   - NODE_ENV=production 或 VERCEL_ENV=production → BLOCK；
 *   - DATABASE_URL / DIRECT_URL 缺失或无法解析 → BLOCK；
 *   - localhost / 127.0.0.1 / ::1 / host.docker.internal → ALLOW；
 *   - 非生产远程 host + 显式 DATABASE_ENVIRONMENT=isolated（既有约定，
 *     见 scripts/bid-workflow-cotton-iso-fixture.ts；TEST_DATABASE_MODE=isolated
 *     为等价别名）→ ALLOW；
 *   - 非生产远程 host + 显式 DANGEROUS_ALLOW_DB_TESTS=I_UNDERSTAND_THIS_CAN_DESTROY_DATA
 *     → ALLOW（打印高危警告；对生产库无效）；
 *   - 其余（无法识别的远程 host 且无显式隔离标记）→ BLOCK；
 *   - 绝不因 NODE_ENV !== "production" 单一信号放行。
 *
 * 约束：
 *   - 本模块只能被测试 / scripts 入口引用，禁止进入 Next.js 应用运行时代码路径；
 *   - 绝不打印连接串 / 密码，只打印 host 与 database 名。
 *
 * 生产 host 名单需与以下既有常量保持一致（三处共同的真源是 Neon 生产
 * project polished-thunder-16018212 主分支 endpoint）：
 *   - src/lib/env/runtime-isolation.ts DEFAULT_PRODUCTION_DB_ENDPOINT_PREFIXES
 *   - scripts/check-preview-db-isolation.ts PRODUCTION_NEON_HOST_PREFIX
 */

import { parse as parsePgUrl } from "node:url";

/**
 * 已知生产 endpoint 前缀（Neon endpoint id，公开 host 标识，非机密）。
 * 匹配规则：hostname 第一段去掉 -pooler 后缀后做前缀匹配，
 * 因此同时覆盖 Vercel 生产在用的两种形态：
 *   ep-super-field-antfibsl-pooler.c-6.us-east-1.aws.neon.tech （pooler）
 *   ep-super-field-antfibsl.c-6.us-east-1.aws.neon.tech         （direct）
 */
export const KNOWN_PRODUCTION_DB_ENDPOINT_PREFIXES = [
  "ep-super-field-antfibsl",
] as const;

/** 明确视为本地测试库的 host。 */
export const LOCAL_DB_HOSTS = [
  "localhost",
  "127.0.0.1",
  "::1",
  "0.0.0.0",
  "host.docker.internal",
] as const;

/** 高危 opt-in token（仅对非生产远程库生效，生产库永远 BLOCK）。 */
export const DANGEROUS_OPT_IN_TOKEN = "I_UNDERSTAND_THIS_CAN_DESTROY_DATA";

export type DbHostClass = "production" | "local" | "remote" | "unresolved";

export type TestDatabaseBlockCode =
  | "PRODUCTION_DATABASE_HOST"
  | "PRODUCTION_RUNTIME_ENV"
  | "MISSING_DATABASE_URL"
  | "MALFORMED_DATABASE_URL"
  | "UNKNOWN_REMOTE_HOST_WITHOUT_ISOLATION";

export type TestDatabaseAllowMode =
  | "LOCAL_DATABASE"
  | "ISOLATED_REMOTE_DATABASE"
  | "DANGEROUS_EXPLICIT_OPT_IN";

export type TestDatabaseSafetyVerdict = {
  safe: boolean;
  /** safe=true 时的放行模式 */
  allowMode: TestDatabaseAllowMode | null;
  /** safe=false 时的阻断码（第一条命中） */
  blockCodes: TestDatabaseBlockCode[];
  nodeEnv: string;
  vercelEnv: string;
  /** DATABASE_URL host（解析失败为 null） */
  databaseHost: string | null;
  /** DIRECT_URL host（未配置/解析失败为 null） */
  directHost: string | null;
  databaseName: string | null;
  /** 判定依据的人类可读描述（用于安全报告 Mode 行） */
  modeDescription: string;
};

export class TestDatabaseSafetyError extends Error {
  readonly verdict: TestDatabaseSafetyVerdict;
  constructor(verdict: TestDatabaseSafetyVerdict) {
    super(
      `BLOCKED: 当前 DATABASE_URL 不允许运行 destructive 测试（${verdict.blockCodes.join(", ")}）`,
    );
    this.name = "TestDatabaseSafetyError";
    this.verdict = verdict;
  }
}

type UrlInspect =
  | { kind: "missing"; host: null; database: null }
  | { kind: "malformed"; host: null; database: null }
  | { kind: "ok"; host: string; database: string | null };

function inspectDbUrl(url: string | undefined): UrlInspect {
  const raw = (url ?? "").trim();
  if (!raw) return { kind: "missing", host: null, database: null };
  try {
    const u = new URL(raw);
    if (!u.hostname) return { kind: "malformed", host: null, database: null };
    return {
      kind: "ok",
      host: u.hostname.toLowerCase(),
      database: u.pathname.replace(/^\//, "") || null,
    };
  } catch {
    try {
      const u = parsePgUrl(raw);
      if (!u.hostname) {
        return { kind: "malformed", host: null, database: null };
      }
      return {
        kind: "ok",
        host: u.hostname.toLowerCase(),
        database: (u.pathname ?? "").replace(/^\//, "") || null,
      };
    } catch {
      return { kind: "malformed", host: null, database: null };
    }
  }
}

function productionEndpointPrefixes(env: NodeJS.ProcessEnv): string[] {
  // 与 runtime-isolation.ts 一致：允许通过环境变量追加（只增不减，fail-closed 方向）
  const extra = (env.QINGYAN_PRODUCTION_DB_ENDPOINT_PREFIXES || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return [
    ...KNOWN_PRODUCTION_DB_ENDPOINT_PREFIXES.map((s) => s.toLowerCase()),
    ...extra,
  ];
}

export function classifyDbHost(
  host: string | null,
  env: NodeJS.ProcessEnv = process.env,
): DbHostClass {
  if (!host) return "unresolved";
  const lowered = host.toLowerCase();
  const firstLabel = (lowered.split(".")[0] || "").replace(/-pooler$/, "");
  if (
    productionEndpointPrefixes(env).some(
      (p) => firstLabel === p || firstLabel.startsWith(p),
    )
  ) {
    return "production";
  }
  if ((LOCAL_DB_HOSTS as readonly string[]).includes(lowered)) {
    return "local";
  }
  return "remote";
}

function isolatedMarkerPresent(env: NodeJS.ProcessEnv): boolean {
  const canonical = (env.DATABASE_ENVIRONMENT || "").trim().toLowerCase();
  const alias = (env.TEST_DATABASE_MODE || "").trim().toLowerCase();
  return canonical === "isolated" || alias === "isolated";
}

function dangerousOptInPresent(env: NodeJS.ProcessEnv): boolean {
  return (env.DANGEROUS_ALLOW_DB_TESTS || "").trim() === DANGEROUS_OPT_IN_TOKEN;
}

/**
 * 纯函数评估：不读全局、不打印、不抛错，便于单元测试。
 */
export function evaluateTestDatabaseSafety(
  env: NodeJS.ProcessEnv = process.env,
): TestDatabaseSafetyVerdict {
  const nodeEnv = (env.NODE_ENV || "").trim().toLowerCase();
  const vercelEnv = (env.VERCEL_ENV || "").trim().toLowerCase();
  const database = inspectDbUrl(env.DATABASE_URL);
  const direct = inspectDbUrl(env.DIRECT_URL);

  const blockCodes: TestDatabaseBlockCode[] = [];

  // 1) 运行环境信号：生产运行时永远不允许 destructive 测试
  if (nodeEnv === "production" || vercelEnv === "production") {
    blockCodes.push("PRODUCTION_RUNTIME_ENV");
  }

  // 2) URL 存在性 / 可解析性（fail-closed：解析不出来就不放行）
  if (database.kind === "missing") blockCodes.push("MISSING_DATABASE_URL");
  if (database.kind === "malformed") blockCodes.push("MALFORMED_DATABASE_URL");
  // DIRECT_URL 可以缺省（部分脚本只用 DATABASE_URL），但配置了就必须可解析
  if (direct.kind === "malformed") {
    blockCodes.push("MALFORMED_DATABASE_URL");
  }

  // 3) 生产库识别：DATABASE_URL / DIRECT_URL 任一命中已知生产 endpoint 即 BLOCK
  const dbClass = classifyDbHost(database.host, env);
  const directClass =
    direct.kind === "missing" ? null : classifyDbHost(direct.host, env);
  if (dbClass === "production" || directClass === "production") {
    blockCodes.push("PRODUCTION_DATABASE_HOST");
  }

  const isolated = isolatedMarkerPresent(env);
  const dangerous = dangerousOptInPresent(env);

  let allowMode: TestDatabaseAllowMode | null = null;
  let modeDescription: string;

  if (blockCodes.length > 0) {
    modeDescription = `blocked (${blockCodes.join(", ")})`;
  } else {
    // 到这里：URL 可解析、host 非生产、运行环境非 production。
    // DIRECT_URL（若配置）与 DATABASE_URL 取较严格分类判定。
    const worst: DbHostClass =
      dbClass === "remote" || directClass === "remote" ? "remote" : dbClass;
    if (worst === "local") {
      allowMode = "LOCAL_DATABASE";
      modeDescription = "local database host";
    } else if (isolated) {
      allowMode = "ISOLATED_REMOTE_DATABASE";
      modeDescription =
        "DATABASE_ENVIRONMENT=isolated (explicit isolated test branch)";
    } else if (dangerous) {
      allowMode = "DANGEROUS_EXPLICIT_OPT_IN";
      modeDescription =
        "DANGEROUS_ALLOW_DB_TESTS explicit opt-in (non-production host)";
    } else {
      blockCodes.push("UNKNOWN_REMOTE_HOST_WITHOUT_ISOLATION");
      modeDescription =
        "blocked (remote host not recognized as isolated test database)";
    }
  }

  return {
    safe: blockCodes.length === 0,
    allowMode,
    blockCodes,
    nodeEnv: nodeEnv || "-",
    vercelEnv: vercelEnv || "-",
    databaseHost: database.host,
    directHost: direct.host,
    databaseName: database.database,
    modeDescription,
  };
}

function printSafetyReport(
  verdict: TestDatabaseSafetyVerdict,
  scriptName: string | undefined,
): void {
  const line = "═".repeat(55);
  const out = verdict.safe ? console.log : console.error;
  out(line);
  out(`DATABASE SAFETY CHECK${scriptName ? ` — ${scriptName}` : ""}`);
  out(
    `Environment: NODE_ENV=${verdict.nodeEnv} / VERCEL_ENV=${verdict.vercelEnv}`,
  );
  out(`Host: ${verdict.databaseHost ?? "(unresolved)"}`);
  if (verdict.directHost && verdict.directHost !== verdict.databaseHost) {
    out(`Direct host: ${verdict.directHost}`);
  }
  out(`Database: ${verdict.databaseName ?? "(unresolved)"}`);
  out(`Mode: ${verdict.modeDescription}`);
  out(`SAFE_TO_TEST = ${verdict.safe ? "YES" : "NO"}`);
  if (verdict.safe && verdict.allowMode === "DANGEROUS_EXPLICIT_OPT_IN") {
    out(
      "⚠️  WARNING: 通过 DANGEROUS_ALLOW_DB_TESTS 放行，未验证隔离标记，数据可能被破坏",
    );
  }
  out(line);
}

/**
 * destructive 测试 / 脚本入口的统一断言。
 * 不安全时打印安全报告并抛出 TestDatabaseSafetyError（进程以非零退出）。
 */
export function assertSafeTestDatabase(options?: {
  scriptName?: string;
  env?: NodeJS.ProcessEnv;
}): TestDatabaseSafetyVerdict {
  const verdict = evaluateTestDatabaseSafety(options?.env ?? process.env);
  printSafetyReport(verdict, options?.scriptName);
  if (!verdict.safe) {
    throw new TestDatabaseSafetyError(verdict);
  }
  return verdict;
}
