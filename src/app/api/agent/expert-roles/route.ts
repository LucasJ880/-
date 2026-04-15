import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { listExpertRoles } from "@/lib/ai/expert-roles";
import { getSkillsForOrchestrator } from "@/lib/agent/skills";

/**
 * GET /api/agent/expert-roles
 * 返回可用的专家角色 + 关联的 skill
 */
export const GET = withAuth(async () => {
  const roles = listExpertRoles().map((r) => ({
    id: r.id,
    name: r.name,
    domain: r.domain,
  }));

  const skills = getSkillsForOrchestrator();

  const roleSkillMap: Record<string, string[]> = {};
  for (const skill of skills) {
    if (skill.expertRoleId) {
      if (!roleSkillMap[skill.expertRoleId]) roleSkillMap[skill.expertRoleId] = [];
      roleSkillMap[skill.expertRoleId].push(skill.name);
    }
  }

  const result = roles.map((r) => ({
    ...r,
    skills: roleSkillMap[r.id] ?? [],
  }));

  return NextResponse.json({ roles: result });
});
