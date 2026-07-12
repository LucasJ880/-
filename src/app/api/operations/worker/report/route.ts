/**
 * POST /api/operations/worker/report
 *
 * PostFlow worker 回报任务结果。
 * 鉴权：Bearer POSTFLOW_WORKER_TOKEN
 * body: { jobId, ok: boolean, error?, externalJobId? }
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
  if (!jobId || typeof body.ok !== "boolean") {
    return NextResponse.json({ error: "jobId 与 ok 必填" }, { status: 400 });
  }

  const job = await db.publishJob.findFirst({
    where: { id: jobId, channel: "postflow", status: "processing" },
    select: { id: true },
  });
  if (!job) {
    return NextResponse.json({ error: "任务不存在或不在 processing 状态" }, { status: 404 });
  }

  await db.publishJob.update({
    where: { id: jobId },
    data: body.ok
      ? {
          status: "published",
          externalJobId: body.externalJobId ? String(body.externalJobId) : null,
          errorMessage: null,
        }
      : {
          status: "failed",
          errorMessage: String(body.error ?? "worker 未提供失败原因").slice(0, 1000),
        },
  });

  return NextResponse.json({ ok: true });
}
