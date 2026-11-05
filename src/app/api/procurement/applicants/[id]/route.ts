/** PUT /api/procurement/applicants/{id}?orgId（org_admin+）：修改即版本 +1 并回到未确认 */
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { readJson, requireProcurementOrg, schemaGate, serviceResponse } from "@/lib/procurement-records/access";
import { saveApplicant } from "@/lib/procurement-records/applicants";

export const PUT = withAuth<{ id: string }>(async (request, ctx, user) => {
  const gate = schemaGate("write");
  if (gate) return gate;
  const a = await requireProcurementOrg(user, request.nextUrl.searchParams.get("orgId"), "org_admin");
  if (a instanceof NextResponse) return a;
  const { id } = await ctx.params;
  const r = await saveApplicant({ orgId: a.orgId, userId: user.id, id, body: await readJson(request) });
  if (!r.ok) return serviceResponse(r);
  return NextResponse.json({ ok: true, applicant: r.applicant });
});
