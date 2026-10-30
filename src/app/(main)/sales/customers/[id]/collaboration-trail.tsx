"use client";

/**
 * 商机协作追踪（TASKFLOW S3）：询问 → 回复 → 跟进 → 完成，按时间排列。只读。
 * 点开才拉取，避免客户页多个商机同时请求。
 */

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";

type TrailItem = {
  at: string;
  kind: "inquiry.asked" | "inquiry.replied" | "followup.created" | "followup.completed" | "followup.dismissed";
  actor: { id: string; name: string } | null;
  text: string;
};

const KIND_LABELS: Record<TrailItem["kind"], string> = {
  "inquiry.asked": "询问",
  "inquiry.replied": "回复",
  "followup.created": "跟进",
  "followup.completed": "完成",
  "followup.dismissed": "搁置",
};

export function CollaborationTrail({ opportunityId }: { opportunityId: string }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<TrailItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (!next || items) return;
    try {
      const res = await apiFetch(`/api/sales/opportunities/${encodeURIComponent(opportunityId)}/collaboration`);
      const body = (await res.json()) as { items?: TrailItem[]; error?: string };
      if (!res.ok) throw new Error(body.error ?? "加载失败");
      setItems(body.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    }
  };

  return (
    <div className="mt-1">
      <button type="button" onClick={() => void toggle()} className="text-[11px] text-muted hover:text-foreground">
        {open ? "收起协作追踪" : "协作追踪"}
      </button>
      {open && (
        <div className="mt-1.5 border-l border-border/60 pl-3">
          {error ? (
            <p className="text-xs text-red-600">{error}</p>
          ) : !items ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted" />
          ) : items.length === 0 ? (
            <p className="text-xs text-muted">还没有询问或跟进</p>
          ) : (
            <ol className="space-y-1">
              {items.map((item, i) => (
                <li key={`${item.at}-${i}`} className="text-xs text-foreground">
                  <span className="mr-2 text-muted">{new Date(item.at).toLocaleString("zh-CN", { dateStyle: "short", timeStyle: "short" })}</span>
                  <span className="mr-1 font-medium">{KIND_LABELS[item.kind]}</span>
                  {item.actor && <span className="mr-1 text-muted">{item.actor.name}：</span>}
                  <span>{item.text}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
