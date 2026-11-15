/**
 * NAV-1c：回复目标的读取（spec trade/inquiry-reply-entry「客户互动的回复目标」）。
 * 只读：一次判定 + 至多一次批量查询；不落库、不发信、不调模型。
 */

import { db } from "@/lib/db";
import type { AuthUser } from "@/lib/auth";
import { ROUTE_GATE_LOADER } from "@/lib/navigation/context-server";
import { canOpenHref } from "@/lib/navigation/landing";
import { isModuleEnabled } from "@/lib/tenancy/modules";
import { holdsTradePermission, TRADE_MANAGE_KEYS } from "./access";
import { opportunityIdsNeedingTarget, resolveReplyTargets, type ReplyTarget, type ReplyTargetInteraction } from "./reply-target";

/** 外贸模块已开 ∧ 询盘收件箱对该用户放行（与路由门同一判定）∧ 持 trade.manage；任一步取不到都按不放行 */
export async function loadReplyAllowed(user: AuthUser, orgId: string): Promise<boolean> {
  try {
    const gateUser = await ROUTE_GATE_LOADER.loadUser(user.id);
    if (!gateUser || gateUser.status !== "active") return false;
    const ctx = await ROUTE_GATE_LOADER.loadContextForOrg(gateUser, orgId);
    if (!isModuleEnabled(ctx.modules, "trade")) return false;
    if (!canOpenHref("/trade/inbox", ctx)) return false;
    return await holdsTradePermission(user, orgId, TRADE_MANAGE_KEYS);
  } catch {
    return false;
  }
}

/** 商机 → 线索：本企业内指向该商机、最早建立的那条（与审批发送回写同规则） */
export async function loadProspectByOpportunity(orgId: string, opportunityIds: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (opportunityIds.length === 0) return out;
  const prospects = await db.tradeProspect.findMany({
    where: { orgId, convertedToSalesOpportunityId: { in: [...opportunityIds] } },
    orderBy: { createdAt: "asc" },
    select: { id: true, convertedToSalesOpportunityId: true },
  });
  for (const p of prospects) {
    const oppId = p.convertedToSalesOpportunityId;
    if (oppId && !out.has(oppId)) out.set(oppId, p.id);
  }
  return out;
}

/** 一页互动的回复目标：不放行时不查库，全部为空 */
export async function loadReplyTargets(
  user: AuthUser,
  orgId: string,
  interactions: readonly ReplyTargetInteraction[],
): Promise<Map<string, ReplyTarget>> {
  const needed = opportunityIdsNeedingTarget(interactions);
  const allowed = needed.length > 0 && (await loadReplyAllowed(user, orgId));
  const byOpportunity = allowed ? await loadProspectByOpportunity(orgId, needed) : new Map<string, string>();
  return resolveReplyTargets(interactions, byOpportunity, allowed);
}
