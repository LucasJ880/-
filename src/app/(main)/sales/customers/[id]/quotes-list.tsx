"use client";

import { FileText, Send } from "lucide-react";
import { cn } from "@/lib/utils";
import { Quote } from "./types";

const QUOTE_STATUS_LABEL: Record<string, string> = {
  draft: "草稿",
  sent: "已发送",
  accepted: "已接受",
  rejected: "已拒绝",
};
const QUOTE_STATUS_COLOR: Record<string, string> = {
  draft: "bg-gray-100 text-gray-600",
  sent: "bg-blue-100 text-blue-800",
  accepted: "bg-emerald-100 text-emerald-800",
  rejected: "bg-red-100 text-red-800",
};

export function QuotesList({
  quotes,
  customerEmail,
  onSendEmail,
}: {
  quotes: Quote[];
  customerEmail: string | null;
  onSendEmail: (quoteId: string) => void;
}) {
  if (quotes.length === 0) {
    return (
      <div className="flex flex-col items-center py-12 text-muted">
        <FileText className="h-8 w-8 opacity-30" />
        <p className="mt-2 text-sm">暂无报价记录</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {quotes.map((q) => (
        <div
          key={q.id}
          className="rounded-lg border border-border/50 bg-white/60 px-4 py-3"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-foreground">
                报价 v{q.version}
              </span>
              <span
                className={cn(
                  "rounded-md px-1.5 py-0.5 text-[10px] font-semibold",
                  QUOTE_STATUS_COLOR[q.status] || "bg-gray-100 text-gray-600"
                )}
              >
                {QUOTE_STATUS_LABEL[q.status] || q.status}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {q.status === "draft" && customerEmail && (
                <button
                  onClick={() => onSendEmail(q.id)}
                  className="inline-flex items-center gap-1 rounded-lg border border-accent/30 bg-accent/5 px-2.5 py-1 text-[11px] font-medium text-accent hover:bg-accent/10 transition-colors"
                >
                  <Send className="h-3 w-3" />
                  发送邮件
                </button>
              )}
              <div className="flex flex-col items-end">
                <span className="text-sm font-semibold text-foreground">
                  ${q.grandTotal.toFixed(2)}
                </span>
                {typeof q.finalDiscountPct === "number" && q.finalDiscountPct > 0 && (
                  <span className="text-[10px] text-orange-700 font-medium">
                    折扣 {(q.finalDiscountPct * 100).toFixed(1)}%
                    {typeof q.specialPromotion === "number" && q.specialPromotion > 0
                      ? ` · 让利 $${q.specialPromotion.toFixed(0)}`
                      : ""}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="mt-1.5 flex items-center justify-between">
            <span className="text-xs text-muted">
              {q.items.length} 项产品 ·{" "}
              {new Date(q.createdAt).toLocaleDateString("zh-CN")}
            </span>
            <div className="flex flex-wrap gap-1">
              {q.items.slice(0, 3).map((item) => (
                <span key={item.id} className="rounded bg-foreground/5 px-1.5 py-0.5 text-[10px] text-muted">
                  {item.product} - {item.fabric}
                </span>
              ))}
              {q.items.length > 3 && (
                <span className="text-[10px] text-muted">+{q.items.length - 3}</span>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
