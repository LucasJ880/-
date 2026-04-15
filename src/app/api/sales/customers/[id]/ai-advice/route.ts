import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import { createCompletion } from "@/lib/ai/client";
import { getExpertSystemPrompt } from "@/lib/ai/expert-roles";
import { aggregateDealHealth } from "@/lib/sales/communication-analyzer";

export const POST = withAuth(async (_request, ctx) => {
  const { id } = await ctx.params;

  const customer = await db.salesCustomer.findUnique({
    where: { id },
    include: {
      opportunities: {
        orderBy: { updatedAt: "desc" },
        take: 5,
        include: {
          interactions: {
            where: { analysisResult: { not: Prisma.AnyNull } },
            orderBy: { createdAt: "desc" },
            take: 10,
            select: { analysisResult: true, createdAt: true },
          },
        },
      },
      interactions: {
        orderBy: { createdAt: "desc" },
        take: 10,
        include: { createdBy: { select: { name: true } } },
      },
      quotes: {
        orderBy: { createdAt: "desc" },
        take: 5,
        include: { items: true },
      },
      profile: true,
    },
  });

  if (!customer) return NextResponse.json({ error: "客户不存在" }, { status: 404 });

  const lines: string[] = [
    `客户: ${customer.name}`,
    `电话: ${customer.phone || "无"} | 邮箱: ${customer.email || "无"}`,
    `地址: ${customer.address || "无"} | 来源: ${customer.source || "未知"}`,
    customer.notes ? `备注: ${customer.notes}` : "",
  ];

  if (customer.profile) {
    const p = customer.profile;
    lines.push("", "## AI 客户画像");
    if (p.customerType) lines.push(`- 客户类型: ${p.customerType}`);
    if (p.budgetRange) lines.push(`- 预算档位: ${p.budgetRange}`);
    if (p.communicationStyle) lines.push(`- 沟通风格: ${p.communicationStyle}`);
    if (p.decisionSpeed) lines.push(`- 决策速度: ${p.decisionSpeed}`);
    if ((p.keyNeeds as string[])?.length) lines.push(`- 核心需求: ${(p.keyNeeds as string[]).join(", ")}`);
    if ((p.objectionHistory as string[])?.length) lines.push(`- 历史异议: ${(p.objectionHistory as string[]).join(", ")}`);
    if (p.priceSensitivity != null) lines.push(`- 价格敏感度: ${(p.priceSensitivity * 100).toFixed(0)}%`);
    if (p.winProbability != null) lines.push(`- AI 预测赢率: ${(p.winProbability * 100).toFixed(0)}%`);
  }

  const allAnalyses: Array<{ dealHealthScore: number; createdAt: Date }> = [];
  if (customer.opportunities.length > 0) {
    lines.push("", "## 销售机会");
    for (const opp of customer.opportunities) {
      const analyses = opp.interactions
        .map((i) => {
          const r = i.analysisResult as Record<string, unknown> | null;
          if (!r || typeof r.dealHealthScore !== "number") return null;
          return { dealHealthScore: r.dealHealthScore as number, createdAt: i.createdAt };
        })
        .filter(Boolean) as Array<{ dealHealthScore: number; createdAt: Date }>;
      allAnalyses.push(...analyses);
      const health = aggregateDealHealth(analyses);

      lines.push(
        `- ${opp.title} | ${opp.stage} | ${opp.priority}` +
          (opp.estimatedValue ? ` | $${opp.estimatedValue}` : "") +
          (health > 0 ? ` | Deal 健康度: ${health}/100` : "") +
          (opp.nextFollowupAt ? ` | 跟进: ${new Date(opp.nextFollowupAt).toISOString().slice(0, 10)}` : "") +
          ` | 更新: ${new Date(opp.updatedAt).toISOString().slice(0, 10)}`
      );
    }
  }

  if (customer.interactions.length > 0) {
    lines.push("", "## 最近互动");
    for (const int of customer.interactions) {
      lines.push(`- [${new Date(int.createdAt).toISOString().slice(0, 10)}] ${int.type}: ${int.summary}`);
    }
  }

  if (customer.quotes.length > 0) {
    lines.push("", "## 报价");
    for (const q of customer.quotes) {
      lines.push(
        `- v${q.version} $${Number(q.grandTotal).toFixed(2)} (${q.status}) ${q.items.map((i) => i.product).join(", ")}`
      );
    }
  }

  let knowledgeContext = "";
  try {
    const { hybridSearch, searchInsights } = await import("@/lib/sales/vector-search");
    const searchQuery = `${customer.name} ${customer.opportunities.map((o) => o.title).join(" ")}`.trim();
    if (searchQuery) {
      const chunks = await hybridSearch(searchQuery, { limit: 3, customerId: id });
      const insights = await searchInsights(searchQuery, { limit: 2, minEffectiveness: 0.3 });

      if (chunks.length > 0) {
        knowledgeContext += "\n\n## 知识库相关记录\n";
        knowledgeContext += chunks
          .map((c, i) => `[${i + 1}] ${c.isWinPattern ? "(赢单模式) " : ""}${c.content.slice(0, 200)}`)
          .join("\n");
      }
      if (insights.length > 0) {
        knowledgeContext += "\n\n## AI 洞察\n";
        knowledgeContext += insights
          .map((ins, i) => `[${i + 1}] ${ins.title}: ${ins.description.slice(0, 150)}`)
          .join("\n");
      }
    }
  } catch {
    // knowledge base not yet initialized
  }

  const overallHealth = aggregateDealHealth(allAnalyses);
  const expertPrompt = getExpertSystemPrompt("sales_advisor") || "";

  const userPrompt = `以下是客户资料：

${lines.filter(Boolean).join("\n")}
${knowledgeContext}

请用简洁的方式给出：
1. 客户当前阶段判断（1句话）
2. Deal 健康度分析（基于 ${overallHealth}/100 分，解释原因）
3. 推荐的下一步行动（2-3条，具体可执行）
4. 如果需要跟进，建议的跟进话术要点（中英文）
5. 基于知识库中的相似案例，给出针对性建议

输出保持简洁，直接可用。`;

  try {
    const result = await createCompletion({
      systemPrompt: expertPrompt,
      userPrompt,
      mode: "balanced",
    });

    return NextResponse.json({
      advice: result,
      profile: customer.profile
        ? {
            customerType: customer.profile.customerType,
            budgetRange: customer.profile.budgetRange,
            communicationStyle: customer.profile.communicationStyle,
            decisionSpeed: customer.profile.decisionSpeed,
            keyNeeds: customer.profile.keyNeeds,
            objectionHistory: customer.profile.objectionHistory,
            priceSensitivity: customer.profile.priceSensitivity,
            winProbability: customer.profile.winProbability,
            confidence: customer.profile.confidence,
            productPreferences: customer.profile.productPreferences,
          }
        : null,
      dealHealth: overallHealth,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "AI 生成失败" },
      { status: 500 }
    );
  }
});
