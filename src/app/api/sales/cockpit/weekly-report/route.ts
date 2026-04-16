/**
 * 销售周报 — AI 生成 + 微信/邮件推送
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import OpenAI from "openai";
import { sendMailAs } from "@/lib/email/sender";

const DAY_MS = 86_400_000;

export const POST = withAuth(async (_request, _ctx, user) => {
  const isAdmin = user.role === "admin" || user.role === "super_admin";
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * DAY_MS);

  const myFilter: Record<string, unknown> = isAdmin ? {} : { assignedToId: user.id };
  const myOrderFilter: Record<string, unknown> = isAdmin ? {} : { creatorId: user.id };

  const [
    weekSigned,
    weekNewLeads,
    weekQuotes,
    weekAppointments,
    activeOpps,
    overdueOrders,
    lowStock,
  ] = await Promise.all([
    db.salesOpportunity.aggregate({
      where: { ...myFilter, stage: { in: ["signed", "completed"] }, wonAt: { gte: weekAgo } },
      _count: true,
      _sum: { estimatedValue: true },
    }),
    db.salesOpportunity.count({
      where: { ...myFilter, createdAt: { gte: weekAgo } },
    }),
    db.salesQuote.count({
      where: isAdmin
        ? { createdAt: { gte: weekAgo } }
        : { createdById: user.id, createdAt: { gte: weekAgo } },
    }),
    db.appointment.count({
      where: {
        ...(isAdmin ? {} : { assignedToId: user.id }),
        startAt: { gte: weekAgo },
        status: { not: "cancelled" },
      },
    }),
    db.salesOpportunity.count({
      where: {
        ...myFilter,
        stage: { in: ["new_lead", "needs_confirmed", "measure_booked", "quoted", "negotiation"] },
      },
    }),
    db.blindsOrder.count({
      where: {
        ...myOrderFilter,
        status: { in: ["confirmed", "in_production", "ready"] },
        expectedInstallDate: { lt: now },
      },
    }),
    isAdmin
      ? db.fabricInventory.count({ where: { status: { in: ["low", "out_of_stock"] } } })
      : 0,
  ]);

  const dataText = `
销售周报数据（${weekAgo.toLocaleDateString("zh-CN")} ~ ${now.toLocaleDateString("zh-CN")}）：
- 本周签约: ${weekSigned._count || 0} 单, 金额 $${((weekSigned._sum.estimatedValue || 0) / 1000).toFixed(1)}k
- 新线索: ${weekNewLeads} 条
- 发出报价: ${weekQuotes} 份
- 预约上门: ${weekAppointments} 次
- 活跃机会: ${activeOpps} 个
- 超期工单: ${overdueOrders} 个
${isAdmin ? `- 库存预警: ${lowStock} 种面料` : ""}
用户角色: ${isAdmin ? "管理员（全局视角）" : "销售（个人视角）"}
  `.trim();

  let report = "";
  try {
    const openai = new OpenAI();
    const completion = await openai.chat.completions.create({
      model: process.env.AI_MODEL || "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `你是 Sunny Blinds 的销售 AI 助理。根据数据生成简洁的中文销售周报（200-300字）。
包含：本周亮点、关注事项、下周建议。语气专业但友好。用数字说话。`,
        },
        { role: "user", content: dataText },
      ],
      max_completion_tokens: 500,
    });
    report = completion.choices[0]?.message?.content || "周报生成失败";
  } catch {
    report = `本周签约 ${weekSigned._count || 0} 单（$${((weekSigned._sum.estimatedValue || 0) / 1000).toFixed(1)}k），新增 ${weekNewLeads} 条线索，发出 ${weekQuotes} 份报价。${overdueOrders > 0 ? `⚠️ ${overdueOrders} 个工单超期。` : ""}`;
  }

  try {
    const { pushNotification } = await import("@/lib/messaging/push-service");
    await pushNotification(user.id, "📊 销售周报", report.slice(0, 500));
  } catch {}

  await sendMailAs(user.id, {
    to: user.email,
    subject: `Sunny Blinds 销售周报 — ${now.toLocaleDateString("zh-CN")}`,
    html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;">
      <h2 style="color:#1e293b;">📊 销售周报</h2>
      <p style="color:#64748b;font-size:13px;">${weekAgo.toLocaleDateString("zh-CN")} ~ ${now.toLocaleDateString("zh-CN")}</p>
      <div style="white-space:pre-wrap;color:#334155;font-size:14px;line-height:1.8;margin:16px 0;">${report}</div>
      <p style="color:#94a3b8;font-size:11px;">Powered by Qingyan AI</p>
    </div>`,
  }).catch(() => {});

  return NextResponse.json({ report });
});
