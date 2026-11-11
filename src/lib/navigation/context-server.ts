/**
 * VIS-1a：服务端构造导航判定输入——侧栏（经 /api/auth/active-org）与路由门（中间件）共用一份口径，
 * 保证「侧栏可见 ⇔ 路由放行」（design openspec/changes/vis-1a-route-gate/design.md D2 / D3）。
 *
 * - loadOrgNavigationInputs：企业侧字段（模块含行业包兜底、岗位模式、成员身份、工作区、投标能力信号、岗位权限键）；
 * - ROUTE_GATE_LOADER：中间件用。用户与当前企业 id 每次请求只读解析——当前企业的选法与 resolvePreferredOrgId
 *   对非平台管理员一致（只有一家可用企业就用它；多家时用 activeOrgId 且须在其中），但不列计数、不写库；
 *   企业侧字段按 (userId, orgId) 进程内缓存 30 秒，降级结果（权限键解析失败）不缓存，并发请求合并为一次。
 * - /api/auth/active-org 直接调 loadOrgNavigationInputs，不走缓存（响应与改动前一致）。
 */

import { db } from "@/lib/db";
import { getActivePreview } from "@/lib/preview/server";
import { PREVIEW_ORG_ROLE, previewAllowKeys } from "@/lib/preview/identity";
import { parseOrgModulesJson, withIndustryPackModules } from "@/lib/tenancy/modules";
import { hasPositionTemplates } from "@/lib/authorization/role-defaults";
import { resolveEffectiveBindings } from "@/lib/authorization/resolve-effective-permissions";
import { hasAutopilotCapability } from "@/lib/autopilot/access";
import { isWechatBindingEnabled } from "@/lib/messaging/wechat-entry";
import {
  ROUTE_GATE_CACHE_MAX,
  ROUTE_GATE_CACHE_TTL_MS,
  TtlCache,
  type RouteGateLoader,
  type RouteGateUser,
} from "./route-gate";
import {
  NO_ORG_INPUTS,
  buildNavigationFilterContext,
  type OrgNavigationInputs,
  type RouteGateContext,
} from "./filter-context";

// VIS-1b：输入类型与「无企业」常量搬到纯模块 filter-context.ts（客户端也要用），这里重新导出，原导入方不变
export { NO_ORG_INPUTS, type OrgNavigationInputs } from "./filter-context";

/** 企业侧判定输入 + 是否降级（岗位权限键解析失败时按「无键」给出，调用方不应缓存降级结果） */
export async function loadOrgNavigationInputsDetailed(
  userId: string,
  orgId: string | null,
): Promise<{ inputs: OrgNavigationInputs; degraded: boolean }> {
  if (!orgId) return { inputs: { ...NO_ORG_INPUTS }, degraded: false };
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
  // INSTALL-1：岗位权限键（ALLOW）；解析失败按「无键」处理（与改动前 active-org 一致），并标记降级
  let permissionKeys: string[] = [];
  let degraded = false;
  try {
    const bindings = await resolveEffectiveBindings({ type: "HUMAN", id: userId, orgId });
    permissionKeys = [...new Set(bindings.filter((b) => b.effect === "ALLOW").map((b) => b.permissionKey))];
  } catch (err) {
    console.error("[navigation-context] 岗位权限键解析失败，按无键处理", err);
    permissionKeys = [];
    degraded = true;
  }
  const inputs: OrgNavigationInputs = {
    modules: withIndustryPackModules(parseOrgModulesJson(org?.modulesJson), org?.industryPackId),
    // PERM-4c2：行业包有岗位模板 → 岗位模式
    positionMode: hasPositionTemplates(org?.industryPackId),
    orgRole,
    hasMembership: Boolean(orgRole),
    workspaceIds: workspaces.map((w) => w.workspaceId),
    hasBidCapability: Boolean(projectMember),
    permissionKeys,
  };
  // VIS-1e：以岗位预览期间，预览企业按 org_member + 所选岗位的键；其他企业按非成员（spec authorization/position-preview）
  const preview = await getActivePreview(userId);
  if (preview) {
    return {
      inputs:
        orgId === preview.orgId
          ? { ...inputs, positionMode: true, orgRole: PREVIEW_ORG_ROLE, hasMembership: true, permissionKeys: previewAllowKeys(preview) }
          : { ...inputs, orgRole: null, hasMembership: false, workspaceIds: [], hasBidCapability: false, permissionKeys: [] },
      degraded,
    };
  }
  return { inputs, degraded };
}

/** 当前企业的导航判定输入（侧栏与路由门同一口径）；orgId 为空时为「无企业」 */
export async function loadOrgNavigationInputs(userId: string, orgId: string | null): Promise<OrgNavigationInputs> {
  return (await loadOrgNavigationInputsDetailed(userId, orgId)).inputs;
}

