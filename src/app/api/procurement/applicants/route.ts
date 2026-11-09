/**
 * /api/procurement/applicants?orgId
 *   GET  申请人资料列表（org_member+）
 *   POST 新建（org_admin+；未确认状态；不从历史来信带出地址）
 */
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { readJson, requireProcurementOrg, schemaGate, serviceResponse } from "@/lib/procurement-records/access";
import { listApplicants, saveApplicant } from "@/lib/procurement-records/applicants";

export const GET = withAuth(async (request, _ctx, user) => {
  const gate = schemaGate("read");
  if (gate) return gate;
  const a = await requireProcurementOrg(user, request.nextUrl.searchParams.get("orgId"), "org_member");
  if (a instanceof NextResponse) return a;
  return NextResponse.json({ available: true, items: await listApplicants(a.orgId) });
});

export const POST = withAuth(async (request, _ctx, user) => {
  const gate = schemaGate("write");
  if (gate) return gate;
  const a = await requireProcurementOrg(user, request.nextUrl.searchParams.get("orgId"), "org_admin");
  if (a instanceof NextResponse) return a;
  const r = await saveApplicant({ orgId: a.orgId, userId: user.id, body: await readJson(request) });
  if (!r.ok) return serviceResponse(r);
  return NextResponse.json({ ok: true, applicant: r.applicant });
});
