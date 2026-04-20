"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { apiJson } from "@/lib/api-fetch";
import { cn } from "@/lib/utils";
import { Percent, Calendar, Users, Loader2, TrendingDown, ArrowUp, ArrowDown, Minus } from "lucide-react";
import { useCurrentUser } from "@/lib/hooks/use-current-user";

/**
 * 折扣率数统卡片 —— 驾驶舱
 *
 * - 只统计已签单（signedAt in [from, to]）的报价
 * - 按含税成交额三档：< $2,000 / $2,000–$5,000 / > $5,000
 * - 管理员可按销售筛选 + 查看 team breakdown
 */

interface TierStats {
  tier: "under2k" | "mid" | "over5k";
  label: string;
  count: number;
  avgDiscountPct: number;
  totalSignedValue: number;
}

interface RepOption {
  id: string;
  name: string;
  salesRepInitials: string | null;
}

interface RepStats {
  id: string;
  name: string;
  count: number;
  avgDiscountPct: number;
  totalSignedValue: number;
}

interface DiscountStatsDto {
  from: string;
  to: string;
  salesRepId: string | null;
  isAdmin: boolean;
  total: { count: number; avgDiscountPct: number; totalSignedValue: number };
  prev: {
    from: string;
    to: string;
    count: number;
    avgDiscountPct: number;
    totalSignedValue: number;
  };
  tiers: TierStats[];
  salesReps: RepStats[];
  repOptions: RepOption[];
}

/**
 * 环比角标
 * direction: "higher-is-better"（成单额/成单数 —— ↑ 绿 ↓ 红）
 *            "lower-is-better" （折扣率 —— ↑ 红 ↓ 绿）
 */
