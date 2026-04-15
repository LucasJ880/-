"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api-fetch";
import { MessageTimeline } from "@/components/conversation";
import {
  RatingInput,
  ISSUE_TYPE_OPTIONS,
} from "@/components/feedback";

interface MessageItem {
  id: string;
  role: string;
  content: string;
  contentType: string;
  sequence: number;
  modelName: string | null;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  status: string;
  errorMessage: string | null;
  toolName: string | null;
  toolCallId: string | null;
  parentMessageId: string | null;
  metadataJson: string | null;
  createdAt: string;
}

interface TagItem {
  id: string;
  key: string;
  label: string;
  category: string;
  color: string;
}

export interface MessageListProps {
  messages: MessageItem[];
  canManage: boolean;
  projectId: string;
  conversationId: string;
  tags: TagItem[];
  tagsLoaded: boolean;
  loadTags: () => void;
}

export function MessageList({
  messages,
  canManage,
  projectId,
  conversationId,
  tags,
  tagsLoaded,
  loadTags,
}: MessageListProps) {
  const [msgFbTarget, setMsgFbTarget] = useState<string | null>(null);
  const [msgFbRating, setMsgFbRating] = useState(0);
  const [msgFbIssueType, setMsgFbIssueType] = useState("");
  const [msgFbNote, setMsgFbNote] = useState("");
  const [msgFbTagIds, setMsgFbTagIds] = useState<string[]>([]);
  const [msgFbSubmitting, setMsgFbSubmitting] = useState(false);

  function openMsgFeedback(messageId: string) {
    setMsgFbTarget(messageId);
    setMsgFbRating(0);
    setMsgFbIssueType("");
    setMsgFbNote("");
    setMsgFbTagIds([]);
    if (!tagsLoaded) loadTags();
  }

  async function submitMsgFeedback() {
    if (!msgFbTarget || msgFbRating < 1) return;
    setMsgFbSubmitting(true);
    try {
      const res = await apiFetch(
        `/api/projects/${projectId}/message-feedbacks`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversationId,
            messageId: msgFbTarget,
            rating: msgFbRating,
            issueType: msgFbIssueType || undefined,
            note: msgFbNote || undefined,
            tagIds: msgFbTagIds.length > 0 ? msgFbTagIds : undefined,
          }),
        }
      );
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "提交失败");
      }
      setMsgFbTarget(null);
      setMsgFbRating(0);
      setMsgFbIssueType("");
      setMsgFbNote("");
      setMsgFbTagIds([]);
    } catch (err) {
      alert(err instanceof Error ? err.message : "提交失败");
    } finally {
      setMsgFbSubmitting(false);
    }
  }

  return (
    <>
      <MessageTimeline messages={messages} onFeedback={canManage ? openMsgFeedback : undefined} />

      {msgFbTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setMsgFbTarget(null)}>
          <div className="mx-4 w-full max-w-md rounded-2xl border border-border bg-card-bg p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-4 text-sm font-semibold">消息级反馈</h3>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-muted">评分 *</label>
                <RatingInput value={msgFbRating} onChange={setMsgFbRating} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted">问题类型</label>
                <select
                  value={msgFbIssueType}
                  onChange={(e) => setMsgFbIssueType(e.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm"
                >
                  <option value="">无</option>
                  {ISSUE_TYPE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              {tags.length > 0 && (
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted">标签</label>
                  <div className="flex flex-wrap gap-1.5">
                    {tags.map((tag) => (
                      <button
                        key={tag.id}
                        type="button"
                        onClick={() =>
                          setMsgFbTagIds((prev) =>
                            prev.includes(tag.id) ? prev.filter((id) => id !== tag.id) : [...prev, tag.id]
                          )
                        }
                        className={cn(
                          "rounded-full border px-2 py-0.5 text-xs transition-colors",
                          msgFbTagIds.includes(tag.id)
                            ? "border-accent bg-accent/10 text-accent"
                            : "border-border text-muted hover:border-accent/50"
                        )}
                      >
                        {tag.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div>
                <label className="mb-1 block text-xs font-medium text-muted">备注</label>
                <textarea
                  value={msgFbNote}
                  onChange={(e) => setMsgFbNote(e.target.value)}
                  className="min-h-[60px] w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-accent"
                  placeholder="描述问题..."
                  rows={2}
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setMsgFbTarget(null)}
                  className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted hover:text-foreground"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={submitMsgFeedback}
                  disabled={msgFbRating < 1 || msgFbSubmitting}
                  className="inline-flex items-center gap-1 rounded-lg bg-accent px-4 py-1.5 text-xs font-medium text-white hover:bg-accent/90 disabled:opacity-50"
                >
                  {msgFbSubmitting ? <Loader2 size={12} className="animate-spin" /> : null}
                  提交
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
