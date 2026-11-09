/** POST /api/procurement/applicants/{id}/confirm?orgId（org_admin+）：{ expectedVersion }——真实用户核对后确认 */
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { readJson, requireProcurementOrg, schemaGate, serviceResponse } from "@/lib/procurement-records/access";
import { confirmApplicant } from "@/lib/procurement-records/applicants";

export const POST = withAuth<{ id: string }>(async (request, ctx, user) => {
  const gate = schemaGate("write");
  if (gate) return gate;
  const a = await requireProcurementOrg(user, request.nextUrl.searchParams.get("orgId"), "org_admin");
  if (a instanceof NextResponse) return a;
  const { id } = await ctx.params;
  const b = await readJson(request);
  const r = await confirmApplicant({ orgId: a.orgId, userId: user.id, id, expectedVersion: Number(b.expectedVersion) });
  if (!r.ok) return serviceResponse(r);
  return NextResponse.json({ ok: true });
});
