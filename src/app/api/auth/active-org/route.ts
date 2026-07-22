import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/guards";
import {
  resolvePreferredOrgId,
  setUserActiveOrgId,
} from "@/lib/organizations/active-org";
import {
  canSelfSwitchOrganizations,
  ensureFixedUserActiveOrg,
  getOrgAccessProfile,
  switchUserActiveOrg,
} from "@/lib/organizations/org-access";
import { db } from "@/lib/db";
import { parseOrgModulesJson } from "@/lib/tenancy";

/**
 * GET /api/auth/active-org
 * 返回当前偏好组织 + 可选列表（供前端 hydrate / 选组织页）
 * 附带当前组织 modules（用于侧栏动态裁剪）
 */
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  const { user } = auth;

  const access = await getOrgAccessProfile(user.id);
  if (access?.orgAccessMode === "FIXED") {
    await ensureFixedUserActiveOrg(user.id);
  }

  const resolved = await resolvePreferredOrgId(user.id, user.role);
  let modules: ReturnType<typeof parseOrgModulesJson> = null;
  let orgCode: string | null = null;
  let workspaceIds: string[] = [];
  let orgRole: string | null = null;
  if (resolved.orgId) {
    const org = await db.organization.findUnique({
      where: { id: resolved.orgId },
      select: { code: true, modulesJson: true },
    });
    orgCode = org?.code ?? null;
    modules = parseOrgModulesJson(org?.modulesJson);
    const [member, workspaces] = await Promise.all([
      db.organizationMember.findUnique({
        where: {
          orgId_userId: { orgId: resolved.orgId, userId: user.id },
        },
        select: { role: true, status: true },
      }),
      db.workspaceMember.findMany({
        where: {
          userId: user.id,
          status: "active",
          workspace: { orgId: resolved.orgId, status: "active" },
        },
        select: { workspaceId: true },
      }),
    ]);
    if (member?.status === "active") orgRole = member.role;
    workspaceIds = workspaces.map((w) => w.workspaceId);
  }

  const canSwitch = access ? canSelfSwitchOrganizations(access) : false;
  // FIXED / 不可自助切换：不强制 /select-org
  const needsSelection =
    canSwitch && resolved.needsSelection && !resolved.orgId;

  return NextResponse.json({
    activeOrgId: resolved.orgId,
    orgCode,
    modules,
    orgRole,
    workspaceIds,
    hasMembership: Boolean(orgRole),
    needsSelection,
    orgAccessMode: access?.orgAccessMode ?? "FIXED",
    canSelfSwitchOrg: access?.canSelfSwitchOrg ?? false,
    canSwitch,
    organizations: canSwitch
      ? resolved.organizations
      : resolved.organizations.filter((o) => o.id === resolved.orgId),
  });
}

/**
 * PATCH /api/auth/active-org
 * Security-1：自助切换请优先 POST /api/auth/switch-org。
 * 本接口对 MULTI_ORG 委托 switch；FIXED 仅允许写回其唯一/已锁定企业（hydrate）。
 */
export async function PATCH(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  const { user } = auth;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体格式错误" }, { status: 400 });
  }

  const orgId =
    typeof (body as { orgId?: unknown }).orgId === "string"
      ? (body as { orgId: string }).orgId.trim()
      : "";
  if (!orgId) {
    return NextResponse.json({ error: "orgId 必填" }, { status: 400 });
  }

  const access = await getOrgAccessProfile(user.id);
  if (access && canSelfSwitchOrganizations(access)) {
    const switched = await switchUserActiveOrg({
      userId: user.id,
      targetOrgId: orgId,
      actorUserId: user.id,
    });
    if (!switched.ok) {
      return NextResponse.json(
        { error: switched.message, code: switched.code },
        { status: 403 },
      );
    }
    return NextResponse.json({ activeOrgId: switched.activeOrgId });
  }

  // FIXED：只允许 hydrate 到当前 active 或唯一 membership
  const fixedOrg = await ensureFixedUserActiveOrg(user.id);
  if (fixedOrg && fixedOrg === orgId) {
    const saved = await setUserActiveOrgId(user.id, user.role, orgId);
    return NextResponse.json({ activeOrgId: saved ?? fixedOrg });
  }
  if (access?.activeOrgId && access.activeOrgId === orgId) {
    return NextResponse.json({ activeOrgId: orgId });
  }

  return NextResponse.json(
    {
      error: "当前账号不允许自行切换工作企业",
      code: "ORG_SWITCH_NOT_ALLOWED",
    },
    { status: 403 },
  );
}
