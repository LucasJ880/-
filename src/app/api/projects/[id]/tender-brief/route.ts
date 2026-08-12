import { NextRequest, NextResponse } from "next/server";
import { requireProjectReadAccess } from "@/lib/projects/access";
import { getExecutiveBrief } from "@/lib/tender-auto-analysis/executive-brief";

/**
 * GET /api/projects/[id]/tender-brief
 *
 * 「30 秒看懂项目」Executive Brief —— 对最新 TenderAnalysisRun（package 分析）的
 * deterministic projection。每字段带 readiness state（Missing ≠ Processing）。
 * 失败/未迁移不影响项目页其它功能。
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const access = await requireProjectReadAccess(request, id);
  if (access instanceof NextResponse) return access;

  const projectType = request.nextUrl.searchParams.get("projectType");

  try {
    const brief = await getExecutiveBrief(id, projectType);
    return NextResponse.json({ brief });
  } catch (err) {
    console.error("[tender-brief GET]", err);
    return NextResponse.json(
      { brief: null, unavailable: true },
      { status: 200 },
    );
  }
}
