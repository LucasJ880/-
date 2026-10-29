/**
 * POST /api/install/repairs/[id]/visit-email  JSON { orgId? }
 * INSTALL-2j：重新生成返修时间确认邮件审批（spec installation/repair-visit-email「返修时间确认邮件状态与重新生成」）。
 * - 需 install.task.assign（ORG）→ 403；他企业 404
 * - 没有未完成的返修预约 → 409 NO_SCHEDULE；该返修时间已发送 → 409 ALREADY_SENT
 * - 已有待批准 → 200 + 该审批；缺资料 → 200 + blocked 与原因；否则生成新审批（批准人 = 调用人）
 * - 收件人只取客户档案；请求体除 orgId 外不读
 */
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { resolveRequestOrgIdForUser } from "@/lib/auth/resolve-request-org";
import { loadRepairHolder } from "@/lib/install/repair-service";
import { generateRepairVisitEmail } from "@/lib/install/repair-visit-email-service";

export const POST = withAuth<{ id: string }>(async (request, ctx, user) => {
  const { id } = await ctx.params;
  let body: Record<string, unknown> = {};
  try {
    body = ((await request.json()) as Record<string, unknown>) ?? {};
  } catch {
    body = {};
  }
  const orgRes = await resolveRequestOrgIdForUser(user, typeof body.orgId === "string" ? body.orgId : request.nextUrl.searchParams.get("orgId"));
  if (!orgRes.ok) return orgRes.response;
  const holder = await loadRepairHolder(user, orgRes.orgId);
  if (!holder.canAssign) return NextResponse.json({ error: "只有运营 / 会计 / 老板岗位可以生成返修时间确认邮件", code: "FORBIDDEN" }, { status: 403 });
  const g = await generateRepairVisitEmail({ orgId: orgRes.orgId, repairId: id, approverUserId: user.id });
  if (g.kind === "not_found") return NextResponse.json({ error: "维修单不存在", code: "NOT_FOUND" }, { status: 404 });
  if (g.kind === "no_schedule") return NextResponse.json({ error: "维修单没有未完成的返修安排", code: "NO_SCHEDULE" }, { status: 409 });
  if (g.kind === "error") return NextResponse.json({ error: g.message, code: "APPROVAL_FAILED" }, { status: 500 });
  if (g.kind === "sent") return NextResponse.json({ error: "这个返修时间的确认邮件已发送", code: "ALREADY_SENT", visitEmail: g.view }, { status: 409 });
  return NextResponse.json({ visitEmail: g.view }, { status: 200 });
});
