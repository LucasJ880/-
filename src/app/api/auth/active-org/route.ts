import { NextRequest, NextResponse } from "next/server";
import { getRequestPreview } from "@/lib/preview/server";
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
import { NO_ORG_INPUTS, loadOrgNavigationInputs } from "@/lib/navigation/context-server";
import { activeOrgNavigationFields } from "@/lib/navigation/filter-context";

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
  let orgCode: string | null = null;
  let orgCompany: { name: string; logoUrl: string } | null = null;
  let navInputs = NO_ORG_INPUTS;
  if (resolved.orgId) {
    const org = await db.organization.findUnique({
      where: { id: resolved.orgId },
      select: {
        code: true,
        company: { select: { name: true, logoUrl: true } },
      },
    });
    orgCode = org?.code ?? null;
    orgCompany = org?.company ?? null;
    // VIS-1a：模块（含行业包兜底）/ 岗位模式 / 成员身份 / 工作区 / 投标能力信号 / 岗位权限键
    // 与路由门同一个构造器（src/lib/navigation/context-server.ts），侧栏可见 ⇔ 路由放行；这里不走缓存
    // VIS-1b：导航字段经 activeOrgNavigationFields 输出，客户端钩子用 inputsFromActiveOrgResponse 原样还原
    navInputs = await loadOrgNavigationInputs(user.id, resolved.orgId);
  }

  const canSwitch = access ? canSelfSwitchOrganizations(access) : false;
  // FIXED / 不可自助切换：不强制 /select-org
  const needsSelection =
    canSwitch && resolved.needsSelection && !resolved.orgId;

  const nav = activeOrgNavigationFields(navInputs);
  // VIS-1e：以岗位预览中客户端不回写当前企业
  const previewing = Boolean(await getRequestPreview(request, user.id));
  return NextResponse.json({
    previewing,
    activeOrgId: resolved.orgId,
    orgCode,
    orgCompany,
    modules: nav.modules,
    orgRole: nav.orgRole,
    workspaceIds: nav.workspaceIds,
    hasMembership: nav.hasMembership,
    hasBidCapability: nav.hasBidCapability,
    permissionKeys: nav.permissionKeys,
    positionMode: nav.positionMode,
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
