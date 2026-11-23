/**
 * TREE 情报调研树开关（默认关）
 *
 * TENDER_RESEARCH_TREE_ENABLED：未设 / 为假 = 关；`1` / `true` / `on` / `yes`（不分大小写）为开。
 * TENDER_RESEARCH_TREE_ORG_ALLOWLIST：逗号分隔的组织 id；为空 = 对所有组织生效（生产上必须填 Sunny 的组织 id）。
 * 关闭时：读网页的上下文建不出来（TREE-1）；调研树的页面、接口与 Job 与今天一致（TREE-2 起）。
 * 写法照 `src/lib/tender-intel/sourcing-flags.ts`。
 */

function envBool(v: string | undefined): boolean {
  if (!v) return false;
  const s = v.trim().toLowerCase();
  return s === "1" || s === "true" || s === "on" || s === "yes";
}

function envList(v: string | undefined): string[] {
  return (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

export function isResearchTreeEnabledForOrgWithEnv(
  orgId: string | null | undefined,
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (!envBool(env.TENDER_RESEARCH_TREE_ENABLED)) return false;
  if (!orgId) return false;
  const allowlist = envList(env.TENDER_RESEARCH_TREE_ORG_ALLOWLIST);
  return allowlist.length === 0 || allowlist.includes(orgId);
}

export function isResearchTreeEnabledForOrg(orgId: string | null | undefined): boolean {
  return isResearchTreeEnabledForOrgWithEnv(orgId, process.env);
}
