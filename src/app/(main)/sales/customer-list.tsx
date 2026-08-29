"use client";

import { useMemo, useState } from "react";
import {
  Users,
  Phone,
  Mail,
  Eye,
  ChevronRight,
  MessageSquare,
  FileText,
  CalendarPlus,
  MoreHorizontal,
  Bot,
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { formatCAD } from "@/lib/blinds/pricing-engine";
import { relativeTimeLabel } from "@/lib/sales/home";
import {
  quoteStatusLabel,
  sortCustomersForSalesList,
} from "@/lib/sales/customer-list-sort";
import { STAGES } from "./types";
import type { Customer } from "./types";
import { SalesBottomSheet } from "@/components/sales-command-center/sales-bottom-sheet";
import {
  findPotentialDuplicateCustomerIds,
  reviewCrmRecord,
  type CrmReview,
} from "@/lib/digital-employees/crm-review";

function reviewCustomer(customer: Customer, nowMs: number): CrmReview {
  return reviewCrmRecord({
    createdAt: customer.createdAt,
    updatedAt: customer.updatedAt,
    phone: customer.phone,
    email: customer.email,
    address: customer.address,
    stage: customer.primaryStage,
    nextFollowupAt: customer.nextFollowupAt,
    lastContactAt: customer.lastContactAt,
    quoteStatus: customer.latestQuoteStatus,
    quoteViewed: customer.quoteViewed,
  }, nowMs);
}

function DigitalEmployeeBadge({ review, duplicate = false }: { review: CrmReview; duplicate?: boolean }) {
  const tone = duplicate || review.urgency === "critical"
    ? "bg-red-100 text-red-700"
    : review.urgency === "warning"
      ? "bg-amber-100 text-amber-700"
      : "bg-emerald-100 text-emerald-700";
  return (
    <span
      className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold", tone)}
      title={duplicate ? "当前加载的客户中存在相同电话或邮箱，请人工核对" : review.summary}
    >
      <Bot className="h-3 w-3" />
      {duplicate ? "疑似重复" : review.label}
    </span>
  );
}

function stageLabel(stage: string | null | undefined): string {
  if (!stage) return "–";
  return STAGES.find((s) => s.key === stage)?.label ?? stage;
}

function RowActions({
  customer,
  className,
}: {
  customer: Customer;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-1", className)}>
      {customer.phone ? (
        <a
          href={`tel:${customer.phone}`}
          onClick={(e) => e.stopPropagation()}
          className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-[var(--border)] px-2 text-[11px] hover:bg-[var(--muted)]/10"
        >
          <Phone className="h-3 w-3" />
          联系
        </a>
      ) : null}
      <Link
        href={`/sales/customers/${customer.id}?followup=1`}
        onClick={(e) => e.stopPropagation()}
        className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-[var(--border)] px-2 text-[11px] hover:bg-[var(--muted)]/10"
      >
        <MessageSquare className="h-3 w-3" />
        记录跟进
      </Link>
      <Link
        href={`/sales/quote-sheet?customerId=${customer.id}`}
        onClick={(e) => e.stopPropagation()}
        className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-[var(--border)] px-2 text-[11px] hover:bg-[var(--muted)]/10"
      >
        <FileText className="h-3 w-3" />
        新建报价
      </Link>
      <Link
        href={`/sales/calendar?new=1&customerId=${customer.id}`}
        onClick={(e) => e.stopPropagation()}
        className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-[var(--border)] px-2 text-[11px] hover:bg-[var(--muted)]/10"
      >
        <CalendarPlus className="h-3 w-3" />
        新建预约
      </Link>
    </div>
  );
}

function CustomerCard({
  customer: c,
  onOpenActions,
  nowMs,
  duplicate,
  detailSuffix = "",
}: {
  customer: Customer;
  onOpenActions: (c: Customer) => void;
  nowMs: number;
  duplicate: boolean;
  /** 跟进模式下为 "?followup=1"：点卡片直达客户详情并弹出跟进对话框 */
  detailSuffix?: string;
}) {
  const overdue =
    !!c.nextFollowupAt && new Date(c.nextFollowupAt).getTime() <= nowMs;
  const review = reviewCustomer(c, nowMs);
  return (
    <div className="rounded-xl border border-border bg-card-bg/70 p-3">
      <div className="flex min-w-0 items-start justify-between gap-2">
        <Link href={`/sales/customers/${c.id}${detailSuffix}`} className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="break-words text-sm font-medium text-foreground">{c.name}</p>
            <DigitalEmployeeBadge review={review} duplicate={duplicate} />
          </div>
          <p className="mt-0.5 text-xs text-muted">
            {stageLabel(c.primaryStage)}
            {c.estimatedValue != null
              ? ` · ${formatCAD(c.estimatedValue)}`
              : ""}
          </p>
        </Link>
        <button
          type="button"
          onClick={() => onOpenActions(c)}
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-muted"
          aria-label="更多操作"
        >
          <MoreHorizontal className="h-5 w-5" />
        </button>
      </div>
      <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-muted">
        <span>
          报价：
          {quoteStatusLabel(c.latestQuoteStatus, c.quoteViewed)}
        </span>
        <span>联系：{relativeTimeLabel(c.lastContactAt)}</span>
        {c.nextFollowupAt && (
          <span className={overdue ? "text-amber-700" : undefined}>
            下次：{new Date(c.nextFollowupAt).toLocaleDateString("zh-CN")}
          </span>
        )}
      </div>
      <p className="mt-1.5 text-[12px] text-foreground">
        下一步：{review.action === "none" ? c.suggestedAction || review.summary : review.actionLabel}
      </p>
      <Link
        href={`/sales/customers/${c.id}${detailSuffix}`}
        className="mt-2 inline-flex items-center gap-0.5 text-xs text-accent"
      >
        查看详情
        <ChevronRight className="h-3 w-3" />
      </Link>
    </div>
  );
}

export function CustomerList({
  customers,
  showOwnerColumn = false,
  followupMode = false,
}: {
  customers: Customer[];
  showOwnerColumn?: boolean;
  /** 跟进模式（移动端「+」→ 记跟进）：点客户直达详情并弹出跟进对话框 */
  followupMode?: boolean;
}) {
  const [actionCustomer, setActionCustomer] = useState<Customer | null>(null);
  const [nowMs] = useState(() => Date.now());
  const sorted = useMemo(
    () => sortCustomersForSalesList(customers),
    [customers],
  );
  const duplicateIds = useMemo(
    () => findPotentialDuplicateCustomerIds(customers),
    [customers],
  );

  if (sorted.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card-bg/40 py-16">
        <Users className="h-10 w-10 text-muted/50" />
        <p className="mt-3 text-sm text-muted">暂无客户</p>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-2 md:hidden">
        {sorted.map((c) => (
          <CustomerCard
            key={c.id}
            customer={c}
            onOpenActions={setActionCustomer}
            nowMs={nowMs}
            duplicate={duplicateIds.has(c.id)}
            detailSuffix={followupMode ? "?followup=1" : ""}
          />
        ))}
      </div>

      <div className="hidden max-w-full overflow-x-auto overscroll-x-contain rounded-xl border border-border bg-card-bg/70 md:block">
        <table className="w-full min-w-[960px] text-sm">
          <thead>
            <tr className="border-b border-border bg-card-bg/50 text-left text-xs text-muted">
              <th className="px-4 py-2.5 font-medium">客户</th>
              <th className="px-4 py-2.5 font-medium">当前阶段</th>
              <th className="px-4 py-2.5 font-medium">预计金额</th>
              <th className="px-4 py-2.5 font-medium">最后联系</th>
              <th className="px-4 py-2.5 font-medium">下次跟进</th>
              <th className="px-4 py-2.5 font-medium">报价状态</th>
              <th className="px-4 py-2.5 font-medium">下一步动作</th>
              {showOwnerColumn && (
                <th className="px-4 py-2.5 font-medium">归属销售</th>
              )}
              <th className="px-4 py-2.5 font-medium">快捷操作</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((c) => {
              const overdue =
                !!c.nextFollowupAt &&
                new Date(c.nextFollowupAt).getTime() <= nowMs;
              const review = reviewCustomer(c, nowMs);
              return (
                <tr
                  key={c.id}
                  className="group border-b border-border/50 transition-colors hover:bg-card-bg/60"
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/sales/customers/${c.id}${followupMode ? "?followup=1" : ""}`}
                      className="font-medium text-foreground hover:underline"
                    >
                      {c.name}
                    </Link>
                    <div className="mt-1">
                      <DigitalEmployeeBadge review={review} duplicate={duplicateIds.has(c.id)} />
                    </div>
                    {c.address && (
                      <p className="mt-0.5 max-w-[200px] truncate text-xs text-muted">
                        {c.address}
                      </p>
                    )}
                    {(c.phone || c.email) && (
                      <div className="mt-1 flex flex-col gap-0.5 text-[11px] text-muted">
                        {c.phone && (
                          <span className="inline-flex items-center gap-1">
                            <Phone className="h-3 w-3" />
                            {c.phone}
                          </span>
                        )}
                        {c.email && (
                          <span className="inline-flex items-center gap-1">
                            <Mail className="h-3 w-3" />
                            {c.email}
                          </span>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant="outline" className="text-xs">
                      {stageLabel(c.primaryStage)}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-xs tabular-nums">
                    {c.estimatedValue != null
                      ? formatCAD(c.estimatedValue)
                      : "–"}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted">
                    {relativeTimeLabel(c.lastContactAt)}
                  </td>
                  <td
                    className={cn(
                      "px-4 py-3 text-xs",
                      overdue ? "font-medium text-amber-700" : "text-muted",
                    )}
                  >
                    {c.nextFollowupAt
                      ? new Date(c.nextFollowupAt).toLocaleDateString("zh-CN")
                      : "–"}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted">
                    {quoteStatusLabel(c.latestQuoteStatus, c.quoteViewed)}
                  </td>
                  <td className="max-w-[180px] px-4 py-3 text-xs text-foreground">
                    {review.action === "none"
                      ? c.suggestedAction || review.summary
                      : review.actionLabel}
                  </td>
                  {showOwnerColumn && (
                    <td className="px-4 py-3 text-xs text-muted">
                      {c.createdBy?.name || "–"}
                    </td>
                  )}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 opacity-100 md:opacity-0 md:group-hover:opacity-100">
                      <RowActions customer={c} />
                      <Link
                        href={`/sales/customers/${c.id}`}
                        className="inline-flex items-center text-xs text-muted hover:text-foreground"
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </Link>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <SalesBottomSheet
        open={!!actionCustomer}
        onClose={() => setActionCustomer(null)}
        title={actionCustomer?.name || "客户操作"}
      >
        {actionCustomer && (
          <div className="grid grid-cols-1 gap-2">
            <RowActions
              customer={actionCustomer}
              className="flex-col items-stretch [&>a]:justify-center [&>a]:min-h-12"
            />
          </div>
        )}
      </SalesBottomSheet>
    </>
  );
}
