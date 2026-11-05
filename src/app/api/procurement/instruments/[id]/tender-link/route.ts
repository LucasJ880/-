/** POST /api/procurement/instruments/{id}/tender-link（org_member+）：{ projectId, relation: CURRENT | PREDECESSOR | RELATED_HISTORY, note? }（前序 ≠ 编号别名） */
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { readJson, requireInstrumentAccess, schemaGate, serviceResponse } from "@/lib/procurement-records/access";
import { linkInstrumentToTender } from "@/lib/procurement-records/requests";

export const POST = withAuth<{ id: string }>(async (request, ctx, user) => {
  const gate = schemaGate("write");
  if (gate) return gate;
  const { id } = await ctx.params;
  const a = await requireInstrumentAccess(user, id, "org_member");
  if (a instanceof NextResponse) return a;
  const b = await readJson(request);
  const r = await linkInstrumentToTender({ orgId: a.orgId, userId: user.id, projectId: String(b.projectId ?? ""), instrumentId: id, relation: String(b.relation ?? "RELATED_HISTORY") as never, note: typeof b.note === "string" ? b.note : null });
  if (!r.ok) return serviceResponse(r);
  return NextResponse.json({ ok: true });
});
