/**
 * Trade AI 对话助手
 *
 * 老板用自然语言管理外贸流程：
 * - 查询线索/活动/报价状态
 * - 触发 AI 操作（研究/打分/生成开发信）
 * - 获取汇总和建议
 *
 * 架构: System Prompt + Tool Definitions → AI 自主决策调用哪个工具
 */

import { createCompletion } from "@/lib/ai/client";
import { db } from "@/lib/db";

// ── Tool Definitions ────────────────────────────────────────

interface ToolResult {
  text: string;
  data?: Record<string, unknown>;
}

type ToolFn = (orgId: string, args: Record<string, string>) => Promise<ToolResult>;

const TOOLS: Record<string, { description: string; params: string; fn: ToolFn }> = {
  get_overview: {
    description: "获取外贸总览数据（活动数/线索数/报价数/待跟进）",
    params: "",
    fn: toolGetOverview,
  },
  list_campaigns: {
    description: "列出所有获客活动",
    params: "",
    fn: toolListCampaigns,
  },
  search_prospects: {
    description: "搜索线索（按公司名/国家/阶段）",
    params: "query: 搜索关键词, stage?: 阶段筛选",
    fn: toolSearchProspects,
  },
  get_prospect: {
    description: "获取某个线索的详细信息",
    params: "prospectId: 线索ID 或 companyName: 公司名",
    fn: toolGetProspect,
  },
  get_follow_ups: {
    description: "获取需要跟进的线索列表",
    params: "",
    fn: toolGetFollowUps,
  },
  list_quotes: {
    description: "列出报价单",
    params: "status?: 状态筛选(draft/sent/accepted/rejected)",
    fn: toolListQuotes,
  },
  get_suggestions: {
    description: "获取下一步行动建议",
    params: "",
    fn: toolGetSuggestions,
  },
};

// ── System Prompt ───────────────────────────────────────────

function buildSystemPrompt(): string {
  const toolList = Object.entries(TOOLS)
    .map(([name, t]) => `- ${name}(${t.params}): ${t.description}`)
    .join("\n");

  return `你是「青砚」外贸 AI 助手，帮助老板用中文自然语言管理外贸获客流程。

你的能力：
${toolList}

回复规则：
1. 用简洁中文回复，信息密度高
2. 当需要查询数据时，在回复中使用 [TOOL:工具名(参数)] 格式调用工具
3. 调用格式示例：[TOOL:get_overview()] 或 [TOOL:search_prospects(query=德国,stage=interested)]
4. 一次回复可调用多个工具
5. 如果用户的问题不需要查数据，直接回答（外贸知识、谈判策略等）
6. 给出具体可执行的建议，不说废话
7. 涉及金额用 USD 显示，日期用中文格式
8. 如果无法确定用户意图，列出你能做的事情让用户选择

你了解外贸全流程：找客户→研究→评分→开发信→跟进→报价→成交
你的角色是老板的外贸 AI 参谋，帮他做决策、盯进度、提醒遗漏。`;
}

// ── Main Chat Function ──────────────────────────────────────

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export async function processChat(
  orgId: string,
  userMessage: string,
  history: ChatMessage[],
): Promise<string> {
  const systemPrompt = buildSystemPrompt();

  const recentHistory = history.slice(-10);

  const firstPass = await createCompletion({
    systemPrompt,
    userPrompt: [
      ...recentHistory.map((m) => `${m.role === "user" ? "用户" : "助手"}: ${m.content}`),
      `用户: ${userMessage}`,
    ].join("\n"),
    mode: "chat",
    temperature: 0.3,
  });

  const toolCalls = parseToolCalls(firstPass);

  if (toolCalls.length === 0) {
    return firstPass;
  }

  const toolResults: string[] = [];
  for (const call of toolCalls) {
    const tool = TOOLS[call.name];
    if (!tool) {
      toolResults.push(`[${call.name}]: 未知工具`);
      continue;
    }
    try {
      const result = await tool.fn(orgId, call.args);
      toolResults.push(`[${call.name}结果]: ${result.text}`);
    } catch (e) {
      toolResults.push(`[${call.name}]: 查询失败 - ${e instanceof Error ? e.message : "未知错误"}`);
    }
  }

  const finalResponse = await createCompletion({
    systemPrompt: `你是「青砚」外贸 AI 助手。根据工具返回的数据，用简洁中文回复用户。
不要暴露工具调用细节，直接呈现有用的信息和建议。
用表格或列表呈现数据（如果合适），给出具体行动建议。`,
    userPrompt: `用户问题: ${userMessage}

工具返回数据:
${toolResults.join("\n\n")}

请基于以上数据，回复用户。`,
    mode: "chat",
    temperature: 0.3,
  });

  return finalResponse;
}

