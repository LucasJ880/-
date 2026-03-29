/**
 * 技能注册表 — 所有子智能体能力的统一注册中心
 */

import type { SkillDefinition, SkillDomain } from "../types";

const SKILL_REGISTRY = new Map<string, SkillDefinition>();

export function registerSkill(skill: SkillDefinition): void {
  if (SKILL_REGISTRY.has(skill.id)) {
    throw new Error(`Skill "${skill.id}" already registered`);
  }
  SKILL_REGISTRY.set(skill.id, skill);
}

export function getSkill(id: string): SkillDefinition | undefined {
  return SKILL_REGISTRY.get(id);
}

export function listSkills(domain?: SkillDomain): SkillDefinition[] {
  const all = Array.from(SKILL_REGISTRY.values());
  if (!domain) return all;
  return all.filter((s) => s.domain === domain);
}

/**
 * 为 Orchestrator prompt 提供精简的技能清单
 */
export function getSkillsForOrchestrator(): Array<{
  id: string;
  name: string;
  domain: string;
  description: string;
  riskLevel: string;
  requiresApproval: boolean;
}> {
  return Array.from(SKILL_REGISTRY.values()).map((s) => ({
    id: s.id,
    name: s.name,
    domain: s.domain,
    description: s.description,
    riskLevel: s.riskLevel,
    requiresApproval: s.requiresApproval,
  }));
}

export function getSkillCount(): number {
  return SKILL_REGISTRY.size;
}
