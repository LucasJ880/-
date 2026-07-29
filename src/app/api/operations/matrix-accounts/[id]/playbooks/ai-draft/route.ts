import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { resolveRequestOrgIdForUser } from "@/lib/auth/resolve-request-org";
import {
  canEditPlaybookDraft,
  generatePlaybookAiDraft,
} from "@/lib/operations/playbook";

export const POST = withAuth<{ id: string }>(async (request, ctx, user) => {
  if (!canEditPlaybookDraft(user.role)) {
    return NextResponse.json({ error: "无权生成 AI 草稿" }, { status: 403 });
  }
  const { id: accountId } = await ctx.params;
  const body = await request.json().catch(() => ({}));
  const orgRes = await resolveRequestOrgIdForUser(user, body.orgId);
  if (!orgRes.ok) return orgRes.response;

  try {
    const result = await generatePlaybookAiDraft({
      orgId: orgRes.orgId,
      accountId,
      userId: user.id,
      extraNotes: body.extraNotes ? String(body.extraNotes) : undefined,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "AI 生成失败" },
      { status: 400 },
    );
  }
});
