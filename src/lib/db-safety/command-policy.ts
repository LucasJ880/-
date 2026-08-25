/**
 * B0 — 破坏性数据库命令策略引擎（纯函数，fail-closed）。
 *
 * 事故不变量（2026-08-24 prisma db push 打到生产）：
 * 1. DATABASE_URL / DIRECT_URL 必须解析到同一逻辑目标（pooled/direct 允许），
 *    任一为生产而另一不是 → BLOCKED_DATABASE_TARGET_MISMATCH（正是事故形态）。
 * 2. `prisma db push` 对生产 **永远阻断**（break-glass 也不放行）；
 *    `--accept-data-loss` + 生产 → 同为硬阻断（更明确的错误码）。
 * 3. migrate dev / migrate reset 对生产与 staging 永远阻断。
 * 4. migrate deploy 对生产仅在显式 break-glass（一次性工单 token，非常驻布尔）
 *    下通过预检（实际生产 deploy 仍走既有 scripts/safe-migrate-deploy.ts 约定）。
 * 5. 任何目标不可解析 → 破坏性命令阻断。
 */

import {
  inspectDatabaseTarget,
  sameLogicalTarget,
  type DatabaseTargetIdentity,
} from "./target";

export type DbSafeCommand =
  | "db_push"
  | "migrate_dev"
  | "migrate_reset"
  | "migrate_deploy"
  | "target_check";

export type DbPolicyCode =
  | "ALLOWED"
  | "ALLOWED_WITH_BREAK_GLASS"
  | "BLOCKED_DATABASE_TARGET_MISMATCH"
  | "BLOCKED_UNKNOWN_TARGET"
  | "BLOCKED_PRODUCTION_DB_PUSH"
  | "BLOCKED_PRODUCTION_DB_PUSH_ACCEPT_DATA_LOSS"
  | "BLOCKED_PRODUCTION_MIGRATE_DEV"
  | "BLOCKED_PRODUCTION_MIGRATE_RESET"
  | "BLOCKED_STAGING_DESTRUCTIVE"
  | "BLOCKED_MISSING_BREAK_GLASS"
  | "BLOCKED_INVALID_BREAK_GLASS";

export interface DbPolicyDecision {
  allowed: boolean;
  code: DbPolicyCode;
  reason: string;
  databaseTarget: DatabaseTargetIdentity | null;
  directTarget: DatabaseTargetIdentity | null;
}

/** 常驻布尔形状一律拒绝；token 必须是 ≥8 位的一次性工单标识。 */
const FORBIDDEN_TOKEN_SHAPES = new Set(["true", "false", "1", "0", "yes", "no", "on", "off", "y", "n"]);
export function validateBreakGlassToken(token: string | undefined | null):
  | { ok: true }
  | { ok: false; code: "BLOCKED_MISSING_BREAK_GLASS" | "BLOCKED_INVALID_BREAK_GLASS"; reason: string } {
  const t = token?.trim() ?? "";
  if (!t) {
    return {
      ok: false,
      code: "BLOCKED_MISSING_BREAK_GLASS",
      reason: "生产目标需要一次性 break-glass：ALLOW_PRODUCTION_DB_MUTATION=<工单专用 token>",
    };
  }
  if (FORBIDDEN_TOKEN_SHAPES.has(t.toLowerCase()) || t.length < 8) {
    return {
      ok: false,
      code: "BLOCKED_INVALID_BREAK_GLASS",
      reason: "break-glass token 不接受常驻布尔（true/1/yes…）且长度须 ≥8——请使用工单/变更专用 token",
    };
  }
  return { ok: true };
}

