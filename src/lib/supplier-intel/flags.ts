/**
 * Supplier Intelligence 主开关：default OFF（生产 dark）。
 * 沿用仓库 canonical 四符号 flag 模式（envBool/envList/…WithEnv/describe），不新建 flag 系统。
 * 组合语义：主开关关 → 全关；ORG_ALLOWLIST 非空且 orgId 不在其中 → 关；空 allowlist → 不加限制。
 * 层 B 外呼是另一道独立门（TENDER_EXTERNAL_INTEL_ENABLED + TAVILY_API_KEY），本 flag 不代开。
 */

function envBool(v: string | undefined): boolean {
  return ["1", "true", "on", "yes"].includes(String(v ?? "").trim().toLowerCase());
}

function envList(v: string | undefined): string[] {
  return String(v ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function isSupplierIntelEnabledWithEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  return envBool(env.SUPPLIER_INTEL_ENABLED);
}

export function isSupplierIntelEnabled(): boolean {
  return isSupplierIntelEnabledWithEnv(process.env);
}

export function isSupplierIntelEnabledForOrgWithEnv(
  orgId: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!isSupplierIntelEnabledWithEnv(env)) return false;
  const allowlist = envList(env.SUPPLIER_INTEL_ORG_ALLOWLIST);
  if (allowlist.length === 0) return true;
  return allowlist.includes(orgId);
}

export function isSupplierIntelEnabledForOrg(orgId: string): boolean {
  return isSupplierIntelEnabledForOrgWithEnv(orgId, process.env);
}

export function describeSupplierIntelFlags(
  env: NodeJS.ProcessEnv = process.env,
): Record<string, unknown> {
  return {
    SUPPLIER_INTEL_ENABLED: isSupplierIntelEnabledWithEnv(env),
    SUPPLIER_INTEL_ORG_ALLOWLIST: envList(env.SUPPLIER_INTEL_ORG_ALLOWLIST),
  };
}
