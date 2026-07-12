/**
 * GET /api/operations/dashboard — 运营矩阵数据看板聚合
 *
 * 数据源为青砚自有表（PublishJob / MatrixAccount / VideoAsset）。
 * 平台侧互动数据（播放/点赞）后续经 Postiz Analytics 接入。
 */

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/common/api-helpers";
import { resolveRequestOrgIdForUser } from "@/lib/auth/resolve-request-org";

const DAYS = 14;

export const GET = withAuth(async (request, _ctx, user) => {
  const orgRes = await resolveRequestOrgIdForUser(
    user,
    request.nextUrl.searchParams.get("orgId"),
  );
  if (!orgRes.ok) return orgRes.response;
  const orgId = orgRes.orgId;

  const since = new Date();
  since.setDate(since.getDate() - DAYS);
  since.setHours(0, 0, 0, 0);

  const [accounts, assetStatus, jobStatus, recentJobs, reviewCount] = await Promise.all([
    db.matrixAccount.findMany({
      where: { orgId },
      select: { platform: true, groupName: true, status: true },
    }),
    db.videoAsset.groupBy({
      by: ["status"],
      where: { orgId },
      _count: { _all: true },
    }),
    db.publishJob.groupBy({
      by: ["status"],
      where: { orgId },
      _count: { _all: true },
    }),
    db.publishJob.findMany({
      where: { orgId, createdAt: { gte: since } },
      select: {
        status: true,
        createdAt: true,
        account: { select: { platform: true } },
      },
    }),
    db.publishJob.count({ where: { orgId, status: { in: ["review", "blocked"] } } }),
  ]);

  // 账号健康：平台 × 状态
  const accountsByPlatform = new Map<string, { total: number; active: number; limited: number; banned: number; paused: number }>();
  for (const a of accounts) {
    const row = accountsByPlatform.get(a.platform) ?? { total: 0, active: 0, limited: 0, banned: 0, paused: 0 };
    row.total += 1;
    if (a.status === "active") row.active += 1;
    else if (a.status === "limited") row.limited += 1;
    else if (a.status === "banned") row.banned += 1;
    else if (a.status === "paused") row.paused += 1;
    accountsByPlatform.set(a.platform, row);
  }

  // 近 14 天每日发布任务量（按创建日）
  const dailyMap = new Map<string, { total: number; published: number; failed: number }>();
  for (let i = 0; i < DAYS; i++) {
    const d = new Date(since);
    d.setDate(d.getDate() + i);
    dailyMap.set(d.toISOString().slice(0, 10), { total: 0, published: 0, failed: 0 });
  }
  const platformJobCounts = new Map<string, number>();
  for (const j of recentJobs) {
    const key = j.createdAt.toISOString().slice(0, 10);
    const row = dailyMap.get(key);
    if (row) {
      row.total += 1;
      if (j.status === "published") row.published += 1;
      if (j.status === "failed") row.failed += 1;
    }
    platformJobCounts.set(
      j.account.platform,
      (platformJobCounts.get(j.account.platform) ?? 0) + 1,
    );
  }

  const toCountMap = (rows: Array<{ status: string; _count: { _all: number } }>) =>
    Object.fromEntries(rows.map((r) => [r.status, r._count._all]));

  return NextResponse.json({
    accounts: {
      total: accounts.length,
      byPlatform: Object.fromEntries(accountsByPlatform),
    },
    assets: { byStatus: toCountMap(assetStatus) },
    jobs: { byStatus: toCountMap(jobStatus) },
    pendingReview: reviewCount,
    recent: {
      days: DAYS,
      daily: [...dailyMap.entries()].map(([date, v]) => ({ date, ...v })),
      byPlatform: Object.fromEntries(platformJobCounts),
    },
  });
});
