/**
 * 销售上下文构建 — 为 AI 对话注入销售数据
 */

import { db } from "@/lib/db";

export interface SalesContext {
  customerCount: number;
  pipelineSummary: { stage: string; count: number; totalValue: number }[];
  recentQuotes: {
    id: string;
    customerName: string;
    grandTotal: number;
    status: string;
    createdAt: string;
  }[];
  upcomingFollowups: {
    customerName: string;
    opportunityTitle: string;
    nextFollowupAt: string;
    stage: string;
  }[];
  staleOpportunities: {
    customerName: string;
    opportunityTitle: string;
    daysSinceUpdate: number;
    stage: string;
    estimatedValue: number | null;
  }[];
}

const STAGE_ZH: Record<string, string> = {
  new_inquiry: "新询盘",
  consultation_booked: "已约咨询",
  measured: "已测量",
  quoted: "已报价",
  negotiation: "洽谈中",
  won: "已成交",
  lost: "已流失",
  on_hold: "暂搁置",
};

export async function getSalesContext(userId: string): Promise<SalesContext> {
  const now = new Date();
  const staleDays = 14;
  const staleDate = new Date(now.getTime() - staleDays * 86400000);
  const followupWindow = new Date(now.getTime() + 7 * 86400000);

  const [customers, opportunities, recentQuotes] = await Promise.all([
    db.salesCustomer.count({ where: { createdById: userId } }),
    db.salesOpportunity.findMany({
      where: {
        customer: { createdById: userId },
        stage: { notIn: ["won", "lost"] },
      },
      include: { customer: { select: { name: true } } },
      orderBy: { updatedAt: "desc" },
    }),
    db.salesQuote.findMany({
      where: { customer: { createdById: userId } },
      include: { customer: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
  ]);

  const pipelineMap = new Map<string, { count: number; totalValue: number }>();
  const upcoming: SalesContext["upcomingFollowups"] = [];
  const stale: SalesContext["staleOpportunities"] = [];

  for (const opp of opportunities) {
    const entry = pipelineMap.get(opp.stage) || { count: 0, totalValue: 0 };
    entry.count++;
    entry.totalValue += opp.estimatedValue ?? 0;
    pipelineMap.set(opp.stage, entry);

    if (
      opp.nextFollowupAt &&
      new Date(opp.nextFollowupAt) <= followupWindow
    ) {
      upcoming.push({
        customerName: opp.customer.name,
        opportunityTitle: opp.title,
        nextFollowupAt: new Date(opp.nextFollowupAt).toISOString().slice(0, 10),
        stage: STAGE_ZH[opp.stage] || opp.stage,
      });
    }

    if (new Date(opp.updatedAt) < staleDate) {
      const daysSince = Math.floor(
        (now.getTime() - new Date(opp.updatedAt).getTime()) / 86400000
      );
      stale.push({
        customerName: opp.customer.name,
        opportunityTitle: opp.title,
        daysSinceUpdate: daysSince,
        stage: STAGE_ZH[opp.stage] || opp.stage,
        estimatedValue: opp.estimatedValue ? Number(opp.estimatedValue) : null,
      });
    }
  }

  const pipelineSummary = Array.from(pipelineMap.entries()).map(
    ([stage, data]) => ({
      stage: STAGE_ZH[stage] || stage,
      count: data.count,
      totalValue: data.totalValue,
    })
  );

  return {
    customerCount: customers,
    pipelineSummary,
    recentQuotes: recentQuotes.map((q) => ({
      id: q.id,
      customerName: q.customer.name,
      grandTotal: Number(q.grandTotal),
      status: q.status,
      createdAt: new Date(q.createdAt).toISOString().slice(0, 10),
    })),
    upcomingFollowups: upcoming,
    staleOpportunities: stale,
  };
}

export function buildSalesContextBlock(ctx: SalesContext): string {
  if (ctx.customerCount === 0) return "";

  const lines: string[] = [
    "\n\n## 销售数据概览",
    `客户总数: ${ctx.customerCount}`,
  ];

  if (ctx.pipelineSummary.length > 0) {
    lines.push("\n### Pipeline 状态");
    lines.push("| 阶段 | 数量 | 估值 |");
    lines.push("|---|---|---|");
    for (const s of ctx.pipelineSummary) {
      lines.push(`| ${s.stage} | ${s.count} | $${s.totalValue.toLocaleString()} |`);
    }
  }

  if (ctx.upcomingFollowups.length > 0) {
    lines.push("\n### 近期待跟进");
    for (const f of ctx.upcomingFollowups) {
      lines.push(`- ${f.customerName} — ${f.opportunityTitle} (${f.stage}, 跟进日期: ${f.nextFollowupAt})`);
    }
  }

  if (ctx.staleOpportunities.length > 0) {
    lines.push("\n### 超 14 天未更新");
    for (const s of ctx.staleOpportunities) {
      lines.push(
        `- ${s.customerName} — ${s.opportunityTitle} (${s.stage}, ${s.daysSinceUpdate}天未动${s.estimatedValue ? `, $${s.estimatedValue.toLocaleString()}` : ""})`
      );
    }
  }

  if (ctx.recentQuotes.length > 0) {
    lines.push("\n### 最近报价");
    for (const q of ctx.recentQuotes) {
      lines.push(`- ${q.customerName} $${q.grandTotal.toFixed(2)} (${q.status}, ${q.createdAt})`);
    }
  }

  return lines.join("\n");
}
