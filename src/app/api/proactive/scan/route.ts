import { NextResponse } from "next/server";
import { runProactiveScanForUser } from "@/lib/proactive/run-scan";
import { withAuth } from "@/lib/common/api-helpers";

/**
 * POST /api/proactive/scan
 *
 * 触发一次主动扫描，返回当前用户所有活跃项目的建议列表。
 * 同时将 urgent/warning 建议写入通知系统。
 * 如果用户启用了自动化，低风险动作会自动执行。
 * 前端在工作台加载时调用，也可由定时任务调用。
 */
export const POST = withAuth(async (request, ctx, user) => {
  const result = await runProactiveScanForUser(user.id, user.role);
  return NextResponse.json(result);
});
