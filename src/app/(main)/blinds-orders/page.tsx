"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  Plus,
  Search,
  ClipboardList,
  FileText,
  CheckCircle,
  Clock,
} from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";

interface BlindsOrder {
  id: string;
  code: string;
  status: string;
  customerName: string;
  phone: string | null;
  address: string | null;
  installDate: string | null;
  ruleVersion: string;
  createdAt: string;
  _count: { items: number };
  project: { id: string; name: string; color: string } | null;
}

const STATUS_MAP: Record<string, { label: string; color: string; icon: typeof Clock }> = {
  draft: { label: "草稿", color: "bg-[rgba(110,125,118,0.08)] text-[#6e7d76]", icon: FileText },
  confirmed: { label: "已确认", color: "bg-[rgba(43,96,85,0.08)] text-[#2b6055]", icon: CheckCircle },
  completed: { label: "已完成", color: "bg-[rgba(46,122,86,0.08)] text-[#2e7a56]", icon: CheckCircle },
};

export default function BlindsOrdersPage() {
  const [orders, setOrders] = useState<BlindsOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("");

  const loadOrders = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (statusFilter) params.set("status", statusFilter);
    const res = await apiFetch(`/api/blinds-orders?${params}`);
    if (res.ok) {
      setOrders(await res.json());
    }
    setLoading(false);
  }, [statusFilter]);

  useEffect(() => {
    void loadOrders();
  }, [loadOrders]);

  const filtered = search
    ? orders.filter(
        (o) =>
          o.code.toLowerCase().includes(search.toLowerCase()) ||
          o.customerName.toLowerCase().includes(search.toLowerCase())
      )
    : orders;

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">工艺单管理</h1>
          <p className="mt-1 text-sm text-muted">
            Blinds 工艺单 · 创建、计算、管理订单
          </p>
        </div>
        <Link
          href="/blinds-orders/new"
          className="flex items-center gap-2 rounded-lg bg-[#2b6055] px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-[#2b6055]/90"
        >
          <Plus size={16} />
          新建工艺单
        </Link>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted"
          />
          <input
            type="text"
            placeholder="搜索订单号或客户名..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-border py-2 pl-9 pr-4 text-sm outline-none transition-colors focus:border-[#2b6055] focus:ring-1 focus:ring-[#2b6055]"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border border-border px-3 py-2 text-sm outline-none transition-colors focus:border-[#2b6055]"
        >
          <option value="">全部状态</option>
          <option value="draft">草稿</option>
          <option value="confirmed">已确认</option>
          <option value="completed">已完成</option>
        </select>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-muted">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-[#2b6055]" />
          <span className="ml-2">加载中...</span>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-border py-20">
          <ClipboardList size={48} className="text-muted/60" />
          <p className="mt-4 text-muted">
            {search ? "未找到匹配的工艺单" : "暂无工艺单"}
          </p>
          {!search && (
            <Link
              href="/blinds-orders/new"
              className="mt-4 rounded-lg bg-[#2b6055] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#2b6055]/90"
            >
              创建第一份工艺单
            </Link>
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-[rgba(26,36,32,0.02)] text-left text-muted">
                <th className="px-4 py-3 font-medium">订单号</th>
                <th className="px-4 py-3 font-medium">客户</th>
                <th className="px-4 py-3 font-medium">窗户数</th>
                <th className="px-4 py-3 font-medium">状态</th>
                <th className="px-4 py-3 font-medium">安装日期</th>
                <th className="px-4 py-3 font-medium">规则版本</th>
                <th className="px-4 py-3 font-medium">创建时间</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((order) => {
                const st = STATUS_MAP[order.status] || STATUS_MAP.draft;
                return (
                  <tr
                    key={order.id}
                    className="cursor-pointer transition-colors hover:bg-[rgba(43,96,85,0.02)]"
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={`/blinds-orders/${order.id}`}
                        className="font-medium text-[#2b6055] hover:underline"
                      >
                        {order.code}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-foreground/80">
                      {order.customerName}
                    </td>
                    <td className="px-4 py-3 text-foreground/80">
                      {order._count.items} 扇
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${st.color}`}
                      >
                        <st.icon size={12} />
                        {st.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted">
                      {order.installDate || "-"}
                    </td>
                    <td className="px-4 py-3">
                      <span className="rounded bg-[rgba(26,36,32,0.04)] px-1.5 py-0.5 font-mono text-[11px] text-muted">
                        {order.ruleVersion}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted">
                      {new Date(order.createdAt).toLocaleDateString("zh-CN", {
                        timeZone: "America/Toronto",
                      })}
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
