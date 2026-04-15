import { NextResponse } from "next/server";
import {
  getUserAutomationPrefs,
  updateUserAutomationPrefs,
} from "@/lib/proactive/automation-prefs";
import { ACTION_REGISTRY } from "@/lib/proactive/auto-actions";
import { withAuth } from "@/lib/common/api-helpers";

/**
 * GET /api/user/automation — 获取用户自动化偏好 + 动作注册表
 * PATCH /api/user/automation — 更新用户自动化偏好
 */

export const GET = withAuth(async (request, ctx, user) => {
  const prefs = await getUserAutomationPrefs(user.id);

  return NextResponse.json({
    prefs,
    registry: ACTION_REGISTRY,
  });
});

export const PATCH = withAuth(async (request, ctx, user) => {
  const body = await request.json();
  const updated = await updateUserAutomationPrefs(user.id, body);

  return NextResponse.json({ prefs: updated });
});
