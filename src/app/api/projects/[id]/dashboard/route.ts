import { NextRequest, NextResponse } from "next/server";
import { requireProjectReadAccess } from "@/lib/projects/access";
import { buildRange, queryOverview, queryTrends, queryQuality, queryRuntime, queryAssets } from "@/lib/project-dashboard/query";
import { detectRisks } from "@/lib/project-dashboard/risk-detector";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const access = await requireProjectReadAccess(request, id);
  if (access instanceof NextResponse) return access;

  const rangeParam = request.nextUrl.searchParams.get("range") ?? "7d";
  const days = rangeParam === "30d" ? 30 : 7;
  const range = buildRange(days);

  const [overview, trends, quality, runtime, assets] = await Promise.all([
    queryOverview(id, range),
    queryTrends(id, range),
    queryQuality(id, range),
    queryRuntime(id, range),
    queryAssets(id, range),
  ]);

  const risks = detectRisks(overview, quality, runtime);

  return NextResponse.json({
    overview,
    trends,
    risks,
    quality,
    runtime,
    assets,
    range: {
      days,
      start: range.start.toISOString(),
      end: range.end.toISOString(),
    },
  });
}
