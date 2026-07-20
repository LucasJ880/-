/**
 * 企业数字员工技能包总索引（Phase 1）
 */

import { MARKETING_GROWTH_SKILLS } from "./marketing-growth-seed";
import { SALES_ENTERPRISE_SKILLS } from "./sales-seed";
import { TENDER_ENTERPRISE_SKILLS } from "./tender-seed";
import type { EnterpriseSkillSeed } from "./enterprise-types";

export const ENTERPRISE_SKILLS: EnterpriseSkillSeed[] = [
  ...SALES_ENTERPRISE_SKILLS,
  ...MARKETING_GROWTH_SKILLS,
  ...TENDER_ENTERPRISE_SKILLS,
];

export const ENTERPRISE_SKILL_SLUGS = new Set(
  ENTERPRISE_SKILLS.map((s) => s.slug),
);

export function getEnterpriseSkillBySlug(
  slug: string,
): EnterpriseSkillSeed | undefined {
  return ENTERPRISE_SKILLS.find((s) => s.slug === slug);
}
