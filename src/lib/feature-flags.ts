// ============================================================
// Feature Flags — 灰度开关
// ============================================================
//
// PR2：主聊天入口 runAgent 化灰度控制
//
// 环境变量：
// - AI_OPERATOR_ENABLED      是否启用 operator 分支（"1" / "true" / "on"）
// - AI_OPERATOR_USER_ALLOWLIST  userId 白名单，逗号分隔；为空则按 ROLLOUT 生效
// - AI_OPERATOR_ROLE_ALLOWLIST  role 白名单，逗号分隔，如 "admin,sales"
// - AI_OPERATOR_ROLLOUT_PCT  百分比灰度（0-100）；仅在 allowlist 为空时生效
//
// 判定顺序：
// 1. 总开关 AI_OPERATOR_ENABLED 未开 → 全部回到 legacy
// 2. userId 在白名单 → 开
// 3. role 在白名单 → 开
// 4. 百分比灰度（userId 哈希后稳定分桶）
// ============================================================

function envBool(v: string | undefined): boolean {
  if (!v) return false;
  const s = v.trim().toLowerCase();
  return s === "1" || s === "true" || s === "on" || s === "yes";
}

function envList(v: string | undefined): string[] {
  if (!v) return [];
  return v.split(",").map((x) => x.trim()).filter(Boolean);
}

/** 稳定哈希（djb2） → [0, 100) 百分比桶 */
function userPercentBucket(userId: string): number {
  let h = 5381;
  for (let i = 0; i < userId.length; i++) {
    h = ((h << 5) + h + userId.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % 100;
}

export interface OperatorFlagInput {
  userId: string;
  role?: string | null;
}

export function isOperatorEnabled(input: OperatorFlagInput): boolean {
  if (!envBool(process.env.AI_OPERATOR_ENABLED)) return false;

  const userAllow = envList(process.env.AI_OPERATOR_USER_ALLOWLIST);
  if (userAllow.length > 0 && userAllow.includes(input.userId)) return true;

  const roleAllow = envList(process.env.AI_OPERATOR_ROLE_ALLOWLIST);
  if (roleAllow.length > 0 && input.role && roleAllow.includes(input.role)) {
    return true;
  }

  // allowlist 存在但未命中 → 走精确白名单语义，直接关
  if (userAllow.length > 0 || roleAllow.length > 0) return false;

  const pct = Number(process.env.AI_OPERATOR_ROLLOUT_PCT ?? "0");
  if (!Number.isFinite(pct) || pct <= 0) return false;
  if (pct >= 100) return true;

  return userPercentBucket(input.userId) < pct;
}

/** 供前端 / 调试使用：返回当前灰度配置的摘要 */
export function describeOperatorFlag(): Record<string, unknown> {
  return {
    enabled: envBool(process.env.AI_OPERATOR_ENABLED),
    userAllowlist: envList(process.env.AI_OPERATOR_USER_ALLOWLIST),
    roleAllowlist: envList(process.env.AI_OPERATOR_ROLE_ALLOWLIST),
    rolloutPct: Number(process.env.AI_OPERATOR_ROLLOUT_PCT ?? "0"),
  };
}
