/**
 * GET /api/trade/inbox?orgId=&filter=pending|all&days=90
 * 询盘收件箱：各通道进线按买家聚合的会话列表
 */

import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { resolveTradeOrgId } from "@/lib/trade/access";
import { loadInquiryThreads } from "@/lib/trade/inbox-service";

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, ["trade", "admin"]);
  if (auth instanceof NextResponse) return auth;

  const orgRes = await resolveTradeOrgId(request, auth.user);
  if (!orgRes.ok) return orgRes.response;

  const url = new URL(request.url);
  const filter = url.searchParams.get("filter") === "all" ? "all" : "pending";
  const daysRaw = Number(url.searchParams.get("days") ?? "90");
  const sinceDays = Number.isFinite(daysRaw) && daysRaw > 0 && daysRaw <= 365 ? daysRaw : 90;

  const threads = await loadInquiryThreads(orgRes.orgId, { sinceDays });
  const items = filter === "pending" ? threads.filter((t) => !t.replied) : threads;
  return NextResponse.json({
    items,
    counts: {
      pending: threads.filter((t) => !t.replied).length,
      total: threads.length,
    },
    capabilities: {
      emailSend: Boolean(process.env.RESEND_API_KEY),
    },
  });
}