// ── Tool Call Parser ────────────────────────────────────────

function parseToolCalls(text: string): { name: string; args: Record<string, string> }[] {
  const regex = /\[TOOL:(\w+)\(([^)]*)\)\]/g;
  const calls: { name: string; args: Record<string, string> }[] = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    const name = match[1];
    const argsStr = match[2];
    const args: Record<string, string> = {};
    if (argsStr.trim()) {
      for (const part of argsStr.split(",")) {
        const [k, v] = part.split("=").map((s) => s.trim());
        if (k && v) args[k] = v;
      }
    }
    calls.push({ name, args });
  }
  return calls;
}

// ── Tool Implementations ────────────────────────────────────

async function toolGetOverview(orgId: string): Promise<ToolResult> {
  const [campaigns, prospects, quotes, followUps] = await Promise.all([
    db.tradeCampaign.count({ where: { orgId } }),
    db.tradeProspect.count({ where: { orgId } }),
    db.tradeQuote.count({ where: { orgId } }),
    db.tradeProspect.count({
      where: { orgId, nextFollowUpAt: { lt: new Date() }, stage: { notIn: ["won", "lost", "unqualified"] } },
    }),
  ]);

  const stageGroups = await db.tradeProspect.groupBy({
    by: ["stage"],
    where: { orgId },
    _count: true,
  });
  const stages = Object.fromEntries(stageGroups.map((g) => [g.stage, g._count]));

  const quoteSum = await db.tradeQuote.aggregate({
    where: { orgId },
    _sum: { totalAmount: true },
  });

  return {
    text: `活动: ${campaigns} | 线索总数: ${prospects} | 报价: ${quotes}份 (总额 $${(quoteSum._sum.totalAmount ?? 0).toLocaleString()}) | 逾期跟进: ${followUps}
线索分布: 新发现${stages["new"] ?? 0} / 已研究${stages["researched"] ?? 0} / 合格${stages["qualified"] ?? 0} / 已联系${stages["outreach_sent"] ?? 0} / 有意向${stages["interested"] ?? 0} / 谈判中${stages["negotiating"] ?? 0} / 成交${stages["won"] ?? 0} / 无回复${stages["no_response"] ?? 0}`,
  };
}

async function toolListCampaigns(orgId: string): Promise<ToolResult> {
  const campaigns = await db.tradeCampaign.findMany({
    where: { orgId },
    orderBy: { createdAt: "desc" },
    take: 10,
    include: { _count: { select: { prospects: true } } },
  });

  if (campaigns.length === 0) return { text: "暂无获客活动" };

  const lines = campaigns.map((c) =>
    `• ${c.name} [${c.status}] — ${c._count.prospects}线索, 合格${c.qualified}, 已联系${c.contacted} (${c.targetMarket})`
  );
  return { text: lines.join("\n") };
}

async function toolSearchProspects(orgId: string, args: Record<string, string>): Promise<ToolResult> {
  const query = args.query ?? "";
  const stage = args.stage;

  const prospects = await db.tradeProspect.findMany({
    where: {
      orgId,
      ...(stage ? { stage } : {}),
      OR: query ? [
        { companyName: { contains: query } },
        { country: { contains: query } },
        { contactName: { contains: query } },
      ] : undefined,
    },
    orderBy: { score: "desc" },
    take: 15,
    select: {
      id: true, companyName: true, contactName: true, country: true,
      score: true, stage: true, lastContactAt: true,
      campaign: { select: { name: true } },
    },
  });

  if (prospects.length === 0) return { text: `未找到匹配「${query}」的线索` };

  const lines = prospects.map((p) =>
    `• ${p.companyName} (${p.country ?? "?"}) — 评分${p.score?.toFixed(1) ?? "未评"} [${p.stage}] ${p.contactName ?? ""} [活动:${p.campaign.name}]`
  );
  return { text: `找到 ${prospects.length} 条线索:\n${lines.join("\n")}` };
}

