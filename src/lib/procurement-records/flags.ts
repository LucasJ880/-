/**
 * PROC-1 生产激活闸（与 T4 `award-flags.ts` 同型，fail-closed）
 *
 *   PROCUREMENT_RECORDS_SCHEMA_READY —
 *     迁移 20261105120000_add_procurement_records_foundation 的 16 张表在当前环境已存在且允许访问。
 *
 * 关（缺省）时：
 *   - `/api/procurement/**` 读接口返回 `{ available:false, reason:"SCHEMA_NOT_READY" }`，写接口 503 同一 reason；
 *   - `tender-watch` cron 的采购监控步骤跳过；
 *   - 对新表零访问（不因缺表 500）。
 * 置位前置：见 openspec/changes/procurement-records-requests/design.md「Migration Plan」。
 */

export const PROCUREMENT_SCHEMA_FLAG = "PROCUREMENT_RECORDS_SCHEMA_READY" as const;
export const SCHEMA_NOT_READY = "SCHEMA_NOT_READY" as const;

function envBool(v: string | undefined): boolean {
  if (!v) return false;
  const s = v.trim().toLowerCase();
  return s === "1" || s === "true" || s === "on" || s === "yes";
}

export function isProcurementSchemaReadyWithEnv(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return envBool(env[PROCUREMENT_SCHEMA_FLAG]);
}

/** 所有新表访问站点必须先过本闸（解析异常一律按关处理）。 */
export function isProcurementSchemaReady(): boolean {
  try {
    return isProcurementSchemaReadyWithEnv();
  } catch {
    return false;
  }
}
