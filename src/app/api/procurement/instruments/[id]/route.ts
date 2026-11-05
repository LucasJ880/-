/**
 * /api/procurement/instruments/{id}
 *   GET   采购工具详情：编号 / 别名、三方机构、到期 / options / 重招（未知为 null）、证据、call-up、关系、Tender 关联（org_viewer+）
 *   PATCH 用户维护字段：资料持有机关与依据、到期、剩余 options、确认重招日期（org_admin+；扫描永不覆盖）
 */
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { readJson, requireInstrumentAccess, schemaGate, serviceResponse } from "@/lib/procurement-records/access";
import { updateInstrumentFacts } from "@/lib/procurement-records/requests";
import { getInstrumentDetail } from "@/lib/procurement-records/views";

export const GET = withAuth<{ id: string }>(async (_request, ctx, user) => {
  const gate = schemaGate("read");
  if (gate) return gate;
  const { id } = await ctx.params;
  const a = await requireInstrumentAccess(user, id, "org_viewer");
  if (a instanceof NextResponse) return a;
  return NextResponse.json({ available: true, instrument: await getInstrumentDetail(a.orgId, id) });
});

export const PATCH = withAuth<{ id: string }>(async (request, ctx, user) => {
  const gate = schemaGate("write");
  if (gate) return gate;
  const { id } = await ctx.params;
  const a = await requireInstrumentAccess(user, id, "org_admin");
  if (a instanceof NextResponse) return a;
  const b = await readJson(request);
  const pick = <T,>(k: string) => (k in b ? (b[k] as T) : undefined);
  const r = await updateInstrumentFacts({
    orgId: a.orgId,
    userId: user.id,
    instrumentId: id,
    patch: {
      recordsHolderInstitution: pick<string | null>("recordsHolderInstitution"),
      recordsHolderBasis: pick<string | null>("recordsHolderBasis"),
      currentExpiryAt: pick<string | null>("currentExpiryAt"),
      remainingOptions: pick<number | null>("remainingOptions"),
      confirmedRetenderDate: pick<string | null>("confirmedRetenderDate"),
      contractingInstitution: pick<string | null>("contractingInstitution"),
      buyingInstitution: pick<string | null>("buyingInstitution"),
    },
  });
  if (!r.ok) return serviceResponse(r);
  const { recomputePriority } = await import("@/lib/procurement-records/instruments");
  await recomputePriority(id, new Date());
  return NextResponse.json({ ok: true, instrument: await getInstrumentDetail(a.orgId, id) });
});
