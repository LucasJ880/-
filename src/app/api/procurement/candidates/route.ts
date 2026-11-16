/**
 * GET /api/procurement/candidates?orgId&triage&q&view（org_viewer+）：候选与已关注采购工具（按优先级排序，含理由与证据计数）。
 * view=new（P2-1）：只看未截标的招标公告，按发布日期从新到旧；每行带 publishedAt 与 noticeUrl。
 * P2-2：新标视图每行带 fit（匹配度，按看的人可见的项目计算，不是中标概率）；sort=fit 按匹配度排序。
 */
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { requireProcurementOrg, schemaGate } from "@/lib/procurement-records/access";
import { listCandidates } from "@/lib/procurement-records/views";

export const GET = withAuth(async (request, _ctx, user) => {
  const gate = schemaGate("read");
  if (gate) return gate;
  const sp = request.nextUrl.searchParams;
  const a = await requireProcurementOrg(user, sp.get("orgId"), "org_viewer");
  if (a instanceof NextResponse) return a;
  return NextResponse.json({ available: true, items: await listCandidates(a.orgId, { triage: sp.get("triage"), q: sp.get("q"), view: sp.get("view"), sort: sp.get("sort"), viewer: { id: user.id, role: user.role } }) });
});
