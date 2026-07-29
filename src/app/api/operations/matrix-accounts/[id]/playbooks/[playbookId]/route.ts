/**
 * GET   — 单版本详情
 * PATCH — 更新草稿内容
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { resolveRequestOrgIdForUser } from "@/lib/auth/resolve-request-org";
import {
  canEditPlaybookDraft,
  canReadPlaybook,
  getPlaybookById,
  updatePlaybookDraft,
} from "@/lib/operations/playbook";

export const GET = withAuth<{ id: string; playbookId: string }>(async (request, ctx, user) => {
  if (!canReadPlaybook(user.role)) {
    return NextResponse.json({ error: "无权查看 Playbook" }, { status: 403 });
  }
  const { id: accountId, playbookId } = await ctx.params;
  const orgRes = await resolveRequestOrgIdForUser(
    user,
    request.nextUrl.searchParams.get("orgId"),
  );
  if (!orgRes.ok) return orgRes.response;

  try {
    const playbook = await getPlaybookById(orgRes.orgId, playbookId);
    if (playbook.accountId !== accountId) {
      return NextResponse.json({ error: "Playbook 与账号不匹配" }, { status: 400 });
    }
    return NextResponse.json({ playbook });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "加载失败" },
      { status: 404 },
    );
  }
});

export const PATCH = withAuth<{ id: string; playbookId: string }>(async (request, ctx, user) => {
  if (!canEditPlaybookDraft(user.role)) {
    return NextResponse.json({ error: "无权编辑 Playbook" }, { status: 403 });
  }
  const { id: accountId, playbookId } = await ctx.params;
  const body = await request.json().catch(() => ({}));
  const orgRes = await resolveRequestOrgIdForUser(user, body.orgId);
  if (!orgRes.ok) return orgRes.response;

  try {
    const existing = await getPlaybookById(orgRes.orgId, playbookId);
    if (existing.accountId !== accountId) {
      return NextResponse.json({ error: "Playbook 与账号不匹配" }, { status: 400 });
    }
    const playbook = await updatePlaybookDraft({
      orgId: orgRes.orgId,
      playbookId,
      content: body.content ?? existing,
      changeSummary: body.changeSummary
        ? String(body.changeSummary)
        : undefined,
    });
    return NextResponse.json({ playbook });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "更新失败" },
      { status: 400 },
    );
  }
});
