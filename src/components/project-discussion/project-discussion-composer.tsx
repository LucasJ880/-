"use client";

import { useCallback, useRef, useState } from "react";
import { Send, Loader2 } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { MESSAGE_MAX_LENGTH } from "@/lib/project-discussion/types";
import type { DiscussionMessage } from "@/lib/project-discussion/types";

interface Props {
  projectId: string;
  onSent: (msg: DiscussionMessage) => void;
}

export function ProjectDiscussionComposer({ projectId, onSent }: Props) {
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = useCallback(async () => {
    const trimmed = body.trim();
    if (!trimmed || sending) return;
    if (trimmed.length > MESSAGE_MAX_LENGTH) {
      setError(`消息长度不能超过 ${MESSAGE_MAX_LENGTH} 字`);
      return;
    }

    setSending(true);
    setError("");

    try {
      const r = await apiFetch(
        `/api/projects/${projectId}/discussion/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body: trimmed }),
        }
      );
      const data = await r.json();
      if (!r.ok) {
        throw new Error(data.error || "发送失败");
      }
      setBody("");
      onSent(data.message);
      textareaRef.current?.focus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "发送失败");
    } finally {
      setSending(false);
    }
  }, [body, sending, projectId, onSent]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  return (
    <div className="px-4 py-3">
      {error && (
        <p className="mb-2 text-xs text-[#a63d3d]">{error}</p>
      )}
      <div className="flex items-end gap-2">
        <textarea
          ref={textareaRef}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="输入消息…（Enter 发送，Shift+Enter 换行）"
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
