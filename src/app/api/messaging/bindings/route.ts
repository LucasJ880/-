/**
 * 微信绑定管理 API
 *
 * GET  /api/messaging/bindings — 获取当前用户的所有微信绑定
 * POST /api/messaging/bindings — 创建/更新绑定；action=update_preferences / remove 只作用于本人的绑定
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import { findBindingsByUser, createBinding, updateBindingPreferences, removeBinding, sanitizeBindingPreferences } from "@/lib/messaging";

export const GET = withAuth(async (_req, _ctx, user) => {
  const bindings = await findBindingsByUser(user.id);
  return NextResponse.json({ bindings });
});

export const POST = withAuth(async (req, _ctx, user) => {
  const body = await req.json();
  const { action } = body;

  // 偏好 / 解绑：只能操作本人的绑定（别人的 bindingId 按不存在处理，不泄露是否存在）
  if (action === "update_preferences") {
    const { bindingId, ...rest } = body;
    if (typeof bindingId !== "string" || !bindingId) return NextResponse.json({ error: "缺少 bindingId" }, { status: 400 });
    const updated = await updateBindingPreferences(user.id, bindingId, sanitizeBindingPreferences(rest));
    if (!updated) return NextResponse.json({ error: "绑定不存在" }, { status: 404 });
    return NextResponse.json({ ok: true });
  }

  if (action === "remove") {
    const { bindingId } = body;
    if (typeof bindingId !== "string" || !bindingId) return NextResponse.json({ error: "缺少 bindingId" }, { status: 400 });
    const removed = await removeBinding(user.id, bindingId);
    if (!removed) return NextResponse.json({ error: "绑定不存在" }, { status: 404 });
    return NextResponse.json({ ok: true });
  }

  // 默认：创建绑定（优先当前工作组织）
  const { resolvePreferredOrgId } = await import("@/lib/organizations/active-org");
  const preferred = await resolvePreferredOrgId(user.id, user.role);
  const orgId =
    preferred.orgId ??
    (
      await db.organizationMember.findFirst({
        where: { userId: user.id },
        select: { orgId: true },
      })
    )?.orgId;

  const channel = body.channel === "wecom" ? "wecom" : body.channel === "personal_wechat" ? "personal_wechat" : null;
  const externalId = typeof body.externalId === "string" ? body.externalId.trim() : "";
  if (!channel || !externalId) {
    return NextResponse.json({ error: "缺少 channel 或 externalId" }, { status: 400 });
  }

  const binding = await createBinding({
    userId: user.id,
    orgId,
    channel,
    externalId,
    displayName: body.displayName,
  });

  return NextResponse.json({ binding });
});
