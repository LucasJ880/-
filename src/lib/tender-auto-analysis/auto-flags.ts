/**
 * Phase D — 自动包分析编排开关
 *
 * TENDER_AUTO_PACKAGE_ANALYSIS_ENABLED：控制"文件夹上传完成 → Package Ready →
 * 自动入队一次 FULL 分析"的新编排路径。
 *
 * 默认 OFF：生产保持既有行为（上传路由内 per-file 入队，见 enqueue.ts），
 * 合入 main 不改变生产表现，直到人工在 staging/生产显式开启。
 *
 * ON（staging）时：
 *   - 上传路由内的 per-file 入队改为"只写 contentHash、不入队"（避免半包 churn）；
 *   - process-next 处理完成（done）后走 Package Ready 门 → 就绪才入队一次；
 *   - 幂等由 package fingerprint / idempotencyKey 保证（一个包一个活跃 run）。
 *
 * 沿用 flags.ts 的 envBool / WithEnv 纯函数 / describe 模式，不新建 flag 系统。
 */

export type TenderAutoFlagEnv = Record<string, string | undefined>;

function envBool(v: string | undefined): boolean {
  if (!v) return false;
  const s = v.trim().toLowerCase();
  return s === "1" || s === "true" || s === "on" || s === "yes";
}

function envList(v: string | undefined): string[] {
  if (!v) return [];
  return v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * 新编排是否启用。可选 org allowlist 收窄灰度（空 = 不额外限制）。
 */
export function isTenderAutoPackageAnalysisEnabledWithEnv(
  input: { orgId?: string | null },
  env: TenderAutoFlagEnv = process.env,
): boolean {
  if (!envBool(env.TENDER_AUTO_PACKAGE_ANALYSIS_ENABLED)) return false;
  const orgs = envList(env.TENDER_AUTO_PACKAGE_ANALYSIS_ORG_ALLOWLIST);
  if (orgs.length > 0) {
    const orgId = (input.orgId ?? "").trim();
    if (!orgId || !orgs.includes(orgId)) return false;
  }
  return true;
}

export function isTenderAutoPackageAnalysisEnabled(input: {
  orgId?: string | null;
}): boolean {
  return isTenderAutoPackageAnalysisEnabledWithEnv(input, process.env);
}

export function describeTenderAutoPackageFlag(): Record<string, unknown> {
  return {
    enabled: envBool(process.env.TENDER_AUTO_PACKAGE_ANALYSIS_ENABLED),
    orgAllowlist: envList(
      process.env.TENDER_AUTO_PACKAGE_ANALYSIS_ORG_ALLOWLIST,
    ),
  };
}
