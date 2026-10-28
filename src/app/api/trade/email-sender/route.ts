/**
 * GET / PUT / DELETE /api/trade/email-sender — 组织发件身份（批准后的跟进邮件、外贸收件箱回复以谁的名义发出）
 *
 * PUT JSON：{ orgId?, fromName, fromEmail?, replyTo?, bcc? }；发布为新版本。
 * 发件地址只能由平台管理员设置或修改：平台 Resend 账号由各组织共用，组织自己改发件地址就能冒用别家已验证的域名。
 */

import { NextRequest, NextResponse } from "next/server";
import { isPlatformSuperAdmin } from "@/lib/rbac/roles";
import {
  resolveTradeOrgId,
  TRADE_SETTINGS_KEYS,
  requireTradePermission,
  requireTradePlatformAdmin,
} from "@/lib/trade/access";
import { getResendDomainStatus } from "@/lib/trade/email";
import {
  emailDomain,
  loadOrgEmailSender,
  parseOrgEmailSender,
  platformFromAddress,
  saveOrgEmailSender,
  type OrgEmailSender,
} from "@/lib/trade/email-sender";

async function describe(sender: OrgEmailSender | null) {
  return {
    sender,
    platformFrom: platformFromAddress(),
    resendConfigured: Boolean(process.env.RESEND_API_KEY),
    domainStatus: sender?.fromEmail ? await getResendDomainStatus(emailDomain(sender.fromEmail)) : null,
  };
}

export async function GET(request: NextRequest) {
  const auth = await requireTradePermission(request, TRADE_SETTINGS_KEYS);
  if (auth instanceof NextResponse) return auth;
  const orgRes = await resolveTradeOrgId(request, auth.user);
  if (!orgRes.ok) return orgRes.response;

  const sender = await loadOrgEmailSender(orgRes.orgId);
  return NextResponse.json({ ...(await describe(sender)), canEditFromEmail: isPlatformSuperAdmin(auth.user.role) });
}

export async function PUT(request: NextRequest) {
  const auth = await requireTradePermission(request, TRADE_SETTINGS_KEYS);
  if (auth instanceof NextResponse) return auth;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "请求体不是 JSON" }, { status: 400 });
  const orgRes = await resolveTradeOrgId(request, auth.user, {
    bodyOrgId: typeof body.orgId === "string" ? body.orgId : null,
  });
  if (!orgRes.ok) return orgRes.response;

  const { sender, errors } = parseOrgEmailSender(body);
  if (!sender) return NextResponse.json({ error: errors[0], errors }, { status: 422 });

  const current = await loadOrgEmailSender(orgRes.orgId);
  if ((current?.fromEmail ?? null) !== sender.fromEmail && !isPlatformSuperAdmin(auth.user.role)) {
    return NextResponse.json({ error: "发件地址需由平台管理员设置（防止冒用其他公司的域名）", code: "FROM_EMAIL_ADMIN_ONLY" }, { status: 403 });
  }

  const { version } = await saveOrgEmailSender(orgRes.orgId, sender, auth.user.id);
  return NextResponse.json({ ...(await describe(sender)), version, canEditFromEmail: isPlatformSuperAdmin(auth.user.role) });
}

/** 停用组织发件身份（之后回到审批人 Gmail / 平台默认发件人）；只有平台管理员可停用 */
export async function DELETE(request: NextRequest) {
  const auth = await requireTradePlatformAdmin(request);
  if (auth instanceof NextResponse) return auth;
  const orgRes = await resolveTradeOrgId(request, auth.user);
  if (!orgRes.ok) return orgRes.response;

  const { version } = await saveOrgEmailSender(orgRes.orgId, null, auth.user.id);
  return NextResponse.json({ ...(await describe(null)), version, canEditFromEmail: true });
}
