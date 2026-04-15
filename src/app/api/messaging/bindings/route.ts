/**
 * 微信绑定管理 API
 *
 * GET  /api/messaging/bindings — 获取当前用户的所有微信绑定
 * POST /api/messaging/bindings — 创建/更新绑定
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import { findBindingsByUser, createBinding, updateBindingPreferences, removeBinding } from "@/lib/messaging";

export const GET = withAuth(async (_req, _ctx, user) => {
  const bindings = await findBindingsByUser(user.id);
  return NextResponse.json({ bindings });
});

export const POST = withAuth(async (req, _ctx, user) => {
  const body = await req.json();
  const { action } = body;

  if (action === "update_preferences") {
    const { bindingId, ...prefs } = body;
    if (!bindingId) return NextResponse.json({ error: "缺少 bindingId" }, { status: 400 });
    await updateBindingPreferences(bindingId, prefs);
    return NextResponse.json({ ok: true });
  }

  if (action === "remove") {
    const { bindingId } = body;
    if (!bindingId) return NextResponse.json({ error: "缺少 bindingId" }, { status: 400 });
    await removeBinding(bindingId);
    return NextResponse.json({ ok: true });
  }

  // 默认：创建绑定
  const membership = await db.organizationMember.findFirst({
    where: { userId: user.id },
    select: { orgId: true },
  });

  const binding = await createBinding({
    userId: user.id,
    orgId: membership?.orgId,
    channel: body.channel,
    externalId: body.externalId,
    displayName: body.displayName,
  });

  return NextResponse.json({ binding });
});
