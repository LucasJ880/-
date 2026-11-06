/** POST /api/procurement/rules/{id}/field-observation?orgId（org_member+）：{ ourField, portalLabel }——只记实际观察到的门户字段 */
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { readJson, requireProcurementOrg, schemaGate } from "@/lib/procurement-records/access";
import { recordFieldObservation } from "@/lib/procurement-records/rules";

export const POST = withAuth<{ id: string }>(async (request, ctx, user) => {
  const gate = schemaGate("write");
  if (gate) return gate;
  const a = await requireProcurementOrg(user, request.nextUrl.searchParams.get("orgId"), "org_member");
  if (a instanceof NextResponse) return a;
  const { id } = await ctx.params;
  const b = await readJson(request);
  if (typeof b.ourField !== "string" || typeof b.portalLabel !== "string" || !b.portalLabel.trim()) {
    return NextResponse.json({ error: "请填写我方字段与实际观察到的门户字段名", code: "INVALID_OBSERVATION" }, { status: 400 });
  }
  const r = await recordFieldObservation({ orgId: a.orgId, ruleId: id, userId: user.id, ourField: b.ourField, portalLabel: b.portalLabel });
  if (!r.ok) return NextResponse.json({ error: "规则不存在", code: r.code }, { status: r.status });
  return NextResponse.json({ ok: true });
});
