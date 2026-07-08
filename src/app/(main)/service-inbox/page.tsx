"use client";

/**
 * 客服收件箱 — 第一期
 * 客户发给机器人微信号的消息队列：查看 / 回复 / 标记已处理。
 * 超时未回复由 cron 推送微信 + 站内提醒（15 分钟一级、60 分钟升级）。
 */

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Clock, MessageCircle, RefreshCw, Send } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { useCurrentOrgId } from "@/lib/hooks/use-current-org-id";
import { OrgSelectBanner } from "@/components/org-select-banner";
import { cn } from "@/lib/utils";

interface ConversationSummary {
  id: string;
  channel: string;
  externalUserId: string;
  displayName: string | null;
  status: string;
  lastCustomerMessageAt: string | null;
  unansweredSince: string | null;
  lastMessage: { content: string; direction: string; createdAt: string } | null;
}

interface ConversationDetail {
  id: string;
  externalUserId: string;
  displayName: string | null;
  status: string;
  unansweredSince: string | null;
  messages: {
    id: string;
    direction: string;
    content: string;
    messageType: string;
    createdAt: string;
  }[];
}

function customerLabel(c: { displayName: string | null; externalUserId: string }) {
  return c.displayName || `微信用户 ${c.externalUserId.slice(0, 8)}…`;
}

function waitedText(unansweredSince: string | null): string | null {
  if (!unansweredSince) return null;
  const minutes = Math.floor((Date.now() - new Date(unansweredSince).getTime()) / 60_000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `等待 ${minutes} 分钟`;
  return `等待 ${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分钟`;
}

export default function ServiceInboxPage() {
  const { orgId, ambiguous, loading: orgLoading } = useCurrentOrgId();
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch("/api/service-inbox");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "加载失败");
      setConversations(data.conversations);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    try {
      const res = await apiFetch(`/api/service-inbox/${id}`);
      const data = await res.json();
      if (res.ok) setDetail(data.conversation);
    } catch {
      /* 列表已有错误提示，详情失败静默 */
    }
  }, []);

  useEffect(() => {
    if (orgLoading || ambiguous) return;
    loadList();
  }, [orgLoading, ambiguous, orgId, loadList]);

  useEffect(() => {
    if (selectedId) loadDetail(selectedId);
    else setDetail(null);
  }, [selectedId, loadDetail]);

  async function handleReply() {
    if (!selectedId || !replyText.trim() || sending) return;
    setSending(true);
    setActionError(null);
    try {
      const res = await apiFetch(`/api/service-inbox/${selectedId}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: replyText.trim(), orgId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "发送失败");
      setReplyText("");
      await Promise.all([loadDetail(selectedId), loadList()]);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "发送失败");
    } finally {
      setSending(false);
    }
  }

  async function handleMarkHandled() {
    if (!selectedId) return;
    setActionError(null);
    try {
      const res = await apiFetch(`/api/service-inbox/${selectedId}/handle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "操作失败");
      await Promise.all([loadDetail(selectedId), loadList()]);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "操作失败");
    }
  }

  const openCount = conversations.filter((c) => c.unansweredSince).length;

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">客服收件箱</h1>
          <p className="mt-1 text-sm text-muted">
            客户发给机器人微信号的消息。超时未回复会推送微信提醒（15 分钟 / 1 小时升级）。
          </p>
        </div>
        <button
          type="button"
          onClick={loadList}
          className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm text-muted transition-colors hover:bg-background"
        >
          <RefreshCw size={14} className={cn(loading && "animate-spin")} />
          刷新
        </button>
      </div>

      <OrgSelectBanner />

      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(240px,1fr)_2fr]">
        {/* 会话列表 */}
        <div className="overflow-hidden rounded-xl border border-border bg-card-bg">
          <div className="border-b border-border px-4 py-2.5 text-xs font-medium text-muted">
            会话（{conversations.length}）
            {openCount > 0 && (
              <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-red-700">
                {openCount} 待回复
              </span>
            )}
          </div>
          {conversations.length === 0 && !loading ? (
            <div className="px-4 py-8 text-center text-sm text-muted">
              暂无客户消息。客户给机器人微信号发消息后会出现在这里。
            </div>
          ) : (
            <ul className="max-h-[60vh] divide-y divide-border/80 overflow-y-auto">
              {conversations.map((c) => {
                const waited = waitedText(c.unansweredSince);
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(c.id)}
                      className={cn(
                        "w-full px-4 py-3 text-left transition-colors hover:bg-background",
                        selectedId === c.id && "bg-background",
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium">
                          {customerLabel(c)}
                        </span>
                        {waited ? (
                          <span className="flex shrink-0 items-center gap-1 text-[11px] text-red-600">
                            <Clock size={11} />
                            {waited}
                          </span>
                        ) : (
                          <span className="flex shrink-0 items-center gap-1 text-[11px] text-emerald-600">
                            <CheckCircle2 size={11} />
                            {c.status === "handled" ? "已处理" : "已回复"}
                          </span>
                        )}
                      </div>
                      {c.lastMessage && (
                        <div className="mt-1 truncate text-xs text-muted">
                          {c.lastMessage.direction === "outbound" && "↩ "}
                          {c.lastMessage.content}
                        </div>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* 会话详情 + 回复 */}
        <div className="flex min-h-[50vh] flex-col overflow-hidden rounded-xl border border-border bg-card-bg">
          {!detail ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 text-muted">
              <MessageCircle size={28} />
              <span className="text-sm">选择左侧会话查看消息</span>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
                <div className="text-sm font-medium">{customerLabel(detail)}</div>
                {detail.status !== "handled" && (
                  <button
                    type="button"
                    onClick={handleMarkHandled}
                    className="rounded-md border border-border px-2.5 py-1 text-xs text-muted transition-colors hover:bg-background"
                  >
                    标记已处理
                  </button>
                )}
              </div>

              <div className="flex-1 space-y-2 overflow-y-auto px-4 py-3">
                {detail.messages.map((m) => (
                  <div
                    key={m.id}
                    className={cn(
                      "flex",
                      m.direction === "outbound" ? "justify-end" : "justify-start",
                    )}
                  >
                    <div
                      className={cn(
                        "max-w-[75%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm",
                        m.direction === "outbound"
                          ? "bg-accent/15 text-foreground"
                          : "bg-background",
                      )}
                    >
                      {m.content}
                      <div className="mt-1 text-right text-[10px] text-muted">
                        {new Date(m.createdAt).toLocaleString("zh-CN", {
                          month: "numeric",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {actionError && (
                <div className="border-t border-border bg-red-50 px-4 py-2 text-xs text-red-800">
                  {actionError}
                </div>
              )}

              <div className="flex items-end gap-2 border-t border-border px-4 py-3">
                <textarea
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleReply();
                    }
                  }}
                  rows={2}
                  placeholder="输入回复，将通过机器人微信号发给客户（Enter 发送）"
                  className="flex-1 resize-none rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent"
                />
                <button
                  type="button"
                  onClick={handleReply}
                  disabled={sending || !replyText.trim()}
                  className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-2 text-sm font-medium text-white transition-opacity disabled:opacity-50"
                >
                  <Send size={14} />
                  {sending ? "发送中…" : "发送"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
