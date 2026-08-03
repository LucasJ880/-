/**
 * 组织级 Agent 自动化 Kill Switch
 *
 * 读取 Organization.modulesJson.agentAutomationEnabled
 * - 显式 false → 急停
 * - 缺省 / true → 允许（兼容旧配置）
 */

export function readAgentAutomationEnabled(modulesJson: unknown): boolean {
  if (!modulesJson || typeof modulesJson !== "object" || Array.isArray(modulesJson)) {
    return true;
  }
  const raw = (modulesJson as Record<string, unknown>).agentAutomationEnabled;
  if (raw === false || raw === "false" || raw === 0 || raw === "0") return false;
  return true;
}

export function isAgentAutomationKilled(modulesJson: unknown): boolean {
  return !readAgentAutomationEnabled(modulesJson);
}
