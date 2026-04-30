/**
 * GET /api/trade/watch-targets?orgId=&prospectId=
 * POST /api/trade/watch-targets  { orgId, prospectId, url, pageType }
 */

import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { createWatchTarget, listWatchTargets } from "@/lib/trade/watch-service";
import { loadTradeProspectForOrg, resolveTradeOrgId } from "@/lib/trade/access";

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, ["trade", "admin"]);
  if (auth instanceof NextResponse) return auth;

  const url = new URL(request.url);
  const prospectId = url.searchParams.get("prospectId");
  if (!prospectId) {
    return NextResponse.json(
      { error: "缺少 prospectId" },
      { status: 400 },
    );
  }

  const orgRes = await resolveTradeOrgId(request, auth.user);
  if (!orgRes.ok) return orgRes.response;

  const p = await loadTradeProspectForOrg(prospectId, orgRes.orgId);
  if (p instanceof NextResponse) return p;

  const items = await listWatchTargets(orgRes.orgId, prospectId);
  return NextResponse.json({ items });
}

export async function POST(request: NextRequest) {
  const auth = await requireRole(request, ["trade", "admin"]);
  if (auth instanceof NextResponse) return auth;

  const body = await request.json().catch(() => null);
  const orgRes = await resolveTradeOrgId(request, auth.user, { bodyOrgId: body?.orgId });
  if (!orgRes.ok) return orgRes.response;

  if (!body?.prospectId || !body?.url || !body?.pageType) {
    return NextResponse.json(
      { error: "prospectId、url、pageType 为必填" },
      { status: 400 },
    );
  }

  const p = await loadTradeProspectForOrg(String(body.prospectId), orgRes.orgId);
  if (p instanceof NextResponse) return p;

  try {
    const row = await createWatchTarget({
      orgId: orgRes.orgId,
      prospectId: String(body.prospectId),
      url: String(body.url),
      pageType: String(body.pageType),
      createdById: auth.user.id,
    });
    return NextResponse.json({ item: row }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "创建失败";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
