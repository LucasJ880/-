import { NextRequest, NextResponse } from "next/server";
import { runTrackedAutomation } from "@/lib/automation/runner";
import { db } from "@/lib/db";
import { getUserAutomationPrefs } from "@/lib/proactive/automation-prefs";
import { runProactiveScanForUser } from "@/lib/proactive/run-scan";

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const data = await runTrackedAutomation("proactive-scan", async () => {
    const preferences = await db.userNotificationPreference.findMany({
      where: { metadata: { not: null }, user: { status: "active" } },
      select: { userId: true, user: { select: { role: true } } },
      orderBy: { updatedAt: "asc" },
      take: 100,
    });
    const results: Array<{ userId: string; suggestions?: number; actions?: number; error?: string }> = [];

    for (const preference of preferences) {
      const prefs = await getUserAutomationPrefs(preference.userId);
      if (!prefs.enabled) continue;
      try {
        const result = await runProactiveScanForUser(preference.userId, preference.user.role);
        results.push({
          userId: preference.userId,
          suggestions: result.suggestions.length,
          actions: result.autoActions.filter((action) => action.success).length,
        });
      } catch (error) {
        results.push({ userId: preference.userId, error: error instanceof Error ? error.message : String(error) });
      }
    }

    const failedCount = results.filter((result) => result.error).length;
    return {
      data: { scannedAt: new Date().toISOString(), users: results },
      processedCount: results.length,
      succeededCount: results.length - failedCount,
      failedCount,
      metadata: { enabledUsers: results.length },
    };
  });

  return NextResponse.json(data);
}
