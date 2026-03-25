"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Send, Loader2 } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { MESSAGE_MAX_LENGTH } from "@/lib/project-discussion/types";
import type { DiscussionMessage, MentionItem } from "@/lib/project-discussion/types";
import type { DiscussionMember } from "./project-discussion-section";
import { MentionDropdown } from "./mention-dropdown";

interface Props {
  projectId: string;
  onSent: (msg: DiscussionMessage) => void;
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

  const [mentions, setMentions] = useState<MentionItem[]>([]);

  // @ autocomplete state
  const [showDropdown, setShowDropdown] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionStartIdx, setMentionStartIdx] = useState(-1);
  const [activeIdx, setActiveIdx] = useState(0);

  // Pre-fill from mentionDraft (click avatar → jump here)
  useEffect(() => {
    if (!mentionDraft) return;
    const tag = `@${mentionDraft.name} `;
    setBody((prev) => (prev ? `${prev}${tag}` : tag));
    setMentions((prev) => {
      if (prev.some((m) => m.userId === mentionDraft.userId)) return prev;
      return [...prev, { userId: mentionDraft.userId, name: mentionDraft.name }];
    });
    onMentionConsumed?.();
    setTimeout(() => {
      const ta = textareaRef.current;
      if (ta) {
        ta.focus();
        ta.selectionStart = ta.selectionEnd = ta.value.length;
      }
    }, 80);
  }, [mentionDraft, onMentionConsumed]);

  const filteredMembers = mentionQuery
    ? members.filter((m) => m.name.toLowerCase().includes(mentionQuery.toLowerCase()))
    : members;

  const insertMention = useCallback(
    (member: DiscussionMember) => {
      const ta = textareaRef.current;
      if (!ta || mentionStartIdx < 0) return;

      const before = body.slice(0, mentionStartIdx);
      const after = body.slice(ta.selectionStart);
      const tag = `@${member.name} `;
      const newBody = before + tag + after;
      setBody(newBody);
      setMentions((prev) => {
        if (prev.some((m) => m.userId === member.userId)) return prev;
        return [...prev, { userId: member.userId, name: member.name }];
      });
      setShowDropdown(false);
      setMentionQuery("");
      setMentionStartIdx(-1);
      setActiveIdx(0);

      setTimeout(() => {
        const cursor = before.length + tag.length;
        ta.focus();
        ta.selectionStart = ta.selectionEnd = cursor;
      }, 0);
    },
    [body, mentionStartIdx]
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const val = e.target.value;
      setBody(val);

      const pos = e.target.selectionStart;
      const textBefore = val.slice(0, pos);
      const atIdx = textBefore.lastIndexOf("@");

      if (atIdx >= 0 && (atIdx === 0 || /\s/.test(textBefore[atIdx - 1]))) {
        const query = textBefore.slice(atIdx + 1);
        if (!/\s/.test(query) && query.length <= 20) {
          setMentionStartIdx(atIdx);
          setMentionQuery(query);
          setShowDropdown(true);
          setActiveIdx(0);
          return;
        }
      }
      setShowDropdown(false);
      setMentionQuery("");
      setMentionStartIdx(-1);
    },
    []
  );

  const handleSend = useCallback(async () => {
    const trimmed = body.trim();
    if (!trimmed || sending) return;
    if (trimmed.length > MESSAGE_MAX_LENGTH) {
      setError(`消息长度不能超过 ${MESSAGE_MAX_LENGTH} 字`);
      return;
    }

    // Only include mentions that are still referenced in the body
    const activeMentions = mentions.filter((m) => trimmed.includes(`@${m.name}`));

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
      setMentions([]);
      onSent(data.message);
      textareaRef.current?.focus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "发送失败");
    } finally {
      setSending(false);
    }
  }, [body, sending, projectId, onSent, mentions]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (showDropdown && filteredMembers.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setActiveIdx((i) => (i + 1) % filteredMembers.length);
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setActiveIdx((i) => (i - 1 + filteredMembers.length) % filteredMembers.length);
          return;
        }
        if (e.key === "Enter" || e.key === "Tab") {
          e.preventDefault();
          insertMention(filteredMembers[activeIdx]);
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setShowDropdown(false);
          return;
        }
      }

      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend, showDropdown, filteredMembers, activeIdx, insertMention]
  );

  return (
    <div className="px-4 py-3">
      {error && (
        <p className="mb-2 text-xs text-[#a63d3d]">{error}</p>
      )}
      <div className="relative flex items-end gap-2">
        {showDropdown && filteredMembers.length > 0 && (
          <MentionDropdown
            members={filteredMembers}
            query={mentionQuery}
            activeIndex={activeIdx}
            onSelect={insertMention}
            position={{ top: 8, left: 0 }}
          />
        )}
        <textarea
          ref={textareaRef}
          value={body}
          onChange={handleChange}
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
            setTimeout(() => setShowDropdown(false), 150);
          }}
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={!body.trim() || sending}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent text-white transition-colors hover:bg-accent-hover disabled:opacity-40"
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
