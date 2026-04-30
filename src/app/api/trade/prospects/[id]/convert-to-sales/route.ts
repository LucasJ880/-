/**
 * POST /api/trade/prospects/[id]/convert-to-sales
 * 将外贸线索转入销售 CRM（显式动作，不自动）
 */

import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { loadTradeProspectForOrg, resolveTradeOrgId } from "@/lib/trade/access";
import { logActivity } from "@/lib/trade/activity-log";
import { executeConvertToSales, type ConvertToSalesBody } from "@/lib/trade/sales-conversion";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireRole(request, ["trade", "admin"]);
  if (auth instanceof NextResponse) return auth;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const orgRes = await resolveTradeOrgId(request, auth.user, {
    bodyOrgId: typeof body.orgId === "string" ? body.orgId : null,
  });
  if (!orgRes.ok) return orgRes.response;

  const { id } = await params;
  const loaded = await loadTradeProspectForOrg(id, orgRes.orgId);
  if (loaded instanceof NextResponse) return loaded;

  const p = loaded.prospect;
  if (!p.campaign) {
    return NextResponse.json({ error: "线索缺少活动数据" }, { status: 500 });
  }

  const mode = body.mode === "use_existing_customer" ? "use_existing_customer" : "create_new";
  const salesCustomerId =
    typeof body.salesCustomerId === "string" && body.salesCustomerId.trim()
      ? body.salesCustomerId.trim()
      : null;
  const createOpportunity = body.createOpportunity !== false;
  const includeLatestTradeQuote = body.includeLatestTradeQuote === true;

  if (mode === "use_existing_customer" && !salesCustomerId) {
    return NextResponse.json({ error: "use_existing_customer 时必须提供 salesCustomerId" }, { status: 400 });
  }

  const payload: ConvertToSalesBody = {
    mode,
    salesCustomerId,
    createOpportunity,
    includeLatestTradeQuote,
  };

  try {
    const result = await executeConvertToSales({
      orgId: orgRes.orgId,
      userId: auth.user.id,
      prospect: { ...p, campaign: p.campaign },
      body: payload,
    });

    await logActivity({
      orgId: orgRes.orgId,
      campaignId: p.campaignId,
      prospectId: p.id,
      action: "convert_to_sales",
      detail: `SalesCustomer=${result.salesCustomerId} SalesOpportunity=${result.salesOpportunityId ?? "none"}`,
      meta: {
        salesCustomerId: result.salesCustomerId,
        salesOpportunityId: result.salesOpportunityId ?? "",
        mode,
      },
    });

    return NextResponse.json({
      ok: true,
      salesCustomerId: result.salesCustomerId,
      salesOpportunityId: result.salesOpportunityId,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const code = e instanceof Error ? (e as Error & { code?: string }).code : undefined;
    if (code === "ALREADY_CONVERTED" || msg === "ALREADY_CONVERTED") {
      return NextResponse.json(
        {
          error: "该线索已转入销售 CRM",
          converted: {
            salesCustomerId: p.convertedToSalesCustomerId,
            salesOpportunityId: p.convertedToSalesOpportunityId,
            convertedAt: p.convertedAt?.toISOString() ?? null,
            convertedById: p.convertedById,
          },
        },
        { status: 409 },
      );
    }
    if (msg.startsWith("缺少") || msg.includes("不属于")) {
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    console.error("[convert-to-sales]", e);
    return NextResponse.json({ error: msg || "转换失败" }, { status: 500 });
  }
}
