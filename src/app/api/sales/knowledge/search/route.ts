import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { searchKnowledgeChunks, searchInsights, hybridSearch } from "@/lib/sales/vector-search";
import { db } from "@/lib/db";

export async function POST(request: NextRequest) {
  const user = await getCurrentUser(request);
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { query, mode, limit, customerId, opportunityId, filters } = body as {
      query: string;
      mode?: "chunks" | "insights" | "hybrid";
      limit?: number;
      customerId?: string;
      opportunityId?: string;
      filters?: {
        sourceType?: string;
        intent?: string;
        isWinPattern?: boolean;
        dealStage?: string;
        insightType?: string;
      };
    };

    if (!query?.trim()) {
      return NextResponse.json({ error: "搜索词不能为空" }, { status: 400 });
    }

    const searchMode = mode ?? "hybrid";

    if (searchMode === "insights") {
      const results = await searchInsights(query, {
        limit,
        dealStage: filters?.dealStage,
        insightType: filters?.insightType,
      });
      return NextResponse.json({ mode: "insights", results });
    }

    if (searchMode === "chunks") {
      const results = await searchKnowledgeChunks({
        query,
        limit,
        filters: { customerId, opportunityId, ...filters },
      });
      return NextResponse.json({ mode: "chunks", results });
    }

    const chunkResults = await hybridSearch(query, { limit: limit ?? 8, customerId });

    const insightResults = await searchInsights(query, {
      limit: 3,
      dealStage: filters?.dealStage,
    });

    const stats = await db.salesKnowledgeChunk.count();

    return NextResponse.json({
      mode: "hybrid",
      chunks: chunkResults,
      insights: insightResults,
      knowledgeBaseSize: stats,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "搜索失败" },
      { status: 500 },
    );
  }
}
