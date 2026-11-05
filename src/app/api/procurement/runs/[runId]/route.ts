/** GET /api/procurement/runs/{runId}?orgId（org_viewer+）：运行进度、每来源结果、计数、截断（只限本组织） */
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { requireProcurementOrg, schemaGate } from "@/lib/procurement-records/access";
import { getRunView } from "@/lib/procurement-records/watch-service";

export const GET = withAuth<{ runId: string }>(async (request, ctx, user) => {
  const gate = schemaGate("read");
  if (gate) return gate;
  const a = await requireProcurementOrg(user, request.nextUrl.searchParams.get("orgId"), "org_viewer");
  if (a instanceof NextResponse) return a;
  const { runId } = await ctx.params;
  const run = await getRunView(a.orgId, runId);
  if (!run) return NextResponse.json({ error: "运行不存在" }, { status: 404 });
  return NextResponse.json({ available: true, run });
});
