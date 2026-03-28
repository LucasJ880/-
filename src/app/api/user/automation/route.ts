import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  getUserAutomationPrefs,
  updateUserAutomationPrefs,
} from "@/lib/proactive/automation-prefs";
import { ACTION_REGISTRY } from "@/lib/proactive/auto-actions";

/**
 * GET /api/user/automation — 获取用户自动化偏好 + 动作注册表
 * PATCH /api/user/automation — 更新用户自动化偏好
 */

export async function GET(request: NextRequest) {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const prefs = await getUserAutomationPrefs(user.id);

  return NextResponse.json({
    prefs,
    registry: ACTION_REGISTRY,
  });
}

export async function PATCH(request: NextRequest) {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const body = await request.json();
  const updated = await updateUserAutomationPrefs(user.id, body);

  return NextResponse.json({ prefs: updated });
}
