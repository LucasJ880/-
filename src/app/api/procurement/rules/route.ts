/** GET /api/procurement/rules?orgId（org_member+）：机关申请规则（种子未核实；未知费用为 null） */
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { requireProcurementOrg, schemaGate } from "@/lib/procurement-records/access";
import { listRules } from "@/lib/procurement-records/rules";

export const GET = withAuth(async (request, _ctx, user) => {
  const gate = schemaGate("read");
  if (gate) return gate;
  const a = await requireProcurementOrg(user, request.nextUrl.searchParams.get("orgId"), "org_member");
  if (a instanceof NextResponse) return a;
  return NextResponse.json({ available: true, items: await listRules(a.orgId) });
});
