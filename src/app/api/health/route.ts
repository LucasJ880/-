/**
 * 健康检查接口
 *
 * 用于 Vercel 监控探活、外部 uptime 服务（UptimeRobot 等）、
 * 或自行编写的告警脚本。
 *
 * 返回：
 *   200 — 服务正常（DB 可连通）
 *   503 — DB 不可用 / 环境隔离失败
 *
 * 注意：此接口在 middleware PUBLIC_PATHS 中（/api/health），无需登录。
 * 仅返回聚合健康状态与脱敏隔离摘要，不返回业务数据或连接串。
 */

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { healthIsolationSnapshot } from "@/lib/env/runtime-isolation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const startedAt = Date.now();
  const isolation = healthIsolationSnapshot();

  if (!isolation.isolationOk) {
    return NextResponse.json(
      {
        status: "misconfigured",
        timestamp: new Date().toISOString(),
        checks: {
          database: "error",
          isolation: "error",
          runtimeEnv: isolation.runtimeEnv,
          dbEndpointPrefix: isolation.dbEndpointPrefix,
          violations: isolation.violations,
        },
      },
      {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }

  let dbStatus: "ok" | "error" = "error";
  let dbError: string | undefined;

  try {
    await db.$queryRaw`SELECT 1`;
    dbStatus = "ok";
  } catch (err) {
    dbError = err instanceof Error ? err.message : "unknown";
  }

  const latencyMs = Date.now() - startedAt;
  const healthy = dbStatus === "ok";

  return NextResponse.json(
    {
      status: healthy ? "ok" : "degraded",
      timestamp: new Date().toISOString(),
      checks: {
        database: dbStatus,
        latencyMs,
        isolation: "ok",
        runtimeEnv: isolation.runtimeEnv,
        dbEndpointPrefix: isolation.dbEndpointPrefix,
        ...(dbError ? { error: dbError } : {}),
      },
    },
    {
      status: healthy ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
