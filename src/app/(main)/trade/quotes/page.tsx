"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, FileText, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { apiFetch } from "@/lib/api-fetch";
import { useCurrentOrgId } from "@/lib/hooks/use-current-org-id";

interface Quote {
  id: string;
  quoteNumber: string;
  companyName: string;
  contactName: string | null;
  country: string | null;
  status: string;
  currency: string;
  incoterm: string;
  totalAmount: number;
  createdAt: string;
  expiresAt: string | null;
  prospect: { companyName: string; stage: string } | null;
}

const STATUS_LABELS: Record<string, string> = {
  draft: "草稿",
  sent: "已发送",
  negotiating: "谈判中",
  accepted: "已接受",
  rejected: "已拒绝",
  expired: "已过期",
};

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-zinc-500/15 text-zinc-400",
  sent: "bg-blue-500/15 text-blue-400",
  negotiating: "bg-amber-500/15 text-amber-400",
  accepted: "bg-emerald-500/15 text-emerald-400",
  rejected: "bg-red-500/15 text-red-400",
  expired: "bg-zinc-500/15 text-zinc-500",
};

export default function TradeQuotesPage() {
  const router = useRouter();
  const { orgId, ambiguous, loading: orgLoading } = useCurrentOrgId();
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");

  const load = useCallback(async () => {
    if (!orgId || ambiguous) {
      setQuotes([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const url = `/api/trade/quotes?orgId=${encodeURIComponent(orgId)}${filter ? `&status=${filter}` : ""}`;
    const res = await apiFetch(url);
    if (res.ok) setQuotes(await res.json());
    else setQuotes([]);
    setLoading(false);
  }, [filter, orgId, ambiguous]);

  useEffect(() => {
    if (orgLoading) return;
    void load();
  }, [load, orgLoading]);

  if (orgLoading || loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }

  if (!orgId || ambiguous) {
    return (
      <div className="space-y-4 py-16 text-center">
        <p className="text-sm text-muted">请先选择当前组织后再查看外贸报价。</p>
        <button
          type="button"
          onClick={() => router.push("/organizations")}
          className="text-sm text-accent underline-offset-2 hover:underline"
        >
          前往组织
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="外贸报价" description="报价单管理 — 创建、发送、跟踪报价" />

      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="rounded-lg border border-border bg-background px-2 py-1 text-xs text-foreground focus:outline-none"
          >
            <option value="">全部状态</option>
            {Object.entries(STATUS_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <span className="text-xs text-muted">{quotes.length} 份报价</span>
        </div>
        <button
          onClick={() => router.push("/trade/quotes/new")}
          className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-blue-500"
        >
          <Plus size={14} />
          新建报价
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted" />
        </div>
      ) : quotes.length === 0 ? (
        <div className="rounded-xl border border-border/60 bg-card-bg px-8 py-16 text-center">
          <FileText className="mx-auto mb-3 h-8 w-8 text-muted" />
          <p className="text-sm text-muted">暂无报价单</p>
        </div>
      ) : (
        <div className="space-y-2">
          {quotes.map((q) => (
            <div
              key={q.id}
              onClick={() => router.push(`/trade/quotes/${q.id}`)}
              className="group flex cursor-pointer items-center gap-3 rounded-xl border border-border/60 bg-card-bg px-4 py-3 transition hover:border-border"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono text-blue-400">{q.quoteNumber}</span>
                  <span className="truncate text-sm font-medium text-foreground">{q.companyName}</span>
                  <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium", STATUS_COLORS[q.status])}>
                    {STATUS_LABELS[q.status] ?? q.status}
                  </span>
                </div>
                <div className="mt-0.5 flex items-center gap-3 text-xs text-muted">
                  {q.country && <span>{q.country}</span>}
                  <span>{q.incoterm} {q.currency}</span>
                  <span>{new Date(q.createdAt).toLocaleDateString("zh-CN")}</span>
                </div>
              </div>
              <span className="text-sm font-semibold text-foreground">
                {q.currency} {q.totalAmount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
              <ChevronRight size={14} className="text-muted opacity-0 transition group-hover:opacity-100" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
