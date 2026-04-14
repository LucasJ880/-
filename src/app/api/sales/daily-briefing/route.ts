/**
 * 销售每日简报 API
 *
 * GET  — 获取当日简报（如果已生成则返回缓存）
 * POST — 立即生成 + 推送简报
 *
 * 简报内容：
 * 1. 今日日程（预约列表）
 * 2. 需要跟进的机会（按紧急度排序）
 * 3. 管线概况统计
 * 4. AI 建议行动（基于扫描结果生成）
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { scanSalesDomain } from "@/lib/secretary/domains/sales";
import { runSimple } from "@/lib/agent-core/engine";

interface SalesBriefing {
  date: string;
  stats: Record<string, number>;
  urgentItems: Array<{ title: string; description: string; severity: string; category: string }>;
  aiSummary: string;
  generatedAt: string;
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const today = new Date().toISOString().slice(0, 10);

  // 尝试返回缓存
  const cached = await db.notification.findFirst({
    where: {
      userId: user.id,
      type: "sales_daily_briefing",
      sourceKey: `sales_briefing:${today}`,
    },
    select: { metadata: true, createdAt: true },
  });

  if (cached?.metadata) {
    return NextResponse.json({ briefing: cached.metadata, cached: true });
  }

  // 生成新简报
  const briefing = await generateBriefing(user.id);
  return NextResponse.json({ briefing, cached: false });
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const briefing = await generateBriefing(user.id);

  // 推送到微信
  try {
    const { pushNotification } = await import("@/lib/messaging/push-service");
    await pushNotification(
      user.id,
      "📊 今日销售简报",
      briefing.aiSummary,
    );
  } catch {}

  return NextResponse.json({ briefing, pushed: true });
}

async function generateBriefing(userId: string): Promise<SalesBriefing> {
  const today = new Date().toISOString().slice(0, 10);

  const scan = await scanSalesDomain(userId);

  const urgentItems = scan.items
    .filter((i) => i.severity === "urgent" || i.severity === "warning")
    .slice(0, 10)
    .map((i) => ({
      title: i.title,
      description: i.description ?? "",
      severity: i.severity,
      category: i.category,
      action: i.action ?? undefined,
    }));

  // AI 生成简报摘要
  const dataBlock = JSON.stringify({
    stats: scan.stats,
    urgentCount: urgentItems.filter((i) => i.severity === "urgent").length,
    warningCount: urgentItems.filter((i) => i.severity === "warning").length,
    topItems: urgentItems.slice(0, 6),
  });

  let aiSummary: string;
  try {
    aiSummary = await runSimple({
      systemPrompt: `你是销售 AI 秘书，为销售人员生成简洁的每日工作简报。
规则：
- 用简洁中文，适合手机微信阅读
- 分成"📅 今日重点"、"⚠️ 需要行动"、"📈 数据概览"三个部分
- 每部分 2-3 行
- 用数字标注优先级
- 最后给一句鼓励语`,
      userPrompt: `生成今日销售简报，数据如下：\n${dataBlock}`,
      mode: "chat",
      temperature: 0.5,
    });
  } catch {
    aiSummary = formatFallbackBriefing(scan.stats, urgentItems);
  }

  const briefing: SalesBriefing = {
    date: today,
    stats: scan.stats,
    urgentItems,
    aiSummary,
    generatedAt: new Date().toISOString(),
  };

  // 缓存到通知表
  const { createNotification } = await import("@/lib/notifications/create");
  await createNotification({
    userId,
    type: "sales_daily_briefing",
    title: `销售每日简报 — ${today}`,
    summary: aiSummary.slice(0, 200),
    sourceKey: `sales_briefing:${today}`,
    metadata: briefing as unknown as Record<string, unknown>,
  }).catch(() => {});

  return briefing;
}

function formatFallbackBriefing(
  stats: Record<string, number>,
  items: Array<{ title: string; severity: string }>,
): string {
  const urgent = items.filter((i) => i.severity === "urgent");
  const warning = items.filter((i) => i.severity === "warning");

  const lines: string[] = [
    "📅 今日销售简报",
    "",
    `📈 活跃机会: ${stats.activeOpportunities ?? 0} | 本月签单: ${stats.signedThisMonth ?? 0} | 今日预约: ${stats.todayAppointments ?? 0}`,
    "",
  ];

  if (urgent.length > 0) {
    lines.push(`🔴 紧急 ${urgent.length} 项:`);
    urgent.slice(0, 3).forEach((i, idx) => lines.push(`  ${idx + 1}. ${i.title}`));
    lines.push("");
  }

  if (warning.length > 0) {
    lines.push(`🟡 注意 ${warning.length} 项:`);
    warning.slice(0, 3).forEach((i, idx) => lines.push(`  ${idx + 1}. ${i.title}`));
  }

  return lines.join("\n");
}
