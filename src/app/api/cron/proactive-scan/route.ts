import { NextRequest, NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/cron/auth";
import { runTrackedAutomation } from "@/lib/automation/runner";
import { db } from "@/lib/db";
import { getUserAutomationPrefs } from "@/lib/proactive/automation-prefs";
import { runManagerNotify } from "@/lib/proactive/manager-notify";
import { runProactiveScanForUser } from "@/lib/proactive/run-scan";

/**
 * 每小时主动提醒（vercel.json `15 * * * *`）：
 * 1. 自动化一轮：开了自动化偏好的用户（最多 100 人），扫描 + 写通知 + 执行低风险自动动作；
 * 2. 管理层补发一轮（A-3b）：只扫描、只写通知、不执行自动动作，补上旧首页每 5 分钟扫描停掉后的提醒。
 */
export const maxDuration = 300;
/** 两轮合计的时间预算（留余量给 runTrackedAutomation 收尾） */
const RUN_BUDGET_MS = 240_000;

export async function GET(request: NextRequest) {
  const denied = requireCronSecret(request);
  if (denied) return denied;

  const data = await runTrackedAutomation("proactive-scan", async () => {
    const startedAt = Date.now();
    const preferences = await db.userNotificationPreference.findMany({
      where: { metadata: { not: null }, user: { status: "active" } },
      select: { userId: true, user: { select: { role: true } } },
      orderBy: { updatedAt: "asc" },
      take: 100,
    });
    const results: Array<{ userId: string; mode: "automation" | "notify_only"; suggestions?: number; actions?: number; notifications?: number; error?: string }> = [];

    for (const preference of preferences) {
      const prefs = await getUserAutomationPrefs(preference.userId);
      if (!prefs.enabled) continue;
      try {
        const result = await runProactiveScanForUser(preference.userId, preference.user.role);
        results.push({
          userId: preference.userId,
          mode: "automation",
          suggestions: result.suggestions.length,
          actions: result.autoActions.filter((action) => action.success).length,
        });
      } catch (error) {
        results.push({ userId: preference.userId, mode: "automation", error: error instanceof Error ? error.message : String(error) });
      }
    }
    const automationUsers = results.length;

    // 管理层补发：自动化一轮处理过的人不重复；用剩下的时间预算。单独兜错：补发出错不影响已完成的自动化一轮
    let managers: Awaited<ReturnType<typeof runManagerNotify>> = { results: [], planned: 0, stoppedByBudget: false };
    let notifyOnlyError: string | null = null;
    try {
      managers = await runManagerNotify({
        now: new Date(),
        alreadyScanned: new Set(results.map((r) => r.userId)),
        budgetMs: Math.max(0, RUN_BUDGET_MS - (Date.now() - startedAt)),
      });
    } catch (error) {
      notifyOnlyError = error instanceof Error ? error.message : String(error);
    }
    results.push(...managers.results);

    const failedCount = results.filter((result) => result.error).length;
    return {
      data: { scannedAt: new Date().toISOString(), users: results },
      processedCount: results.length,
      succeededCount: results.length - failedCount,
      failedCount,
      metadata: {
        enabledUsers: automationUsers,
        notifyOnlyUsers: managers.results.length,
        notifyOnlyPlanned: managers.planned,
        notifyOnlyStoppedByBudget: managers.stoppedByBudget,
        ...(notifyOnlyError ? { notifyOnlyError } : {}),
      },
    };
  });

  return NextResponse.json(data);
}
