/**
 * POST /api/projects/[id]/tender-rfq/chase — T-2 询价追踪页「现在就催」
 *
 * 项目写权限；只为这个项目这一轮里指定的 1–8 家起草催单审批卡（与 Muse chase 同一规则，不看天数），不发信。
 * 返回新卡（附审批信息与正文）与跳过的人话原因。
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireProjectWriteAccess } from "@/lib/projects/access";
import { draftChasesForProject } from "@/lib/tender-rfq/chase-service";
import { chaseSkipZh } from "@/lib/tender-rfq/tracker-pure";
import { loadRfqApprovalInfo, loadRfqSendEmails } from "@/lib/tender-rfq/web-entry-approval";
import { friendlyExecutionError } from "@/lib/tender-rfq/web-entry-pure";

type Params = { params: Promise<{ id: string }> };

const bodySchema = z
  .object({
    inquiryId: z.string().min(1).max(64),
    itemIds: z.array(z.string().min(1).max(64)).min(1).max(8),
  })
  .strict();

export async function POST(request: NextRequest, { params }: Params) {
  const { id: projectId } = await params;
  const access = await requireProjectWriteAccess(request, projectId);
  if (access instanceof NextResponse) return access;
  const orgId = access.project.orgId;
  if (!orgId) return NextResponse.json({ error: "这个项目不属于任何组织，不能起草催单" }, { status: 400 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "参数不合法" }, { status: 400 });

  const r = await draftChasesForProject({ orgId, userId: access.user.id, projectId, inquiryId: parsed.data.inquiryId, itemIds: parsed.data.itemIds });
  if (!r.ok) return NextResponse.json({ error: r.message }, { status: r.errorCode === "PROJECT_NOT_FOUND" ? 404 : 400 });

  const actionIds = r.run.drafted.map((d) => d.actionId);
  const [approvals, emails] = await Promise.all([
    loadRfqApprovalInfo(request, access.user, orgId, actionIds),
    loadRfqSendEmails(orgId, actionIds),
  ]);
  return NextResponse.json({
    drafted: r.run.drafted.map((d) => ({ itemId: d.itemId, supplierName: d.supplierName, actionId: d.actionId, chaseKind: d.kind, chaseIndex: d.chaseIndex, approval: approvals[d.actionId] ?? null, emails: emails[d.actionId] ?? [] })),
    skipped: r.run.skipped.map((s) => ({ itemId: s.itemId, supplierName: s.supplierName, reasonZh: chaseSkipZh(s.reason) })),
    failed: r.run.failed.map((f) => ({ itemId: f.itemId, supplierName: f.supplierName, reasonZh: friendlyExecutionError(f.error) })),
  });
}
