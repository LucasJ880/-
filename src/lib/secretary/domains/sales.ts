/**
 * 销售域扫描器 — AI 秘书
 *
 * 扫描销售模块的所有待办事项：
 * 1. 跟进逾期的机会（nextFollowupAt 已过期）
 * 2. 报价已发送但未跟进（>3天）
 * 3. 活跃机会太久无互动（按阶段不同天数）
 * 4. 新询盘待处理
 * 5. 即将到来的量房/安装日期
 * 6. 管道概况统计
 *
 * 与外贸域扫描器 (trade.ts) 接口一致，返回 DomainScanResult。
 * 销售数据按 userId 过滤（非 orgId），因为销售机会有 assignedToId。
 */

import { db } from "@/lib/db";
import type { DomainScanResult, BriefingItem } from "../types";

const DAY_MS = 86_400_000;

const ACTIVE_STAGES = [
  "new_lead",
  "needs_confirmed",
  "measure_booked",
  "quoted",
  "negotiation",
];

const STAGE_LABELS: Record<string, string> = {
  new_lead: "新线索",
  needs_confirmed: "需求确认",
  measure_booked: "预约量房",
  quoted: "已报价",
  negotiation: "洽谈中",
  signed: "已签单",
  producing: "生产中",
  installing: "安装中",
  completed: "已完成",
  lost: "已流失",
};

const STALE_DAYS: Record<string, number> = {
  new_lead: 3,
  needs_confirmed: 5,
  measure_booked: 5,
  quoted: 3,
  negotiation: 7,
};

/**
 * 扫描销售域 — 支持按 userId 或 orgId 扫描
 * admin 用 orgId 看全局，sales 用 userId 看自己的
 */
