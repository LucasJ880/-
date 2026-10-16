"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Plus, Search, ClipboardList, FileText, CheckCircle, Clock, XCircle, AlertCircle } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { VINYL_STATUS_LABELS } from "@/lib/vinyl/order-state-machine";

interface VinylOrder {
  id: string;
  code: string;
  status: string;
  customerName: string;
  installDate: string | null;
  louverSize: number;
  ruleVersion: string;
  createdAt: string;
  quoteId: string | null;
  _count: { items: number };
}

const STATUS_STYLE: Record<string, { color: string; icon: typeof Clock }> = {
  draft: { color: "bg-[rgba(110,125,118,0.08)] text-[#6e7d76]", icon: FileText },
  confirmed: { color: "bg-accent-soft text-accent", icon: CheckCircle },
  in_production: { color: "bg-[rgba(63,81,181,0.08)] text-[#3f51b5]", icon: Clock },
  ready: { color: "bg-[rgba(154,106,47,0.1)] text-[#9a6a2f]", icon: Clock },
  scheduled: { color: "bg-[rgba(0,131,143,0.1)] text-[#00838f]", icon: Clock },
  installed: { color: "bg-[rgba(46,122,86,0.08)] text-[#2e7a56]", icon: CheckCircle },
  completed: { color: "bg-[rgba(46,122,86,0.12)] text-[#2e7a56]", icon: CheckCircle },
  cancelled: { color: "bg-[rgba(166,61,61,0.08)] text-danger", icon: XCircle },
};

export default function VinylOrdersPage() {
  const [orders, setOrders] = useState<VinylOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set("status", statusFilter);
      const res = await apiFetch(`/api/vinyl/orders?${params}`);
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setOrders(Array.isArray(data) ? data : []);
      setError("");
    } catch (e) {
      // 请求失败绝不能显示成「暂无工艺单」—— 工厂会以为单子不存在
      setOrders([]);
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { void load(); }, [load]);

  const q = search.trim().toLowerCase();
  const filtered = q
    ? orders.filter((o) => o.code.toLowerCase().includes(q) || o.customerName.toLowerCase().includes(q))
    : orders;

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Vinyl 工艺单</h1>
          <p className="mt-1 text-sm text-muted">百叶窗下料尺寸、工艺表 · 型框 / 直柱 / 横档 / 百叶片</p>
        </div>
        <Link href="/vinyl-orders/new"
          className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-[color:var(--on-accent)] shadow-sm transition-colors hover:bg-accent/90">
          <Plus size={16} /> 新建工艺单
        </Link>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input type="text" placeholder="搜索订单号或客户名..." value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-border py-2 pl-9 pr-4 text-sm outline-none transition-colors focus:border-accent focus:ring-1 focus:ring-accent" />
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border border-border px-3 py-2 text-sm outline-none transition-colors focus:border-accent">
          <option value="">全部状态</option>
          {Object.entries(VINYL_STATUS_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-[rgba(166,61,61,0.15)] bg-[rgba(166,61,61,0.04)] px-4 py-3 text-sm text-danger">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <span>
            工艺单列表加载失败：{error}
            <button onClick={() => void load()} className="ml-2 underline">重试</button>
          </span>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20 text-muted">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-accent" />
          <span className="ml-2">加载中...</span>
        </div>
      ) : error ? null : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-border py-20">
          <ClipboardList size={48} className="text-muted/60" />
          <p className="mt-4 text-muted">{search ? "未找到匹配的工艺单" : "暂无 Vinyl 工艺单"}</p>
          {!search && (
            <Link href="/vinyl-orders/new"
              className="mt-4 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-[color:var(--on-accent)] transition-colors hover:bg-accent/90">
              创建第一份工艺单
            </Link>
          )}
        </div>
      ) : (
        <div className="max-w-full overflow-x-auto overscroll-x-contain rounded-xl border border-border bg-card-bg shadow-sm">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-border bg-[rgba(26,36,32,0.02)] text-left text-muted">
                <th className="px-4 py-3 font-medium">订单号</th>
                <th className="px-4 py-3 font-medium">客户</th>
                <th className="px-4 py-3 font-medium">窗户数</th>
                <th className="px-4 py-3 font-medium">百叶</th>
                <th className="px-4 py-3 font-medium">状态</th>
                <th className="px-4 py-3 font-medium">安装日期</th>
                <th className="px-4 py-3 font-medium">来源</th>
                <th className="px-4 py-3 font-medium">创建时间</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((o) => {
                const st = STATUS_STYLE[o.status] ?? STATUS_STYLE.draft;
                return (
                  <tr key={o.id} className="transition-colors hover:bg-[rgba(43,96,85,0.02)]">
                    <td className="px-4 py-3">
                      <Link href={`/vinyl-orders/${o.id}`} className="font-medium text-accent hover:underline">
                        {o.code}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-foreground/80">{o.customerName}</td>
                    <td className="px-4 py-3 text-foreground/80">{o._count.items} 扇</td>
                    <td className="px-4 py-3 font-mono text-foreground/80">{o.louverSize}&quot;</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${st.color}`}>
                        <st.icon size={12} />
                        {VINYL_STATUS_LABELS[o.status as keyof typeof VINYL_STATUS_LABELS] ?? o.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted">{o.installDate || "-"}</td>
                    <td className="px-4 py-3 text-xs text-muted">{o.quoteId ? "报价签约" : "手工录入"}</td>
                    <td className="px-4 py-3 text-muted">
                      {new Date(o.createdAt).toLocaleDateString("zh-CN", { timeZone: "America/Toronto" })}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
