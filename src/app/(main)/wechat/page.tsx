"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { PageHeader } from "@/components/page-header";
import { apiFetch } from "@/lib/api-fetch";
import {
  Loader2,
  MessageCircle,
  Building2,
  ArrowDown,
  Send,
  Bot,
  User,
  RefreshCw,
  Settings,
  ChevronDown,
} from "lucide-react";
import Link from "next/link";

interface WeChatMessage {
  id: string;
  direction: "inbound" | "outbound";
  channel: string;
  content: string;
  messageType: string;
  agentProcessed: boolean;
  createdAt: string;
}

interface BindingInfo {
  id: string;
  channel: string;
  externalId: string;
  displayName: string | null;
  status: string;
}

export default function WeChatMessagesPage() {
  const [messages, setMessages] = useState<WeChatMessage[]>([]);
  const [bindings, setBindings] = useState<BindingInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [selectedChannel, setSelectedChannel] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const fetchMessages = useCallback(async (channel?: string | null, cursor?: string | null) => {
    try {
      const params = new URLSearchParams();
      if (channel) params.set("channel", channel);
      if (cursor) params.set("cursor", cursor);
      params.set("limit", "50");

      const res = await apiFetch(`/api/messaging/messages?${params}`).then((r) => r.json());

      if (cursor) {
        setMessages((prev) => [...prev, ...(res.messages || [])]);
      } else {
        setMessages(res.messages || []);
      }
      setHasMore(res.hasMore ?? false);
      setNextCursor(res.nextCursor ?? null);
    } catch {
      // empty state
    }
  }, []);

  const fetchBindings = useCallback(async () => {
    try {
      const res = await apiFetch("/api/messaging/bindings").then((r) => r.json());
      setBindings(res.bindings || []);
    } catch {
      // empty state
    }
  }, []);

  useEffect(() => {
    Promise.all([fetchMessages(), fetchBindings()]).finally(() => setLoading(false));
  }, [fetchMessages, fetchBindings]);

  const handleChannelFilter = (channel: string | null) => {
    setSelectedChannel(channel);
    setLoading(true);
    fetchMessages(channel).finally(() => setLoading(false));
  };

  const handleLoadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    await fetchMessages(selectedChannel, nextCursor);
    setLoadingMore(false);
  };

  const handleRefresh = () => {
    setLoading(true);
    fetchMessages(selectedChannel).finally(() => setLoading(false));
  };

  const sortedMessages = [...messages].reverse();

  if (loading && messages.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-accent" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* 顶部 */}
      <div className="shrink-0 border-b border-border px-6 py-4">
        <div className="flex items-center justify-between">
          <PageHeader
            title="微信消息"
            description="查看所有微信通道的对话记录"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={handleRefresh}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-muted transition-colors hover:bg-muted/10"
            >
              <RefreshCw size={12} />
              刷新
            </button>
            <Link
              href="/settings/wechat"
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-muted transition-colors hover:bg-muted/10"
            >
              <Settings size={12} />
              设置
            </Link>
          </div>
        </div>

        {/* 通道状态栏 */}
        <div className="mt-3 flex items-center gap-2">
          <ChannelTab
            label="全部"
            active={selectedChannel === null}
            onClick={() => handleChannelFilter(null)}
            count={messages.length}
          />
          <ChannelTab
            label="个人微信"
            icon={<MessageCircle size={12} className="text-[#07c160]" />}
            active={selectedChannel === "personal_wechat"}
            onClick={() => handleChannelFilter("personal_wechat")}
          />
          <ChannelTab
            label="企业微信"
            icon={<Building2 size={12} className="text-accent" />}
            active={selectedChannel === "wecom"}
            onClick={() => handleChannelFilter("wecom")}
          />

          {bindings.length > 0 && (
            <div className="ml-auto flex items-center gap-1.5">
              {bindings.map((b) => (
                <span
                  key={b.id}
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] ${
                    b.status === "active"
                      ? "bg-[#07c160]/10 text-[#07c160]"
                      : "bg-muted/10 text-muted"
                  }`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${
                    b.status === "active" ? "bg-[#07c160]" : "bg-muted/30"
                  }`} />
                  {b.displayName || b.externalId}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 消息列表 */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-4">
        {sortedMessages.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="space-y-3">
            {/* 加载更多（历史在上方） */}
            {hasMore && (
              <div className="flex justify-center pb-2">
                <button
                  onClick={handleLoadMore}
                  disabled={loadingMore}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border px-4 py-1.5 text-xs text-muted transition-colors hover:bg-muted/10"
                >
                  {loadingMore ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <ArrowDown size={12} className="rotate-180" />
                  )}
                  加载更早消息
                </button>
              </div>
            )}

            {sortedMessages.map((msg, i) => {
              const prevMsg = i > 0 ? sortedMessages[i - 1] : null;
              const showDateDivider = !prevMsg ||
                new Date(msg.createdAt).toDateString() !== new Date(prevMsg.createdAt).toDateString();

              return (
                <div key={msg.id}>
                  {showDateDivider && (
                    <div className="flex items-center gap-3 py-2">
                      <div className="flex-1 border-t border-border/50" />
                      <span className="text-[10px] text-muted">
                        {formatDate(msg.createdAt)}
                      </span>
                      <div className="flex-1 border-t border-border/50" />
                    </div>
                  )}
                  <MessageBubble msg={msg} />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function MessageBubble({ msg }: { msg: WeChatMessage }) {
  const isOutbound = msg.direction === "outbound";

  return (
    <div className={`flex gap-2 ${isOutbound ? "flex-row-reverse" : "flex-row"}`}>
      <div className={`shrink-0 mt-1 flex h-7 w-7 items-center justify-center rounded-full ${
        isOutbound
          ? "bg-accent/10 text-accent"
          : "bg-[#07c160]/10 text-[#07c160]"
      }`}>
        {isOutbound ? <Bot size={14} /> : <User size={14} />}
      </div>

      <div className={`max-w-[75%] space-y-0.5 ${isOutbound ? "items-end" : "items-start"}`}>
        <div
          className={`rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
            isOutbound
              ? "rounded-tr-md bg-accent/10 text-foreground"
              : "rounded-tl-md bg-card border border-border text-foreground"
          }`}
        >
          <div className="whitespace-pre-wrap break-words">{msg.content}</div>
        </div>

        <div className={`flex items-center gap-1.5 px-1 ${isOutbound ? "justify-end" : "justify-start"}`}>
          <span className="text-[10px] text-muted">
            {formatTime(msg.createdAt)}
          </span>
          {msg.channel === "personal_wechat" ? (
            <MessageCircle size={9} className="text-[#07c160]/50" />
          ) : (
            <Building2 size={9} className="text-accent/50" />
          )}
          {isOutbound && msg.agentProcessed && (
            <span className="text-[9px] text-accent/60">AI</span>
          )}
        </div>
      </div>
    </div>
  );
}

function ChannelTab({
  label,
  icon,
  active,
  onClick,
  count,
}: {
  label: string;
  icon?: React.ReactNode;
  active: boolean;
  onClick: () => void;
  count?: number;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
        active
          ? "bg-accent/10 text-accent"
          : "text-muted hover:bg-muted/10"
      }`}
    >
      {icon}
      {label}
      {count !== undefined && (
        <span className="rounded-full bg-muted/10 px-1.5 py-0.5 text-[10px]">{count}</span>
      )}
    </button>
  );
}

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center text-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-[#07c160]/5">
        <MessageCircle size={32} className="text-[#07c160]/40" />
      </div>
      <h3 className="text-sm font-medium">暂无微信消息</h3>
      <p className="mt-1 max-w-xs text-xs text-muted">
        绑定微信后，所有对话记录将显示在这里。青砚 AI 会通过微信主动推送简报和跟进提醒。
      </p>
      <Link
        href="/settings/wechat"
        className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-[#07c160] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#07c160]/90"
      >
        <MessageCircle size={14} />
        绑定微信
      </Link>
    </div>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  if (d.toDateString() === today.toDateString()) return "今天";
  if (d.toDateString() === yesterday.toDateString()) return "昨天";
  return d.toLocaleDateString("zh-CN", { month: "long", day: "numeric" });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}
