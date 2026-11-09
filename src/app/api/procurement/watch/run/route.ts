/**
 * POST /api/procurement/watch/run?orgId（org_member+）：立即扫描。
 * 只建排队运行并立即返回 runId；扫描在响应后执行（after），未执行时由 tender-watch 定时任务接手。
 * 不在前端请求里同步抓取。
 */
import { after, NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { requireProcurementOrg, schemaGate } from "@/lib/procurement-records/access";
import { enqueueManualRun, executeScanRun } from "@/lib/procurement-records/scan-run";
import { getWatchRow } from "@/lib/procurement-records/watch-service";

export const maxDuration = 300;

export const POST = withAuth(async (request, _ctx, user) => {
  const gate = schemaGate("write");
  if (gate) return gate;
  const a = await requireProcurementOrg(user, request.nextUrl.searchParams.get("orgId"), "org_member");
  if (a instanceof NextResponse) return a;
  const watch = await getWatchRow(a.orgId);
  if (!watch) return NextResponse.json({ error: "请先保存监控配置", code: "WATCH_NOT_CONFIGURED" }, { status: 404 });
  const { runId, reused } = await enqueueManualRun({ orgId: a.orgId, watchId: watch.id, userId: user.id });
  if (!reused) {
    after(async () => {
      try {
        await executeScanRun(runId);
      } catch (e) {
        console.error("[procurement-watch] manual run failed", runId, e instanceof Error ? e.message : "unknown");
      }
    });
  }
  return NextResponse.json({ ok: true, runId, reused }, { status: 202 });
});
