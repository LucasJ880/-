/**
 * GET /api/operations/publish-jobs — 发布任务列表
 * query: orgId、status（默认 review,blocked 审核队列）
 */

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/common/api-helpers";
import { resolveRequestOrgIdForUser } from "@/lib/auth/resolve-request-org";

const VALID_STATUSES = new Set([
  "draft", "review", "blocked", "queued", "processing", "published", "failed", "canceled",
]);

export const GET = withAuth(async (request, _ctx, user) => {
  const { searchParams } = request.nextUrl;
  const orgRes = await resolveRequestOrgIdForUser(user, searchParams.get("orgId"));
  if (!orgRes.ok) return orgRes.response;

  const statusParam = searchParams.get("status") ?? "review,blocked";
  const statuses = statusParam.split(",").filter((s) => VALID_STATUSES.has(s));

  const jobs = await db.publishJob.findMany({
    where: {
      orgId: orgRes.orgId,
      ...(statuses.length ? { status: { in: statuses } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: {
      asset: { select: { id: true, title: true, videoUrl: true, language: true } },
      account: { select: { id: true, platform: true, handle: true, groupName: true } },
    },
  });

  return NextResponse.json({
    jobs: jobs.map((j) => ({
      id: j.id,
      status: j.status,
      channel: j.channel,
      captionText: j.captionText,
      hashtags: j.hashtags,
      scheduledAt: j.scheduledAt?.toISOString() ?? null,
      sampledForReview: j.sampledForReview,
      errorMessage: j.errorMessage,
      createdAt: j.createdAt.toISOString(),
      asset: j.asset,
      account: j.account,
    })),
  });
});
