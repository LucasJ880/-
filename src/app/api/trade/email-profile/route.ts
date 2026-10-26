/**
 * GET / PUT /api/trade/email-profile — 跟进邮件里的公司资料（Logo、主色、公司介绍、数字、工厂照片、页脚地址、视频看样）
 *
 * PUT JSON：{ orgId?, accent, logoUrl, companyLine, facts, factImageUrl, address, videoCall }；
 * facts 可传多行文本（「数值 | 说明」）。发布为新版本。落款 / 对外公司名 / MOQ 交期参考值在策略的 commercialFacts 里。
 * GET ?sample=1 → 用当前资料 + 策略渲染一封样例首封（Emma / 前两款可对外的参考款），给设置页预览。
 */

import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { buyerFacingOrgName, composeBoothFirstEmail, policySignature } from "@/lib/revenue-spine/booth-email";
import { emailProfileToForm, loadEmailBranding, parseEmailProfile, profileGuardrailErrors, saveEmailProfile } from "@/lib/revenue-spine/email-profile";
import { loadRevenueSpinePolicy } from "@/lib/revenue-spine/policy";
import { allowedStyles, buildReferenceLines } from "@/lib/revenue-spine/reply-draft";
import { loadFactoryKnowledge } from "@/lib/revenue-spine/factory-knowledge";
import { loadStyleReferences } from "@/lib/trade/style-references";
import { resolveTradeOrgId } from "@/lib/trade/access";

const PROFILE_ROLES = ["boss", "manager", "admin"];

async function sample(orgId: string, orgName: string): Promise<string | null> {
  const policy = await loadRevenueSpinePolicy(orgId);
  const name = buyerFacingOrgName(policy, orgName, "en");
  const [{ profile, replyEmail }, refs, knowledge] = await Promise.all([
    loadEmailBranding(orgId, name),
    loadStyleReferences(orgId),
    loadFactoryKnowledge(orgId, policy, { productCategory: null }),
  ]);
  const styles = allowedStyles(refs, policy).slice(0, 2);
  const termLines = buildReferenceLines(knowledge, policy, "en");
  return composeBoothFirstEmail(
    {
      orgName: name,
      contactName: "Emma Novak",
      event: "the 140th Canton Fair (Booth 14.3E07)",
      product: null,
      styles: styles.length ? styles : [{ code: "MX-BL-001", name: "Flannel / Coral Fleece Blanket" }],
      noted: ["Packaging: own-brand gift box"],
      missing: ["quantity", "destinationCountry"],
      signature: policySignature(policy, "Cathy", name),
      profile,
      replyEmail: replyEmail ?? "sales@example.com",
      terms: { termLines, sampleLine: null, references: [], pending: ["pricing"], referenceLines: termLines },
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
  if (request.nextUrl.searchParams.get("sample") === "1") {
    return NextResponse.json({ html: await sample(orgRes.orgId, org?.name ?? "") });
  }
  const { profile, replyEmail } = await loadEmailBranding(orgRes.orgId, org?.name ?? "");
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
