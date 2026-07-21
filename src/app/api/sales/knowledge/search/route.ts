import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import {
  searchKnowledgeChunks,
  searchInsights,
  hybridSearch,
} from "@/lib/sales/vector-search";
import { db } from "@/lib/db";
import { resolveSalesOrgIdForRequest } from "@/lib/sales/org-context";

export const POST = withAuth(async (request, _ctx, user) => {
  try {
    const orgRes = await resolveSalesOrgIdForRequest(request, user);
    if (!orgRes.ok) return orgRes.response;
    const { orgId } = orgRes;

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

    if (customerId) {
      const cust = await db.salesCustomer.findFirst({
        where: { id: customerId, orgId },
        select: { id: true },
      });
      if (!cust) {
        return NextResponse.json({ error: "客户不存在" }, { status: 404 });
      }
    }

    const searchMode = mode ?? "hybrid";

    if (searchMode === "insights") {
      const results = await searchInsights(query, {
        orgId,
        limit,
        dealStage: filters?.dealStage,
        insightType: filters?.insightType,
      });
      return NextResponse.json({ mode: "insights", results });
    }

    if (searchMode === "chunks") {
      const results = await searchKnowledgeChunks({
        query,
        orgId,
        limit,
        filters: { customerId, opportunityId, ...filters },
      });
      return NextResponse.json({ mode: "chunks", results });
    }

    const chunkResults = await hybridSearch(query, {
      orgId,
      limit: limit ?? 8,
      customerId,
    });

    const insightResults = await searchInsights(query, {
      orgId,
      limit: 3,
      dealStage: filters?.dealStage,
    });

    const stats = await db.salesKnowledgeChunk.count({
      where: { customer: { orgId } },
    });

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
});
