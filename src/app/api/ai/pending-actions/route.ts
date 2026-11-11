/**
 * GET /api/ai/pending-actions
 * 查询当前用户的待审批动作（默认 pending；可选 ?status=xxx、?threadId=xxx）
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import { listMyPendingActions } from "@/lib/approval/pending-mine";
import { resolveAssistantOrgId } from "@/lib/assistant/thread-org";

export const GET = withAuth(async (request, _ctx, user) => {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status") ?? "pending";
  const threadId = searchParams.get("threadId");

  const orgRes = await resolveAssistantOrgId(request, user);
  if (!orgRes.ok) return orgRes.response;

  // 若指定 threadId，必须属于当前 org，否则当作不存在（不泄露跨组织）
  if (threadId) {
    const thread = await db.aiThread.findFirst({
      where: {
        id: threadId,
        userId: user.id,
        orgId: orgRes.orgId,
        archived: false,
      },
      select: { id: true },
    });
    if (!thread) {
      return NextResponse.json({ actions: [] });
    }
  }

  // VIS-1d：处理人范围 ∩ 审批的可见集合 ∩ 当前企业（另含本人的个人草稿），与红点同一组条件
  const actions = await listMyPendingActions(user.id, orgRes.orgId, { status, threadId });

  // 附上所属对话的标题（PR4.5 Inbox 要显示"在哪个对话里产生的"）
  const threadIds = Array.from(
    new Set(actions.map((a) => a.threadId).filter(Boolean) as string[]),
  );
  const threads =
    threadIds.length > 0
      ? await db.aiThread.findMany({
          where: {
            id: { in: threadIds },
            userId: user.id,
            orgId: orgRes.orgId,
          },
          select: { id: true, title: true },
        })
      : [];
  const threadTitleById = new Map(threads.map((t) => [t.id, t.title]));

  const enriched = actions.map((a) => ({
    ...a,
    requesterName: a.createdBy.name || a.createdBy.email,
    approverName: a.approver?.name || a.approver?.email || null,
    createdBy: undefined,
    approver: undefined,
    threadTitle: a.threadId ? (threadTitleById.get(a.threadId) ?? null) : null,
  }));

  return NextResponse.json({ actions: enriched });
});
