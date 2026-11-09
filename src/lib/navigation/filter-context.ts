/**
 * VIS-1b：导航判定输入的拼装（spec navigation/entry-visibility「入口判定与路由门同源」；design D7）
 *
 * 纯模块，客户端与服务端共用：
 * - 服务端：路由门 loader（context-server.ts）、岗位总览、workforce 接口用 buildNavigationFilterContext；
 * - 客户端：钩子 use-navigation-access.ts 把 /api/auth/active-org 的响应经 inputsFromActiveOrgResponse 还原成同一份
 *   企业侧输入，再用 buildNavigationFilterContext 拼——成员身份取响应里的 hasMembership，不从企业列表回推。
 * active-org 路由的导航字段由 activeOrgNavigationFields 产出，测试断言「响应 → 还原」逐字段不变。
 */

import type { OrgModulesConfig } from "@/lib/tenancy/modules";
import type { NavigationFilterContext } from "./types";

/** 企业侧判定输入（模块含行业包兜底、岗位模式、成员身份、工作区、投标能力信号、岗位权限键） */
export type OrgNavigationInputs = {
  modules: OrgModulesConfig | null;
  positionMode: boolean;
  orgRole: string | null;
  hasMembership: boolean;
  workspaceIds: string[];
  hasBidCapability: boolean;
  permissionKeys: string[];
};

export const NO_ORG_INPUTS: OrgNavigationInputs = {
  modules: null,
  positionMode: false,
  orgRole: null,
  hasMembership: false,
  workspaceIds: [],
  hasBidCapability: false,
  permissionKeys: [],
};

/** 路由门与入口判定用的输入（不含当前路径） */
export type RouteGateContext = Omit<NavigationFilterContext, "pathname" | "search">;

export type NavigationUserInput = { role: string | null };

export type NavigationFlags = {
  /** Autopilot 入口能力（服务端 hasAutopilotCapability；客户端 /api/auth/me 的 autopilotAllowed） */
  autopilotAllowed: boolean;
  /** 微信入口开关（服务端 isWechatBindingEnabled；客户端 WechatEntryProvider） */
  wechatEntryEnabled: boolean;
};

/** 企业侧输入 + 用户 + 开关 → 判定输入；服务端与客户端同一个函数 */
export function buildNavigationFilterContext(
  inputs: OrgNavigationInputs,
  user: NavigationUserInput,
  flags: NavigationFlags,
): RouteGateContext {
  return {
    modules: inputs.modules,
    positionMode: inputs.positionMode,
    orgRole: inputs.orgRole,
    hasMembership: inputs.hasMembership,
    workspaceIds: [...inputs.workspaceIds],
    hasBidCapability: inputs.hasBidCapability,
    permissionKeys: [...inputs.permissionKeys],
    platformRole: user.role,
    isPlatformAdmin: user.role === "super_admin",
    autopilotAllowed: flags.autopilotAllowed,
    wechatEntryEnabled: flags.wechatEntryEnabled,
  };
}

/** /api/auth/active-org 响应里的导航字段（键名与改动前一致） */
export type ActiveOrgNavigationFields = {
  modules: OrgModulesConfig | null;
  orgRole: string | null;
  workspaceIds: string[];
  hasMembership: boolean;
  hasBidCapability: boolean;
  permissionKeys: string[];
  positionMode: boolean;
};

export function activeOrgNavigationFields(inputs: OrgNavigationInputs): ActiveOrgNavigationFields {
  return {
    modules: inputs.modules,
    orgRole: inputs.orgRole,
    workspaceIds: inputs.workspaceIds,
    hasMembership: inputs.hasMembership,
    hasBidCapability: inputs.hasBidCapability,
    permissionKeys: inputs.permissionKeys,
    positionMode: inputs.positionMode,
  };
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/** active-org 响应 → 企业侧输入（字段缺失按「无」处理；与侧栏现有的解析口径一致） */
export function inputsFromActiveOrgResponse(body: unknown): OrgNavigationInputs {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const orgRole = typeof b.orgRole === "string" ? b.orgRole : null;
  return {
    modules: b.modules && typeof b.modules === "object" ? (b.modules as OrgModulesConfig) : null,
    positionMode: b.positionMode === true,
    orgRole,
    hasMembership: typeof b.hasMembership === "boolean" ? b.hasMembership : Boolean(orgRole),
    workspaceIds: stringArray(b.workspaceIds),
    hasBidCapability: b.hasBidCapability === true,
    permissionKeys: stringArray(b.permissionKeys),
  };
}
