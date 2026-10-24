/**
 * 签名 → 工艺单自动生成开关。
 * default OFF（fail-closed）：解析异常一律按关闭，绝不影响签约主路径可用性。
 * 沿用仓库既有 envBool 模式，不新建 flag 系统。
 */
function envBool(v: string | undefined): boolean {
  return ["1", "true", "on", "yes"].includes(String(v ?? "").trim().toLowerCase());
}

export function isWorkOrderAutogenEnabledWithEnv(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return envBool(env.SALES_WORKORDER_AUTOGEN_ENABLED);
}

export function isWorkOrderAutogenEnabled(): boolean {
  try {
    return isWorkOrderAutogenEnabledWithEnv(process.env);
  } catch {
    return false;
  }
}
