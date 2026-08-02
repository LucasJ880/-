/**
 * POST /api/operations/worker/report
 *
 * PostFlow worker 回报任务结果。
 * 鉴权：Bearer POSTFLOW_WORKER_TOKEN
 * body: { jobId, leaseToken, ok: boolean, error?, externalJobId? }
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { transitionPublishJob } from "@/lib/operations/publish-events";
import { assertNonProdSideEffectsAllowed } from "@/lib/env/runtime-isolation";

function checkWorkerAuth(request: NextRequest): boolean {
  const token = process.env.POSTFLOW_WORKER_TOKEN;
  if (!token) return false;
  return request.headers.get("authorization") === `Bearer ${token}`;
}

export async function POST(request: NextRequest) {
  if (!checkWorkerAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const isolationBlock = assertNonProdSideEffectsAllowed("worker");
  if (isolationBlock) return isolationBlock;

  const body = await request.json().catch(() => ({}));
  const jobId = String(body.jobId ?? "");
  const leaseToken = String(body.leaseToken ?? "");
  if (!jobId || !leaseToken || typeof body.ok !== "boolean") {
    return NextResponse.json({ error: "jobId、leaseToken 与 ok 必填" }, { status: 400 });
  }

  const job = await db.publishJob.findFirst({
    where: { id: jobId, channel: "postflow", status: "processing", leaseToken },
    select: { id: true, orgId: true, attemptCount: true },
  });
  if (!job) {
    return NextResponse.json({ error: "任务不存在、租约已失效或不在 processing 状态" }, { status: 409 });
  }

  const retryDelayMinutes = [5, 30, 120][Math.min(Math.max(job.attemptCount - 1, 0), 2)];
  const exhausted = job.attemptCount >= 3;
  const result = await transitionPublishJob({
    orgId: job.orgId,
    jobId,
    toStatus: body.ok ? "published" : "failed",
    actorType: "worker",
    reasonCode: body.ok ? "POSTFLOW_OK" : "POSTFLOW_FAIL",
    reason: body.ok ? undefined : String(body.error ?? "worker 未提供失败原因").slice(0, 1000),
    data: body.ok
      ? {
          externalJobId: body.externalJobId ? String(body.externalJobId) : null,
          errorMessage: null,
          nextAttemptAt: null,
          leaseToken: null,
          leaseExpiresAt: null,
          providerStatus: "published",
        }
      : {
          errorMessage: String(body.error ?? "worker 未提供失败原因").slice(0, 1000),
          nextAttemptAt: exhausted
            ? null
            : new Date(Date.now() + retryDelayMinutes * 60 * 1000),
          leaseToken: null,
          leaseExpiresAt: null,
          providerStatus: "failed",
        },
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
