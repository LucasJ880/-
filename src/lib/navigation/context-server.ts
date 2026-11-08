/**
 * VIS-1a：服务端构造导航判定输入——侧栏（经 /api/auth/active-org）与路由门（中间件）共用一份口径，
 * 保证「侧栏可见 ⇔ 路由放行」（design openspec/changes/vis-1a-route-gate/design.md D2 / D3）。
 *
 * - loadOrgNavigationInputs：企业侧字段（模块含行业包兜底、岗位模式、成员身份、工作区、投标能力信号、岗位权限键）；
 * - ROUTE_GATE_LOADER：中间件用。用户与当前企业 id 每次请求只读解析（不调 resolvePreferredOrgId，
 *   它会列全部成员关系、计数、对 super_admin 载入最多 200 家企业，还可能写回 activeOrgId）；
 *   企业侧字段按 (userId, orgId) 进程内缓存 30 秒。
 * - /api/auth/active-org 直接调 loadOrgNavigationInputs，不走缓存（响应与改动前一致）。
 */

import { db } from "@/lib/db";
import { parseOrgModulesJson, withIndustryPackModules, type OrgModulesConfig } from "@/lib/tenancy/modules";
import { hasPositionTemplates } from "@/lib/authorization/role-defaults";
import { resolveEffectiveBindings } from "@/lib/authorization/resolve-effective-permissions";
import { hasAutopilotCapability } from "@/lib/autopilot/access";
import { isWechatBindingEnabled } from "@/lib/messaging/wechat-entry";
import {
  ROUTE_GATE_CACHE_MAX,
  ROUTE_GATE_CACHE_TTL_MS,
  TtlCache,
  type RouteGateContext,
  type RouteGateLoader,
  type RouteGateUser,
} from "./route-gate";

export type OrgNavigationInputs = {
  modules: OrgModulesConfig | null;
  positionMode: boolean;
  orgRole: string | null;
  hasMembership: boolean;
  workspaceIds: string[];
  hasBidCapability: boolean;
  permissionKeys: string[];
};

const NO_ORG: OrgNavigationInputs = {
  modules: null,
  positionMode: false,
  orgRole: null,
  hasMembership: false,
  workspaceIds: [],
  hasBidCapability: false,
  permissionKeys: [],
};

/** 当前企业的导航判定输入（侧栏与路由门同一口径）；orgId 为空时为「无企业」 */
export async function loadOrgNavigationInputs(userId: string, orgId: string | null): Promise<OrgNavigationInputs> {
  if (!orgId) return { ...NO_ORG };
  const [org, member, workspaces, projectMember] = await Promise.all([
    db.organization.findUnique({
      where: { id: orgId },
      select: { modulesJson: true, industryPackId: true },
    }),
    db.organizationMember.findUnique({
      where: { orgId_userId: { orgId, userId } },
      select: { role: true, status: true },
    }),
    db.workspaceMember.findMany({
      where: {
        userId,
        status: "active",
        workspace: { orgId, status: "active" },
      },
      select: { workspaceId: true },
    }),
    db.projectMember.findFirst({
      where: { userId, status: "active", project: { orgId } },
      select: { id: true },
    }),
  ]);
  const orgRole = member?.status === "active" ? member.role : null;
  // INSTALL-1：岗位权限键（ALLOW）；解析失败按「无键」处理（与改动前 active-org 一致）
  let permissionKeys: string[] = [];
  try {
    const bindings = await resolveEffectiveBindings({ type: "HUMAN", id: userId, orgId });
    permissionKeys = [...new Set(bindings.filter((b) => b.effect === "ALLOW").map((b) => b.permissionKey))];
  } catch {
    permissionKeys = [];
  }
  return {
    modules: withIndustryPackModules(parseOrgModulesJson(org?.modulesJson), org?.industryPackId),
    // PERM-4c2：行业包有岗位模板 → 岗位模式
    positionMode: hasPositionTemplates(org?.industryPackId),
    orgRole,
    hasMembership: Boolean(orgRole),
    workspaceIds: workspaces.map((w) => w.workspaceId),
    hasBidCapability: Boolean(projectMember),
    permissionKeys,
  };
}

/** 中间件：当前企业 = activeOrgId；为空时取唯一的 active 成员关系（与 /api/auth/me 同法），只读 */
async function resolveGateOrgId(user: RouteGateUser): Promise<string | null> {
  if (user.activeOrgId) return user.activeOrgId;
  const memberships = await db.organizationMember.findMany({
    where: { userId: user.id, status: "active" },
    select: { orgId: true },
    take: 2,
  });
  return memberships.length === 1 ? memberships[0].orgId : null;
}

const orgInputsCache = new TtlCache<OrgNavigationInputs>({
  ttlMs: ROUTE_GATE_CACHE_TTL_MS,
  max: ROUTE_GATE_CACHE_MAX,
});

/** 中间件注入给 applyRouteGate 的加载器 */
export const ROUTE_GATE_LOADER: RouteGateLoader = {
  async loadUser(userId) {
    const row = await db.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, status: true, activeOrgId: true },
    });
    return row ? { id: row.id, role: row.role, status: row.status, activeOrgId: row.activeOrgId } : null;
  },
  async loadContext(user): Promise<RouteGateContext> {
    const orgId = await resolveGateOrgId(user);
    const key = `${user.id}:${orgId ?? "-"}`;
    let org = orgInputsCache.get(key);
    if (!org) {
      org = await loadOrgNavigationInputs(user.id, orgId);
      orgInputsCache.set(key, org);
    }
    return {
      ...org,
      platformRole: user.role,
      isPlatformAdmin: user.role === "super_admin",
      autopilotAllowed: hasAutopilotCapability({ id: user.id, role: user.role }, "autopilot.view"),
      wechatEntryEnabled: isWechatBindingEnabled(),
    };
  },
};