export async function scanSalesDomain(
  userId: string,
  options?: { isAdmin?: boolean },
): Promise<DomainScanResult> {
  const now = new Date();
  const items: BriefingItem[] = [];
  const stats: Record<string, number> = {};

  const ownerFilter = options?.isAdmin
    ? {}
    : {
        OR: [
          { assignedToId: userId },
          { createdById: userId },
        ],
      };

  const opportunities = await db.salesOpportunity.findMany({
    where: {
      stage: { in: ACTIVE_STAGES },
      ...ownerFilter,
    },
    include: {
      customer: { select: { id: true, name: true, phone: true, email: true } },
      interactions: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { createdAt: true },
      },
      quotes: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { createdAt: true, status: true, grandTotal: true },
      },
    },
    take: 50,
  });

  const seenKeys = new Set<string>();

  for (const opp of opportunities) {
    // ── 1. 跟进逾期 ──
    if (opp.nextFollowupAt) {
      const msUntil = opp.nextFollowupAt.getTime() - now.getTime();
      if (msUntil <= DAY_MS) {
        const isOverdue = msUntil < 0;
        const daysOverdue = isOverdue ? Math.floor(-msUntil / DAY_MS) : 0;
        const dedupeKey = `sales_followup:${opp.id}`;
        if (!seenKeys.has(dedupeKey)) {
          seenKeys.add(dedupeKey);
          items.push({
            id: `sales_followup_${opp.id}`,
            domain: "sales",
            severity: isOverdue ? "urgent" : "warning",
            category: "followup_due",
            title: isOverdue
              ? `跟进逾期 ${daysOverdue} 天：${opp.customer.name}`
              : `今日跟进：${opp.customer.name}`,
            description: `${opp.title} — ${STAGE_LABELS[opp.stage] ?? opp.stage}`,
            action: {
              type: "view_sales_customer",
              label: "查看客户",
              payload: { customerId: opp.customer.id, opportunityId: opp.id },
            },
            entityType: "sales_customer",
            entityId: opp.customer.id,
            dedupeKey,
          });
        }
      }
    }

    // ── 2. 报价已发但未跟进 ──
    const lastQuote = opp.quotes[0];
    if (lastQuote && opp.stage === "quoted" && lastQuote.status === "sent") {
      const daysSinceQuote = Math.floor(
        (now.getTime() - new Date(lastQuote.createdAt).getTime()) / DAY_MS,
      );
      if (daysSinceQuote >= 3) {
        const dedupeKey = `sales_quote_pending:${opp.id}`;
        if (!seenKeys.has(dedupeKey)) {
          seenKeys.add(dedupeKey);
          items.push({
            id: `sales_quote_${opp.id}`,
            domain: "sales",
            severity: daysSinceQuote >= 7 ? "urgent" : "warning",
            category: "quote_pending",
            title: `报价 ${daysSinceQuote} 天未回复：${opp.customer.name}`,
            description: `${opp.title}，金额 $${lastQuote.grandTotal?.toLocaleString() ?? "N/A"}`,
            action: {
              type: "view_sales_customer",
              label: "跟进客户",
              payload: { customerId: opp.customer.id, opportunityId: opp.id },
            },
            entityType: "sales_customer",
            entityId: opp.customer.id,
            dedupeKey,
          });
        }
      }
    }

    // ── 3. 太久无互动 ──
    const lastInteraction = opp.interactions[0];
    const staleDays = STALE_DAYS[opp.stage] ?? 7;
    const lastActivity = lastInteraction
      ? new Date(lastInteraction.createdAt)
      : new Date(opp.createdAt);
    const daysSilent = Math.floor(
      (now.getTime() - lastActivity.getTime()) / DAY_MS,
    );

    if (daysSilent >= staleDays) {
      const dedupeKey = `sales_stale:${opp.id}`;
      if (!seenKeys.has(dedupeKey)) {
        seenKeys.add(dedupeKey);
        items.push({
          id: `sales_stale_${opp.id}`,
          domain: "sales",
          severity: daysSilent >= staleDays * 2 ? "urgent" : "warning",
          category: "stale_opportunity",
          title: `${daysSilent} 天未联系：${opp.customer.name}`,
          description: `「${opp.title}」处于${STAGE_LABELS[opp.stage] ?? opp.stage}阶段`,
          action: {
            type: "view_sales_customer",
            label: "查看详情",
            payload: { customerId: opp.customer.id },
          },
          entityType: "sales_customer",
          entityId: opp.customer.id,
          dedupeKey,
        });
      }
    }
  }

  // ── 4. 即将到来的量房/安装日期（未来3天） ──
  const threeDaysLater = new Date(now.getTime() + 3 * DAY_MS);

  const upcomingMeasures = await db.salesOpportunity.findMany({
    where: {
      ...ownerFilter,
      measureDate: { gte: now, lte: threeDaysLater },
      stage: { in: ["needs_confirmed", "measure_booked"] },
    },
    include: {
      customer: { select: { id: true, name: true, phone: true, address: true } },
    },
    take: 10,
  });

  for (const opp of upcomingMeasures) {
    const daysUntil = Math.ceil(
      ((opp.measureDate?.getTime() ?? 0) - now.getTime()) / DAY_MS,
    );
    const dedupeKey = `sales_measure:${opp.id}`;
    if (!seenKeys.has(dedupeKey)) {
      seenKeys.add(dedupeKey);
      items.push({
        id: `sales_measure_${opp.id}`,
        domain: "sales",
        severity: daysUntil <= 1 ? "warning" : "info",
        category: "upcoming_measure",
        title: daysUntil <= 0
          ? `今日量房：${opp.customer.name}`
          : `${daysUntil} 天后量房：${opp.customer.name}`,
        description: opp.customer.address
          ? `地址：${opp.customer.address}`
          : `${opp.title}`,
        action: {
          type: "view_sales_customer",
          label: "查看客户",
          payload: { customerId: opp.customer.id },
        },
        entityType: "sales_customer",
        entityId: opp.customer.id,
        dedupeKey,
      });
    }
  }

  const upcomingInstalls = await db.salesOpportunity.findMany({
    where: {
      ...ownerFilter,
      installDate: { gte: now, lte: threeDaysLater },
    },
    include: {
      customer: { select: { id: true, name: true, address: true } },
    },
    take: 10,
  });

  for (const opp of upcomingInstalls) {
    const daysUntil = Math.ceil(
      ((opp.installDate?.getTime() ?? 0) - now.getTime()) / DAY_MS,
    );
    const dedupeKey = `sales_install:${opp.id}`;
    if (!seenKeys.has(dedupeKey)) {
      seenKeys.add(dedupeKey);
      items.push({
        id: `sales_install_${opp.id}`,
        domain: "sales",
        severity: daysUntil <= 1 ? "warning" : "info",
        category: "upcoming_install",
        title: daysUntil <= 0
          ? `今日安装：${opp.customer.name}`
          : `${daysUntil} 天后安装：${opp.customer.name}`,
        description: opp.customer.address
          ? `地址：${opp.customer.address}`
          : `${opp.title}`,
        action: {
          type: "view_sales_customer",
          label: "查看客户",
          payload: { customerId: opp.customer.id },
        },
        entityType: "sales_customer",
        entityId: opp.customer.id,
        dedupeKey,
      });
    }
  }

  // ── 5. 今日/明日上门安排（Appointment 模型） ──
  const tomorrowEnd = new Date(now.getTime() + 2 * DAY_MS);
  tomorrowEnd.setHours(0, 0, 0, 0);

  const appointmentFilter = options?.isAdmin
    ? {}
    : { assignedToId: userId };

  const todayAppointments = await db.appointment.findMany({
    where: {
      ...appointmentFilter,
      startAt: { gte: new Date(now.getFullYear(), now.getMonth(), now.getDate()), lte: tomorrowEnd },
      status: { in: ["scheduled", "confirmed"] },
    },
    include: {
      customer: { select: { id: true, name: true, phone: true, address: true } },
    },
    orderBy: { startAt: "asc" },
    take: 10,
  });

  const APPT_TYPE_LABELS: Record<string, string> = {
    measure: "量房",
    install: "安装",
    revisit: "回访",
    consultation: "咨询",
  };

  if (todayAppointments.length > 0) {
    items.unshift({
      id: `sales_today_schedule_${now.toISOString().slice(0, 10)}`,
      domain: "sales",
      severity: "warning",
      category: "today_schedule",
      title: `今日 ${todayAppointments.length} 个上门安排`,
      description: todayAppointments
        .map((a) => {
          const time = new Date(a.startAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
          return `${time} ${APPT_TYPE_LABELS[a.type] ?? a.type}：${a.customer.name}${a.customer.address ? ` (${a.customer.address})` : ""}`;
        })
        .join("\n"),
      action: { type: "view_sales_calendar", label: "查看日历" },
      dedupeKey: `sales_schedule:${now.toISOString().slice(0, 10)}`,
    });
  }

  for (const appt of todayAppointments) {
    const dedupeKey = `sales_appt:${appt.id}`;
    if (!seenKeys.has(dedupeKey)) {
      seenKeys.add(dedupeKey);
      const time = new Date(appt.startAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
      items.push({
        id: `sales_appt_${appt.id}`,
        domain: "sales",
        severity: "info",
        category: "appointment",
        title: `${time} ${APPT_TYPE_LABELS[appt.type] ?? appt.type}：${appt.customer.name}`,
        description: appt.customer.address
          ? `地址：${appt.customer.address}${appt.customer.phone ? ` | 电话：${appt.customer.phone}` : ""}`
          : appt.customer.phone ? `电话：${appt.customer.phone}` : "",
        action: {
          type: "view_sales_customer",
          label: "查看客户",
          payload: { customerId: appt.customer.id },
        },
        entityType: "sales_customer",
        entityId: appt.customer.id,
        dedupeKey,
      });
    }
  }

  stats.todayAppointments = todayAppointments.length;

  // ── 6. 工单超期提醒 ──
  const overdueOrders = await db.blindsOrder.findMany({
    where: {
      creatorId: userId,
      status: { in: ["confirmed", "in_production", "ready"] },
      expectedInstallDate: { lt: now },
    },
    select: { id: true, code: true, customerName: true, status: true, expectedInstallDate: true },
    take: 10,
  });

  for (const o of overdueOrders) {
    const daysOver = Math.ceil((now.getTime() - (o.expectedInstallDate?.getTime() ?? 0)) / DAY_MS);
    const dedupeKey = `order_overdue:${o.id}`;
    if (!seenKeys.has(dedupeKey)) {
      seenKeys.add(dedupeKey);
      items.push({
        id: `order_overdue_${o.id}`,
        domain: "sales",
        severity: daysOver >= 3 ? "urgent" : "warning",
        category: "order_overdue",
        title: `工单超期 ${daysOver} 天：${o.customerName} (${o.code})`,
        description: `状态: ${o.status}，预计安装日已过`,
        action: { type: "view_blinds_order", label: "查看工单", payload: { orderId: o.id } },
        entityType: "blinds_order",
        entityId: o.id,
        dedupeKey,
      });
    }
  }

  // ── 6b. 面料库存预警 ──
  if (isAdmin) {
    const lowStockFabrics = await db.fabricInventory.findMany({
      where: { status: { in: ["low", "out_of_stock"] } },
      select: { id: true, sku: true, fabricName: true, productType: true, status: true, totalYards: true, reservedYards: true },
      take: 5,
    });

    for (const f of lowStockFabrics) {
      const dedupeKey = `fabric_low:${f.id}`;
      if (!seenKeys.has(dedupeKey)) {
        seenKeys.add(dedupeKey);
        const avail = f.totalYards - f.reservedYards;
        items.push({
          id: `fabric_low_${f.id}`,
          domain: "sales",
          severity: f.status === "out_of_stock" ? "urgent" : "warning",
          category: "fabric_low_stock",
          title: f.status === "out_of_stock"
            ? `面料缺货：${f.fabricName} (${f.productType})`
            : `面料库存偏低：${f.fabricName} (${f.productType})`,
          description: `SKU: ${f.sku} — 可用 ${avail.toFixed(1)} yards`,
          action: { type: "view_inventory", label: "查看库存" },
          entityType: "fabric",
          entityId: f.id,
          dedupeKey,
        });
      }
    }
  }

  // ── 7. 管道统计 ──
  const [totalActive, newInquiries, wonThisMonth] = await Promise.all([
    db.salesOpportunity.count({
      where: { ...ownerFilter, stage: { in: ACTIVE_STAGES } },
    }),
    db.salesOpportunity.count({
      where: {
        ...ownerFilter,
        stage: "new_lead",
        createdAt: { gt: new Date(now.getTime() - DAY_MS) },
      },
    }),
    db.salesOpportunity.count({
      where: {
        ...ownerFilter,
        stage: { in: ["signed", "completed"] },
        wonAt: {
          gte: new Date(now.getFullYear(), now.getMonth(), 1),
        },
      },
    }),
  ]);
  stats.activeOpportunities = totalActive;
  stats.newInquiries = newInquiries;
  stats.signedThisMonth = wonThisMonth;

  if (newInquiries > 0) {
    items.unshift({
      id: `sales_new_leads_${now.toISOString().slice(0, 10)}`,
      domain: "sales",
      severity: "info",
      category: "new_leads",
      title: `昨日新增 ${newInquiries} 条线索`,
      description: "建议尽快联系客户。",
      action: { type: "view_sales_board", label: "查看看板" },
      dedupeKey: `sales_new:${now.toISOString().slice(0, 10)}`,
    });
  }

  // 排序
  const order: Record<string, number> = { urgent: 0, warning: 1, info: 2 };
  items.sort((a, b) => (order[a.severity] ?? 2) - (order[b.severity] ?? 2));

  return { domain: "sales", items, stats };
}
