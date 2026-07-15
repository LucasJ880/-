import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { resolveRequestOrgIdForUser } from "@/lib/auth/resolve-request-org";
import { canManageUsers } from "@/lib/rbac/roles";
import { db } from "@/lib/db";
import {
  isPostizConfigured,
  listPostizIntegrations,
  POSTIZ_IMPORTABLE_PROVIDERS,
} from "@/lib/operations/postiz";

export const dynamic = "force-dynamic";

function isImportable(identifier: string): identifier is (typeof POSTIZ_IMPORTABLE_PROVIDERS)[number] {
  return (POSTIZ_IMPORTABLE_PROVIDERS as readonly string[]).includes(identifier);
}

function toHandle(profile: string | undefined, name: string, id: string): string {
  const value = (profile || name || id).trim();
  return value.startsWith("@") ? value : `@${value}`;
}

export const GET = withAuth(async (request, _ctx, user) => {
  if (!canManageUsers(user.role)) {
    return NextResponse.json({ error: "无权管理矩阵账号" }, { status: 403 });
  }
  const orgRes = await resolveRequestOrgIdForUser(user, request.nextUrl.searchParams.get("orgId"));
  if (!orgRes.ok) return orgRes.response;
  if (!isPostizConfigured()) {
    return NextResponse.json({ configured: false, integrations: [] });
  }

  try {
    const integrations = await listPostizIntegrations();
    return NextResponse.json({
      configured: true,
      integrations: integrations
        .filter((integration) => isImportable(integration.identifier))
        .map((integration) => ({
          id: integration.id,
          name: integration.name,
          identifier: integration.identifier,
          picture: integration.picture ?? null,
          profile: integration.profile ?? null,
          disabled: integration.disabled,
          groupName: integration.customer?.name ?? "Postiz Cloud",
        })),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Postiz 连接失败" },
      { status: 502 },
    );
  }
});

export const POST = withAuth(async (request, _ctx, user) => {
  if (!canManageUsers(user.role)) {
    return NextResponse.json({ error: "无权管理矩阵账号" }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  const orgRes = await resolveRequestOrgIdForUser(user, body.orgId);
  if (!orgRes.ok) return orgRes.response;
  if (!isPostizConfigured()) {
    return NextResponse.json({ error: "Postiz 尚未配置" }, { status: 503 });
  }

  const requestedIds = Array.isArray(body.integrationIds)
    ? new Set(body.integrationIds.filter((id: unknown): id is string => typeof id === "string"))
    : new Set<string>();
  if (requestedIds.size === 0) {
    return NextResponse.json({ error: "请选择至少一个 Postiz 账号" }, { status: 400 });
  }

  try {
    const integrations = await listPostizIntegrations();
    const selected = integrations.filter(
      (integration) => requestedIds.has(integration.id) && !integration.disabled && isImportable(integration.identifier),
    );
    const accounts = await Promise.all(selected.map((integration) => {
      const handle = toHandle(integration.profile, integration.name, integration.id);
      return db.matrixAccount.upsert({
        where: {
          orgId_platform_handle: {
            orgId: orgRes.orgId,
            platform: integration.identifier,
            handle,
          },
        },
        create: {
          orgId: orgRes.orgId,
          platform: integration.identifier,
          handle,
          displayName: integration.name,
          groupName: integration.customer?.name ?? "Postiz Cloud",
          publishChannel: "postiz",
          externalChannelId: integration.id,
        },
        update: {
          displayName: integration.name,
          groupName: integration.customer?.name ?? "Postiz Cloud",
          publishChannel: "postiz",
          externalChannelId: integration.id,
          status: "active",
        },
      });
    }));
    return NextResponse.json({ imported: accounts.length, accounts });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Postiz 同步失败" },
      { status: 502 },
    );
  }
});
