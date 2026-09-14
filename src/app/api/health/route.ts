/**
 * 健康检查接口
 *
 * 匿名生产响应不暴露 Neon endpoint 前缀；仅返回 dbPlane。
 * Staging/Preview 可附带不可逆短指纹便于运维核对。
 */

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { healthIsolationSnapshot } from "@/lib/env/runtime-isolation";
import { inspectDatabaseTarget } from "@/lib/db-safety/target";
import { generateRequestId } from "@/lib/common/request-context";
import { createRequestTimer } from "@/lib/performance/timing";
import { applyServerTiming } from "@/lib/performance/server-timing";
import { probeRuntimeTopology } from "@/lib/performance/runtime-probe";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const startedAt = Date.now();
  const timer = createRequestTimer();
  const requestId = generateRequestId();
  const isolation = healthIsolationSnapshot();
  const dbIdentity = inspectDatabaseTarget(process.env.DATABASE_URL);
  const topology = probeRuntimeTopology(dbIdentity?.host ?? null);

  if (!isolation.isolationOk) {
    const snapshot = timer.finish();
    const headers = new Headers({ "Cache-Control": "no-store" });
    headers.set("x-request-id", requestId);
    applyServerTiming(headers, snapshot);
    return NextResponse.json(
      {
        status: "misconfigured",
        timestamp: new Date().toISOString(),
        checks: {
          database: "error",
          isolation: "error",
          runtimeEnv: isolation.runtimeEnv,
          dbPlane: isolation.dbPlane,
          vercelRegion: topology.vercelRegion,
          dbRegion: topology.dbRegion,
          dbHostCategory: topology.dbHostCategory,
          dbPooled: topology.dbPooled,
          violations: isolation.violations,
          ...(isolation.dbFingerprint
            ? { dbFingerprint: isolation.dbFingerprint }
            : {}),
        },
      },
      {
        status: 503,
        headers,
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
  timer.mark("db");

  const latencyMs = Date.now() - startedAt;
  const healthy = dbStatus === "ok";
  const snapshot = timer.finish();
  const headers = new Headers({ "Cache-Control": "no-store" });
  headers.set("x-request-id", requestId);
  applyServerTiming(headers, snapshot);

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
        // 平台注入的 Function region（如 iad1）；未注入则为 null = UNKNOWN
        vercelRegion: topology.vercelRegion,
        // 仅 aws-<region>；无法从 hostname 解析则为 null = UNKNOWN
        dbRegion: topology.dbRegion,
        dbHostCategory: topology.dbHostCategory,
        dbPooled: topology.dbPooled,
        // 短 SHA：供发布漂移检查比对「线上跑的是哪个 commit」；
        // CLI 部署可能没有 git 元数据 → null（检查方按 unknown 处理，不误报）
        deployedCommit: (process.env.VERCEL_GIT_COMMIT_SHA ?? "").slice(0, 7) || null,
        ...(isolation.dbFingerprint
          ? { dbFingerprint: isolation.dbFingerprint }
          : {}),
        ...(dbError ? { error: dbError } : {}),
      },
    },
    {
      status: healthy ? 200 : 503,
      headers,
    },
  );
}
