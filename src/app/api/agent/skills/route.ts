import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { getSkillsForOrchestrator } from "@/lib/agent/skills";

/**
 * GET /api/agent/skills
 * 返回可用技能列表（供模板编辑器选择步骤时使用）
 */
export const GET = withAuth(async () => {
  return NextResponse.json({ skills: getSkillsForOrchestrator() });
});
