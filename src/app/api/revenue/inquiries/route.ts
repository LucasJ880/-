/**
 * POST /api/revenue/inquiries — 人工录入询盘（email / trade_show / referral / manual / existing_customer …）
 * 所有来源统一进入 intakeInquiry → SalesCustomer → SalesOpportunity → FDE
 * FDE 经来信行动的原子认领执行（与 cron / after() 回调互斥）；重复提交（intake replay）不重跑已结束的 FDE。
 */
import { NextRequest, NextResponse } from "next/server";
import { safeParseBody } from "@/lib/common/api-helpers";
import { REVENUE_MANAGE_KEYS, resolveRevenueAccess } from "@/lib/revenue-spine/access";
import { runInboundFdeForHuman } from "@/lib/revenue-spine/fde/inbound-queue";
import { intakeInquiry, isOpportunitySource } from "@/lib/revenue-spine/inquiry-intake";

export const maxDuration = 120;

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

export async function POST(request: NextRequest) {
  const body = (await safeParseBody<Record<string, unknown>>(request)) ?? {};
  const access = await resolveRevenueAccess(request, REVENUE_MANAGE_KEYS, { bodyOrgId: typeof body.orgId === "string" ? body.orgId : null });
  if (!access.ok) return access.response;
  const source = isOpportunitySource(body.source) ? body.source : "manual";
  const message = str(body.message) ?? "";
  const result = await intakeInquiry({
    orgId: access.orgId,
    source,
    contact: {
      name: str(body.name),
      email: str(body.email),
      phone: str(body.phone),
      company: str(body.company),
      country: str(body.country),
      website: str(body.website),
    },
    message,
    subject: str(body.subject),
    product: str(body.product),
    meta: { channel: str(body.channel) },
    actorUserId: access.auth.user.id,
    fdeSourced: body.fdeSourced === true,
  });
  if (!result.ok) return NextResponse.json({ error: result.error, code: result.code }, { status: 400 });
  const fde =
    body.runFde === false
      ? null
      : await runInboundFdeForHuman({
          orgId: access.orgId,
          opportunityId: result.opportunityId,
          salesActionId: result.salesActionId,
          trigger: "inquiry",
          by: "inline",
          actorUserId: access.auth.user.id,
          rerunFinished: false,
        });
  return NextResponse.json({ ...result, fde });
}
