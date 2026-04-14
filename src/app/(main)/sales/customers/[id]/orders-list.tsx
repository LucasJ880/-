"use client";

import Link from "next/link";
import { FileText } from "lucide-react";
import { BlindsOrder } from "./types";

export function OrdersList({ orders }: { orders: BlindsOrder[] }) {
  if (orders.length === 0) {
    return (
      <div className="flex flex-col items-center py-12 text-muted">
        <FileText className="h-8 w-8 opacity-30" />
        <p className="mt-2 text-sm">暂无工艺单</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {orders.map((o) => (
        <Link
          key={o.id}
          href={`/blinds-orders/${o.id}`}
          className="flex items-center justify-between rounded-lg border border-border/50 bg-white/60 px-4 py-3 hover:bg-white/80 transition-colors"
        >
          <div>
            <span className="text-sm font-medium text-foreground">
              {o.code}
            </span>
            <span className="ml-2 text-xs text-muted">{o.status}</span>
          </div>
          <span className="text-xs text-muted">
            {new Date(o.createdAt).toLocaleDateString("zh-CN")}
          </span>
        </Link>
      ))}
    </div>
  );
}
