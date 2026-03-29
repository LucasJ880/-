import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getSkillsForOrchestrator } from "@/lib/agent/skills";

/**
 * GET /api/agent/skills
 * 返回可用技能列表（供模板编辑器选择步骤时使用）
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  return NextResponse.json({ skills: getSkillsForOrchestrator() });
}
