/**
 * BIDPAGE「标书与报价」页改版开关（默认关）
 *
 * TENDER_BID_PAGE_V2_ENABLED：未设 / 为假 = 关。
 * TENDER_BID_PAGE_V2_ORG_ALLOWLIST：逗号分隔的组织 id；为空 = 对所有组织生效（生产上线时必须填 Sunny 的组织 id）。
 * 关闭时汇总接口 404，页签渲染改版前的页面；共用代码里的新行为一律以这个开关为唯一分界（任务书附录 C 决定 A）。
 */

function envBool(v: string | undefined): boolean {
  if (!v) return false;
  const s = v.trim().toLowerCase();
  return s === "1" || s === "true" || s === "on" || s === "yes";
}

function envList(v: string | undefined): string[] {
  return (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

export function isBidPageV2EnabledForOrgWithEnv(orgId: string | null | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!envBool(env.TENDER_BID_PAGE_V2_ENABLED)) return false;
  if (!orgId) return false;
  const allowlist = envList(env.TENDER_BID_PAGE_V2_ORG_ALLOWLIST);
  return allowlist.length === 0 || allowlist.includes(orgId);
}

export function isBidPageV2EnabledForOrg(orgId: string | null | undefined): boolean {
  return isBidPageV2EnabledForOrgWithEnv(orgId, process.env);
}

export function describeBidPageV2Flag(env: NodeJS.ProcessEnv = process.env): Record<string, unknown> {
  return {
    flag: "TENDER_BID_PAGE_V2_ENABLED",
    enabled: envBool(env.TENDER_BID_PAGE_V2_ENABLED),
    orgAllowlistSize: envList(env.TENDER_BID_PAGE_V2_ORG_ALLOWLIST).length,
  };
}
