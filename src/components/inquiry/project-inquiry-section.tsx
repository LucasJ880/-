"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-fetch";
import {
  Plus,
  Loader2,
  ChevronDown,
  ChevronUp,
  ShoppingCart,
} from "lucide-react";
import { InquiryDetail } from "./inquiry-detail";

interface InquiryRound {
  id: string;
  roundNumber: number;
  title: string | null;
  status: string;
  dueDate: string | null;
  items: InquiryItemRow[];
}

export interface InquiryItemRow {
  id: string;
  supplierId: string;
  status: string;
  sentVia: string | null;
  sentAt: string | null;
  repliedAt: string | null;
  declinedAt: string | null;
  unitPrice: string | null;
  totalPrice: string | null;
  currency: string;
  deliveryDays: number | null;
  validUntil: string | null;
  quoteNotes: string | null;
  isSelected: boolean;
  contactNotes: string | null;
  supplier: { id: string; name: string };
}

interface Props {
  projectId: string;
  orgId: string | null;
  canManage: boolean;
}

const STATUS_LABEL: Record<string, string> = {
  draft: "草稿",
  in_progress: "进行中",
  completed: "已完成",
  canceled: "已取消",
};

export function ProjectInquirySection({ projectId, orgId, canManage }: Props) {
  const [rounds, setRounds] = useState<InquiryRound[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const loadRounds = useCallback(() => {
    apiFetch(`/api/projects/${projectId}/inquiries`)
      .then((r) => r.json())
      .then((data) => {
        const list = Array.isArray(data) ? data : [];
        setRounds(list);
        setExpandedId((prev) => prev ?? (list.length > 0 ? list[list.length - 1].id : null));
      })
      .finally(() => setLoading(false));
  }, [projectId]);

  useEffect(() => {
    loadRounds();
  }, [loadRounds]);

  async function createRound() {
    setCreating(true);
    try {
      const res = await apiFetch(`/api/projects/${projectId}/inquiries`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "创建失败");
      }
      const inquiry = await res.json();
      setExpandedId(inquiry.id);
      loadRounds();
    } catch (err) {
      alert(err instanceof Error ? err.message : "创建失败");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card-bg p-5">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <ShoppingCart size={16} className="text-accent/60" />
          供应商询价
          {rounds.length > 0 && (
            <span className="text-xs font-normal text-muted">
              {rounds.length} 轮
            </span>
          )}
        </h3>
        {canManage && (
          <button
            type="button"
            onClick={createRound}
            disabled={creating}
            className="inline-flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50"
          >
            {creating ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <Plus size={12} />
            )}
            新建询价轮次
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex h-20 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-accent" />
        </div>
      ) : rounds.length === 0 ? (
        <p className="mt-4 text-center text-sm text-muted">
          暂无询价轮次
        </p>
      ) : (
        <div className="mt-4 space-y-3">
          {rounds.map((r) => {
            const isOpen = expandedId === r.id;
            return (
              <div
                key={r.id}
                className="rounded-lg border border-border bg-background"
              >
                <button
                  type="button"
                  onClick={() => setExpandedId(isOpen ? null : r.id)}
                  className="flex w-full items-center justify-between px-4 py-3 text-left text-sm"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-medium">
                      {r.title || `第 ${r.roundNumber} 轮`}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                        r.status === "in_progress"
                          ? "bg-[rgba(46,122,86,0.08)] text-[#2e7a56]"
                          : r.status === "completed"
                            ? "bg-accent/10 text-accent"
                            : r.status === "canceled"
                              ? "bg-[rgba(166,61,61,0.08)] text-[#a63d3d]"
                              : "bg-[rgba(110,125,118,0.08)] text-[#6e7d76]"
                      }`}
                    >
                      {STATUS_LABEL[r.status] ?? r.status}
                    </span>
                    <span className="text-xs text-muted">
                      {r.items.length} 家供应商
                    </span>
                  </div>
                  {isOpen ? (
                    <ChevronUp size={14} className="text-muted" />
                  ) : (
                    <ChevronDown size={14} className="text-muted" />
                  )}
                </button>
                {isOpen && (
                  <div className="border-t border-border px-4 py-3">
                    <InquiryDetail
                      projectId={projectId}
                      orgId={orgId}
                      inquiry={r}
                      canManage={canManage}
                      onUpdate={loadRounds}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
