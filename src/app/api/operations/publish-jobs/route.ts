/**
 * GET /api/operations/publish-jobs — 发布任务列表
 * query: orgId、status（默认待审队列）
 */

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/common/api-helpers";
import { resolveRequestOrgIdForUser } from "@/lib/auth/resolve-request-org";
import {
  HUMAN_REVIEW_STATUSES,
  normalizePublishStatus,
  PUBLISH_STATUSES,
} from "@/lib/operations/publish-status";

const VALID = new Set<string>([
  ...PUBLISH_STATUSES,
  "review", // legacy filter
]);

export const GET = withAuth(async (request, _ctx, user) => {
  const { searchParams } = request.nextUrl;
  const orgRes = await resolveRequestOrgIdForUser(user, searchParams.get("orgId"));
  if (!orgRes.ok) return orgRes.response;

  const statusParam =
    searchParams.get("status") ?? HUMAN_REVIEW_STATUSES.join(",");
  const statuses = statusParam.split(",").filter((s) => VALID.has(s));

  const jobs = await db.publishJob.findMany({
    where: {
      orgId: orgRes.orgId,
      ...(statuses.length ? { status: { in: statuses } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: {
      asset: { select: { id: true, title: true, videoUrl: true, language: true } },
      account: {
        select: {
          id: true,
          platform: true,
          handle: true,
          groupName: true,
          tier: true,
          groupId: true,
        },
      },
    },
  });

  return NextResponse.json({
    jobs: jobs.map((j) => {
      const risk = j.riskAssessmentJson as {
        result?: string;
        score?: number;
        issues?: Array<{ code: string; severity: string; message: string }>;
      } | null;
      const ctx = j.contextSnapshotJson as {
        hasApprovedPlaybook?: boolean;
        sourceTrace?: unknown;
        warnings?: string[];
        groupKey?: string | null;
      } | null;
      return {
        id: j.id,
        status: j.status,
        normalizedStatus: normalizePublishStatus(j.status),
        channel: j.channel,
        captionText: j.captionText,
        hashtags: j.hashtags,
        hookText: j.hookText,
        titleText: j.titleText,
        ctaText: j.ctaText,
        firstCommentText: j.firstCommentText,
        scheduledAt: j.scheduledAt?.toISOString() ?? null,
        sampledForReview: j.sampledForReview,
        errorMessage: j.errorMessage,
        externalJobId: j.externalJobId,
        externalPostUrl: j.externalPostUrl,
        providerStatus: j.providerStatus,
        similarityScore: j.similarityScore,
        playbookEnforcementMode: j.playbookEnforcementMode,
        hasApprovedPlaybook: ctx?.hasApprovedPlaybook ?? null,
        sourceTrace: ctx?.sourceTrace ?? null,
        riskResult: risk?.result ?? null,
        riskScore: risk?.score ?? null,
        riskIssues: risk?.issues ?? [],
        approvedById: j.approvedById,
        approvedAt: j.approvedAt?.toISOString() ?? null,
        attemptCount: j.attemptCount,
        createdAt: j.createdAt.toISOString(),
        asset: j.asset,
        account: j.account,
      };
    }),
  });
});
