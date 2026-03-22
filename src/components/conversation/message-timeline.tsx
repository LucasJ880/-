"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { MessageRoleBadge } from "./message-role-badge";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Wrench,
  MessageSquarePlus,
} from "lucide-react";

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
  metadataJson: string | null;
  createdAt: string;
}

export function MessageTimeline({
  messages,
  className,
  onFeedback,
}: {
  messages: MessageItem[];
  className?: string;
  onFeedback?: (messageId: string) => void;
}) {
  if (messages.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted">暂无消息记录</p>
    );
  }

  return (
    <div className={cn("space-y-3", className)}>
      {messages.map((msg) => (
        <MessageBubble key={msg.id} message={msg} onFeedback={onFeedback} />
      ))}
    </div>
  );
}

function MessageBubble({ message: msg, onFeedback }: { message: MessageItem; onFeedback?: (id: string) => void }) {
  const [showMeta, setShowMeta] = useState(false);
  const isUser = msg.role === "user";
  const isError = msg.status === "error";
  const isTool = msg.role === "tool";

  return (
    <div
      className={cn(
        "flex gap-3",
        isUser ? "flex-row-reverse" : "flex-row"
      )}
    >
      <div
        className={cn(
          "max-w-[80%] space-y-1",
          isUser ? "items-end" : "items-start"
        )}
      >
        <div
          className={cn(
            "flex items-center gap-2",
            isUser ? "flex-row-reverse" : "flex-row"
          )}
        >
          <MessageRoleBadge role={msg.role} />
          <span className="text-[10px] text-muted">
            #{msg.sequence} ·{" "}
            {new Date(msg.createdAt).toLocaleTimeString("zh-CN")}
          </span>
          {msg.modelName && (
            <span className="text-[10px] text-muted">{msg.modelName}</span>
          )}
        </div>

        <div
          className={cn(
            "rounded-[var(--radius-md)] px-4 py-2.5 text-sm leading-relaxed",
            isUser
              ? "bg-[rgba(43,96,85,0.07)] text-foreground"
              : isTool
                ? "border border-[rgba(45,106,122,0.15)] bg-[rgba(45,106,122,0.04)]"
                : "border border-border bg-card-bg",
            isError && "border-[rgba(166,61,61,0.2)] bg-[rgba(166,61,61,0.04)]"
          )}
        >
          {isTool && msg.toolName && (
            <div className="mb-1.5 flex items-center gap-1 text-xs font-medium text-[#2d6a7a]">
              <Wrench size={12} />
              {msg.toolName}
              {msg.toolCallId && (
                <code className="text-[10px] text-muted">
                  ({msg.toolCallId})
                </code>
              )}
            </div>
          )}

          {isError && msg.errorMessage && (
            <div className="mb-2 flex items-center gap-1 text-xs text-danger">
              <AlertTriangle size={12} />
              {msg.errorMessage}
            </div>
          )}

          <div className="whitespace-pre-wrap break-words">
            {msg.content || (
              <span className="italic text-muted">（空内容）</span>
            )}
          </div>
        </div>

        {/* Meta row */}
        <div
          className={cn(
            "flex items-center gap-2 text-[10px] text-muted",
            isUser ? "flex-row-reverse" : "flex-row"
          )}
        >
          {msg.inputTokens + msg.outputTokens > 0 && (
            <span>
              {msg.inputTokens + msg.outputTokens} tokens
            </span>
          )}
          {msg.latencyMs > 0 && <span>{msg.latencyMs}ms</span>}
          {msg.metadataJson && (
            <button
              type="button"
              onClick={() => setShowMeta((v) => !v)}
              className="inline-flex items-center gap-0.5 text-accent hover:underline"
            >
              {showMeta ? (
                <ChevronDown size={10} />
              ) : (
                <ChevronRight size={10} />
              )}
              metadata
            </button>
          )}
          {onFeedback && !isUser && (
            <button
              type="button"
              onClick={() => onFeedback(msg.id)}
              className="inline-flex items-center gap-0.5 text-[var(--gold)] hover:text-[#9a7a4a] hover:underline"
              title="反馈"
            >
              <MessageSquarePlus size={10} />
              反馈
            </button>
          )}
        </div>

        {showMeta && msg.metadataJson && (
          <pre className="max-h-32 overflow-auto rounded-[var(--radius-sm)] border border-border bg-[rgba(26,36,32,0.02)] p-2 text-[10px]">
            {formatJson(msg.metadataJson)}
          </pre>
        )}
      </div>
    </div>
  );
}

function formatJson(str: string): string {
  try {
    return JSON.stringify(JSON.parse(str), null, 2);
  } catch {
    return str;
  }
}
