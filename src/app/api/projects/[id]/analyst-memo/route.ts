/**
 * GET /api/projects/[id]/analyst-memo · 分析师备忘录的工作台阅读视图（只读）
 *
 * 数据源 = 备忘录 v2 管线状态（room.summaryJson.analystMemoV2），不碰 PDF：
 * 节内容服务端用受限 Markdown 渲染器转 HTML（全转义，XSS 安全由渲染器契约保证，AMV2-08），
 * 前端按「类目（节标题）」导航直接阅读，无需下载。
 * 权限：项目读权限（与备忘录 PDF 的可见面一致；成本类敏感数字本就不进备忘录）。
 */
import { NextResponse, type NextRequest } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { requireProjectReadAccess } from "@/lib/projects/access";
import { db } from "@/lib/db";
import { MEMO_STATE_KEY, type MemoV2State } from "@/lib/tender-analyst-memo/v2/contract";
import { renderLimitedMd } from "@/lib/tender-analyst-memo/v2/render";
import type { ReferencedStandardsIntel } from "@/lib/tender-intel/referenced-standards";
import type { MarketPricingIntel } from "@/lib/tender-intel/market-pricing";

export const runtime = "nodejs";

export const GET = withAuth(async (request: NextRequest, ctx, _user) => {
  const { id: projectId } = await (ctx as { params: Promise<{ id: string }> }).params;
  const access = await requireProjectReadAccess(request, projectId);
  if (access instanceof NextResponse) return access;

  const room = await db.bidIntelligenceRoom.findUnique({ where: { projectId }, select: { summaryJson: true } });
  const sj = ((room?.summaryJson as Record<string, unknown>) ?? {}) as Record<string, unknown>;
  const state = sj[MEMO_STATE_KEY] as MemoV2State | undefined;
  if (!state || state.status !== "done" || !state.sectionsPart1) {
    return NextResponse.json({ status: state?.status ?? "none" });
  }
  const sections = [...(state.sectionsPart1 ?? []), ...(state.sectionsPart2 ?? [])].map((s) => ({
    titleZh: s.titleZh,
    html: renderLimitedMd(s.bodyMd),
  }));
  const std = state.research?.standards as ReferencedStandardsIntel | null;
  const mk = state.research?.market as MarketPricingIntel | null;
  const sources = [
    ...(std?.status === "ran" ? std.standards.flatMap((s) => s.sources) : []),
    ...(mk?.status === "ran" ? mk.sources : []),
  ];
  const dedupSources = [...new Map(sources.map((s) => [s.url, { title: s.title, url: s.url }])).values()].slice(0, 20);
  return NextResponse.json({
    status: "done",
    updatedAt: state.updatedAt,
    chunkCount: state.chunks.length,
    sections,
    sources: dedupSources,
    fxNoteZh: mk?.status === "ran" ? mk.fxNoteZh : null,
  });
});
