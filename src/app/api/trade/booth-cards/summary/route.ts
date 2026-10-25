/**
 * GET  /api/trade/booth-cards/summary?day=YYYY-MM-DD — 展会小结预览（默认当前展会日）
 * POST /api/trade/booth-cards/summary { orgId?, day? } — 发给管理层（青砚通知 + 微信）；同一天同样张数只发一次
 *
 * 展会日从组织当地 07:00 到次日 07:00（组织时区 settingsJson.timezone）。
 */

import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { loadOrgTimezone } from "@/lib/automation/registry";
import { resolveTradeOrgId } from "@/lib/trade/access";
import { BOOTH_CARD_ROLES } from "@/lib/trade/booth-cards";
import { boothDayOf, collectBoothSummary, formatBoothSummary, sendBoothSummary } from "@/lib/trade/booth-summary";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, BOOTH_CARD_ROLES);
  if (auth instanceof NextResponse) return auth;
  const orgRes = await resolveTradeOrgId(request, auth.user);
  if (!orgRes.ok) return orgRes.response;

  const timeZone = await loadOrgTimezone(orgRes.orgId);
  const q = new URL(request.url).searchParams.get("day") ?? "";
  const day = DAY_RE.test(q) ? q : boothDayOf(new Date(), timeZone);
  const summary = await collectBoothSummary(orgRes.orgId, day, timeZone);
  return NextResponse.json({ day, timeZone, total: summary.cards.length, ...formatBoothSummary(summary) });
}

export async function POST(request: NextRequest) {
  const auth = await requireRole(request, BOOTH_CARD_ROLES);
  if (auth instanceof NextResponse) return auth;
  const body = (await request.json().catch(() => ({}))) as { orgId?: unknown; day?: unknown };
  const orgRes = await resolveTradeOrgId(request, auth.user, {
    bodyOrgId: typeof body.orgId === "string" ? body.orgId : null,
  });
  if (!orgRes.ok) return orgRes.response;

  const timeZone = await loadOrgTimezone(orgRes.orgId);
  const day = typeof body.day === "string" && DAY_RE.test(body.day) ? body.day : boothDayOf(new Date(), timeZone);
  const r = await sendBoothSummary(orgRes.orgId, day, timeZone);
  return NextResponse.json({ day, ...r });
}
