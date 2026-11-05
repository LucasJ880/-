/**
 * /api/procurement/requests/{id}
 *   GET   申请详情：中英文、版本、READY 闸、重复检查（覆盖 / 新增段）、规则、申请人、时间线、附件、明细、分析、待办（org_viewer+）
 *   PATCH 保存草稿（任何正文 / 范围变动新增版本；READY 回到 DRAFT；已提交版本不被覆盖；org_member+）
 */
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { readJson, requireRequestAccess, schemaGate, serviceResponse } from "@/lib/procurement-records/access";
import { saveDraft, type DraftPatch } from "@/lib/procurement-records/requests";
import { getRequestDetail } from "@/lib/procurement-records/views";

export const GET = withAuth<{ id: string }>(async (_request, ctx, user) => {
  const gate = schemaGate("read");
  if (gate) return gate;
  const { id } = await ctx.params;
  const a = await requireRequestAccess(user, id, "org_viewer");
  if (a instanceof NextResponse) return a;
  const detail = await getRequestDetail(id);
  // 只读角色看不到申请人联系信息（地址 / 邮箱 / 电话）；准备与提交申请的成员才需要
  if (detail && a.orgRole === "org_viewer") {
    const mask = <T extends Record<string, unknown> | null>(o: T): T =>
      o ? ({ ...o, addressLine1: null, addressLine2: null, city: null, postalCode: null, email: null, phone: null } as T) : o;
    detail.applicant = mask(detail.applicant);
    if (detail.currentVersion) detail.currentVersion = { ...detail.currentVersion, applicantSnapshot: mask(detail.currentVersion.applicantSnapshot as Record<string, unknown> | null) as never };
  }
  return NextResponse.json({ available: true, canManage: ["org_admin", "org_owner"].includes(a.orgRole), canEdit: a.orgRole !== "org_viewer", request: detail });
});

const PATCH_KEYS: Array<keyof DraftPatch> = [
  "title", "recipientInstitution", "recordsHolderBasis", "channel", "pathType", "applicantProfileId", "purposeZh", "gapsZh",
  "startDate", "endDate", "categories", "instrumentNumbers", "bodyEn", "regenerateBody", "overlapReason", "projectId",
];

export const PATCH = withAuth<{ id: string }>(async (request, ctx, user) => {
  const gate = schemaGate("write");
  if (gate) return gate;
  const { id } = await ctx.params;
  const a = await requireRequestAccess(user, id, "org_member");
  if (a instanceof NextResponse) return a;
  const b = await readJson(request);
  const patch: DraftPatch = {};
  for (const k of PATCH_KEYS) if (k in b) (patch as Record<string, unknown>)[k] = b[k];
  const r = await saveDraft({ requestId: id, userId: user.id, patch });
  if (!r.ok) return serviceResponse(r);
  return NextResponse.json({ ok: true, versionNo: r.versionNo, bodyMayBeStale: r.bodyMayBeStale, request: await getRequestDetail(id) });
});
