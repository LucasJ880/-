/**
 * 健康检查接口
 *
 * 匿名生产响应不暴露 Neon endpoint 前缀；仅返回 dbPlane。
 * Staging/Preview 可附带不可逆短指纹便于运维核对。
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
          dbPlane: isolation.dbPlane,
          violations: isolation.violations,
          ...(isolation.dbFingerprint
            ? { dbFingerprint: isolation.dbFingerprint }
            : {}),
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
        dbPlane: isolation.dbPlane,
        ...(isolation.dbFingerprint
          ? { dbFingerprint: isolation.dbFingerprint }
          : {}),
        ...(dbError ? { error: dbError } : {}),
      },
    },
    {
      status: healthy ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
