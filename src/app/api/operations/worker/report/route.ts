/**
 * POST /api/operations/worker/report
 *
 * PostFlow worker 回报任务结果。
 * 鉴权：Bearer POSTFLOW_WORKER_TOKEN
 * body: { jobId, leaseToken, ok: boolean, error?, externalJobId? }
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

function checkWorkerAuth(request: NextRequest): boolean {
  const token = process.env.POSTFLOW_WORKER_TOKEN;
  if (!token) return false;
  return request.headers.get("authorization") === `Bearer ${token}`;
}

export async function POST(request: NextRequest) {
  if (!checkWorkerAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const jobId = String(body.jobId ?? "");
  const leaseToken = String(body.leaseToken ?? "");
  if (!jobId || !leaseToken || typeof body.ok !== "boolean") {
    return NextResponse.json({ error: "jobId、leaseToken 与 ok 必填" }, { status: 400 });
  }

  const job = await db.publishJob.findFirst({
    where: { id: jobId, channel: "postflow", status: "processing", leaseToken },
    select: { id: true, attemptCount: true },
  });
  if (!job) {
    return NextResponse.json({ error: "任务不存在、租约已失效或不在 processing 状态" }, { status: 409 });
  }

  const retryDelayMinutes = [5, 30, 120][Math.min(Math.max(job.attemptCount - 1, 0), 2)];
  const exhausted = job.attemptCount >= 3;
  await db.publishJob.update({
    where: { id: jobId },
    data: body.ok
      ? {
          status: "published",
          externalJobId: body.externalJobId ? String(body.externalJobId) : null,
          errorMessage: null,
          nextAttemptAt: null,
          leaseToken: null,
          leaseExpiresAt: null,
        }
      : {
          status: "failed",
          errorMessage: String(body.error ?? "worker 未提供失败原因").slice(0, 1000),
          nextAttemptAt: exhausted
            ? null
            : new Date(Date.now() + retryDelayMinutes * 60 * 1000),
          leaseToken: null,
          leaseExpiresAt: null,
        },
  });

  return NextResponse.json({ ok: true });
}
