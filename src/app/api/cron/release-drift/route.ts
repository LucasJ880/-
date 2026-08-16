/**
 * GET /api/cron/release-drift
 *
 * 每日发布漂移检查（Bearer CRON_SECRET）：从**正在运行的生产代码**视角比对
 * 「代码期望的 migration」与「生产库已应用的 migration」。
 *
 * 存在漂移时：AutomationRun 记 failed/partial + 结构化日志 + 通知平台管理员
 * （同一漂移形态每天只发一次，靠 sourceKey 去重）。
 */

import { NextRequest, NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/cron/auth";
import { runTrackedAutomation } from "@/lib/automation/runner";
import { db } from "@/lib/db";
import { createNotification } from "@/lib/notifications/create";
import { EXPECTED_ACTIVE_MIGRATIONS } from "@/lib/release/expected-migrations";
import {
  diffMigrations,
  driftNotificationTitle,
  driftSourceKey,
} from "@/lib/release/drift";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const denied = requireCronSecret(request);
  if (denied) return denied;

  const result = await runTrackedAutomation("release-drift", async () => {
    const rows = await db.$queryRawUnsafe<{ migration_name: string }[]>(
      `select migration_name from "_prisma_migrations"
       where finished_at is not null and rolled_back_at is null`,
    );
    const applied = rows.map((r) => r.migration_name);
    const drift = diffMigrations(EXPECTED_ACTIVE_MIGRATIONS, applied);

    if (drift.severity === "ok") {
      console.log(`[release-drift] ok expected=${drift.expectedCount}`);
    } else {
      console.error(
        `[release-drift] ${drift.severity} missing=${drift.missing.join(",") || "-"} unexpected=${drift.unexpected.join(",") || "-"}`,
      );
      await notifyPlatformAdmins(drift);
    }

    return {
      data: drift,
      status: drift.severity === "critical" ? ("failed" as const) : drift.severity === "warn" ? ("partial" as const) : ("succeeded" as const),
      processedCount: drift.expectedCount,
      failedCount: drift.missing.length,
      metadata: {
        severity: drift.severity,
        missing: drift.missing,
        unexpected: drift.unexpected,
      },
    };
  });

  return NextResponse.json({
    ok: true,
    ...result,
    timestamp: new Date().toISOString(),
  });
}

async function notifyPlatformAdmins(
  drift: ReturnType<typeof diffMigrations>,
): Promise<void> {
  try {
    const admins = await db.user.findMany({
      where: { role: "admin", status: "active" },
      select: { id: true, activeOrgId: true },
      take: 20,
    });
    const dayIso = new Date().toISOString().slice(0, 10);
    const sourceKeyBase = driftSourceKey(drift, dayIso);
    for (const admin of admins) {
      await createNotification({
        userId: admin.id,
        orgId: admin.activeOrgId ?? null,
        type: "system",
        category: "release_drift",
        priority: drift.severity === "critical" ? "high" : "medium",
        title: driftNotificationTitle(drift),
        summary: drift.summary,
        sourceKey: `${sourceKeyBase}:${admin.id}`,
        metadata: {
          severity: drift.severity,
          missing: drift.missing,
          unexpected: drift.unexpected,
        },
      });
    }
  } catch (e) {
    // 告警失败绝不能反过来打断检查本身
    console.error(
      "[release-drift] 通知发送失败:",
      e instanceof Error ? e.message : "unknown",
    );
  }
}
