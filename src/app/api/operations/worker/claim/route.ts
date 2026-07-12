/**
 * POST /api/operations/worker/claim
 *
 * PostFlow worker（自建服务器）认领待发布任务。
 * 鉴权：Bearer POSTFLOW_WORKER_TOKEN（server-to-server，无用户会话）。
 *
 * 认领范围：channel=postflow 且 status=queued，
 * 以及 processing 超过 30 分钟未回报的（worker 崩溃后自动重入队）。
 * body: { limit?: number（默认 5，最大 20） }
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

const STALE_PROCESSING_MS = 30 * 60 * 1000;

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
  const limit = Math.min(Math.max(Number(body.limit) || 5, 1), 20);
  const staleBefore = new Date(Date.now() - STALE_PROCESSING_MS);

  const candidates = await db.publishJob.findMany({
    where: {
      channel: "postflow",
      OR: [
        { status: "queued" },
        { status: "processing", updatedAt: { lt: staleBefore } },
      ],
    },
    orderBy: [{ scheduledAt: { sort: "asc", nulls: "first" } }, { createdAt: "asc" }],
    take: limit,
    include: {
      asset: {
        select: { title: true, videoUrl: true, coverUrl: true, language: true },
      },
      account: {
        select: { handle: true, platform: true, externalChannelId: true },
      },
    },
  });

  // 逐条条件更新防止并发 worker 重复认领
  const claimed: typeof candidates = [];
  for (const job of candidates) {
    const res = await db.publishJob.updateMany({
      where: {
        id: job.id,
        status: job.status,
        ...(job.status === "processing" ? { updatedAt: { lt: staleBefore } } : {}),
      },
      data: { status: "processing" },
    });
    if (res.count === 1) claimed.push(job);
  }

  return NextResponse.json({
    jobs: claimed.map((j) => ({
      id: j.id,
      captionText: j.captionText,
      hashtags: j.hashtags,
      scheduledAt: j.scheduledAt?.toISOString() ?? null,
      videoTitle: j.asset.title,
      videoUrl: j.asset.videoUrl,
      coverUrl: j.asset.coverUrl,
      language: j.asset.language,
      account: {
        handle: j.account.handle,
        platform: j.account.platform,
        /** PostFlow CLI 的 --account 名 */
        postflowAccount: j.account.externalChannelId,
      },
    })),
  });
}
