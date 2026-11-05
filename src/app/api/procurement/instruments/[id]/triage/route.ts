/** POST /api/procurement/instruments/{id}/triage（org_member+）：{ triageStatus: CANDIDATE | WATCHING | IGNORED | ARCHIVED } */
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { readJson, requireInstrumentAccess, schemaGate, serviceResponse } from "@/lib/procurement-records/access";
import { setTriage } from "@/lib/procurement-records/requests";

export const POST = withAuth<{ id: string }>(async (request, ctx, user) => {
  const gate = schemaGate("write");
  if (gate) return gate;
  const { id } = await ctx.params;
  const a = await requireInstrumentAccess(user, id, "org_member");
  if (a instanceof NextResponse) return a;
  const b = await readJson(request);
  const r = await setTriage({ orgId: a.orgId, userId: user.id, instrumentId: id, triageStatus: String(b.triageStatus) as never });
  if (!r.ok) return serviceResponse(r);
  return NextResponse.json({ ok: true });
});
