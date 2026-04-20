"use client";

import {
  Users,
  Phone,
  Mail,
  Eye,
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { STAGES, FUNNEL_STATUS_META } from "./types";
import type { Customer } from "./types";

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
    <div className="overflow-x-auto rounded-xl border border-border bg-white/70">
      <table className="w-full text-sm">
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
                className="border-b border-border/50 hover:bg-white/60 transition-colors"
              >
                <td className="px-4 py-3">
                  <Link
                    href={`/sales/customers/${c.id}`}
                    className="font-medium text-foreground hover:underline"
                  >
                    {c.name}
                  </Link>
                  {c.address && (
                    <p className="mt-0.5 text-xs text-muted truncate max-w-[200px]">
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
                      <span className="flex items-center gap-1">
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
                            stage?.color || "bg-gray-100 text-gray-600 border-gray-200"
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
                  {(c._count?.quotes ?? 0) > 0 ? `${c._count!.quotes} 份` : "–"}
                </td>
                {showOwnerColumn && (
                  <td className="px-4 py-3">
                    {c.createdBy ? (
                      <div className="flex flex-col gap-0.5">
                        <span className="text-xs font-medium text-foreground">
                          {c.createdBy.name}
                        </span>
                        <span className="text-[10px] text-muted truncate max-w-[160px]">
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
  );
}
