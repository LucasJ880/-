import { NextResponse } from "next/server";
import { getAutomationReadiness } from "@/lib/automation/registry";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import { isAdmin } from "@/lib/rbac/roles";

export const GET = withAuth(async (_request, _ctx, user) => {
  if (!isAdmin(user.role)) {
    return NextResponse.json({ error: "无权查看自动流运行状态" }, { status: 403 });
  }

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const runs = await db.automationRun.findMany({
    where: { startedAt: { gte: since } },
    orderBy: { startedAt: "desc" },
    take: 500,
    select: {
      id: true,
      automationKey: true,
      status: true,
      processedCount: true,
      succeededCount: true,
      failedCount: true,
      error: true,
      startedAt: true,
      completedAt: true,
      durationMs: true,
    },
  });

  const automations = getAutomationReadiness().map((definition) => {
    const recentRuns = runs.filter((run) => run.automationKey === definition.key);
    return {
      ...definition,
      lastRun: recentRuns[0] ?? null,
      last24Hours: {
        runs: recentRuns.length,
        succeeded: recentRuns.filter((run) => run.status === "succeeded").length,
        partial: recentRuns.filter((run) => run.status === "partial").length,
        failed: recentRuns.filter((run) => run.status === "failed").length,
      },
    };
  });

  return NextResponse.json({ generatedAt: new Date().toISOString(), automations });
});
