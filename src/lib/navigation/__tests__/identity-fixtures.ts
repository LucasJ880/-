/**
 * 测试用身份：企业侧判定输入 + 平台角色 → 路由门判定上下文（VIS-1c 新测试共用）。
 * 岗位键取自真实岗位模板（mergedProfileBindings），模块取默认企业模块，与 entry-visibility.test.ts 的身份同口径。
 * 非测试文件：不在 scripts/test-all.sh 注册。
 */

import { buildNavigationFilterContext, type OrgNavigationInputs, type RouteGateContext } from "../filter-context";
import {
  HOME_TEXTILE_TRADE_INDUSTRY_PACK,
  WINDOW_COVERING_INDUSTRY_PACK,
  mergedProfileBindings,
} from "@/lib/authorization/role-defaults";
import { DEFAULT_MENGXIN_MODULES, DEFAULT_SUNNY_MODULES } from "@/lib/tenancy/modules";

function keysOf(pack: string, ...positions: string[]): string[] {
  return [
    ...new Set(
      positions.flatMap((p) =>
        mergedProfileBindings(pack, p)
          .filter((b) => (b.effect ?? "ALLOW") === "ALLOW")
          .map((b) => b.permissionKey),
      ),
    ),
  ];
}
export const sunnyKeys = (...p: string[]) => keysOf(WINDOW_COVERING_INDUSTRY_PACK, ...p);
export const mengxinKeys = (...p: string[]) => keysOf(HOME_TEXTILE_TRADE_INDUSTRY_PACK, ...p);

export type TestIdentity = { role: string; inputs: OrgNavigationInputs };

export function sunnyInputs(partial: Partial<OrgNavigationInputs> = {}): OrgNavigationInputs {
  return {
    modules: { enabled: [...DEFAULT_SUNNY_MODULES] },
    positionMode: true,
    orgRole: "org_member",
    hasMembership: true,
    workspaceIds: [],
    hasBidCapability: false,
    permissionKeys: [],
    ...partial,
  };
}
const MX = { enabled: [...DEFAULT_MENGXIN_MODULES] };

export const IDENTITIES = {
  sales_rep: { role: "user", inputs: sunnyInputs({ permissionKeys: sunnyKeys("sales_rep") }) },
  sales_rep_project_member: { role: "user", inputs: sunnyInputs({ permissionKeys: sunnyKeys("sales_rep"), hasBidCapability: true }) },
  pricing_lead: { role: "user", inputs: sunnyInputs({ permissionKeys: sunnyKeys("pricing_lead") }) },
  owner: { role: "user", inputs: sunnyInputs({ permissionKeys: sunnyKeys("owner"), orgRole: "org_admin" }) },
  bids: { role: "user", inputs: sunnyInputs({ permissionKeys: sunnyKeys("bids") }) },
  ops_lead: { role: "user", inputs: sunnyInputs({ permissionKeys: sunnyKeys("ops_lead") }) },
  ops_staff: { role: "user", inputs: sunnyInputs({ permissionKeys: sunnyKeys("ops_staff") }) },
  accounting: { role: "user", inputs: sunnyInputs({ permissionKeys: sunnyKeys("accounting") }) },
  installer: { role: "user", inputs: sunnyInputs({ permissionKeys: sunnyKeys("installer") }) },
  fulfillment_vinyl: { role: "user", inputs: sunnyInputs({ permissionKeys: sunnyKeys("fulfillment_vinyl") }) },
  fulfillment_shades: { role: "user", inputs: sunnyInputs({ permissionKeys: sunnyKeys("fulfillment_shades") }) },
  no_position: { role: "user", inputs: sunnyInputs({}) },
  mx_cathy: { role: "user", inputs: sunnyInputs({ modules: MX, permissionKeys: mengxinKeys("owner", "trade_rep"), orgRole: "org_admin" }) },
  mx_trade_rep: { role: "user", inputs: sunnyInputs({ modules: MX, permissionKeys: mengxinKeys("trade_rep") }) },
  super_admin: { role: "super_admin", inputs: sunnyInputs({ permissionKeys: [] }) },
} satisfies Record<string, TestIdentity>;

export type IdentityName = keyof typeof IDENTITIES;

export const DEFAULT_FLAGS = { autopilotAllowed: false, wechatEntryEnabled: false };

export function gateCtx(name: IdentityName, flags = DEFAULT_FLAGS): RouteGateContext {
  const id: TestIdentity = IDENTITIES[name];
  return buildNavigationFilterContext(id.inputs, { role: id.role }, flags);
}
