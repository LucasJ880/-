import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { resolveRequestOrgIdForUser } from "@/lib/auth/resolve-request-org";
import {
  canEditPlaybookDraft,
  canReadPlaybook,
  getGroupPlaybookById,
  updateGroupPlaybookDraft,
} from "@/lib/operations/playbook";

export const GET = withAuth<{ groupId: string; playbookId: string }>(async (request, ctx, user) => {
  if (!canReadPlaybook(user.role)) {
    return NextResponse.json({ error: "无权查看组 Playbook" }, { status: 403 });
  }
  const { groupId, playbookId } = await ctx.params;
  const orgRes = await resolveRequestOrgIdForUser(
    user,
    request.nextUrl.searchParams.get("orgId"),
  );
  if (!orgRes.ok) return orgRes.response;

  try {
    const playbook = await getGroupPlaybookById(orgRes.orgId, playbookId);
    if (playbook.groupId !== groupId) {
      return NextResponse.json({ error: "Playbook 与账号组不匹配" }, { status: 400 });
    }
    return NextResponse.json({ playbook });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "加载失败" },
      { status: 400 },
    );
  }
});

export const PATCH = withAuth<{ groupId: string; playbookId: string }>(async (request, ctx, user) => {
  if (!canEditPlaybookDraft(user.role)) {
    return NextResponse.json({ error: "无权编辑组 Playbook" }, { status: 403 });
  }
  const { groupId, playbookId } = await ctx.params;
  const body = await request.json().catch(() => ({}));
  const orgRes = await resolveRequestOrgIdForUser(user, body.orgId);
  if (!orgRes.ok) return orgRes.response;

  try {
    const existing = await getGroupPlaybookById(orgRes.orgId, playbookId);
    if (existing.groupId !== groupId) {
      return NextResponse.json({ error: "Playbook 与账号组不匹配" }, { status: 400 });
    }
    const playbook = await updateGroupPlaybookDraft({
      orgId: orgRes.orgId,
      playbookId,
      content: body.content ?? body,
      changeSummary: body.changeSummary ? String(body.changeSummary) : undefined,
    });
    return NextResponse.json({ playbook });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "保存失败" },
      { status: 400 },
    );
  }
});
