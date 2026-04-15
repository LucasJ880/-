"use client";

import { useEffect, useState } from "react";
import {
  Plus,
  DollarSign,
  TrendingUp,
  Clock,
  Sparkles,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api-fetch";
import { STAGES, PRIORITIES } from "./types";
import type { Opportunity, HealthInfo } from "./types";
import { NewOpportunityDialog } from "./new-opportunity-dialog";

function healthColor(score: number): string {
  if (score >= 70) return "text-emerald-500";
  if (score >= 40) return "text-amber-500";
  return "text-red-500";
}

function healthBg(score: number): string {
  if (score >= 70) return "bg-emerald-500";
  if (score >= 40) return "bg-amber-500";
  return "bg-red-500";
}

function OpportunityCard({
  opp,
  health,
  isDragging,
  onDragStart,
  onDragEnd,
}: {
  opp: Opportunity;
  health?: HealthInfo;
  isDragging: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
}) {
  const pri = PRIORITIES[opp.priority as keyof typeof PRIORITIES] || PRIORITIES.warm;
  const [showTip, setShowTip] = useState(false);
  const [now] = useState(() => Date.now());

  return (
    <Link
      href={`/sales/customers/${opp.customer?.id}`}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={cn(
        "group cursor-grab rounded-[var(--radius-lg)] border border-border bg-card-bg/80 p-3 transition-all duration-150 hover:shadow-card hover:border-border-strong active:cursor-grabbing",
        isDragging && "opacity-40 ring-2 ring-accent/25"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <h4 className="text-sm font-medium text-foreground line-clamp-2">
          {opp.title}
        </h4>
        <div className="flex items-center gap-1 shrink-0">
          {health && health.score > 0 && (
            <span className={cn("text-[10px] font-bold", healthColor(health.score))}>
              {health.score}
            </span>
          )}
          <span
            className={cn(
              "rounded px-1.5 py-0.5 text-[10px] font-bold",
              pri.class
            )}
          >
            {pri.label}
          </span>
        </div>
      </div>
      {opp.customer && (
        <p className="mt-1 text-xs text-muted">{opp.customer.name}</p>
      )}

      {health && health.score > 0 && (
        <div className="mt-1.5 flex items-center gap-1.5">
          <div className="h-1.5 flex-1 rounded-full bg-muted/20 overflow-hidden">
            <div
              className={cn("h-full rounded-full transition-all", healthBg(health.score))}
              style={{ width: `${health.score}%` }}
            />
          </div>
          {health.tip && (
            <button
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShowTip(!showTip); }}
              className="shrink-0 rounded-full p-0.5 hover:bg-accent/10 transition-colors"
              title="AI 建议"
            >
              <Zap className="h-3 w-3 text-accent" />
            </button>
          )}
        </div>
      )}

      {showTip && health?.tip && (
        <div className="mt-1.5 rounded-md bg-accent/5 border border-accent/20 px-2 py-1.5">
          <p className="text-[10px] text-accent leading-relaxed line-clamp-3">
            <Sparkles className="inline h-2.5 w-2.5 mr-0.5" />
            {health.tip}
          </p>
        </div>
      )}

      <div className="mt-2 flex items-center gap-3 text-xs text-muted">
        {(opp.latestQuoteTotal ?? opp.estimatedValue) != null && (
          <span className="flex items-center gap-0.5">
            <DollarSign className="h-3 w-3" />
            {(opp.latestQuoteTotal ?? opp.estimatedValue ?? 0).toLocaleString()}
          </span>
        )}
        {opp.productTypes && (
          <span className="truncate">{opp.productTypes}</span>
        )}
      </div>
      <div className="mt-1.5 flex items-center gap-2 flex-wrap">
        {opp.latestQuoteTotal != null && (
          <span className="inline-flex items-center rounded-full bg-orange-50 px-1.5 py-0.5 text-[10px] font-medium text-orange-700">
            报价 ${opp.latestQuoteTotal.toLocaleString()}
          </span>
        )}
        {opp.nextFollowupAt && (
          <span className="inline-flex items-center gap-0.5 text-[11px] text-amber-600">
            <Clock className="h-3 w-3" />
            {new Date(opp.nextFollowupAt).toLocaleDateString("zh-CN")}
          </span>
        )}
        {opp.updatedAt && (
          <span className="text-[10px] text-muted/60">
            {Math.floor((now - new Date(opp.updatedAt).getTime()) / 86400000)}天
          </span>
        )}
      </div>
    </Link>
  );
}

export function PipelineBoard({
  opportunities,
  onRefresh,
}: {
  opportunities: Opportunity[];
  onRefresh: () => void;
}) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [showNewOpp, setShowNewOpp] = useState(false);
  const [healthMap, setHealthMap] = useState<Record<string, HealthInfo>>({});

  useEffect(() => {
    if (opportunities.length === 0) return;
    apiFetch("/api/sales/opportunities/health-batch")
      .then((r) => {
        if (!r.ok) throw new Error(`health-batch ${r.status}`);
        return r.json();
      })
      .then((d) => {
        if (d?.healthMap && typeof d.healthMap === "object") {
          setHealthMap(d.healthMap);
        }
      })
      .catch((err) => {
        console.warn("[PipelineBoard] health-batch failed:", err);
      });
  }, [opportunities]);

  const grouped = STAGES.map((stage) => ({
    ...stage,
    items: opportunities.filter((o) => o.stage === stage.key),
  }));

  const handleDragStart = (e: React.DragEvent, oppId: string) => {
    setDraggingId(oppId);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", oppId);
  };

  const handleDragOver = (e: React.DragEvent, stageKey: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDropTarget(stageKey);
  };

  const handleDragLeave = () => {
    setDropTarget(null);
  };

  const handleDrop = async (e: React.DragEvent, newStage: string) => {
    e.preventDefault();
    setDropTarget(null);
    const oppId = e.dataTransfer.getData("text/plain");
    setDraggingId(null);
    if (!oppId) return;

    const opp = opportunities.find((o) => o.id === oppId);
    if (!opp || opp.stage === newStage) return;

    try {
      await apiFetch(`/api/sales/opportunities/${oppId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage: newStage }),
      });
      onRefresh();
    } catch (err) {
      console.error("Stage update failed:", err);
    }
  };

  return (
    <>
      {opportunities.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-[var(--radius-xl)] border border-dashed border-border bg-card-bg/40 py-16">
          <TrendingUp className="h-10 w-10 text-muted/40" />
          <p className="mt-3 text-[14px] font-medium text-muted">暂无销售机会</p>
          <p className="mt-1 text-[13px] text-muted/60">
            通过 CSV 导入客户数据，或手动创建新客户
          </p>
          <button
            onClick={() => setShowNewOpp(true)}
            className="mt-4 inline-flex items-center gap-1.5 rounded-[var(--radius-md)] bg-foreground px-3.5 py-2 text-[13px] font-medium text-white shadow-xs hover:bg-foreground/90 active:scale-[0.98] transition-all duration-150"
          >
            <Plus className="h-3.5 w-3.5" />
            新建机会
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex justify-end">
            <button
              onClick={() => setShowNewOpp(true)}
              className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border border-border bg-white/80 px-3 py-1.5 text-[12px] font-medium text-foreground shadow-xs hover:bg-white hover:border-border-strong transition-all duration-150"
            >
              <Plus className="h-3 w-3" />
              新建机会
            </button>
          </div>
          <div className="flex gap-3 overflow-x-auto pb-4">
            {grouped.map((col) => (
              <div
                key={col.key}
                className="flex w-64 shrink-0 flex-col"
                onDragOver={(e) => handleDragOver(e, col.key)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, col.key)}
              >
                <div
                  className={cn(
                    "mb-2 flex items-center justify-between rounded-[var(--radius-md)] border px-3 py-1.5",
                    col.color
                  )}
                >
                  <span className="text-[12px] font-semibold tracking-[-0.01em]">{col.label}</span>
                  <span className="rounded-full bg-black/8 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums">
                    {col.items.length}
                  </span>
                </div>
                <div
                  className={cn(
                    "flex min-h-[80px] flex-col gap-2 rounded-lg border-2 border-transparent p-1 transition-colors",
                    dropTarget === col.key && "border-dashed border-accent/40 bg-accent/5"
                  )}
                >
                  {col.items.map((opp) => (
                    <OpportunityCard
                      key={opp.id}
                      opp={opp}
                      health={healthMap[opp.id]}
                      isDragging={draggingId === opp.id}
                      onDragStart={(e) => handleDragStart(e, opp.id)}
                      onDragEnd={() => setDraggingId(null)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <NewOpportunityDialog
        open={showNewOpp}
        onOpenChange={setShowNewOpp}
        onSuccess={() => {
          setShowNewOpp(false);
          onRefresh();
        }}
      />
    </>
  );
}
