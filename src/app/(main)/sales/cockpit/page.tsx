"use client";

import { useState, useEffect } from "react";
import { apiJson } from "@/lib/api-fetch";
import { PageHeader } from "@/components/page-header";
import { cn } from "@/lib/utils";
import {
  TrendingUp,
  TrendingDown,
  Users,
  DollarSign,
  FileText,
  CalendarDays,
  Package,
  AlertTriangle,
  Trophy,
  BarChart3,
  ArrowRight,
  Loader2,
} from "lucide-react";
import { SalesRepSettingsCard } from "./sales-rep-settings-card";

interface FunnelItem {
  stage: string;
  label: string;
  count: number;
  value: number;
}

interface TeamMember {
  userId: string;
  userName: string;
  signedCount: number;
  signedValue: number;
}

interface OrderStatus {
  status: string;
  count: number;
}

interface InventoryAlert {
  id: string;
  sku: string;
  fabricName: string;
  productType: string;
  status: string;
  totalYards: number;
  reservedYards: number;
}

interface CockpitData {
  funnel: FunnelItem[];
  teamPerformance: TeamMember[];
  kpi: {
    signedCount: number;
    signedValue: number;
    newLeads: number;
    quotes: number;
    appointments: number;
  };
  orders: OrderStatus[];
  inventoryAlerts: InventoryAlert[];
  weekTrend: {
    thisWeek: { count: number; value: number };
    lastWeek: { count: number; value: number };
    growthPct: number;
  };
}

const ORDER_STATUS_LABELS: Record<string, string> = {
  draft: "草稿",
  confirmed: "已确认",
  in_production: "生产中",
  ready: "待安装",
  scheduled: "已排期",
  installed: "已安装",
  completed: "已完工",
  cancelled: "已取消",
};

const ORDER_STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-200",
  confirmed: "bg-blue-400",
  in_production: "bg-indigo-400",
  ready: "bg-amber-400",
  scheduled: "bg-cyan-400",
  installed: "bg-emerald-400",
  completed: "bg-green-500",
  cancelled: "bg-red-300",
};

