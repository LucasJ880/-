/**
 * GET /api/trade/prospects/[id]/conversion-preview
 * 预览转入销售 CRM（候选客户、建议字段、告警）
 */

import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { loadTradeProspectForOrg, resolveTradeOrgId } from "@/lib/trade/access";
import { buildConversionPreview } from "@/lib/trade/sales-conversion";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireRole(request, ["trade", "admin"]);
  if (auth instanceof NextResponse) return auth;

  const orgRes = await resolveTradeOrgId(request, auth.user);
  if (!orgRes.ok) return orgRes.response;

  const { id } = await params;
  const loaded = await loadTradeProspectForOrg(id, orgRes.orgId);
  if (loaded instanceof NextResponse) return loaded;

  const p = loaded.prospect;
  if (!p.campaign) {
    return NextResponse.json({ error: "线索缺少活动数据" }, { status: 500 });
  }

  const preview = await buildConversionPreview(orgRes.orgId, {
    ...p,
    campaign: p.campaign,
  });

  return NextResponse.json(preview);
}