export function evaluateDbCommandPolicy(input: {
  command: DbSafeCommand;
  acceptDataLoss?: boolean;
  databaseUrl: string | undefined;
  directUrl: string | undefined;
  breakGlassToken?: string | undefined;
  env?: NodeJS.ProcessEnv;
}): DbPolicyDecision {
  const env = input.env ?? process.env;
  const db = inspectDatabaseTarget(input.databaseUrl, env);
  const direct = inspectDatabaseTarget(input.directUrl, env);
  const base = { databaseTarget: db, directTarget: direct };
  const destructive = input.command !== "target_check";

  // target_check 只报告，不放行/阻断由调用方按 mismatch 决定退出码
  const pairProblem = ((): DbPolicyDecision | null => {
    if (!db && !direct) {
      return { allowed: false, code: "BLOCKED_UNKNOWN_TARGET", reason: "DATABASE_URL 与 DIRECT_URL 均缺失", ...base };
    }
    // Prisma schema 声明了 directUrl：破坏性 DDL 实际走 DIRECT_URL。
    // 任一缺失即无法证明目标一致 → fail-closed。
    if (!db || !direct) {
      return {
        allowed: false,
        code: "BLOCKED_UNKNOWN_TARGET",
        reason: `${!db ? "DATABASE_URL" : "DIRECT_URL"} 缺失——无法证明目标一致（Prisma CLI 的 DDL 以 DIRECT_URL 为准）`,
        ...base,
      };
    }
    if (db.environment === "unknown" || direct.environment === "unknown") {
      return { allowed: false, code: "BLOCKED_UNKNOWN_TARGET", reason: "连接串无法解析，破坏性命令 fail-closed", ...base };
    }
    if (!sameLogicalTarget(db, direct)) {
      return {
        allowed: false,
        code: "BLOCKED_DATABASE_TARGET_MISMATCH",
        reason: `DATABASE_URL(${db.environment}:${db.endpointId ?? db.host}) 与 DIRECT_URL(${direct.environment}:${direct.endpointId ?? direct.host}) 指向不同目标——2026-08-24 事故正是此形态`,
        ...base,
      };
    }
    return null;
  })();

  if (destructive && pairProblem) return pairProblem;
  if (!destructive) {
    // target_check：mismatch/unknown 同样要以非零退出（复用上面的判定）
    if (pairProblem) return pairProblem;
    return { allowed: true, code: "ALLOWED", reason: "目标一致", ...base };
  }

  // 到这里 db/direct 已知且一致
  const target = direct!; // DDL 以 direct 为准
  switch (input.command) {
    case "db_push": {
      if (target.isProduction) {
        return {
          allowed: false,
          code: input.acceptDataLoss
            ? "BLOCKED_PRODUCTION_DB_PUSH_ACCEPT_DATA_LOSS"
            : "BLOCKED_PRODUCTION_DB_PUSH",
          reason: "生产库禁止 prisma db push（break-glass 亦不放行）；生产 schema 变更只能走 migrations（scripts/safe-migrate-deploy.ts）",
          ...base,
        };
      }
      if (target.environment === "staging") {
        return { allowed: false, code: "BLOCKED_STAGING_DESTRUCTIVE", reason: "staging 走 migrations，不接受 db push", ...base };
      }
      return { allowed: true, code: "ALLOWED", reason: `db push → ${target.environment}`, ...base };
    }
    case "migrate_dev":
    case "migrate_reset": {
      if (target.isProduction) {
        return {
          allowed: false,
          code: input.command === "migrate_dev" ? "BLOCKED_PRODUCTION_MIGRATE_DEV" : "BLOCKED_PRODUCTION_MIGRATE_RESET",
          reason: "生产库禁止 migrate dev / reset（永不放行）",
          ...base,
        };
      }
      if (target.environment === "staging") {
        return { allowed: false, code: "BLOCKED_STAGING_DESTRUCTIVE", reason: "staging 为持久环境，禁止 dev/reset", ...base };
      }
      return { allowed: true, code: "ALLOWED", reason: `${input.command} → ${target.environment}`, ...base };
    }
    case "migrate_deploy": {
      if (target.isProduction) {
        const bg = validateBreakGlassToken(input.breakGlassToken);
        if (!bg.ok) return { allowed: false, code: bg.code, reason: bg.reason, ...base };
        return {
          allowed: true,
          code: "ALLOWED_WITH_BREAK_GLASS",
          reason: "生产 migrate deploy 预检通过（一次性 break-glass）；实际执行仍须遵循 safe-migrate-deploy 运行手册",
          ...base,
        };
      }
      return { allowed: true, code: "ALLOWED", reason: `migrate deploy → ${target.environment}`, ...base };
    }
    default:
      // 未知命令 fail-closed（类型上不可达，运行时兜底）
      return { allowed: false, code: "BLOCKED_UNKNOWN_TARGET", reason: `未知命令 ${String(input.command)}`, ...base };
  }
}

/** 脱敏目标行（供 CLI 打印；绝无凭据） */
export function formatTargetLine(label: string, t: DatabaseTargetIdentity | null): string {
  if (!t) return `${label}: (缺失)`;
  const idBits = [
    `environment: ${t.environment}`,
    `host: ${t.host ?? "(unparsed)"}`,
    t.endpointId ? `endpoint: ${t.endpointId}${t.pooled ? " (pooled)" : ""}` : null,
    t.projectId ? `project: ${t.projectId}` : null,
    t.branchId ? `branch: ${t.branchId}` : null,
    t.database ? `database: ${t.database}` : null,
  ].filter(Boolean);
  return `${label}:\n  ${idBits.join("\n  ")}`;
}
