import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { scanProjectsForUser } from "@/lib/proactive/scanner";
import { scanSalesForUser } from "@/lib/proactive/sales-scanner";
import { syncSuggestionsToNotifications } from "@/lib/proactive/notify";
import { executeAutoActions } from "@/lib/proactive/auto-actions";
import { getUserAutomationEnabled } from "@/lib/proactive/automation-prefs";

/**
 * POST /api/proactive/scan
 *
 * 触发一次主动扫描，返回当前用户所有活跃项目的建议列表。
 * 同时将 urgent/warning 建议写入通知系统。
 * 如果用户启用了自动化，低风险动作会自动执行。
 * 前端在工作台加载时调用，也可由定时任务调用。
 */
export async function POST(request: NextRequest) {
  const user = await getCurrentUser(request);
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const [projectResult, salesSuggestions] = await Promise.all([
    scanProjectsForUser(user.id, user.role),
    scanSalesForUser(user.id),
  ]);

  const result = {
    ...projectResult,
    suggestions: [...projectResult.suggestions, ...salesSuggestions],
  };

  const [notificationsCreated, autoEnabled] = await Promise.all([
    syncSuggestionsToNotifications(user.id, result.suggestions),
    getUserAutomationEnabled(user.id),
  ]);

  let autoActions: { actionType: string; success: boolean; message: string; createdEntityId?: string }[] = [];
  if (autoEnabled) {
    const raw = await executeAutoActions(user.id, result.suggestions);
    autoActions = raw.map((r) => ({
      actionType: r.actionType,
      success: r.success,
      message: r.message,
      createdEntityId: r.createdEntityId,
    }));
  }

  return NextResponse.json({
    ...result,
    notificationsCreated,
    autoActions,
    automationEnabled: autoEnabled,
  });
}
