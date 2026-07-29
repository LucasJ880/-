import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { resolveRequestOrgIdForUser } from "@/lib/auth/resolve-request-org";
import {
  canSubmitPlaybook,
  getPlaybookById,
  submitPlaybook,
} from "@/lib/operations/playbook";

export const POST = withAuth<{ id: string; playbookId: string }>(async (request, ctx, user) => {
  if (!canSubmitPlaybook(user.role)) {
    return NextResponse.json({ error: "无权提交 Playbook" }, { status: 403 });
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
    const playbook = await submitPlaybook({
      orgId: orgRes.orgId,
      playbookId,
      userId: user.id,
    });
    return NextResponse.json({ playbook });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "提交失败" },
      { status: 400 },
    );
  }
});
