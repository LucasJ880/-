/**
 * GET  — 账号组 Playbook 版本列表
 * POST — 创建组策略草稿
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { resolveRequestOrgIdForUser } from "@/lib/auth/resolve-request-org";
import {
  canEditPlaybookDraft,
  canReadPlaybook,
  createGroupPlaybookDraft,
  listGroupPlaybooks,
} from "@/lib/operations/playbook";

export const GET = withAuth<{ groupId: string }>(async (request, ctx, user) => {
  if (!canReadPlaybook(user.role)) {
    return NextResponse.json({ error: "无权查看组 Playbook" }, { status: 403 });
  }
  const { groupId } = await ctx.params;
  const orgRes = await resolveRequestOrgIdForUser(
    user,
    request.nextUrl.searchParams.get("orgId"),
  );
  if (!orgRes.ok) return orgRes.response;

  try {
    const playbooks = await listGroupPlaybooks(orgRes.orgId, groupId);
    return NextResponse.json({ playbooks });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "加载失败" },
      { status: 400 },
    );
  }
});

export const POST = withAuth<{ groupId: string }>(async (request, ctx, user) => {
  if (!canEditPlaybookDraft(user.role)) {
    return NextResponse.json({ error: "无权创建组 Playbook 草稿" }, { status: 403 });
  }
  const { groupId } = await ctx.params;
  const body = await request.json().catch(() => ({}));
  const orgRes = await resolveRequestOrgIdForUser(user, body.orgId);
  if (!orgRes.ok) return orgRes.response;

  try {
    const playbook = await createGroupPlaybookDraft({
      orgId: orgRes.orgId,
      groupId,
      userId: user.id,
      basedOnPlaybookId: body.basedOnPlaybookId
        ? String(body.basedOnPlaybookId)
        : undefined,
      content: body.content,
      changeSummary: body.changeSummary
        ? String(body.changeSummary)
        : undefined,
    });
    return NextResponse.json({ playbook }, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "创建失败" },
      { status: 400 },
    );
  }
});
