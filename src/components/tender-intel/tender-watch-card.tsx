"use client";

/** 公告盯梢卡（情报 tab）：粘贴公开机会页 URL → 每小时变更检测 → 站内通知。 */

import { useCallback, useEffect, useState } from "react";
import { Bell, Loader2 } from "lucide-react";
import { apiFetch, apiJson } from "@/lib/api-fetch";

type Watch = {
  url: string;
  lastCheckedAt?: string | null;
  lastChangedAt?: string | null;
} | null;

export function TenderWatchCard({
  projectId,
  canManage,
}: {
  projectId: string;
  canManage: boolean;
}) {
  const [watch, setWatch] = useState<Watch>(null);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(() => {
    apiJson<{ watch: Watch }>(`/api/projects/${projectId}/tender-watch`)
      .then((res) => setWatch(res.watch))
      .catch(() => {});
  }, [projectId]);
  useEffect(() => {
    load();
  }, [load]);

  const start = async () => {
    setBusy(true);
    setNote(null);
    try {
      const res = await apiFetch(`/api/projects/${projectId}/tender-watch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const json = await res.json();
      if (!res.ok) setNote(json.error || "设置失败");
      else {
        setNote("已开始盯梢（每小时检查；页面变化会发站内通知）");
        setUrl("");
        load();
      }
    } finally {
      setBusy(false);
    }
  };
  const stop = async () => {
    setBusy(true);
    await apiFetch(`/api/projects/${projectId}/tender-watch`, { method: "DELETE" }).catch(() => {});
    setBusy(false);
    setWatch(null);
  };

  return (
    <section className="rounded-xl border border-border bg-card-bg p-4 sm:p-5" data-testid="tender-watch-card">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <Bell size={16} className="text-accent/60" />
        公告盯梢
        <span className="text-[10px] font-normal text-muted">Addenda / Q&A 变更提醒</span>
      </h3>
      {watch ? (
        <div className="mt-2 space-y-1 text-xs">
          <p className="truncate text-foreground/80">{watch.url}</p>
          <p className="text-muted">
            上次检查：{watch.lastCheckedAt ? watch.lastCheckedAt.slice(0, 16).replace("T", " ") : "—"}
            {watch.lastChangedAt
              ? ` · 上次变化：${watch.lastChangedAt.slice(0, 16).replace("T", " ")}`
              : " · 尚未检测到变化"}
          </p>
          {canManage ? (
            <button type="button" onClick={() => void stop()} disabled={busy} className="text-danger underline">
              停止盯梢
            </button>
          ) : null}
        </div>
      ) : canManage ? (
        <div className="mt-2 flex flex-wrap gap-2">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="粘贴公开机会页 URL（如 Bids&Tenders 该标详情页）"
            className="min-w-[260px] flex-1 rounded-lg border border-border bg-background px-3 py-2 text-xs outline-none focus:border-accent"
          />
          <button
            type="button"
            onClick={() => void start()}
            disabled={busy || !url.trim()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-xs text-[color:var(--on-accent)] disabled:opacity-50"
          >
            {busy ? <Loader2 size={12} className="animate-spin" /> : <Bell size={12} />}
            开始盯梢
          </button>
        </div>
      ) : (
        <p className="mt-2 text-xs text-muted">尚未设置盯梢。</p>
      )}
      {note ? <p className="mt-2 text-xs text-muted">{note}</p> : null}
    </section>
  );
}
