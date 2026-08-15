import { NextRequest, NextResponse } from "next/server";
import { requireProjectReadAccess } from "@/lib/projects/access";
import { db } from "@/lib/db";
import { getExecutiveBrief } from "@/lib/tender-auto-analysis/executive-brief";
import { isTenderPackageAiExperienceEnabledWithEnv } from "@/lib/tender-auto-analysis/auto-flags";

/**
 * GET /api/projects/[id]/tender-brief
 *
 * 「30 秒看懂项目」Executive Brief —— 对最新 TenderAnalysisRun（package 分析）的
 * deterministic projection。每字段带 readiness state（Missing ≠ Processing）。
 *
 * EXPERIENCE 主开关：OFF（生产默认）时返回 experienceEnabled:false，
 * 前端据此保持 merge 前既有 30 秒看懂行为（不改生产 UX）。
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
    const project = await db.project.findUnique({
      where: { id },
      select: { orgId: true },
    });
    const experienceEnabled = isTenderPackageAiExperienceEnabledWithEnv({
      orgId: project?.orgId ?? null,
    });
    if (!experienceEnabled) {
      return NextResponse.json({ brief: null, experienceEnabled: false });
    }

    const brief = await getExecutiveBrief(id, projectType);
    return NextResponse.json({ brief, experienceEnabled: true });
  } catch (err) {
    console.error("[tender-brief GET]", err);
    return NextResponse.json(
      { brief: null, experienceEnabled: false, unavailable: true },
      { status: 200 },
    );
  }
}
