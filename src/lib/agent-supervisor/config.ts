/**
 * Supervisor 运行预算与环境配置（不硬编码模型 Key）
 */

function envInt(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export function getSupervisorLimits() {
  return {
    maxSteps: envInt("SUPERVISOR_MAX_STEPS", 5),
    maxReplans: envInt("SUPERVISOR_MAX_REPLANS", 2),
    maxSkillCalls: envInt("SUPERVISOR_MAX_SKILL_CALLS", 6),
    timeoutMs: envInt("SUPERVISOR_TIMEOUT_MS", 120_000),
  };
}
