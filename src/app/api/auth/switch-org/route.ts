/**
 * POST /api/auth/switch-org
 * Security-1：仅 MULTI_ORG + canSelfSwitchOrg 可切换工作企业
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/guards";
import {
  canSelfSwitchOrganizations,
  getOrgAccessProfile,
  switchUserActiveOrg,
} from "@/lib/organizations/org-access";
import { db } from "@/lib/db";

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  const { user } = auth;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "请求体格式错误", code: "ORG_CONTEXT_INVALID" },
      { status: 400 },
    );
  }

  const orgId =
    typeof (body as { orgId?: unknown }).orgId === "string"
      ? (body as { orgId: string }).orgId.trim()
      : "";
  if (!orgId) {
    return NextResponse.json(
      { error: "orgId 必填", code: "ORG_CONTEXT_INVALID" },
      { status: 400 },
    );
  }

  const result = await switchUserActiveOrg({
    userId: user.id,
    targetOrgId: orgId,
    actorUserId: user.id,
  });
  if (!result.ok) {
    const status =
      result.code === "ORG_SWITCH_NOT_ALLOWED"
        ? 403
        : result.code === "ORG_MEMBERSHIP_REQUIRED"
          ? 403
          : result.code === "ORG_INACTIVE"
            ? 404
            : 400;
    return NextResponse.json(
      { error: result.message, code: result.code },
      { status },
    );
  }

  const member = await db.organizationMember.findUnique({
    where: { orgId_userId: { orgId: result.activeOrgId, userId: user.id } },
    select: { role: true },
  });
  const org = await db.organization.findUnique({
    where: { id: result.activeOrgId },
    select: { id: true, name: true, code: true },
  });

  return NextResponse.json({
    activeOrgId: result.activeOrgId,
    org: org
      ? { id: org.id, name: org.name, code: org.code }
      : { id: result.activeOrgId },
    orgRole: member?.role ?? null,
  });
}

/** GET：当前用户是否可切换 + 可选企业列表（仅 membership） */
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  const { user } = auth;

  const profile = await getOrgAccessProfile(user.id);
  if (!profile) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const canSwitch = canSelfSwitchOrganizations(profile);
  const memberships = await db.organizationMember.findMany({
    where: {
      userId: user.id,
      status: "active",
      org: { status: "active" },
    },
    select: {
      role: true,
      org: { select: { id: true, name: true, code: true } },
    },
    orderBy: { joinedAt: "desc" },
  });

  return NextResponse.json({
    orgAccessMode: profile.orgAccessMode,
    canSelfSwitchOrg: profile.canSelfSwitchOrg,
    canSwitch,
    activeOrgId: profile.activeOrgId,
    organizations: canSwitch
      ? memberships.map((m) => ({
          id: m.org.id,
          name: m.org.name,
          code: m.org.code,
          myRole: m.role,
        }))
      : memberships
          .filter((m) => m.org.id === profile.activeOrgId)
          .map((m) => ({
            id: m.org.id,
            name: m.org.name,
            code: m.org.code,
            myRole: m.role,
          })),
  });
}
