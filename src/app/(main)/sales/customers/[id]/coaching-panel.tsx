"use client";

import { useState, useEffect, useCallback } from "react";
import { Loader2, Brain } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api-fetch";

interface CoachingRecordItem {
  id: string;
  coachingType: string;
  recommendation: string;
  adopted: boolean | null;
  outcome: string | null;
  contributionScore: number | null;
  createdAt: string;
  opportunity?: { title: string; stage: string } | null;
  insight?: { title: string; insightType: string; effectiveness: number } | null;
}

interface CoachingStatsData {
  total: number;
  adopted: number;
  adoptionRate: number;
  wonWithAdoption: number;
  avgContribution: number;
}

const COACHING_TYPE_LABELS: Record<string, string> = {
  tactic: "策略",
  objection_response: "异议应对",
  email_draft: "邮件话术",
  next_action: "下一步",
};

const OUTCOME_LABELS: Record<string, { label: string; color: string }> = {
  won: { label: "成单", color: "text-emerald-600 bg-emerald-50" },
  lost: { label: "丢单", color: "text-red-600 bg-red-50" },
  still_open: { label: "进行中", color: "text-blue-600 bg-blue-50" },
};

export function CoachingPanel({ customerId }: { customerId: string }) {
  const [records, setRecords] = useState<CoachingRecordItem[]>([]);
  const [stats, setStats] = useState<CoachingStatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch(
        `/api/sales/coaching?customerId=${customerId}&stats=true`
      );
      if (res.ok) {
        const data = await res.json();
        setRecords(data.records ?? []);
        setStats(data.stats ?? null);
      }
    } catch (err) {
      console.error("Load coaching failed:", err);
    } finally {
      setLoading(false);
    }
  }, [customerId]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleAdopt = async (recordId: string, adopted: boolean) => {
    setUpdatingId(recordId);
    try {
      await apiFetch(`/api/sales/coaching/${recordId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adopted }),
      });
      loadData();
    } catch {
      // ignore
    } finally {
      setUpdatingId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {stats && stats.total > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-lg border border-border bg-white/70 p-3 text-center">
            <p className="text-lg font-bold text-foreground">{stats.total}</p>
            <p className="text-[10px] text-muted">总建议</p>
          </div>
          <div className="rounded-lg border border-border bg-white/70 p-3 text-center">
            <p className="text-lg font-bold text-accent">
              {(stats.adoptionRate * 100).toFixed(0)}%
            </p>
            <p className="text-[10px] text-muted">采纳率</p>
          </div>
          <div className="rounded-lg border border-border bg-white/70 p-3 text-center">
            <p className="text-lg font-bold text-emerald-600">{stats.wonWithAdoption}</p>
            <p className="text-[10px] text-muted">采纳后成单</p>
          </div>
          <div className="rounded-lg border border-border bg-white/70 p-3 text-center">
            <p className="text-lg font-bold text-foreground">
              {(stats.avgContribution * 100).toFixed(0)}%
            </p>
            <p className="text-[10px] text-muted">平均贡献度</p>
          </div>
        </div>
      )}

      {records.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-white/40 py-12">
          <Brain className="h-8 w-8 text-muted/40" />
          <p className="mt-3 text-sm text-muted">暂无 AI 建议记录</p>
          <p className="mt-1 text-xs text-muted/60">
            当 AI 给出跟进建议时，记录将自动显示在这里
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {records.map((record) => {
            const isUpdating = updatingId === record.id;
            const outcomeInfo = record.outcome ? OUTCOME_LABELS[record.outcome] : null;

            return (
              <div
                key={record.id}
                className="rounded-lg border border-border bg-white/80 p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-medium text-accent">
                        {COACHING_TYPE_LABELS[record.coachingType] || record.coachingType}
                      </span>
                      {record.insight && (
                        <span className="text-[10px] text-muted">
                          基于: {record.insight.title}
                        </span>
                      )}
                      {outcomeInfo && (
                        <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", outcomeInfo.color)}>
                          {outcomeInfo.label}
                        </span>
                      )}
                      {record.contributionScore != null && record.outcome && (
                        <span className="text-[10px] text-muted">
                          贡献度 {(record.contributionScore * 100).toFixed(0)}%
                        </span>
                      )}
                    </div>
                    <p className="mt-1.5 text-sm text-foreground leading-relaxed line-clamp-3">
                      {record.recommendation}
                    </p>
                    <div className="mt-1 flex items-center gap-2 text-[10px] text-muted">
                      <span>{new Date(record.createdAt).toLocaleDateString("zh-CN")}</span>
                      {record.opportunity && (
                        <span>· {record.opportunity.title}</span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    {record.adopted === null ? (
                      <>
                        <button
                          onClick={() => handleAdopt(record.id, true)}
                          disabled={isUpdating}
                          className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-[10px] font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-50 transition-colors"
                        >
                          {isUpdating ? "…" : "采纳"}
                        </button>
                        <button
                          onClick={() => handleAdopt(record.id, false)}
                          disabled={isUpdating}
                          className="rounded-md border border-border bg-white px-2 py-1 text-[10px] font-medium text-muted hover:text-foreground disabled:opacity-50 transition-colors"
                        >
                          忽略
                        </button>
                      </>
                    ) : (
                      <span className={cn(
                        "rounded-full px-2 py-0.5 text-[10px] font-medium",
                        record.adopted ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-500"
                      )}>
                        {record.adopted ? "✓ 已采纳" : "已忽略"}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
