import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { createProspect } from "@/lib/trade/service";
import { loadTradeCampaignForOrg, resolveTradeOrgId } from "@/lib/trade/access";
import { listTradeProspectsForOrg } from "@/lib/trade/prospect-list";

function parseOptionalFloat(v: string | null): number | null {
  if (v == null || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * GET /api/trade/prospects
 *
 * - 不传 campaignId：返回当前 org 下全部线索（轻量 DTO，不含 researchReport）
 * - 传 campaignId：校验活动属于 org 后筛选；可用 query 控制筛选/排序/分页
 * - 兼容旧客户端：传 `legacyFull=1` 且带 campaignId 时，仍返回旧版 listProspects 全字段结构（仅建议过渡）
 */
export async function GET(request: NextRequest) {
  const auth = await requireRole(request, ["trade", "admin"]);
  if (auth instanceof NextResponse) return auth;

  const orgRes = await resolveTradeOrgId(request, auth.user);
  if (!orgRes.ok) return orgRes.response;

  const url = new URL(request.url);
  const campaignId = url.searchParams.get("campaignId") ?? undefined;

  if (campaignId) {
    const camp = await loadTradeCampaignForOrg(campaignId, orgRes.orgId);
    if (camp instanceof NextResponse) return camp;
  }

  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get("pageSize") ?? "25", 10) || 25));

  const result = await listTradeProspectsForOrg({
    orgId: orgRes.orgId,
    campaignId,
    page,
    pageSize,
    search: url.searchParams.get("search") ?? undefined,
    stage: url.searchParams.get("stage") ?? undefined,
    country: url.searchParams.get("country") ?? undefined,
    minScore: parseOptionalFloat(url.searchParams.get("minScore")),
    maxScore: parseOptionalFloat(url.searchParams.get("maxScore")),
    researchStatus: url.searchParams.get("researchStatus") ?? undefined,
    emailStatus: url.searchParams.get("emailStatus") ?? undefined,
    quoteStatus: url.searchParams.get("quoteStatus") ?? undefined,
    ownerId: url.searchParams.get("ownerId") ?? undefined,
    sort: url.searchParams.get("sort"),
  });

  return NextResponse.json(result);
}

export async function POST(request: NextRequest) {
  const auth = await requireRole(request, ["trade", "admin"]);
  if (auth instanceof NextResponse) return auth;

  const body = await request.json();
  const orgRes = await resolveTradeOrgId(request, auth.user, { bodyOrgId: body.orgId });
  if (!orgRes.ok) return orgRes.response;

  if (!body.campaignId || !body.companyName) {
    return NextResponse.json(
      { error: "campaignId、companyName 为必填" },
      { status: 400 },
    );
  }

  const camp = await loadTradeCampaignForOrg(body.campaignId, orgRes.orgId);
  if (camp instanceof NextResponse) return camp;

  const prospect = await createProspect({
    campaignId: body.campaignId,
    orgId: orgRes.orgId,
    companyName: body.companyName,
    contactName: body.contactName,
    contactEmail: body.contactEmail,
    contactTitle: body.contactTitle,
    website: body.website,
    country: body.country,
    source: body.source,
  });
  return NextResponse.json(prospect, { status: 201 });
}
