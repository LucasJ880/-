"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Send, Loader2 } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { MESSAGE_MAX_LENGTH } from "@/lib/project-discussion/types";
import type { DiscussionMessage } from "@/lib/project-discussion/types";
import type { DiscussionMember } from "./project-discussion-section";
import { MentionDropdown } from "./mention-dropdown";
import { useMentionInput } from "./use-mention-input";

interface Props {
  projectId: string;
  /** replayed：10 分钟内重发，接口返回的是第一次创建的那条 */
  onSent: (msg: DiscussionMessage, replayed?: boolean) => void;
  mentionDraft?: { userId: string; name: string } | null;
  onMentionConsumed?: () => void;
  members?: DiscussionMember[];
}

export function ProjectDiscussionComposer({
  projectId,
  onSent,
  mentionDraft,
  onMentionConsumed,
  members = [],
}: Props) {
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // COLLAB-2：@ 的触发、过滤、插入与发送名单走共用 hook（与任务评论框相同）
  const mention = useMentionInput<DiscussionMember>({
    members,
    value: body,
    setValue: setBody,
    textareaRef,
  });
  const { addMention } = mention;

  // Pre-fill from mentionDraft (click avatar → jump here)
  useEffect(() => {
    if (!mentionDraft) return;
    const tag = `@${mentionDraft.name} `;
    setBody((prev) => (prev ? `${prev}${tag}` : tag));
    addMention({ userId: mentionDraft.userId, name: mentionDraft.name });
    onMentionConsumed?.();
    setTimeout(() => {
      const ta = textareaRef.current;
      if (ta) {
        ta.focus();
        ta.selectionStart = ta.selectionEnd = ta.value.length;
      }
    }, 80);
  }, [mentionDraft, onMentionConsumed, addMention]);

  const handleSend = useCallback(async () => {
    const trimmed = body.trim();
    if (!trimmed || sending) return;
    if (trimmed.length > MESSAGE_MAX_LENGTH) {
      setError(`消息长度不能超过 ${MESSAGE_MAX_LENGTH} 字`);
      return;
    }

    // Only include mentions that are still referenced in the body
    const activeMentions = mention.submitMentions(trimmed);

    setSending(true);
    setError("");

    try {
      const payload: Record<string, unknown> = { body: trimmed };
      if (activeMentions.length > 0) {
        payload.mentions = activeMentions;
      }
      const r = await apiFetch(
        `/api/projects/${projectId}/discussion/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      const data = await r.json();
      if (!r.ok) {
        throw new Error(data.error || "发送失败");
      }
      setBody("");
      mention.reset();
      onSent(data.message, data.replayed === true);
      textareaRef.current?.focus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "发送失败");
    } finally {
      setSending(false);
    }
  }, [body, sending, projectId, onSent, mention]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // 候选列表打开时：上下键、回车 / Tab、Esc 由 hook 处理，回车选中候选、不发送
      if (mention.onKeyDown(e)) return;

      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend, mention]
  );

  return (
    <div className="px-4 py-3">
      {error && (
        <p className="mb-2 text-xs text-[#a63d3d]">{error}</p>
      )}
      <div className="relative flex items-end gap-2">
        {mention.open && (
          <MentionDropdown
            members={mention.candidates}
            query={mention.query}
            activeIndex={mention.activeIndex}
            onSelect={mention.select}
            position={{ top: 8, left: 0 }}
          />
        )}
        <textarea
          ref={textareaRef}
          value={body}
          onChange={mention.onChange}
          onKeyDown={handleKeyDown}
          placeholder="输入消息…（@ 提及成员，Enter 发送，Shift+Enter 换行）"
          rows={1}
          className="max-h-32 min-h-[40px] flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2.5 text-sm outline-none transition-colors placeholder:text-muted/50 focus:border-accent"
          style={{
            height: "auto",
            minHeight: "40px",
          }}
          onInput={(e) => {
            const el = e.currentTarget;
            el.style.height = "auto";
            el.style.height = Math.min(el.scrollHeight, 128) + "px";
          }}
          onBlur={() => {
            setTimeout(() => mention.close(), 150);
          }}
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={!body.trim() || sending}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent text-[color:var(--on-accent)] transition-colors hover:bg-accent-hover disabled:opacity-40"
        >
          {sending ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <Send size={16} />
          )}
        </button>
      </div>
      <div className="mt-1 flex items-center justify-between text-[10px] text-muted/50">
        <span>
          {body.length > 0 && `${body.length} / ${MESSAGE_MAX_LENGTH}`}
        </span>
      </div>
    </div>
  );
}
