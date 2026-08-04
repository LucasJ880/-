"use client";

import Link from "next/link";
import {
  AlertTriangle,
  Bot,
  CalendarPlus,
  CheckCircle2,
  FileText,
  MessageSquare,
  Phone,
  UserRoundPen,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { reviewCrmRecord } from "@/lib/digital-employees/crm-review";
import type { CustomerDetail } from "./types";

export function CustomerDigitalEmployeePanel({
  customer,
  onRecordFollowup,
  onCreateQuote,
  onEditProfile,
}: {
  customer: CustomerDetail;
  onRecordFollowup: () => void;
  onCreateQuote: () => void;
  onEditProfile: () => void;
}) {
  const activeOpportunity = customer.opportunities.find(
    (opportunity) => !["completed", "lost"].includes(opportunity.stage),
  ) ?? customer.opportunities[0];
  const latestQuote = customer.quotes[0];
  const lastContact = customer.interactions[0]?.createdAt ?? null;
  const review = reviewCrmRecord({
    createdAt: customer.createdAt,
    updatedAt: activeOpportunity?.updatedAt ?? customer.createdAt,
    phone: customer.phone,
    email: customer.email,
    address: customer.address,
    stage: activeOpportunity?.stage ?? "new_lead",
    nextFollowupAt: activeOpportunity?.nextFollowupAt,
    lastContactAt: lastContact,
    quoteStatus: latestQuote?.status,
    quoteViewedAt: latestQuote?.viewedAt,
  });

  const tone = review.urgency === "critical"
    ? "border-red-200 bg-red-50/60 dark:border-red-900/50 dark:bg-red-950/20"
    : review.urgency === "warning"
      ? "border-amber-200 bg-amber-50/50 dark:border-amber-900/50 dark:bg-amber-950/20"
      : "border-emerald-200 bg-emerald-50/50 dark:border-emerald-900/50 dark:bg-emerald-950/20";
  const badgeTone = review.urgency === "critical"
    ? "bg-red-100 text-red-700"
    : review.urgency === "warning"
      ? "bg-amber-100 text-amber-700"
      : "bg-emerald-100 text-emerald-700";

  const icon = review.action === "complete_profile"
    ? <UserRoundPen className="h-4 w-4" />
    : review.action === "contact"
      ? <Phone className="h-4 w-4" />
      : review.action === "create_quote"
        ? <FileText className="h-4 w-4" />
        : review.action === "book_measurement"
          ? <CalendarPlus className="h-4 w-4" />
          : <MessageSquare className="h-4 w-4" />;

  const actionClass = "inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg bg-foreground px-3 text-xs font-medium text-white hover:bg-foreground/90";
  const action = review.action === "complete_profile" ? (
    <button type="button" onClick={onEditProfile} className={actionClass}>{icon}{review.actionLabel}</button>
  ) : review.action === "contact" && customer.phone ? (
    <a href={`tel:${customer.phone}`} className={actionClass}>{icon}{review.actionLabel}</a>
  ) : review.action === "contact" && customer.email ? (
    <a href={`mailto:${customer.email}`} className={actionClass}>{icon}{review.actionLabel}</a>
  ) : review.action === "book_measurement" ? (
    <Link href={`/sales/calendar?new=1&customerId=${customer.id}`} className={actionClass}>{icon}{review.actionLabel}</Link>
  ) : review.action === "create_quote" ? (
    <button type="button" onClick={onCreateQuote} className={actionClass}>{icon}{review.actionLabel}</button>
  ) : review.action === "record_followup" ? (
    <button type="button" onClick={onRecordFollowup} className={actionClass}>{icon}{review.actionLabel}</button>
  ) : null;

  return (
    <section className={cn("rounded-xl border p-4", tone)} aria-label="客户数字员工建议">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-foreground">
              <Bot className="h-4 w-4 text-accent" />
              客户数字员工
            </span>
            <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", badgeTone)}>
              {review.label}
            </span>
          </div>
          <p className="mt-1.5 text-sm text-foreground">{review.summary}</p>
          {review.reasons.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
              {review.reasons.slice(0, 3).map((reason) => (
                <span key={reason} className="inline-flex items-center gap-1">
                  {review.urgency === "ready" ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                  {reason}
                </span>
              ))}
            </div>
          )}
          <p className="mt-2 text-[10px] text-muted">只提供判断与草稿；发邮件、改商机状态仍由销售确认。</p>
        </div>
        {action}
      </div>
    </section>
  );
}
