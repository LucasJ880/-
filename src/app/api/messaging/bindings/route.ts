/**
 * 微信绑定管理 API
 *
 * GET  /api/messaging/bindings — 获取当前用户的所有微信绑定
 * POST /api/messaging/bindings — 创建/更新绑定；action=update_preferences / remove 只作用于本人的绑定
 *
 * 创建绑定必须带 bindCode：青砚机器人通过该渠道发给这个外部账号本人的验证码（占有证明，
 * 见 lib/messaging/binding-proof.ts）。别人仍在用的绑定一律不迁移（409），须原账号先解绑。
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import {
  findBindingsByUser,
  createBinding,
  updateBindingPreferences,
  removeBinding,
  sanitizeBindingPreferences,
  normalizeBindCode,
  BIND_CODE_VALID_MINUTES,
  PERSONAL_WECHAT_BIND_COMMAND,
} from "@/lib/messaging";

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
  const channel = body.channel === "wecom" ? "wecom" : body.channel === "personal_wechat" ? "personal_wechat" : null;
  const externalId = typeof body.externalId === "string" ? body.externalId.trim() : "";
  if (!channel || !externalId) {
    return NextResponse.json({ error: "缺少 channel 或 externalId" }, { status: 400 });
  }
  const howToGetCode =
    channel === "wecom"
      ? "请在企业微信里给青砚应用发一条消息，机器人会回复你的 UserId 和验证码"
      : `请用该微信给青砚机器人发送「${PERSONAL_WECHAT_BIND_COMMAND}」，机器人会回复你的微信 ID 和验证码`;
  if (!normalizeBindCode(body.bindCode)) {
    return NextResponse.json({ error: `缺少验证码：${howToGetCode}。`, code: "BIND_CODE_REQUIRED" }, { status: 400 });
  }

  const { resolvePreferredOrgId } = await import("@/lib/organizations/active-org");
  const preferred = await resolvePreferredOrgId(user.id, user.role);
  const orgId =
    preferred.orgId ??
    (
      await db.organizationMember.findFirst({
        where: { userId: user.id, status: "active" },
        select: { orgId: true },
      })
    )?.orgId;

  const result = await createBinding({
    userId: user.id,
    orgId,
    channel,
    externalId,
    bindCode: body.bindCode,
    displayName: typeof body.displayName === "string" ? body.displayName.trim().slice(0, 100) || undefined : undefined,
  });

  if (!result.ok) {
    if (result.reason === "code_unavailable") {
      return NextResponse.json({ error: "绑定验证暂不可用，请联系管理员。", code: "BIND_CODE_UNAVAILABLE" }, { status: 503 });
    }
    if (result.reason === "invalid_code") {
      return NextResponse.json(
        { error: `验证码不正确或已过期（${BIND_CODE_VALID_MINUTES} 分钟内有效）：${howToGetCode}，再填写新的验证码。`, code: "BIND_CODE_INVALID" },
        { status: 400 },
      );
    }
    const label = channel === "wecom" ? "企业微信账号" : "微信";
    return NextResponse.json(
      { error: `该${label}已绑定其他青砚用户。请先用原青砚账号在「设置 → 微信集成」解绑，或联系管理员处理。`, code: "BINDING_OWNED_BY_OTHER_USER" },
      { status: 409 },
    );
  }

  return NextResponse.json({ binding: result.binding, outcome: result.outcome });
});
