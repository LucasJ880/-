/**
 * GET /api/org/tender-intel-profiles?orgId=
 * P2-0b — 组织级「竞争对手」「采购机构」画像（READ-ONLY）。
 *
 * - 授标事实来自 canonical AwardRecord（T4 开关关闭 → 对 AwardRecord 0 次访问，awardsAvailable=false）。
 * - 「我方参与」来自本组织 tender 项目，经 buildProjectVisibilityWhere 过滤（只统计当前用户可见的项目）。
 * - 我方中标按组织名排除出竞争对手（与 /api/org/tender-awards 同口径）。
 * 不写任何数据；零出站；零 LLM。
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import { resolveRequestOrgIdForUser } from "@/lib/auth/resolve-request-org";
import { buildProjectVisibilityWhere } from "@/lib/projects/visibility";
import { listAwardsForOrg } from "@/lib/tender-intel/awards";
import { isT4AwardSchemaReady } from "@/lib/tender-intel/award-flags";
import { buildAgencyProfiles, buildCompetitorProfiles } from "@/lib/tender-intel/org-profiles";

const PROJECT_CAP = 500;

export const GET = withAuth(async (request, _ctx, user) => {
  const { searchParams } = new URL(request.url);
  const orgRes = await resolveRequestOrgIdForUser(user, searchParams.get("orgId"));
  if (!orgRes.ok) return orgRes.response;
  const orgId = orgRes.orgId;

  const org = await db.organization.findUnique({ where: { id: orgId }, select: { name: true } });
  const ownWinnerNames = [org?.name];

  const awardsAvailable = isT4AwardSchemaReady();
  const rows = awardsAvailable ? await listAwardsForOrg({ orgId }) : [];

  const visibility = await buildProjectVisibilityWhere(user);
  const projects = await db.project.findMany({
    where: {
      AND: [
        ...(visibility ? [visibility] : []),
        { orgId, workDomain: "tender", clientOrganization: { not: null } },
      ],
    },
    orderBy: { updatedAt: "desc" },
    take: PROJECT_CAP,
    select: {
      id: true,
      name: true,
      clientOrganization: true,
      tenderStatus: true,
      status: true,
      abandonedAt: true,
      solicitationNumber: true,
      updatedAt: true,
    },
  });

  const { competitors, ownAwardCount } = buildCompetitorProfiles(rows, { ownWinnerNames });
  const agencies = buildAgencyProfiles(rows, projects, { ownWinnerNames });

  return NextResponse.json({
    orgId,
    awardsAvailable,
    reason: awardsAvailable ? null : "SCHEMA_NOT_READY",
    ownOrgName: org?.name ?? null,
    competitors,
    ownAwardCount,
    agencies,
    projectsTruncated: projects.length >= PROJECT_CAP,
  });
});
