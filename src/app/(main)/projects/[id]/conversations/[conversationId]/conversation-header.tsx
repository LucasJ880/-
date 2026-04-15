"use client";

import { useState } from "react";
import {
  MessageSquare,
  Pencil,
  Check,
  X,
  Play,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api-fetch";
import {
  ConversationStatusBadge,
  ChannelBadge,
} from "@/components/conversation";

export interface ConversationHeaderProps {
  conv: {
    title: string;
    channel: string;
    status: string;
    runtimeStatus?: string;
    lastErrorMessage?: string | null;
    user: { id: string; name: string | null; email: string } | null;
    runCount?: number;
  };
  canManage: boolean;
  projectId: string;
  conversationId: string;
  running: boolean;
  runtimeError: string | null;
  onTriggerRun: () => void;
  onDismissRuntimeError: () => void;
  onReloadConversation: () => void;
}

export function ConversationHeader({
  conv,
  canManage,
  projectId,
  conversationId,
  running,
  runtimeError,
  onTriggerRun,
  onDismissRuntimeError,
  onReloadConversation,
}: ConversationHeaderProps) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [titleSaving, setTitleSaving] = useState(false);

  const isActive = conv.status === "active";

  async function saveTitle() {
    if (!titleDraft.trim()) return;
    setTitleSaving(true);
    try {
      const res = await apiFetch(
        `/api/projects/${projectId}/conversations/${conversationId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: titleDraft.trim() }),
        }
      );
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "保存失败");
      }
      setEditingTitle(false);
      onReloadConversation();
    } catch (err) {
      alert(err instanceof Error ? err.message : "保存失败");
    } finally {
      setTitleSaving(false);
    }
  }

  async function updateStatus(newStatus: string) {
    const msg =
      newStatus === "archived"
        ? "确定归档该会话？"
        : newStatus === "completed"
          ? "确定标记为已完成？"
          : null;
    if (msg && !confirm(msg)) return;
    try {
      const res = await apiFetch(
        `/api/projects/${projectId}/conversations/${conversationId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: newStatus }),
        }
      );
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "操作失败");
      }
      onReloadConversation();
    } catch (err) {
      alert(err instanceof Error ? err.message : "操作失败");
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex gap-3">
          <MessageSquare className="mt-1 shrink-0 text-muted" size={24} />
          <div>
            <div className="flex items-center gap-2">
              {editingTitle ? (
                <div className="flex items-center gap-1">
                  <input
                    className="rounded border border-border bg-background px-2 py-1 text-lg font-bold"
                    value={titleDraft}
                    onChange={(e) => setTitleDraft(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && saveTitle()}
                    autoFocus
                  />
                  <button type="button" onClick={saveTitle} disabled={titleSaving} className="rounded p-1 text-[#2e7a56] hover:bg-[rgba(46,122,86,0.04)]">
                    <Check size={16} />
                  </button>
                  <button type="button" onClick={() => setEditingTitle(false)} className="rounded p-1 text-muted hover:bg-background">
                    <X size={16} />
                  </button>
                </div>
              ) : (
                <>
                  <h1 className="text-xl font-bold">{conv.title || "无标题"}</h1>
                  {canManage && (
                    <button type="button" onClick={() => { setTitleDraft(conv.title); setEditingTitle(true); }} className="rounded p-1 text-muted hover:bg-background">
                      <Pencil size={14} />
                    </button>
                  )}
                </>
              )}
              <ConversationStatusBadge status={conv.status} />
              <ChannelBadge channel={conv.channel} />
              {conv.runtimeStatus && conv.runtimeStatus !== "idle" && (
                <span className={cn(
                  "rounded-md px-2 py-0.5 text-[10px] font-medium",
                  conv.runtimeStatus === "running" && "bg-[rgba(43,96,85,0.08)] text-[#2b6055] animate-pulse",
                  conv.runtimeStatus === "completed" && "bg-[rgba(46,122,86,0.08)] text-[#2e7a56]",
                  conv.runtimeStatus === "failed" && "bg-[rgba(166,61,61,0.08)] text-[#a63d3d]",
                )}>
                  {conv.runtimeStatus === "running" ? "运行中" : conv.runtimeStatus === "completed" ? "已运行" : "运行失败"}
                </span>
              )}
            </div>
            <p className="mt-0.5 text-sm text-muted">
              {conv.user?.name ? conv.user.name : ""}
              {conv.runCount ? ` · ${conv.runCount} 次运行` : ""}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {canManage && isActive && (
            <button
              type="button"
              onClick={onTriggerRun}
              disabled={running}
              className="inline-flex items-center gap-1 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-50"
            >
              {running ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
              {running ? "运行中..." : "运行 Agent"}
            </button>
          )}
          {canManage && isActive && (
            <button type="button" onClick={() => updateStatus("completed")} className="rounded-[var(--radius-sm)] border border-[rgba(46,122,86,0.2)] px-3 py-2 text-sm text-success hover:bg-success-bg">
              标记完成
            </button>
          )}
          {canManage && conv.status !== "archived" && (
            <button type="button" onClick={() => updateStatus("archived")} className="rounded-[var(--radius-sm)] border border-border px-3 py-2 text-sm text-muted hover:text-foreground hover:bg-[rgba(26,36,32,0.03)]">
              归档
            </button>
          )}
          {canManage && conv.status === "archived" && (
            <button type="button" onClick={() => updateStatus("active")} className="rounded-[var(--radius-sm)] border border-[rgba(46,122,86,0.2)] px-3 py-2 text-sm text-success hover:bg-success-bg">
              恢复
            </button>
          )}
        </div>
      </div>

      {(runtimeError || conv.lastErrorMessage) && (
        <div className="flex items-start gap-2 rounded-[var(--radius-md)] border border-[rgba(166,61,61,0.15)] bg-[rgba(166,61,61,0.04)] p-3">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-danger" />
          <div className="text-sm text-danger">
            <p className="font-medium">Runtime 错误</p>
            <p className="mt-0.5 text-xs opacity-80">{runtimeError || conv.lastErrorMessage}</p>
          </div>
          {runtimeError && (
            <button type="button" onClick={onDismissRuntimeError} className="ml-auto text-danger/50 hover:text-danger">
              <X size={14} />
            </button>
          )}
        </div>
      )}
    </>
  );
}
