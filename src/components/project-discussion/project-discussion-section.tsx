"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  MessageSquareText,
  Users,
  Loader2,
  AlertCircle,
  ChevronUp,
} from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import type { DiscussionMessage, DiscussionOverview } from "@/lib/project-discussion/types";
import { ProjectDiscussionMessageItem } from "./project-discussion-message-item";
import { ProjectDiscussionComposer } from "./project-discussion-composer";

export interface DiscussionMember {
  userId: string;
  name: string;
  avatar: string | null;
}

interface Props {
  projectId: string;
  canPost: boolean;
  projectStatus?: string;
  mentionDraft?: { userId: string; name: string } | null;
  onMentionConsumed?: () => void;
  members?: DiscussionMember[];
}

const READONLY_STATUSES = new Set(["archived", "completed"]);

export function ProjectDiscussionSection({ projectId, canPost, projectStatus, mentionDraft, onMentionConsumed, members }: Props) {
  const isReadonlyProject = projectStatus ? READONLY_STATUSES.has(projectStatus) : false;
  const [messages, setMessages] = useState<DiscussionMessage[]>([]);
  const [messageCount, setMessageCount] = useState(0);
  const [memberCount, setMemberCount] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState("");

  const listRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const initialLoad = useRef(true);

  const loadDiscussion = useCallback(() => {
    setLoading(true);
    setError("");
    apiFetch(`/api/projects/${projectId}/discussion`)
      .then(async (r) => {
        if (!r.ok) {
          const d = await r.json().catch(() => ({}));
          throw new Error(d.error || "加载失败");
        }
        return r.json() as Promise<DiscussionOverview>;
      })
      .then((data) => {
        setMessages(data.messages);
        setMessageCount(data.messageCount);
        setMemberCount(data.memberCount);
        setHasMore(data.hasMore);
        setNextCursor(data.nextCursor);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "加载讨论失败");
      })
      .finally(() => setLoading(false));
  }, [projectId]);

  useEffect(() => {
    loadDiscussion();
  }, [loadDiscussion]);

  useEffect(() => {
    if (!loading && initialLoad.current && messages.length > 0) {
      initialLoad.current = false;
      setTimeout(() => {
        bottomRef.current?.scrollIntoView({ behavior: "instant" });
      }, 50);
    }
  }, [loading, messages.length]);

  const handleLoadOlder = useCallback(async () => {
    if (!nextCursor || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const r = await apiFetch(
        `/api/projects/${projectId}/discussion/messages?cursor=${encodeURIComponent(nextCursor)}`
      );
      if (!r.ok) throw new Error("加载失败");
      const data = await r.json();
      setMessages((prev) => [...(data.messages as DiscussionMessage[]), ...prev]);
      setHasMore(data.hasMore);
      setNextCursor(data.nextCursor);
    } catch {
      // ignore
    } finally {
      setLoadingOlder(false);
    }
  }, [projectId, nextCursor, loadingOlder]);

  const handleSent = useCallback(
    (msg: DiscussionMessage) => {
      setMessages((prev) => [...prev, msg]);
      setMessageCount((c) => c + 1);
      setTimeout(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
      }, 50);
    },
    []
  );

  const groupedMessages = groupByDate(messages);

  return (
    <div id="project-discussion" className="scroll-mt-6 rounded-xl border border-border bg-card-bg">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <div className="flex items-center gap-2">
          <MessageSquareText size={16} className="text-accent/60" />
          <h3 className="text-sm font-semibold text-foreground">项目讨论</h3>
          {messageCount > 0 && (
            <span className="text-xs text-muted">{messageCount} 条消息</span>
          )}
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted">
          <Users size={12} />
          {memberCount} 位成员
        </div>
      </div>

      <p className="border-b border-border/50 bg-[rgba(95,143,139,0.03)] px-5 py-2 text-[11px] text-muted">
        此处消息将被长期保存，用于项目协作与复盘
      </p>

      {/* Message list */}
      <div
        ref={listRef}
        className="max-h-[480px] min-h-[200px] overflow-y-auto px-5 py-3"
      >
        {loading ? (
          <div className="flex h-40 items-center justify-center">
            <Loader2 size={20} className="animate-spin text-accent/40" />
          </div>
        ) : error ? (
          <div className="flex h-40 flex-col items-center justify-center gap-2 text-sm text-[#a63d3d]">
            <AlertCircle size={20} />
            <span>{error}</span>
            <button
              type="button"
              onClick={loadDiscussion}
              className="rounded-lg border border-border px-3 py-1 text-xs text-muted hover:bg-background"
            >
              重试
            </button>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex h-40 flex-col items-center justify-center gap-2 text-center">
            <MessageSquareText size={28} className="text-muted/30" />
            <p className="text-sm text-muted">暂无讨论消息</p>
            {canPost && (
              <p className="text-xs text-muted/70">发出第一条消息，开始项目协作</p>
            )}
          </div>
        ) : (
          <>
            {hasMore && (
              <div className="mb-3 flex justify-center">
                <button
                  type="button"
                  onClick={handleLoadOlder}
                  disabled={loadingOlder}
                  className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs text-muted transition-colors hover:bg-background disabled:opacity-50"
                >
                  {loadingOlder ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <ChevronUp size={12} />
                  )}
                  加载更早消息
                </button>
              </div>
            )}
            {groupedMessages.map((group) => (
              <div key={group.date}>
                <div className="my-3 flex items-center gap-3">
                  <div className="h-px flex-1 bg-border/60" />
                  <span className="shrink-0 text-[10px] font-medium text-muted/70">
                    {group.label}
                  </span>
                  <div className="h-px flex-1 bg-border/60" />
                </div>
                <div className="space-y-0.5">
                  {group.messages.map((msg) => (
                    <ProjectDiscussionMessageItem key={msg.id} message={msg} />
                  ))}
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </>
        )}
      </div>

      {/* Composer */}
      <div className="border-t border-border">
        {canPost ? (
          <ProjectDiscussionComposer
            projectId={projectId}
            onSent={handleSent}
            mentionDraft={mentionDraft}
            onMentionConsumed={onMentionConsumed}
            members={members}
          />
        ) : isReadonlyProject ? (
          <div className="px-5 py-3 text-center text-xs text-muted">
            项目已{projectStatus === "archived" ? "归档" : "完成"}，仅项目负责人和管理员可继续发言
          </div>
        ) : (
          <div className="px-5 py-3 text-center text-xs text-muted">
            你没有在此项目发送消息的权限
          </div>
        )}
      </div>
    </div>
  );
}

interface DateGroup {
  date: string;
  label: string;
  messages: DiscussionMessage[];
}

function groupByDate(messages: DiscussionMessage[]): DateGroup[] {
  const groups: DateGroup[] = [];
  let current: DateGroup | null = null;

  for (const msg of messages) {
    const d = new Date(msg.createdAt);
    const dateStr = d.toLocaleDateString("zh-CN", {
      timeZone: "America/Toronto",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const label = getDateLabel(d);

    if (!current || current.date !== dateStr) {
      current = { date: dateStr, label, messages: [] };
      groups.push(current);
    }
    current.messages.push(msg);
  }

  return groups;
}

function getDateLabel(d: Date): string {
  const now = new Date();
  const todayStr = now.toLocaleDateString("zh-CN", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const yesterday = new Date(now.getTime() - 86_400_000);
  const yesterdayStr = yesterday.toLocaleDateString("zh-CN", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const dateStr = d.toLocaleDateString("zh-CN", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  if (dateStr === todayStr) return "今天";
  if (dateStr === yesterdayStr) return "昨天";
  return d.toLocaleDateString("zh-CN", {
    timeZone: "America/Toronto",
    month: "long",
    day: "numeric",
    weekday: "short",
  });
}