export default function SalesCockpitPage() {
  const [data, setData] = useState<CockpitData | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [reportResult, setReportResult] = useState("");

  useEffect(() => {
    apiJson<CockpitData>("/api/sales/cockpit")
      .then(setData)
      .finally(() => setLoading(false));
  }, []);

  const generateReport = async () => {
    setGenerating(true);
    setReportResult("");
    try {
      const res = await apiJson<{ report?: string; error?: string }>("/api/sales/cockpit/weekly-report", { method: "POST" });
      setReportResult(res.report || res.error || "生成完成");
    } finally {
      setGenerating(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin text-muted-foreground" size={24} />
      </div>
    );
  }

  if (!data) return null;

  const totalOrders = data.orders.reduce((s, o) => s + o.count, 0);
  const funnelMax = Math.max(...data.funnel.map((f) => f.count), 1);

  return (
    <div className="space-y-6">
      <PageHeader
        title="销售驾驶舱"
        description="全局业绩、漏斗、工单和库存一览"
        actions={
          <button
            onClick={generateReport}
            disabled={generating}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            <FileText size={15} />
            {generating ? "生成中..." : "生成AI周报"}
          </button>
        }
      />

      {reportResult && (
        <div className="rounded-xl border border-border bg-white/60 p-4">
          <h3 className="text-sm font-semibold mb-2">AI 周报</h3>
          <p className="text-sm text-muted-foreground whitespace-pre-wrap">{reportResult}</p>
        </div>
      )}

      {/* 销售个人设置 — 首次进入会高亮提示未填写 */}
      <SalesRepSettingsCard />

      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
        {[
          { label: "本月签约", value: `$${(data.kpi.signedValue / 1000).toFixed(1)}k`, sub: `${data.kpi.signedCount} 单`, icon: DollarSign, color: "text-emerald-600" },
          { label: "新线索", value: data.kpi.newLeads, sub: "本月", icon: Users, color: "text-blue-600" },
          { label: "报价单", value: data.kpi.quotes, sub: "本月", icon: FileText, color: "text-purple-600" },
          { label: "预约", value: data.kpi.appointments, sub: "本月", icon: CalendarDays, color: "text-cyan-600" },
          {
            label: "周环比",
            value: `${data.weekTrend.growthPct >= 0 ? "+" : ""}${data.weekTrend.growthPct}%`,
            sub: `$${(data.weekTrend.thisWeek.value / 1000).toFixed(1)}k`,
            icon: data.weekTrend.growthPct >= 0 ? TrendingUp : TrendingDown,
            color: data.weekTrend.growthPct >= 0 ? "text-emerald-600" : "text-red-600",
          },
        ].map((card) => (
          <div key={card.label} className="rounded-xl border border-border bg-white/60 p-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <card.icon size={14} className={card.color} />
              {card.label}
            </div>
            <p className={cn("mt-1 text-2xl font-bold", card.color)}>{card.value}</p>
            <p className="text-xs text-muted-foreground">{card.sub}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Funnel */}
        <div className="rounded-xl border border-border bg-white/60 p-5">
          <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
            <BarChart3 size={16} className="text-blue-600" />
            销售漏斗
          </h3>
          <div className="space-y-2.5">
            {data.funnel.map((f, i) => {
              const pct = (f.count / funnelMax) * 100;
              const colors = [
                "bg-blue-500", "bg-blue-400", "bg-indigo-400", "bg-purple-400",
                "bg-violet-400", "bg-emerald-500", "bg-green-500",
              ];
              return (
                <div key={f.stage}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-muted-foreground">{f.label}</span>
                    <span className="font-medium">
                      {f.count} 个 · ${(f.value / 1000).toFixed(1)}k
                    </span>
                  </div>
                  <div className="h-5 rounded-full bg-muted/30 overflow-hidden">
                    <div
                      className={cn("h-full rounded-full transition-all", colors[i] || "bg-blue-400")}
                      style={{ width: `${Math.max(pct, 2)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
            <span>转化率</span>
            <span className="font-medium text-emerald-600">
              {data.funnel[0]?.count > 0
                ? `${(((data.funnel[5]?.count || 0) / data.funnel[0].count) * 100).toFixed(1)}%`
                : "—"
              }
              <span className="text-muted-foreground ml-1">(线索 → 签约)</span>
            </span>
          </div>
        </div>

        {/* Team leaderboard */}
        <div className="rounded-xl border border-border bg-white/60 p-5">
          <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
            <Trophy size={16} className="text-amber-500" />
            团队业绩排行（本月）
          </h3>
          {data.teamPerformance.length > 0 ? (
            <div className="space-y-3">
              {data.teamPerformance.map((m, i) => {
                const maxVal = data.teamPerformance[0]?.signedValue || 1;
                const pct = (m.signedValue / maxVal) * 100;
                return (
                  <div key={m.userId} className="flex items-center gap-3">
                    <span className={cn(
                      "flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold",
                      i === 0 ? "bg-amber-100 text-amber-700" :
                      i === 1 ? "bg-slate-100 text-slate-600" :
                      i === 2 ? "bg-orange-100 text-orange-600" :
                      "bg-muted text-muted-foreground",
                    )}>
                      {i + 1}
                    </span>
                    <div className="flex-1">
                      <div className="flex items-center justify-between text-sm mb-0.5">
                        <span className="font-medium">{m.userName}</span>
                        <span className="text-emerald-600 font-semibold">${(m.signedValue / 1000).toFixed(1)}k</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-muted/30 overflow-hidden">
                        <div className="h-full rounded-full bg-emerald-400" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                    <span className="text-xs text-muted-foreground">{m.signedCount} 单</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground py-6 text-center">暂无数据（仅管理员可见团队排行）</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Order distribution */}
        <div className="rounded-xl border border-border bg-white/60 p-5">
          <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
            <Package size={16} className="text-indigo-600" />
            工单状态分布
          </h3>
          {totalOrders > 0 ? (
            <>
              <div className="flex h-6 rounded-full overflow-hidden mb-3">
                {data.orders.map((o) => {
                  const pct = (o.count / totalOrders) * 100;
                  return (
                    <div
                      key={o.status}
                      className={cn("transition-all", ORDER_STATUS_COLORS[o.status] || "bg-gray-300")}
                      style={{ width: `${pct}%` }}
                      title={`${ORDER_STATUS_LABELS[o.status] || o.status}: ${o.count}`}
                    />
                  );
                })}
              </div>
              <div className="flex flex-wrap gap-3">
                {data.orders.map((o) => (
                  <div key={o.status} className="flex items-center gap-1.5 text-xs">
                    <span className={cn("h-2.5 w-2.5 rounded-full", ORDER_STATUS_COLORS[o.status] || "bg-gray-300")} />
                    <span className="text-muted-foreground">{ORDER_STATUS_LABELS[o.status] || o.status}</span>
                    <span className="font-medium">{o.count}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground py-6 text-center">暂无工单</p>
          )}
        </div>

        {/* Inventory alerts */}
        <div className="rounded-xl border border-border bg-white/60 p-5">
          <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
            <AlertTriangle size={16} className="text-amber-500" />
            库存预警
          </h3>
          {data.inventoryAlerts.length > 0 ? (
            <div className="space-y-2">
              {data.inventoryAlerts.map((f) => {
                const avail = f.totalYards - f.reservedYards;
                return (
                  <div
                    key={f.id}
                    className={cn(
                      "flex items-center justify-between rounded-lg px-3 py-2 text-sm",
                      f.status === "out_of_stock" ? "bg-red-50" : "bg-amber-50",
                    )}
                  >
                    <div>
                      <span className="font-medium">{f.fabricName}</span>
                      <span className="text-xs text-muted-foreground ml-2">{f.productType} · {f.sku}</span>
                    </div>
                    <span className={cn(
                      "text-xs font-medium",
                      f.status === "out_of_stock" ? "text-red-600" : "text-amber-600",
                    )}>
                      {avail.toFixed(1)} yd
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground py-6 text-center">
              {data.inventoryAlerts.length === 0 ? "库存充足 ✓" : ""}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
