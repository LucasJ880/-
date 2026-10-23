/**
 * GET / PUT /api/trade/email-profile — 跟进邮件里的公司资料（公司介绍、数字、工厂照片、业务员全名职务、规格书口径）
 *
 * PUT JSON：{ orgId?, accent, logoUrl, website, whatsapp, companyLine, facts, factImageUrl, address, specWording, videoCall, team }；
 * facts / team 可传多行文本（「数值 | 说明」「卡上名字 | 全名 | 职务 | WhatsApp」）。发布为新版本。
 * GET ?sample=1 → 用当前资料渲染一封样例首封（Emma / 两款参考款），给设置页预览。
 */

import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { composeBoothFirstEmail } from "@/lib/revenue-spine/booth-email";
import {
  emailProfileToForm,
  loadEmailBranding,
  parseEmailProfile,
  profileGuardrailErrors,
  saveEmailProfile,
  signatureFor,
  type EmailProfile,
} from "@/lib/revenue-spine/email-profile";
import { resolveTradeOrgId } from "@/lib/trade/access";

const PROFILE_ROLES = ["boss", "manager", "admin"];

function sample(profile: EmailProfile, orgName: string, replyEmail: string | null): string | null {
  const name = profile.team[0]?.cardName ?? "Cathy";
  return composeBoothFirstEmail(
    {
      orgName,
      contactName: "Emma Novak",
      event: "the 140th Canton Fair (Booth 14.3E07)",
      product: null,
      styles: [
        { code: "MX-BL-001", name: "Flannel Coral Fleece Blanket", specUrl: profile.website ? `${profile.website.replace(/\/$/, "")}/products/blankets/flannel-coral-fleece-blanket` : null },
        { code: "MX-BR-001", name: "Coral Fleece Bathrobe", specUrl: profile.website ? `${profile.website.replace(/\/$/, "")}/products/bathrobes/coral-fleece-bathrobe-mx-br-001` : null },
      ],
      noted: ["private label for a retail chain"],
      missing: ["quantity", "destinationCountry"],
      signature: signatureFor(profile, name, orgName),
      profile,
      replyEmail: replyEmail ?? "sales@example.com",
    },
    "en",
  ).html;
}

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, PROFILE_ROLES);
  if (auth instanceof NextResponse) return auth;
  const orgRes = await resolveTradeOrgId(request, auth.user);
  if (!orgRes.ok) return orgRes.response;
  const org = await db.organization.findUnique({ where: { id: orgRes.orgId }, select: { name: true } });
  const { profile, replyEmail } = await loadEmailBranding(orgRes.orgId, org?.name ?? "");
  if (request.nextUrl.searchParams.get("sample") === "1") {
    return NextResponse.json({ html: sample(profile, org?.name ?? "", replyEmail) });
  }
  return NextResponse.json({ profile: emailProfileToForm(profile), replyEmail });
}

export async function PUT(request: NextRequest) {
  const auth = await requireRole(request, PROFILE_ROLES);
  if (auth instanceof NextResponse) return auth;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "请求体不是 JSON" }, { status: 400 });
  const orgRes = await resolveTradeOrgId(request, auth.user, {
    bodyOrgId: typeof body.orgId === "string" ? body.orgId : null,
  });
  if (!orgRes.ok) return orgRes.response;

  const { profile, errors } = parseEmailProfile(body);
  if (!profile) return NextResponse.json({ error: errors[0], errors }, { status: 422 });
  const promises = profileGuardrailErrors(profile);
  if (promises.length) return NextResponse.json({ error: promises[0], errors: promises }, { status: 422 });
  const { version } = await saveEmailProfile(orgRes.orgId, profile, auth.user.id);
  return NextResponse.json({ profile: emailProfileToForm(profile), version });
}
