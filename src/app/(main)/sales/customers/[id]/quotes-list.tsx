"use client";

import Link from "next/link";
import { FileText, Send, AlertTriangle, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import { Quote } from "./types";
import { useCurrentUser } from "@/lib/hooks/use-current-user";

// 销售可直接编辑的状态；signed/accepted 状态销售锁定，admin 可覆盖
const SALES_EDITABLE_STATUSES = new Set(["draft", "sent", "viewed", "rejected"]);

const QUOTE_STATUS_LABEL: Record<string, string> = {
  draft: "草稿",
  sent: "已发送",
  signed: "已成单",
  // 历史 accepted（早期公开签字通道）语义等同于 signed
  accepted: "已成单",
  rejected: "已拒绝",
};
const QUOTE_STATUS_COLOR: Record<string, string> = {
  draft: "bg-gray-100 text-gray-600",
  sent: "bg-blue-100 text-blue-800",
  signed: "bg-emerald-100 text-emerald-800",
  accepted: "bg-emerald-100 text-emerald-800",
  rejected: "bg-red-100 text-red-800",
};

/** 粗粒度判断：notes 里带 Pricing Warnings ⇒ 说明有待补全的定价 */
function hasPricingWarnings(notes: string | null | undefined): boolean {
  return !!notes && notes.includes("[Pricing Warnings");
}

export function QuotesList({
  quotes,
  customerEmail,
  onSendEmail,
}: {
  quotes: Quote[];
  customerEmail: string | null;
  onSendEmail: (quoteId: string) => void;
}) {
  const { isSuperAdmin } = useCurrentUser();
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
      {quotes.map((q) => {
        const warn = hasPricingWarnings(q.notes) || q.items.length === 0;
        return (
        <div
          key={q.id}
          className={cn(
            "rounded-lg border px-4 py-3",
            warn
              ? "border-amber-300 bg-amber-50/60"
              : "border-border/50 bg-white/60",
          )}
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
              {warn && (
                <span className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
                  <AlertTriangle className="h-3 w-3" />
                  待补定价
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {(SALES_EDITABLE_STATUSES.has(q.status) || isSuperAdmin) && (
                <Link
                  href={`/sales/quote-sheet?quoteId=${q.id}`}
                  className="inline-flex items-center gap-1 rounded-lg border border-teal-300 bg-teal-50/60 px-2.5 py-1 text-[11px] font-medium text-teal-700 hover:bg-teal-100 transition-colors"
                  title={
                    SALES_EDITABLE_STATUSES.has(q.status)
                      ? "编辑此报价单"
                      : "管理员强制编辑（已签单/已接受）"
                  }
                >
                  <Pencil className="h-3 w-3" />
                  编辑
                </Link>
              )}
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
                    让利率 {(q.finalDiscountPct * 100).toFixed(1)}%
                    {typeof q.specialPromotion === "number" && q.specialPromotion > 0
                      ? ` · $${q.specialPromotion.toFixed(0)}`
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
          {warn && q.notes && (
            <details className="mt-2 rounded border border-amber-200 bg-white/60 px-2 py-1">
              <summary className="cursor-pointer text-[11px] font-medium text-amber-800">
                查看定价警告（需管理员补全）
              </summary>
              <pre className="mt-1 whitespace-pre-wrap break-all text-[10px] text-amber-900">
                {q.notes.split("[Pricing Warnings").slice(1).map((s) => `[Pricing Warnings${s}`).join("")}
              </pre>
            </details>
          )}
        </div>
        );
      })}
    </div>
  );
}
