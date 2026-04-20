import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import { isSuperAdmin } from "@/lib/rbac/roles";
import {
  buildPeriods,
  findPeriodKey,
  type Granularity,
} from "@/lib/date-periods";

// ── 漏斗状态定义 ───────────────────────────────────────────
//
// - signed: 有机会 stage ∈ {signed, producing, installing, completed}
// - quoted: 有报价但未成单
// - lost:   所有机会都 lost（且无报价）
// - new:    既无报价也无成单
//
// 说明：此统计按"客户创建时间"切段，每个客户只落在它被创建时的那个时段；
// 单元格里的"已报价/已成单"取该客户"当前"的漏斗状态。
// 这更适合看"当月新线索的转化质量"。

const SIGNED_STAGES = new Set([
  "signed",
  "producing",
  "installing",
  "completed",
]);

type FunnelStatus = "new" | "quoted" | "signed" | "lost";

interface CellStats {
  total: number;
  quoted: number;
  signed: number;
  lost: number;
  new: number;
}

function emptyCell(): CellStats {
  return { total: 0, quoted: 0, signed: 0, lost: 0, new: 0 };
}

function addToCell(cell: CellStats, status: FunnelStatus) {
  cell.total += 1;
  cell[status] += 1;
}

/**
 * GET /api/sales/analytics/customer-matrix
 *
 * 销售 × 时段复盘交叉表（admin 专用）。
 *
 * Query:
 *  - startDate: ISO 字符串（必填）
 *  - endDate:   ISO 字符串（必填）
 *  - granularity: week | month | quarter（默认 month）
 *  - salesRepIds: 逗号分隔（可选，筛选特定销售）
 */
export const GET = withAuth(async (request, _ctx, user) => {
  if (!isSuperAdmin(user.role)) {
    return NextResponse.json({ error: "仅管理员可访问" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const startStr = searchParams.get("startDate");
  const endStr = searchParams.get("endDate");
  const granularityRaw = (searchParams.get("granularity") || "month") as Granularity;
  const granularity: Granularity = ["week", "month", "quarter"].includes(granularityRaw)
    ? granularityRaw
    : "month";
  const salesRepIdsParam = searchParams.get("salesRepIds");
  const salesRepIds = salesRepIdsParam
    ? salesRepIdsParam.split(",").map((s) => s.trim()).filter(Boolean)
    : null;

  if (!startStr || !endStr) {
    return NextResponse.json(
      { error: "缺少 startDate / endDate" },
      { status: 400 },
    );
  }
  const start = new Date(startStr);
  const end = new Date(endStr);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return NextResponse.json({ error: "日期格式错误" }, { status: 400 });
  }
  if (end <= start) {
    return NextResponse.json(
      { error: "endDate 必须晚于 startDate" },
      { status: 400 },
    );
  }

  const periods = buildPeriods(start, end, granularity);
  if (periods.length === 0) {
    return NextResponse.json({
      granularity,
      periods: [],
      reps: [],
      colTotals: {},
      grandTotal: emptyCell(),
    });
  }

  // 查询范围取 periods 实际覆盖的区间（可能被对齐成更宽一点）
  const rangeStart = periods[0].start;
  const rangeEnd = periods[periods.length - 1].end;

  const customerWhere: Record<string, unknown> = {
    archivedAt: null,
    createdAt: { gte: rangeStart, lt: rangeEnd },
  };
  if (salesRepIds && salesRepIds.length > 0) {
    customerWhere.createdById = { in: salesRepIds };
  }

  const customers = await db.salesCustomer.findMany({
    where: customerWhere,
    select: {
      id: true,
      createdAt: true,
      createdById: true,
      createdBy: { select: { id: true, name: true, email: true } },
      opportunities: { select: { stage: true } },
      _count: { select: { quotes: true } },
    },
  });

  // —— 逐行聚合：rep × period -> CellStats ——
  const repMap = new Map<
    string,
    {
      id: string;
      name: string;
      email: string;
      cells: Record<string, CellStats>;
      rowTotal: CellStats;
    }
  >();
  const colTotals: Record<string, CellStats> = {};
  const grandTotal = emptyCell();

  for (const p of periods) {
    colTotals[p.key] = emptyCell();
  }

  for (const c of customers) {
    // 推导漏斗状态
    const stages = c.opportunities.map((o) => o.stage);
    const hasSigned = stages.some((s) => SIGNED_STAGES.has(s));
    const hasLost =
      stages.length > 0 && stages.every((s) => s === "lost") && c._count.quotes === 0;
    const hasQuoted = c._count.quotes > 0 || stages.includes("quoted");
    const status: FunnelStatus = hasSigned
      ? "signed"
      : hasQuoted
      ? "quoted"
      : hasLost
      ? "lost"
      : "new";

    const periodKey = findPeriodKey(periods, c.createdAt);
    if (!periodKey) continue;

    const repId = c.createdById;
    const repName = c.createdBy?.name || "（已删除）";
    const repEmail = c.createdBy?.email || "";

    let rep = repMap.get(repId);
    if (!rep) {
      rep = {
        id: repId,
        name: repName,
        email: repEmail,
        cells: Object.fromEntries(
          periods.map((p) => [p.key, emptyCell()]),
        ) as Record<string, CellStats>,
        rowTotal: emptyCell(),
      };
      repMap.set(repId, rep);
    }

    addToCell(rep.cells[periodKey], status);
    addToCell(rep.rowTotal, status);
    addToCell(colTotals[periodKey], status);
    addToCell(grandTotal, status);
  }

  // —— 行按 rowTotal.total 降序排（无客户的销售不展示）——
  const reps = Array.from(repMap.values()).sort(
    (a, b) => b.rowTotal.total - a.rowTotal.total,
  );

  return NextResponse.json({
    granularity,
    periods: periods.map((p) => ({
      key: p.key,
      label: p.label,
      start: p.start.toISOString(),
      end: p.end.toISOString(),
    })),
    reps,
    colTotals,
    grandTotal,
  });
});
