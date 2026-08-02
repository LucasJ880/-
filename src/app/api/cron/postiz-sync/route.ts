/**
 * GET /api/cron/postiz-sync
 * 轮询 Postiz 任务状态并回写 PublishJob（仅在有可靠证据时 published）
 */

import { NextRequest, NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/cron/auth";
import { runTrackedAutomation } from "@/lib/automation/runner";
import { syncPostizPublishJobs } from "@/lib/operations/postiz-sync";

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const denied = requireCronSecret(request);
  if (denied) return denied;

  try {
    const data = await runTrackedAutomation("postiz-sync", async () => {
      const result = await syncPostizPublishJobs(40);
      return { data: { syncedAt: new Date().toISOString(), ...result } };
    });
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "同步失败" },
      { status: 502 },
    );
  }
}
