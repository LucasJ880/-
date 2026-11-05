/**
 * /api/procurement/watch（PROC-1 · spec procurement/watch-scan）
 *   GET ?orgId  监控配置、启用状态、下一次运行、最近运行与最近实际成功运行、来源能力与结果（org_viewer+）
 *   PUT ?orgId  保存配置（首次保存即创建，默认未启用）（org_admin+）
 */
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { readJson, requireProcurementOrg, schemaGate, serviceResponse } from "@/lib/procurement-records/access";
import { getWatchView, saveWatchConfig } from "@/lib/procurement-records/watch-service";

export const GET = withAuth(async (request, _ctx, user) => {
  const gate = schemaGate("read");
  if (gate) return gate;
  const a = await requireProcurementOrg(user, request.nextUrl.searchParams.get("orgId"), "org_viewer");
  if (a instanceof NextResponse) return a;
  return NextResponse.json({ available: true, orgId: a.orgId, canManage: ["org_admin", "org_owner"].includes(a.orgRole), watch: await getWatchView(a.orgId) });
});

export const PUT = withAuth(async (request, _ctx, user) => {
  const gate = schemaGate("write");
  if (gate) return gate;
  const a = await requireProcurementOrg(user, request.nextUrl.searchParams.get("orgId"), "org_admin");
  if (a instanceof NextResponse) return a;
  const r = await saveWatchConfig({ orgId: a.orgId, userId: user.id, body: await readJson(request) });
  if (!r.ok) return serviceResponse(r);
  return NextResponse.json({ ok: true, created: r.created, watch: await getWatchView(a.orgId) });
});
