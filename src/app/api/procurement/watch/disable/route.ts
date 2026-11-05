/** POST /api/procurement/watch/disable?orgId（org_admin+）：停用（排队运行取消，候选与案件保留） */
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { requireProcurementOrg, schemaGate } from "@/lib/procurement-records/access";
import { getWatchView, setWatchEnabled } from "@/lib/procurement-records/watch-service";

export const POST = withAuth(async (request, _ctx, user) => {
  const gate = schemaGate("write");
  if (gate) return gate;
  const a = await requireProcurementOrg(user, request.nextUrl.searchParams.get("orgId"), "org_admin");
  if (a instanceof NextResponse) return a;
  const r = await setWatchEnabled({ orgId: a.orgId, userId: user.id, enabled: false });
  if (!r.ok) return NextResponse.json({ error: "请先保存监控配置", code: r.code }, { status: r.status });
  return NextResponse.json({ ok: true, watch: await getWatchView(a.orgId) });
});
