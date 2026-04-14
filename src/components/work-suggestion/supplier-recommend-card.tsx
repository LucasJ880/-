"use client";

import { useState } from "react";
import {
  CheckCircle2,
  Loader2,
} from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import type { SupplierRecommendSuggestion } from "@/lib/ai";
import { ShoppingCart, Plus } from "lucide-react";

export function SupplierRecommendCard({
  suggestion,
  projectId,
  onCreated,
}: {
  suggestion: SupplierRecommendSuggestion;
  projectId?: string;
  onCreated?: () => void;
}) {
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [inquiryId, setInquiryId] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);

  const effectiveProjectId = projectId || suggestion.projectId;

  async function ensureInquiry(): Promise<string | null> {
    if (inquiryId) return inquiryId;
    if (!effectiveProjectId) return null;
    setResolving(true);
    try {
      const listRes = await apiFetch(`/api/projects/${effectiveProjectId}/inquiries`);
      const rounds = await listRes.json();
      const active = Array.isArray(rounds)
        ? rounds.find((r: { status: string }) => r.status === "draft" || r.status === "in_progress")
        : null;
      if (active) {
        setInquiryId(active.id);
        return active.id;
      }
      const createRes = await apiFetch(`/api/projects/${effectiveProjectId}/inquiries`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!createRes.ok) return null;
      const newInquiry = await createRes.json();
      setInquiryId(newInquiry.id);
      return newInquiry.id;
    } catch {
      return null;
    } finally {
      setResolving(false);
    }
  }

  async function addSupplier(supplierId: string) {
    setBusy(supplierId);
    try {
      const iqId = await ensureInquiry();
      if (!iqId) {
        alert("无法创建或找到询价轮次");
        return;
      }
      const res = await apiFetch(
        `/api/projects/${effectiveProjectId}/inquiries/${iqId}/items`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ supplierId }),
        }
      );
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        if (res.status === 409) {
          setAddedIds((prev) => new Set(prev).add(supplierId));
          return;
        }
        throw new Error(d.error || "添加失败");
      }
      setAddedIds((prev) => new Set(prev).add(supplierId));
      onCreated?.();
    } catch (err) {
      alert(err instanceof Error ? err.message : "添加失败");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="my-2 rounded-xl border border-[rgba(43,96,85,0.15)] bg-gradient-to-br from-[rgba(43,96,85,0.03)] to-[rgba(43,96,85,0.02)]">
      <div className="flex items-center gap-1.5 border-b border-[rgba(43,96,85,0.08)] px-4 py-2.5">
        <ShoppingCart size={13} className="text-accent" />
        <span className="text-xs font-semibold text-accent">
          AI 供应商推荐
        </span>
        <span className="text-[11px] text-muted">
          {suggestion.suppliers.length} 家
        </span>
      </div>

      <div className="divide-y divide-[rgba(43,96,85,0.06)]">
        {suggestion.suppliers.map((s) => {
          const isAdded = addedIds.has(s.supplierId);
          const isBusy = busy === s.supplierId || resolving;
          return (
            <div key={s.supplierId} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{s.supplierName}</span>
                  <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-medium text-accent tabular-nums">
                    {s.matchScore}分
                  </span>
                </div>
                {s.reason && (
                  <p className="mt-0.5 text-xs text-muted">{s.reason}</p>
                )}
              </div>
              {isAdded ? (
                <span className="flex items-center gap-1 text-xs text-[#2e7a56]">
                  <CheckCircle2 size={13} />
                  已添加
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => addSupplier(s.supplierId)}
                  disabled={isBusy}
                  className="flex shrink-0 items-center gap-1 rounded-lg bg-accent px-2.5 py-1.5 text-[11px] font-medium text-white hover:bg-accent-hover disabled:opacity-50"
                >
                  {isBusy ? (
                    <Loader2 size={11} className="animate-spin" />
                  ) : (
                    <Plus size={11} />
                  )}
                  添加到询价
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
