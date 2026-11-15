/**
 * GET /api/org/tender-rfq/tracker?orgId=&project=&summary=1 — T-2 询价追踪页（只读；summary=1 只要计数，给 /bids 汇总卡）
 *
 * 组织按登录者解析（resolveRequestOrgIdForUser；apiFetch 对 /api/org/ 自动带 orgId），项目按可见规则过滤。
 * 返回按白名单组装：报价字段与比价矩阵的落地价 / 最便宜 / 换算不出的原因；不含估值、我方报价、毛利。
 */
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { resolveRequestOrgIdForUser } from "@/lib/auth/resolve-request-org";
import { loadTracker } from "@/lib/tender-rfq/tracker";

export const GET = withAuth(async (request, _ctx, user) => {
  const { searchParams } = new URL(request.url);
  const orgRes = await resolveRequestOrgIdForUser(user, searchParams.get("orgId"));
  if (!orgRes.ok) return orgRes.response;
  const projectId = (searchParams.get("project") ?? "").trim() || null;
  const summaryOnly = searchParams.get("summary") === "1";
  const payload = await loadTracker({ request, user, orgId: orgRes.orgId, projectId, summaryOnly });
  return NextResponse.json(payload);
});
