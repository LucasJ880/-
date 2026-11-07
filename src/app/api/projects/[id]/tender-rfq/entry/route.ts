/**
 * GET /api/projects/[id]/tender-rfq/entry（W-1）
 *
 * 「问供应商要价」按钮的一切前置信息：能不能发 / 为什么 / 去哪解决、可选供应商、默认条款、将发出的内容摘要、
 * 本项目待批的发送卡（附能否原地批与每家正文）、引擎发出的轮次耗时、自动进表说明。
 * 零副作用：不建轮次、不建审批卡、不发信。
 */

import { NextRequest, NextResponse } from "next/server";
import { requireProjectReadAccess } from "@/lib/projects/access";
import { loadRfqWebEntry } from "@/lib/tender-rfq/web-entry";
import { loadRfqApprovalInfo, loadRfqSendEmails } from "@/lib/tender-rfq/web-entry-approval";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const { id: projectId } = await params;
  const access = await requireProjectReadAccess(request, projectId);
  if (access instanceof NextResponse) return access;

  const orgId = access.project.orgId;
  if (!orgId) return NextResponse.json({ available: false, reason: "not_tender" });

  const entry = await loadRfqWebEntry({ projectId, orgId, userId: access.user.id });
  if (!entry.available) return NextResponse.json(entry);

  const actionIds = entry.pendingSends.map((p) => p.actionId);
  const [approvals, emails] = await Promise.all([
    loadRfqApprovalInfo(request, access.user, orgId, actionIds),
    loadRfqSendEmails(orgId, actionIds),
  ]);

  return NextResponse.json({
    ...entry,
    pendingSends: entry.pendingSends.map((p) => ({
      ...p,
      approval: approvals[p.actionId] ?? null,
      emails: emails[p.actionId] ?? [],
    })),
  });
}
