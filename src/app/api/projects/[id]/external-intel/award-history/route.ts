import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  requireProjectReadAccess,
  requireProjectWriteAccess,
} from "@/lib/projects/access";
import {
  isExternalIntelEnabled,
  searchAwardHistory,
} from "@/lib/tender-intel/canadabuys";

/**
 * M1 — 历史授标外部检索（open.canada.ca 合同披露，公开只读）
 * GET  ?q=keyword → findings（待确认，绝不自动写入结论）
 * POST { finding, applyTo } → 人工确认 → room.summaryJson.externalConfirmed
 *   （8 模块外部字段由此变 READY；确认价可再喂历史对标）
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;
  const access = await requireProjectReadAccess(request, projectId);
  if (access instanceof NextResponse) return access;

  if (!isExternalIntelEnabled()) {
    return NextResponse.json({ enabled: false, findings: [], note: "外部情报未启用" });
  }

  // 无 q → 返回分析完成时自动检索的候选（多线交叉验证结果，待人工确认）
  const q = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (!q) {
    const room = await db.bidIntelligenceRoom.findUnique({
      where: { projectId },
      select: { summaryJson: true },
    });
    const sj = (room?.summaryJson as Record<string, unknown>) ?? {};
    const auto = (sj.externalCandidates ?? null) as {
      queries?: string[];
      candidates?: unknown[];
      fetchedAt?: string;
    } | null;
    return NextResponse.json({
      enabled: true,
      auto: auto ?? null,
      findings: [],
      note: auto ? null : "尚无自动检索结果（分析完成后自动生成）",
    });
  }

  const result = await searchAwardHistory({ query: q });
  return NextResponse.json({ enabled: true, auto: null, ...result });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;
  const access = await requireProjectWriteAccess(request, projectId);
  if (access instanceof NextResponse) return access;

  const body = (await request.json().catch(() => ({}))) as {
    vendorName?: string;
    contractValue?: number | null;
    contractDate?: string | null;
    sourceUrl?: string;
    possiblyRecurring?: boolean | null;
  };
  const vendor = (body.vendorName ?? "").trim();
  if (!vendor) {
    return NextResponse.json({ error: "缺少中标方名称" }, { status: 400 });
  }

  const room = await db.bidIntelligenceRoom.findUnique({
    where: { projectId },
    select: { id: true, summaryJson: true },
  });
  if (!room) {
    return NextResponse.json(
      { error: "项目尚未创建投标调查室" },
      { status: 409 },
    );
  }

  const sj = ((room.summaryJson as Record<string, unknown>) ?? {}) as Record<string, unknown>;
  const externalConfirmed = {
    previousWinner: vendor,
    historicalContractValue:
      body.contractValue != null
        ? `CAD ${Number(body.contractValue).toLocaleString()}${body.contractDate ? `（${body.contractDate}）` : ""}`
        : null,
    possiblyRecurring:
      body.possiblyRecurring == null ? null : body.possiblyRecurring ? "可能是（历史存在同类采购）" : "不确定",
    confirmedAt: new Date().toISOString(),
    sourceUrl: body.sourceUrl ?? null,
  };
  await db.bidIntelligenceRoom.update({
    where: { id: room.id },
    data: { summaryJson: { ...sj, externalConfirmed } },
  });

  return NextResponse.json({ ok: true, externalConfirmed });
}
