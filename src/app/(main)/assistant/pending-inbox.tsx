"use client";

/**
 * PR4.5 —— Assistant 页面顶部"待我确认"入口
 *
 * 职责：
 *  - Header 右侧渲染一个按钮，显示当前 pending 草稿数量
 *  - 点击展开浮层，列出所有 pending 草稿（含对话标题）
 *  - 每条草稿支持：直接"确认执行" / "取消"，或"打开对话"跳回
 *
 * 数据源：`GET /api/ai/pending-actions?status=pending`
 *
 * 数据新鲜度：
 *  - 首次打开浮层时拉一次
 *  - 监听 window `pending-actions-changed` 事件刷新
 *    （新草稿产生 / 任意一张卡片被处理都会触发）
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Bell,
  Check,
  X,
  Loader2,
  ExternalLink,
  AlertCircle,
  Inbox,
} from "lucide-react";
import { apiFetch, apiJson } from "@/lib/api-fetch";
import {
  notifyPendingActionsChanged,
  usePendingApprovalsBadge,
} from "@/lib/hooks/use-pending-approvals-badge";
import { cn } from "@/lib/utils";

interface PendingActionItem {
  id: string;
  type: string;
  title: string;
  preview: string;
  status: string;
  threadId: string | null;
  threadTitle: string | null;
  expiresAt: string;
}

const DRAFT_TYPE_LABELS: Record<string, string> = {
  "sales.update_followup": "更新跟进时间",
  "sales.update_stage": "推进商机阶段",
  "calendar.create_event": "创建日历事件",
};

interface Props {
  onOpenThread?: (threadId: string) => void;
}

export function PendingInbox({ onOpenThread }: Props) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<PendingActionItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const { count } = usePendingApprovalsBadge();

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await apiJson<{ actions: PendingActionItem[] }>(
        "/api/ai/pending-actions?status=pending",
      );
      // 过滤掉已过期的（超过 expiresAt），那些不算"待我确认"
      const now = Date.now();
      const alive = (data.actions ?? []).filter(
        (a) => new Date(a.expiresAt).getTime() > now,
      );
      setItems(alive);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void refresh();
  }, [open, refresh]);

  useEffect(() => {
    const handler = () => {
      if (open) void refresh();
    };
    window.addEventListener("pending-actions-changed", handler);
    return () =>
      window.removeEventListener("pending-actions-changed", handler);
  }, [open, refresh]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const decide = async (id: string, decision: "approve" | "reject") => {
    if (busyId) return;
    setBusyId(id);
    try {
      const res = await apiFetch(`/api/ai/pending-actions/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) {
        setError(data.error ?? "操作失败");
      } else {
        // 从列表里删掉
        setItems((prev) => prev.filter((x) => x.id !== id));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "网络错误");
    } finally {
      setBusyId(null);
      notifyPendingActionsChanged();
    }
  };

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors",
          count > 0
            ? "border-[#c85a3a]/40 bg-[#c85a3a]/10 text-[#c85a3a] hover:bg-[#c85a3a]/15"
            : "border-border bg-card-bg text-muted hover:border-accent hover:text-accent",
        )}
        title="待我确认的 AI 草稿"
      >
        <Bell size={13} />
        <span>待我确认</span>
        {count > 0 && (
          <span className="rounded-full bg-[#c85a3a] px-1.5 py-0.5 text-[9px] font-semibold leading-none text-white">
            {count > 99 ? "99+" : count}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-40 mt-2 w-[360px] overflow-hidden rounded-xl border border-border bg-card-bg shadow-xl">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="text-xs font-medium text-foreground">
              待我确认的草稿
            </span>
            <span className="text-[10px] text-muted">
              {items.length > 0 ? `共 ${items.length} 条` : ""}
            </span>
          </div>

          <div className="max-h-[60vh] overflow-y-auto">
            {loading && items.length === 0 && (
              <div className="flex items-center justify-center gap-2 px-3 py-6 text-xs text-muted">
                <Loader2 size={13} className="animate-spin" /> 正在加载…
              </div>
            )}

            {!loading && items.length === 0 && !error && (
              <div className="flex flex-col items-center justify-center gap-2 px-3 py-8 text-center text-xs text-muted">
                <Inbox size={18} className="opacity-50" />
                <span>目前没有待处理的草稿</span>
              </div>
            )}

            {error && (
              <div className="flex items-center gap-2 border-b border-[rgba(166,61,61,0.2)] bg-[rgba(166,61,61,0.05)] px-3 py-2 text-xs text-[#a63d3d]">
                <AlertCircle size={13} />
                {error}
              </div>
            )}

            <ul>
              {items.map((item) => {
                const typeLabel =
                  DRAFT_TYPE_LABELS[item.type] ?? item.type;
                const busy = busyId === item.id;
                return (
                  <li
                    key={item.id}
                    className="border-b border-border/60 px-3 py-2.5 last:border-b-0"
                  >
                    <div className="mb-1 flex items-center gap-1.5 text-[10px] text-muted">
                      <span className="rounded border border-border/80 bg-foreground/5 px-1.5 py-0.5 font-medium text-muted">
                        {typeLabel}
                      </span>
                      {item.threadTitle && (
                        <span className="truncate">
                          · {item.threadTitle}
                        </span>
                      )}
                    </div>
                    <p className="mb-1 text-xs font-medium text-foreground">
                      {item.title}
                    </p>
                    <p className="mb-2 text-[11px] leading-relaxed text-muted">
                      {item.preview}
                    </p>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => decide(item.id, "approve")}
                        className="flex items-center gap-1 rounded-full border border-accent/40 bg-accent/10 px-2.5 py-1 text-[11px] font-medium text-accent transition-colors hover:bg-accent/15 disabled:opacity-50"
                      >
                        {busy ? (
                          <Loader2 size={11} className="animate-spin" />
                        ) : (
                          <Check size={11} />
                        )}
                        确认执行
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => decide(item.id, "reject")}
                        className="flex items-center gap-1 rounded-full border border-border bg-foreground/5 px-2.5 py-1 text-[11px] text-muted transition-colors hover:text-foreground disabled:opacity-50"
                      >
                        <X size={11} />
                        取消
                      </button>
                      {item.threadId && onOpenThread && (
                        <button
                          type="button"
                          onClick={() => {
                            onOpenThread(item.threadId as string);
                            setOpen(false);
                          }}
                          className="ml-auto flex items-center gap-1 text-[10px] text-muted hover:text-accent"
                        >
                          <ExternalLink size={10} />
                          打开对话
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
