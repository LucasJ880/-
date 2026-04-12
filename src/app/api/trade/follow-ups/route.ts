/**
 * GET /api/trade/follow-ups
 *
 * 获取待跟进线索列表（到期或即将到期的）
 * query: ?orgId=xxx&days=3 (未来 N 天内需要跟进的)
 */

import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { db } from "@/lib/db";

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, ["trade", "admin"]);
  if (auth instanceof NextResponse) return auth;

  const { searchParams } = new URL(request.url);
  const orgId = searchParams.get("orgId") ?? "default";
  const days = Number(searchParams.get("days") ?? "7");

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() + days);

  const prospects = await db.tradeProspect.findMany({
    where: {
      orgId,
      nextFollowUpAt: { lte: cutoff },
      stage: {
        notIn: ["won", "lost", "unqualified", "new"],
      },
    },
    orderBy: { nextFollowUpAt: "asc" },
    include: {
      campaign: { select: { name: true } },
      messages: { orderBy: { createdAt: "desc" }, take: 1 },
    },
    take: 50,
  });

  const now = new Date();
  const items = prospects.map((p) => ({
    ...p,
    isOverdue: p.nextFollowUpAt ? p.nextFollowUpAt <= now : false,
    daysUntilFollowUp: p.nextFollowUpAt
      ? Math.ceil((p.nextFollowUpAt.getTime() - now.getTime()) / 86400000)
      : null,
  }));

  return NextResponse.json({
    items,
    total: items.length,
    overdue: items.filter((i) => i.isOverdue).length,
  });
}
