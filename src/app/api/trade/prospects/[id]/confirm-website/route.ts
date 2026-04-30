/**
 * POST /api/trade/prospects/[id]/confirm-website
 *
 * 人工确认候选官网；不自动触发研究。
 */

import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { updateProspect } from "@/lib/trade/service";
import { loadTradeProspectForOrg, resolveTradeOrgId } from "@/lib/trade/access";

function normalizeWebsiteUrl(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  try {
    const u = new URL(t.startsWith("http://") || t.startsWith("https://") ? t : `https://${t}`);
    if (!u.hostname) return null;
    return u.toString();
  } catch {
    return null;
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireRole(request, ["trade", "admin"]);
  if (auth instanceof NextResponse) return auth;

  const body = (await request.json().catch(() => ({}))) as {
    orgId?: string;
    website?: string;
    candidateIndex?: number;
  };

  const orgRes = await resolveTradeOrgId(request, auth.user, { bodyOrgId: body.orgId });
  if (!orgRes.ok) return orgRes.response;

  const { id } = await params;
  const loaded = await loadTradeProspectForOrg(id, orgRes.orgId);
  if (loaded instanceof NextResponse) return loaded;

  const website = normalizeWebsiteUrl(String(body.website ?? ""));
  if (!website) {
    return NextResponse.json({ error: "请提供有效 website URL" }, { status: 400 });
  }

  const verifiedBy = auth.user.email ?? auth.user.id;

  const updated = await updateProspect(id, {
    website,
    websiteConfidence: 1,
    websiteCandidateSource: "manual_confirmed",
    websiteVerifiedAt: new Date(),
    websiteVerifiedBy: verifiedBy,
    researchStatus: "website_confirmed",
    lastResearchError: null,
  });

  const summary = {
    id: updated.id,
    companyName: updated.companyName,
    website: updated.website,
    websiteConfidence: updated.websiteConfidence,
    websiteCandidateSource: updated.websiteCandidateSource,
    websiteVerifiedAt: updated.websiteVerifiedAt?.toISOString() ?? null,
    websiteVerifiedBy: updated.websiteVerifiedBy,
    researchStatus: updated.researchStatus,
    researchWarnings: updated.researchWarnings,
    crawlStatus: updated.crawlStatus,
    crawlSourceType: updated.crawlSourceType,
    sourcesCount: updated.sourcesCount,
    lastResearchError: updated.lastResearchError,
    lastResearchedAt: updated.lastResearchedAt?.toISOString() ?? null,
  };

  void body.candidateIndex;

  return NextResponse.json({ prospect: updated, summary });
}
