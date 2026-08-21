"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  FileText,
  Plus,
  Loader2,
  ChevronRight,
  DollarSign,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api-fetch";
import { TEMPLATE_LABELS, QUOTE_STATUS_LABELS, type TemplateType, type QuoteStatus } from "@/lib/quote/types";

interface QuoteSummary {
  id: string;
  templateType: string;
  version: number;
  status: string;
  title: string | null;
  currency: string;
  totalAmount: string | null;
  profitMargin: string | null;
  aiGenerated: boolean;
  createdAt: string;
  updatedAt: string;
  _count: { lineItems: number };
}

export function ProjectQuoteSection({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [quotes, setQuotes] = useState<QuoteSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/projects/${projectId}/quotes`);
      if (res.ok) {
        const data = await res.json();
        setQuotes(data.quotes ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  async function createQuote() {
    setCreating(true);
    try {
      const res = await apiFetch(`/api/projects/${projectId}/quotes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (res.ok) {
        const data = await res.json();
        router.push(`/projects/${projectId}/quotes/${data.id}`);
      }
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="rounded-xl border border-border/60 bg-card-bg">
      <div className="flex items-center justify-between border-b border-border/40 px-4 py-3">
        <div className="flex items-center gap-2">
          <DollarSign size={15} className="text-accent" />
          <h2 className="text-sm font-semibold">报价管理</h2>
          {quotes.length > 0 && (
            <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-medium text-accent">
              {quotes.length}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={createQuote}
          disabled={creating}
          className="inline-flex items-center gap-1 rounded-md bg-accent/10 px-2.5 py-1 text-[11px] font-medium text-accent hover:bg-accent/20 disabled:opacity-50"
        >
          {creating ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
          新建报价
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 size={18} className="animate-spin text-accent/30" />
        </div>
      ) : quotes.length === 0 ? (
        <div className="px-4 py-8 text-center">
          <FileText size={24} className="mx-auto text-muted/30" />
          <p className="mt-2 text-sm text-muted">暂无报价单</p>
          <p className="mt-1 text-xs text-muted/60">
            创建报价单，AI 副驾驶会帮你检查和生成建议
          </p>
        </div>
      ) : (
        <div className="divide-y divide-border/30">
          {quotes.map((q) => (
            <button
              key={q.id}
              type="button"
              onClick={() => router.push(`/projects/${projectId}/quotes/${q.id}`)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/5"
            >
              <FileText size={14} className="shrink-0 text-accent/60" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium truncate">
                    {q.title ?? `报价单 v${q.version}`}
                  </span>
                  <span className={cn(
                    "shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-medium",
                    q.status === "draft" ? "bg-muted/10 text-muted" :
                    q.status === "confirmed" ? "bg-[rgba(46,122,86,0.1)] text-[#2e7a56]" :
                    "bg-accent/10 text-accent"
                  )}>
                    {QUOTE_STATUS_LABELS[q.status as QuoteStatus] ?? q.status}
                  </span>
                </div>
                <div className="mt-0.5 flex items-center gap-3 text-[11px] text-muted">
                  <span>{TEMPLATE_LABELS[q.templateType as TemplateType] ?? q.templateType}</span>
                  <span>{q._count.lineItems} 行项目</span>
                  {q.totalAmount && (
                    <span className="font-medium text-foreground">
                      {q.currency} {Number(q.totalAmount).toLocaleString("en-US", { minimumFractionDigits: 2 })}
                    </span>
                  )}
                </div>
              </div>
              <ChevronRight size={14} className="shrink-0 text-muted" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
