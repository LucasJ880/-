import { NextRequest, NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/cron/auth";
import { runTrackedAutomation } from "@/lib/automation/runner";
import { runProactiveScanCron } from "@/lib/proactive/manager-notify";

/**
 * 每小时主动提醒（vercel.json `15 * * * *`）：
 * 1. 自动化一轮：开了自动化偏好的用户（最多 100 人），扫描 + 写通知 + 执行低风险自动动作；
 * 2. 管理层补发一轮（A-3b）：只扫描、只写通知、不执行自动动作，补上旧首页每 5 分钟扫描停掉后的提醒。
 * 两轮的主体在 src/lib/proactive/manager-notify.ts runProactiveScanCron（依赖可注入，便于无 DB 测试）。
 */
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const denied = requireCronSecret(request);
  if (denied) return denied;

  const data = await runTrackedAutomation("proactive-scan", () => runProactiveScanCron());

  return NextResponse.json(data);
}
