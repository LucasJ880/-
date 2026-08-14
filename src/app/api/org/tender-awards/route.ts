/**
 * GET /api/org/tender-awards?orgId=&buyer=&winner=&from=&to=
 * T4 — 组织级 canonical 授标情报（READ-ONLY）。
 * 返回：AwardRecord 列表（org 隔离、非撤回）+ 七域确定性投影（evidence-aware）。
 * 写路径不在此（唯一写入口 = tender-intel awards service，经人工确认路由）。
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { resolveRequestOrgIdForUser } from "@/lib/auth/resolve-request-org";
import { listAwardsForOrg, toAmountNumber } from "@/lib/tender-intel/awards";
import { deriveAwardIntelligence } from "@/lib/tender-intel/award-intelligence";

export const GET = withAuth(async (request, _ctx, user) => {
  const { searchParams } = new URL(request.url);
  const orgRes = await resolveRequestOrgIdForUser(user, searchParams.get("orgId"));
  if (!orgRes.ok) return orgRes.response;
  const orgId = orgRes.orgId;

  const parseDate = (v: string | null): Date | null => {
    if (!v) return null;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  };

  const records = await listAwardsForOrg({
    orgId,
    filters: {
      buyerName: searchParams.get("buyer"),
      winnerName: searchParams.get("winner"),
      from: parseDate(searchParams.get("from")),
      to: parseDate(searchParams.get("to")),
    },
  });

  // 投影基于「未过滤」的组织全量（周期/价格等统计不能被 UI 过滤条件截断）
  const allRecords =
    searchParams.get("buyer") || searchParams.get("winner") || searchParams.get("from") || searchParams.get("to")
      ? await listAwardsForOrg({ orgId })
      : records;
  const intelligence = deriveAwardIntelligence(allRecords);

  return NextResponse.json({
    orgId,
    records: records.map((r) => ({
      id: r.id,
      buyerName: r.buyerNameRaw,
      winnerName: r.winnerName,
      solicitationNumber: r.solicitationNumber,
      awardDate: r.awardDate ? r.awardDate.toISOString().slice(0, 10) : null,
      contractAmount: toAmountNumber(r.contractAmount),
      currency: r.currency,
      scopeSummary: r.scopeSummary,
      verificationStatus: r.verificationStatus,
      status: r.status,
      projectId: r.projectId,
      confirmedAt: r.confirmedAt ? r.confirmedAt.toISOString() : null,
    })),
    intelligence,
  });
});
