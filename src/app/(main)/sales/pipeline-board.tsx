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
import { STAGES } from "./types";
import type { Opportunity, HealthInfo } from "./types";
import { NewOpportunityDialog } from "./new-opportunity-dialog";
import { useSalesCurrentOrgId } from "@/lib/hooks/use-sales-current-org-id";
import {
  isSalesOrgCreateBlocked,
  salesOrgCreateBlockedHint,
} from "@/lib/sales/sales-client-org";

function stayTone(days: number): string {
  // 严重超时浅红；过久浅橙；正常无底色
  if (days >= 14) return "border-red-200/80 bg-red-50/50 dark:border-red-900/40 dark:bg-red-950/20";
  if (days >= 7) return "border-amber-200/80 bg-amber-50/40 dark:border-amber-900/40 dark:bg-amber-950/20";
  return "border-border bg-card-bg/80";
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
  const [showTip, setShowTip] = useState(false);
  const [now] = useState(() => Date.now());
  const stayDays = opp.updatedAt
    ? Math.max(
        0,
        Math.floor((now - new Date(opp.updatedAt).getTime()) / 86400000),
      )
    : 0;
  const amount = opp.latestQuoteTotal ?? opp.estimatedValue;
  const lastInteract = opp.lastInteractionAt || opp.updatedAt;
  const stageLabel =
    STAGES.find((s) => s.key === opp.stage)?.label ?? opp.stage;

  return (
    <Link
      href={`/sales/customers/${opp.customer?.id}`}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={cn(
        "group cursor-grab rounded-[var(--radius-lg)] border p-3 transition-all duration-150 hover:shadow-card hover:border-border-strong active:cursor-grabbing",
        stayTone(stayDays),
        isDragging && "opacity-40 ring-2 ring-accent/25",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground line-clamp-1">
            {opp.customer?.name || opp.title}
          </p>
          {opp.customer?.name && opp.title !== opp.customer.name && (
            <p className="mt-0.5 line-clamp-1 text-[11px] text-muted">
              {opp.title}
            </p>
          )}
          <p className="mt-0.5 text-[11px] text-muted">{stageLabel}</p>
        </div>
        {health?.tip && (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setShowTip(!showTip);
            }}
            className="shrink-0 rounded-full p-0.5 hover:bg-accent/10"
            title="推进建议"
          >
            <Zap className="h-3 w-3 text-accent" />
          </button>
        )}
      </div>

      {showTip && health?.tip && (
        <div className="mt-1.5 rounded-md border border-accent/20 bg-accent/5 px-2 py-1.5">
          <p className="line-clamp-3 text-[10px] leading-relaxed text-accent">
            <Sparkles className="mr-0.5 inline h-2.5 w-2.5" />
            {health.tip}
          </p>
        </div>
      )}

      <div className="mt-2 flex items-center gap-2 text-xs text-muted">
        {amount != null && (
          <span className="flex items-center gap-0.5 font-medium text-foreground">
            <DollarSign className="h-3 w-3" />
            {amount.toLocaleString("en-CA", {
              style: "currency",
              currency: "CAD",
              maximumFractionDigits: 0,
            })}
          </span>
        )}
        <span
          className={cn(
            "inline-flex items-center gap-0.5 text-[11px]",
            stayDays >= 14
              ? "text-red-700"
              : stayDays >= 7
                ? "text-amber-700"
                : "text-muted",
          )}
        >
          <Clock className="h-3 w-3" />
          停留 {stayDays} 天
        </span>
      </div>

      <div className="mt-1.5 space-y-0.5 text-[11px] text-muted">
        <p>
          最近互动：
          {lastInteract
            ? new Intl.RelativeTimeFormat("zh-CN", { numeric: "auto" }).format(
                -Math.max(
                  0,
                  Math.floor(
                    (now - new Date(lastInteract).getTime()) / 86400000,
                  ),
                ),
                "day",
              )
            : "暂无"}
        </p>
        <p>
          下次跟进：
          {opp.nextFollowupAt
            ? new Date(opp.nextFollowupAt).toLocaleDateString("zh-CN")
            : "未设置"}
        </p>
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
  const { orgId, ambiguous, loading: orgLoading } = useSalesCurrentOrgId();
  const orgCreateBlocked = isSalesOrgCreateBlocked(orgLoading, ambiguous, orgId);
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
            disabled={orgCreateBlocked}
            title={salesOrgCreateBlockedHint(orgLoading, ambiguous, orgId) ?? undefined}
            className="mt-4 inline-flex items-center gap-1.5 rounded-[var(--radius-md)] bg-foreground px-3.5 py-2 text-[13px] font-medium text-white shadow-xs hover:bg-foreground/90 active:scale-[0.98] transition-all duration-150 disabled:opacity-40"
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
              disabled={orgCreateBlocked}
              title={salesOrgCreateBlockedHint(orgLoading, ambiguous, orgId) ?? undefined}
              className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border border-border bg-card-bg/80 px-3 py-1.5 text-[12px] font-medium text-foreground shadow-xs hover:bg-accent-soft hover:border-border-strong transition-all duration-150 disabled:opacity-40"
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
