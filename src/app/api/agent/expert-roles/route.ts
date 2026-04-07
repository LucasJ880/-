import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { listExpertRoles } from "@/lib/ai/expert-roles";
import { getSkillsForOrchestrator } from "@/lib/agent/skills";

/**
 * GET /api/agent/expert-roles
 * 返回可用的专家角色 + 关联的 skill
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

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
}
