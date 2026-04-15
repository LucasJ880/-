"use client";

import { useState } from "react";
import { Send, Play, Loader2 } from "lucide-react";

export interface InputAreaProps {
  running: boolean;
  onSendAndRun: (content: string) => Promise<boolean>;
  onSendOnly: (content: string) => Promise<boolean>;
}

export function InputArea({
  running,
  onSendAndRun,
  onSendOnly,
}: InputAreaProps) {
  const [content, setContent] = useState("");
  const [sending, setSending] = useState(false);

  async function handleSendAndRun(e: React.SyntheticEvent) {
    e.preventDefault();
    if (!content.trim()) return;
    setSending(true);
    try {
      const success = await onSendAndRun(content);
      if (success) setContent("");
    } finally {
      setSending(false);
    }
  }

  async function handleSendOnly(e: React.SyntheticEvent) {
    e.preventDefault();
    if (!content.trim()) return;
    setSending(true);
    try {
      const success = await onSendOnly(content);
      if (success) setContent("");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card-bg p-3">
      <textarea
        className="min-h-[48px] w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-accent"
        placeholder="输入消息内容... (Ctrl+Enter 发送并运行)"
        value={content}
        onChange={(e) => setContent(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            handleSendAndRun(e);
          }
        }}
        rows={2}
      />
      <div className="mt-2 flex items-center justify-between">
        <p className="text-[10px] text-muted">
          Ctrl+Enter = 发送并运行 Agent
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleSendOnly}
            disabled={sending || !content.trim()}
            className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-background disabled:opacity-50"
          >
            <Send size={12} />
            仅发送
          </button>
          <button
            type="button"
            onClick={handleSendAndRun}
            disabled={sending || running || !content.trim()}
            className="inline-flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent/90 disabled:opacity-50"
          >
            {running ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
            {running ? "运行中..." : "发送并运行"}
          </button>
        </div>
      </div>
    </div>
  );
}