/**
 * 中间件的当前企业（纯函数）：与 resolvePreferredOrgId 对非平台管理员的选法一致——
 * 可用企业（active 成员 ∧ 企业未归档）只有一家就用它；多家时用 activeOrgId 且须在其中；否则无企业。
 */
export function pickGateOrgId(activeOrgId: string | null, usableOrgIds: readonly string[]): string | null {
  if (usableOrgIds.length === 1) return usableOrgIds[0];
  if (activeOrgId && usableOrgIds.includes(activeOrgId)) return activeOrgId;
  return null;
}

export type RouteGateLoaderDeps = {
  findUser(userId: string): Promise<RouteGateUser | null>;
  /** active 成员关系所在、且未归档的企业 id */
  findUsableOrgIds(userId: string): Promise<string[]>;
  loadOrgInputs(userId: string, orgId: string | null): Promise<{ inputs: OrgNavigationInputs; degraded: boolean }>;
  cache: TtlCache<OrgNavigationInputs>;
  autopilotAllowed(user: RouteGateUser): boolean;
  wechatEntryEnabled(): boolean;
};

/** 路由门加载器（依赖可注入，测试用假依赖） */
export function createRouteGateLoader(deps: RouteGateLoaderDeps): RouteGateLoader {
  const inflight = new Map<string, Promise<{ inputs: OrgNavigationInputs; degraded: boolean }>>();
  async function contextFor(user: RouteGateUser, orgId: string | null): Promise<RouteGateContext> {
    const key = `${user.id}:${orgId ?? "-"}`;
    let org = deps.cache.get(key);
    if (!org) {
      let pending = inflight.get(key);
      if (!pending) {
        pending = deps.loadOrgInputs(user.id, orgId).finally(() => inflight.delete(key));
        inflight.set(key, pending);
      }
      const result = await pending;
      org = result.inputs;
      if (!result.degraded) deps.cache.set(key, org);
    }
    // VIS-1b：与客户端钩子同一个拼装函数（filter-context.ts）
    return buildNavigationFilterContext(org, { role: user.role }, {
      autopilotAllowed: deps.autopilotAllowed(user),
      wechatEntryEnabled: deps.wechatEntryEnabled(),
    });
  }
  return {
    loadUser: (userId) => deps.findUser(userId),
    async loadContext(user): Promise<RouteGateContext> {
      return contextFor(user, pickGateOrgId(user.activeOrgId, await deps.findUsableOrgIds(user.id)));
    },
    // VIS-1d：调用方给定企业（审批可见集合按审批所属企业判）；非成员得到 hasMembership=false
    loadContextForOrg: (user, orgId) => contextFor(user, orgId),
  };
}

/** 中间件注入给 applyRouteGate 的加载器 */
export const ROUTE_GATE_LOADER: RouteGateLoader = createRouteGateLoader({
  async findUser(userId) {
    const row = await db.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, status: true, activeOrgId: true },
    });
    return row ? { id: row.id, role: row.role, status: row.status, activeOrgId: row.activeOrgId } : null;
  },
  async findUsableOrgIds(userId) {
    const rows = await db.organizationMember.findMany({
      where: { userId, status: "active", org: { status: { not: "archived" } } },
      select: { orgId: true },
    });
    return rows.map((r) => r.orgId);
  },
  loadOrgInputs: loadOrgNavigationInputsDetailed,
  cache: new TtlCache<OrgNavigationInputs>({ ttlMs: ROUTE_GATE_CACHE_TTL_MS, max: ROUTE_GATE_CACHE_MAX }),
  autopilotAllowed: (user) => hasAutopilotCapability({ id: user.id, role: user.role }, "autopilot.view"),
  wechatEntryEnabled: () => isWechatBindingEnabled(),
});

/**
 * VIS-1b：指定企业的判定输入（岗位总览用驾驶舱企业、workforce 接口用接口已解析的企业；design D2 / D5）。
 * 与路由门 loader 同一套企业侧输入与拼装函数，只是企业由调用方给定、不走缓存。
 */
export async function loadNavigationContextForOrg(
  user: { id: string; role: string | null },
  orgId: string | null,
): Promise<RouteGateContext> {
  const inputs = await loadOrgNavigationInputs(user.id, orgId);
  return buildNavigationFilterContext(inputs, { role: user.role }, {
    autopilotAllowed: hasAutopilotCapability({ id: user.id, role: user.role }, "autopilot.view"),
    wechatEntryEnabled: isWechatBindingEnabled(),
  });
}
