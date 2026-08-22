/** Quote & Cost Engine 主开关：default OFF（生产 dark）；沿用 envBool 模式，不新建 flag 系统 */
function envBool(v: string | undefined): boolean {
  return ["1", "true", "on", "yes"].includes(String(v ?? "").trim().toLowerCase());
}
export function isQuoteEngineEnabledWithEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  return envBool(env.TENDER_QUOTE_ENGINE_ENABLED);
}
export function isQuoteEngineEnabled(): boolean {
  return isQuoteEngineEnabledWithEnv(process.env);
}
