import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import { resolveRequestOrgIdForUser } from "@/lib/auth/resolve-request-org";
import { requireMarketingWriteAccess } from "@/lib/marketing/access";
import { logAudit } from "@/lib/audit/logger";
import {
  isMarketingChannelProvider,
  MARKETING_CHANNEL_PROVIDERS,
  PROVIDER_LABELS,
} from "@/lib/marketing/channel-providers";

export const GET = withAuth(async (request, _ctx, user) => {
  const orgRes = await resolveRequestOrgIdForUser(
    user,
    request.nextUrl.searchParams.get("orgId"),
  );
  if (!orgRes.ok) return orgRes.response;
  const accounts = await db.marketingChannelAccount.findMany({
    where: { orgId: orgRes.orgId },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({
    accounts,
    providers: MARKETING_CHANNEL_PROVIDERS.map((key) => ({
      key,
      label: PROVIDER_LABELS[key],
    })),
  });
});

export const POST = withAuth(async (request, _ctx, user) => {
  const body = await request.json().catch(() => ({}));
  const orgRes = await resolveRequestOrgIdForUser(user, body.orgId);
  if (!orgRes.ok) return orgRes.response;
  const denied = await requireMarketingWriteAccess(user, orgRes.orgId);
  if (denied) return denied;

  const provider = String(body.provider || "manual");
  const name = String(body.name || "").trim();
  if (!isMarketingChannelProvider(provider) || !name) {
    return NextResponse.json(
      {
        error: `provider 或 name 无效。provider 可选：${MARKETING_CHANNEL_PROVIDERS.join(", ")}`,
      },
      { status: 400 },
    );
  }

  const account = await db.marketingChannelAccount.create({
    data: {
      orgId: orgRes.orgId,
      provider,
      name: name.slice(0, 200),
      externalAccountId: body.externalAccountId
        ? String(body.externalAccountId).slice(0, 200)
        : null,
      status: provider === "manual" ? "manual" : "paused",
      providerConfig: body.providerConfig ?? undefined,
      createdById: user.id,
    },
  });

  await logAudit({
    userId: user.id,
    orgId: orgRes.orgId,
    action: "marketing_channel_account_create",
    targetType: "marketing_channel_account",
    targetId: account.id,
    afterData: { provider, name, status: account.status },
    request,
  });

  return NextResponse.json({ account }, { status: 201 });
});
