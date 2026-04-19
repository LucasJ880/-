/**
 * 电子报价单 — 客户当日序号
 *
 * 规则（已和用户确认）：
 * - 序号按「每个销售个人 × 日期」维度计数
 * - 同一销售在某天接触的每一个独立客户按先后顺序分配 01 / 02 / 03 ...
 * - 同一销售同一天同一客户：返回已有序号（不会因为多次保存报价而占用新号）
 * - 如果该客户今日还没有过报价：返回 (当日已存在的 distinct customer 数) + 1
 *
 * 销售 Initial 会附加在 order# 末尾，不同销售天然不会冲突 → 无须乐观锁。
 *
 * Query:
 *   - customerId=cuid        必填
 *   - date=YYYY-MM-DD        可选，默认今日（当地服务器日期）
 */

import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";

function parseDayRange(dateStr: string | null): { dayStart: Date; dayEnd: Date } {
  // 允许传入 YYYY-MM-DD；默认使用服务器当前日期
  const base = dateStr ? new Date(`${dateStr}T00:00:00`) : new Date();
  const dayStart = new Date(base.getFullYear(), base.getMonth(), base.getDate(), 0, 0, 0, 0);
  const dayEnd = new Date(base.getFullYear(), base.getMonth(), base.getDate(), 23, 59, 59, 999);
  return { dayStart, dayEnd };
}

export const GET = withAuth(async (request, _ctx, user) => {
  const { searchParams } = new URL(request.url);
  const customerId = searchParams.get("customerId");
  const dateStr = searchParams.get("date");

  if (!customerId) {
    return NextResponse.json({ error: "customerId 必填" }, { status: 400 });
  }

  const { dayStart, dayEnd } = parseDayRange(dateStr);

  // 查该销售今日创建的所有 quote（按时间升序），取出每个客户最早出现的时间
  const quotes = await db.salesQuote.findMany({
    where: {
      createdById: user.id,
      createdAt: { gte: dayStart, lte: dayEnd },
    },
    select: { customerId: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  // distinct customer 按最早出现顺序排列
  const firstSeen = new Map<string, Date>();
  for (const q of quotes) {
    if (!firstSeen.has(q.customerId)) firstSeen.set(q.customerId, q.createdAt);
  }
  const ordered = Array.from(firstSeen.keys());

  let seq: number;
  const idx = ordered.indexOf(customerId);
  if (idx >= 0) {
    seq = idx + 1;
  } else {
    seq = ordered.length + 1;
  }

  return NextResponse.json({
    seq,
    totalCustomersToday: ordered.length,
    isExisting: idx >= 0,
  });
});
