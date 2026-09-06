/**
 * POST /api/trade/inbox/[prospectId]/design
 * 对该线索最新一条已分析的进线重新生成 AI 设计段（回复草稿 / 报价建议 / 寄样建议）。
 */

import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { loadTradeProspectForOrg, resolveTradeOrgId } from "@/lib/trade/access";
import { designLatestForProspect } from "@/lib/trade/inquiry-design";

export const maxDuration = 60;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ prospectId: string }> },
) {
  const auth = await requireRole(request, ["trade", "admin"]);
  if (auth instanceof NextResponse) return auth;

  const body = await request.json().catch(() => ({}));
  const orgRes = await resolveTradeOrgId(request, auth.user, { bodyOrgId: body.orgId });
  if (!orgRes.ok) return orgRes.response;

  const { prospectId } = await params;
  const loaded = await loadTradeProspectForOrg(prospectId, orgRes.orgId);
  if (loaded instanceof NextResponse) return loaded;

  const result = await designLatestForProspect(orgRes.orgId, prospectId);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true, messageId: result.messageId });
}
