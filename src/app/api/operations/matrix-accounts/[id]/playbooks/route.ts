/**
 * GET  — 账号 Playbook 版本列表
 * POST — 创建草稿（可 basedOnPlaybookId）
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { resolveRequestOrgIdForUser } from "@/lib/auth/resolve-request-org";
import {
  canEditPlaybookDraft,
  canReadPlaybook,
  createPlaybookDraft,
  listPlaybooksForAccount,
} from "@/lib/operations/playbook";

export const GET = withAuth<{ id: string }>(async (request, ctx, user) => {
  if (!canReadPlaybook(user.role)) {
    return NextResponse.json({ error: "无权查看 Playbook" }, { status: 403 });
  }
  const { id: accountId } = await ctx.params;
  const orgRes = await resolveRequestOrgIdForUser(
    user,
    request.nextUrl.searchParams.get("orgId"),
  );
  if (!orgRes.ok) return orgRes.response;

  try {
    const playbooks = await listPlaybooksForAccount(orgRes.orgId, accountId);
    return NextResponse.json({ playbooks });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "加载失败" },
      { status: 400 },
    );
  }
});

export const POST = withAuth<{ id: string }>(async (request, ctx, user) => {
  if (!canEditPlaybookDraft(user.role)) {
    return NextResponse.json({ error: "无权创建 Playbook 草稿" }, { status: 403 });
  }
  const { id: accountId } = await ctx.params;
  const body = await request.json().catch(() => ({}));
  const orgRes = await resolveRequestOrgIdForUser(user, body.orgId);
  if (!orgRes.ok) return orgRes.response;

  try {
    const playbook = await createPlaybookDraft({
      orgId: orgRes.orgId,
      accountId,
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
