import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { getProspectTimeline } from "@/lib/trade/activity-log";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireRole(request, ["trade", "admin"]);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const timeline = await getProspectTimeline(id);
  return NextResponse.json(timeline);
}
