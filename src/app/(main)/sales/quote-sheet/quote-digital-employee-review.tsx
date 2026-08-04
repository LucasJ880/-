"use client";

import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  CircleAlert,
  Info,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  QuoteReviewItem,
  QuoteWorkflowReview,
} from "@/lib/digital-employees/quote-review";

interface QuoteDigitalEmployeeReviewProps {
  review: QuoteWorkflowReview;
  onOpenCustomer: () => void;
  onOpenProducts: () => void;
  onOpenPartB: () => void;
}

const STATUS_META = {
  ready: { icon: CheckCircle2, className: "text-emerald-700", bg: "bg-emerald-50" },
  info: { icon: Info, className: "text-blue-700", bg: "bg-blue-50" },
  attention: { icon: AlertTriangle, className: "text-amber-700", bg: "bg-amber-50" },
  blocked: { icon: CircleAlert, className: "text-red-700", bg: "bg-red-50" },
} as const;

function ReviewAction({
  item,
  onOpenCustomer,
  onOpenProducts,
  onOpenPartB,
}: {
  item: QuoteReviewItem;
  onOpenCustomer: () => void;
  onOpenProducts: () => void;
  onOpenPartB: () => void;
}) {
  if (!item.action) return null;
  if (item.action === "email_settings") {
    return (
      <Link href="/settings" className="inline-flex items-center gap-1 text-[11px] font-medium text-accent hover:underline">
        绑定邮箱 <ArrowRight size={11} />
      </Link>
    );
  }
  const handler =
    item.action === "customer"
      ? onOpenCustomer
      : item.action === "products"
        ? onOpenProducts
        : onOpenPartB;
  const label =
    item.action === "customer"
      ? "检查客户资料"
      : item.action === "products"
        ? "填写产品"
        : "打开 Part B";
  return (
    <button type="button" onClick={handler} className="inline-flex items-center gap-1 text-[11px] font-medium text-accent hover:underline">
      {label} <ArrowRight size={11} />
    </button>
  );
}

export function QuoteDigitalEmployeeReview({
  review,
  onOpenCustomer,
  onOpenProducts,
  onOpenPartB,
}: QuoteDigitalEmployeeReviewProps) {
  return (
    <section className="overflow-hidden rounded-xl border border-violet-200 bg-card-bg shadow-xs">
      <div className="flex flex-col gap-3 border-b border-violet-100 bg-violet-50/60 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-violet-700">
            <Sparkles size={17} />
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold text-foreground">报价数字员工 · 实时检查</h2>
              {review.blockedCount > 0 && (
                <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-700">
                  {review.blockedCount} 项阻止保存
                </span>
              )}
              {review.attentionCount > 0 && (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                  {review.attentionCount} 项发送前确认
                </span>
              )}
            </div>
            <p className="mt-0.5 text-xs text-muted">{review.nextAction}</p>
          </div>
        </div>
        <div className="text-xs text-muted">
          已通过 <span className="font-semibold text-emerald-700">{review.readyCount}</span> 项
        </div>
      </div>

      <div className="grid gap-px bg-border/60 sm:grid-cols-2 lg:grid-cols-4">
        {review.items.map((item) => {
          const meta = STATUS_META[item.status];
          const Icon = meta.icon;
          return (
            <div key={item.key} className="bg-card-bg p-3">
              <div className="flex items-start gap-2">
                <span className={cn("mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md", meta.bg, meta.className)}>
                  <Icon size={13} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold text-foreground">{item.title}</div>
                  <p className="mt-0.5 text-[11px] leading-4 text-muted">{item.detail}</p>
                  <div className="mt-1.5">
                    <ReviewAction
                      item={item}
                      onOpenCustomer={onOpenCustomer}
                      onOpenProducts={onOpenProducts}
                      onOpenPartB={onOpenPartB}
                    />
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
