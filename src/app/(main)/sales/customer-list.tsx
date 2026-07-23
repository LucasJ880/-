"use client";

import {
  Users,
  Phone,
  Mail,
  Eye,
  ChevronRight,
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { STAGES, FUNNEL_STATUS_META } from "./types";
import type { Customer } from "./types";

function CustomerCard({
  customer: c,
  showOwnerColumn,
}: {
  customer: Customer;
  showOwnerColumn: boolean;
}) {
  const funnel = c.funnelStatus
    ? FUNNEL_STATUS_META[c.funnelStatus]
    : null;

  return (
    <Link
      href={`/sales/customers/${c.id}`}
      className="block rounded-xl border border-border bg-white/70 p-3 transition-colors active:bg-white"
    >
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="break-words text-sm font-medium text-foreground [overflow-wrap:anywhere]">
            {c.name}
          </p>
          {c.address ? (
            <p className="mt-0.5 line-clamp-2 text-xs text-muted">{c.address}</p>
          ) : null}
        </div>
        <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {funnel ? (
          <Badge variant="outline" className={cn(funnel.color)}>
            {funnel.label}
          </Badge>
        ) : null}
        {(c._count?.quotes ?? 0) > 0 ? (
          <span className="text-[11px] text-muted">{c._count!.quotes} 份报价</span>
        ) : null}
        {showOwnerColumn && c.createdBy ? (
          <span className="text-[11px] text-muted">
            {c.createdBy.name}
          </span>
        ) : null}
      </div>
      <div className="mt-2 flex min-w-0 flex-col gap-0.5 text-xs text-muted">
        {c.phone ? (
          <span className="flex items-center gap-1 break-all">
            <Phone className="h-3 w-3 shrink-0" />
            {c.phone}
          </span>
        ) : null}
        {c.email ? (
          <span className="flex items-center gap-1 break-all">
            <Mail className="h-3 w-3 shrink-0" />
            {c.email}
          </span>
        ) : null}
      </div>
    </Link>
  );
}

export function CustomerList({
  customers,
  showOwnerColumn = false,
}: {
  customers: Customer[];
  /** admin 视角下显示"归属销售"列 */
  showOwnerColumn?: boolean;
}) {
  if (customers.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-white/40 py-16">
        <Users className="h-10 w-10 text-muted/50" />
        <p className="mt-3 text-sm text-muted">暂无客户</p>
      </div>
    );
  }

  return (
    <>
      {/* Mobile：卡片列表（策略 A） */}
      <div className="space-y-2 md:hidden">
        {customers.map((c) => (
          <CustomerCard
            key={c.id}
            customer={c}
            showOwnerColumn={showOwnerColumn}
          />
        ))}
      </div>

      {/* Desktop：表格；仅表格区允许横向滚动 */}
      <div className="hidden max-w-full overflow-x-auto overscroll-x-contain rounded-xl border border-border bg-white/70 md:block">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-border bg-white/50 text-left text-xs text-muted">
              <th className="px-4 py-2.5 font-medium">客户</th>
              <th className="px-4 py-2.5 font-medium">联系方式</th>
              <th className="px-4 py-2.5 font-medium">漏斗</th>
              <th className="px-4 py-2.5 font-medium">机会</th>
              <th className="px-4 py-2.5 font-medium">报价</th>
              {showOwnerColumn && (
                <th className="px-4 py-2.5 font-medium">归属销售</th>
              )}
              <th className="px-4 py-2.5 font-medium">来源</th>
              <th className="px-4 py-2.5 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {customers.map((c) => {
              const funnel = c.funnelStatus
                ? FUNNEL_STATUS_META[c.funnelStatus]
                : null;
              return (
                <tr
                  key={c.id}
                  className="border-b border-border/50 transition-colors hover:bg-white/60"
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/sales/customers/${c.id}`}
                      className="break-words font-medium text-foreground hover:underline [overflow-wrap:anywhere]"
                    >
                      {c.name}
                    </Link>
                    {c.address && (
                      <p className="mt-0.5 max-w-[200px] truncate text-xs text-muted">
                        {c.address}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-0.5 text-xs text-muted">
                      {c.phone && (
                        <span className="flex items-center gap-1">
                          <Phone className="h-3 w-3" />
                          {c.phone}
                        </span>
                      )}
                      {c.email && (
                        <span className="flex items-center gap-1 break-all">
                          <Mail className="h-3 w-3" />
                          {c.email}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {funnel ? (
                      <Badge variant="outline" className={cn(funnel.color)}>
                        {funnel.label}
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted/50">–</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {(c.opportunities ?? []).map((opp) => {
                        const stage = STAGES.find((s) => s.key === opp.stage);
                        return (
                          <Badge
                            key={opp.id}
                            variant="outline"
                            className={cn(
                              stage?.color ||
                                "border-gray-200 bg-gray-100 text-gray-600"
                            )}
                          >
                            {stage?.label || opp.stage}
                          </Badge>
                        );
                      })}
                      {(c.opportunities ?? []).length === 0 && (
                        <span className="text-xs text-muted/50">–</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted">
                    {(c._count?.quotes ?? 0) > 0
                      ? `${c._count!.quotes} 份`
                      : "–"}
                  </td>
                  {showOwnerColumn && (
                    <td className="px-4 py-3">
                      {c.createdBy ? (
                        <div className="flex flex-col gap-0.5">
                          <span className="text-xs font-medium text-foreground">
                            {c.createdBy.name}
                          </span>
                          <span className="max-w-[160px] truncate text-[10px] text-muted">
                            {c.createdBy.email}
                          </span>
                        </div>
                      ) : (
                        <span className="text-xs text-muted/50">–</span>
                      )}
                    </td>
                  )}
                  <td className="px-4 py-3 text-xs text-muted">
                    {c.source || "–"}
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/sales/customers/${c.id}`}
                      className="inline-flex items-center gap-0.5 text-xs text-muted hover:text-foreground"
                    >
                      <Eye className="h-3.5 w-3.5" />
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
