/**
 * GET /api/trade/watch-targets?orgId=&prospectId=
 * POST /api/trade/watch-targets  { orgId, prospectId, url, pageType }
 */

import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { createWatchTarget, listWatchTargets } from "@/lib/trade/watch-service";

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, ["trade", "admin"]);
  if (auth instanceof NextResponse) return auth;

  const url = new URL(request.url);
  const orgId = url.searchParams.get("orgId");
  const prospectId = url.searchParams.get("prospectId");
  if (!orgId || !prospectId) {
    return NextResponse.json(
      { error: "缺少 orgId 或 prospectId" },
      { status: 400 },
    );
  }

  const items = await listWatchTargets(orgId, prospectId);
  return NextResponse.json({ items });
}

export async function POST(request: NextRequest) {
  const auth = await requireRole(request, ["trade", "admin"]);
  if (auth instanceof NextResponse) return auth;

  const body = await request.json().catch(() => null);
  if (!body?.orgId || !body?.prospectId || !body?.url || !body?.pageType) {
    return NextResponse.json(
      { error: "orgId、prospectId、url、pageType 为必填" },
      { status: 400 },
    );
  }

  try {
    const row = await createWatchTarget({
      orgId: String(body.orgId),
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
