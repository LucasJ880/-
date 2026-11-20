/**
 * GET /api/org/tender-awards?orgId=&buyer=&winner=&from=&to=
 * T4 — 组织级 canonical 授标情报（READ-ONLY）。
 * 返回：AwardRecord 列表（org 隔离、非撤回）+ 七域确定性投影（evidence-aware）。
 * 写路径不在此（唯一写入口 = tender-intel awards service，经人工确认路由）。
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import { getOrgMembership } from "@/lib/auth";
import { hasOrgRole, isSuperAdmin } from "@/lib/rbac/roles";
import { resolveRequestOrgIdForUser } from "@/lib/auth/resolve-request-org";
import { listAwardsForOrg, toAmountNumber } from "@/lib/tender-intel/awards";
import { deriveAwardIntelligence } from "@/lib/tender-intel/award-intelligence";
import { isT4AwardSchemaReady } from "@/lib/tender-intel/award-flags";
import { MANUAL_APC_SOURCE_PREFIX, listableApcUrl } from "@/lib/tender-intel/award-manual-entry";

export const GET = withAuth(async (request, _ctx, user) => {
  const { searchParams } = new URL(request.url);
  const orgRes = await resolveRequestOrgIdForUser(user, searchParams.get("orgId"));
  if (!orgRes.ok) return orgRes.response;
  const orgId = orgRes.orgId;

  // 生产激活闸：T4 schema 未 ready → 对 AwardRecord 表 0 次访问，绝不 500
  if (!isT4AwardSchemaReady()) {
    return NextResponse.json({
      orgId,
      available: false,
      reason: "SCHEMA_NOT_READY",
      records: [],
      intelligence: null,
    });
  }

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
  // 我方中标不进「竞争对手」域（P2-0）：以组织名为准（我方结果回灌写 AwardRecord 时也用组织名作中标方）
  const org = await db.organization.findUnique({ where: { id: orgId }, select: { name: true } });
  const intelligence = deriveAwardIntelligence(allRecords, { ownWinnerNames: [org?.name] });

  // P2-0d：只有组织管理员能在页面上确认 / 撤回（写接口另行鉴权，这里只决定是否显示按钮）
  const membership = isSuperAdmin(user.role) ? null : await getOrgMembership(user.id, orgId);
  const canReview =
    isSuperAdmin(user.role) || (membership?.status === "active" && hasOrgRole(membership.role, "org_admin"));
  // CHAIN-1b：Alberta 授标的人工录入——本组织 org_member 以上的有效成员（平台超级管理员按既有规则）
  const canEnterManual =
    isSuperAdmin(user.role) || (membership?.status === "active" && hasOrgRole(membership.role, "org_member"));
  // 列表里只显示人工录入的 APC 链接（再校验一次主机）；别的来源的链接与原文片段不返回
  const apcSources = records.length
    ? await db.awardRecordSource.findMany({
        where: { orgId, awardRecordId: { in: records.map((r) => r.id) }, sourceType: "USER_ENTRY", sourceKey: { startsWith: MANUAL_APC_SOURCE_PREFIX } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { awardRecordId: true, sourceType: true, sourceKey: true, sourceUrl: true },
      })
    : [];
  const apcByRecord = new Map<string, string>();
  for (const src of apcSources) {
    if (apcByRecord.has(src.awardRecordId)) continue;
    const url = listableApcUrl(src);
    if (url) apcByRecord.set(src.awardRecordId, url);
  }
  // 采购方候选：本组织项目的采购方写法 + 已有授标的采购方写法（去重，最多 200 个），只给能录入的人
  let buyerSuggestions: string[] = [];
  if (canEnterManual) {
    const [projectBuyers, awardBuyers] = await Promise.all([
      db.project.findMany({ where: { orgId, clientOrganization: { not: null } }, select: { clientOrganization: true }, distinct: ["clientOrganization"], take: 200 }),
      db.awardRecord.findMany({ where: { orgId, buyerNameRaw: { not: null }, status: { not: "RETRACTED" } }, select: { buyerNameRaw: true }, distinct: ["buyerNameRaw"], take: 200 }),
    ]);
    buyerSuggestions = [...new Set([...projectBuyers.map((p) => p.clientOrganization), ...awardBuyers.map((a) => a.buyerNameRaw)].map((b) => (b ?? "").trim()).filter(Boolean))].slice(0, 200);
  }

  return NextResponse.json({
    orgId,
    available: true,
    canReview,
    canEnterManual,
    buyerSuggestions,
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
      possibleDuplicateOfId: r.possibleDuplicateOfId,
      confirmedAt: r.confirmedAt ? r.confirmedAt.toISOString() : null,
      manualApcUrl: apcByRecord.get(r.id) ?? null,
    })),
    intelligence,
  });
});
