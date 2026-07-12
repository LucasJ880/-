/**
 * 视频资产队列
 * GET  /api/operations/video-assets — 列表（按组织隔离，可按 status 过滤）
 * POST /api/operations/video-assets — 手动登记一条外部视频（Aivora 之外的补充入口）
 */

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/common/api-helpers";
import { resolveRequestOrgIdForUser } from "@/lib/auth/resolve-request-org";

export const GET = withAuth(async (request, _ctx, user) => {
  const { searchParams } = request.nextUrl;
  const orgRes = await resolveRequestOrgIdForUser(user, searchParams.get("orgId"));
  if (!orgRes.ok) return orgRes.response;

  const status = searchParams.get("status");
  const assets = await db.videoAsset.findMany({
    where: {
      orgId: orgRes.orgId,
      ...(status ? { status } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      publishJobs: {
        select: { id: true, status: true, channel: true },
      },
    },
  });

  return NextResponse.json({
    assets: assets.map((a) => ({
      id: a.id,
      source: a.source,
      title: a.title,
      topic: a.topic,
      language: a.language,
      videoUrl: a.videoUrl,
      coverUrl: a.coverUrl,
      durationSec: a.durationSec,
      status: a.status,
      blockReason: a.blockReason,
      createdAt: a.createdAt.toISOString(),
      jobStats: {
        total: a.publishJobs.length,
        queued: a.publishJobs.filter((j) => j.status === "queued" || j.status === "processing").length,
        held: a.publishJobs.filter((j) => j.status === "review" || j.status === "blocked").length,
        published: a.publishJobs.filter((j) => j.status === "published").length,
        failed: a.publishJobs.filter((j) => j.status === "failed").length,
      },
    })),
  });
});

export const POST = withAuth(async (request, _ctx, user) => {
  const body = await request.json().catch(() => ({}));
  const orgRes = await resolveRequestOrgIdForUser(user, body.orgId);
  if (!orgRes.ok) return orgRes.response;

  const title = String(body.title ?? "").trim();
  const videoUrl = String(body.videoUrl ?? "").trim();
  if (!title || !videoUrl) {
    return NextResponse.json({ error: "title 与 videoUrl 必填" }, { status: 400 });
  }
  if (!/^https?:\/\//.test(videoUrl)) {
    return NextResponse.json({ error: "videoUrl 须为 http(s) 链接" }, { status: 400 });
  }

  const asset = await db.videoAsset.create({
    data: {
      orgId: orgRes.orgId,
      source: "manual",
      title,
      topic: body.topic ? String(body.topic).trim() : null,
      language: body.language === "zh" ? "zh" : "en",
      videoUrl,
      coverUrl: body.coverUrl ? String(body.coverUrl).trim() : null,
    },
  });
  return NextResponse.json({ asset }, { status: 201 });
});
