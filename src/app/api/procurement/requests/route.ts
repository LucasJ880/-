/**
 * /api/procurement/requests?orgId
 *   GET  申请台账（按状态 / 机关 / 项目 / 待办筛选；org_viewer+）
 *   POST 新建申请卡草稿（org_member+）：{ instrumentIds?, instrumentNumbers?, projectId?, pathType?, channel?, jurisdiction?,
 *        recipientInstitution?, recordsHolderBasis?, title?, startDate?, endDate?, categories?, applicantProfileId?, purposeZh?, completedAtiRequestNumbers? }
 */
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { readJson, requireProcurementOrg, schemaGate, serviceResponse } from "@/lib/procurement-records/access";
import { createRequestDraft, type CreateRequestInput } from "@/lib/procurement-records/requests";
import { listRequests } from "@/lib/procurement-records/views";

export const GET = withAuth(async (request, _ctx, user) => {
  const gate = schemaGate("read");
  if (gate) return gate;
  const sp = request.nextUrl.searchParams;
  const a = await requireProcurementOrg(user, sp.get("orgId"), "org_viewer");
  if (a instanceof NextResponse) return a;
  const items = await listRequests(a.orgId, { status: sp.get("status"), institution: sp.get("institution"), projectId: sp.get("projectId"), pendingOnly: sp.get("pending") === "1", includeArchived: sp.get("archived") === "1" });
  return NextResponse.json({ available: true, items });
});

export const POST = withAuth(async (request, _ctx, user) => {
  const gate = schemaGate("write");
  if (gate) return gate;
  const a = await requireProcurementOrg(user, request.nextUrl.searchParams.get("orgId"), "org_member");
  if (a instanceof NextResponse) return a;
  const b = await readJson(request);
  const arr = (k: string) => (Array.isArray(b[k]) ? (b[k] as unknown[]).filter((x): x is string => typeof x === "string") : undefined);
  const str = (k: string) => (typeof b[k] === "string" ? (b[k] as string) : b[k] === null ? null : undefined);
  const input: CreateRequestInput = {
    orgId: a.orgId,
    userId: user.id,
    projectId: str("projectId") ?? null,
    instrumentIds: arr("instrumentIds"),
    instrumentNumbers: arr("instrumentNumbers"),
    pathType: str("pathType") as CreateRequestInput["pathType"],
    channel: str("channel") as CreateRequestInput["channel"],
    jurisdiction: str("jurisdiction") ?? undefined,
    recipientInstitution: str("recipientInstitution"),
    recordsHolderBasis: str("recordsHolderBasis"),
    title: str("title"),
    startDate: str("startDate"),
    endDate: str("endDate"),
    categories: arr("categories"),
    applicantProfileId: str("applicantProfileId"),
    purposeZh: str("purposeZh"),
    completedAtiRequestNumbers: arr("completedAtiRequestNumbers"),
  };
  const r = await createRequestDraft(input);
  if (!r.ok) return serviceResponse(r);
  return NextResponse.json({ ok: true, requestId: r.requestId }, { status: 201 });
});