async function toolGetProspect(orgId: string, args: Record<string, string>): Promise<ToolResult> {
  let prospect;

  if (args.prospectId) {
    prospect = await db.tradeProspect.findUnique({
      where: { id: args.prospectId },
      include: { campaign: true, messages: { orderBy: { createdAt: "desc" }, take: 5 } },
    });
  } else if (args.companyName) {
    prospect = await db.tradeProspect.findFirst({
      where: { orgId, companyName: { contains: args.companyName } },
      include: { campaign: true, messages: { orderBy: { createdAt: "desc" }, take: 5 } },
    });
  }

  if (!prospect) return { text: "未找到该线索" };

  const p = prospect;
  const report = p.researchReport as Record<string, unknown> | null;

  let text = `【${p.companyName}】
国家: ${p.country ?? "未知"} | 联系人: ${p.contactName ?? "未知"} | 邮箱: ${p.contactEmail ?? "无"}
评分: ${p.score?.toFixed(1) ?? "未评"}/10 | 阶段: ${p.stage} | 活动: ${p.campaign.name}
上次联系: ${p.lastContactAt ? new Date(p.lastContactAt).toLocaleDateString("zh-CN") : "无"}
下次跟进: ${p.nextFollowUpAt ? new Date(p.nextFollowUpAt).toLocaleDateString("zh-CN") : "未设置"}`;

  if (report) {
    text += `\n研究摘要: ${(report.summary as string)?.slice(0, 200) ?? "无"}`;
  }
  if (p.scoreReason) {
    text += `\n评分理由: ${p.scoreReason.slice(0, 150)}`;
  }
  if (p.messages.length > 0) {
    text += `\n最近消息 (${p.messages.length}条): ${p.messages[0].content.slice(0, 100)}...`;
  }

  return { text };
}

async function toolGetFollowUps(orgId: string): Promise<ToolResult> {
  const now = new Date();
  const prospects = await db.tradeProspect.findMany({
    where: {
      orgId,
      nextFollowUpAt: { not: null },
      stage: { notIn: ["won", "lost", "unqualified"] },
    },
    orderBy: { nextFollowUpAt: "asc" },
    take: 15,
    select: {
      companyName: true, contactName: true, stage: true,
      nextFollowUpAt: true, followUpCount: true,
      campaign: { select: { name: true } },
    },
  });

  if (prospects.length === 0) return { text: "暂无待跟进线索" };

  const lines = prospects.map((p) => {
    const followUpDate = p.nextFollowUpAt!;
    const isOverdue = followUpDate < now;
    const days = Math.ceil(Math.abs(followUpDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    const status = isOverdue ? `⚠️ 逾期${days}天` : days === 0 ? "📌 今天" : `${days}天后`;
    return `• ${p.companyName} [${p.stage}] — ${status} (已跟进${p.followUpCount}次)`;
  });

  const overdue = prospects.filter((p) => p.nextFollowUpAt! < now).length;
  return { text: `待跟进 ${prospects.length} 条 (${overdue}条已逾期):\n${lines.join("\n")}` };
}

async function toolListQuotes(orgId: string, args: Record<string, string>): Promise<ToolResult> {
  const quotes = await db.tradeQuote.findMany({
    where: {
      orgId,
      ...(args.status ? { status: args.status } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: {
      quoteNumber: true, companyName: true, status: true,
      currency: true, totalAmount: true, createdAt: true,
    },
  });

  if (quotes.length === 0) return { text: "暂无报价单" };

  const statusLabels: Record<string, string> = {
    draft: "草稿", sent: "已发", accepted: "已接受", rejected: "已拒", expired: "过期",
  };

  const lines = quotes.map((q) =>
    `• ${q.quoteNumber} — ${q.companyName} [${statusLabels[q.status] ?? q.status}] ${q.currency} ${q.totalAmount.toLocaleString()} (${new Date(q.createdAt).toLocaleDateString("zh-CN")})`
  );
  return { text: `共 ${quotes.length} 份报价:\n${lines.join("\n")}` };
}

async function toolGetSuggestions(orgId: string): Promise<ToolResult> {
  const now = new Date();

  const [overdue, noResponse, qualified, draftQuotes] = await Promise.all([
    db.tradeProspect.count({
      where: { orgId, nextFollowUpAt: { lt: now }, stage: { notIn: ["won", "lost", "unqualified"] } },
    }),
    db.tradeProspect.count({ where: { orgId, stage: "no_response" } }),
    db.tradeProspect.count({ where: { orgId, stage: "qualified" } }),
    db.tradeQuote.count({ where: { orgId, status: "draft" } }),
  ]);

  const suggestions: string[] = [];

  if (overdue > 0) suggestions.push(`🔴 ${overdue} 条线索跟进已逾期，建议立即处理`);
  if (qualified > 0) suggestions.push(`🟡 ${qualified} 条合格线索未联系，建议生成开发信`);
  if (noResponse > 0) suggestions.push(`🟠 ${noResponse} 条线索发信后无回复，建议安排二次跟进`);
  if (draftQuotes > 0) suggestions.push(`📋 ${draftQuotes} 份草稿报价未发送，建议检查后发出`);

  if (suggestions.length === 0) suggestions.push("✅ 当前暂无紧急事项，继续保持！");

  return { text: suggestions.join("\n") };
}
