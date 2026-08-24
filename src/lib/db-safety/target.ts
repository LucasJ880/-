/**
 * B0（QYANE_DB_SAFETY）— 数据库目标识别（2026-08-24 生产 db push 事故防复发）。
 *
 * 单一生产注册表原则：生产/staging endpoint 前缀完全复用
 * src/lib/env/runtime-isolation.ts（classifyDbPlane），本模块不建立第二份名单。
 * 输出全程脱敏：只暴露 host / 库名 / endpointId，绝不返回用户名、密码、完整 URL。
 */

import { classifyDbPlane, extractDbEndpointPrefix, type DbPlane } from "@/lib/env/runtime-isolation";

export type DatabaseTargetEnvironment =
  | "local"
  | "production"
  | "staging"
  | "remote_other" // 远程非生产非 staging（如隔离测试分支）
  | "unknown"; // 缺失 / 无法解析 —— 破坏性命令 fail-closed

export interface DatabaseTargetIdentity {
  host: string | null;
  database: string | null;
  /** Neon endpoint id（去掉 -pooler），非 Neon 为 null */
  endpointId: string | null;
  pooled: boolean;
  environment: DatabaseTargetEnvironment;
  isProduction: boolean;
  /** 已知生产 endpoint 的 Neon 身份（用于告警展示；来源=事故取证记录） */
  projectId?: string;
  branchId?: string;
}

/**
 * 已知 Neon endpoint → 项目/分支身份（仅展示用途；authoritative 判定始终走
 * classifyDbPlane 的前缀名单）。2026-08-24 事故取证确认的生产身份。
 */
const KNOWN_NEON_ENDPOINT_IDENTITY: Record<string, { projectId: string; branchId: string }> = {
  "ep-super-field-antfibsl": {
    projectId: "polished-thunder-16018212",
    branchId: "br-green-boat-ann7k5yf",
  },
};

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);

function isLocalHost(host: string): boolean {
  const h = host.toLowerCase();
  return LOCAL_HOSTS.has(h) || h.endsWith(".local") || h.endsWith(".localhost");
}

/** 解析单条连接串为脱敏身份。传 undefined/空 → null（调用方按缺失处理）。 */
export function inspectDatabaseTarget(
  rawUrl: string | undefined | null,
  env: NodeJS.ProcessEnv = process.env,
): DatabaseTargetIdentity | null {
  const raw = rawUrl?.trim();
  if (!raw) return null;
  let host: string | null = null;
  let database: string | null = null;
  try {
    const u = new URL(raw.replace(/^postgres(ql)?:/i, "http:"));
    host = u.hostname || null;
    database = u.pathname.replace(/^\//, "") || null;
  } catch {
    // 解析失败：unknown（破坏性命令 fail-closed）
    return {
      host: null,
      database: null,
      endpointId: null,
      pooled: false,
      environment: "unknown",
      isProduction: false,
    };
  }
  if (!host) {
    return { host: null, database, endpointId: null, pooled: false, environment: "unknown", isProduction: false };
  }

  const endpointId = extractDbEndpointPrefix(raw);
  const pooled = host.toLowerCase().split(".")[0]?.endsWith("-pooler") ?? false;

  let environment: DatabaseTargetEnvironment;
  let plane: DbPlane | null = null;
  if (isLocalHost(host)) {
    environment = "local";
  } else {
    plane = classifyDbPlane(raw, env);
    environment =
      plane === "production" ? "production"
      : plane === "staging" ? "staging"
      : plane === "other" ? "remote_other"
      : "unknown";
  }

  const known = endpointId ? KNOWN_NEON_ENDPOINT_IDENTITY[endpointId] : undefined;
  return {
    host,
    database,
    endpointId,
    pooled,
    environment,
    isProduction: environment === "production",
    ...(known ? { projectId: known.projectId, branchId: known.branchId } : {}),
  };
}

/** 两条连接串是否指向同一逻辑目标（允许 pooled/direct 主机名差异）。 */
export function sameLogicalTarget(
  a: DatabaseTargetIdentity,
  b: DatabaseTargetIdentity,
): boolean {
  if (a.environment === "unknown" || b.environment === "unknown") return false;
  if (a.environment === "local" && b.environment === "local") {
    // 本地：主机等价即可（库名可不同实例但破坏性命令要求同库更稳妥）
    return (a.host ?? "") === (b.host ?? "") && (a.database ?? "") === (b.database ?? "");
  }
  if (a.endpointId && b.endpointId) return a.endpointId === b.endpointId;
  return a.host === b.host && a.database === b.database;
}
