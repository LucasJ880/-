/**
 * BIDPAGE-3 逐行报价接口 — 守卫之后的两道门（design D7）
 *
 * 调用方第一步已经 `requireQuoteAccess` 并检查了结果（FIX-21 写法）。这里再判：
 *   1. 新页面开关（组织名单）与招投标项目 → 否则 404（与汇总接口同一句）；
 *   2. 金额门：财务查看权（`resolveFinancePrivilege(...).canReadAll`，与 #532 / 成本核算接口同一判定）→ 否则 403。
 * 内部成本权限（读）/ 编辑权限（写）已由守卫的级别判过。
 */
import { NextResponse } from "next/server";
import type { QuoteAccessContext } from "@/lib/quote-engine/access";
import { QuoteEngineError } from "@/lib/quote-engine/service";
import { resolveFinancePrivilege } from "@/lib/project-finance/access";
import { isBidPageV2EnabledForOrg } from "@/lib/bid-page-v2/flags";
import type { LineCaps } from "./service";

export const LINE_MODE_NOT_ENABLED_ZH = "新版标书与报价页未启用";
export const LINE_MODE_AMOUNTS_FORBIDDEN_ZH = "报价的金额与成本只给项目负责人和有财务查看权的同事看。要做报价或查看金额，请找他们。";

export async function lineModeGate(access: QuoteAccessContext): Promise<NextResponse | { caps: LineCaps }> {
  if (access.project.workDomain !== "tender" || !isBidPageV2EnabledForOrg(access.orgId)) {
    return NextResponse.json({ error: LINE_MODE_NOT_ENABLED_ZH }, { status: 404 });
  }
  const finance = await resolveFinancePrivilege(access.user, access.orgId, access.project.ownerId);
  if (!finance.canReadAll) return NextResponse.json({ error: LINE_MODE_AMOUNTS_FORBIDDEN_ZH }, { status: 403 });
  return { caps: { canEdit: access.canEdit, canApprove: access.canApprove } };
}

/** 服务抛出的报价错误 → JSON；校验问题带在 details.issues 里（指到第几行） */
export function lineModeErrorResponse(e: unknown): NextResponse | null {
  if (e instanceof QuoteEngineError) return NextResponse.json({ error: e.message, code: e.code, details: e.details ?? null }, { status: e.status });
  return null;
}
