/** POST /api/procurement/watch/enable?orgId（org_admin+）：保存并启用（只授权配置内的只读检索、分析与内部草稿；不授权对政府发函或提交） */
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { requireProcurementOrg, schemaGate } from "@/lib/procurement-records/access";
import { getWatchView, setWatchEnabled } from "@/lib/procurement-records/watch-service";

export const POST = withAuth(async (request, _ctx, user) => {
  const gate = schemaGate("write");
  if (gate) return gate;
  const a = await requireProcurementOrg(user, request.nextUrl.searchParams.get("orgId"), "org_admin");
  if (a instanceof NextResponse) return a;
  const r = await setWatchEnabled({ orgId: a.orgId, userId: user.id, enabled: true });
  if (!r.ok) return NextResponse.json({ error: "请先保存监控配置", code: r.code }, { status: r.status });
  return NextResponse.json({ ok: true, watch: await getWatchView(a.orgId) });
});
