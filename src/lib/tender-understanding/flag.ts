/**
 * Tender Understanding V2 — Feature Flag
 *
 * TENDER_ANALYSIS_V2_ENABLED：
 * - production default = OFF（未设置 = 关）
 * - staging / local evaluation 可显式开启
 *
 * Release Gate（Confirmed Golden + §43 指标）通过前，V2 不替代正式用户路径；
 * 当前阶段 V2 仅通过 benchmark lane 与 shadow 脚本运行（零生产路由接线）。
 */

function envBool(v: string | undefined): boolean {
  if (!v) return false;
  const s = v.trim().toLowerCase();
  return s === "1" || s === "true" || s === "on" || s === "yes";
}

export function isTenderAnalysisV2Enabled(): boolean {
  return envBool(process.env.TENDER_ANALYSIS_V2_ENABLED);
}

export function describeTenderV2Flag(): Record<string, unknown> {
  return {
    flag: "TENDER_ANALYSIS_V2_ENABLED",
    enabled: isTenderAnalysisV2Enabled(),
    productionDefault: "OFF",
    mode: "SHADOW_EVALUATION_ONLY",
  };
}
