/**
 * GET /api/cron/postiz-sync
 * 轮询 Postiz 任务状态并回写 PublishJob（仅在有可靠证据时 published）
 */

import { NextRequest, NextResponse } from "next/server";
import { runTrackedAutomation } from "@/lib/automation/runner";
import { syncPostizPublishJobs } from "@/lib/operations/postiz-sync";

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
