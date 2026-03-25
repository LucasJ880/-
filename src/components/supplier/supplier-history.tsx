"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Loader2, ExternalLink, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api-fetch";

interface HistoryItem {
  projectId: string;
  projectName: string;
  roundNumber: number;
  inquiryStatus: string;
  itemStatus: string;
  totalPrice: string | null;
  currency: string;
  isSelected: boolean;
  createdAt: string;
}

const ITEM_STATUS_MAP: Record<string, { label: string; cls: string }> = {
  pending: { label: "待处理", cls: "text-muted" },
  sent: { label: "已发送", cls: "text-[#6e7d76]" },
  replied: { label: "已回复", cls: "text-[#4f7c78]" },
  quoted: { label: "已报价", cls: "text-[#2e7a56]" },
  declined: { label: "已谢绝", cls: "text-[#a63d3d]" },
  no_response: { label: "未回应", cls: "text-[#9a6a2f]" },
};

function formatPrice(price: string | null, currency: string) {
  if (!price) return "—";
  const num = parseFloat(price);
  if (isNaN(num)) return "—";
  return `${currency} ${num.toLocaleString("zh-CN", { minimumFractionDigits: 2 })}`;
}

export function SupplierHistory({ supplierId }: { supplierId: string }) {
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    setLoading(true);
    setError("");
    apiFetch(`/api/suppliers/${supplierId}/history`)
      .then((r) => {
        if (!r.ok) throw new Error("加载失败");
        return r.json();
      })
      .then((data) => setHistory(Array.isArray(data) ? data : []))
      .catch(() => setError("加载项目履历失败"))
      .finally(() => setLoading(false));
  }, [supplierId]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-4 py-3 text-sm text-muted">
        <Loader2 size={14} className="animate-spin" />
        加载项目履历...
      </div>
    );
  }

  if (error) {
    return <div className="px-4 py-3 text-sm text-[#a63d3d]">{error}</div>;
  }

  if (history.length === 0) {
    return (
      <div className="px-4 py-3 text-sm text-muted">
        暂无项目参与记录
      </div>
    );
  }

  return (
    <div className="overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted">
            <th className="px-4 py-2 font-medium">项目</th>
            <th className="px-3 py-2 font-medium">轮次</th>
            <th className="px-3 py-2 font-medium">状态</th>
            <th className="px-3 py-2 font-medium text-right">报价</th>
            <th className="px-3 py-2 font-medium text-center">选定</th>
          </tr>
        </thead>
        <tbody>
          {history.map((item, i) => {
            const statusInfo = ITEM_STATUS_MAP[item.itemStatus] || { label: item.itemStatus, cls: "text-muted" };
            return (
              <tr key={i} className="border-b border-border/50 last:border-0 hover:bg-background/50">
                <td className="px-4 py-2.5">
                  <Link
                    href={`/projects/${item.projectId}`}
                    className="inline-flex items-center gap-1 text-sm font-medium text-foreground hover:text-accent"
                  >
                    {item.projectName}
                    <ExternalLink size={11} className="text-muted" />
                  </Link>
                </td>
                <td className="px-3 py-2.5 text-muted">
                  第{item.roundNumber}轮
                </td>
                <td className="px-3 py-2.5">
                  <span className={cn("text-xs font-medium", statusInfo.cls)}>
                    {statusInfo.label}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">
                  {formatPrice(item.totalPrice, item.currency)}
                </td>
                <td className="px-3 py-2.5 text-center">
                  {item.isSelected && (
                    <Star size={14} className="inline text-[#b5892f]" fill="#b5892f" />
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