function DeltaBadge({
  current,
  prev,
  isPct,
  direction,
}: {
  current: number;
  prev: number;
  isPct?: boolean;
  direction: "higher-is-better" | "lower-is-better";
}) {
  if (prev === 0) {
    return current === 0 ? (
      <span className="text-[10px] text-muted-foreground">—</span>
    ) : (
      <span className="text-[10px] font-medium text-emerald-600">新</span>
    );
  }

  const diff = isPct ? (current - prev) * 100 : ((current - prev) / Math.abs(prev)) * 100;
  const abs = Math.abs(diff);
  if (abs < 0.05) {
    return (
      <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground">
        <Minus size={10} /> 持平
      </span>
    );
  }
  const up = diff > 0;
  const good = direction === "higher-is-better" ? up : !up;
  const Icon = up ? ArrowUp : ArrowDown;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 text-[10px] font-semibold",
        good ? "text-emerald-600" : "text-red-600",
      )}
    >
      <Icon size={10} />
      {isPct ? `${abs.toFixed(1)}pp` : `${abs.toFixed(1)}%`}
    </span>
  );
}

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function DiscountStatsCard() {
  const { user } = useCurrentUser();
  const isAdmin = user?.role === "admin" || user?.role === "super_admin";

  // 默认时间：本月 1 号 → 今天
  const [from, setFrom] = useState(() => {
    const d = new Date();
    return formatDate(new Date(d.getFullYear(), d.getMonth(), 1));
  });
  const [to, setTo] = useState(() => formatDate(new Date()));
  const [salesRepId, setSalesRepId] = useState<string>("");

  const [data, setData] = useState<DiscountStatsDto | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ from, to });
      if (salesRepId) params.set("salesRepId", salesRepId);
      const d = await apiJson<DiscountStatsDto>(`/api/sales/cockpit/discount-stats?${params}`);
      setData(d);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [from, to, salesRepId]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  const maxTierValue = useMemo(() => {
    if (!data) return 1;
    return Math.max(1, ...data.tiers.map((t) => t.totalSignedValue));
  }, [data]);

  return (
    <div className="rounded-xl border border-border bg-white/60 p-5">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <TrendingDown size={16} className="text-orange-600" />
          折扣率数统
        </h3>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5">
            <Calendar size={12} className="text-muted-foreground" />
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="rounded-md border border-input bg-white px-2 py-1 text-xs font-medium"
            />
            <span className="text-xs text-muted-foreground">→</span>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="rounded-md border border-input bg-white px-2 py-1 text-xs font-medium"
            />
          </div>

          {isAdmin && data && data.repOptions.length > 0 && (
            <div className="flex items-center gap-1.5">
              <Users size={12} className="text-muted-foreground" />
              <select
                value={salesRepId}
                onChange={(e) => setSalesRepId(e.target.value)}
                className="rounded-md border border-input bg-white px-2 py-1 text-xs font-medium"
              >
                <option value="">全部销售</option>
                {data.repOptions.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.salesRepInitials ? `${r.salesRepInitials} · ${r.name}` : r.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

      {loading ? (
        <div className="py-10 flex items-center justify-center text-muted-foreground">
          <Loader2 className="animate-spin" size={16} />
        </div>
      ) : !data || data.total.count === 0 ? (
        <div className="py-8 text-center text-sm text-muted-foreground">
          所选区间内没有已成单的折扣数据
        </div>
      ) : (
        <>
          {/* 总览 */}
          <div className="mb-4 grid grid-cols-3 gap-3">
            <div className="rounded-lg bg-orange-50 p-3">
              <div className="flex items-center justify-between">
                <div className="text-[10px] text-orange-700 font-medium">区间成单数</div>
                <DeltaBadge
                  current={data.total.count}
                  prev={data.prev.count}
                  direction="higher-is-better"
                />
              </div>
              <div className="text-lg font-bold text-orange-700">{data.total.count}</div>
            </div>
            <div className="rounded-lg bg-emerald-50 p-3">
              <div className="flex items-center justify-between">
                <div className="text-[10px] text-emerald-700 font-medium">累计成交额（含税）</div>
                <DeltaBadge
                  current={data.total.totalSignedValue}
                  prev={data.prev.totalSignedValue}
                  direction="higher-is-better"
                />
              </div>
              <div className="text-lg font-bold text-emerald-700">
                ${data.total.totalSignedValue.toLocaleString()}
              </div>
            </div>
            <div className="rounded-lg bg-slate-50 p-3">
              <div className="flex items-center justify-between">
                <div className="text-[10px] text-slate-700 font-medium">整体平均折扣率</div>
                <DeltaBadge
                  current={data.total.avgDiscountPct}
                  prev={data.prev.avgDiscountPct}
                  isPct
                  direction="lower-is-better"
                />
              </div>
              <div className="text-lg font-bold text-slate-700">
                <Percent size={14} className="inline -mt-0.5" />
                {(data.total.avgDiscountPct * 100).toFixed(1)}
              </div>
            </div>
          </div>

          {/* 分档 */}
          <div className="space-y-3">
            {data.tiers.map((t) => {
              const pct = (t.totalSignedValue / maxTierValue) * 100;
              return (
                <div key={t.tier}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="font-medium">{t.label}</span>
                    <div className="flex items-center gap-3 text-muted-foreground">
                      <span>{t.count} 单</span>
                      <span>${t.totalSignedValue.toLocaleString()}</span>
                      <span
                        className={cn(
                          "font-bold",
                          t.avgDiscountPct > 0.15 ? "text-red-600" : "text-emerald-600",
                        )}
                      >
                        {(t.avgDiscountPct * 100).toFixed(1)}%
                      </span>
                    </div>
                  </div>
                  <div className="h-2 rounded-full bg-muted/30 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-orange-400 transition-all"
                      style={{ width: `${Math.max(pct, t.count > 0 ? 4 : 0)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {/* 管理员：按销售 breakdown */}
          {isAdmin && data.salesReps.length > 0 && !salesRepId && (
            <div className="mt-5 pt-4 border-t border-border">
              <h4 className="text-xs font-semibold text-muted-foreground mb-2">
                按销售折扣率（区间内）
              </h4>
              <div className="space-y-1.5">
                {data.salesReps.slice(0, 8).map((r) => (
                  <div key={r.id} className="flex items-center justify-between text-xs">
                    <span className="font-medium">{r.name}</span>
                    <div className="flex items-center gap-3 text-muted-foreground">
                      <span>{r.count} 单</span>
                      <span>${r.totalSignedValue.toLocaleString()}</span>
                      <span className="font-bold text-orange-700">
                        {(r.avgDiscountPct * 100).toFixed(1)}%
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <p className="mt-4 text-[10px] text-muted-foreground">
        折扣率 = Special Promotion ÷ 产品税前价（不含 Part B）；分档按含税成交额。
        {data && (
          <span className="ml-1">
            环比区间：{data.prev.from.slice(0, 10)} ~ {data.prev.to.slice(0, 10)}
          </span>
        )}
      </p>
    </div>
  );
}
