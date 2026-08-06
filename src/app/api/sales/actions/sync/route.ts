import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { resolveSalesOrgIdForRequest, resolveSalesScope } from "@/lib/sales/org-context";
import { syncSalesAutoActions } from "@/lib/sales/auto-action-sync";

export const POST = withAuth(async (request, _ctx, user) => {
  const body = await request.json().catch(() => ({}));
  const orgRes = await resolveSalesOrgIdForRequest(request, user, {
    bodyOrgId: typeof body.orgId === "string" ? body.orgId : null,
  });
  if (!orgRes.ok) return orgRes.response;
  const scope = await resolveSalesScope(user, orgRes.orgId, "sales.customer.update");
  if (!scope.allowed || scope.ownOnly) {
    return NextResponse.json({ error: "只有销售经理可以立即扫描全部销售行动" }, { status: 403 });
  }
  return NextResponse.json({ result: await syncSalesAutoActions(orgRes.orgId, "manual") });
});
